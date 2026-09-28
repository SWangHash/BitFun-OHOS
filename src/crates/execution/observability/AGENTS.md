# Observability Agent Guide

Scope: this guide applies to `src/crates/execution/observability`.

`bitfun-observability` owns the portable, OpenTelemetry-SDK-independent
telemetry contract: typed domain facts, explicit trace context, static signal
descriptors, privacy validation, sampling, admission control, and the
`TelemetrySink` boundary. The full architecture and current point/field catalog
remain authoritative in the
[`telemetry design`](../../../../docs/architecture/observability-telemetry-design.md)
and [`implementation guide`](../../../../docs/architecture/observability-implementation-guide.md).

## Ownership And Boundaries

- Keep this crate platform-agnostic. It must not read product or deployment
  configuration, access the network, depend on an OTel SDK, or know about app,
  Tauri, UI, or concrete service lifecycle.
- Business code depends on the typed `Telemetry` facade and `domains` APIs.
  Native hosts alone instantiate
  [`bitfun-observability-otel`](../../services/observability-otel/AGENTS.md) and
  inject a clone of the facade.
- `domains.rs` owns closed business facts and operation-specific observations;
  `schema.rs` owns the static outbound descriptor and field allowlist;
  `facade.rs` owns policy, sampling, observation lifecycle, and signal
  projection. Change lower-level models or `TelemetrySink` only for a genuine
  portable contract change.
- Do not bridge ordinary `log`/`tracing` records or product events into
  telemetry, and do not reconstruct a trace state machine from downstream
  events.

## Business Instrumentation Guide

1. Define the question and consumer first. Use an operation observation when a
   single execution's latency or failure path matters, an aggregate Metric for
   trends, and a typed instant event for a bounded discrete fact. Do not emit
   multiple signals unless each answers a concrete question.
2. Instrument the owner that knows the authoritative start and terminal result.
   Do not infer completion from logs, UI events, callbacks, or a downstream
   projection.
3. Reuse an API in `domains.rs` when its semantics match. For a new domain,
   add closed `StartFacts` / `FinishFacts` types and a domain-specific
   `start_*` or `record_*` entry, then register its fixed descriptors and fields
   in `schema.rs`. Do not add a public arbitrary event name, attribute map,
   string field, JSON body, or generic `record()` escape hatch.
4. Use the injected `Telemetry` clone. Start immediately around the real async
   operation, pass `ObservationContext` explicitly to nested work, and choose
   `TraceRelation::Link` for detached work that can outlive its launcher.
   Independent requests start independent roots; never use a global current
   request or put business IDs into trace baggage.
5. Convert the real `Result` into stable, bounded enums, booleans, counts,
   durations, and `SafeErrorType`, then finish exactly once on the owning path.
   Cover success, failure, cancellation, timeout, rejection, and partial or
   degraded completion as applicable. Drop-time `incomplete` is a last-resort
   diagnostic, not the normal terminal path.
6. Test through `InMemorySink`. Assert the intended Span/Metric/Log projection,
   explicit parent/link relationships, terminal outcomes, disabled policy, and
   privacy probes. Metric and Log behavior must not depend on a Trace being
   sampled.

The normal owner pattern is:

```rust
let observation = start_turn(&self.telemetry, start_facts, parent);
let turn_context = observation.context();
let result = execute_turn(turn_context).await;
observation.finish(turn_finish_facts_from(&result));
```

Before adding a domain or field, follow the complete checklist in
[design appendix E](../../../../docs/architecture/observability-telemetry-design.md#附录-e业务接入规则).
The current APIs and outbound names are indexed in
[implementation guide sections 2 and 8](../../../../docs/architecture/observability-implementation-guide.md#2-业务观测流程是怎样落到真实执行链上的).

## Privacy And Debug

- Safe Trace, Metric, and Log facts may contain only schema-approved bounded
  enums, booleans, unsigned counts/durations, and the dedicated normalized
  model-name type required by the cloud contract. Never add generic strings,
  prompts, responses, tool arguments/results, paths, business or session IDs,
  user/machine identity, endpoints, credentials, or raw errors.
- Sensitive Debug telemetry is a separate, explicitly authorized channel. Add
  content only through a closed `DebugTelemetryRecord` variant owned by the
  real operation owner, preserving redaction, shared content budgets,
  truncation metadata, and the serialized-record bound. Debug does not relax
  the safe schema, and identity or credentials have no Debug exception.
- Every descriptor must declare a stable owner, minimum level, frequency class,
  per-operation bound, field types, required fields, and Metric-label policy.
  Keep cardinality finite and review the worst case, not a typical Turn.

## Verification

```bash
cargo test -p bitfun-observability
pnpm run check:core-boundaries
```

When a business owner changes, also run that owner's focused tests. For
documentation-only changes, follow the documentation row in
[`verification.md`](../../../../docs/development/verification.md).
