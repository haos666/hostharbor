import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
const directory = new URL('../docs/images/', import.meta.url)
mkdirSync(directory, { recursive: true })
const brand = readFileSync(new URL('../resources/branding/lockup-light.svg', import.meta.url), 'utf8').replace('<svg ', '<svg x="80" y="100" width="1120" height="218" ')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640"><rect width="1280" height="640" fill="#101619"/><rect x="1" y="1" width="1278" height="638" rx="28" fill="none" stroke="#30473f" stroke-width="2"/>${brand}<text x="88" y="400" font-family="Arial, sans-serif" font-size="39" fill="#A2E7CD">Local SSH workspace for AI agents</text><text x="88" y="465" font-family="Arial, sans-serif" font-size="25" fill="#97ADA3">Credentials · Controlled MCP access · Approval · Replay</text><text x="88" y="560" font-family="Arial, sans-serif" font-size="22" fill="#97ADA3">macOS · Intel + Apple Silicon · Apache-2.0</text></svg>`
writeFileSync(new URL('social-preview.svg', directory), svg+'\n')
writeFileSync(new URL('social-preview.png', directory), new Resvg(svg).render().asPng())
