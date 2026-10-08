import type { useI18n } from '@skill-shelf/i18n/react'

type Translate = ReturnType<typeof useI18n>['t']

export function getLocalizedErrorMessage(error: unknown, t: Translate) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('AI secure storage is unavailable')) {
    return t('desktop.errors.aiSecureStorage')
  }
  if (message.includes('API key is required')) {
    return t('desktop.errors.aiApiKeyRequired')
  }
  if (message.includes('AI provider is not configured')) {
    return t('desktop.errors.aiNotConfigured')
  }
  if (message.includes('AI provider is disabled')) {
    return t('desktop.errors.aiDisabled')
  }
  if (message.includes('AI provider request timed out')) {
    return t('desktop.errors.aiTimedOut')
  }
  if (message.includes('DeepSeek returned an empty response after retry')) {
    return t('desktop.errors.aiEmptyResponse')
  }
  if (
    message.includes('DeepSeek returned an incomplete translation after retry')
  ) {
    return t('desktop.errors.aiIncompleteTranslation')
  }
  if (message.includes('DeepSeek API key is invalid')) {
    return t('desktop.errors.aiUnauthorized')
  }
  if (message.includes('DeepSeek account balance is insufficient')) {
    return t('desktop.errors.aiInsufficientBalance')
  }
  if (message.includes('DeepSeek request was rate limited')) {
    return t('desktop.errors.aiRateLimited')
  }
  if (message.includes('Could not connect to DeepSeek')) {
    return t('desktop.errors.aiNetwork')
  }
  if (message.includes('DeepSeek provider request failed')) {
    return t('desktop.errors.aiRequestFailed', {
      message:
        message.replace(/^DeepSeek provider request failed:\s*/, '') ||
        t('desktop.errors.aiProviderUnavailable'),
    })
  }
  if (
    message.includes('Invalid AI provider URL') ||
    message.includes('AI provider URL must use HTTPS')
  ) {
    return t('desktop.errors.aiUrl')
  }
  if (message.includes('AI provider returned an invalid response')) {
    return t('desktop.errors.aiResponse')
  }
  if (message.includes('AI provider request failed')) {
    return t('desktop.errors.aiRequestFailed', {
      message: message.replace(/^AI provider request failed[^:]*:\s*/, ''),
    })
  }
  if (
    message.includes('description is required') ||
    message.includes('Description is required')
  ) {
    return t('desktop.errors.descriptionRequired')
  }
  if (message.includes('Skill description changed before translation')) {
    return t('desktop.errors.descriptionChanged')
  }
  if (message.includes('A question is required')) {
    return t('desktop.errors.questionRequired')
  }
  if (message.includes('Group name is required')) {
    return t('desktop.errors.groupNameRequired')
  }
  if (message.includes('Folder name already exists')) {
    return t('desktop.errors.folderNameExists')
  }
  if (message.includes('Skill is no longer installed')) {
    return t('desktop.errors.skillMissing')
  }
  if (message.includes('does not have a source URL')) {
    return t('desktop.errors.sourceMissing')
  }
  if (message.includes('valid repository or skills.sh URL')) {
    return t('desktop.errors.invalidSource')
  }
  if (message.includes('command timed out')) {
    return t('desktop.errors.timedOut')
  }
  if (message.includes('Invalid skill file path')) {
    return t('desktop.errors.invalidSkillPath')
  }
  if (message.includes('outside the installed skill folder')) {
    return t('desktop.errors.skillOutsideFolder')
  }
  if (message.includes('selected path is not a file')) {
    return t('desktop.errors.skillPathNotFile')
  }
  if (message.includes('Invalid skill name')) {
    return t('desktop.errors.invalidSkillName')
  }
  if (message.includes('Skills CLI returned invalid data')) {
    return t('desktop.errors.skillsCliData')
  }
  if (message.includes('Could not read installed skills')) {
    return t('desktop.errors.skillsRead')
  }
  if (message.includes('Could not read skills.sh audit data')) {
    return t('desktop.errors.marketplaceAudit')
  }
  if (message.includes('Invalid')) return t('desktop.errors.invalidInput')
  return message
    ? t('desktop.errors.operationFailed', { message })
    : t('desktop.errors.default')
}
