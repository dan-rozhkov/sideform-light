// Resolves backend API URLs for every caller (chat, model list, browse helpers).
//
// - Default: SAME ORIGIN (relative `/api/...`). In the app the page is
//   app://sideform and the shell proxies `/api/*` to the bundled local backend;
//   in dev the Vite server proxies `/api` (see vite.config.ts).
// - VITE_AI_API_URL / VITE_DESIGN_AGENT_BACKEND_URL force an ABSOLUTE base. They are
//   for a ui served OUTSIDE the app (Vite dev, a plain browser) only: the bundled
//   `app://` page has a CSP whose connect-src is 'self' (plus data: and blob:), so an absolute base would be
//   blocked there. VITE_AI_API_URL is a full chat URL (we strip the trailing
//   /api/chat to recover the base); VITE_DESIGN_AGENT_BACKEND_URL is the base.

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

  return "";
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
