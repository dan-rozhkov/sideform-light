import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearByokConfig, getByokConfig, setByokConnection } from "@/lib/byokProvider";
import { getModelOptions } from "@/lib/chatModels";

import { CustomProviderGroup } from "../CustomProviderGroup";

afterEach(() => {
  cleanup();
  clearByokConfig();
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function fillConnection() {
  fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://api.example.com/v1" } });
  fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-own" } });
}

describe("CustomProviderGroup", () => {
  it("shows the empty state and disables Load models until URL and key are set", () => {
    render(<CustomProviderGroup />);
    expect(screen.getByText("No models yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load models" }).hasAttribute("disabled")).toBe(true);
    fillConnection();
    expect(screen.getByRole("button", { name: "Load models" }).hasAttribute("disabled")).toBe(false);
  });

  it("loads models, adds one, and it appears in the model options", async () => {
    const fetchMock = stubFetch({ ok: true, models: [{ id: "gpt-a", contextWindow: 16000 }, { id: "gpt-b" }] });
    render(<CustomProviderGroup />);
    fillConnection();
    fireEvent.click(screen.getByRole("button", { name: "Load models" }));
    await screen.findByText("gpt-a");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("X-BYOK-Base-URL")).toBe("https://api.example.com/v1");
    expect(headers.get("X-BYOK-Key")).toBe("sk-own");

    fireEvent.change(screen.getByLabelText("Filter models"), { target: { value: "gpt-b" } });
    expect(screen.queryByText("gpt-a")).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter models"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Add gpt-a" }));
    expect(getModelOptions().some((o) => o.value === "byok/gpt-a" && o.contextWindow === 16000)).toBe(true);
    expect(getByokConfig().baseUrl).toBe("https://api.example.com/v1");
    expect(screen.getByRole("button", { name: "Added gpt-a" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Remove gpt-a" }));
    expect(getModelOptions().some((o) => o.value === "byok/gpt-a")).toBe(false);
  });

  it("adds a model by ID manually and ignores duplicates", () => {
    render(<CustomProviderGroup />);
    fillConnection();
    const input = screen.getByLabelText("Model ID");
    fireEvent.change(input, { target: { value: "  my-model " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(getByokConfig().models).toEqual([{ id: "my-model" }]);
    fireEvent.change(input, { target: { value: "my-model" } });
    expect(screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);
  });

  it.each([
    [{ ok: false, reason: "invalid_key" }, 200, "The provider rejected this key."],
    [{ ok: false, reason: "no_model_list" }, 200, "This provider has no model list. Add a model ID manually."],
    [{ ok: false, reason: "upstream_error" }, 200, "Could not reach the provider. Check the base URL."],
    [{ code: "byok_base_url_invalid", error: "x" }, 400, "Base URL must be a public https:// address."],
    [{ error: "rate" }, 429, "Too many requests. Try again in a minute."],
  ])("shows an error for %j", async (body, status, message) => {
    stubFetch(body, status);
    render(<CustomProviderGroup />);
    fillConnection();
    fireEvent.click(screen.getByRole("button", { name: "Load models" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(message));
  });

  it("removes the whole configuration", () => {
    render(<CustomProviderGroup />);
    fillConnection();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(getByokConfig().apiKey).toBe("sk-own");
    fireEvent.click(screen.getByRole("button", { name: "Remove provider" }));
    expect(getByokConfig()).toEqual({ baseUrl: "", apiKey: "", models: [] });
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  });

  it("disables every add path until a valid connection is present", async () => {
    stubFetch({ ok: true, models: [{ id: "gpt-a" }] });
    render(<CustomProviderGroup />);
    fireEvent.change(screen.getByLabelText("Model ID"), { target: { value: "m" } });
    expect(screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);
    fillConnection();
    expect(screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Load models" }));
    await screen.findByText("gpt-a");
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "http://example.com" } });
    // The loaded list is dropped as soon as the URL changes.
    expect(screen.queryByText("gpt-a")).toBeNull();
    expect(screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);
  });

  it("rejects an invalid base URL inline and does not save or load", () => {
    const fetchMock = stubFetch({ ok: true, models: [] });
    render(<CustomProviderGroup />);
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "http://example.com/v1" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-own" } });
    expect(screen.getByRole("alert").textContent).toBe("Base URL must be a public https:// address.");
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Load models" }).hasAttribute("disabled")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getByokConfig().baseUrl).toBe("");
  });

  it("rejects a key with characters that cannot be sent", () => {
    render(<CustomProviderGroup />);
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://api.example.com/v1" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-ключ" } });
    expect(screen.getByRole("alert").textContent).toBe(
      "The key has characters that can't be sent. Paste it again.",
    );
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("normalizes the saved base URL", () => {
    render(<CustomProviderGroup />);
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://api.example.com/v1/" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-own" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(getByokConfig().baseUrl).toBe("https://api.example.com/v1");
  });

  it("resets the inputs when the stored connection is removed elsewhere", () => {
    render(<CustomProviderGroup />);
    fillConnection();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    act(() => clearByokConfig());
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Base URL") as HTMLInputElement).value).toBe("");
  });
  it("does not overwrite a saved connection when Add is used with different typed values", () => {
    setByokConnection("https://old.example.com/v1", "sk-old");
    render(<CustomProviderGroup />);
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://new.example.com/v1" } });
    fireEvent.change(screen.getByLabelText("Model ID"), { target: { value: "m" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(getByokConfig()).toEqual({ baseUrl: "https://old.example.com/v1", apiKey: "sk-old", models: [] });
    expect(screen.getByRole("status").textContent).toBe("Save the new connection first.");
    // After Save, Add works.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(getByokConfig().models).toEqual([{ id: "m" }]);
    expect(getByokConfig().baseUrl).toBe("https://new.example.com/v1");
  });

  it("shows Saved only while the inputs match the stored connection, otherwise Unsaved changes", () => {
    render(<CustomProviderGroup />);
    fillConnection();
    expect(screen.getByRole("status").textContent).toBe("Unsaved changes");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("status").textContent).toBe("Saved on this computer.");
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-other" } });
    expect(screen.getByRole("status").textContent).toBe("Unsaved changes");
  });

  function stubHangingFetch() {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        signals.push(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }),
    );
    return signals;
  }

  it("aborts an in-flight load on unmount", () => {
    const signals = stubHangingFetch();
    const { unmount } = render(<CustomProviderGroup />);
    fillConnection();
    fireEvent.click(screen.getByRole("button", { name: "Load models" }));
    expect(signals[0].aborted).toBe(false);
    unmount();
    expect(signals[0].aborted).toBe(true);
  });

  it("aborts an in-flight load on Remove without showing an error", async () => {
    const signals = stubHangingFetch();
    render(<CustomProviderGroup />);
    fillConnection();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Load models" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove provider" }));
    expect(signals[0].aborted).toBe(true);
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
