import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { getReleaseTarget } from './release-config.mjs'

const baseConfig = parse(
  readFileSync(new URL('./electron-builder.yml', import.meta.url), 'utf8')
)

export default {
  ...baseConfig,
  ...getReleaseTarget(
    process.env.SKILL_SHELF_RELEASES_REPOSITORY ??
      'voidrinz/skill-shelf-releases',
    process.env.SKILL_SHELF_RELEASE_ARCH ?? 'arm64'
  ),
  forceCodeSigning: false,
  extraMetadata: { skillShelfChannel: 'production' },
  mac: {
    ...baseConfig.mac,
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
    identity: '-',
    hardenedRuntime: false,
    notarize: false,
  },
}
