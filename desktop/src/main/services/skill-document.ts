import { parse } from 'yaml'

export interface SkillDocumentMetadata {
  description: string
  name: string
}

export function parseSkillDocument(
  document: string,
  fallbackName: string
): SkillDocumentMetadata {
  const frontmatter = document.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/)
  if (!frontmatter?.[1]) {
    return { description: '', name: fallbackName }
  }

  try {
    const metadata = parse(frontmatter[1]) as Record<string, unknown> | null
    return {
      description:
        typeof metadata?.description === 'string'
          ? metadata.description.trim()
          : '',
      name:
        typeof metadata?.name === 'string' && metadata.name.trim()
          ? metadata.name.trim()
          : fallbackName,
    }
  } catch {
    return { description: '', name: fallbackName }
  }
}
