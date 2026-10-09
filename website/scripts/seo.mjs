const defaultSiteUrl = 'https://voidrinz.github.io/skill-shelf/'

export function siteUrls(value = defaultSiteUrl) {
  const root = new URL(value)
  if (root.protocol !== 'https:') throw new Error('SITE_URL must use HTTPS')
  root.search = ''
  root.hash = ''
  if (!root.pathname.endsWith('/')) root.pathname += '/'
  return {
    en: root.href,
    'zh-CN': new URL('zh-CN/', root).href,
    image: new URL('social-card.png', root).href,
    sitemap: new URL('sitemap.xml', root).href,
  }
}

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]
  )
}

export function seoHead({ locale, title, description, downloads, urls }) {
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${urls.en}#website`,
        name: 'Skill Shelf',
        url: urls.en,
        inLanguage: ['en', 'zh-CN'],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${urls.en}#application`,
        name: 'Skill Shelf',
        url: urls[locale],
        description,
        operatingSystem: 'macOS',
        applicationCategory: 'DeveloperApplication',
        inLanguage: ['en', 'zh-CN'],
        downloadUrl: [downloads.arm64],
        image: urls.image,
      },
    ],
  }
  const meta = (attribute, name, content) =>
    `<meta ${attribute}="${name}" content="${escapeHtml(content)}" />`

  return [
    `<title>${escapeHtml(title)}</title>`,
    meta('name', 'description', description),
    meta('name', 'robots', 'index, follow, max-image-preview:large'),
    `<link rel="canonical" href="${escapeHtml(urls[locale])}" />`,
    ...['en', 'zh-CN', 'x-default'].map(
      (language) =>
        `<link rel="alternate" hreflang="${language}" href="${escapeHtml(urls[language === 'x-default' ? 'en' : language])}" />`
    ),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', 'Skill Shelf'),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', urls[locale]),
    meta('property', 'og:locale', locale === 'en' ? 'en_US' : 'zh_CN'),
    meta(
      'property',
      'og:locale:alternate',
      locale === 'en' ? 'zh_CN' : 'en_US'
    ),
    meta('property', 'og:image', urls.image),
    meta('property', 'og:image:width', '1200'),
    meta('property', 'og:image:height', '630'),
    meta(
      'property',
      'og:image:alt',
      'Skill Shelf — Your agent skills, in one place.'
    ),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description),
    meta('name', 'twitter:image', urls.image),
    meta(
      'name',
      'twitter:image:alt',
      'Skill Shelf — Your agent skills, in one place.'
    ),
    `<script type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ')
}

export function sitemap(urls) {
  const alternatives = ['en', 'zh-CN', 'x-default'].map(
    (language) =>
      `<xhtml:link rel="alternate" hreflang="${language}" href="${escapeHtml(urls[language === 'x-default' ? 'en' : language])}" />`
  )
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${['en', 'zh-CN'].map((locale) => `  <url><loc>${escapeHtml(urls[locale])}</loc>${alternatives.join('')}</url>`).join('\n')}
</urlset>\n`
}

export function robots(urls) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${urls.sitemap}\n`
}
