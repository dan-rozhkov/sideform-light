import http from "node:http";
import type { AddressInfo } from "node:net";

/** A page of the stub ui: `#ready` carries `marker`. */
const page = (title: string, marker: string): string => `<!doctype html><title>${title}</title><h1 id="ready">${marker}</h1>`;

/**
 * An http server that stands in for the bundled ui in e2e (the shell's SIDEFORM_LIGHT_UI_URL points at it, so
 * no ui/dist is needed): `/agent`, `/settings` and `/trace/<id>` each answer a tiny page.
 */
export async function startStubUi(): Promise<{ url: string; server: http.Server; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    res.setHeader("content-type", "text/html");
    if (path.startsWith("/settings")) res.end(page("Stub Settings", "stub-settings"));
    else if (path.startsWith("/trace/")) res.end(page("Stub Trace", "stub-trace"));
    else res.end(page("Stub Agent", "stub-agent"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, server, close: () => new Promise<void>((r) => server.close(() => r())) };
}
