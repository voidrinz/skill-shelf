import assert from 'node:assert/strict'
import test from 'node:test'

import { robots, seoHead, sitemap, siteUrls } from './seo.mjs'

test('canonical and language URLs preserve a Pages subdirectory', () => {
  const urls = siteUrls()
  assert.equal(urls.en, 'https://voidrinz.github.io/skill-shelf/')
  assert.equal(urls['zh-CN'], `${urls.en}zh-CN/`)
  assert.equal(urls.image, `${urls.en}social-card.png`)
  assert.equal(urls.sitemap, `${urls.en}sitemap.xml`)
})

test('a custom domain replaces all discovery and sharing URLs', () => {
  const urls = siteUrls('https://skills.example.com?preview=1#top')
  assert.equal(urls.en, 'https://skills.example.com/')
  assert.equal(urls['zh-CN'], 'https://skills.example.com/zh-CN/')
  assert.match(
    robots(urls),
    /Sitemap: https:\/\/skills.example.com\/sitemap.xml/
  )
  const xml = sitemap(urls)
  assert.equal((xml.match(/<loc>/g) ?? []).length, 2)
  assert.equal((xml.match(/hreflang="x-default"/g) ?? []).length, 2)
  assert.doesNotMatch(xml, /voidrinz/)
  assert.throws(() => siteUrls('http://skills.example.com'), /HTTPS/)
})

test('localized metadata escapes HTML and script content', () => {
  const description = 'Folders & tags </script><script>alert("test")</script>'
  const downloads = {
    arm64: 'https://example.com/arm64.dmg',
  }
  const head = seoHead({
    locale: 'zh-CN',
    title: 'Skill Shelf "Skills" <Mac>',
    description,
    downloads,
    urls: siteUrls(),
  })
  assert.match(
    head,
    /<title>Skill Shelf &quot;Skills&quot; &lt;Mac&gt;<\/title>/
  )
  assert.match(
    head,
    /rel="canonical" href="https:\/\/voidrinz.github.io\/skill-shelf\/zh-CN\/"/
  )
  assert.match(head, /property="og:locale" content="zh_CN"/)
  assert.match(head, /name="twitter:card" content="summary_large_image"/)
  assert.doesNotMatch(head, /<script>alert/)
  const data = JSON.parse(
    head.match(/application\/ld\+json">(.*?)<\/script>/s)[1]
  )
  const application = data['@graph'][1]
  assert.equal(application.description, description)
  assert.equal(application.operatingSystem, 'macOS')
  assert.deepEqual(application.downloadUrl, Object.values(downloads))
})
