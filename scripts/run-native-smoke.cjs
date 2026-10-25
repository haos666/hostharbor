const { spawnSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

// This process owns the temporary directory; delete only after Electron releases its userData locks.
const directory = mkdtempSync(join(tmpdir(), 'hostharbor-native-'))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
let status = 1
try {
  const result = spawnSync(require('electron'), [join(process.cwd(), 'work/native/smoke.cjs'), directory], {
    stdio: 'inherit', env, timeout: 60000,
  })
  status = result.status ?? 1
} catch { console.error('FAIL: Electron native test could not start') }
finally {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 })
    console.log('PASS: temporary native data removed after Electron exit')
  } catch {
    console.error('FAIL: temporary native data cleanup failed after Electron exit')
    status = 1
  }
}
process.exitCode = status
