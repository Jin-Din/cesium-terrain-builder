import { defineConfig } from "vite";

// @Jin Tauri 要求固定端口，构建产物输出到 dist 供 tauri.conf.json 引用
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: "dist",
    target: "es2021",
  },
});
