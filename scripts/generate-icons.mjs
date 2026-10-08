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
const trayMark = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="44 48 132 132">${brandMark.books.map((book) => `<path d="${book.path}" fill="#000"/>`).join('')}</svg>`
const assets = [
  [join(desktopBuild, 'trayTemplate.png'), png(trayMark, 18)],
  [join(desktopBuild, 'trayTemplate@2x.png'), png(trayMark, 36)],
  [join(desktopBuild, 'icon.svg'), appIcon],
  [join(desktopBuild, 'icon.png'), png(appIcon, 1024)],
  [join(desktopBuild, 'icon.icns'), icns(appIcon)],
  [join(desktopBuild, 'icon.ico'), ico(mark, [16, 24, 32, 48, 64, 128, 256])],
  [join(desktopBuild, 'icon-linux.png'), png(mark, 512)],
  [join(websitePublic, 'favicon.svg'), mark],
  [join(websitePublic, 'favicon.ico'), ico(mark, [16, 32, 48])],
  [join(websitePublic, 'apple-touch-icon.png'), png(mark, 180)],
]
await Promise.all(assets.map(([path, content]) => writeFile(path, content)))
console.log('Generated desktop and website icons from the shared brand mark.')
