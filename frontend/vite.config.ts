import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/health": {
        target: "http://delineate-app:3000",
        changeOrigin: true,
      },
      "/v1": {
        target: "http://delineate-app:3000",
        changeOrigin: true,
      },
    },
  },
});
