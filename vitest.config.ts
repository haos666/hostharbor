import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Shared CI runners have a small CPU budget; avoid crypto/SSH worker contention.
  test: { environment: 'node', include: ['tests/**/*.test.ts'], ...(process.env.CI ? { maxWorkers: 2, testTimeout: 20000 } : {}) },
})
