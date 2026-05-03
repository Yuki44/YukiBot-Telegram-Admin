import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During `npm run dev:web`, Vite serves the React app on 5173 and proxies /api/* to
// the Express server (started by `npm run dev` in the project root, port 3000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
