import { defineConfig } from "vite";
import type { PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

// Fix for production build: import.meta.dirname is undefined in bundled code
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(async ({ mode }) => {
  const isProduction = mode === "production";
  const plugins: PluginOption[] = [react()];

  if (!isProduction) {
    const [{ default: runtimeErrorOverlay }, cartographerModule, devBannerModule] =
      await Promise.all([
        import("@replit/vite-plugin-runtime-error-modal"),
        process.env.REPL_ID !== undefined
          ? import("@replit/vite-plugin-cartographer")
          : Promise.resolve(null),
        process.env.REPL_ID !== undefined
          ? import("@replit/vite-plugin-dev-banner")
          : Promise.resolve(null),
      ]);

    plugins.push(runtimeErrorOverlay());

    if (process.env.REPL_ID !== undefined && cartographerModule && devBannerModule) {
      plugins.push(cartographerModule.cartographer());
      plugins.push(devBannerModule.devBanner());
    }
  }

  return {
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "client", "src"),
        "@shared": path.resolve(__dirname, "shared"),
        "@assets": path.resolve(__dirname, "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      include: ["react", "react-dom"],
    },
    root: path.resolve(__dirname, "client"),
    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port: 5050,
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
  };
});
