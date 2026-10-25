const { spawnSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const evidence = mkdtempSync(join(tmpdir(), 'hostharbor-i18n-native-'))
const directory = join(evidence, 'data')
mkdirSync(directory); mkdirSync(join(evidence, 'screenshots'))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
let status = 0
try {
  for (const phase of ['initial', 'restart', 'system-restart']) {
    const result = spawnSync(require('electron'), [join(__dirname, 'i18n-native-runner.cjs'), directory, phase], { stdio: 'inherit', env, timeout: 70000 })
    if (result.status !== 0) { console.error('FAIL: i18n verification', phase, 'screenshots:', join(evidence, 'screenshots')); status = 1; break }
  }
} finally { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }) }
if (!status) console.log('PASS: isolated i18n verification; temporary app data removed; screenshots:', join(evidence, 'screenshots'))
process.exitCode = status
