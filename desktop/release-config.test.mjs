import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getReleaseTarget } from './release-config.mjs'
import buildConfig from './electron-builder.release.mjs'

test('Mac releases use ad-hoc signing without Apple credentials or notarization', () => {
  assert.equal(buildConfig.forceCodeSigning, false)
  assert.equal(buildConfig.mac.identity, '-')
  assert.equal(buildConfig.mac.hardenedRuntime, false)
  assert.equal(buildConfig.mac.notarize, false)
  assert.deepEqual(buildConfig.mac.target, [
    { target: 'dmg', arch: ['arm64'] },
    { target: 'zip', arch: ['arm64'] },
  ])
})

test('builds Apple Silicon installers without updater metadata or credentials', () => {
  const arm = getReleaseTarget('example/skill-shelf-releases', 'arm64')
  assert.equal(arm.publish, null)
  assert.equal(arm.artifactName, 'skill-shelf-${version}-${os}-${arch}.${ext}')
})

test('bundles the independent updater public key and installer without Apple credentials', () => {
  assert.ok(
    buildConfig.extraResources.some(
      (entry) => entry.to === 'update-signing-public-key.json'
    )
  )
  assert.ok(
    buildConfig.extraResources.some(
      (entry) => entry.to === 'update-installer.cjs'
    )
  )
  assert.equal(buildConfig.mac.identity, '-')
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
    assert.throws(() => getReleaseTarget(repository, 'arm64'))
  for (const arch of ['x64', 'ia32', 'universal', undefined])
    assert.throws(() => getReleaseTarget('example/skill-shelf-releases', arch))
})
