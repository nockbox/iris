/**
 * WebCrypto utilities for vault encryption/decryption
 * Uses PBKDF2 for key derivation and AES-GCM for encryption
 */

export function rand(n: number): Uint8Array {
  const u = new Uint8Array(n);
  crypto.getRandomValues(u);
  return u;
}

export async function deriveKeyPBKDF2(
  password: string,
  salt: Uint8Array
): Promise<{ key: CryptoKey; salt: Uint8Array }> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 200_000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  // Return key and salt as plain object (safe - no mutation of CryptoKey)
  return { key, salt };
}

export async function encryptGCM(
  key: CryptoKey,
  salt: Uint8Array,
  data: Uint8Array
): Promise<{ iv: Uint8Array; ct: Uint8Array; salt: Uint8Array }> {
  const iv = rand(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      data as BufferSource
    )
  );
  return { iv, ct, salt };
}

export async function decryptGCM(
  key: CryptoKey,
  iv: Uint8Array,
  ct: Uint8Array
): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ct as BufferSource
  );
  return new TextDecoder().decode(pt);
}
