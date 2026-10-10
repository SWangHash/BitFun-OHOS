//! Agent-scoped "devecocli-only" command guard.
//!
//! Harmony Spec Verify and Harmony Goal are intentionally restricted
//! subagents: they must not run arbitrary shell, because their role is to
//! build, statically check, and search documentation without being able to
//! edit files or run unrelated commands.
//!
//! After `build_project` and `arkts_knowledge_search` collapse into the
//! devecocli CLI, those agents still need to build and to search docs. They
//! receive `ExecCommand`, gated to a single `devecocli` invocation.
//!
//! This is a deterministic preflight, not a permission rule: ExecCommand's
//! `bash` permission resource is the cwd-wrapped command text
//! (`cd `'<workdir>'` && <cmd>`), and the interactive rule set matches an
//! `Allow` only on an exact string, so a `devecocli *` allow rule cannot be
//! expressed. The guard runs during `validate_input`, before any permission
//! prompt or execution, and regardless of the resolved permission policy.

/// Subagents whose `ExecCommand` is restricted to a single `devecocli`
/// command. Keep this list in sync with the agent definitions that grant
/// `ExecCommand` while denying arbitrary shell.
const RESTRICTED_AGENTS: &[&str] = &["HarmonySpecVerify", "HarmonyGoal"];

/// The `devecocli` executable name. A bare name or any path ending in this
/// basename is accepted so a full install path still matches.
const DEVECOCLI_BIN: &str = "devecocli";

/// Shell metacharacters that would let a `devecocli ...` prefix escape the
/// guard (chaining, pipelines, substitution, redirection, grouping).
const SHELL_METACHARACTERS: &[char] = &[
    ';', '\n', '\r', '|', '&', '`', '$', '>', '<', '(', ')', '{', '}',
];

/// Whether the agent is one of the restricted subagents.
pub(crate) fn is_restricted_devecocli_agent(agent_type: Option<&str>) -> bool {
    agent_type
        .map(str::trim)
        .is_some_and(|agent| RESTRICTED_AGENTS.contains(&agent))
}

/// Returns a rejection message when a restricted agent runs a command that is
/// not a single `devecocli` invocation. Returns `None` when the command is
/// allowed (or the agent is unrestricted).
pub(crate) fn check_devecocli_only_command(
    agent_type: Option<&str>,
    command: &str,
) -> Option<String> {
    if !is_restricted_devecocli_agent(agent_type) {
        return None;
    }
    if is_single_devecocli_command(command) {
        return None;
    }
    Some(format!(
        "This subagent is restricted to the devecocli CLI; only a single `devecocli` \
         command is allowed. Rejected command: `{}`. Use `devecocli build` to build, \
         `devecocli check` / the arkts_check tool to statically check, and \
         `devecocli docs search` to search HarmonyOS documentation.",
        command.trim()
    ))
}

/// Whether the command is one shell statement whose program is `devecocli`.
fn is_single_devecocli_command(command: &str) -> bool {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.contains(SHELL_METACHARACTERS) {
        return false;
    }
    let Some(first) = trimmed.split_whitespace().next() else {
        return false;
    };
    program_basename(first) == DEVECOCLI_BIN
}

/// The program basename of the first token, accepting either path separator.
fn program_basename(token: &str) -> &str {
    token
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(token)
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd")
}

#[cfg(test)]
mod tests {
    use super::{check_devecocli_only_command, is_restricted_devecocli_agent, RESTRICTED_AGENTS};

    #[test]
    fn restricted_agents_are_exactly_verify_and_goal() {
        assert_eq!(RESTRICTED_AGENTS, ["HarmonySpecVerify", "HarmonyGoal"]);
        assert!(is_restricted_devecocli_agent(Some("HarmonySpecVerify")));
        assert!(is_restricted_devecocli_agent(Some(" HarmonyGoal ")));
        assert!(!is_restricted_devecocli_agent(Some("HarmonyBuild")));
        assert!(!is_restricted_devecocli_agent(None));
    }

    #[test]
    fn unrestricted_agents_are_never_blocked() {
        assert!(check_devecocli_only_command(Some("HarmonyBuild"), "rm -rf /").is_none());
        assert!(check_devecocli_only_command(None, "rm -rf /").is_none());
    }

    #[test]
    fn restricted_agents_may_run_a_single_devecocli_command() {
        for command in [
            "devecocli build",
            "devecocli build --build-mode release",
            "devecocli docs search State decorator",
            "devecocli check lint",
            "/usr/local/bin/devecocli build",
            "C:\\tools\\devecocli build",
            "devecocli.exe build",
        ] {
            assert!(
                check_devecocli_only_command(Some("HarmonySpecVerify"), command).is_none(),
                "expected allowed: {command}"
            );
        }
    }

    #[test]
    fn restricted_agents_may_not_run_other_programs() {
        for command in [
            "rm -rf /",
            "hvigorw assembleHap",
            "cd sub && devecocli build",
        ] {
            assert!(
                check_devecocli_only_command(Some("HarmonyGoal"), command).is_some(),
                "expected rejected: {command}"
            );
        }
    }

    #[test]
    fn restricted_agents_may_not_chain_shell_metacharacters() {
        for command in [
            "devecocli build; rm -rf /",
            "devecocli build && curl example.com",
            "devecocli build | tee out",
            "devecocli $(whoami)",
            "devecocli build > /etc/passwd",
            "devecocli build `id`",
            "devecocli build\nrm -rf /",
        ] {
            assert!(
                check_devecocli_only_command(Some("HarmonySpecVerify"), command).is_some(),
                "expected rejected: {command}"
            );
        }
    }

    #[test]
    fn empty_command_is_rejected() {
        assert!(check_devecocli_only_command(Some("HarmonyGoal"), "   ").is_some());
    }
}
