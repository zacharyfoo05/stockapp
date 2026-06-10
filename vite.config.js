import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forwards /api/* from the Vite dev server to the Node proxy
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
