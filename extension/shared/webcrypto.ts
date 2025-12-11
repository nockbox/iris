/**
 * WebCrypto utilities for vault encryption/decryption
 * Uses PBKDF2 for key derivation and AES-GCM for encryption
 */

/** PBKDF2 iteration count (OWASP recommends 600k+ for SHA-256, we use 310k for UX balance) */
export const PBKDF2_ITERATIONS = 310_000;

export function rand(n: number): Uint8Array {
  const u = new Uint8Array(n);
  crypto.getRandomValues(u);
  return u;
}

export async function deriveKeyPBKDF2(
  password: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
  hash: 'SHA-256' | 'SHA-512' = 'SHA-256'
): Promise<{ key: CryptoKey; salt: Uint8Array }> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  // Return key and salt as plain object (safe - no mutation of CryptoKey)
  return { key, salt };
}

export async function encryptGCM(
  key: CryptoKey,
  data: Uint8Array
): Promise<{ iv: Uint8Array; ct: Uint8Array }> {
  const iv = rand(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      data as BufferSource
    )
  );
  return { iv, ct };
}

export async function decryptGCM(key: CryptoKey, iv: Uint8Array, ct: Uint8Array): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource
  );
  return new TextDecoder().decode(pt);
}
