/// Zero-knowledge sync module.
///
/// The server only ever receives AES-256-GCM encrypted blobs — it never sees
/// plaintext. All functions are pure (no Tauri state). Commands in
/// `commands.rs` extract the needed data from `VaultState`, release the lock,
/// then call these functions.
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::crypto::{decrypt, encrypt, VaultKey};
use crate::db::Entry;

// ── Public types ─────────────────────────────────────────────────────────────

/// Configuration stored encrypted on disk. Never persisted as plaintext.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    pub supabase_url: String,
    pub supabase_anon_key: String,
    pub user_email: String,
    /// Unix timestamp (seconds) of the last successful upload.
    pub last_sync_timestamp: i64,
}

/// Status returned to the frontend on every sync panel load.
#[derive(Debug, Serialize, Deserialize)]
pub struct SyncStatus {
    pub is_configured: bool,
    pub is_authenticated: bool,
    pub user_email: Option<String>,
    /// First 40 chars of the Supabase URL shown in the UI.
    pub supabase_url_preview: Option<String>,
    pub last_sync_timestamp: i64,
}

/// A vault entry as it travels in the encrypted sync blob (v2 format).
///
/// `#[serde(default)]` on `sync_id` and `updated_at` lets us gracefully
/// deserialize v1 blobs (which lacked these fields) — commands.rs then
/// detects the empty sync_id and returns an actionable error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudEntry {
    #[serde(default)]
    pub sync_id: String,
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: Option<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub updated_at: String,
}

// ── Internal types ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct AuthResponse {
    access_token: String,
    user: AuthUser,
}

#[derive(Deserialize)]
struct AuthUser {
    id: String,
}

/// The plaintext vault export format (encrypted before leaving the device).
#[derive(Serialize, Deserialize)]
struct VaultExport {
    version: u32,
    exported_at: i64,
    entries: Vec<CloudEntry>,
}

// ── Config persistence ────────────────────────────────────────────────────────

const CONFIG_FILE: &str = "sync_config.enc";
const BUCKET: &str = "vaults";

/// Encrypt `config` with the vault key and write to `<app_data_dir>/sync_config.enc`.
pub fn save_sync_config(
    app_data_dir: &Path,
    key: &VaultKey,
    config: &SyncConfig,
) -> Result<(), String> {
    let json = serde_json::to_vec(config).map_err(|e| e.to_string())?;
    let encrypted = encrypt(key, &json).map_err(|e| e.to_string())?;
    std::fs::write(app_data_dir.join(CONFIG_FILE), encrypted.as_bytes())
        .map_err(|e| format!("Failed to write sync config: {e}"))?;
    Ok(())
}

/// Read and decrypt `sync_config.enc`. Returns a descriptive error if the
/// file is absent (sync not configured) or the key doesn't match.
pub fn load_sync_config(app_data_dir: &Path, key: &VaultKey) -> Result<SyncConfig, String> {
    let path = app_data_dir.join(CONFIG_FILE);
    if !path.exists() {
        return Err("Sync not configured".into());
    }
    let b64 = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read sync config: {e}"))?;
    let json = decrypt(key, b64.trim())
        .map_err(|_| "Failed to decrypt sync config (wrong vault key?)".to_string())?;
    serde_json::from_slice(&json).map_err(|e| e.to_string())
}

/// Remove the encrypted config file from disk.
pub fn delete_sync_config(app_data_dir: &Path) -> Result<(), String> {
    let path = app_data_dir.join(CONFIG_FILE);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete sync config: {e}"))?;
    }
    Ok(())
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/// Authenticate with Supabase Auth (password grant).
/// Returns `(access_token, user_id)`.
pub async fn auth_login(
    url: &str,
    anon_key: &str,
    email: &str,
    password: &str,
) -> Result<(String, String), String> {
    let endpoint = format!(
        "{}/auth/v1/token?grant_type=password",
        url.trim_end_matches('/')
    );

    let resp = reqwest::Client::new()
        .post(&endpoint)
        .header("apikey", anon_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "email": email, "password": password }))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    if resp.status().is_success() {
        let auth: AuthResponse = resp.json().await.map_err(|e| e.to_string())?;
        Ok((auth.access_token, auth.user.id))
    } else {
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let msg = body
            .get("error_description")
            .or_else(|| body.get("msg"))
            .or_else(|| body.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        Err(format!("Login failed: {msg}"))
    }
}

/// Possible outcomes of a signup attempt.
pub enum SignupResult {
    /// Account created successfully.
    Created,
    /// Email already registered — caller should try login directly.
    AlreadyExists,
}

