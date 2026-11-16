import { t } from "@/i18n";

/**
 * Turns a failed chat request into readable copy. The AI SDK transport throws `Error(<response body>)` for a
 * non-2xx answer, so `message` is the raw backend JSON. The local backend answers:
 * - 400 `provider_required` (no `byok/` model), 400 `byok_key_required` (a `byok/` turn without URL or key):
 *   the user has no working provider;
 * - `local_backend_unavailable` (the shell could not reach the bundled backend; answered as 502). Keyed on the JSON code, never on the HTTP status.
 * Any other error is returned as is. Exported for tests.
 */
export function mapChatError(error: Error): Error {
  const code = errorCode(error.message);
  if (code === "provider_required" || code === "byok_key_required") {
    return new Error(t("chat.error.providerRequired"), { cause: error });
  }
  if (code === "local_backend_unavailable") {
    return new Error(t("chat.error.localBackendUnavailable"), { cause: error });
  }
  return error;
}

function errorCode(message: string): string | null {
  const text = message.trim();
  if (text.startsWith("{")) {
    try {
      const body = JSON.parse(text) as { error?: unknown; code?: unknown };
      for (const value of [body.code, body.error]) {
        if (typeof value === "string" && KNOWN.has(value)) return value;
      }
    } catch {
      // Not JSON: fall through to the substring check.
    }
  }
  for (const known of KNOWN) if (text.includes(known)) return known;
  return null;
}

const KNOWN = new Set(["provider_required", "byok_key_required", "local_backend_unavailable"]);
