import { describe, expect, it } from "vitest";
import { mapChatError } from "@/lib/chatErrors";

describe("mapChatError", () => {
  it.each([
    ['{"error":"provider_required"}'],
    ['{"error":"This model needs your own base URL and API key.","code":"byok_key_required"}'],
  ])("maps %s to the add-a-provider message", (body) => {
    expect(mapChatError(new Error(body)).message).toBe("Add a model provider in Settings > Model.");
  });

  it("maps local_backend_unavailable to the restart message", () => {
    expect(mapChatError(new Error('{ "error": "local_backend_unavailable" }')).message).toBe(
      "The local agent service is not running. Restart Sideform Light.",
    );
  });

  it.each([
    '{"error":"local_backend_unavailable"}',
    '{"error":"local_backend_unavailable","status":502}',
    '  { "error": "local_backend_unavailable" }  ',
  ])("maps %s to the restart message whatever the HTTP status (502 today, 503 before)", (body) => {
    expect(mapChatError(new Error(body)).message).toBe("The local agent service is not running. Restart Sideform Light.");
  });

  it("leaves any other error untouched", () => {
    const err = new Error('{"error":"rate"}');
    expect(mapChatError(err)).toBe(err);
    const plain = new Error("boom");
    expect(mapChatError(plain)).toBe(plain);
  });
});
