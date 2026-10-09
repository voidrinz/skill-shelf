import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

import { brandMark } from '../packages/ui/src/brand-mark.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const desktopBuild = join(root, 'desktop/build')
const websitePublic = join(root, 'website/public')

function svg(padded = false) {
  const { size, radius, colors, books } = brandMark
  const inset = padded ? size / 8 : 0
  const viewBox = `${-inset} ${-inset} ${size + inset * 2} ${size + inset * 2}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}"><rect width="${size}" height="${size}" rx="${radius}" fill="${colors.ink}"/>${books.map((book) => `<path d="${book.path}" fill="${colors[book.color]}"/>`).join('')}</svg>\n`
}

function devSvg(padded = false) {
  const source = svg(padded).trimEnd()
  return source.replace(
    '</svg>',
    '<rect x="122" y="152" width="86" height="48" rx="12" fill="#2c2c2a"/><text x="165" y="184" fill="#f8f8f6" font-family="sans-serif" font-size="24" font-weight="700" text-anchor="middle">DEV</text></svg>'
  )
}

function png(source, size) {
  return new Resvg(source, { fitTo: { mode: 'width', value: size } })
    .render()
    .asPng()
}

function ico(source, sizes) {
  const images = sizes.map((size) => png(source, size))
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16
    const image = images[index]
    header.writeUInt8(size === 256 ? 0 : size, entry)
    header.writeUInt8(size === 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(image.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += image.length
  })
  return Buffer.concat([header, ...images])
}

function icns(source) {
  // Include standard and Retina representations in the native ICNS container.
  const entries = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
    ['ic11', 32],
    ['ic12', 64],
    ['ic13', 256],
    ['ic14', 512],
  ].map(([type, size]) => {
    const image = png(source, size)
    const header = Buffer.alloc(8)
    header.write(type, 0, 4, 'ascii')
    header.writeUInt32BE(image.length + 8, 4)
    return Buffer.concat([header, image])
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(
    8 + entries.reduce((sum, entry) => sum + entry.length, 0),
    4
  )
  return Buffer.concat([header, ...entries])
}

await Promise.all([
  mkdir(desktopBuild, { recursive: true }),
  mkdir(websitePublic, { recursive: true }),
])

const mark = svg()
const appIcon = svg(true)
const devAppIcon = devSvg(true)
const trayMark = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="44 48 132 132">${brandMark.books.map((book) => `<path d="${book.path}" fill="#000"/>`).join('')}</svg>`
// Template images use alpha as their mask, so the app icon's background must be omitted.
const devTrayMark = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="18" viewBox="0 0 26 18">${trayMark}<path d="M20 9H22C24 9 25 10.4 25 12.5S24 16 22 16H20V9ZM21.5 10.5V14.5H22C23 14.5 23.5 13.8 23.5 12.5S23 10.5 22 10.5H21.5Z" fill="#000" fill-rule="evenodd"/></svg>`
const assets = [
  [join(desktopBuild, 'trayTemplate.png'), png(trayMark, 18)],
  [join(desktopBuild, 'trayTemplate@2x.png'), png(trayMark, 36)],
  [join(desktopBuild, 'icon.svg'), appIcon],
  [join(desktopBuild, 'icon.png'), png(appIcon, 1024)],
  [join(desktopBuild, 'icon.icns'), icns(appIcon)],
  [join(desktopBuild, 'icon-dev.svg'), devAppIcon],
  [join(desktopBuild, 'icon-dev.png'), png(devAppIcon, 1024)],
  [join(desktopBuild, 'icon-dev.icns'), icns(devAppIcon)],
  [join(desktopBuild, 'trayDevTemplate.png'), png(devTrayMark, 26)],
  [join(desktopBuild, 'trayDevTemplate@2x.png'), png(devTrayMark, 52)],
  [join(desktopBuild, 'icon.ico'), ico(mark, [16, 24, 32, 48, 64, 128, 256])],
  [join(desktopBuild, 'icon-linux.png'), png(mark, 512)],
  [join(websitePublic, 'favicon.svg'), mark],
  [join(websitePublic, 'favicon.ico'), ico(mark, [16, 32, 48])],
  [join(websitePublic, 'apple-touch-icon.png'), png(mark, 180)],
]
await Promise.all(assets.map(([path, content]) => writeFile(path, content)))
console.log('Generated desktop and website icons from the shared brand mark.')
