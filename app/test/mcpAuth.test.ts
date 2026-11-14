import { describe, expect, it } from "vitest";
import { constantTimeEqual, extractBearerToken } from "../src/main/mcp/auth";

describe("mcp auth helpers", () => {
  it("constantTimeEqual compares equal strings, rejects different ones and different lengths", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
  it("extractBearerToken takes a Bearer token and nothing else", () => {
    expect(extractBearerToken("Bearer tok")).toBe("tok");
    expect(extractBearerToken("bearer tok")).toBe("tok");
    expect(extractBearerToken(["Bearer a", "Bearer b"])).toBe("a");
    expect(extractBearerToken("Basic tok")).toBeNull();
    expect(extractBearerToken("Bearer ")).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });
});