/// Create a new Supabase Auth account.
pub async fn auth_signup(
    url: &str,
    anon_key: &str,
    email: &str,
    password: &str,
) -> Result<SignupResult, String> {
    let endpoint = format!("{}/auth/v1/signup", url.trim_end_matches('/'));

    let resp = reqwest::Client::new()
        .post(&endpoint)
        .header("apikey", anon_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "email": email, "password": password }))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = resp.status();

    if status.is_success() {
        return Ok(SignupResult::Created);
    }

    let body: serde_json::Value = resp.json().await.unwrap_or_default();

    let msg = body.get("msg")
        .or_else(|| body.get("message"))
        .or_else(|| body.get("error_description"))
        .or_else(|| body.get("error"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let error_code = body.get("error_code")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let already_exists =
        error_code.contains("exist") ||
        msg.to_lowercase().contains("already") ||
        msg.to_lowercase().contains("registered") ||
        body.get("code").and_then(|v| v.as_u64()) == Some(422);

    if already_exists {
        return Ok(SignupResult::AlreadyExists);
    }

    let display = if msg.is_empty() {
        format!("HTTP {}", status.as_u16())
    } else {
        msg.to_string()
    };
    Err(format!("Signup failed: {display}"))
}

// ── Storage ───────────────────────────────────────────────────────────────────

/// Upload `data` bytes to `{bucket}/{user_id}/vault.blob` (upsert).
/// `data` must already be an encrypted blob — this function is zero-knowledge.
pub async fn upload_vault(
    url: &str,
    anon_key: &str,
    jwt: &str,
    user_id: &str,
    data: Vec<u8>,
) -> Result<(), String> {
    let endpoint = format!(
        "{}/storage/v1/object/{BUCKET}/{user_id}/vault.blob",
        url.trim_end_matches('/')
    );

    let resp = reqwest::Client::new()
        .put(&endpoint)
        .header("apikey", anon_key)
        .header("Authorization", format!("Bearer {jwt}"))
        .header("Content-Type", "application/octet-stream")
        .header("x-upsert", "true")
        .body(data)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status().as_u16();
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let msg = body
            .get("error")
            .or_else(|| body.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");

        let hint = if status == 400 && msg.contains("Bucket not found") {
            " — Create a private bucket named 'vaults' in your Supabase project."
        } else {
            ""
        };
        Err(format!("Upload failed ({status}): {msg}{hint}"))
    }
}

/// Download the raw encrypted bytes from `{bucket}/{user_id}/vault.blob`.
pub async fn download_vault(
    url: &str,
    anon_key: &str,
    jwt: &str,
    user_id: &str,
) -> Result<Vec<u8>, String> {
    let endpoint = format!(
        "{}/storage/v1/object/authenticated/{BUCKET}/{user_id}/vault.blob",
        url.trim_end_matches('/')
    );

    let resp = reqwest::Client::new()
        .get(&endpoint)
        .header("apikey", anon_key)
        .header("Authorization", format!("Bearer {jwt}"))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    match resp.status().as_u16() {
        200 => resp
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| e.to_string()),
        404 => Err("No vault found in cloud. Upload your vault first.".into()),
        s => Err(format!("Download failed ({s})")),
    }
}

/// Check whether a vault blob already exists for `user_id` without
/// downloading it. Returns `Ok(false)` on 404, `Ok(true)` on 200, and
/// `Err` for unexpected network errors.
pub async fn check_vault_exists(
    url: &str,
    anon_key: &str,
    jwt: &str,
    user_id: &str,
) -> Result<bool, String> {
    match download_vault(url, anon_key, jwt, user_id).await {
        Ok(_) => Ok(true),
        Err(e) if e.contains("No vault found") => Ok(false),
        Err(e) => Err(e),
    }
}

// ── Vault serialization ───────────────────────────────────────────────────────

/// Serialize all vault entries to JSON bytes (plaintext, v2 format with UUIDs).
/// The caller must encrypt this before sending anywhere.
pub fn serialize_vault(entries: &[Entry]) -> Result<Vec<u8>, String> {
    let export = VaultExport {
        version: 2,
        exported_at: unix_now(),
        entries: entries
            .iter()
            .map(|e| CloudEntry {
                sync_id:    e.sync_id.clone(),
                title:      e.title.clone(),
                username:   e.username.clone(),
                password:   e.password.clone(),
                url:        e.url.clone(),
                notes:      e.notes.clone(),
                updated_at: e.updated_at.clone(),
            })
            .collect(),
    };
    serde_json::to_vec(&export).map_err(|e| e.to_string())
}

/// Deserialize vault JSON bytes into a list of `CloudEntry` values ready for
/// the merge algorithm. Passwords are plaintext here — re-encrypted by the
/// caller once they reach the local DB.
pub fn deserialize_vault(data: &[u8]) -> Result<Vec<CloudEntry>, String> {
    let export: VaultExport =
        serde_json::from_slice(data).map_err(|e| format!("Invalid vault format: {e}"))?;
    Ok(export.entries)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
