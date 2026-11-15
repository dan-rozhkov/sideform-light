import { create } from "zustand";

import { getStoredLanguage, LANGUAGE_STORAGE_KEY, parseLanguage, systemLanguage, type Language } from "./languages";

/**
 * - "user": an explicit choice in Settings; written to localStorage and announced to the other views.
 * - "remote": followed from another same-origin document; never written back.
 */
export type LanguageSource = "user" | "remote";

interface LanguageState {
  language: Language;
  setLanguage: (language: Language, opts?: { source?: LanguageSource }) => void;
}

const CHANNEL_NAME = "pen-ui-language";
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/** `<html lang>`: screen readers and hyphenation use it, and the shell preloads report it to main. */
export function applyLanguage(language: Language) {
  if (typeof document !== "undefined") document.documentElement.lang = language;
}

export const useLanguageStore = create<LanguageState>((set) => {
  const initial = getStoredLanguage();
  applyLanguage(initial);
  return {
    language: initial,
    setLanguage: (language, opts) => {
      set({ language });
      applyLanguage(language);
      if ((opts?.source ?? "user") !== "user") return;
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      } catch {
        // Storage unavailable: the choice still applies to this view.
      }
      getChannel()?.postMessage({ language });
    },
  };
});

let syncInstalled = false;

/**
 * Every view (agent panel, trace and settings tabs are separate documents) follows a language chosen
 * in another one: `storage` fires only in the OTHER documents, BroadcastChannel never delivers to the
 * poster. Idempotent.
 */
export function installLanguageSync() {
  if (syncInstalled || typeof window === "undefined") return;
  syncInstalled = true;
  const follow = (value: unknown) => {
    const next = typeof value === "string" ? parseLanguage(value) : null;
    if (next && next !== useLanguageStore.getState().language) {
      useLanguageStore.getState().setLanguage(next, { source: "remote" });
    }
  };
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.storageArea !== localStorage) return;
    if (e.key !== null && e.key !== LANGUAGE_STORAGE_KEY) return;
    // Removed (or localStorage.clear()): back to the system language.
    follow(e.key === null || e.newValue === null ? systemLanguage() : e.newValue);
  });
  const ch = getChannel();
  if (ch) ch.onmessage = (e: MessageEvent<{ language?: unknown }>) => follow(e.data?.language);
}
