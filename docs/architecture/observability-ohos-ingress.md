# OHOS PC Telemetry Ingress Integration

This document records the OHOS-specific host adapter for the portable BitFun
observability runtime. The signal schema and business-owner rules remain in
`observability-telemetry-design.md`; the public ingress contract is frozen in
`docs/telemetry-api/telemetry-api.md`.

## Data flow

```text
Agent owner -> bitfun-observability -> bitfun-observability-otel
            -> AnonymousAuthService (otel:write)
            -> /otlp/v1/{traces,metrics,logs}
```

- `AnonymousAuthService` is shared with Feedback. It owns enroll, refresh,
  scope validation, in-memory access tokens, and refresh serialization.
- HarmonyOS Asset Store persists the existing credential payload under the
  existing alias. Feedback capability tokens remain separate and cannot be
  used as telemetry credentials.
- `OhosTelemetryController` takes its enablement only from the privacy
  collection policy. Before consent it applies `off`; after consent it applies
  `diagnostic`, with Trace and successful Log sampling both set to `1.0` by the
  product default. The product exposes no separate telemetry setting and never
  selects `basic` or `debug`. Revocation closes admission and discards pending
  data immediately.
- Every OTLP batch has a UUID `X-Request-ID` and `Idempotency-Key`. Retries of
  the same body reuse both values; 401 performs one forced token refresh; 413
  recursively splits standard OTLP protobuf batches.
- The OHOS host selects the same fixed ingress environment as Feedback: Debug
  uses `http://api-test.infra-bitfun.com`, while Release uses
  `https://api.infra-bitfun.com`. Release does not require
  `BITFUN_TELEMETRY_OTLP_ENDPOINT`; other hosts retain their existing Collector
  configuration paths.
- The BitFun ingress profile applies the cloud Schema v1 projection before
  records enter the OTLP SDK. The richer portable descriptors remain available
  to standard self-hosted OTLP deployments, but unsupported names and fields
  are never sent to `/otlp/v1/*` for the managed ingress.
- The current test ingress rejects payloads after gateway gzip processing, so
  the OHOS ingress profile sends uncompressed protobuf. Gzip remains available
  for standard Collector deployments and can be re-enabled after the cloud
  path passes the same smoke test.

## Cloud Schema v1 projection

The managed ingress sends only the cleaning contract's closed signal set:

- Spans: `bitfun.session`, `bitfun.turn`, `bitfun.llm.request`,
  `bitfun.tool.call`, and `bitfun.auth.refresh`.
- Metrics: session/turn/LLM/tool counts, LLM/tool duration in milliseconds,
  LLM TTFT, input/output token usage, operation error counts, and retry counts.
- Event bodies: `session.started`, `turn.completed`,
  `llm.request.completed`, `tool.call.completed`, and `client.error` when the
  corresponding owner fact exists. `session.completed` and `client.crash` are
  reserved until authoritative lifecycle owners emit those facts.

Every event receives a UUID `bitfun.event_id` before it enters the bounded log
queue. Transport retries and 413 batch splits therefore preserve the same ID.
The projection normalizes operation results, provider classes, error classes,
and tool categories. Model names are lower-cased only after passing a 64-byte
identifier allowlist; path-like, free-text, or oversized values are omitted.
The projection removes every other non-allowlisted attribute, emits uppercase
bounded severity text, and disables the sensitive Debug log pipeline for the
managed ingress. Standard OTLP deployments keep the existing portable signal
catalog and Debug behavior.

Managed-ingress Trace and successful Event sampling are fixed to `1.0` after
privacy consent. Consent revocation still closes admission and discards queued
records before any projection or export.

## Anonymous auth recovery

Token refresh is recorded as `bitfun.auth.refresh` without token, key, endpoint,
or error-message content. A refresh retry reuses the persisted refresh
`Idempotency-Key`; `REFRESH_TOKEN_INVALID` is attempted at most once more.
Terminal refresh-family errors and an enroll duplicate rotate to a new
installation key before a single new enroll attempt, so the client never
re-enrolls an already consumed key.

## Verification evidence

On 2026-08-25, a synthetic content-free Turn was sent through the test ingress.
Trace, Log, and Metric requests all returned HTTP 200; client diagnostics
reported `acknowledged=4`, `rejected=0`, and `dropped=0`.

On 2026-09-28, focused contract tests verified the managed-ingress projection,
closed event bodies and attributes, stable event IDs, millisecond metric units,
and safe anonymous-refresh telemetry. This is local contract evidence; a new
cloud data-wall verification is still required after deployment.
