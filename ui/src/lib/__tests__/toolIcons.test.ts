import { describe, it, expect } from "vitest";
import { toolDisplayNames, getToolDisplayName } from "../toolDisplayNames";
import { getToolIcon } from "../toolIcons";
import { toolHandlers } from "../toolRegistry";

describe("toolIcons", () => {
  const generic = getToolIcon("definitely_not_a_tool");

  it("has a dedicated icon for every named tool", () => {
    expect(Object.keys(toolDisplayNames).filter((name) => getToolIcon(name) === generic)).toEqual([]);
  });

  it("has a readable name and a dedicated icon for every tool the registry handles", () => {
    const unreadable = Object.keys(toolHandlers).filter(
      (name) => !toolDisplayNames[name] || getToolDisplayName(name) === name || getToolDisplayName(name).includes("_"),
    );
    expect(unreadable).toEqual([]);
    expect(Object.keys(toolHandlers).filter((name) => getToolIcon(name) === generic)).toEqual([]);
  });

  it("falls back to the generic icon for an unknown tool", () => {
    expect(getToolIcon("definitely_not_a_tool")).toBe(generic);
  });
});
