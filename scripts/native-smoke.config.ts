import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: resolve('scripts/native-smoke.ts'),
    outDir: 'work/native',
    rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: 'smoke.cjs' } },
  },
})
