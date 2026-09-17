mod installer;
mod preview;

use installer::commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let preview_only = preview::is_enabled();
    let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
        commands::get_launch_context,
        commands::get_default_install_path,
        commands::get_initial_install_path,
        commands::get_existing_installation,
        commands::launch_registered_uninstaller,
        commands::get_disk_space,
        commands::validate_install_path,
        commands::start_installation,
        commands::set_model_config,
        commands::test_model_config_connection,
        commands::list_model_config_models,
        commands::set_theme_preference,
        commands::uninstall,
        commands::launch_application,
        commands::launch_legacy_data_migrator,
        commands::close_installer,
    ];
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(move |invoke| {
            if preview_only && !preview::allows_command(invoke.message.command()) {
                invoke
                    .resolver
                    .reject("Installer UI preview does not execute this operation.");
                return true;
            }
            handler(invoke)
        })
        .run(tauri::generate_context!())
        .expect("error while running BitFun Installer");
}
