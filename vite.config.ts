import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  plugins: [solid({ hot: mode !== "test" }), tailwindcss()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/index.tsx"],
      thresholds: {
        statements: 40,
        branches: 33,
        functions: 40,
        lines: 41,
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  optimizeDeps: {
    entries: ["index.html"],
    exclude: ["tauri-plugin-snap-layout"],
  },
  build: {
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
    },
  },
  clearScreen: false,
}));
