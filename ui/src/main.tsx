import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RootErrorBoundary } from "@/components/RootErrorBoundary";
import { loadModels } from "@/lib/chatModels";
import { applyStoredUITheme, installUIThemeBroadcastSync, installUIThemeStorageSync } from "@/lib/uiTheme";

import "./index.css";
import { AppRouter } from "./AppRouter";

// Apply the stored theme before React mounts (no flash), and follow theme switches made in other
// same-origin documents (the agent panel, trace and settings tabs are separate views).
applyStoredUITheme();
installUIThemeStorageSync();
installUIThemeBroadcastSync();

// Start the model list request before the first render: the chat holds its first send while it is in flight.
void loadModels();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <AppRouter />
    </RootErrorBoundary>
  </StrictMode>,
);
