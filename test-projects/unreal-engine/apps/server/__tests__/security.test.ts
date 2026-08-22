/**
 * Security Layer Tests
 */

import { describe, it, expect } from 'vitest';
import {
  stripHtml,
  escapeHtml,
  sanitizeSql,
  sanitizeUrl,
  isValidEmail,
  isValidUuid,
  validatePassword,
  sanitizeObject,
  isValidProjectName,
  isValidIdentifier,
  safeJsonParse,
} from '../src/security/validation';
import {
  generateCsrfToken,
  validateCsrfToken,
} from '../src/security/csrf';
import {
  buildCspString,
} from '../src/security/csp';
import {
  hashPassword,
  verifyPassword,
  generateSecureToken,
  sha256,
  hmacSha256,
  safeCompare,
  maskSensitiveData,
  sanitizeHeaders,
  encrypt,
  decrypt,
} from '../src/security/secure-storage';
import {
  verifyToken,
  createToken,
  decodeToken,
} from '../src/security/auth.middleware';
import {
  createRateLimiter,
  authRateLimiter,
  apiRateLimiter,
  buildRateLimiter,
} from '../src/security/rate-limit';
import { DEFAULT_CSP_DIRECTIVES } from '../src/security/types';

describe('Security Layer — Validation & Sanitization', () => {
  describe('stripHtml', () => {
    it('should strip HTML tags', () => {
      expect(stripHtml('<script>alert(1)</script>')).toBe('alert(1)');
      expect(stripHtml('<p>Hello</p>')).toBe('Hello');
      expect(stripHtml('No tags')).toBe('No tags');
    });
  });

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
      expect(escapeHtml('"test"')).toBe('&quot;test&quot;');
      expect(escapeHtml("'test'")).toBe('&#x27;test&#x27;');
    });
  });

  describe('sanitizeSql', () => {
    it('should escape single quotes', () => {
      expect(sanitizeSql("O'Brien")).toBe("O''Brien");
    });
  });

  describe('sanitizeUrl', () => {
    it('should strip javascript: protocol', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe('');
      expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
    });
  });

  describe('isValidEmail', () => {
    it('should validate email format', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('not-email')).toBe(false);
    });
  });

  describe('isValidUuid', () => {
    it('should validate UUID v4 format', () => {
      expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(false); // not v4
      expect(isValidUuid('550e8400-e29b-4a34-a716-446655440000')).toBe(true); // v4
      expect(isValidUuid('not-a-uuid')).toBe(false);
    });
  });

  describe('validatePassword', () => {
    it('should reject weak passwords', () => {
      const errors = validatePassword('weak');
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should accept strong passwords', () => {
      const errors = validatePassword('Str0ng!Pass');
      expect(errors.length).toBe(0);
    });
  });

  describe('isValidProjectName', () => {
    it('should validate project names', () => {
      expect(isValidProjectName('My Project')).toBe(true);
      expect(isValidProjectName('<script>')).toBe(false);
    });
  });

  describe('safeJsonParse', () => {
    it('should parse valid JSON', () => {
      expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    });

    it('should return null for invalid JSON', () => {
      expect(safeJsonParse('invalid')).toBeNull();
    });
  });
});

describe('Security Layer — CSRF', () => {
  describe('generateCsrfToken', () => {
    it('should generate a non-empty token', () => {
      const token = generateCsrfToken();
      expect(token).toBeTruthy();
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate tokens with HMAC when secret is provided', () => {
      const token = generateCsrfToken('my-secret');
      const parts = token.split('.');
      expect(parts.length).toBe(3);
    });
  });

  describe('validateCsrfToken', () => {
    it('should validate a token generated with secret', () => {
      const secret = 'test-secret';
      const token = generateCsrfToken(secret);
      expect(validateCsrfToken(token, secret)).toBe(true);
    });

    it('should reject an invalid token', () => {
      expect(validateCsrfToken('invalid-token', 'secret')).toBe(false);
    });

    it('should reject empty token', () => {
      expect(validateCsrfToken('', 'secret')).toBe(false);
    });
  });
});

describe('Security Layer — CSP', () => {
  describe('buildCspString', () => {
    it('should build a valid CSP header string', () => {
      const csp = buildCspString({});
      expect(csp).toContain('default-src');
      expect(csp).toContain("'self'");
      expect(csp).toContain('upgrade-insecure-requests');
    });

    it('should include custom directives', () => {
      const csp = buildCspString({ 'script-src': ["'self'", 'https://cdn.example.com'] });
      expect(csp).toContain('script-src');
      expect(csp).toContain('https://cdn.example.com');
    });
  });
});

