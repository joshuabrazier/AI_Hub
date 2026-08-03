import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { envServer } from "../env-server";

// -------------------------------------------------------------------
// Field-level encryption
//
// Encrypts sensitive fields (e.g. signatures) before they're written to
// the database, on top of the database's own encryption-at-rest. Uses
// AES-256-GCM with a random IV per value plus an auth tag so tampering is
// detected on decrypt. The key comes from FIELD_ENCRYPTION_KEY (base64,
// 32 bytes). Never log the plaintext or the key.
// -------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard nonce size
const AUTH_TAG_LENGTH = 16; // full 128-bit GCM tag - pin it so truncated-tag forgeries are rejected
const PAYLOAD_VERSION = "v1"; // lets the scheme change later without ambiguity

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const key = Buffer.from(envServer.FIELD_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("FIELD_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }

  cachedKey = key;
  return key;
}

// Encrypts a value into "v1:<iv>:<authTag>:<ciphertext>" (each part base64).
export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    PAYLOAD_VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

// Reverses encryptField. Throws if the payload is malformed or tampered with.
export function decryptField(payload: string): string {
  const [version, ivB64, authTagB64, ciphertextB64] = payload.split(":");

  if (version !== PAYLOAD_VERSION || !ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Invalid encrypted payload");
  }

  const authTag = Buffer.from(authTagB64, "base64");
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted payload");
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}
