//! Tool admission policy port.
//!
//! Domain crates own admission decisions and register them here; generic
//! dispatch paths only call the registry received through
//! [`ToolRuntimeHandles`].

use std::sync::Arc;

/// A domain-owned session state slot addressed by namespace + key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct DomainStateSlot {
    pub namespace: &'static str,
    pub key: &'static str,
}

/// Read-only access to domain-owned session state slots.
///
/// Host-implemented as a thin session-bound wrapper over the session owner;
/// domain crates only see this trait.
pub trait DomainStateReader: Send + Sync + std::fmt::Debug {
    fn get(&self, slot: &DomainStateSlot) -> Option<serde_json::Value>;
}

/// Read-write access to domain-owned session state slots.
///
/// `set` takes `&self` (implementations use interior mutability) so writers
/// dispatch as shared `Arc<dyn DomainStateWriter>` handles like readers do.
/// Persistence is the implementor's concern: the memory view is authoritative
/// and the write must become durable on a best-effort basis without blocking
/// the caller.
pub trait DomainStateWriter: DomainStateReader {
    fn set(&self, slot: &DomainStateSlot, value: serde_json::Value);
}

/// Facts of one tool admission check.
#[derive(Debug, Clone, Copy)]
pub struct ToolAdmissionRequest<'a> {
    pub tool_name: &'a str,
    pub input: Option<&'a serde_json::Value>,
    pub session_id: Option<&'a str>,
}

/// Structured admission rejection. Carries a stable code, failure kind, the
/// missing input fields (if any) and a recovery action so the Host/UI can
/// project a recovery path without parsing free-form text.
#[derive(Debug, Clone)]
pub struct ToolAdmissionRejection {
    pub code: &'static str,
    pub kind: &'static str,
    pub missing_fields: Vec<&'static str>,
    pub recovery_action: &'static str,
}

impl ToolAdmissionRejection {
    /// Render into the stable error text consumed by the model and surfaced to
    /// the Host/UI: `code: kind[; missing:...]; recovery:...`. The Host
    /// matches `code` and may parse `kind`/`missing` without depending on prose.
    pub fn to_message(&self) -> String {
        let missing_part = if self.missing_fields.is_empty() {
            String::new()
        } else {
            format!("; missing: {}", self.missing_fields.join(", "))
        };
        format!(
            "{}: {}{}; recovery: {}",
            self.code, self.kind, missing_part, self.recovery_action
        )
    }
}

/// One domain's admission policy. Registered in [`ToolAdmissionRegistry`] by
/// assembly; implementations read session state only through
/// [`DomainStateReader`].
pub trait ToolAdmissionPolicy: Send + Sync {
    fn id(&self) -> &'static str;
    fn check(
        &self,
        request: &ToolAdmissionRequest<'_>,
        state: &dyn DomainStateReader,
    ) -> Result<(), ToolAdmissionRejection>;
}

/// Registry of admission policies consulted by every generic dispatch path.
/// Pure generic pipeline with no behavior: assembly fills it at construction
/// time and it is read-only afterwards.
#[derive(Clone, Default)]
pub struct ToolAdmissionRegistry {
    policies: Vec<Arc<dyn ToolAdmissionPolicy>>,
}

impl ToolAdmissionRegistry {
    pub fn register(&mut self, policy: Arc<dyn ToolAdmissionPolicy>) {
        self.policies.push(policy);
    }

    /// Check every policy in registration order, short-circuiting on the first
    /// rejection. Hot path: iterates the slice without cloning entries or
    /// building a snapshot.
    pub fn check_all(
        &self,
        request: &ToolAdmissionRequest<'_>,
        state: &dyn DomainStateReader,
    ) -> Result<(), ToolAdmissionRejection> {
        for policy in &self.policies {
            policy.check(request, state)?;
        }
        Ok(())
    }

    pub fn is_empty(&self) -> bool {
        self.policies.is_empty()
    }
}

impl std::fmt::Debug for ToolAdmissionRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolAdmissionRegistry")
            .field("policy_count", &self.policies.len())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    struct AllowPolicy;
    impl ToolAdmissionPolicy for AllowPolicy {
        fn id(&self) -> &'static str {
            "allow"
        }
        fn check(
            &self,
            _request: &ToolAdmissionRequest<'_>,
            _state: &dyn DomainStateReader,
        ) -> Result<(), ToolAdmissionRejection> {
            Ok(())
        }
    }

    #[derive(Debug)]
    struct RejectPolicy {
        missing: Vec<&'static str>,
    }
    impl ToolAdmissionPolicy for RejectPolicy {
        fn id(&self) -> &'static str {
            "reject"
        }
        fn check(
            &self,
            _request: &ToolAdmissionRequest<'_>,
            _state: &dyn DomainStateReader,
        ) -> Result<(), ToolAdmissionRejection> {
            Err(ToolAdmissionRejection {
                code: "test_rejected",
                kind: "input_required",
                missing_fields: self.missing.clone(),
                recovery_action: "provide the missing fields",
            })
        }
    }

    #[derive(Debug)]
    struct EmptyReader;
    impl DomainStateReader for EmptyReader {
        fn get(&self, _slot: &DomainStateSlot) -> Option<serde_json::Value> {
            None
        }
    }

    #[test]
    fn rejection_message_keeps_stable_shape() {
        let rejection = ToolAdmissionRejection {
            code: "qt_migration_input_required",
            kind: "input_required",
            missing_fields: vec!["source_project", "toolchain"],
            recovery_action: "answer the question card",
        };
        assert_eq!(
            rejection.to_message(),
            "qt_migration_input_required: input_required; missing: source_project, toolchain; recovery: answer the question card"
        );

        let no_missing = ToolAdmissionRejection {
            missing_fields: Vec::new(),
            ..rejection
        };
        assert_eq!(
            no_missing.to_message(),
            "qt_migration_input_required: input_required; recovery: answer the question card"
        );
    }

    #[test]
    fn check_all_short_circuits_in_registration_order() {
        let mut registry = ToolAdmissionRegistry::default();
        assert!(registry.is_empty());
        registry.register(Arc::new(RejectPolicy {
            missing: vec!["source_project"],
        }));
        registry.register(Arc::new(AllowPolicy));

        let request = ToolAdmissionRequest {
            tool_name: "Write",
            input: None,
            session_id: Some("session-1"),
        };
        let error = registry
            .check_all(&request, &EmptyReader)
            .expect_err("first rejection short-circuits the registry");
        assert_eq!(error.code, "test_rejected");
        assert_eq!(error.missing_fields, vec!["source_project"]);

        let mut allow_then_reject = ToolAdmissionRegistry::default();
        allow_then_reject.register(Arc::new(AllowPolicy));
        allow_then_reject.register(Arc::new(RejectPolicy {
            missing: vec!["toolchain"],
        }));
        let later_error = allow_then_reject
            .check_all(&request, &EmptyReader)
            .expect_err("a later policy's rejection still surfaces");
        assert_eq!(later_error.code, "test_rejected");
        assert_eq!(later_error.missing_fields, vec!["toolchain"]);
    }
}
