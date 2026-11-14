import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = "http://127.0.0.1:4100";

export default defineConfig({
  root: ".",
  plugins: [react()],
  server: { port: 4101, strictPort: true, proxy: { "/api": API, "/git": API } },
  preview: { port: 4101, strictPort: true, proxy: { "/api": API, "/git": API } },
  build: { outDir: "dist/web", emptyOutDir: true },
});
