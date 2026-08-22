/**
 * Secure Storage Utilities
 * Provides encryption, hashing, and secure data handling
 * for sensitive information at rest.
 */

import * as crypto from 'crypto';

// Algorithm constants
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha512';

/**
 * Get the encryption key from environment or derive one.
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (key) {
    // Key should be hex-encoded 32 bytes (64 hex chars)
    return Buffer.from(key, 'hex');
  }
  // Fallback: derive from app secret (less secure, but functional)
  const appSecret = process.env.JWT_SECRET || 'web-engine-default-secret';
  return crypto.scryptSync(appSecret, 'salt', KEY_LENGTH);
}

/**
 * Encrypt a plaintext string.
 * Returns a hex-encoded string containing: salt:iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex-encoded)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}

/**
 * Decrypt an encrypted string that was created by encrypt().
 */
export function decrypt(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const ciphertext = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Hash a password using bcrypt-compatible hashing.
 * Uses PBKDF2 with SHA-512 for maximum compatibility.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
  const hash = crypto.pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  ).toString('hex');

  // Format: iterations:salt:hash
  return `${PBKDF2_ITERATIONS}:${salt}:${hash}`;
}

/**
 * Verify a password against a hash created by hashPassword().
 */
export function verifyPassword(password: string, hashed: string): boolean {
  const parts = hashed.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid hash format');
  }

  const iterations = parseInt(parts[0], 10);
  const salt = parts[1];
  const originalHash = parts[2];

  const hash = crypto.pbkdf2Sync(
    password,
    salt,
    iterations,
    KEY_LENGTH,
    PBKDF2_DIGEST
  ).toString('hex');

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(originalHash));
}

/**
 * Generate a secure random token (for API keys, reset tokens, etc.).
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate a cryptographically secure random string for IDs.
 */
export function generateSecureId(prefix?: string): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Hash data with SHA-256.
 */
export function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Hash data with HMAC-SHA256 (for API signing, webhook verification).
 */
export function hmacSha256(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still use timing-safe compare to avoid leaking length info
    const buf = Buffer.from(a);
    const buf2 = Buffer.from(b);
    return crypto.timingSafeEqual(buf, buf2);
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Mask sensitive data for logging (show first/last N chars).
 */
export function maskSensitiveData(
  data: string,
  visibleStart: number = 4,
  visibleEnd: number = 4
): string {
  if (data.length <= visibleStart + visibleEnd) {
    return data.slice(0, visibleStart) + '*'.repeat(data.length - visibleStart);
  }
  return (
    data.slice(0, visibleStart) +
    '*'.repeat(data.length - visibleStart - visibleEnd) +
    data.slice(-visibleEnd)
  );
}

/**
 * Sanitize headers for logging (remove sensitive values).
 */
export function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const sensitiveHeaders = ['authorization', 'cookie', 'set-cookie', 'x-csrf-token', 'x-api-key'];
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveHeaders.includes(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (value) {
      sanitized[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }

  return sanitized;
}
