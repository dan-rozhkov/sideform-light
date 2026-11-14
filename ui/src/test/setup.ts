// Global test setup (runs before every test file): the shell bridges are per-test fixtures.
import { afterEach } from "vitest";

afterEach(() => {
  delete window.penDesktop;
  delete window.penAgentPanel;
});
