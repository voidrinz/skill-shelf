import { useEffect, useState } from 'react'
import { createBundledHighlighter, createSingletonShorthands } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

const createSkillHighlighter = createBundledHighlighter({
  langs: {
    bash: async () => import('shiki/langs/bash.mjs'),
    c: async () => import('shiki/langs/c.mjs'),
    cpp: async () => import('shiki/langs/cpp.mjs'),
    csharp: async () => import('shiki/langs/csharp.mjs'),
    css: async () => import('shiki/langs/css.mjs'),
    dockerfile: async () => import('shiki/langs/dockerfile.mjs'),
    dotenv: async () => import('shiki/langs/dotenv.mjs'),
    fish: async () => import('shiki/langs/fish.mjs'),
    go: async () => import('shiki/langs/go.mjs'),
    html: async () => import('shiki/langs/html.mjs'),
    ini: async () => import('shiki/langs/ini.mjs'),
    java: async () => import('shiki/langs/java.mjs'),
    javascript: async () => import('shiki/langs/javascript.mjs'),
    json: async () => import('shiki/langs/json.mjs'),
    jsonc: async () => import('shiki/langs/jsonc.mjs'),
    jsx: async () => import('shiki/langs/jsx.mjs'),
    kotlin: async () => import('shiki/langs/kotlin.mjs'),
    lua: async () => import('shiki/langs/lua.mjs'),
    make: async () => import('shiki/langs/make.mjs'),
    markdown: async () => import('shiki/langs/md.mjs'),
    mdx: async () => import('shiki/langs/mdx.mjs'),
    php: async () => import('shiki/langs/php.mjs'),
    python: async () => import('shiki/langs/python.mjs'),
    ruby: async () => import('shiki/langs/ruby.mjs'),
    rust: async () => import('shiki/langs/rust.mjs'),
    scss: async () => import('shiki/langs/scss.mjs'),
    sql: async () => import('shiki/langs/sql.mjs'),
    swift: async () => import('shiki/langs/swift.mjs'),
    toml: async () => import('shiki/langs/toml.mjs'),
    tsx: async () => import('shiki/langs/tsx.mjs'),
    typescript: async () => import('shiki/langs/typescript.mjs'),
    xml: async () => import('shiki/langs/xml.mjs'),
    yaml: async () => import('shiki/langs/yaml.mjs'),
    zsh: async () => import('shiki/langs/zsh.mjs'),
  },
  themes: {
    'github-dark': async () => import('shiki/themes/github-dark.mjs'),
    'github-light': async () => import('shiki/themes/github-light.mjs'),
  },
  engine: () => createJavaScriptRegexEngine(),
})

const { codeToHtml } = createSingletonShorthands(createSkillHighlighter)

export default function SyntaxHighlighter({
  code,
  language,
}: {
  code: string
  language: string
}) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setHtml(null)
    if (language === 'text') return () => undefined

    void codeToHtml(code, {
      defaultColor: false,
      lang: language,
      themes: { dark: 'github-dark', light: 'github-light' },
    })
      .then((value) => {
        if (active) setHtml(value)
      })
      .catch(() => {
        if (active) setHtml('')
      })

    return () => {
      active = false
    }
  }, [code, language])

  if (!html) return <PlainSource code={code} />

  return (
    <div
      className="skill-source skill-source-highlighted"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function PlainSource({ code }: { code: string }) {
  return (
    <pre className="skill-source skill-source-plain">
      <code>
        {code.split('\n').map((line, index) => (
          <span className="source-line" key={index}>
            <span className="source-line-number">{index + 1}</span>
            <span>{line || ' '}</span>
          </span>
        ))}
      </code>
    </pre>
  )
}
