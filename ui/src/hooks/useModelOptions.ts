import { useSyncExternalStore } from "react";
import { getModelOptions, hasUsableModel, subscribeModels, type ChatModelOption } from "@/lib/chatModels";

// Reactive view of the backend-served model list. Re-renders when loadModels()
// resolves and swaps the cached list in.
export function useModelOptions(): ChatModelOption[] {
  return useSyncExternalStore(subscribeModels, getModelOptions, getModelOptions);
}

/** Whether any model can run a turn right now. False until the user adds a provider with at least one model. */
export function useHasUsableModel(): boolean {
  return useSyncExternalStore(subscribeModels, hasUsableModel, hasUsableModel);
}
