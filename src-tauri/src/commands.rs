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
    // Signup returning AlreadyExists is treated the same as Created —
    // in both cases we fall through to a second login attempt.
    let (jwt, user_id) =
        match sync::auth_login(&url, &anon_key, &email, &supabase_password).await {
            Ok(result) => result,
            Err(login_err) => {
                use sync::SignupResult;
                match sync::auth_signup(&url, &anon_key, &email, &supabase_password).await {
                    Ok(SignupResult::Created) | Ok(SignupResult::AlreadyExists) => {
                        // Account exists or was just created — retry login.
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
#[tauri::command]
pub async fn sync_upload(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    // Step 1 — collect everything we need while holding the lock briefly.
    let (entries, key_bytes, url, anon_key, jwt, user_id) = {
        let s = state.lock().map_err(|e| AppError(e.to_string()))?;
        let (db, key) = vault_open(&s)?;
        let entries = db.list_entries(key)?;
        let cfg = s.sync_config.as_ref()
            .ok_or_else(|| AppError("Sync not configured".into()))?;
        let jwt = s.jwt.as_ref()
            .ok_or_else(|| AppError("Not authenticated — call sync_login first".into()))?;
        let uid = s.user_id.as_ref()
            .ok_or_else(|| AppError("Not authenticated".into()))?;
        (entries, key.0, cfg.supabase_url.clone(), cfg.supabase_anon_key.clone(),
         jwt.clone(), uid.clone())
    };

    // Step 2 — serialize + encrypt (CPU, no lock needed).
    let json = sync::serialize_vault(&entries)?;
    let temp_key = VaultKey(key_bytes);
    let encrypted = encrypt(&temp_key, &json)?;

    // Step 3 — upload (async, no lock).
    sync::upload_vault(&url, &anon_key, &jwt, &user_id, encrypted.into_bytes()).await?;

    // Step 4 — update timestamp in memory and on disk.
    let now = sync::unix_now();
    let dir = app_data_dir(&app);
    let mut s = state.lock().map_err(|e| AppError(e.to_string()))?;
    // Extract key bytes before the mutable borrow of sync_config.
    let key_copy = s.key.as_ref().map(|k| k.0);
    if let Some(ref mut cfg) = s.sync_config {
        cfg.last_sync_timestamp = now;
        if let Some(kb) = key_copy {
            let _ = sync::save_sync_config(&dir, &VaultKey(kb), cfg);
        }
    }
    Ok(())
}

/// Download the encrypted vault from Supabase, decrypt it, and replace
/// all local entries. Last-write-wins — no merge.
#[tauri::command]
pub async fn sync_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    // Step 1 — collect credentials.
    let (key_bytes, url, anon_key, jwt, user_id) = {
        let s = state.lock().map_err(|e| AppError(e.to_string()))?;
        let key = s.key.as_ref().ok_or_else(|| AppError("Vault is locked".into()))?;
        let cfg = s.sync_config.as_ref()
            .ok_or_else(|| AppError("Sync not configured".into()))?;
        let jwt = s.jwt.as_ref()
            .ok_or_else(|| AppError("Not authenticated — call sync_login first".into()))?;
        let uid = s.user_id.as_ref()
            .ok_or_else(|| AppError("Not authenticated".into()))?;
        (key.0, cfg.supabase_url.clone(), cfg.supabase_anon_key.clone(),
         jwt.clone(), uid.clone())
    };

    // Step 2 — download (async, no lock).
    let raw = sync::download_vault(&url, &anon_key, &jwt, &user_id).await?;

    // Step 3 — decrypt + deserialize (CPU, no lock).
    let temp_key = VaultKey(key_bytes);
    let b64 = String::from_utf8(raw)
        .map_err(|_| AppError("Downloaded blob is not valid UTF-8".into()))?;
    let json = decrypt(&temp_key, b64.trim())
        .map_err(|_| AppError("Failed to decrypt downloaded vault — wrong master password?".into()))?;
    let new_entries = sync::deserialize_vault(&json)?;

    // Step 4 — replace local entries (acquire lock once more).
    let dir = app_data_dir(&app);
    let now = sync::unix_now();
    {
        // Scope so the immutable borrows through vault_open are dropped
        // before we need to mutably borrow s.sync_config below.
        let s = state.lock().map_err(|e| AppError(e.to_string()))?;
        let (db, key) = vault_open(&s)?;

        for entry in db.list_entries(key)? {
            db.delete_entry(entry.id)
                .map_err(|e| AppError(e.to_string()))?;
        }
        for entry in new_entries {
            db.create_entry(key, entry)?;
        }
    }
    // Update timestamp in a second lock acquisition.
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

// ── Private helpers ───────────────────────────────────────────────────────────

fn vault_open(s: &VaultState) -> Result<(&Db, &VaultKey)> {
    match (&s.db, &s.key) {
        (Some(db), Some(key)) => Ok((db, key)),
        _ => Err(AppError("Vault is locked".into())),
    }
}
