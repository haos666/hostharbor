const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const { join, resolve, dirname, basename, isAbsolute } = require('node:path')
const { app, BrowserWindow, utilityProcess, Tray } = require('electron')

const directory = process.argv[2], phase = process.argv[3], root = resolve(__dirname, '..')
if (!directory || !isAbsolute(directory) || basename(directory) !== 'data' || !basename(dirname(directory)).startsWith('hostharbor-i18n-native-') || !['initial', 'restart', 'system-restart'].includes(phase)) throw new Error('Requires the isolated temporary directory and phase from i18n-native-smoke.cjs')
let systemLanguages = ['zh-CN']
const preferredSystemLanguages = app.getPreferredSystemLanguages.bind(app)
app.getPreferredSystemLanguages = () => systemLanguages
app.setName('HostHarbor i18n verification')
app.setPath('userData', directory)
app.setPath('sessionData', join(directory, 'session'))
app.setAppPath(root)
const originalFork = utilityProcess.fork.bind(utilityProcess)
utilityProcess.fork = (entry, args, options) => originalFork(entry, options?.serviceName === 'HostHarbor Core' ? [args[0], '0'] : args, options)
let trayMenu
const originalMenu = Tray.prototype.setContextMenu
Tray.prototype.setContextMenu = function(menu) { trayMenu = menu; return originalMenu.call(this, menu) }
let window
const deadline = setTimeout(() => { console.error('FAIL: isolated i18n verification timed out'); app.exit(1) }, 60000)
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const evaluate = source => window.webContents.executeJavaScript(source)
async function wait(source) {
  const end = Date.now() + 10000
  while (Date.now() < end) { if (await evaluate(source)) return; await pause(50) }
  throw new Error(`Condition timed out: ${source}`)
}
async function click(text, selector = 'button') {
  assert.equal(await evaluate(`(() => { const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(item => item.textContent.trim() === ${JSON.stringify(text)}); if (!element) return false; element.click(); return true })()`), true, `Button: ${text}`)
  await pause(80)
}
async function closeDialog() {
  const count = await evaluate(`document.querySelectorAll('dialog[open]').length`)
  assert.ok(count > 0, 'Expected an open dialog')
  await evaluate(`(() => { const dialog = [...document.querySelectorAll('dialog[open]')].at(-1); const close = dialog.querySelector('.icon-button[aria-label]') ?? [...dialog.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel'); if (!close) throw new Error('No close or cancel control'); close.click() })()`)
  await wait(`document.querySelectorAll('dialog[open]').length < ${count}`)
}
async function screenshot(name) { writeFileSync(join(dirname(directory), 'screenshots', `${name}.png`), (await window.capturePage()).toPNG()) }
async function layout(name) {
  await screenshot(name)
  const result = await evaluate(`(() => { const main = document.querySelector('main'); const footer = document.querySelector('.operation-query-footer'); return { overflow: document.documentElement.scrollWidth > innerWidth, mainOverflow: main.scrollWidth > main.clientWidth + 1, footerFits: !footer || footer.getBoundingClientRect().right <= innerWidth, chinese: /[\\u3400-\\u9fff]/u.test(document.body.innerText.replaceAll('简体中文', '')) } })()`)
  assert.equal(result.overflow, false, `${name}: document overflow`)
  if (result.mainOverflow) console.log('Layout bounds:', await evaluate(`(() => { const main = document.querySelector('main'); const bounds = main.getBoundingClientRect(); return { width: main.clientWidth, scrollWidth: main.scrollWidth, children: [...main.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > bounds.right + 1).slice(0, 12).map(element => ({ tag: element.tagName, class: element.className, width: element.clientWidth, right: element.getBoundingClientRect().right, minWidth: getComputedStyle(element).minWidth })) } })()`))
  assert.equal(result.mainOverflow, false, `${name}: main overflow`)
  assert.equal(result.footerFits, true, `${name}: pagination overflow`)
  if (!name.includes('synthetic')) assert.equal(result.chinese, false, `${name}: untranslated static text`)
}
async function verify() {
  assert.ok(preferredSystemLanguages().every(language => typeof language === 'string'))
  await wait(`!!document.querySelector('aside nav button')`)
  if (phase === 'system-restart') {
    assert.equal(await evaluate(`document.documentElement.lang`), 'zh-CN')
    assert.deepEqual(await evaluate(`window.hostharbor.getLanguage().then(result => result.value)`), { preference: 'system', locale: 'zh-CN' })
    await click('系统设置', '.sidebar-footer button'); await click('语言', '.settings-navigation button')
    await wait(`!document.querySelector('.language-setting select').disabled`)
    assert.equal(await evaluate(`document.querySelector('.language-setting select').value`), 'system')
    await screenshot('chinese-follow-system')
    console.log('PASS: system preference survives restart and resolves the current OS language again')
    return
  }
  if (phase === 'restart') {
    assert.equal(await evaluate(`document.documentElement.lang`), 'en')
    assert.equal(await evaluate(`window.hostharbor.getStatus().then(value => value.vault)`), 'locked')
    assert.equal(trayMenu.getMenuItemById('open').label, 'Open HostHarbor')
    await click('Settings', '.sidebar-footer button')
    await click('Language', '.settings-navigation button')
    assert.equal(await evaluate(`document.querySelector('.language-setting select').value`), 'en')
    await evaluate(`(() => { const select = document.querySelector('.language-setting select'); select.value = 'zh-CN'; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await wait(`document.documentElement.lang === 'zh-CN'`)
    assert.equal(trayMenu.getMenuItemById('open').label, '打开 HostHarbor')
    assert.deepEqual(await evaluate(`window.hostharbor.getLanguage().then(value => value.value)`), { preference: 'zh-CN', locale: 'zh-CN' })
    systemLanguages = ['en-US']
    app.emit('browser-window-focus', {}, window)
    assert.equal(await evaluate(`document.documentElement.lang`), 'zh-CN')
    await evaluate(`(() => { const select = document.querySelector('.language-setting select'); select.value = 'system'; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await wait(`document.documentElement.lang === 'en'`)
    await screenshot('english-follow-system')
    systemLanguages = ['zh-TW']
    app.emit('browser-window-focus', {}, window)
    await wait(`document.documentElement.lang === 'zh-CN'`)
    assert.deepEqual(await evaluate(`window.hostharbor.getLanguage().then(value => value.value)`), { preference: 'system', locale: 'zh-CN' })
    console.log('PASS: explicit selection ignores OS changes; Follow system tracks OS changes on focus while locked')
    return
  }
  assert.equal(await evaluate(`document.documentElement.lang`), 'zh-CN')
  await click('系统设置', '.sidebar-footer button')
  await click('语言', '.settings-navigation button')
  assert.deepEqual(await evaluate(`(() => { const nav = document.querySelector('.settings-navigation'); return { groups: nav.querySelectorAll('section').length, margin: getComputedStyle(nav).marginTop, display: getComputedStyle(nav).display } })()`), { groups: 3, margin: '0px', display: 'block' })
  await wait(`!document.querySelector('.language-setting select').disabled`)
  assert.equal(await evaluate(`document.querySelector('.language-setting select').value`), 'system')
  assert.deepEqual(await evaluate(`[...document.querySelector('.language-setting select').options].map(option => option.value)`), ['system', ...Object.keys(require(join(root, 'src/shared/locales/languages.json')))])
  await evaluate(`(() => { const select = document.querySelector('.language-setting select'); select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await wait(`document.documentElement.lang === 'en'`)
  assert.equal(trayMenu.getMenuItemById('open').label, 'Open HostHarbor')
  window.setSize(960, 650)
  await layout('english-language-minimum-window')
  await click('Vault and locking', '.settings-navigation button')
  await click('Set password')
  await layout('english-security-dialog')
  await closeDialog()
  assert.equal(await evaluate(`(async () => { const api = window.hostharbor; const setup = await api.setupSecurity({ password: 'synthetic-i18n-password', recovery: 'synthetic-i18n-recovery' }); if (!setup.ok) return setup.error.code; const unlocked = await api.unlockVault('synthetic-i18n-password'); if (!unlocked.ok) return unlocked.error.code; return true })()`), true)
  await wait(`window.hostharbor.getStatus().then(status => status.vault === 'unlocked')`)
  await pause(2200)
  for (const tab of ['Vault and locking', 'Approval policy', 'Logs and storage', 'AI settings', 'Notifications']) {
    await click(tab, '.settings-navigation button')
    await pause(150)
    await layout('english-settings-' + tab.toLowerCase().replaceAll(' ', '-'))
  }
  await click('Servers', 'aside nav button')
  await click('Add server')
  await layout('english-server-dialog')
  await closeDialog()
  await click('Credentials', 'aside nav button')
  await click('Add credential')
  await layout('english-credential-dialog')
  await closeDialog()
  await click('Agent access', 'aside nav button')
  await click('Create access')
  await layout('english-access-dialog')
  await closeDialog()
  await click('Tool catalog')
  await layout('english-tool-catalog')
  for (const nav of ['Approvals', 'Operation logs']) {
    await click(nav, 'aside nav button')
    await pause(150)
    await layout('english-' + nav.toLowerCase().replaceAll(' ', '-'))
  }
  assert.equal(await evaluate(`(async () => { const api = window.hostharbor; const credential = await api.saveCredential({ name: 'SYNTHETIC credential', kind: 'password', password: 'synthetic-ssh-password' }); if (!credential.ok) return credential.error.code; const server = await api.saveServer({ name: '合成名称 SYNTHETIC i18n server with a long label', host: 'synthetic.invalid', port: 22, username: 'synthetic-user', credentialId: credential.value.id }); return server.ok ? true : server.error.code })()`), true)
  await click('Servers', 'aside nav button')
  await wait(`document.body.innerText.includes('合成名称')`)
  await layout('english-synthetic-server-list')
  await evaluate(`document.querySelector('.server-row button[aria-label^="Files for"]')?.click()`)
  await wait(`!!document.querySelector('.server-files-dialog')`)
  await pause(200)
  await layout('english-synthetic-file-host-verification-gate')
  await closeDialog()
  await evaluate(`document.querySelector('.server-row button[aria-label^="AI investigation"]')?.click()`)
  await wait(`!!document.querySelector('.dossier-dialog')`)
  await pause(150)
  await click('Add application')
  await layout('english-synthetic-application-dialog')
  await closeDialog()
  await closeDialog()
  assert.deepEqual(await evaluate(`window.hostharbor.getLanguage().then(result => result.value)`), { preference: 'en', locale: 'en' })
  console.log('PASS: locked switching, native tray, minimum-size English settings/navigation/forms/catalog/empty states and synthetic server/file/dossier dialogs')
}
app.on('browser-window-created', (_event, created) => {
  window = created
  created.webContents.once('did-finish-load', () => {
    void verify().then(() => { clearTimeout(deadline); app.quit() }).catch(error => { console.error('FAIL:', error.message); clearTimeout(deadline); app.once('will-quit', () => app.exit(1)); app.quit() })
  })
})
require(join(root, 'out/main/index.cjs'))
