// The chat model list and per-model capabilities. The only models in Light are the
// ones on the user's own provider (`byok/<id>`, src/lib/byokProvider.ts): the local
// backend has no model of its own, so GET /api/models answers an empty list and
// `default: null`. A server list is still parsed (a dev backend may serve one), but
// nothing is ever preselected: with no usable model the panel shows its
// "provider required" state. The user's pick travels with every turn as
// `model` (see useDesignChat's buildChatBody).
//
// `supportsVision` reports NATIVE vision only. Whether an image may be
// attached at all is `canSendImages` below, which also allows a
// non-native-vision model when the backend reports `visionFallback` (an
// auxiliary vision model describes the image as text server-side).

import { apiFetch } from "@/lib/apiBase";
import { byokModelValue, getByokConfig, isByokConfigured, isByokModel, subscribeByok } from "@/lib/byokProvider";

export interface ChatModelOption {
  value: string;
  label: string;
  supportsVision: boolean;
  /**
   * The model's context window in tokens, when the backend reports one.
   * Absent (not `undefined`-valued, actually missing) for a model the
   * backend hasn't sized — same "include the key only when we have it"
   * convention as `requiresUserKey` above. Drives ContextMeter
   * (components/chat/ContextMeter.tsx); a model with no known window never
   * shows a meter rather than guessing at a default.
   */
  contextWindow?: number;
  /** True for a model the user added under their own provider (src/lib/byokProvider.ts). */
  byok?: true;
}

// Backend wire shape (pen-editor-backend GET /api/models).
interface ModelsResponse {
  models: {
    id: string;
    label: string;
    supportsVision: boolean;
    requiresUserKey?: boolean;
    contextWindow?: number;
  }[];
  /** null when the backend has no model of its own (always the case for the local backend). */
  default?: string | null;
  visionFallback?: boolean;
}

let currentModels: ChatModelOption[] = [];
// Whether the backend has an auxiliary vision model configured, so it can
// accept images even for a model without native vision (it describes them as
// text server-side). Default false — conservative until the backend confirms
// it, since we can't promise a capability we haven't verified.
let visionFallback = false;
let loadPromise: Promise<void> | null = null;
let modelsSettled = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

// Backend list + the user's own-provider models. Rebuilt only when an input changes (by reference),
// so the array stays stable for useSyncExternalStore. An own-provider option's label is its bare id; the
// localized "Own key" suffix is added where it renders (ChatPanel).
let mergedFor: { models: ChatModelOption[]; byok: ReturnType<typeof getByokConfig> } | null = null;
let mergedOptions: ChatModelOption[] = currentModels;

/** Every model the user may pick: the backend's list plus their own-provider models. */
export function getModelOptions(): ChatModelOption[] {
  const byok = getByokConfig();
  if (mergedFor && mergedFor.models === currentModels && mergedFor.byok === byok) {
    return mergedOptions;
  }
  mergedFor = { models: currentModels, byok };
  mergedOptions =
    byok.models.length === 0
      ? currentModels
      : [
          ...currentModels,
          ...byok.models.map(
            (m): ChatModelOption => ({
              value: byokModelValue(m.id),
              label: m.id,
              supportsVision: false,
              byok: true,
              ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
            }),
          ),
        ];
  return mergedOptions;
}

/** The options `canUseModel` accepts: an own-provider model with a working connection, or a listed server model. The ONE usability rule. */
function usableOptions(): ChatModelOption[] {
  return getModelOptions().filter((o) => canUseModel(o.value));
}

/**
 * The model a selection falls back to: the first usable one, preferring an own-provider (`byok/`) model, or "" when
 * none is usable. There is no server default, so nothing is ever preselected for a user without a provider.
 */
export function getDefaultModel(): string {
  const usable = usableOptions();
  return (usable.find((o) => o.byok) ?? usable[0])?.value ?? "";
}

/** Whether at least one model can run a turn right now (same rule as getDefaultModel: some option passes canUseModel). */
export function hasUsableModel(): boolean {
  return usableOptions().length > 0;
}

/** Whether `model` reads images itself, without the backend's text fallback. */
export function modelSupportsVision(model: string): boolean {
  // An id we don't know (a stale selection, or a model the backend added
  // after this bundle was built) is assumed vision-capable, matching the
  // backend's own convention for an unlisted id.
  // An own-provider model is never vision-capable as far as we know (its endpoint is arbitrary);
  // images still go through canSendImages' visionFallback.
  if (isByokModel(model)) return false;
  return getModelOptions().find((option) => option.value === model)?.supportsVision ?? true;
}

// Whether the app may let the user attach an image for this model at all.
// True if the model has native vision, OR if the backend has an auxiliary
// vision model configured (visionFallback) — in that case the image is still
// sent, but the backend converts it to a text description before it reaches
// the model, so fine visual detail (exact colors, small text, precise
// layout) is lost even though the image itself is "read".
export function canSendImages(model: string): boolean {
  return modelSupportsVision(model) || visionFallback;
}

/**
 * `model`'s context window in tokens, or `undefined` when the backend
 * hasn't reported one (an id it doesn't know, or an older backend that
 * predates this field). Never a guessed default — ContextMeter treats
 * `undefined` as "don't show a meter" rather than picking a number.
 */
export function getModelContextWindow(model: string): number | undefined {
  return getModelOptions().find((option) => option.value === model)?.contextWindow;
}

// Whether `model` is currently selectable at all: known to the backend list (an unknown id is harmless to
// pick, but there is no reason to let the picker show one that isn't real). Used by reconcileModels()
// (chatStore.ts) to decide whether a saved selection must fall back to the default.
// An own-provider model is usable only while a base URL and key are configured.
export function canUseModel(value: string): boolean {
  if (!value) return false;
  const option = getModelOptions().find((o) => o.value === value);
  if (!option) return false;
  if (option.byok) return isByokConfigured();
  return true;
}

/** Whether a picker row renders disabled: an own-provider model without a working connection. Same rule as canUseModel for an own-provider option. */
export function isModelOptionLocked(option: ChatModelOption): boolean {
  return Boolean(option.byok) && !isByokConfigured();
}

// Subscription surface for React (useSyncExternalStore) so the picker and
// capability-driven controls re-render when the backend metadata lands.
export function subscribeModels(listener: () => void): () => void {
  listeners.add(listener);
  const offByok = subscribeByok(listener);
  return () => {
    listeners.delete(listener);
    offByok();
  };
}

/** True once loadModels() has settled (the backend list, or an empty one after a failure, is final). */
export function areModelsLoaded(): boolean {
  return modelsSettled;
}

// Fetch the model metadata from the backend once. Safe to call repeatedly —
// the in-flight promise is shared. On any failure the list stays empty.
export function loadModels(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await apiFetch("/api/models");
      if (!res.ok) return;
      const data = (await res.json()) as ModelsResponse | null;
      if (Array.isArray(data?.models)) {
        // Models that need the user's own key (OpenCode BYOK) are not offered: Light has no key dialog.
        currentModels = data.models
          .filter((m) => !m.requiresUserKey)
          .map((m) => ({
            value: m.id,
            label: m.label,
            supportsVision: m.supportsVision,
            ...(typeof m.contextWindow === "number" ? { contextWindow: m.contextWindow } : {}),
          }));
      }
      visionFallback = data?.visionFallback ?? false;
    } catch {
      // Network/parse error — keep the empty list.
    } finally {
      modelsSettled = true;
      notify();
    }
  })();
  return loadPromise;
}
