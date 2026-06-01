use rusqlite::{Connection, Result as SqlResult, params};
use serde::{Deserialize, Serialize};

use crate::crypto::{decrypt, encrypt, VaultKey};

pub struct Db {
    conn: Connection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: i64,
    pub title: String,
    pub username: String,
    pub password: String, // plaintext in memory, never written to disk
    pub url: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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

impl Db {
    /// Open (or create) the SQLite database at `path` and apply the schema.
    /// Note: use SQLCipher in production by enabling the `sqlcipher` rusqlite feature
    /// and calling `PRAGMA key = '...'` immediately after opening.
    pub fn open(path: &str) -> Result<Self, DbError> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> SqlResult<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS entries (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                title            TEXT NOT NULL,
                username         TEXT NOT NULL DEFAULT '',
                encrypted_password TEXT NOT NULL,
                url              TEXT,
                notes            TEXT,
                created_at       TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS vault_meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
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
            "SELECT id, title, username, encrypted_password, url, notes, created_at, updated_at
             FROM entries ORDER BY title COLLATE NOCASE",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?;

        let mut entries = Vec::new();
        for row in rows {
            let (id, title, username, enc_pw, url, notes, created_at, updated_at) = row?;
            let password = String::from_utf8(decrypt(key, &enc_pw).map_err(DbError::Crypto)?)
                .unwrap_or_default();
            entries.push(Entry {
                id,
                title,
                username,
                password,
                url,
                notes,
                created_at,
                updated_at,
            });
        }
        Ok(entries)
    }

    pub fn create_entry(&self, key: &VaultKey, entry: NewEntry) -> Result<i64, DbError> {
        let enc_pw = encrypt(key, entry.password.as_bytes()).map_err(DbError::Crypto)?;
        self.conn.execute(
            "INSERT INTO entries (title, username, encrypted_password, url, notes)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![entry.title, entry.username, enc_pw, entry.url, entry.notes],
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
}
