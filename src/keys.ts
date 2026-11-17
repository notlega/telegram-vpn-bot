/**
 * Per-instance credential generation.
 *
 * Xray speaks base64url (raw, unpadded) for REALITY x25519 keys and hex for
 * short ids. Everything is derived from WebCrypto so nothing has to be stored
 * between requests.
 */

export interface RealityKeyPair {
  privateKey: string;
  publicKey: string;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function generateRealityKeyPair(): Promise<RealityKeyPair> {
  const keyPair = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;

  const rawPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", keyPair.publicKey)) as ArrayBuffer,
  );

  let rawPrivate: Uint8Array;
  try {
    rawPrivate = new Uint8Array(
      (await crypto.subtle.exportKey("raw", keyPair.privateKey)) as ArrayBuffer,
    );
  } catch (error) {
    // Some runtimes only allow PKCS#8 export; the trailing 32 bytes are the seed.
    console.warn("raw private key export unavailable, falling back to PKCS#8", error);
    const pkcs8 = new Uint8Array(
      (await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)) as ArrayBuffer,
    );
    rawPrivate = pkcs8.slice(-32);
  }

  return {
    privateKey: toBase64Url(rawPrivate),
    publicKey: toBase64Url(rawPublic),
  };
}

export function generateShortId(byteLength = 4): string {
  return randomHex(byteLength);
}

export function generateUuid(): string {
  return crypto.randomUUID();
}

export function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
