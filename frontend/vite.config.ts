import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run build` writes to ../static/dist, which FastAPI serves at / and /ask.
// `npm run dev` serves on :5173 and forwards API calls to the Python server.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../static/dist", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
  },
});
