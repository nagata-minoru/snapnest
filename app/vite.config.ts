/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // node_modules は Spotlight 対策で node_modules.noindex へのシンボリックリンクのことがある。
    // 実体パスに解決されると依存パッケージと認識されず事前バンドルされないため、リンクのパスを保つ。
    preserveSymlinks: true,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
