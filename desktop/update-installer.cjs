const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const exec = promisify(execFile)
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

async function writeJson(file, value) {
  const temporary = `${file}.tmp`
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
  await fs.rename(temporary, file)
}

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

async function validatePlan(plan, planDirectory) {
  if (
    plan.schema !== 1 ||
    !/^[a-f0-9-]{36}$/.test(plan.id) ||
    !/^\d+\.\d+\.\d+$/.test(plan.version) ||
    !Number.isSafeInteger(plan.parentPid) ||
    plan.parentPid <= 1 ||
    path.basename(planDirectory) !== `install-${plan.id}` ||
    !path.isAbsolute(plan.bundle) ||
    !plan.bundle.endsWith('.app') ||
    plan.staged !== `${plan.bundle}.update-${plan.id}` ||
    plan.backup !== `${plan.bundle}.backup-${plan.id}` ||
    (plan.downloadDirectory &&
      (path.dirname(plan.downloadDirectory) !== path.dirname(planDirectory) ||
        !/^download-[a-zA-Z0-9]+$/.test(path.basename(plan.downloadDirectory))))
  )
    throw new Error('Invalid installation plan')
  for (const directory of [plan.bundle, plan.staged, planDirectory]) {
    const info = await fs.lstat(directory)
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await fs.realpath(directory)) !== directory
    )
      throw new Error('Invalid installation directory')
  }
  try {
    await fs.lstat(plan.backup)
    throw new Error('Backup already exists')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

async function installUpdate(plan, planDirectory, overrides = {}) {
  await validatePlan(plan, planDirectory)
  const cache = path.dirname(planDirectory)
  const alive = overrides.alive ?? processAlive
  const wait = overrides.wait ?? pause
  const launchEnvironment = { ...process.env }
  delete launchEnvironment.ELECTRON_RUN_AS_NODE
  const launch =
    overrides.launch ??
    ((bundle, id) =>
      exec(
        '/usr/bin/open',
        [
          '-n',
          bundle,
          '--args',
          ...(id ? [`--skill-shelf-update-id=${id}`] : []),
        ],
        { env: launchEnvironment }
      ))
  const quitTimeout = overrides.quitTimeout ?? 60000
  const startupTimeout = overrides.startupTimeout ?? 90000
  const journal = (stage) =>
    writeJson(path.join(planDirectory, 'journal.json'), { id: plan.id, stage })
  const finish = async (status) => {
    await writeJson(path.join(cache, 'last-result.json'), {
      id: plan.id,
      version: plan.version,
      status,
    })
    const pending = await readJson(path.join(cache, 'pending.json')).catch(
      () => null
    )
    if (pending?.id === plan.id)
      await fs.rm(path.join(cache, 'pending.json'), { force: true })
  }
  let movedOld = false
  let movedNew = false
  let confirmed = false
  try {
    await journal('waiting-for-exit')
    overrides.onReady?.()
    const quitDeadline = Date.now() + quitTimeout
    while (alive(plan.parentPid)) {
      if (Date.now() >= quitDeadline)
        throw new Error('Application did not quit')
      await wait(250)
    }
    await journal('replacing')
    await fs.rename(plan.bundle, plan.backup)
    movedOld = true
    await fs.rename(plan.staged, plan.bundle)
    movedNew = true
    await journal('starting')
    await launch(plan.bundle, plan.id)
    const startupDeadline = Date.now() + startupTimeout
    while (Date.now() < startupDeadline) {
      const receipt = await readJson(
        path.join(planDirectory, 'ready.json')
      ).catch(() => null)
      if (
        receipt?.id === plan.id &&
        receipt.version === plan.version &&
        Number.isSafeInteger(receipt.pid) &&
        receipt.pid > 1 &&
        alive(receipt.pid)
      ) {
        confirmed = true
        break
      }
      await wait(250)
    }
    if (!confirmed) throw new Error('New application did not become ready')
    await finish('success')
    await journal('complete')
    // Cleanup is best effort: a successful update must never be rolled back for it.
    await fs.rm(plan.backup, { recursive: true, force: true }).catch(() => {})
    if (plan.downloadDirectory)
      await fs
        .rm(plan.downloadDirectory, { recursive: true, force: true })
        .catch(() => {})
  } catch (error) {
    if (confirmed) throw error
    if (movedNew) {
      const started = await readJson(
        path.join(planDirectory, 'started.json')
      ).catch(() => null)
      if (
        started?.id === plan.id &&
        started.version === plan.version &&
        Number.isSafeInteger(started.pid) &&
        started.pid > 1 &&
        started.pid !== process.pid
      ) {
        if (overrides.stop) await overrides.stop(started.pid)
        else {
          const command = await exec('/bin/ps', [
            '-p',
            String(started.pid),
            '-o',
            'args=',
          ]).catch(() => null)
          if (command?.stdout.includes(`--skill-shelf-update-id=${plan.id}`)) {
            try {
              process.kill(started.pid, 'SIGKILL')
            } catch (stopError) {
              if (stopError.code !== 'ESRCH') throw stopError
            }
          }
        }
      }
      if (!started && !overrides.launch) {
        const processes = await exec('/bin/ps', [
          '-ax',
          '-o',
          'pid=',
          '-o',
          'args=',
        ]).catch(() => null)
        for (const line of processes?.stdout.split('\n') ?? []) {
          const match = line.match(/^\s*(\d+)\s+(.*)$/)
          if (
            match &&
            match[2].startsWith(`${plan.bundle}/Contents/MacOS/Skill Shelf `) &&
            match[2].includes(`--skill-shelf-update-id=${plan.id}`)
          ) {
            const pid = Number(match[1])
            if (pid > 1 && pid !== process.pid) {
              try {
                process.kill(pid, 'SIGKILL')
              } catch (stopError) {
                if (stopError.code !== 'ESRCH') throw stopError
              }
            }
          }
        }
      }
      await fs.rename(plan.bundle, `${plan.bundle}.failed-${plan.id}`)
    }
    if (movedOld) await fs.rename(plan.backup, plan.bundle)
    await finish(movedOld ? 'rolled-back' : 'failed')
    await journal('failed')
    if (movedOld) await launch(plan.bundle)
    throw error
  }
}

module.exports = { installUpdate, validatePlan }
if (require.main === module) {
  const file = process.argv[2]
  ;(async () => {
    if (!file || path.basename(file) !== 'plan.json')
      throw new Error('Invalid plan file')
    const plan = await readJson(file)
    await installUpdate(plan, path.dirname(file), {
      onReady: () => {
        process.send?.({ ready: true })
        process.disconnect?.()
      },
    })
  })().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
