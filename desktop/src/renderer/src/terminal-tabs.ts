export const MAX_TERMINAL_TABS = 8

export function getNextTerminalTabIdAfterClose(
  tabIds: string[],
  activeTabId: string | null,
  closingTabId: string
) {
  const closingIndex = tabIds.indexOf(closingTabId)
  if (closingIndex === -1) return activeTabId

  const remaining = tabIds.filter((tabId) => tabId !== closingTabId)
  if (activeTabId !== closingTabId && activeTabId) {
    return remaining.includes(activeTabId)
      ? activeTabId
      : (remaining[0] ?? null)
  }

  return remaining[closingIndex] ?? remaining[closingIndex - 1] ?? null
}
