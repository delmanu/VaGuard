# 🔐 Vault — Team Password Manager

> A local-first, zero-knowledge password manager for Windows teams,
> built with Tauri v2, Rust, React, and TypeScript.

![Platform](https://img.shields.io/badge/platform-Windows-blue?logo=windows)
![Rust](https://img.shields.io/badge/backend-Rust-orange?logo=rust)
![TypeScript](https://img.shields.io/badge/frontend-TypeScript-3178c6?logo=typescript)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Features

- **AES-256-GCM encryption** — every password is encrypted with a unique nonce before touching the disk
- **Argon2id key derivation** — master password is hashed with 64 MiB memory cost; never stored
- **SQLite local database** — fast, portable, fully offline
- **Cryptographically secure password generator** — powered by `OsRng`, configurable length and charset
- **Zero-knowledge cloud sync** — optional. Your vault is encrypted *before* it leaves your device; your Supabase project never sees plaintext
- **No servers of our own** — this project has no backend. Your data belongs to you

---

## 📥 Getting Started (end users)

### 1 · Download the installer

Go to the [**Releases**](../../releases) page and download the latest `.msi` installer for Windows.

Run the installer and launch **Vault** from the Start Menu.

### 2 · Set your master password

The first time you unlock the vault, type any password you choose. That password
becomes your master password — **it is never stored anywhere**, so don't lose it.

### 3 · (Optional) Enable cloud sync

Sync is powered by your own [Supabase](https://supabase.com) project — free tier is enough.

| Step | What to do |
|------|-----------|
| 1 | Create a free project at [supabase.com](https://supabase.com) |
| 2 | Copy **Project URL** and **anon key** from *Settings → API* |
| 3 | Create a private Storage bucket named `vaults` with RLS enabled |

Then open the app, click **Cloud sync** in the sidebar, and fill in your credentials.

<details>
<summary>Bucket RLS policy (paste in the Supabase SQL editor)</summary>

```sql
create policy "Users manage own vault"
on storage.objects for all
using (
  auth.role() = 'authenticated'
  and (storage.foldername(name))[1] = auth.uid()::text
);
```

</details>

> **Note:** If your Supabase project requires email confirmation, either confirm
> your email or disable it in *Authentication → Providers → Email → Confirm email*.

---

## 🛠 Development

### Requirements

| Tool | Version |
|------|---------|
| [Node.js](https://nodejs.org) | 18 or later |
| [Rust](https://rustup.rs) | 1.75 or later (stable) |
| [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) | bundled on Windows 11; [installer](https://go.microsoft.com/fwlink/p/?LinkId=2124703) for Windows 10 |

### Run in development

```powershell
git clone https://github.com/YOUR_USERNAME/vault-app.git
cd vault-app
npm install
npm run tauri dev
```

The first run compiles ~500 Rust crates — this takes a few minutes. Subsequent
hot-reloads are instant.

### Build a release installer

```powershell
npm run tauri build
```

The `.msi` and `.exe` installers are emitted to:

```
src-tauri/target/release/bundle/msi/
src-tauri/target/release/bundle/nsis/
```

---

## 🔒 Security

### Threat model

| Asset | Protection |
|-------|-----------|
| Stored passwords | AES-256-GCM, unique 96-bit nonce per ciphertext |
| Vault key | Derived with Argon2id (64 MiB, 3 passes); never persisted |
| Master password | Never stored anywhere — not even hashed |
| Sync config (URL, API key) | AES-256-GCM encrypted at rest (`sync_config.enc`) |
| Supabase JWT | In-memory only; cleared when vault locks |
| Cloud blob | Fully encrypted before upload; server is zero-knowledge |

### Key design decisions

- The master password is used only to derive the 256-bit AES key via Argon2id.
  After derivation the password is dropped from memory.
- Vault keys are stored in a `VaultKey` struct that implements `ZeroizeOnDrop`,
  so the memory is wiped when the vault is locked or the app closes.
- The sync server (your Supabase project) only ever receives opaque encrypted
  blobs. It cannot distinguish entries, titles, or passwords.
- Conflict resolution is **last-write-wins**. There is no automatic merge.

### Reporting vulnerabilities

Please open a [GitHub Issue](../../issues) labelled `security` or contact the
maintainer directly. Do not include credentials or vault data in bug reports.

---

## 📄 License

MIT © 2025 [Tu nombre] — see [LICENSE](LICENSE) for details.
