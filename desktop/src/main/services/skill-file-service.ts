import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'

import type {
  SkillFileContent,
  SkillFileEntry,
  SkillFileTree,
} from '../../shared/desktop-contract'

const IGNORED_DIRECTORY_NAMES = new Set(['.cache', '.git', 'node_modules'])
const IGNORED_FILE_NAMES = new Set(['.DS_Store'])
const MAX_TREE_DEPTH = 16
const MAX_TREE_ENTRIES = 2_500
export const MAX_TEXT_FILE_BYTES = 1024 * 1024

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.bash': 'bash',
  '.c': 'c',
  '.cc': 'cpp',
  '.conf': 'ini',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.env': 'dotenv',
  '.fish': 'fish',
  '.go': 'go',
  '.h': 'c',
  '.hpp': 'cpp',
  '.htm': 'html',
  '.html': 'html',
  '.ini': 'ini',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.jsx': 'jsx',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.lua': 'lua',
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.php': 'php',
  '.properties': 'ini',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.scss': 'scss',
  '.sh': 'bash',
  '.sql': 'sql',
  '.swift': 'swift',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.txt': 'text',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'zsh',
}

const LANGUAGE_BY_FILE_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  gemfile: 'ruby',
  makefile: 'make',
}

export async function listSkillFiles(
  skillRoot: string
): Promise<SkillFileTree> {
  const root = await realpath(skillRoot)
  let entryCount = 0
  let fileCount = 0
  let truncated = false

  async function walk(
    directory: string,
    relativeDirectory: string,
    depth: number
  ): Promise<SkillFileEntry[]> {
    if (depth > MAX_TREE_DEPTH || entryCount >= MAX_TREE_ENTRIES) {
      truncated = true
      return []
    }

    let directoryEntries
    try {
      directoryEntries = await readdir(directory, { withFileTypes: true })
    } catch {
      return []
    }

    directoryEntries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })

    const entries: SkillFileEntry[] = []
    for (const entry of directoryEntries) {
      if (entryCount >= MAX_TREE_ENTRIES) {
        truncated = true
        break
      }
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        continue
      }
      if (entry.isFile() && IGNORED_FILE_NAMES.has(entry.name)) continue

      const entryPath = resolve(directory, entry.name)
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name

      if (entry.isDirectory()) {
        entryCount += 1
        entries.push({
          children: await walk(entryPath, relativePath, depth + 1),
          kind: 'directory',
          name: entry.name,
          path: relativePath,
        })
        continue
      }

      if (!entry.isFile()) continue
      let size: number | undefined
      try {
        size = (await stat(entryPath)).size
      } catch {
        // Keep a readable tree even if one file changes during the scan.
      }
      entryCount += 1
      fileCount += 1
      entries.push({
        kind: 'file',
        name: entry.name,
        path: relativePath,
        size,
      })
    }
    return entries
  }

  return {
    entries: await walk(root, '', 0),
    fileCount,
    truncated,
  }
}

export async function readSkillFile(
  skillRoot: string,
  relativePath: string
): Promise<SkillFileContent> {
  if (
    !relativePath ||
    relativePath.includes('\0') ||
    isAbsolute(relativePath)
  ) {
    throw new Error('Invalid skill file path')
  }

  const root = await realpath(skillRoot)
  const requestedPath = resolve(root, relativePath)
  const resolvedPath = await realpath(requestedPath)
  assertPathInsideRoot(root, resolvedPath)

  const fileStats = await stat(resolvedPath)
  if (!fileStats.isFile()) throw new Error('The selected path is not a file')

  const result = {
    language: detectFileLanguage(relativePath),
    name: basename(relativePath),
    path: relativePath,
    size: fileStats.size,
  }
  if (fileStats.size > MAX_TEXT_FILE_BYTES) {
    return { ...result, previewKind: 'too-large' }
  }

  const buffer = await readFile(resolvedPath)
  if (buffer.includes(0)) return { ...result, previewKind: 'binary' }

  try {
    return {
      ...result,
      content: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
      previewKind: 'text',
    }
  } catch {
    return { ...result, previewKind: 'binary' }
  }
}

export function detectFileLanguage(filePath: string): string {
  const fileName = basename(filePath).toLocaleLowerCase()
  return (
    LANGUAGE_BY_FILE_NAME[fileName] ??
    LANGUAGE_BY_EXTENSION[extname(fileName)] ??
    'text'
  )
}

function assertPathInsideRoot(root: string, candidate: string) {
  const relativePath = relative(root, candidate)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Skill file is outside the installed skill folder')
  }
}
