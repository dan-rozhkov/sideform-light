import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Sideform Light UI: one HTML entry, served from app://sideform by the Electron shell
// (or from this dev server on :5174 via SIDEFORM_LIGHT_UI_URL).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "");
  const devBackend = env.VITE_DEV_BACKEND_URL || "http://localhost:3001";
  return {
  base: "/",
  plugins: [tailwindcss(), react()],
  // `/api` goes to the backend (the app build proxies it in the shell instead). http-proxy streams
  // responses as they arrive, so SSE chat streams are not buffered.
  server: { port: 5174, strictPort: true, proxy: { "/api": { target: devBackend, changeOrigin: true } } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react-vendor";
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      react: path.resolve(import.meta.dirname, "node_modules/react"),
      "react-dom": path.resolve(import.meta.dirname, "node_modules/react-dom"),
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  optimizeDeps: { include: ["react", "react-dom"] },
};
});
