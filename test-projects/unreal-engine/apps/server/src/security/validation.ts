/**
 * Input Validation & Sanitization Utilities
 * Provides sanitization, validation, and escaping functions
 * to prevent XSS, injection, and other input-based attacks.
 */

/**
 * Strip HTML tags from a string to prevent XSS.
 */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(input: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
  };
  const reg = /[&<>"'`]/g;
  return input.replace(reg, (match) => map[match]);
}

/**
 * Sanitize a string for safe use in SQL context (basic escaping).
 * Use parameterized queries in production; this is a defense-in-depth layer.
 */
export function sanitizeSql(input: string): string {
  return input.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

/**
 * Sanitize a string for safe use in JSON context.
 */
export function sanitizeJson(input: string): string {
  return input.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

/**
 * Sanitize a URL to prevent javascript: protocol injection.
 */
export function sanitizeUrl(url: string): string {
  // Only allow http, https, mailto, and relative URLs
  if (/^(https?:\/\/|mailto:|\/)/.test(url)) {
    return url;
  }
  // Remove dangerous protocols
  return url.replace(/^(javascript|data|vbscript|file):/gi, '');
}

/**
 * Validate email format.
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate that a string is a valid UUID (v4).
 */
export function isValidUuid(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Validate password strength.
 * Returns an array of error messages (empty = valid).
 */
export function validatePassword(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  if (password.length > 128) {
    errors.push('Password must not exceed 128 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  return errors;
}

/**
 * Sanitize an object by trimming all string values and removing null/undefined.
 */
export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === 'string') {
      sanitized[key] = value.trim();
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        typeof item === 'string' ? item.trim() : item
      );
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized as T;
}

/**
 * Validate that a string is a valid project name (alphanumeric, spaces, hyphens, underscores).
 */
export function isValidProjectName(name: string): boolean {
  return /^[a-zA-Z0-9 _-]{1,100}$/.test(name);
}

/**
 * Validate that a string is a valid identifier (alphanumeric + underscore, no leading digit).
 */
export function isValidIdentifier(id: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id);
}

/**
 * Validate a JSON string and return the parsed object or null.
 */
export function safeJsonParse<T = any>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Normalize a string by trimming, collapsing whitespace, and removing control characters.
 */
export function normalizeString(input: string): string {
  return input
    .trim()
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    .replace(/\s+/g, ' ');
}
