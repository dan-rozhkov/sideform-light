import type { BrowseTraceDom } from "@sideform/browser-agent/agent/session";

export const DOM_UNAVAILABLE = "DOM snapshot is not available for this trace.";

/** The text of a `data:text/...;base64,` URL (UTF-8). Throws on anything else. */
export function decodeTextDataUrl(src: string): string {
  const match = /^data:text\/(?:html|plain)(?:;[^,]*)?;base64,(.*)$/is.exec(src);
  if (!match) throw new Error("The DOM snapshot has an unknown format.");
  const binary = atob(match[1]!);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** The snapshot text: a data URL (the shell inlines it) is decoded locally; anything else is unavailable. */
export async function readDomText(dom: BrowseTraceDom): Promise<string> {
  if (dom.src.startsWith("data:")) return decodeTextDataUrl(dom.src);
  throw new Error(DOM_UNAVAILABLE);
}
