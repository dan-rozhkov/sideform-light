import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { RouteFallback } from "@/components/RouteFallback";

// Three pages, each its own chunk: the agent chat, the trace viewer, the settings page.
const AgentPage = lazy(() => import("@/routes/AgentPage"));
const TracePage = lazy(() => import("@/routes/TracePage"));
const SettingsPage = lazy(() => import("@/routes/SettingsPage"));

const page = (element: React.JSX.Element) => <Suspense fallback={<RouteFallback />}>{element}</Suspense>;

export function AppRouter() {
  return (
    <BrowserRouter basename="/">
      <Routes>
        <Route path="/agent" element={page(<AgentPage />)} />
        <Route path="/trace/:id" element={page(<TracePage />)} />
        <Route path="/settings" element={page(<SettingsPage />)} />
        <Route path="*" element={<Navigate to="/agent" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
