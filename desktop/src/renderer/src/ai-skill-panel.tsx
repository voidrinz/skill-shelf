import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  Bot,
  ChevronDown,
  FileSearch,
  History,
  Languages,
  LoaderCircle,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'

import type {
  AiChatResult,
  AiConversationSummary,
  AiModelSelection,
  AiProviderId,
  AiProviderSettingsStatus,
  AiSkillAction,
  AiSkillResult,
  CatalogSnapshot,
  InstalledSkill,
} from '../../shared/desktop-contract'
import { AI_LANGUAGE_OPTIONS } from './ai-language-options'
import { isDescriptionClearlyInTargetLanguage } from './description-language'
import { getLocalizedErrorMessage } from './localized-error'

interface ChatMessage {
  action?: AiSkillAction
  content: string
  id: string
  result?: AiChatResult | AiSkillResult
  role: 'assistant' | 'user'
  saveLanguage?: string
  translationMethod?: 'ai' | 'source-copy'
}

let messageSequence = 0
function createMessageId(): string {
  messageSequence += 1
  return `${Date.now()}:${messageSequence}`
}

export default function AiSkillPanel({
  onCatalogChange,
  onClearSkillContext,
  onClose,
  onOpenSettings,
  onRestoreSkillContext,
  settings,
  skill,
}: {
  onCatalogChange: (catalog: CatalogSnapshot) => void
  onClearSkillContext: () => void
  onClose: () => void
  onOpenSettings: () => void
  onRestoreSkillContext: (skillId: string | null) => void
  settings: AiProviderSettingsStatus | null
  skill: InstalledSkill | null
}) {
  const { date, locale, t } = useI18n()
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string>(() =>
    crypto.randomUUID()
  )
  const [conversationHistory, setConversationHistory] = useState<
    AiConversationSummary[]
  >([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [targetLanguage, setTargetLanguage] = useState(
    settings?.targetLanguage ?? locale
  )
  const [selectedModel, setSelectedModel] = useState<AiModelSelection | null>(
    settings?.models.chat ?? null
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const available = Boolean(settings?.configured && settings.enabled)
  const availableModels = useMemo(
    () =>
      (settings?.connections ?? []).flatMap((connection) =>
        connection.enabled
          ? connection.availableModels.map((model) => ({
              ...model,
              provider: connection.provider,
            }))
          : []
      ),
    [settings?.connections]
  )

  useEffect(() => {
    let active = true
    void window.skillShelf
      .listAiConversations()
      .then((history) => {
        if (active) setConversationHistory(history)
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setHistoryLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (settings?.targetLanguage) setTargetLanguage(settings.targetLanguage)
  }, [settings?.targetLanguage])

  useEffect(() => {
    if (!settings) return
    setSelectedModel((current) => {
      const selection = current ?? settings.models.chat
      return availableModels.some(
        (model) =>
          model.id === selection.model && model.provider === selection.provider
      )
        ? selection
        : settings.models.chat
    })
  }, [settings, availableModels])

  useEffect(() => {
    scrollRef.current?.scrollTo({
      behavior: running ? 'auto' : 'smooth',
      top: scrollRef.current.scrollHeight,
    })
  }, [messages, running])

  async function persistConversation(nextMessages: ChatMessage[]) {
    if (nextMessages.length === 0) return
    try {
      const conversation = await window.skillShelf.saveAiConversation({
        id: conversationId,
        messages: nextMessages.map(({ content, role }) => ({ content, role })),
        ...(skill ? { skillId: skill.id, skillName: skill.name } : {}),
      })
      setConversationHistory((current) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ])
    } catch (caught) {
      setError(getLocalizedErrorMessage(caught, t))
    }
  }

  function startNewConversation() {
    if (running) return
    setConversationId(crypto.randomUUID())
    setMessages([])
    setDraft('')
    setError(null)
  }

  async function openConversation(id: string) {
    if (running || id === conversationId) return
    setError(null)
    try {
      const conversation = await window.skillShelf.getAiConversation(id)
      if (!conversation) return
      setConversationId(conversation.id)
      setMessages(
        conversation.messages.map((message) => ({
          ...message,
          id: createMessageId(),
        }))
      )
      onRestoreSkillContext(conversation.skillId ?? null)
    } catch (caught) {
      setError(getLocalizedErrorMessage(caught, t))
    }
  }

  async function deleteCurrentConversation() {
    if (running || messages.length === 0) return
    try {
      await window.skillShelf.deleteAiConversation(conversationId)
      setConversationHistory((current) =>
        current.filter((item) => item.id !== conversationId)
      )
      startNewConversation()
    } catch (caught) {
      setError(getLocalizedErrorMessage(caught, t))
    }
  }

  async function runQuickAction(action: Exclude<AiSkillAction, 'ask'>) {
    if (!skill || running) return
    const language =
      action === 'summarize' || action === 'translate' ? targetLanguage : locale
    const label =
      action === 'summarize'
        ? t('desktop.ai.generateDescription')
        : action === 'translate'
          ? t('desktop.ai.translate')
          : t('desktop.ai.analyze')
    const userMessage: ChatMessage = {
      content: label,
      id: createMessageId(),
      role: 'user',
    }
    const pendingMessages = [...messages, userMessage]
    setMessages(pendingMessages)
    setError(null)
    setRunning(true)
    try {
      if (
        action === 'translate' &&
        isDescriptionClearlyInTargetLanguage(skill.description, language)
      ) {
        const nextMessages: ChatMessage[] = [
          ...pendingMessages,
          {
            action,
            content: skill.description.trim(),
            id: createMessageId(),
            role: 'assistant',
            saveLanguage: language,
            translationMethod: 'source-copy',
          },
        ]
        setMessages(nextMessages)
        await persistConversation(nextMessages)
        return
      }

      const result = await window.skillShelf.runAiSkillAction({
        action,
        language,
        skillId: skill.id,
        sourceText: action === 'translate' ? skill.description : undefined,
      })
      const nextMessages: ChatMessage[] = [
        ...pendingMessages,
        {
          action,
          content: result.content,
          id: createMessageId(),
          result,
          role: 'assistant',
          saveLanguage: language,
          translationMethod:
            action === 'translate' &&
            result.content.trim() === skill.description.trim()
              ? 'source-copy'
              : action === 'translate'
                ? 'ai'
                : undefined,
        },
      ]
      setMessages(nextMessages)
      await persistConversation(nextMessages)
    } catch (caught) {
      setError(getLocalizedErrorMessage(caught, t))
      await persistConversation(pendingMessages)
    } finally {
      setRunning(false)
    }
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault()
    const prompt = draft.trim()
    if (!prompt || running || !available) return
    const history = messages
      .slice(-20)
      .map(({ content, role }) => ({ content, role }))
    const pendingMessages: ChatMessage[] = [
      ...messages,
      { content: prompt, id: createMessageId(), role: 'user' },
    ]
    setMessages(pendingMessages)
    setDraft('')
    setError(null)
    setRunning(true)
    try {
      const result = await window.skillShelf.runAiChat({
        history,
        language: locale,
        ...(selectedModel ? { model: selectedModel } : {}),
        prompt,
        ...(skill ? { skillId: skill.id } : {}),
      })
      const nextMessages: ChatMessage[] = [
        ...pendingMessages,
        {
          content: result.content,
          id: createMessageId(),
          result,
          role: 'assistant',
        },
      ]
      setMessages(nextMessages)
      await persistConversation(nextMessages)
    } catch (caught) {
      setError(getLocalizedErrorMessage(caught, t))
      await persistConversation(pendingMessages)
    } finally {
      setRunning(false)
    }
  }

  async function saveDescription(message: ChatMessage) {
    if (
      !skill ||
      !message.saveLanguage ||
      (message.action !== 'translate' && !message.result)
    ) {
      return
    }
    try {
      onCatalogChange(
        message.action === 'translate'
          ? await window.skillShelf.saveSkillTranslation({
              content: message.content,
              language: message.saveLanguage,
              method: message.translationMethod ?? 'ai',
              skillId: skill.id,
              sourceDescription: skill.description,
            })
          : await window.skillShelf.saveSkillDescription({
              description: message.content,
              language: message.saveLanguage,
              skillId: skill.id,
            })
      )
      toast.success(t('desktop.ai.savedDescription'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    }
  }

  return (
    <div className="ai-panel-layout">
      <header className="ai-panel-header">
        <div>
          <span className="ai-panel-mark">
            <Sparkles />
          </span>
          <div className="ai-panel-heading">
            <span>{t('desktop.ai.title')}</span>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button className="ai-history-trigger" type="button">
                  <strong>
                    {conversationHistory.find(
                      (item) => item.id === conversationId
                    )?.title ??
                      (skill
                        ? skill.name
                        : t('desktop.ai.generalConversation'))}
                  </strong>
                  <ChevronDown />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="ai-history-menu"
                sideOffset={8}
              >
                <DropdownMenuLabel>
                  <History />
                  {t('desktop.ai.history')}
                </DropdownMenuLabel>
                <div className="ai-history-list">
                  {historyLoading ? (
                    <div className="ai-history-empty">
                      <LoaderCircle className="animate-spin" />
                      {t('common.loading')}
                    </div>
                  ) : conversationHistory.length === 0 ? (
                    <p className="ai-history-empty">
                      {t('desktop.ai.historyEmpty')}
                    </p>
                  ) : (
                    conversationHistory.map((conversation) => (
                      <DropdownMenuItem
                        aria-current={
                          conversation.id === conversationId
                            ? 'page'
                            : undefined
                        }
                        className="ai-history-item"
                        key={conversation.id}
                        onSelect={() => void openConversation(conversation.id)}
                      >
                        <span>
                          <strong>{conversation.title}</strong>
                          <small>{conversation.preview}</small>
                        </span>
                        <time dateTime={conversation.updatedAt}>
                          {date(conversation.updatedAt, {
                            day: '2-digit',
                            month: 'short',
                          })}
                        </time>
                      </DropdownMenuItem>
                    ))
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="ai-panel-header-actions">
          <Button
            aria-label={t('desktop.ai.newConversation')}
            disabled={running}
            onClick={startNewConversation}
            size="icon-sm"
            variant="ghost"
          >
            <SquarePen />
          </Button>
          <Button
            aria-label={t('desktop.ai.deleteConversation')}
            disabled={running || messages.length === 0}
            onClick={() => void deleteCurrentConversation()}
            size="icon-sm"
            variant="ghost"
          >
            <Trash2 />
          </Button>
          <Button
            aria-label={t('desktop.ai.settings')}
            onClick={onOpenSettings}
            size="icon-sm"
            variant="ghost"
          >
            <Settings />
          </Button>
          <Button
            aria-label={t('desktop.ai.close')}
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <X />
          </Button>
        </div>
      </header>

      {!available ? (
        <PanelState
          action={
            <Button onClick={onOpenSettings} size="sm">
              <Settings />
              {t('desktop.ai.setup')}
            </Button>
          }
          description={t('desktop.ai.setupDescription')}
          title={t('desktop.ai.setupTitle')}
        />
      ) : (
        <>
          <div className="ai-panel-scroll ai-chat-scroll" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="ai-welcome">
                <span>
                  <Bot />
                </span>
                <strong>{t('desktop.ai.welcomeTitle')}</strong>
                <p>
                  {skill
                    ? t('desktop.ai.welcomeSkill', { name: skill.name })
                    : t('desktop.ai.welcomeGeneral')}
                </p>
              </div>
            ) : null}

            {skill ? (
              <section className="ai-skill-tools">
                <header>
                  <span>{t('desktop.ai.skillTools')}</span>
                  <Select
                    onValueChange={setTargetLanguage}
                    value={targetLanguage}
                  >
                    <SelectTrigger aria-label={t('desktop.ai.translateTo')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_LANGUAGE_OPTIONS.map((language) => (
                        <SelectItem key={language.id} value={language.id}>
                          {t(language.key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </header>
                <div>
                  <Button
                    disabled={running}
                    onClick={() => void runQuickAction('summarize')}
                    size="xs"
                    variant="outline"
                  >
                    <Sparkles />
                    {t('desktop.ai.generateDescription')}
                  </Button>
                  <Button
                    disabled={running}
                    onClick={() => void runQuickAction('analyze')}
                    size="xs"
                    variant="outline"
                  >
                    <FileSearch />
                    {t('desktop.ai.analyze')}
                  </Button>
                  <Button
                    disabled={running || !skill.description.trim()}
                    onClick={() => void runQuickAction('translate')}
                    size="xs"
                    variant="outline"
                  >
                    <Languages />
                    {t('desktop.ai.translate')}
                  </Button>
                </div>
              </section>
            ) : null}

            <div className="ai-message-list">
              {messages.map((message) => (
                <article
                  className={`ai-message is-${message.role}`}
                  key={message.id}
                >
                  <header>
                    <span>
                      {message.role === 'user'
                        ? t('desktop.ai.you')
                        : t('desktop.ai.assistant')}
                    </span>
                    {(message.result && message.action === 'summarize') ||
                    (message.action === 'translate' && message.saveLanguage) ? (
                      <Button
                        onClick={() => void saveDescription(message)}
                        size="xs"
                        variant="ghost"
                      >
                        <Save />
                        {t('desktop.ai.saveDescription')}
                      </Button>
                    ) : null}
                  </header>
                  <div className="ai-markdown">
                    <ReactMarkdown
                      components={{
                        a: ({ children }) => <span>{children}</span>,
                      }}
                      remarkPlugins={[remarkGfm]}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                  {message.result ? (
                    <details className="ai-context-details">
                      <summary>
                        <ShieldCheck />
                        <span>
                          {t('desktop.ai.contextSummary', {
                            count: message.result.contextFiles.length,
                            model: message.result.model,
                            provider: message.result.provider,
                          })}
                        </span>
                      </summary>
                      {message.result.truncated ? (
                        <p>{t('desktop.ai.contextTruncated')}</p>
                      ) : null}
                      <div>
                        {message.result.contextFiles.map((file) => (
                          <code key={file}>{file}</code>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </article>
              ))}
              {running ? (
                <div className="ai-typing" role="status">
                  <LoaderCircle className="animate-spin" />
                  <span>{t('desktop.ai.thinking')}</span>
                </div>
              ) : null}
              {error ? (
                <div className="ai-error-state" role="alert">
                  <strong>{error}</strong>
                  <Button
                    onClick={() => setError(null)}
                    size="xs"
                    variant="outline"
                  >
                    {t('common.close')}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <form className="ai-question-form" onSubmit={sendMessage}>
            {skill ? (
              <div className="ai-context-chip">
                <span>{t('desktop.ai.targetSkill')}</span>
                <strong>{skill.name}</strong>
                <button
                  aria-label={t('desktop.ai.clearContext')}
                  onClick={onClearSkillContext}
                  type="button"
                >
                  <X />
                </button>
              </div>
            ) : (
              <div className="ai-general-context">
                <Bot />
                {t('desktop.ai.generalContext')}
              </div>
            )}
            <Textarea
              aria-label={t('desktop.ai.chatPlaceholder')}
              disabled={running}
              maxLength={2_000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void sendMessage()
                }
              }}
              placeholder={t('desktop.ai.chatPlaceholder')}
              rows={2}
              value={draft}
            />
            <div className="ai-question-footer">
              {selectedModel ? (
                <Select
                  onValueChange={(value) =>
                    setSelectedModel(decodeModelSelection(value))
                  }
                  value={encodeModelSelection(selectedModel)}
                >
                  <SelectTrigger
                    aria-label={t('desktop.ai.model')}
                    className="ai-composer-model-select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((model) => (
                      <SelectItem
                        key={`${model.provider}:${model.id}`}
                        value={encodeModelSelection({
                          model: model.id,
                          provider: model.provider,
                        })}
                      >
                        {model.displayName} · {getProviderName(model.provider)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span>
                  {skill
                    ? t('desktop.ai.contextAttached')
                    : t('desktop.ai.noContextAttached')}
                </span>
              )}
              <Button
                aria-label={t('desktop.ai.ask')}
                disabled={!draft.trim() || running}
                size="icon-sm"
                type="submit"
              >
                <Send />
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  )
}

function encodeModelSelection(selection: AiModelSelection): string {
  return `${selection.provider}:${selection.model}`
}

function decodeModelSelection(value: string): AiModelSelection {
  const separator = value.indexOf(':')
  return {
    model: value.slice(separator + 1),
    provider: value.slice(0, separator) as AiProviderId,
  }
}

function getProviderName(provider: AiProviderId): string {
  return provider === 'deepseek' ? 'DeepSeek' : provider
}

function PanelState({
  action,
  description,
  title,
}: {
  action?: ReactNode
  description: string
  title: string
}) {
  return (
    <div className="ai-panel-state">
      <span>
        <Sparkles />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  )
}
