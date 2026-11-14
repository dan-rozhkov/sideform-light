const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg)(\?|$)/i;

export function extFromMediaType(mediaType: string | null | undefined): string {
  if (!mediaType) return "png";
  const type = mediaType.split(";")[0].trim().toLowerCase();
  switch (type) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default: {
      const sub = type.split("/")[1];
      return sub ? sub.replace(/\+.*$/, "") : "png";
    }
  }
}

/**
 * Derive a sensible filename from a URL.
 * Uses the last path segment when it already has an image extension,
 * otherwise falls back to `reference-<index>.<ext>`.
 */
export function filenameFromUrl(
  url: string,
  index: number,
  mediaType?: string | null,
): string {
  if (!url.startsWith("data:")) {
    try {
      const { pathname } = new URL(url, "http://localhost");
      const segment = decodeURIComponent(pathname.split("/").pop() ?? "");
      if (segment && IMAGE_EXT_RE.test(segment)) return segment;
    } catch {
      // ignore malformed URLs and fall through to the generated name
    }
  }

  let resolvedMediaType = mediaType;
  if (!resolvedMediaType && url.startsWith("data:")) {
    const match = /^data:([^;,]+)/i.exec(url);
    resolvedMediaType = match?.[1];
  }
  return `reference-${index}.${extFromMediaType(resolvedMediaType)}`;
}

/** Save a Blob to disk via a throwaway object-URL anchor. Shared by the
 * image-reference download path below and other blob-download call sites
 * (e.g. plugin export) that don't need the URL/CORS fallback logic. */
export function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    triggerAnchorDownload(objectUrl, filename);
  } finally {
    // Revoke after a tick so the download has a chance to start.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

function triggerAnchorDownload(
  href: string,
  filename: string,
  openInNewTab = false,
): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  if (openInNewTab) {
    anchor.target = "_blank";
    anchor.rel = "noopener";
  }
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Decodes a `data:` URL to a Blob without `fetch` (the app CSP may not allow it), or null when it is malformed. */
function dataUrlToBlob(url: string): Blob | null {
  const match = /^data:([^,]*?)(;base64)?,(.*)$/is.exec(url);
  if (!match) return null;
  const type = match[1].split(";")[0].trim();
  try {
    if (match[2]) {
      const binary = atob(decodeURIComponent(match[3]));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type });
    }
    return new Blob([decodeURIComponent(match[3])], { type });
  } catch {
    return null;
  }
}

/** The last resort: let the browser attempt the download. Never throws. */
function anchorFallback(url: string, filename: string, openInNewTab: boolean): void {
  try {
    triggerAnchorDownload(url, filename, openInNewTab);
  } catch {
    // Nothing more can be done; a failed download must not become an unhandled rejection.
  }
}

/**
 * Download an image (data: or http(s)) to the user's disk. Never rejects.
 *
 * A `data:` URL is decoded in place and saved as a Blob (no `fetch`, so the page CSP cannot block it);
 * a malformed one falls back to an anchor download.
 * For http(s) URLs we try to `fetch` the bytes and save them via an object URL; if that fails (CORS,
 * network, or the page CSP `connect-src`) we fall back to a plain anchor download that lets the
 * browser handle the request directly.
 */
export async function downloadFile(url: string, filename: string): Promise<void> {
  if (url.startsWith("data:")) {
    try {
      const blob = dataUrlToBlob(url);
      if (blob) {
        saveBlob(blob, filename);
        return;
      }
    } catch {
      // fall through to the anchor
    }
    anchorFallback(url, filename, false);
    return;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    saveBlob(blob, filename);
  } catch {
    // CORS, CSP or network failure: let the browser attempt the download/open.
    anchorFallback(url, filename, true);
  }
}
