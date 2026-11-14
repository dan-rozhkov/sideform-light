// Resolves backend API URLs for every caller (chat, model list, browse helpers).
//
// - VITE_AI_API_URL: explicit full chat URL (e.g. https://host/api/chat). We
//   strip the trailing /api/chat to recover the base for other endpoints.
// - VITE_DESIGN_AGENT_BACKEND_URL: backend base URL.
// - neither set: the local backend. There is no same-origin fallback: the page
//   origin is app://sideform, which serves no API.
export const DEFAULT_BACKEND_URL = "http://localhost:3001";

function resolveBackendBase(): string {
  const explicitApiUrl = import.meta.env.VITE_AI_API_URL as string | undefined;
  if (explicitApiUrl) {
    return explicitApiUrl.replace(/\/api\/chat\/?$/, "");
  }

  const backendUrl = import.meta.env.VITE_DESIGN_AGENT_BACKEND_URL as
    | string
    | undefined;
  if (backendUrl) {
    return backendUrl.replace(/\/$/, "");
  }

  return DEFAULT_BACKEND_URL;
}

export function resolveApiUrl(path: string): string {
  return `${resolveBackendBase()}${path}`;
}

// There are no accounts and no cookies: every backend call goes out with
// `credentials: "omit"`. Callers never spell it themselves.
export const CREDENTIALS_MODE: RequestCredentials = "omit";

export function apiFetchUrl(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: CREDENTIALS_MODE });
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return apiFetchUrl(resolveApiUrl(path), init);
}

// Single source of truth for "is the backend reachable". Every network caller
// (chat, image generation, ChatInput's send-button title) used to check
// `!navigator.onLine` independently, which is easy to let drift. Centralizing
// it here doesn't change behavior, just where it lives.
export function isOffline(): boolean {
  return !navigator.onLine;
}

// Canonical copy for the chat surface: useDesignChat's offlineError and
// ChatInput's send-button title both describe the same "sending is
// unavailable" condition. Other offline messages (e.g. image generation) are
// genuinely surface-specific and keep their own wording.
export const OFFLINE_MESSAGE =
  "Offline. AI and backend features are disabled until the connection is restored.";

export const OFFLINE_SEND_TITLE = "Offline — sending is disabled";
