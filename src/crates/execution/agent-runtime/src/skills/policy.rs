use super::catalog::{builtin_skill_spec, BuiltinSkillGroup, BuiltinSkillSpec};
use crate::agents::{resolve_mode_config_profile_id, SHARED_CODING_MODE_CONFIG_PROFILE_ID};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SkillModeId {
    CodingShared,
    Cowork,
    Team,
    Claw,
    ComputerUse,
    DeepResearch,
    QtMigration,
    HarmonyBuild,
    Other,
}

impl SkillModeId {
    fn parse(mode_id: &str) -> Self {
        match mode_id.trim() {
            SHARED_CODING_MODE_CONFIG_PROFILE_ID => Self::CodingShared,
            "Cowork" => Self::Cowork,
            "Team" => Self::Team,
            "Claw" => Self::Claw,
            "ComputerUse" => Self::ComputerUse,
            "DeepResearch" => Self::DeepResearch,
            "QtMigration" => Self::QtMigration,
            "HarmonyBuild"
            | "HarmonyPlan"
            | "HarmonyGoal"
            | "HarmonySpecImplementation"
            | "HarmonySpecVerify" => Self::HarmonyBuild,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PolicyEffect {
    Enable,
    Disable,
}

impl PolicyEffect {
    fn is_enabled(self) -> bool {
        matches!(self, Self::Enable)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SkillSelector {
    Group(BuiltinSkillGroup),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SkillPolicyRule {
    selector: SkillSelector,
    effect: PolicyEffect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ModeSkillPolicy {
    builtin_default: PolicyEffect,
    rules: &'static [SkillPolicyRule],
}

const DISABLE_OFFICE: SkillPolicyRule = SkillPolicyRule {
    selector: SkillSelector::Group(BuiltinSkillGroup::Office),
    effect: PolicyEffect::Disable,
};

const DISABLE_GSTACK: SkillPolicyRule = SkillPolicyRule {
    selector: SkillSelector::Group(BuiltinSkillGroup::Gstack),
    effect: PolicyEffect::Disable,
};

const DISABLE_MINIAPP: SkillPolicyRule = SkillPolicyRule {
    selector: SkillSelector::Group(BuiltinSkillGroup::MiniApp),
    effect: PolicyEffect::Disable,
};

// ControlHub's browser domain is the single default browser-automation path.
// The computer-use skill group (agent-browser) stays opt-in in every mode so the
// model never sees two parallel browser stacks; users can still enable it via
// mode skill overrides or invoke it explicitly.
const DISABLE_COMPUTER_USE: SkillPolicyRule = SkillPolicyRule {
    selector: SkillSelector::Group(BuiltinSkillGroup::ComputerUse),
    effect: PolicyEffect::Disable,
};

const ENABLE_OFFICE: SkillPolicyRule = SkillPolicyRule {
    selector: SkillSelector::Group(BuiltinSkillGroup::Office),
    effect: PolicyEffect::Enable,
};

const ENABLE_META: SkillPolicyRule = SkillPolicyRule {
    selector: SkillSelector::Group(BuiltinSkillGroup::Meta),
    effect: PolicyEffect::Enable,
};

const OPEN_META_ONLY_POLICY: ModeSkillPolicy = ModeSkillPolicy {
    builtin_default: PolicyEffect::Disable,
    rules: &[ENABLE_META],
};

const ENABLE_HARMONYOS: SkillPolicyRule = SkillPolicyRule {
    selector: SkillSelector::Group(BuiltinSkillGroup::HarmonyOS),
    effect: PolicyEffect::Enable,
};

/// QtMigration mode enables the managed HarmonyOS built-in skills (incl.
/// `ohos-qt-skills`) so the Skill tool can actually load them; other built-in
/// groups stay disabled by default.
const QT_MIGRATION_POLICY: ModeSkillPolicy = ModeSkillPolicy {
    builtin_default: PolicyEffect::Disable,
    rules: &[ENABLE_META, ENABLE_HARMONYOS],
};

const AGENTIC_POLICY: ModeSkillPolicy = ModeSkillPolicy {
    builtin_default: PolicyEffect::Enable,
    rules: &[DISABLE_OFFICE, DISABLE_GSTACK, DISABLE_COMPUTER_USE],
};

/// HarmonyBuild mode (and its Harmony sub-agents) enable the HarmonyOS built-in
/// skill group so the Skill tool can load `arkts-grammar-standards`,
/// `deveco-cli`, `ohos-qt-skills`, etc. Office, Gstack, and Computer Use stay
/// disabled to keep the industry agent focused on HarmonyOS workflows.
const HARMONY_BUILD_POLICY: ModeSkillPolicy = ModeSkillPolicy {
    builtin_default: PolicyEffect::Enable,
    rules: &[DISABLE_OFFICE, DISABLE_GSTACK, DISABLE_COMPUTER_USE],
};

const COWORK_POLICY: ModeSkillPolicy = ModeSkillPolicy {
    builtin_default: PolicyEffect::Disable,
    rules: &[ENABLE_OFFICE, ENABLE_META],
};

const TEAM_POLICY: ModeSkillPolicy = ModeSkillPolicy {
    builtin_default: PolicyEffect::Enable,
    rules: &[DISABLE_OFFICE, DISABLE_MINIAPP, DISABLE_COMPUTER_USE],
};

fn policy_for_mode(mode_id: &str) -> ModeSkillPolicy {
    let policy_scope = resolve_mode_config_profile_id(mode_id);
    match SkillModeId::parse(policy_scope.as_ref()) {
        SkillModeId::CodingShared | SkillModeId::Claw => AGENTIC_POLICY,
        SkillModeId::Cowork => COWORK_POLICY,
        SkillModeId::Team => TEAM_POLICY,
        SkillModeId::QtMigration => QT_MIGRATION_POLICY,
        SkillModeId::HarmonyBuild => HARMONY_BUILD_POLICY,
        SkillModeId::ComputerUse | SkillModeId::DeepResearch | SkillModeId::Other => {
            OPEN_META_ONLY_POLICY
        }
    }
}

fn selector_matches(selector: SkillSelector, spec: &BuiltinSkillSpec) -> bool {
    match selector {
        SkillSelector::Group(group) => spec.group == group,
    }
}

fn resolve_builtin_default_effect(spec: &BuiltinSkillSpec, mode_id: &str) -> PolicyEffect {
    let policy = policy_for_mode(mode_id);
    let mut current = policy.builtin_default;

    for rule in policy.rules {
        if selector_matches(rule.selector, spec) {
            current = rule.effect;
        }
    }

    current
}

pub fn resolve_builtin_default_enabled(dir_name: &str, mode_id: &str) -> Option<bool> {
    builtin_skill_spec(dir_name)
        .map(|spec| resolve_builtin_default_effect(spec, mode_id).is_enabled())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::SHARED_CODING_MODE_IDS;
    use crate::skills::catalog::BUILTIN_SKILL_SPECS;

    #[test]
    fn agent_browser_defaults_off_in_every_mode() {
        for mode_id in [
            "agentic",
            "Plan",
            "debug",
            "Multitask",
            "coding_shared",
            "Claw",
            "Cowork",
            "Team",
            "ComputerUse",
            "DeepResearch",
            "HarmonyBuild",
            "HarmonyPlan",
            "HarmonyGoal",
            "HarmonySpecImplementation",
            "HarmonySpecVerify",
            "SomeUnknownMode",
        ] {
            assert_eq!(
                resolve_builtin_default_enabled("agent-browser", mode_id),
                Some(false),
                "agent-browser must stay opt-in for mode {mode_id}: ControlHub's browser domain is the default browser path"
            );
        }
    }

    #[test]
    fn qt_migration_mode_enables_harmonyos_builtin_skills() {
        // QtMigration must allow the managed ohos-qt-skills (HarmonyOS group)
        // so the Skill tool can load it; otherwise the gate would permanently
        // block because the skill policy rejects the call.
        assert_eq!(
            resolve_builtin_default_enabled("ohos-qt-skills", "QtMigration"),
            Some(true),
            "ohos-qt-skills must be enabled in QtMigration mode"
        );
        // Other HarmonyOS built-in skills are also enabled.
        assert_eq!(
            resolve_builtin_default_enabled("arkts-runtime-fix", "QtMigration"),
            Some(true)
        );
        // Non-HarmonyOS built-in skills stay disabled by default.
        assert_eq!(
            resolve_builtin_default_enabled("agent-browser", "QtMigration"),
            Some(false),
            "agent-browser must stay opt-in in QtMigration mode"
        );
    }

    #[test]
    fn shared_coding_modes_use_identical_builtin_skill_defaults() {
        for spec in BUILTIN_SKILL_SPECS {
            let expected = resolve_builtin_default_enabled(spec.dir_name, "agentic");
            for mode_id in SHARED_CODING_MODE_IDS {
                assert_eq!(
                    resolve_builtin_default_enabled(spec.dir_name, mode_id),
                    expected,
                    "builtin skill {} differs for shared coding mode {}",
                    spec.dir_name,
                    mode_id
                );
            }
        }
    }

    #[test]
    fn harmony_build_mode_enables_harmonyos_builtin_skills() {
        // HarmonyBuild must enable the HarmonyOS skill group so the Skill tool
        // can load arkts-grammar-standards, deveco-cli, ohos-qt-skills, etc.
        assert_eq!(
            resolve_builtin_default_enabled("arkts-grammar-standards", "HarmonyBuild"),
            Some(true),
            "arkts-grammar-standards must be enabled in HarmonyBuild mode"
        );
        assert_eq!(
            resolve_builtin_default_enabled("deveco-cli", "HarmonyBuild"),
            Some(true),
            "deveco-cli must be enabled in HarmonyBuild mode"
        );
        assert_eq!(
            resolve_builtin_default_enabled("ohos-qt-skills", "HarmonyBuild"),
            Some(true),
            "ohos-qt-skills must be enabled in HarmonyBuild mode"
        );
        assert_eq!(
            resolve_builtin_default_enabled("arkts-error-fixes", "HarmonyBuild"),
            Some(true),
            "arkts-error-fixes must be enabled in HarmonyBuild mode"
        );
        // Non-HarmonyOS groups stay disabled by default (Office, Gstack, ComputerUse).
        assert_eq!(
            resolve_builtin_default_enabled("ppt-design", "HarmonyBuild"),
            Some(false),
            "Office skills must stay disabled in HarmonyBuild mode"
        );
        assert_eq!(
            resolve_builtin_default_enabled("gstack-review", "HarmonyBuild"),
            Some(false),
            "Gstack skills must stay disabled in HarmonyBuild mode"
        );
    }

    #[test]
    fn harmony_subagents_inherit_harmony_build_skill_policy() {
        // All Harmony sub-agents must share the same HarmonyOS skill defaults
        // as HarmonyBuild so the Skill tool works consistently across the
        // Harmony agent family.
        let harmony_agent_ids = [
            "HarmonyPlan",
            "HarmonyGoal",
            "HarmonySpecImplementation",
            "HarmonySpecVerify",
        ];
        for spec in BUILTIN_SKILL_SPECS {
            let expected = resolve_builtin_default_enabled(spec.dir_name, "HarmonyBuild");
            for mode_id in harmony_agent_ids {
                assert_eq!(
                    resolve_builtin_default_enabled(spec.dir_name, mode_id),
                    expected,
                    "builtin skill {} differs for Harmony sub-agent {} (must match HarmonyBuild)",
                    spec.dir_name,
                    mode_id
                );
            }
        }
    }
}
