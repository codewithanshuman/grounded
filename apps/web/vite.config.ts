import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const apiTarget = process.env.VERDANT_API_URL ?? "http://localhost:8787";
const staticDemo = process.env.VERDANT_STATIC_BUILD === "1";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/ws": { target: apiTarget, ws: true },
    },
  },
  define: {
    __VERDANT_API__: JSON.stringify(process.env.VERDANT_API_URL ?? ""),
    __VERDANT_STATIC__: JSON.stringify(staticDemo),
  },
  ...(staticDemo ? { build: { outDir: "../../dist", emptyOutDir: true } } : {}),
});
