use std::sync::Mutex;

use rand::{Rng, SeedableRng};
use rand::rngs::{OsRng, SmallRng};
use tauri::Manager;
use serde::Serialize;
use tauri::State;

use crate::crypto::{derive_key, encrypt, decrypt, VaultKey};
use crate::db::{Db, Entry, NewEntry};
use crate::sync::{self, SyncConfig, SyncStatus};

// ── Application state ────────────────────────────────────────────────────────

pub struct VaultState {
    pub db: Option<Db>,
    pub key: Option<VaultKey>,
    /// Supabase JWT — in-memory only, never written to disk as plaintext.
    pub jwt: Option<String>,
    /// Supabase user UUID — needed to build Storage paths.
    pub user_id: Option<String>,
    /// Decrypted sync config — loaded from sync_config.enc on unlock.
    pub sync_config: Option<SyncConfig>,
}

pub type AppState = Mutex<VaultState>;

// ── Error type returned to the frontend ─────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AppError(String);

impl<E: std::fmt::Display> From<E> for AppError {
    fn from(e: E) -> Self {
        AppError(e.to_string())
    }
}

type Result<T> = std::result::Result<T, AppError>;

// ── Result types ─────────────────────────────────────────────────────────────

/// Summary returned to the frontend after a successful sync download.
#[derive(Debug, Serialize)]
pub struct DownloadResult {
    /// Entries that existed in the cloud but not locally — inserted.
    pub added: usize,
    /// Entries that exist in both but with differing content — flagged.
    pub conflicts: usize,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn app_data_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .map(|p| { let _ = std::fs::create_dir_all(&p); p })
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn db_path(app: &tauri::AppHandle) -> String {
    app_data_dir(app).join("vault.db").to_string_lossy().into_owned()
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Derive the vault key from `master_password`, open the DB, and keep both in
/// memory. The password is NOT stored anywhere — only the derived key lives in
/// `VaultState` and is zeroed when the vault locks or the app closes.
#[tauri::command]
pub fn unlock_vault(
    master_password: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    let mut s = state.lock().map_err(|e| AppError(e.to_string()))?;

    let db = Db::open(&db_path(&app))?;

    // Retrieve or generate the key-derivation salt stored in vault_meta.
    use base64::Engine as _;
    let salt_b64 = db.get_meta("kdf_salt").map_err(|e| AppError(e.to_string()))?;
    let salt: Vec<u8> = match salt_b64 {
        Some(b) => base64::engine::general_purpose::STANDARD.decode(b)?,
        None => {
            let mut salt = vec![0u8; 32];
            OsRng.fill(salt.as_mut_slice());
            let encoded = base64::engine::general_purpose::STANDARD.encode(&salt);
            db.set_meta("kdf_salt", &encoded)
                .map_err(|e| AppError(e.to_string()))?;
            salt
        }
    };

    let key = derive_key(&master_password, &salt)?;

    // On first unlock: store an encrypted sentinel so future unlocks can
    // verify the password is correct before accepting it.
    const SENTINEL: &[u8] = b"vault-ok";
    match db.get_meta("sentinel").map_err(|e| AppError(e.to_string()))? {
        None => {
            let blob = encrypt(&key, SENTINEL)?;
            db.set_meta("sentinel", &blob)
                .map_err(|e| AppError(e.to_string()))?;
        }
        Some(blob) => {
            let plain = decrypt(&key, &blob)
                .map_err(|_| AppError("Wrong master password".into()))?;
            if plain != SENTINEL {
                return Err(AppError("Wrong master password".into()));
            }
        }
    }

    // Try to load sync config if it exists (non-fatal — sync is optional).
    let dir = app_data_dir(&app);
    let sync_config = sync::load_sync_config(&dir, &key).ok();

    s.sync_config = sync_config;
    s.key = Some(key);
    s.db = Some(db);
    Ok(())
}

/// Remove the vault key and all sensitive state from memory (lock the vault).
#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>) -> Result<()> {
    let mut s = state.lock().map_err(|e| AppError(e.to_string()))?;
    s.key = None;
    s.db = None;
    s.jwt = None;
    s.user_id = None;
    s.sync_config = None;
    Ok(())
}

#[tauri::command]
pub fn get_entries(state: State<'_, AppState>) -> Result<Vec<Entry>> {
    let s = state.lock().map_err(|e| AppError(e.to_string()))?;
    let (db, key) = vault_open(&s)?;
    Ok(db.list_entries(key)?)
}

#[tauri::command]
pub fn create_entry(entry: NewEntry, state: State<'_, AppState>) -> Result<i64> {
    let s = state.lock().map_err(|e| AppError(e.to_string()))?;
    let (db, key) = vault_open(&s)?;
    Ok(db.create_entry(key, entry)?)
}

#[tauri::command]
pub fn update_entry(id: i64, entry: NewEntry, state: State<'_, AppState>) -> Result<()> {
    let s = state.lock().map_err(|e| AppError(e.to_string()))?;
    let (db, key) = vault_open(&s)?;
    Ok(db.update_entry(key, id, entry)?)
}

#[tauri::command]
pub fn delete_entry(id: i64, state: State<'_, AppState>) -> Result<()> {
    let s = state.lock().map_err(|e| AppError(e.to_string()))?;
    let (db, _key) = vault_open(&s)?;
    Ok(db.delete_entry(id).map_err(|e| AppError(e.to_string()))?)
}

/// Generate a cryptographically random password using `OsRng`.
#[tauri::command]
pub fn generate_password(length: usize, symbols: bool, numbers: bool) -> Result<String> {
    let mut charset: Vec<u8> = (b'a'..=b'z').chain(b'A'..=b'Z').collect();
    if numbers {
        charset.extend(b'0'..=b'9');
    }
    if symbols {
        charset.extend_from_slice(b"!@#$%^&*()-_=+[]{}|;:,.<>?");
    }

    if charset.is_empty() || length == 0 {
        return Err(AppError("Invalid parameters".into()));
    }

    // SmallRng seeded from OsRng for fast generation without blocking.
    let mut rng = SmallRng::from_rng(&mut OsRng).expect("OsRng seeding failed");
    let password: String = (0..length)
        .map(|_| charset[rng.gen_range(0..charset.len())] as char)
        .collect();

    Ok(password)
}

// ── Sync commands ─────────────────────────────────────────────────────────────
//
// Pattern for async commands with std::sync::Mutex:
//   1. Acquire lock → clone what we need → release lock.
//   2. Do async/CPU work with no lock held.
//   3. Acquire lock again to update state.

/// Save Supabase config (encrypted), authenticate, and keep JWT in memory.
/// On first run this registers the account; on subsequent runs it logs in.
#[tauri::command]
pub async fn sync_configure(
    url: String,
    anon_key: String,
    email: String,
    supabase_password: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    // Step 1 — grab key bytes while holding the lock.
    let key_bytes: [u8; 32] = {
        let s = state.lock().map_err(|e| AppError(e.to_string()))?;
        match &s.key {
            Some(k) => k.0,
            None => return Err(AppError("Vault is locked".into())),
        }
    };

    // Step 2 — try login first. If it fails, attempt signup and retry.
    let (jwt, user_id) =
        match sync::auth_login(&url, &anon_key, &email, &supabase_password).await {
            Ok(result) => result,
            Err(login_err) => {
                use sync::SignupResult;
                match sync::auth_signup(&url, &anon_key, &email, &supabase_password).await {
                    Ok(SignupResult::Created) | Ok(SignupResult::AlreadyExists) => {
                        sync::auth_login(&url, &anon_key, &email, &supabase_password)
                            .await
                            .map_err(|e| AppError(format!(
                                "Could not sign in: {e}\n\
                                 Original error: {login_err}"
                            )))?
                    }
                    Err(signup_err) => {
                        return Err(AppError(format!(
                            "Sign in failed: {login_err}\n\
                             Sign up also failed: {signup_err}"
                        )));
                    }
                }
            }
        };

    // Step 3 — persist config encrypted to disk.
    let config = SyncConfig {
        supabase_url: url.clone(),
        supabase_anon_key: anon_key.clone(),
        user_email: email.clone(),
        last_sync_timestamp: 0,
    };
    let temp_key = VaultKey(key_bytes);
    let dir = app_data_dir(&app);
    sync::save_sync_config(&dir, &temp_key, &config)?;

    // Step 4 — update in-memory state.
    let mut s = state.lock().map_err(|e| AppError(e.to_string()))?;
    s.jwt = Some(jwt);
    s.user_id = Some(user_id);
    s.sync_config = Some(config);
    Ok(())
}

/// Re-authenticate using the already-saved config (e.g. after app restart).
#[tauri::command]
pub async fn sync_login(
    supabase_password: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let (url, anon_key, email) = {
        let s = state.lock().map_err(|e| AppError(e.to_string()))?;
        let cfg = s.sync_config.as_ref().ok_or_else(|| AppError("Sync not configured".into()))?;
        (cfg.supabase_url.clone(), cfg.supabase_anon_key.clone(), cfg.user_email.clone())
    };

    let (jwt, user_id) =
        sync::auth_login(&url, &anon_key, &email, &supabase_password).await?;

    let mut s = state.lock().map_err(|e| AppError(e.to_string()))?;
    s.jwt = Some(jwt);
    s.user_id = Some(user_id);
    Ok(())
}

/// Clear the JWT from memory (does not remove the saved config).
#[tauri::command]
pub fn sync_logout(state: State<'_, AppState>) -> Result<()> {
    let mut s = state.lock().map_err(|e| AppError(e.to_string()))?;
    s.jwt = None;
    s.user_id = None;
    Ok(())
}

/// Serialize, encrypt, and upload the vault to Supabase Storage.
///
/// Upload format: `{kdf_salt_b64}:{aes_gcm_ciphertext_b64}`
/// The salt travels in plaintext so any device can derive the correct key.
///
/// Guard: if the local vault is empty AND a blob already exists in the cloud,
/// the upload is blocked to prevent accidentally overwriting cloud data.
#[tauri::command]
pub async fn sync_upload(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    // Step 1 — collect everything we need while holding the lock briefly.
    let (entries, key_bytes, salt_b64, url, anon_key, jwt, user_id) = {
        let s = state.lock().map_err(|e| AppError(e.to_string()))?;
        let (db, key) = vault_open(&s)?;
        let entries = db.list_entries(key)?;
        let salt_b64 = db.get_meta("kdf_salt")
            .map_err(|e| AppError(e.to_string()))?
            .ok_or_else(|| AppError("kdf_salt not found in DB — unlock vault first".into()))?;
        let cfg = s.sync_config.as_ref()
            .ok_or_else(|| AppError("Sync not configured".into()))?;
        let jwt = s.jwt.as_ref()
            .ok_or_else(|| AppError("Not authenticated — call sync_login first".into()))?;
        let uid = s.user_id.as_ref()
            .ok_or_else(|| AppError("Not authenticated".into()))?;
        (entries, key.0, salt_b64, cfg.supabase_url.clone(), cfg.supabase_anon_key.clone(),
         jwt.clone(), uid.clone())
    };

    // Guard: block uploading an empty vault over existing cloud data.
    if entries.is_empty() {
        let cloud_has_data = sync::check_vault_exists(&url, &anon_key, &jwt, &user_id)
            .await
            .unwrap_or(false);
        if cloud_has_data {
            return Err(AppError(
                "El vault local está vacío. Descarga primero para no perder los datos en la nube.".into()
            ));
        }
    }

    // Step 2 — serialize + encrypt (CPU, no lock needed).
    let json = sync::serialize_vault(&entries)?;
    let temp_key = VaultKey(key_bytes);
    let encrypted = encrypt(&temp_key, &json)?;

    // Prepend the salt so any device can derive the right key on download.
    // Format: "{salt_b64}:{cipher_b64}" — colon never appears in base64.
    let payload = format!("{salt_b64}:{encrypted}");

    // Step 3 — upload (async, no lock).
    sync::upload_vault(&url, &anon_key, &jwt, &user_id, payload.into_bytes()).await?;

    // Step 4 — update timestamp in memory and on disk.
    let now = sync::unix_now();
    let dir = app_data_dir(&app);
    let mut s = state.lock().map_err(|e| AppError(e.to_string()))?;
    let key_copy = s.key.as_ref().map(|k| k.0);
    if let Some(ref mut cfg) = s.sync_config {
        cfg.last_sync_timestamp = now;
        if let Some(kb) = key_copy {
            let _ = sync::save_sync_config(&dir, &VaultKey(kb), cfg);
        }
    }
    Ok(())
}

/// Download the encrypted vault from Supabase and merge it into the local DB.
///
/// Merge rules (additive — entries are never deleted automatically):
///   A. UUID not in local  → insert (new entry from another device)
///   B. UUID matches, content identical → skip
///   C. UUID matches, content differs → mark `conflict = true`, store cloud
///      snapshot in `conflict_data`; local version is preserved unchanged
///
/// The local `kdf_salt`, sentinel, and `VaultState::key` are never modified.
/// The temporary key derived from the cloud salt is zeroized immediately after
/// decryption (via `ZeroizeOnDrop`).
#[tauri::command]
pub async fn sync_download(
    master_password: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<DownloadResult> {
    use base64::Engine as _;

    // Step 1 — collect credentials (local salt is irrelevant here).
    let (url, anon_key, jwt, user_id) = {
        let s = state.lock().map_err(|e| AppError(e.to_string()))?;
        let _ = vault_open(&s)?; // verify vault is unlocked
        let cfg = s.sync_config.as_ref()
            .ok_or_else(|| AppError("Sync not configured".into()))?;
        let jwt = s.jwt.as_ref()
            .ok_or_else(|| AppError("Not authenticated — call sync_login first".into()))?;
        let uid = s.user_id.as_ref()
            .ok_or_else(|| AppError("Not authenticated".into()))?;
        (cfg.supabase_url.clone(), cfg.supabase_anon_key.clone(),
         jwt.clone(), uid.clone())
    };

    // Step 2 — download (async, no lock).
    let raw = sync::download_vault(&url, &anon_key, &jwt, &user_id).await?;

    // Step 3 — parse "{cloud_salt_b64}:{cipher_b64}" format.
    let payload_str = String::from_utf8(raw)
        .map_err(|_| AppError("Downloaded blob is not valid UTF-8".into()))?;
    let (cloud_salt_b64, cipher_b64) = payload_str
        .trim()
        .split_once(':')
        .ok_or_else(|| AppError(
            "Cloud vault uses an older format. Upload from your main device first, then download.".into()
        ))?;

    // Step 4 — derive a TEMPORARY key from the cloud salt + master password.
    let cloud_salt = base64::engine::general_purpose::STANDARD
        .decode(cloud_salt_b64)
        .map_err(|_| AppError("Invalid salt encoding in cloud vault".into()))?;

    let cloud_entries = {
        let temp_key = derive_key(&master_password, &cloud_salt)
            .map_err(|e| AppError(e.to_string()))?;
        let json = decrypt(&temp_key, cipher_b64)
            .map_err(|_| AppError(
                "Failed to decrypt vault — wrong master password for the downloaded vault.".into()
            ))?;
        // `temp_key` is dropped (and zeroized via ZeroizeOnDrop) here.
        sync::deserialize_vault(&json)?
    };

    // Guard: v1 blobs have no sync_id — merging them would create duplicates.
    if cloud_entries.iter().any(|e| e.sync_id.is_empty()) {
        return Err(AppError(
            "El vault en la nube usa un formato antiguo sin identificadores únicos. \
             Sube primero desde tu dispositivo principal para actualizarlo.".into()
        ));
    }

    // Step 5 — additive merge.
    let mut added = 0usize;
    let mut conflicts = 0usize;

    {
        let s = state.lock().map_err(|e| AppError(e.to_string()))?;
        let (db, local_key) = vault_open(&s)?;

        for cloud in &cloud_entries {
            match db.find_by_sync_id(local_key, &cloud.sync_id) {
                Err(e) => return Err(AppError(e.to_string())),

                // CASO A — new entry from cloud, insert locally.
                Ok(None) => {
                    db.insert_synced_entry(
                        local_key,
                        &cloud.sync_id,
                        &cloud.title,
                        &cloud.username,
                        &cloud.password,
                        cloud.url.as_deref(),
                        cloud.notes.as_deref(),
                    ).map_err(|e| AppError(e.to_string()))?;
                    added += 1;
                }

                Ok(Some(local)) => {
                    let same = local.title    == cloud.title
                        && local.username == cloud.username
                        && local.password == cloud.password
                        && local.url      == cloud.url
                        && local.notes    == cloud.notes;

                    if same {
                        // CASO B — identical, nothing to do.
                    } else {
                        // CASO C — conflict: preserve local, flag for resolution.
                        let snapshot = serde_json::json!({
                            "title":    cloud.title,
                            "username": cloud.username,
                            "password": cloud.password,
                            "url":      cloud.url,
                            "notes":    cloud.notes,
                        }).to_string();
                        db.mark_conflict(local.id, &snapshot)
                            .map_err(|e| AppError(e.to_string()))?;
                        conflicts += 1;
                    }
                }
            }
        }
    }

    // Step 6 — update last-sync timestamp.
    let now = sync::unix_now();
    let dir = app_data_dir(&app);
    let mut s = state.lock().map_err(|e| AppError(e.to_string()))?;
    let key_copy = s.key.as_ref().map(|k| k.0);
    if let Some(ref mut cfg) = s.sync_config {
        cfg.last_sync_timestamp = now;
        if let Some(kb) = key_copy {
            let _ = sync::save_sync_config(&dir, &VaultKey(kb), cfg);
        }
    }

    Ok(DownloadResult { added, conflicts })
}

/// Resolve a sync conflict on a given entry.
///
/// - `use_cloud = false` — keep the local version; clear the conflict flag.
/// - `use_cloud = true`  — overwrite the local entry with the cloud snapshot
///   stored in `conflict_data`, then clear the conflict flag.
#[tauri::command]
pub fn resolve_conflict(
    id: i64,
    use_cloud: bool,
    state: State<'_, AppState>,
) -> Result<()> {
    let s = state.lock().map_err(|e| AppError(e.to_string()))?;
    let (db, key) = vault_open(&s)?;

    if use_cloud {
        let entries = db.list_entries(key)?;
        let entry = entries.iter()
            .find(|e| e.id == id)
            .ok_or_else(|| AppError("Entry not found".into()))?;

        let cloud: serde_json::Value = serde_json::from_str(
            entry.conflict_data.as_deref().unwrap_or("{}")
        ).map_err(|e| AppError(e.to_string()))?;

        let cloud_entry = NewEntry {
            title:    cloud["title"].as_str().unwrap_or("").to_string(),
            username: cloud["username"].as_str().unwrap_or("").to_string(),
            password: cloud["password"].as_str().unwrap_or("").to_string(),
            url:      cloud["url"].as_str().map(|s| s.to_string()),
            notes:    cloud["notes"].as_str().map(|s| s.to_string()),
        };

        db.update_entry(key, id, cloud_entry)?;
    }

    db.clear_conflict(id).map_err(|e| AppError(e.to_string()))?;
    Ok(())
}

/// Return current sync status without mutating state.
#[tauri::command]
pub fn sync_get_status(state: State<'_, AppState>) -> Result<SyncStatus> {
    let s = state.lock().map_err(|e| AppError(e.to_string()))?;
    Ok(SyncStatus {
        is_configured:      s.sync_config.is_some(),
        is_authenticated:   s.jwt.is_some(),
        user_email:         s.sync_config.as_ref().map(|c| c.user_email.clone()),
        supabase_url_preview: s.sync_config.as_ref().map(|c| {
            let u = &c.supabase_url;
            if u.len() > 40 { format!("{}…", &u[..40]) } else { u.clone() }
        }),
        last_sync_timestamp: s.sync_config.as_ref()
            .map(|c| c.last_sync_timestamp)
            .unwrap_or(0),
    })
}

/// Remove the encrypted config file and clear all sync state from memory.
#[tauri::command]
pub fn sync_clear_config(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    let dir = app_data_dir(&app);
    sync::delete_sync_config(&dir)?;
    let mut s = state.lock().map_err(|e| AppError(e.to_string()))?;
    s.jwt = None;
    s.user_id = None;
    s.sync_config = None;
    Ok(())
}

/// Re-encrypt the entire vault with a new master password.
///
/// Flow: verify current password → generate new salt → derive new key →
/// re-encrypt all entries → update sentinel and kdf_salt → update sync config.
#[tauri::command]
pub fn change_master_password(
    current_password: String,
    new_password: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    use base64::Engine as _;

    let mut s = state.lock().map_err(|e| AppError(e.to_string()))?;

    // 1. Verify current password by re-deriving the key from it.
    //    This ensures the caller actually knows the current password,
    //    not just that the vault is already unlocked.
    {
        let (db, _) = vault_open(&s)?;
        let salt_b64 = db
            .get_meta("kdf_salt")
            .map_err(|e| AppError(e.to_string()))?
            .ok_or_else(|| AppError("kdf_salt not found".into()))?;
        let salt = base64::engine::general_purpose::STANDARD
            .decode(&salt_b64)?;
        let derived = derive_key(&current_password, &salt)?;
        let sentinel_blob = db
            .get_meta("sentinel")
            .map_err(|e| AppError(e.to_string()))?
            .ok_or_else(|| AppError("Sentinel not found — vault may be corrupted".into()))?;
        let plain = decrypt(&derived, &sentinel_blob)
            .map_err(|_| AppError("Wrong current password".into()))?;
        if plain != b"vault-ok" {
            return Err(AppError("Wrong current password".into()));
        }
    }

    // 2. Snapshot current key bytes so we can create a temp copy later.
    let current_key_bytes = s
        .key
        .as_ref()
        .ok_or_else(|| AppError("Vault is locked".into()))?
        .0;
    let sync_config = s.sync_config.clone();

    // 3. Generate a fresh salt and derive the new key.
    let mut new_salt = vec![0u8; 32];
    OsRng.fill(new_salt.as_mut_slice());
    let new_key = derive_key(&new_password, &new_salt)?;

    // 4. Re-encrypt all entries and update DB metadata.
    {
        let (db, _) = vault_open(&s)?;
        let temp_old = VaultKey(current_key_bytes);
        db.reencrypt_all(&temp_old, &new_key)?;

        let new_salt_b64 = base64::engine::general_purpose::STANDARD.encode(&new_salt);
        db.set_meta("kdf_salt", &new_salt_b64)
            .map_err(|e| AppError(e.to_string()))?;

        let new_sentinel = encrypt(&new_key, b"vault-ok")?;
        db.set_meta("sentinel", &new_sentinel)
            .map_err(|e| AppError(e.to_string()))?;
    }

    // 5. Re-encrypt sync config on disk with the new key.
    if let Some(ref cfg) = sync_config {
        let dir = app_data_dir(&app);
        sync::save_sync_config(&dir, &new_key, cfg)?;
    }

    // 6. Swap the in-memory key.
    s.key = Some(new_key);
    Ok(())
}

/// Show a native save-file dialog, then write the decrypted vault as JSON.
/// Returns the chosen path, or `null` if the user cancelled.
#[tauri::command]
pub async fn export_vault_to_file(
    default_filename: String,
    state: State<'_, AppState>,
) -> Result<Option<String>> {
    #[derive(serde::Serialize)]
    struct ExportEntry {
        title:    String,
        username: String,
        password: String,
        url:      Option<String>,
        notes:    Option<String>,
    }

    // Gather and serialize while holding the lock briefly.
    let json = {
        let s = state.lock().map_err(|e| AppError(e.to_string()))?;
        let (db, key) = vault_open(&s)?;
        let entries = db.list_entries(key)?;
        let export: Vec<ExportEntry> = entries
            .into_iter()
            .map(|e| ExportEntry {
                title:    e.title,
                username: e.username,
                password: e.password,
                url:      e.url,
                notes:    e.notes,
            })
            .collect();
        serde_json::to_string_pretty(&export)?
    };

    // Show native save dialog on a dedicated blocking thread.
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_file_name(&default_filename)
            .add_filter("JSON", &["json"])
            .save_file()
    })
    .await
    .map_err(|e| AppError(format!("Dialog error: {e}")))?;

