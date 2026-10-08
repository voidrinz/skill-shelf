import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  buildLeaderboardExtractionScript,
  buildOfficialCreatorExtractionScript,
  buildOfficialExtractionScript,
  buildOfficialRepositoryExtractionScript,
  buildSkillInstallCommandExtractionScript,
  buildTopicDetailExtractionScript,
  buildTopicsExtractionScript,
  mergeLeaderboardResults,
  normalizeLeaderboardResult,
  normalizeOfficialCreatorResult,
  normalizeOfficialResult,
  normalizeOfficialRepositoryResult,
  normalizeSkillInstallCommand,
  normalizeTopicDetailResult,
  normalizeTopicsResult,
} from './discovery-page-parser'

describe('skills.sh discovery page parser', () => {
  it('reads leaderboard rows from semantic links without class selectors', () => {
    const raw = runScript(
      `
        <main>
          <nav><a href="/trending">Trending (24h)</a></nav>
          <a href="/vercel-labs/skills/find-skills">
            <div><span>1</span></div>
            <div><h3>find-skills</h3><p>vercel-labs/skills</p></div>
            <svg aria-label="Weekly installs: 1,000, 2,000"></svg>
            <div><span>3.2M</span></div>
          </a>
          <a href="https://attacker.example/owner/repo/bad">
            <h3>bad</h3><p>owner/repo</p><span>2</span><span>8K</span>
          </a>
        </main>
      `,
      'https://www.skills.sh/trending',
      buildLeaderboardExtractionScript()
    )

    expect(normalizeLeaderboardResult(raw)).toEqual({
      skills: [
        {
          displayRepo: 'vercel-labs/skills',
          installCount: 3_200_000,
          installLabel: '3.2M',
          name: 'find-skills',
          rank: 1,
          repo: 'vercel-labs/skills',
          url: 'https://www.skills.sh/vercel-labs/skills/find-skills',
          weeklyInstalls: [1000, 2000],
        },
      ],
    })
  })

  it('reads the dedicated installation command instead of SKILL.md examples', () => {
    const sourceUrl =
      'https://www.skills.sh/skills-101/superpowers/ai-video-generation'
    const raw = runScript(
      `
        <main>
          <section>
            <button title="Copy command to clipboard">
              <code>$ npx skills add https://github.com/skills-101/superpowers --skill ai-video-generation</code>
            </button>
          </section>
          <article><code>npx skills add attacker/other-skill</code></article>
        </main>
      `,
      sourceUrl,
      buildSkillInstallCommandExtractionScript()
    )

    expect(normalizeSkillInstallCommand(raw, sourceUrl)).toEqual({
      command:
        'npx skills add https://github.com/skills-101/superpowers --skill ai-video-generation',
      repository: 'https://github.com/skills-101/superpowers',
      skill: 'ai-video-generation',
      sourceUrl,
    })
  })

  it('rejects a scraped command that does not match its skills.sh page', () => {
    const sourceUrl = 'https://www.skills.sh/owner/repository/safe-skill'
    expect(
      normalizeSkillInstallCommand(
        {
          command:
            'npx skills add https://github.com/attacker/repository --skill safe-skill',
        },
        sourceUrl
      )
    ).toBeNull()
    expect(
      normalizeSkillInstallCommand(
        {
          command:
            'npx skills add https://github.com/owner/repository --skill other-skill',
        },
        sourceUrl
      )
    ).toBeNull()
  })

  it('reads topic cards and rejects links outside skills.sh', () => {
    const raw = runScript(
      `
        <main>
          <a href="/topic/react">
            <h2>Frontend &amp; React skills</h2>
            <p>Production React guidance.</p>
            <p>6 skills</p>
          </a>
          <a href="https://attacker.example/topic/security">
            <h2>Injected topic</h2><p>Do not keep this.</p><p>99 skills</p>
          </a>
        </main>
      `,
      'https://www.skills.sh/topic',
      buildTopicsExtractionScript()
    )

    expect(normalizeTopicsResult(raw)).toEqual([
      {
        description: 'Production React guidance.',
        skillCount: 6,
        slug: 'react',
        title: 'Frontend & React skills',
        url: 'https://www.skills.sh/topic/react',
      },
    ])
  })

  it('reads a topic detail and its Skill descriptions', () => {
    const raw = runScript(
      `
        <main>
          <h1>Frontend &amp; React skills</h1>
          <p>Rules and patterns for production React.</p>
          <section>
            <a href="/vercel-labs/agent-skills/vercel-react-best-practices">
              <div>
                <h3>vercel-react-best-practices</h3>
                <p>vercel-labs/agent-skills</p>
              </div>
              <p>Prioritized React performance rules.</p>
            </a>
          </section>
        </main>
      `,
      'https://www.skills.sh/topic/react',
      buildTopicDetailExtractionScript()
    )

    expect(normalizeTopicDetailResult(raw)).toEqual({
      description: 'Rules and patterns for production React.',
      skills: [
        {
          description: 'Prioritized React performance rules.',
          displayRepo: 'vercel-labs/agent-skills',
          name: 'vercel-react-best-practices',
          repo: 'vercel-labs/agent-skills',
          url: 'https://www.skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
        },
      ],
      title: 'Frontend & React skills',
    })
  })

  it('reads official creator rows and their counts', () => {
    const raw = runScript(
      `
        <main>
          <a href="/anthropics">
            <div>
              <img src="/api/image-proxy?url=https%3A%2F%2Fgithub.com%2Fanthropics.png" />
              <span>anthropics</span><span>skills</span>
            </div>
            <div>18</div>
            <div>605</div>
          </a>
        </main>
      `,
      'https://www.skills.sh/official',
      buildOfficialExtractionScript()
    )

    expect(normalizeOfficialResult(raw)).toEqual([
      {
        creator: 'anthropics',
        imageUrl:
          'https://www.skills.sh/api/image-proxy?url=https%3A%2F%2Fgithub.com%2Fanthropics.png',
        repo: 'skills',
        repoCount: 18,
        skillCount: 605,
        url: 'https://www.skills.sh/anthropics',
      },
    ])
  })

  it('merges virtualized leaderboard windows by URL and keeps rank order', () => {
    expect(
      mergeLeaderboardResults([
        {
          skills: [
            {
              displayRepo: 'owner/repo',
              name: 'second',
              rank: 2,
              repo: 'owner/repo',
              url: 'https://www.skills.sh/owner/repo/second',
            },
          ],
          total: 500,
        },
        {
          skills: [
            {
              displayRepo: 'owner/repo',
              installCount: 30,
              name: 'third',
              rank: 3,
              repo: 'owner/repo',
              url: 'https://www.skills.sh/owner/repo/third',
            },
            {
              displayRepo: 'owner/repo',
              installCount: 20,
              name: 'second',
              rank: 2,
              repo: 'owner/repo',
              url: 'https://www.skills.sh/owner/repo/second',
            },
          ],
        },
      ])
    ).toEqual({
      skills: [
        {
          displayRepo: 'owner/repo',
          installCount: 20,
          name: 'second',
          rank: 2,
          repo: 'owner/repo',
          url: 'https://www.skills.sh/owner/repo/second',
        },
        {
          displayRepo: 'owner/repo',
          installCount: 30,
          name: 'third',
          rank: 3,
          repo: 'owner/repo',
          url: 'https://www.skills.sh/owner/repo/third',
        },
      ],
      total: 500,
    })
  })

  it('reads an official creator and its repository hierarchy', () => {
    const raw = runScript(
      `
        <main>
          <div>
            <h1>expo</h1>
            <span>4 sources</span><span>49 skills</span>
            <span>712.2K total installs</span>
          </div>
          <a href="/expo/skills">
            <div>
              <h3>skills</h3>
              <p>41 skills: building-native-ui, expo-dev-client +39 more</p>
            </div>
            <div><span>711.9K</span></div>
          </a>
          <a href="https://attacker.example/expo/injected">
            <h3>injected</h3><p>99 skills</p>
          </a>
        </main>
      `,
      'https://www.skills.sh/expo',
      buildOfficialCreatorExtractionScript()
    )

    expect(normalizeOfficialCreatorResult(raw)).toEqual({
      creator: 'expo',
      installCount: 712_200,
      installLabel: '712.2K',
      repoCount: 4,
      repositories: [
        {
          creator: 'expo',
          installCount: 711_900,
          installLabel: '711.9K',
          name: 'skills',
          skillCount: 41,
          skillPreview: ['building-native-ui', 'expo-dev-client'],
          url: 'https://www.skills.sh/expo/skills',
        },
      ],
      skillCount: 49,
    })
  })

  it('reads repository Skills for native official drill-down', () => {
    const raw = runScript(
      `
        <main>
          <div>
            <h1>expo / skills</h1>
            <span>46 skills</span><span>711.9K total installs</span>
          </div>
          <a href="/expo/skills/building-native-ui">
            <div><h3>building-native-ui</h3></div>
            <div><span>59.1K</span></div>
          </a>
          <a href="/expo/skills/expo-ui-swiftui">
            <div><h3>Expo UI SwiftUI</h3></div>
            <div><span>13K</span></div>
          </a>
        </main>
      `,
      'https://www.skills.sh/expo/skills',
      buildOfficialRepositoryExtractionScript()
    )

    expect(normalizeOfficialRepositoryResult(raw)).toEqual({
      creator: 'expo',
      installCount: 711_900,
      installLabel: '711.9K',
      repository: 'skills',
      skills: [
        {
          displayRepo: 'expo/skills',
          installCount: 59_100,
          installLabel: '59.1K',
          name: 'building-native-ui',
          repo: 'expo/skills',
          url: 'https://www.skills.sh/expo/skills/building-native-ui',
        },
        {
          displayRepo: 'expo/skills',
          installCount: 13_000,
          installLabel: '13K',
          name: 'Expo UI SwiftUI',
          repo: 'expo/skills',
          url: 'https://www.skills.sh/expo/skills/expo-ui-swiftui',
        },
      ],
    })
  })

  it('drops official avatars that do not use the skills.sh image proxy', () => {
    expect(
      normalizeOfficialResult({
        sources: [
          {
            creator: 'expo',
            imageUrl: 'https://attacker.example/avatar.png',
            repo: 'skills',
            repoCount: 2,
            skillCount: 18,
            url: 'https://www.skills.sh/expo',
          },
        ],
      })
    ).toEqual([
      {
        creator: 'expo',
        repo: 'skills',
        repoCount: 2,
        skillCount: 18,
        url: 'https://www.skills.sh/expo',
      },
    ])
  })
})

function runScript(html: string, url: string, script: string): unknown {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url })
  return dom.window.eval(script) as unknown
}
