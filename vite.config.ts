import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import pkg from './package.json' with { type: 'json' }

// Tauri 版本配置：
// - dev server 端口 1420（Tauri 官方推荐标准端口，与 tauri.conf.json 中 devUrl 一致，彻底避开 517x 冲突）
// - 通过 Tauri 的 IPC 通道与 Rust 后端通信，不再依赖 Node.js 原生模块
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@napi-rs/canvas': path.resolve(import.meta.dirname, './src/lib/empty-module.ts'),
    },
  },
  // 防止 Vite 阻塞 Tauri 进程退出
  clearScreen: false,
  server: {
    port: Number(process.env.VITE_PORT || process.env.PORT || 1420),
    strictPort: true,
    host: '127.0.0.1',
    // Tauri 通过此端口加载前端
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    // Tauri 版不需要排除 Node.js 原生模块
    target: 'es2021',
    chunkSizeWarningLimit: 10000,
    rollupOptions: {
      external: [],
    },
  },
  test: {
    environment: 'jsdom',
    server: {
      deps: {
        // 内联所有依赖，避免预构建导致 vi.mock 无法拦截子路径
        inline: true,
      },
    },
  },
})
