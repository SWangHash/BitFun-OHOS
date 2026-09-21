use crate::{Attribute, SignalKind};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Instant;

const MAX_ACTIVE_CONTEXTS: usize = 4_096;
const MAX_ACTIVE_SPANS: usize = 1_024;
const MAX_ACTIVE_SPANS_PER_OPERATION: usize = 64;
const MAX_SPANS_PER_OPERATION: usize = 256;
const MAX_LOGS_PER_OPERATION: usize = 128;
const MAX_METRIC_SERIES_PER_INSTRUMENT: usize = 256;
const MAX_METRIC_SERIES: usize = 4_096;

#[derive(Debug)]
struct RateBucket {
    available: f64,
    last_refill: Instant,
    per_second: f64,
    burst: f64,
}

impl RateBucket {
    fn new(per_second: u32, burst: u32) -> Self {
        Self {
            available: f64::from(burst),
            last_refill: Instant::now(),
            per_second: f64::from(per_second),
            burst: f64::from(burst),
        }
    }

    fn admit(&mut self) -> bool {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        self.last_refill = now;
        self.available = (self.available + elapsed * self.per_second).min(self.burst);
        if self.available < 1.0 {
            return false;
        }
        self.available -= 1.0;
        true
    }
}

#[derive(Debug, Default)]
struct MetricSeriesBudget {
    by_instrument: HashMap<&'static str, HashSet<u64>>,
    total: usize,
}

/// Process-wide telemetry admission controller.
///
/// It never blocks business work: saturation rejects only the telemetry
/// record. Callers check the atomic telemetry level before reaching this
/// controller, so the `off` path does not acquire these locks.
#[derive(Debug)]
pub(crate) struct AdmissionController {
    active_contexts: AtomicUsize,
    active_spans: AtomicUsize,
    trace_rate: Mutex<RateBucket>,
    log_rate: Mutex<RateBucket>,
    metric_rate: Mutex<RateBucket>,
    metric_series: Mutex<MetricSeriesBudget>,
}

impl Default for AdmissionController {
    fn default() -> Self {
        Self {
            active_contexts: AtomicUsize::new(0),
            active_spans: AtomicUsize::new(0),
            trace_rate: Mutex::new(RateBucket::new(500, 1_000)),
            log_rate: Mutex::new(RateBucket::new(200, 400)),
            metric_rate: Mutex::new(RateBucket::new(2_000, 4_000)),
            metric_series: Mutex::new(MetricSeriesBudget::default()),
        }
    }
}

impl AdmissionController {
    pub(crate) fn new_operation(self: &Arc<Self>) -> Option<Arc<OperationBudget>> {
        if !reserve_below(&self.active_contexts, MAX_ACTIVE_CONTEXTS) {
            return None;
        }
        Some(Arc::new(OperationBudget {
            controller: Arc::downgrade(self),
            active_spans: AtomicUsize::new(0),
            total_spans: AtomicUsize::new(0),
            total_logs: AtomicUsize::new(0),
        }))
    }

    pub(crate) fn admit_span(&self, budget: &OperationBudget) -> bool {
        if !admit_rate(&self.trace_rate) || !reserve_below(&self.active_spans, MAX_ACTIVE_SPANS) {
            return false;
        }
        if !reserve_below(&budget.active_spans, MAX_ACTIVE_SPANS_PER_OPERATION) {
            self.active_spans.fetch_sub(1, Ordering::AcqRel);
            return false;
        }
        if !reserve_total(&budget.total_spans, MAX_SPANS_PER_OPERATION) {
            budget.active_spans.fetch_sub(1, Ordering::AcqRel);
            self.active_spans.fetch_sub(1, Ordering::AcqRel);
            return false;
        }
        true
    }

    pub(crate) fn release_span(&self, budget: &OperationBudget) {
        budget.active_spans.fetch_sub(1, Ordering::AcqRel);
        self.active_spans.fetch_sub(1, Ordering::AcqRel);
    }

