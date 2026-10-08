import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getReleaseTarget } from './release-config.mjs'
import buildConfig from './electron-builder.release.mjs'

test('Mac releases use ad-hoc signing without Apple credentials or notarization', () => {
  assert.equal(buildConfig.forceCodeSigning, false)
  assert.equal(buildConfig.mac.identity, '-')
  assert.equal(buildConfig.mac.hardenedRuntime, false)
  assert.equal(buildConfig.mac.notarize, false)
  assert.deepEqual(buildConfig.mac.target, ['dmg', 'zip'])
})

test('builds distinct Mac installers without updater metadata or credentials', () => {
  const arm = getReleaseTarget('example/skill-shelf-releases', 'arm64')
  const intel = getReleaseTarget('example/skill-shelf-releases', 'x64')
  assert.equal(arm.publish, null)
  assert.equal(intel.publish, null)
  assert.equal(arm.artifactName, 'skill-shelf-${version}-${os}-${arch}.${ext}')
})

test('rejects missing or malformed repository names and unsupported architectures', () => {
  for (const repository of [
    undefined,
    '',
    'skill-shelf-releases',
    'https://github.com/o/r',
    'o/r/extra',
    'o/r\n',
  ])
    assert.throws(() => getReleaseTarget(repository, 'x64'))
  assert.throws(() => getReleaseTarget('example/skill-shelf-releases', 'ia32'))
})
