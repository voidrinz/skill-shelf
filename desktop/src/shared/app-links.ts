export const appLinks = {
  github: 'https://github.com/voidrinz/skill-shelf',
  website: 'https://voidrinz.github.io/skill-shelf/',
  releases: 'https://github.com/voidrinz/skill-shelf-releases/releases',
} as const

export type AppLink = keyof typeof appLinks