describe('Security Layer — Rate Limiting', () => {
  describe('createRateLimiter', () => {
    it('should create a rate limiter function', () => {
      const limiter = createRateLimiter({ max: 10, timeWindow: '1 minute' });
      expect(typeof limiter).toBe('function');
    });
  });

  describe('preset limiters', () => {
    it('should have auth rate limiter with low limit', () => {
      expect(authRateLimiter).toBeDefined();
      expect(typeof authRateLimiter).toBe('function');
    });

    it('should have API rate limiter', () => {
      expect(apiRateLimiter).toBeDefined();
      expect(typeof apiRateLimiter).toBe('function');
    });

    it('should have build rate limiter', () => {
      expect(buildRateLimiter).toBeDefined();
      expect(typeof buildRateLimiter).toBe('function');
    });
  });
});

describe('Security Layer — Secure Storage', () => {
  describe('hashPassword and verifyPassword', () => {
    it('should hash and verify a password', () => {
      const password = 'TestPass123!';
      const hashed = hashPassword(password);
      expect(hashed).toContain(':');
      expect(verifyPassword(password, hashed)).toBe(true);
      expect(verifyPassword('wrong', hashed)).toBe(false);
    });
  });

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt a string', () => {
      const original = 'sensitive-data-123';
      const encrypted = encrypt(original);
      expect(encrypted).not.toBe(original);
      expect(encrypted.split(':').length).toBe(3);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should produce different ciphertexts each time', () => {
      const original = 'test-data';
      const e1 = encrypt(original);
      const e2 = encrypt(original);
      expect(e1).not.toBe(e2);
    });

    it('should throw on invalid encrypted data', () => {
      expect(() => decrypt('invalid')).toThrow('Invalid encrypted data format');
    });
  });

  describe('generateSecureToken', () => {
    it('should generate a token of specified length', () => {
      const token = generateSecureToken(16);
      expect(token.length).toBe(32); // hex encoded, so 16 bytes = 32 hex chars
    });
  });

  describe('sha256', () => {
    it('should produce a SHA-256 hash', () => {
      const hash = sha256('test');
      expect(hash.length).toBe(64); // 256 bits = 64 hex chars
    });
  });

  describe('hmacSha256', () => {
    it('should produce an HMAC', () => {
      const hmac = hmacSha256('data', 'secret');
      expect(hmac.length).toBe(64);
    });
  });

  describe('safeCompare', () => {
    it('should compare strings correctly', () => {
      expect(safeCompare('abc', 'abc')).toBe(true);
      expect(safeCompare('abc', 'xyz')).toBe(false);
    });
  });

  describe('maskSensitiveData', () => {
    it('should mask data preserving first/last chars', () => {
      const masked = maskSensitiveData('1234567890', 2, 2);
      expect(masked).toBe('12******90');
    });
  });

  describe('sanitizeHeaders', () => {
    it('should redact sensitive headers', () => {
      const result = sanitizeHeaders({
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      });
      expect(result.authorization).toBe('[REDACTED]');
      expect(result['content-type']).toBe('application/json');
    });
  });
});

describe('Security Layer — Auth Middleware', () => {
  describe('createToken', () => {
    it('should create a JWT token', () => {
      const token = createToken({ sub: 'user-1', email: 'test@example.com' });
      expect(token).toBeTruthy();
      expect(token.split('.').length).toBe(3); // JWT has 3 parts
    });
  });

  describe('decodeToken', () => {
    it('should decode a token without verification', () => {
      const token = createToken({ sub: 'user-1', email: 'test@example.com' });
      const decoded = decodeToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded!.sub).toBe('user-1');
      expect(decoded!.email).toBe('test@example.com');
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const token = createToken({ sub: 'user-1', email: 'test@example.com' });
      const decoded = verifyToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded!.sub).toBe('user-1');
    });

    it('should reject an invalid token', () => {
      expect(verifyToken('invalid-token')).toBeNull();
    });
  });
});

describe('Security Layer — Types', () => {
  it('should have DEFAULT_CSP_DIRECTIVES defined', () => {
    expect(DEFAULT_CSP_DIRECTIVES).toBeDefined();
    expect(DEFAULT_CSP_DIRECTIVES['default-src']).toContain("'self'");
  });
});
