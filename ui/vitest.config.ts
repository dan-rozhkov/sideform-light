import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  test: {
    // Inline the harness so vi.mock("ai") also reaches its imports.
    server: { deps: { inline: ["@sideform/agent-harness"] } },
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
