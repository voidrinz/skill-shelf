import { describe, expect, it } from 'vitest'

import { parseSkillDocument } from './skill-document'

describe('parseSkillDocument', () => {
  it('reads the name and multiline description from frontmatter', () => {
    const result = parseSkillDocument(
      '---\nname: review\ndescription: >-\n  Review changes before shipping.\n---\n# Review',
      'fallback'
    )

    expect(result).toEqual({
      description: 'Review changes before shipping.',
      name: 'review',
    })
  })

  it('falls back safely when frontmatter is invalid', () => {
    expect(parseSkillDocument('---\nname: [\n---', 'local-skill')).toEqual({
      description: '',
      name: 'local-skill',
    })
  })
})
