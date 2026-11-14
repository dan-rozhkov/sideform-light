import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentPanelTraceTabsBridge } from "../agentPanel";

afterEach(() => {
  delete window.penAgentPanel;
});

describe("getAgentPanelTraceTabsBridge", () => {
  it("is undefined without the panel", () => {
    expect(getAgentPanelTraceTabsBridge()).toBeUndefined();
  });

  it("needs both listTabs and read", () => {
    window.penAgentPanel = { version: 3, traces: { save: vi.fn(), open: vi.fn(), listTabs: vi.fn() } };
    expect(getAgentPanelTraceTabsBridge()).toBeUndefined();
    window.penAgentPanel = { version: 3, traces: { save: vi.fn(), open: vi.fn(), listTabs: vi.fn(), read: vi.fn() } };
    expect(getAgentPanelTraceTabsBridge()).toBeDefined();
  });
});
