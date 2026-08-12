import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };
import { resolveApiBaseUrl } from "./build-config.ts";

export default defineConfig(({ mode }) => {
  const apiBaseUrl = resolveApiBaseUrl(mode, process.env.VITE_API_BASE_URL);
  const apiOrigin = new URL(apiBaseUrl).origin;
  const apiHostPermission = `${apiOrigin}/*`;
  const extensionManifest = {
    ...manifest,
    host_permissions: Array.from(
      new Set([...(manifest.host_permissions || []), apiHostPermission])
    ),
  };

  return {
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBaseUrl),
    },
    plugins: [react(), crx({ manifest: extensionManifest })],
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
  };
});
