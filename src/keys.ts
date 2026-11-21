/**
 * per-instance credential generation
 *
 * Xray speaks base64url (raw, unpadded) for REALITY x25519 keys and hex for
 * short ids. Everything is derived from WebCrypto so nothing has to be stored
 * between requests
 */

/** A REALITY key pair, both halves encoded the way Xray expects them */
export interface RealityKeyPair {
  /** 32 raw bytes, base64url encoded. Written to the server config */
  privateKey: string;

  /** 32 raw bytes, base64url encoded. Published in the share link as `pbk` */
  publicKey: string;
}

/**
 * encodes bytes as unpadded base64url, the format Xray uses for REALITY keys
 *
 * @param bytes — raw key material
 * @returns base64url string without `=` padding
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * decodes an unpadded base64url string produced by {@link toBase64Url}
 *
 * @param value — base64url string, padding optional
 * @returns the decoded bytes
 */
export function fromBase64Url(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

/**
 * generates a fresh X25519 key pair for one server
 *
 * the private half is exported raw when the runtime allows it and falls back to
 * the trailing 32 bytes of the PKCS#8 encoding otherwise
 *
 * @returns the pair in Xray's base64url format
 */
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
    // some runtimes only allow PKCS#8 export; the trailing 32 bytes are the seed.
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

/**
 * generates a REALITY short id
 *
 * @param byteLength — number of random bytes; Xray accepts up to 8 bytes
 *   (16 hex characters). Defaults to 4
 * @returns lowercase hex string, `byteLength * 2` characters long
 */
export function generateShortId(byteLength = 4): string {
  return randomHex(byteLength);
}

/**
 * generates a random UUID v4 for use as the VLESS user id
 *
 * @returns canonical UUID string
 */
export function generateUuid(): string {
  return crypto.randomUUID();
}

/**
 * generates cryptographically random bytes as lowercase hex
 *
 * @param byteLength — number of random bytes
 * @returns hex string, `byteLength * 2` characters long
 */
export function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
