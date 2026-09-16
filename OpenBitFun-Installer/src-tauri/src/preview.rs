//! Native UI preview: only audited, read-only installer commands can run.

pub(crate) fn is_enabled() -> bool {
    std::env::args_os().any(|argument| argument == "--preview")
}

pub(crate) fn allows_command(command: &str) -> bool {
    matches!(
        command,
        "get_launch_context"
            | "get_default_install_path"
            | "get_existing_installation"
            | "get_disk_space"
            | "close_installer"
    )
}

#[cfg(test)]
mod tests {
    use super::allows_command;

    #[test]
    fn preview_rejects_writes_process_launches_network_and_unknown_commands() {
        for command in [
            "get_initial_install_path",
            "validate_install_path",
            "start_installation",
            "uninstall",
            "launch_registered_uninstaller",
            "launch_application",
            "launch_legacy_data_migrator",
            "set_model_config",
            "set_theme_preference",
            "test_model_config_connection",
            "list_model_config_models",
            "future_command",
        ] {
            assert!(!allows_command(command), "preview allowed {command}");
        }
    }

    #[test]
    fn preview_allows_read_only_data_and_window_close() {
        for command in [
            "get_launch_context",
            "get_default_install_path",
            "get_existing_installation",
            "get_disk_space",
            "close_installer",
        ] {
            assert!(allows_command(command), "preview rejected {command}");
        }
    }
}