    match chosen {
        None => Ok(None),
        Some(path) => {
            std::fs::write(&path, json.as_bytes())
                .map_err(|e| AppError(format!("Write error: {e}")))?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
    }
}

/// Decrypt and export all vault entries as a pretty-printed JSON string.
/// The caller is responsible for saving the string to a file.
#[tauri::command]
pub fn export_vault(state: State<'_, AppState>) -> Result<String> {
    #[derive(serde::Serialize)]
    struct ExportEntry {
        title: String,
        username: String,
        password: String,
        url: Option<String>,
        notes: Option<String>,
    }

    let s = state.lock().map_err(|e| AppError(e.to_string()))?;
    let (db, key) = vault_open(&s)?;
    let entries = db.list_entries(key)?;

    let export: Vec<ExportEntry> = entries
        .into_iter()
        .map(|e| ExportEntry {
            title:    e.title,
            username: e.username,
            password: e.password,
            url:      e.url,
            notes:    e.notes,
        })
        .collect();

    Ok(serde_json::to_string_pretty(&export)?)
}

/// Import entries from a JSON string (output of `export_vault`).
/// Each entry gets a fresh sync_id. Returns the count of imported entries.
#[tauri::command]
pub fn import_vault(json: String, state: State<'_, AppState>) -> Result<usize> {
    #[derive(serde::Deserialize)]
    struct ImportEntry {
        title: String,
        username: String,
        password: String,
        url: Option<String>,
        notes: Option<String>,
    }

    let items: Vec<ImportEntry> = serde_json::from_str(&json)
        .map_err(|e| AppError(format!("Invalid JSON: {e}")))?;

    let s = state.lock().map_err(|e| AppError(e.to_string()))?;
    let (db, key) = vault_open(&s)?;

    let mut imported = 0usize;
    for item in items {
        db.create_entry(key, NewEntry {
            title:    item.title,
            username: item.username,
            password: item.password,
            url:      item.url,
            notes:    item.notes,
        })?;
        imported += 1;
    }

    Ok(imported)
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn vault_open(s: &VaultState) -> Result<(&Db, &VaultKey)> {
    match (&s.db, &s.key) {
        (Some(db), Some(key)) => Ok((db, key)),
        _ => Err(AppError("Vault is locked".into())),
    }
}
