// Ready-to-copy client configs for the MCP bridge (Settings > MCP).

export function hermesSnippet(url: string, token: string): string {
  return `mcp_servers:\n  sideform:\n    url: "${url}"\n    headers:\n      Authorization: "Bearer ${token}"`;
}

export function claudeCodeSnippet(url: string, token: string): string {
  return `claude mcp add --transport http sideform ${url} --header "Authorization: Bearer ${token}"`;
}
