pub mod commands;
pub mod crypto;
pub mod db;
pub mod sync;

use commands::{AppState, VaultState};
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(VaultState {
            db: None,
            key: None,
            jwt: None,
            user_id: None,
            sync_config: None,
        }) as AppState)
        .invoke_handler(tauri::generate_handler![
            // Vault core
            commands::unlock_vault,
            commands::lock_vault,
            commands::get_entries,
            commands::create_entry,
            commands::update_entry,
            commands::delete_entry,
            commands::generate_password,
            // Sync
            commands::sync_configure,
            commands::sync_login,
            commands::sync_logout,
            commands::sync_upload,
            commands::sync_download,
            commands::sync_get_status,
            commands::sync_clear_config,
            commands::resolve_conflict,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
