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

test('keeps release files distinct across architectures without embedding credentials', () => {
  const arm = getReleaseTarget('example/skill-shelf-releases', 'arm64')
  const intel = getReleaseTarget('example/skill-shelf-releases', 'x64')
  assert.equal(arm.publish.channel, 'latest-arm64')
  assert.equal(intel.publish.channel, 'latest-x64')
  assert.equal(arm.publish.owner, 'example')
  assert.equal(arm.publish.repo, 'skill-shelf-releases')
  assert.equal(arm.generateUpdatesFilesForAllChannels, false)
  assert.equal('token' in arm.publish, false)
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
