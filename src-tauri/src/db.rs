use rand::{Rng, rngs::OsRng};
use rusqlite::{Connection, Result as SqlResult, params};
use serde::{Deserialize, Serialize};

use crate::crypto::{decrypt, encrypt, VaultKey};

pub struct Db {
    conn: Connection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: i64,
    /// UUID v4 — stable cross-device identity, never changes after creation.
    pub sync_id: String,
    pub title: String,
    pub username: String,
    pub password: String, // plaintext in memory, never written to disk
    pub url: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// True when a cloud version differs from the local version.
    pub conflict: bool,
    /// JSON snapshot of the conflicting cloud entry (present when conflict=true).
    pub conflict_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewEntry {
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("crypto error: {0}")]
    Crypto(#[from] crate::crypto::CryptoError),
}

// ── UUID helper ───────────────────────────────────────────────────────────────

fn new_sync_id() -> String {
    let mut b = [0u8; 16];
    OsRng.fill(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant RFC 4122
    format!(
        "{}-{}-{}-{}-{}",
        hex_bytes(&b[0..4]),
        hex_bytes(&b[4..6]),
        hex_bytes(&b[6..8]),
        hex_bytes(&b[8..10]),
        hex_bytes(&b[10..16]),
    )
}

fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

impl Db {
    /// Open (or create) the SQLite database at `path` and apply the schema.
    pub fn open(path: &str) -> Result<Self, DbError> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> SqlResult<()> {
        // Base schema (no-op if tables already exist).
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS entries (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                title              TEXT NOT NULL,
                username           TEXT NOT NULL DEFAULT '',
                encrypted_password TEXT NOT NULL,
                url                TEXT,
                notes              TEXT,
                created_at         TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS vault_meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )?;

        // Add new columns if they don't exist yet (error = already exists → ignored).
        for (col, def) in [
            ("sync_id",       "TEXT"),
            ("conflict",      "INTEGER NOT NULL DEFAULT 0"),
            ("conflict_data", "TEXT"),
        ] {
            let _ = self.conn.execute(
                &format!("ALTER TABLE entries ADD COLUMN {col} {def}"),
                [],
            );
        }

        // Backfill sync_id for existing entries that don't have one yet.
        let ids: Vec<i64> = {
            let mut stmt = self.conn.prepare(
                "SELECT id FROM entries WHERE sync_id IS NULL OR sync_id = ''"
            )?;
            let result = stmt.query_map([], |r| r.get::<_, i64>(0))?
                .collect::<SqlResult<Vec<_>>>()?;
            result
        };
        for id in ids {
            self.conn.execute(
                "UPDATE entries SET sync_id = ?1 WHERE id = ?2",
                params![new_sync_id(), id],
            )?;
        }

        Ok(())
    }

    // ── Meta ────────────────────────────────────────────────────────────────

    pub fn get_meta(&self, key: &str) -> SqlResult<Option<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM vault_meta WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        Ok(rows.next()?.map(|r| r.get(0).unwrap()))
    }

    pub fn set_meta(&self, key: &str, value: &str) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO vault_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    // ── CRUD ────────────────────────────────────────────────────────────────

    pub fn list_entries(&self, key: &VaultKey) -> Result<Vec<Entry>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, COALESCE(sync_id,''), title, username, encrypted_password,
                    url, notes, created_at, updated_at,
                    COALESCE(conflict, 0), conflict_data
             FROM entries ORDER BY title COLLATE NOCASE",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, Option<String>>(10)?,
            ))
        })?;

        let mut entries = Vec::new();
        for row in rows {
            let (id, sync_id, title, username, enc_pw, url, notes,
                 created_at, updated_at, conflict_i, conflict_data) = row?;
            let password = String::from_utf8(decrypt(key, &enc_pw).map_err(DbError::Crypto)?)
                .unwrap_or_default();
            entries.push(Entry {
                id, sync_id, title, username, password, url, notes,
                created_at, updated_at,
                conflict: conflict_i != 0,
                conflict_data,
            });
        }
        Ok(entries)
    }

    /// Look up a single entry by its stable cross-device `sync_id`.
    pub fn find_by_sync_id(
        &self,
        key: &VaultKey,
        sync_id: &str,
    ) -> Result<Option<Entry>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, COALESCE(sync_id,''), title, username, encrypted_password,
                    url, notes, created_at, updated_at,
                    COALESCE(conflict, 0), conflict_data
             FROM entries WHERE sync_id = ?1 LIMIT 1",
        )?;

        let mut rows = stmt.query_map(params![sync_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, Option<String>>(10)?,
            ))
        })?;

        if let Some(row) = rows.next() {
            let (id, sid, title, username, enc_pw, url, notes,
                 created_at, updated_at, conflict_i, conflict_data) = row?;
            let password = String::from_utf8(decrypt(key, &enc_pw).map_err(DbError::Crypto)?)
                .unwrap_or_default();
            Ok(Some(Entry {
                id, sync_id: sid, title, username, password, url, notes,
                created_at, updated_at,
                conflict: conflict_i != 0,
                conflict_data,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn create_entry(&self, key: &VaultKey, entry: NewEntry) -> Result<i64, DbError> {
        let enc_pw = encrypt(key, entry.password.as_bytes()).map_err(DbError::Crypto)?;
        self.conn.execute(
            "INSERT INTO entries (sync_id, title, username, encrypted_password, url, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![new_sync_id(), entry.title, entry.username, enc_pw, entry.url, entry.notes],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Insert an entry arriving from cloud sync, preserving its original `sync_id`.
    pub fn insert_synced_entry(
        &self,
        key: &VaultKey,
        sync_id: &str,
        title: &str,
        username: &str,
        password: &str,
        url: Option<&str>,
        notes: Option<&str>,
    ) -> Result<i64, DbError> {
        let enc_pw = encrypt(key, password.as_bytes()).map_err(DbError::Crypto)?;
        self.conn.execute(
            "INSERT INTO entries (sync_id, title, username, encrypted_password, url, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![sync_id, title, username, enc_pw, url, notes],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_entry(&self, key: &VaultKey, id: i64, entry: NewEntry) -> Result<(), DbError> {
        let enc_pw = encrypt(key, entry.password.as_bytes()).map_err(DbError::Crypto)?;
        self.conn.execute(
            "UPDATE entries
             SET title = ?1, username = ?2, encrypted_password = ?3,
                 url = ?4, notes = ?5, updated_at = datetime('now')
             WHERE id = ?6",
            params![entry.title, entry.username, enc_pw, entry.url, entry.notes, id],
        )?;
        Ok(())
    }

    pub fn delete_entry(&self, id: i64) -> SqlResult<()> {
        self.conn
            .execute("DELETE FROM entries WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Mark an entry as conflicted and store the cloud version as JSON.
    pub fn mark_conflict(&self, id: i64, conflict_data: &str) -> SqlResult<()> {
        self.conn.execute(
            "UPDATE entries SET conflict = 1, conflict_data = ?1 WHERE id = ?2",
            params![conflict_data, id],
        )?;
        Ok(())
    }

    /// Clear the conflict flag and discard the stored cloud snapshot.
    pub fn clear_conflict(&self, id: i64) -> SqlResult<()> {
        self.conn.execute(
            "UPDATE entries SET conflict = 0, conflict_data = NULL WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }
}
