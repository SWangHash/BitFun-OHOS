use bitfun_observability::TelemetryLevel;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryHealthState {
    #[default]
    Closed,
    Starting,
    Healthy,
    Degraded,
    Backlogged,
    ShuttingDown,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryHealthSnapshot {
    pub state: TelemetryHealthState,
    pub user_level: TelemetryLevel,
    pub effective_level: TelemetryLevel,
    pub generation: u64,
    pub queued_records: u64,
    pub queued_bytes: u64,
    pub in_flight_batches: u64,
    pub retry_attempts: u64,
    pub locally_dropped: u64,
    pub ambiguous: u64,
    pub acknowledged: u64,
    pub server_rejected: u64,
    pub last_success_unix_ms: Option<u64>,
}

#[derive(Debug, Default)]
pub(crate) struct TransportDiagnostics {
    request_attempts: AtomicU64,
    retry_attempts: AtomicU64,
    locally_dropped: AtomicU64,
    ambiguous: AtomicU64,
    acknowledged: AtomicU64,
    server_rejected: AtomicU64,
    successful_batches: AtomicU64,
    failed_batches: AtomicU64,
    last_success_unix_ms: AtomicU64,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct TransportSnapshot {
    pub retry_attempts: u64,
    pub locally_dropped: u64,
    pub ambiguous: u64,
    pub acknowledged: u64,
    pub server_rejected: u64,
    pub failed_batches: u64,
    pub last_success_unix_ms: Option<u64>,
}

impl TransportDiagnostics {
    pub(crate) fn request_attempt(&self, retry: bool) {
        self.request_attempts.fetch_add(1, Ordering::Relaxed);
        if retry {
            self.retry_attempts.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub(crate) fn acknowledged(&self, accepted: u64, rejected: u64, now_unix_ms: u64) {
        self.acknowledged.fetch_add(accepted, Ordering::Relaxed);
        self.server_rejected.fetch_add(rejected, Ordering::Relaxed);
        self.successful_batches.fetch_add(1, Ordering::Relaxed);
        self.last_success_unix_ms
            .store(now_unix_ms.max(1), Ordering::Release);
    }

    pub(crate) fn locally_dropped(&self, count: u64) {
        self.locally_dropped.fetch_add(count, Ordering::Relaxed);
        self.failed_batches.fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn ambiguous(&self, count: u64) {
        self.ambiguous.fetch_add(count, Ordering::Relaxed);
        self.failed_batches.fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn snapshot(&self) -> TransportSnapshot {
        let last_success = self.last_success_unix_ms.load(Ordering::Acquire);
        TransportSnapshot {
            retry_attempts: self.retry_attempts.load(Ordering::Relaxed),
            locally_dropped: self.locally_dropped.load(Ordering::Relaxed),
            ambiguous: self.ambiguous.load(Ordering::Relaxed),
            acknowledged: self.acknowledged.load(Ordering::Relaxed),
            server_rejected: self.server_rejected.load(Ordering::Relaxed),
            failed_batches: self.failed_batches.load(Ordering::Relaxed),
            last_success_unix_ms: (last_success != 0).then_some(last_success),
        }
    }
}
