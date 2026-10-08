import { cn } from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import {
  BookOpenText,
  Braces,
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  OctagonAlert,
  RotateCcw,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type {
  SkillFileContent,
  SkillFileEntry,
  SkillFileTree,
} from '../../shared/desktop-contract'
import { getLocalizedErrorMessage } from './localized-error'
import SyntaxHighlighter from './syntax-highlighter'

type MarkdownMode = 'rendered' | 'source'

const markdownComponents: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} rel="noreferrer" target="_blank" />
  ),
}

export default function SkillFilesPanel({ skillId }: { skillId: string }) {
  const { plural, t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t
  const [tree, setTree] = useState<SkillFileTree | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState<SkillFileContent | null>(null)
  const [contentError, setContentError] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>('rendered')
  const treeRequestId = useRef(0)

  const loadTree = useCallback(
    async (preserveSelection = false) => {
      const requestId = ++treeRequestId.current
      if (!preserveSelection) setTree(null)
      setTreeError(null)
      if (!preserveSelection) {
        setSelectedPath(null)
        setContent(null)
        setLoadingContent(false)
        setExpanded(new Set())
      }
      try {
        const nextTree = await window.skillShelf.getSkillFiles(skillId)
        if (requestId !== treeRequestId.current) return
        setTree(nextTree)
        setSelectedPath((current) => {
          if (
            preserveSelection &&
            current &&
            findFile(nextTree.entries, (entry) => entry.path === current)
          ) {
            return current
          }
          return (
            findFile(nextTree.entries, (entry) =>
              /^skill\.md$/i.test(entry.name)
            )?.path ??
            findFile(nextTree.entries)?.path ??
            null
          )
        })
      } catch (caught) {
        if (requestId !== treeRequestId.current) return
        setTreeError(getLocalizedErrorMessage(caught, tRef.current))
      }
    },
    [skillId]
  )

  useEffect(() => {
    void loadTree()
    return () => {
      treeRequestId.current += 1
    }
  }, [loadTree])

  useEffect(() => {
    let active = true
    setMarkdownMode('rendered')
    setContent(null)
    setContentError(null)
    if (!selectedPath) {
      setLoadingContent(false)
      return () => undefined
    }

    setLoadingContent(true)
    void window.skillShelf
      .readSkillFile(skillId, selectedPath)
      .then((nextContent) => {
        if (active) setContent(nextContent)
      })
      .catch((caught: unknown) => {
        if (active) {
          setContentError(getLocalizedErrorMessage(caught, tRef.current))
        }
      })
      .finally(() => {
        if (active) setLoadingContent(false)
      })

    return () => {
      active = false
    }
  }, [selectedPath, skillId])

  function toggleDirectory(path: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (treeError) {
    return (
      <FileBrowserState
        icon={<OctagonAlert />}
        title={t('desktop.files.filesUnavailable')}
      >
        <p>{treeError}</p>
        <button onClick={() => void loadTree()} type="button">
          <RotateCcw />
          {t('common.tryAgain')}
        </button>
      </FileBrowserState>
    )
  }

  if (!tree) {
    return (
      <FileBrowserState
        icon={<LoaderCircle className="animate-spin" />}
        title={t('desktop.files.reading')}
      />
    )
  }

  if (tree.fileCount === 0) {
    return (
      <FileBrowserState icon={<Folder />} title={t('desktop.files.noFiles')}>
        <p>{t('desktop.files.noFilesDescription')}</p>
      </FileBrowserState>
    )
  }

  return (
    <div className="skill-file-browser">
      <aside className="skill-file-tree-pane">
        <div className="file-tree-heading">
          <span>
            {plural(tree.fileCount, 'count.file.one', 'count.file.other')}
          </span>
          {tree.truncated ? <em>{t('desktop.files.partialTree')}</em> : null}
        </div>
        <div className="skill-file-tree" role="tree">
          {tree.entries.map((entry) => (
            <FileTreeNode
              depth={0}
              entry={entry}
              expanded={expanded}
              key={entry.path}
              onSelect={setSelectedPath}
              onToggle={toggleDirectory}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      </aside>
      <section className="skill-file-preview">
        <div className="file-preview-toolbar">
          <div className="file-preview-name">
            {content ? fileIcon(content) : <File />}
            <span title={selectedPath ?? undefined}>
              {selectedPath ?? t('desktop.files.select')}
            </span>
          </div>
          {content?.language === 'markdown' &&
          content.previewKind === 'text' ? (
            <div
              aria-label={t('desktop.files.markdownView')}
              className="preview-mode-switch"
            >
              <button
                aria-pressed={markdownMode === 'rendered'}
                className={cn(markdownMode === 'rendered' && 'is-active')}
                onClick={() => setMarkdownMode('rendered')}
                type="button"
              >
                <BookOpenText />
                {t('desktop.files.rendered')}
              </button>
              <button
                aria-pressed={markdownMode === 'source'}
                className={cn(markdownMode === 'source' && 'is-active')}
                onClick={() => setMarkdownMode('source')}
                type="button"
              >
                <Braces />
                {t('desktop.files.source')}
              </button>
            </div>
          ) : content ? (
            <span className="file-language">{content.language}</span>
          ) : null}
        </div>
        <div className="file-preview-content">
          {loadingContent ? (
            <FileBrowserState
              icon={<LoaderCircle className="animate-spin" />}
              title={t('desktop.files.opening')}
            />
          ) : contentError ? (
            <FileBrowserState
              icon={<OctagonAlert />}
              title={t('desktop.files.fileUnavailable')}
            >
              <p>{contentError}</p>
            </FileBrowserState>
          ) : content?.previewKind === 'binary' ? (
            <FileBrowserState
              icon={<File />}
              title={t('desktop.files.previewUnavailable')}
            >
              <p>
                {t('desktop.files.binary', { size: formatBytes(content.size) })}
              </p>
            </FileBrowserState>
          ) : content?.previewKind === 'too-large' ? (
            <FileBrowserState
              icon={<File />}
              title={t('desktop.files.fileTooLarge')}
            >
              <p>
                {t('desktop.files.previewLimit', {
                  size: formatBytes(content.size),
                })}
              </p>
            </FileBrowserState>
          ) : content?.content !== undefined ? (
            content.language === 'markdown' && markdownMode === 'rendered' ? (
              <article className="markdown-preview">
                <ReactMarkdown
                  components={markdownComponents}
                  remarkPlugins={[remarkGfm]}
                >
                  {stripFrontmatter(content.content)}
                </ReactMarkdown>
              </article>
            ) : (
              <SyntaxHighlighter
                code={content.content}
                language={content.language}
              />
            )
          ) : (
            <FileBrowserState
              icon={<File />}
              title={t('desktop.files.select')}
            />
          )}
        </div>
      </section>
    </div>
  )
}

function FileTreeNode({
  depth,
  entry,
  expanded,
  onSelect,
  onToggle,
  selectedPath,
}: {
  depth: number
  entry: SkillFileEntry
  expanded: Set<string>
  onSelect: (path: string) => void
  onToggle: (path: string) => void
  selectedPath: string | null
}) {
  const isDirectory = entry.kind === 'directory'
  const isExpanded = expanded.has(entry.path)

  return (
    <div role="treeitem" aria-expanded={isDirectory ? isExpanded : undefined}>
      <button
        className={cn(
          'file-tree-row',
          entry.path === selectedPath && 'is-selected'
        )}
        onClick={() =>
          isDirectory ? onToggle(entry.path) : onSelect(entry.path)
        }
        style={{ paddingLeft: 9 + depth * 14 }}
        title={entry.path}
        type="button"
      >
        <span className="file-tree-disclosure">
          {isDirectory ? isExpanded ? <ChevronDown /> : <ChevronRight /> : null}
        </span>
        {isDirectory ? (
          isExpanded ? (
            <FolderOpen className="file-tree-folder" />
          ) : (
            <Folder className="file-tree-folder" />
          )
        ) : (
          fileEntryIcon(entry)
        )}
        <span>{entry.name}</span>
      </button>
      {isDirectory && isExpanded ? (
        <div role="group">
          {(entry.children ?? []).map((child) => (
            <FileTreeNode
              depth={depth + 1}
              entry={child}
              expanded={expanded}
              key={child.path}
              onSelect={onSelect}
              onToggle={onToggle}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function FileBrowserState({
  children,
  icon,
  title,
}: {
  children?: ReactNode
  icon: ReactNode
  title: string
}) {
  return (
    <div className="file-browser-state">
      <span>{icon}</span>
      <strong>{title}</strong>
      {children}
    </div>
  )
}

function findFile(
  entries: SkillFileEntry[],
  predicate: (entry: SkillFileEntry) => boolean = () => true
): SkillFileEntry | null {
  for (const entry of entries) {
    if (entry.kind === 'file' && predicate(entry)) return entry
    if (entry.children) {
      const nested = findFile(entry.children, predicate)
      if (nested) return nested
    }
  }
  return null
}

function fileEntryIcon(entry: SkillFileEntry) {
  if (/\.mdx?$/i.test(entry.name)) return <FileText />
  if (
    /\.(c|cc|cpp|css|go|h|html|java|js|jsx|php|py|rb|rs|sh|sql|swift|ts|tsx)$/i.test(
      entry.name
    )
  ) {
    return <FileCode2 />
  }
  return <File />
}

function fileIcon(content: SkillFileContent) {
  if (content.language === 'markdown') return <FileText />
  if (content.language !== 'text') return <FileCode2 />
  return <File />
}

function stripFrontmatter(markdown: string) {
  if (!markdown.startsWith('---\n')) return markdown
  const end = markdown.indexOf('\n---', 4)
  return end === -1 ? markdown : markdown.slice(end + 4).replace(/^\s+/, '')
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
