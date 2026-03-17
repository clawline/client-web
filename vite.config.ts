import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: resolve(__dirname, "..", "public"),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:19080",
      "/healthz": "http://localhost:19080",
    },
  },
});
