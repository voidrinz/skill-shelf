import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { build } from 'vite'

import { robots, seoHead, sitemap, siteUrls } from './seo.mjs'

const { values } = parseArgs({ options: { base: { type: 'string' } } })
const options = values.base ? { base: values.base } : {}
const serverDirectory = resolve('.prerender')
const urls = siteUrls(process.env.SITE_URL)

await build(options)
// Render the same React tree at build time; Pages only serves static files.
try {
  await build({
    ...options,
    build: {
      ssr: 'src/entry-server.tsx',
      outDir: serverDirectory,
      emptyOutDir: true,
    },
  })
  const { render } = await import(
    pathToFileURL(resolve(serverDirectory, 'entry-server.js')).href
  )
  const template = await readFile('dist/index.html', 'utf8')
  for (const locale of ['en', 'zh-CN']) {
    const rendered = await render(locale)
    const html = template
      .replace('<html lang="en">', `<html lang="${locale}">`)
      .replace('<!--seo-head-->', seoHead({ ...rendered, locale, urls }))
      .replace('<!--app-html-->', rendered.html)
    const directory = locale === 'en' ? 'dist' : 'dist/zh-CN'
    await mkdir(directory, { recursive: true })
    await writeFile(`${directory}/index.html`, html)
  }
  await writeFile('dist/sitemap.xml', sitemap(urls))
  await writeFile('dist/robots.txt', robots(urls))
} finally {
  await rm(serverDirectory, { recursive: true, force: true })
}
