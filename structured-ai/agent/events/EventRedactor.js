"use strict";

/*
|--------------------------------------------------------------------------
| Event Redactor — EXECUTION_PLAN Phase 27
|--------------------------------------------------------------------------
|
| Masks secrets (API keys, tokens, passwords, bearer credentials) and
| sensitive source content in event streams and telemetry logs.
|--------------------------------------------------------------------------
*/

const SENSITIVE_KEY_PATTERN =
    /token|secret|password|api[_-]?key|auth(orization)?/i;

const BEARER_PATTERN =
    /Bearer\s+[A-Za-z0-9_\-\.]+/gi;

const URL_TOKEN_PATTERN =
    /([?&]token=)[A-Za-z0-9_\-\.]+/gi;

const REDACTED_MARKER = "[REDACTED]";


class EventRedactor {

    static isSensitiveKey(key) {

        return SENSITIVE_KEY_PATTERN.test(key);
    }

    static redactString(value) {

        if (typeof value !== "string") {
            return value;
        }

        return value
            .replace(BEARER_PATTERN, `Bearer ${REDACTED_MARKER}`)
            .replace(URL_TOKEN_PATTERN, `$1${REDACTED_MARKER}`);
    }

    static redact(item, { depth = 0, maxDepth = 10, maskSource = false } = {}) {

        if (item === null || item === undefined) {

            return item;
        }

        if (depth > maxDepth) {

            return REDACTED_MARKER;
        }

        if (typeof item === "string") {

            return EventRedactor.redactString(item);
        }

        if (typeof item !== "object") {

            return item;
        }

        if (Array.isArray(item)) {

            return item.map(entry =>
                EventRedactor.redact(entry, { depth: depth + 1, maxDepth, maskSource })
            );
        }

        const redacted = {};

        for (const [key, value] of Object.entries(item)) {

            if (EventRedactor.isSensitiveKey(key)) {

                redacted[key] = REDACTED_MARKER;
                continue;
            }

            if (maskSource && (key === "source_content" || key === "raw_source")) {

                redacted[key] = `${REDACTED_MARKER} (${typeof value === "string" ? value.length : 0} chars)`;
                continue;
            }

            redacted[key] =
                EventRedactor.redact(value, { depth: depth + 1, maxDepth, maskSource });
        }

        return redacted;
    }
}

module.exports = {
    EventRedactor,
    REDACTED_MARKER
};
