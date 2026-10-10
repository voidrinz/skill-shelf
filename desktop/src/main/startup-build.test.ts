import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import { resolveConfig } from 'electron-vite'
import { expect, it } from 'vitest'

it('builds an executable main process at the package entry in both development and production', async () => {
  const packageJson = JSON.parse(
    await readFile(resolve('package.json'), 'utf8')
  ) as { main: string }
  for (const command of ['serve', 'build'] as const) {
    const { config } = await resolveConfig({}, command)
    const main = config!.main!
    let outputDirectory = ''
    const result = await build({
      ...main,
      logLevel: 'silent',
      build: { ...main.build, write: false, watch: null },
      plugins: [
        ...(main.plugins ?? []),
        {
          name: 'capture-output-directory',
          configResolved: (resolved) => {
            outputDirectory = resolved.build.outDir
          },
        },
      ],
    })
    if (Array.isArray(result) || !('output' in result))
      throw new Error('Expected a main process bundle')
    const entry = result.output.find(
      (chunk) => chunk.type === 'chunk' && chunk.isEntry
    )
    if (!entry || entry.type !== 'chunk')
      throw new Error('Missing main process entry')
    expect(resolve(outputDirectory, entry.fileName)).toBe(
      resolve(packageJson.main)
    )
    expect(entry.code).toContain('createMainWindow')
    expect(entry.code).toContain('whenReady()')
    expect(entry.code).toContain('requestSingleInstanceLock()')
    expect(entry.code).not.toContain('import.meta')
  }
}, 20_000)
