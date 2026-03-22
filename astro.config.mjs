import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  integrations: [react()],
  server: {
    port: 1420,
  },
  vite: {
    plugins: [tailwindcss()],
    clearScreen: false,
    server: {
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
  },
});
