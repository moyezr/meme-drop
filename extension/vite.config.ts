import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

const apiBaseUrl = process.env.VITE_API_BASE_URL || "http://localhost:3001";
const apiOrigin = new URL(apiBaseUrl).origin;
const apiHostPermission = `${apiOrigin}/*`;
const extensionManifest = {
  ...manifest,
  host_permissions: Array.from(
    new Set([...(manifest.host_permissions || []), apiHostPermission])
  ),
};

export default defineConfig({
  plugins: [react(), crx({ manifest: extensionManifest })],
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
});
