//! Presentation projection for desktop-card hosts that render the card
//! natively instead of loading the web-ui card window.
//!
//! The projection resolves JSON Pointers, tone rules, and chart series here,
//! once, so every native renderer draws the same numbers the web-ui renderer
//! would. Value formatting (Intl number/date styles) stays in the renderer.
//! This module is platform-neutral on purpose: it is unit-tested on the host
//! target even though only the HarmonyOS adapter consumes it today.

use serde::Serialize;
use serde_json::Value;

use bitfun_core::agentic::tools::desktop_card_host::{
    DesktopCardDataSnapshot, DesktopCardRecord, DesktopCardTemplateKind,
};

const DESKTOP_CARD_TONES: [&str; 6] = [
    "neutral", "accent", "info", "success", "warning", "danger",
];

/// Most items each chart style draws; mirrors `DESKTOP_CARD_CHART_LIMITS` in
/// the web-ui model and `DESKTOP_CARD_CHART_STYLES` in the core contract.
fn chart_limit(style: &str) -> Option<usize> {
    match style {
        "bar" => Some(12),
        "column" => Some(24),
        "line" => Some(120),
        "donut" | "stacked" => Some(6),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CardViewModel {
    pub card_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub tone: String,
    pub kind: String,
    /// Non-empty when this build cannot draw the stored template.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsupported: Option<String>,
    pub visible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub countdown: Option<CountdownView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checklist: Option<Vec<ChecklistView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<ProgressView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<MetricsView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart: Option<ChartView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron_job_id: Option<String>,
    /// Filled in by the host from the scheduled-job service; never trusted from
    /// the card record.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron: Option<CronView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_html: Option<String>,
    /// Effective data for the custom-widget bridge (fetched value or inline data).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footer: Option<FooterView>,
    pub stacking: StackingView,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_session_id: Option<String>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CountdownView {
    pub target_at_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChecklistView {
    pub id: String,
    pub text: String,
    pub done: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgressView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MetricsView {
    pub layout: String,
    pub items: Vec<MetricView>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MetricView {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digits: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    pub emphasis: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartView {
    pub style: String,
    pub points: Vec<ChartPointView>,
    pub sum: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
    pub remainder: f64,
    pub scale: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digits: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    pub remainder_label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartPointView {
    pub label: String,
    pub value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    pub merged: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CronView {
    pub name: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FooterView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    pub fetched_at_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StackingView {
    pub always_on_top: bool,
    pub desktop_pinned: bool,
    pub pin_failure: bool,
}

/// Locale-dependent labels the host cannot take from the card itself.
pub(crate) struct ViewLabels {
    pub other: String,
    pub remaining: String,
}

impl ViewLabels {
    pub fn for_language(language: &str) -> Self {
        match language {
            "zh-CN" => Self {
                other: "其他".to_string(),
                remaining: "剩余".to_string(),
            },
            "zh-TW" => Self {
                other: "其他".to_string(),
                remaining: "剩餘".to_string(),
            },
            _ => Self {
                other: "Other".to_string(),
                remaining: "Remaining".to_string(),
            },
        }
    }
}

/// RFC 6901 lookup, matching the web-ui model: `None` pointer means "not
/// configured", an empty pointer means the root itself.
pub(crate) fn resolve_pointer<'a>(root: &'a Value, pointer: Option<&str>) -> Option<&'a Value> {
    let pointer = pointer?;
    if pointer.is_empty() {
        return Some(root);
    }
    if !pointer.starts_with('/') {
        return None;
    }
    let mut current = root;
    for raw_segment in pointer[1..].split('/') {
        let segment = raw_segment.replace("~1", "/").replace("~0", "~");
        match current {
            Value::Array(items) => {
                if !is_array_index(&segment) {
                    return None;
                }
                current = items.get(segment.parse::<usize>().ok()?)?;
            }
            Value::Object(map) => {
                current = map.get(&segment)?;
            }
            _ => return None,
        }
    }
    Some(current)
}

fn is_array_index(segment: &str) -> bool {
    !segment.is_empty()
        && segment.bytes().all(|byte| byte.is_ascii_digit())
        && (segment == "0" || !segment.starts_with('0'))
}

fn finite_number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64().filter(|value| value.is_finite()),
        Value::String(text) if !text.trim().is_empty() => text
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite()),
        _ => None,
    }
}

pub(crate) fn normalize_tone(tone: Option<&str>) -> Option<String> {
    tone.filter(|tone| DESKTOP_CARD_TONES.contains(tone))
        .map(str::to_string)
}

fn label_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => number.as_f64().map(|number| format!("{number}")),
        _ => None,
    }
}

fn optional_text(value: &Value) -> Option<String> {
    label_text(value).filter(|text| !text.trim().is_empty())
}

fn tone_map_key(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Null => None,
        other => serde_json::to_string(other).ok(),
    }
}

fn metric_tone(
    item: &bitfun_core::agentic::tools::desktop_card_host::DesktopCardMetricItem,
    raw: Option<&Value>,
) -> Option<String> {
    if let (Some(map), Some(raw)) = (item.tone_map.as_ref(), raw) {
        if let Some(key) = tone_map_key(raw) {
            if let Some(tone) = map.get(&key).and_then(|tone| normalize_tone(Some(tone))) {
                return Some(tone);
            }
        }
    }
    if item.sign_tone {
        if let Some(number) = raw.and_then(finite_number) {
            if number > 0.0 {
                return Some("success".to_string());
            }
            if number < 0.0 {
                return Some("danger".to_string());
            }
            return Some("neutral".to_string());
        }
    }
    normalize_tone(item.tone.as_deref())
}

fn metric_hint(
    item: &bitfun_core::agentic::tools::desktop_card_host::DesktopCardMetricItem,
    data: &Value,
) -> Option<String> {
    if let Some(path) = item.hint_path.as_deref() {
        if let Some(hint) = resolve_pointer(data, Some(path)) {
            let text = optional_text(hint).or_else(|| match hint {
                Value::Null => None,
                other => serde_json::to_string(other).ok(),
            });
            if text.is_some() {
                return text;
            }
        }
    }
    item.hint.clone().filter(|hint| !hint.is_empty())
}

/// Effective data for template paths: the latest fetched value when the card
/// has a data source, the inline data otherwise.
pub(crate) fn effective_data(card: &DesktopCardRecord) -> Value {
    match card.data_source.as_ref().and_then(|source| source.known()) {
        Some(_) => card
            .last_data
            .as_ref()
            .map(|snapshot| snapshot.value.clone())
            .unwrap_or(Value::Null),
        None => card.data.clone(),
    }
}

fn has_data_source(card: &DesktopCardRecord) -> bool {
    card.data_source
        .as_ref()
        .is_some_and(|source| source.known().is_some())
}

fn template_paths(template: &DesktopCardTemplateKind) -> Vec<String> {
    match template {
        DesktopCardTemplateKind::Progress {
            value_path,
            max_path,
            status_path,
            ..
        } => [value_path, max_path, status_path]
            .into_iter()
            .flatten()
            .cloned()
            .collect(),
        DesktopCardTemplateKind::Metrics { items, .. } => items
            .iter()
            .flat_map(|item| [item.path.as_ref(), item.hint_path.as_ref()])
            .flatten()
            .cloned()
            .collect(),
        DesktopCardTemplateKind::Chart(chart) => [
            chart.items_path.as_ref(),
            chart.labels_path.as_ref(),
            chart.total_path.as_ref(),
        ]
        .into_iter()
        .flatten()
        .cloned()
        .collect(),
        _ => Vec::new(),
    }
}

fn has_unresolved_paths(card: &DesktopCardRecord, data: &Value) -> bool {
    let Some(template) = card.template.known() else {
        return false;
    };
    template_paths(template).iter().any(|path| {
        resolve_pointer(data, Some(path.as_str()))
            .map(|value| value.is_null())
            .unwrap_or(true)
    })
}

fn footer_view(card: &DesktopCardRecord, data: &Value) -> Option<FooterView> {
    let snapshot: &DesktopCardDataSnapshot = card.last_data.as_ref()?;
    if !has_data_source(card) {
        return None;
    }
    let warning = snapshot.warning.as_deref().filter(|warning| !warning.is_empty());
    let error = snapshot.error.as_deref().filter(|error| !error.is_empty());
    let stderr_explains_gaps = warning.is_some() && has_unresolved_paths(card, data);
    let state = if error.is_some() {
        Some("error".to_string())
    } else if stderr_explains_gaps {
        Some("warning".to_string())
    } else {
        None
    };
    Some(FooterView {
        state,
        fetched_at_ms: snapshot.fetched_at_ms,
        text: error.or(warning).map(str::to_string),
    })
}

fn stacking_view(card: &DesktopCardRecord) -> StackingView {
    let pinned = !card.always_on_top
        && card
            .extra
            .get(super::DESKTOP_PINNED_KEY)
            .and_then(Value::as_bool)
            == Some(true);
    let pin_failure = card
        .extra
        .get(super::PIN_FAILURE_KEY)
        .and_then(Value::as_str)
        .is_some_and(|failure| !failure.is_empty())
        && !pinned;
    StackingView {
        always_on_top: card.always_on_top,
        desktop_pinned: pinned,
        pin_failure,
    }
}

fn read_chart_points(
    chart: &bitfun_core::agentic::tools::desktop_card_host::DesktopCardChart,
    data: &Value,
) -> Vec<ChartPointView> {
    let Some(items_path) = chart.items_path.as_deref() else {
        return chart
            .items
            .iter()
            .filter(|item| item.value.is_finite())
            .map(|item| ChartPointView {
                label: item.label.clone(),
                value: item.value,
                tone: normalize_tone(item.tone.as_deref()),
                hint: item.hint.clone().filter(|hint| !hint.is_empty()),
                merged: false,
            })
            .collect();
    };

    let Some(Value::Array(rows)) = resolve_pointer(data, Some(items_path)) else {
        return Vec::new();
    };
    let labels = chart
        .labels_path
        .as_deref()
        .and_then(|path| resolve_pointer(data, Some(path)));
    let label_at = |index: usize| -> String {
        labels
            .and_then(|labels| match labels {
                Value::Array(items) => items.get(index).and_then(label_text),
                _ => None,
            })
            .unwrap_or_else(|| (index + 1).to_string())
    };
    let label_key = chart.label_key.as_deref().unwrap_or("label");
    let value_key = chart.value_key.as_deref().unwrap_or("value");
    let hint_key = chart.hint_key.as_deref().unwrap_or("hint");

    rows.iter()
        .enumerate()
        .filter_map(|(index, row)| match row {
            Value::Array(pair) => {
                let value = finite_number(pair.get(1)?)?;
                Some(ChartPointView {
                    label: pair
                        .first()
                        .and_then(label_text)
                        .unwrap_or_else(|| label_at(index)),
                    value,
                    tone: None,
                    hint: None,
                    merged: false,
                })
            }
            Value::Object(map) => {
                let value = finite_number(map.get(value_key)?)?;
                Some(ChartPointView {
                    label: map
                        .get(label_key)
                        .and_then(label_text)
                        .unwrap_or_else(|| label_at(index)),
                    value,
                    tone: map
                        .get("tone")
                        .and_then(Value::as_str)
                        .and_then(|tone| normalize_tone(Some(tone))),
                    hint: map.get(hint_key).and_then(optional_text),
                    merged: false,
                })
            }
            other => {
                let value = finite_number(other)?;
                Some(ChartPointView {
                    label: label_at(index),
                    value,
                    tone: None,
                    hint: None,
                    merged: false,
                })
            }
        })
        .collect()
}

fn chart_view(
    chart: &bitfun_core::agentic::tools::desktop_card_host::DesktopCardChart,
    data: &Value,
    labels: &ViewLabels,
) -> ChartView {
    let style = chart.chart.as_str();
    let limit = chart_limit(style).unwrap_or(12);
    let mut points = read_chart_points(chart, data);
    if style != "line" {
        for point in points.iter_mut() {
            if point.value < 0.0 {
                point.value = 0.0;
            }
        }
    }
    if points.len() > limit {
        if style == "line" {
            points = points.split_off(points.len() - limit);
        } else if style == "donut" || style == "stacked" {
            let rest = points.split_off(limit - 1);
            let merged: f64 = rest.iter().map(|point| point.value).sum();
            points.push(ChartPointView {
                label: labels.other.clone(),
                value: merged,
                tone: None,
                hint: None,
                merged: true,
            });
        } else {
            points.truncate(limit);
        }
    }
    let sum: f64 = points.iter().map(|point| point.value).sum();
    let raw_total = chart
        .total_path
        .as_deref()
        .and_then(|path| resolve_pointer(data, Some(path)))
        .and_then(finite_number)
        .or(chart.total);
    let total = raw_total.filter(|total| style != "line" && *total > 0.0);
    let remainder = total.filter(|total| *total > sum).map_or(0.0, |total| total - sum);
    let largest = points
        .iter()
        .map(|point| point.value)
        .fold(0.0_f64, f64::max);
    let scale = if style == "donut" || style == "stacked" {
        total.unwrap_or(0.0).max(sum)
    } else {
        total.unwrap_or(0.0).max(largest)
    };
    ChartView {
        style: style.to_string(),
        points,
        sum,
        total,
        remainder,
        scale,
        format: chart.format.clone(),
        digits: chart.digits,
        currency: chart.currency.clone(),
        prefix: chart.prefix.clone(),
        suffix: chart.suffix.clone(),
        label_format: chart.label_format.clone(),
        caption: chart
            .caption
            .clone()
            .filter(|caption| !caption.is_empty()),
        remainder_label: chart
            .remainder_label
            .clone()
            .filter(|label| !label.is_empty())
            .unwrap_or_else(|| labels.remaining.clone()),
    }
}

/// Builds the presentation projection for one card. `cron` is injected by the
/// host after it reads the scheduled-job service.
pub(crate) fn build(
    card: &DesktopCardRecord,
    labels: &ViewLabels,
) -> CardViewModel {
    let data = effective_data(card);
    let tone = normalize_tone(card.accent.as_deref()).unwrap_or_else(|| "accent".to_string());
    let mut view = CardViewModel {
        card_id: card.id.clone(),
        title: card.title.clone(),
        subtitle: card.subtitle.clone().filter(|text| !text.is_empty()),
        icon: card.icon.clone(),
        tone,
        kind: card.template.kind(),
        unsupported: None,
        visible: card.visible,
        link: card.link.clone(),
        countdown: None,
        checklist: None,
        note: None,
        progress: None,
        metrics: None,
        chart: None,
        cron_job_id: None,
        cron: None,
        custom_html: None,
        custom_data: None,
        footer: footer_view(card, &data),
        stacking: stacking_view(card),
        source_session_id: card
            .origin
            .session_id
            .clone()
            .filter(|session_id| !session_id.is_empty()),
        updated_at_ms: card.updated_at_ms,
    };

    let Some(template) = card.template.known() else {
        view.unsupported = Some("template".to_string());
        return view;
    };

    match template {
        DesktopCardTemplateKind::Countdown {
            target_at_ms,
            started_at_ms,
            message,
            ..
        } => {
            view.countdown = Some(CountdownView {
                target_at_ms: *target_at_ms,
                started_at_ms: *started_at_ms,
                message: message.clone().filter(|message| !message.is_empty()),
            });
        }
        DesktopCardTemplateKind::Checklist { items } => {
            view.checklist = Some(
                items
                    .iter()
                    .map(|item| ChecklistView {
                        id: item.id.clone(),
                        text: item.text.clone(),
                        done: item.done,
                    })
                    .collect(),
            );
        }
        DesktopCardTemplateKind::Note { text } => {
            view.note = Some(text.clone());
        }
        DesktopCardTemplateKind::Progress {
            value,
            max,
            value_path,
            max_path,
            status,
            status_path,
        } => {
            let resolved_value = value_path
                .as_deref()
                .and_then(|path| resolve_pointer(&data, Some(path)))
                .and_then(finite_number)
                .or(*value);
            let resolved_max = max_path
                .as_deref()
                .and_then(|path| resolve_pointer(&data, Some(path)))
                .and_then(finite_number)
                .or(*max);
            let resolved_status = status_path
                .as_deref()
                .and_then(|path| resolve_pointer(&data, Some(path)))
                .and_then(optional_text)
                .or_else(|| status.clone().filter(|status| !status.is_empty()));
            view.progress = Some(ProgressView {
                value: resolved_value,
                max: resolved_max,
                status: resolved_status,
            });
        }
        DesktopCardTemplateKind::Metrics { items, layout } => {
            view.metrics = Some(MetricsView {
                layout: layout.clone().filter(|layout| layout == "grid").unwrap_or_else(|| "list".to_string()),
                items: items
                    .iter()
                    .map(|item| {
                        let raw = item
                            .path
                            .as_deref()
                            .and_then(|path| resolve_pointer(&data, Some(path)))
                            .or(item.value.as_ref());
                        MetricView {
                            label: item.label.clone(),
                            value: raw.cloned(),
                            format: item.format.clone(),
                            digits: item.digits,
                            currency: item.currency.clone(),
                            prefix: item.prefix.clone(),
                            suffix: item.suffix.clone(),
                            tone: metric_tone(item, raw),
                            hint: metric_hint(item, &data),
                            emphasis: item.emphasis,
                        }
                    })
                    .collect(),
            });
        }
        DesktopCardTemplateKind::Chart(chart) => {
            if chart_limit(chart.chart.as_str()).is_none() {
                view.unsupported = Some("chartStyle".to_string());
            } else {
                view.chart = Some(chart_view(chart, &data, labels));
            }
        }
        DesktopCardTemplateKind::CronJob { job_id } => {
            view.cron_job_id = Some(job_id.clone());
        }
        DesktopCardTemplateKind::Custom { html } => {
            view.custom_html = Some(html.clone());
            view.custom_data = Some(data.clone());
        }
    }
    view
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn card(template: Value, data: Value) -> DesktopCardRecord {
        serde_json::from_value(json!({
            "id": "card-1",
            "title": "Test",
            "template": template,
            "data": data,
        }))
        .unwrap()
    }

    #[test]
    fn pointers_follow_json_pointer_escaping_and_array_indexes() {
        let root = json!({ "a/b": { "~x": [10, 20] } });
        assert_eq!(
            resolve_pointer(&root, Some("/a~1b/~0x/1")),
            Some(&json!(20))
        );
        assert_eq!(resolve_pointer(&root, Some("/a~1b/~0x/01")), None);
        assert_eq!(resolve_pointer(&root, Some("")), Some(&root));
        assert_eq!(resolve_pointer(&root, None), None);
    }

    #[test]
    fn metrics_resolve_paths_and_apply_sign_tone() {
        let view = build(
            &card(
                json!({ "kind": "metrics", "items": [
                    { "label": "Change", "path": "/change", "format": "percent", "signTone": true },
                    { "label": "Static", "value": 3 }
                ]}),
                json!({ "change": "-2.5" }),
            ),
            &ViewLabels::for_language("en"),
        );
        let metrics = view.metrics.unwrap();
        assert_eq!(metrics.items[0].value, Some(json!("-2.5")));
        assert_eq!(metrics.items[0].tone.as_deref(), Some("danger"));
        assert_eq!(metrics.items[1].value, Some(json!(3)));
        assert_eq!(metrics.items[1].tone, None);
    }

    #[test]
    fn stacked_chart_merges_points_past_the_limit_into_other() {
        let items: Vec<Value> = (0..8)
            .map(|index| json!({ "label": format!("p{index}"), "value": index + 1 }))
            .collect();
        let view = build(
            &card(
                json!({ "kind": "chart", "chart": "stacked", "items": items, "total": 100 }),
                Value::Null,
            ),
            &ViewLabels::for_language("en"),
        );
        let chart = view.chart.unwrap();
        assert_eq!(chart.points.len(), 6);
        assert!(chart.points[5].merged);
        assert_eq!(chart.points[5].label, "Other");
        assert_eq!(chart.points[5].value, 21.0);
        assert_eq!(chart.total, Some(100.0));
        assert_eq!(chart.remainder, 64.0);
        assert_eq!(chart.scale, 100.0);
    }

    #[test]
    fn line_chart_keeps_latest_points_and_keeps_negatives() {
        let values: Vec<Value> = (0..5).map(|value| json!(value - 2)).collect();
        let view = build(
            &card(
                json!({ "kind": "chart", "chart": "line", "itemsPath": "/series" }),
                json!({ "series": values }),
            ),
            &ViewLabels::for_language("en"),
        );
        let chart = view.chart.unwrap();
        assert_eq!(chart.points[0].value, -2.0);
        assert_eq!(chart.total, None);
        assert_eq!(chart.scale, 2.0);
    }

    #[test]
    fn data_source_cards_read_the_latest_snapshot_and_report_stderr_gaps() {
        let record: DesktopCardRecord = serde_json::from_value(json!({
            "id": "card-2",
            "title": "Weather",
            "template": { "kind": "progress", "valuePath": "/done", "maxPath": "/total" },
            "dataSource": { "kind": "command", "command": "echo", "intervalSeconds": 60 },
            "lastData": { "fetchedAtMs": 1700000000000_i64, "value": { "done": 5 }, "warning": "partial" },
        }))
        .unwrap();
        let view = build(&record, &ViewLabels::for_language("en"));
        let progress = view.progress.unwrap();
        assert_eq!(progress.value, Some(5.0));
        assert_eq!(progress.max, None);
        let footer = view.footer.unwrap();
        assert_eq!(footer.state.as_deref(), Some("warning"));
        assert_eq!(footer.text.as_deref(), Some("partial"));
        assert_eq!(footer.fetched_at_ms, 1700000000000);
    }

    #[test]
    fn unknown_template_and_chart_style_are_reported_as_unsupported() {
        let unknown = build(
            &card(json!({ "kind": "futureKind" }), Value::Null),
            &ViewLabels::for_language("en"),
        );
        assert_eq!(unknown.unsupported.as_deref(), Some("template"));

        let style = build(
            &card(json!({ "kind": "chart", "chart": "radar", "items": [] }), Value::Null),
            &ViewLabels::for_language("en"),
        );
        assert_eq!(style.unsupported.as_deref(), Some("chartStyle"));
        assert!(style.chart.is_none());
    }

    #[test]
    fn labels_follow_the_application_language() {
        assert_eq!(ViewLabels::for_language("zh-CN").other, "其他");
        assert_eq!(ViewLabels::for_language("zh-TW").remaining, "剩餘");
        assert_eq!(ViewLabels::for_language("en").remaining, "Remaining");
    }
}