    pub(crate) fn admit_log(&self, budget: Option<&OperationBudget>) -> bool {
        if !admit_rate(&self.log_rate) {
            return false;
        }
        budget.is_none_or(|budget| reserve_total(&budget.total_logs, MAX_LOGS_PER_OPERATION))
    }

    pub(crate) fn admit_metric(&self, name: &'static str, attributes: &[Attribute]) -> bool {
        if !admit_rate(&self.metric_rate) {
            return false;
        }

        let fingerprint = metric_series_fingerprint(attributes);
        let mut series = self
            .metric_series
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if series
            .by_instrument
            .get(name)
            .is_some_and(|known| known.contains(&fingerprint))
        {
            return true;
        }
        if series.total >= MAX_METRIC_SERIES {
            return false;
        }
        let known = series.by_instrument.entry(name).or_default();
        if known.len() >= MAX_METRIC_SERIES_PER_INSTRUMENT {
            return false;
        }
        known.insert(fingerprint);
        series.total += 1;
        true
    }

    pub(crate) fn admit_signal(
        &self,
        signal: SignalKind,
        name: &'static str,
        attributes: &[Attribute],
        budget: Option<&OperationBudget>,
    ) -> bool {
        match signal {
            SignalKind::Trace => true,
            SignalKind::Metric => self.admit_metric(name, attributes),
            SignalKind::Log => self.admit_log(budget),
        }
    }
}

#[derive(Debug)]
pub(crate) struct OperationBudget {
    controller: Weak<AdmissionController>,
    active_spans: AtomicUsize,
    total_spans: AtomicUsize,
    total_logs: AtomicUsize,
}

impl Drop for OperationBudget {
    fn drop(&mut self) {
        if let Some(controller) = self.controller.upgrade() {
            controller.active_contexts.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

fn reserve_below(counter: &AtomicUsize, maximum: usize) -> bool {
    counter
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
            (current < maximum).then_some(current + 1)
        })
        .is_ok()
}

fn reserve_total(counter: &AtomicUsize, maximum: usize) -> bool {
    reserve_below(counter, maximum)
}

fn admit_rate(bucket: &Mutex<RateBucket>) -> bool {
    bucket
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .admit()
}

fn metric_series_fingerprint(attributes: &[Attribute]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for attribute in attributes {
        attribute.key().hash(&mut hasher);
        format_args!("{:?}", attribute.value())
            .to_string()
            .hash(&mut hasher);
    }
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operation_budget_enforces_span_and_log_bounds() {
        let controller = Arc::new(AdmissionController::default());
        let budget = controller.new_operation().unwrap();

        for _ in 0..MAX_ACTIVE_SPANS_PER_OPERATION {
            assert!(controller.admit_span(&budget));
        }
        assert!(!controller.admit_span(&budget));
        for _ in 0..MAX_ACTIVE_SPANS_PER_OPERATION {
            controller.release_span(&budget);
        }

        for _ in 0..MAX_LOGS_PER_OPERATION {
            assert!(controller.admit_log(Some(&budget)));
        }
        assert!(!controller.admit_log(Some(&budget)));
    }

    #[test]
    fn metric_series_budget_is_bounded_per_instrument() {
        let controller = AdmissionController::default();
        for index in 0..MAX_METRIC_SERIES_PER_INSTRUMENT {
            assert!(controller.admit_metric(
                "bitfun.test.metric",
                &[Attribute::u64("bitfun.test.series", index as u64)],
            ));
        }
        assert!(!controller.admit_metric(
            "bitfun.test.metric",
            &[Attribute::u64(
                "bitfun.test.series",
                MAX_METRIC_SERIES_PER_INSTRUMENT as u64,
            )],
        ));
        assert!(controller.admit_metric(
            "bitfun.test.metric",
            &[Attribute::u64("bitfun.test.series", 0)],
        ));
    }
}
