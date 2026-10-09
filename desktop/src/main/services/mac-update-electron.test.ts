import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'vite'
import { afterEach, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(
  require.resolve('electron-builder/package.json')
)
const asar = createRequire(
  builderRequire.resolve('app-builder-lib/package.json')
)('@electron/asar') as {
  createPackage(source: string, destination: string): Promise<void>
}
const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

it('copies, installs, rolls back and cleans physical ASAR bundles in the real Electron runtime', async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'skill-shelf-electron-update-'))
  )
  directories.push(root)
  for (const version of ['old', 'new']) {
    const source = join(root, version)
    await mkdir(source)
    await writeFile(join(source, 'main.js'), `module.exports = '${version}'\n`)
    await asar.createPackage(source, join(root, `${version}.asar`))
  }
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: true,
      outDir: join(root, 'compiled'),
      rollupOptions: {
        input: fileURLToPath(new URL('./mac-app-updater.ts', import.meta.url)),
        output: { format: 'es', entryFileNames: 'updater.mjs' },
      },
    },
  })
  const installer = fileURLToPath(
    new URL('../../../update-installer.cjs', import.meta.url)
  )
  await writeFile(
    join(root, 'verify.cjs'),
    String.raw`
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createHash, generateKeyPairSync, sign } = require('node:crypto')
const patched = require('node:fs')
const native = require('original-fs')
const fs = native.promises
const root = process.argv[2]
const { installUpdate } = require(process.argv[3])
async function main() {
  const { MacAppUpdater, validateBundleSymlinks } = await import(pathToFileURL(path.join(root, 'compiled/updater.mjs')))
  assert.equal(patched.lstatSync(path.join(root, 'new.asar')).isDirectory(), true)
  assert.equal(native.lstatSync(path.join(root, 'new.asar')).isFile(), true)
  const pair = generateKeyPairSync('ed25519')
  const payload = Buffer.from('signed fixture archive')
  const manifest = Buffer.from(JSON.stringify({ schema: 1, version: '0.2.0', assets: [{ arch: 'arm64', size: payload.length, sha256: createHash('sha256').update(payload).digest('hex'), url: 'https://github.com/voidrinz/skill-shelf-releases/releases/download/v0.2.0/skill-shelf-0.2.0-mac-arm64.zip' }] }))
  const signed = JSON.stringify({ schema: 1, payload: manifest.toString('base64'), signature: sign(null, manifest, pair.privateKey).toString('base64') })
  const bytes = version => fs.readFile(path.join(root, version + '.asar'))
  for (const scenario of ['success', 'rollback', 'no-acknowledgment']) {
    const directory = path.join(root, scenario)
    const bundle = path.join(directory, 'Skill Shelf.app')
    const cache = path.join(directory, 'cache')
    await fs.mkdir(path.join(bundle, 'Contents/Resources'), { recursive: true })
    await fs.copyFile(path.join(root, 'old.asar'), path.join(bundle, 'Contents/Resources/app.asar'))
    const helper = path.join(directory, 'helper.cjs')
    await fs.writeFile(helper, scenario === 'no-acknowledgment' ? 'process.exit(1)' : 'process.send({ready:true}); process.disconnect()')
    let quit = false
    const updater = new MacAppUpdater({
      arch: 'arm64', currentVersion: '0.1.0', cacheDir: cache, bundlePath: bundle,
      publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      installerPath: helper, executablePath: process.execPath,
      latestVersion: async () => '0.2.0',
      fetch: async url => new Response(url.endsWith('.json') ? signed : payload),
      onQuit: () => { quit = true },
      stageBundle: async (_zip, output) => {
        const staged = path.join(output, 'Skill Shelf.app')
        await fs.mkdir(path.join(staged, 'Contents/Resources'), { recursive: true })
        await fs.copyFile(path.join(root, 'new.asar'), path.join(staged, 'Contents/Resources/app.asar'))
        await validateBundleSymlinks(staged)
        return staged
      },
    })
    await updater.checkForUpdates()
    await updater.downloadUpdate()
    if (scenario === 'no-acknowledgment') {
      await assert.rejects(updater.quitAndInstall(), error => error.code === 'installation')
      assert.equal(quit, false)
      assert.equal((await fs.readdir(cache)).some(name => name.startsWith('prepare-') || name.startsWith('install-')), false)
      assert.equal((await fs.readdir(directory)).some(name => name.includes('.app.update-')), false)
      assert.deepEqual(await fs.readFile(path.join(bundle, 'Contents/Resources/app.asar')), await bytes('old'))
      continue
    }
    await updater.quitAndInstall()
    assert.equal(quit, true)
    const pending = JSON.parse(await fs.readFile(path.join(cache, 'pending.json'), 'utf8'))
    const planDirectory = path.join(cache, 'install-' + pending.id)
    const plan = JSON.parse(await fs.readFile(path.join(planDirectory, 'plan.json'), 'utf8'))
    assert.equal((await fs.lstat(path.join(plan.staged, 'Contents/Resources/app.asar'))).isFile(), true)
    assert.deepEqual(await fs.readFile(path.join(plan.staged, 'Contents/Resources/app.asar')), await bytes('new'))
    assert.deepEqual(await fs.readFile(path.join(bundle, 'Contents/Resources/app.asar')), await bytes('old'))
    assert.equal((await fs.readdir(cache)).some(name => name.startsWith('prepare-')), false)
    let launches = 0
    const installing = installUpdate(plan, planDirectory, {
      alive: pid => pid === 88,
      launch: async (_bundle, id) => {
        launches++
        if (scenario === 'rollback' && launches === 1) throw new Error('Synthetic launch failure')
        if (id) await fs.writeFile(path.join(planDirectory, 'ready.json'), JSON.stringify({ id, version: plan.version, pid: 88 }))
      },
    })
    if (scenario === 'rollback') {
      await assert.rejects(installing, /Synthetic launch failure/)
      assert.deepEqual(await fs.readFile(path.join(bundle, 'Contents/Resources/app.asar')), await bytes('old'))
      assert.equal(launches, 2)
    } else {
      await installing
      assert.deepEqual(await fs.readFile(path.join(bundle, 'Contents/Resources/app.asar')), await bytes('new'))
      await assert.rejects(fs.stat(plan.backup), error => error.code === 'ENOENT')
      await assert.rejects(fs.stat(plan.downloadDirectory), error => error.code === 'ENOENT')
    }
    const result = JSON.parse(await fs.readFile(path.join(cache, 'last-result.json'), 'utf8'))
    assert.equal(result.status, scenario === 'success' ? 'success' : 'rolled-back')
  }
  console.log('Electron ASAR copy, installation, rollback and cleanup passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
`
  )
  const result = await promisify(execFile)(
    require('electron') as string,
    [join(root, 'verify.cjs'), root, installer],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 30_000,
    }
  )
  expect(result.stdout).toContain(
    'Electron ASAR copy, installation, rollback and cleanup passed'
  )
}, 40_000)
