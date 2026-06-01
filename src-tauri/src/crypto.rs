use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// 32-byte AES-256 key held in memory; zeroed on drop.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct VaultKey(pub [u8; 32]);

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("argon2 error: {0:?}")]
    Argon2(argon2::Error),
    #[error("aes-gcm error")]
    AesGcm,
    #[error("base64 decode error: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("invalid ciphertext format")]
    InvalidFormat,
}

impl From<argon2::Error> for CryptoError {
    fn from(e: argon2::Error) -> Self {
        CryptoError::Argon2(e)
    }
}

// nonce(12) ++ ciphertext
const NONCE_LEN: usize = 12;

/// Derive a 256-bit vault key from a master password and a fixed salt.
///
/// The salt must be stored in the DB header (non-sensitive) and passed here on
/// every unlock. It is never secret — its only job is domain separation and
/// preventing rainbow tables.
pub fn derive_key(password: &str, salt: &[u8]) -> Result<VaultKey, CryptoError> {
    let params = Params::new(
        64 * 1024, // m_cost: 64 MiB
        3,         // t_cost: 3 iterations
        1,         // p_cost: 1 thread (increase for server use)
        Some(32),  // output length
    )?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2.hash_password_into(password.as_bytes(), salt, &mut key)?;
    Ok(VaultKey(key))
}

/// Encrypt `plaintext` with AES-256-GCM.
/// Returns base64(nonce || ciphertext_with_tag).
pub fn encrypt(key: &VaultKey, plaintext: &[u8]) -> Result<String, CryptoError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key.0));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, plaintext).map_err(|_| CryptoError::AesGcm)?;

    let mut blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext);

    use base64::Engine as _;
    Ok(base64::engine::general_purpose::STANDARD.encode(&blob))
}

/// Decrypt a base64(nonce || ciphertext) blob produced by [`encrypt`].
pub fn decrypt(key: &VaultKey, b64: &str) -> Result<Vec<u8>, CryptoError> {
    use base64::Engine as _;
    let blob = base64::engine::general_purpose::STANDARD.decode(b64)?;

    if blob.len() <= NONCE_LEN {
        return Err(CryptoError::InvalidFormat);
    }

    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key.0));
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::AesGcm)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASSWORD: &str = "correct-horse-battery-staple";
    const SALT: &[u8] = b"vault-app-test-salt-16b!"; // 24 bytes; prod: random 16+ bytes

    #[test]
    fn derive_key_is_deterministic() {
        let k1 = derive_key(PASSWORD, SALT).unwrap();
        let k2 = derive_key(PASSWORD, SALT).unwrap();
        assert_eq!(k1.0, k2.0);
    }

    #[test]
    fn derive_key_differs_by_password() {
        let k1 = derive_key(PASSWORD, SALT).unwrap();
        let k2 = derive_key("wrong-password", SALT).unwrap();
        assert_ne!(k1.0, k2.0);
    }

    #[test]
    fn derive_key_differs_by_salt() {
        let k1 = derive_key(PASSWORD, SALT).unwrap();
        let k2 = derive_key(PASSWORD, b"different-salt--").unwrap();
        assert_ne!(k1.0, k2.0);
    }

    #[test]
    fn roundtrip_encrypt_decrypt() {
        let key = derive_key(PASSWORD, SALT).unwrap();
        let plaintext = b"super secret password 123!";

        let b64 = encrypt(&key, plaintext).unwrap();
        let recovered = decrypt(&key, &b64).unwrap();

        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn encrypt_produces_different_ciphertexts() {
        // Each call uses a fresh random nonce — ciphertexts must differ.
        let key = derive_key(PASSWORD, SALT).unwrap();
        let c1 = encrypt(&key, b"same input").unwrap();
        let c2 = encrypt(&key, b"same input").unwrap();
        assert_ne!(c1, c2);
    }

    #[test]
    fn decrypt_fails_with_wrong_key() {
        let key = derive_key(PASSWORD, SALT).unwrap();
        let wrong_key = derive_key("wrong-password", SALT).unwrap();

        let b64 = encrypt(&key, b"secret").unwrap();
        assert!(decrypt(&wrong_key, &b64).is_err());
    }

    #[test]
    fn decrypt_fails_on_tampered_ciphertext() {
        let key = derive_key(PASSWORD, SALT).unwrap();
        let mut b64 = encrypt(&key, b"secret").unwrap();
        // Flip the last character to corrupt the GCM tag.
        let last = b64.pop().unwrap();
        b64.push(if last == 'A' { 'B' } else { 'A' });
        assert!(decrypt(&key, &b64).is_err());
    }
}
