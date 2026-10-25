import { defineConfig } from 'vite'
import { resolve } from 'node:path'
export default defineConfig({ build: { ssr: resolve('scripts/client-smoke.ts'), outDir: 'work/client-smoke', rollupOptions: { output: { format: 'cjs', entryFileNames: 'smoke.cjs' } } } })
