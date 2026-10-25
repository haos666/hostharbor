import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url)), directory = join(root, 'resources/branding')
mkdirSync(directory, { recursive: true })
const mark = readFileSync(join(directory, 'mark.svg'), 'utf8')
const shapes = mark.slice(mark.indexOf('>') + 1, mark.lastIndexOf('</svg>'))
const whiteShapes = shapes.replaceAll('#A2E7CD', '#FFFFFF')
const app = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect x="88" y="88" width="848" height="848" rx="190" fill="#101619"/><g transform="translate(192 192) scale(2.5)">${whiteShapes}</g></svg>`
writeFileSync(join(directory, 'app-icon.svg'), app + '\n')
const wordmark = readFileSync(join(directory, 'wordmark.svg'), 'utf8')
const wordmarkBody = wordmark.slice(wordmark.indexOf('>') + 1, wordmark.lastIndexOf('</svg>'))
const [, , wordWidth, wordHeight] = wordmark.match(/viewBox="(0) (0) (\d+) (\d+)"/).slice(1).map(Number)
for (const [name, color] of [['light', '#F4F5F1'], ['dark', '#101619']]) {
  writeFileSync(join(directory, `wordmark-${name}.svg`), wordmark.replaceAll('#101619', color))
  const symbol = shapes.replaceAll('#A2E7CD', color), lettering = wordmarkBody.replaceAll('#101619', color)
  writeFileSync(join(directory, `mark-${name}.svg`), mark.replaceAll('#A2E7CD', color))
  writeFileSync(join(directory, `lockup-${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1312 256">${symbol}<svg x="288" y="56" width="1024" height="144" viewBox="0 0 ${wordWidth} ${wordHeight}">${lettering}</svg></svg>\n`)
  writeFileSync(join(directory, `lockup-stacked-${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 620"><g transform="translate(308 0) scale(1.5)">${symbol}</g><svg x="79" y="450" width="842" height="118" viewBox="0 0 ${wordWidth} ${wordHeight}">${lettering}</svg></svg>\n`)
}
function png(svg, size) { return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng() }
const images = new Map([16, 24, 32, 48, 64, 128, 256, 512, 1024].map(size => [size, png(app, size)]))
writeFileSync(join(directory, 'icon.png'), images.get(1024))
const template = mark.replaceAll('#A2E7CD', '#000000')
writeFileSync(join(directory, 'trayTemplate.png'), png(template, 18))
writeFileSync(join(directory, 'trayTemplate@2x.png'), png(template, 36))
writeFileSync(join(directory, 'tray.png'), png(mark, 32))
// PNG-compressed ICO entries supported by modern Windows; build without platform-specific tools.
const sizes = [16, 24, 32, 48, 64, 128, 256], header = Buffer.alloc(6 + sizes.length * 16)
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
let offset = header.length
sizes.forEach((size, n) => {
  const start = 6 + n * 16, bytes = images.get(size)
  header[start] = size === 256 ? 0 : size; header[start + 1] = header[start]
  header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6)
  header.writeUInt32LE(bytes.length, start + 8); header.writeUInt32LE(offset, start + 12); offset += bytes.length
})
writeFileSync(join(directory, 'icon.ico'), Buffer.concat([header, ...sizes.map(size => images.get(size))]))
// ICNS PNG chunks, including standard 1x and Retina sizes.
const chunks = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]].map(([type, size]) => {
  const image = images.get(size), chunk = Buffer.alloc(8)
  chunk.write(type, 0, 'ascii'); chunk.writeUInt32BE(image.length + 8, 4)
  return Buffer.concat([chunk, image])
})
const icns = Buffer.alloc(8); icns.write('icns', 0, 'ascii'); icns.writeUInt32BE(8 + chunks.reduce((n, chunk) => n + chunk.length, 0), 4)
writeFileSync(join(directory, 'icon.icns'), Buffer.concat([icns, ...chunks]))
console.log('Generated app icons, tray templates and reusable brand lockups from mark.svg / wordmark.svg')

writeFileSync(join(directory, 'approval-badge.png'), new Resvg(readFileSync(join(directory, 'approval-badge.svg'), 'utf8')).render().asPng())
