import { useCallback } from 'react'
import { clearTerminalLiveInputFocusTimer } from '../terminal/terminal-live-input'
import type { MobileSessionTab } from './mobile-session-route-types'
import type { MobileSessionTerminalWebviewModel } from './use-mobile-session-terminal-webview'

type TerminalTripleTapSendOrigin = {
  readonly tab: MobileSessionTab | null
  readonly generation: number
  readonly interaction: number
}

type TerminalTripleTapHandlers = {
  readonly dismissKeyboardAfterAgentSend: (
    origin: TerminalTripleTapSendOrigin,
    accepted: boolean
  ) => void
  readonly handleAccessoryKey: (key: { bytes: string }, handle?: string) => Promise<boolean>
  readonly handleSend: () => Promise<void>
}

export function useMobileSessionTerminalTripleTap(
  scope: MobileSessionTerminalWebviewModel,
  { dismissKeyboardAfterAgentSend, handleAccessoryKey, handleSend }: TerminalTripleTapHandlers
) {
  const {
    activeHandle,
    activeSessionTab,
    bufferedTerminalDraftState,
    getLiveInteractionGeneration,
    getSendCompletionGeneration,
    handleTerminalInteraction,
    liveInputFocusTimerRef,
    liveInputTerminalHandlesRef,
    tripleTapEnterEnabled,
    visibleTerminalHandlesRef
  } = scope
  const draftInput = bufferedTerminalDraftState.input

  return useCallback(
    async (handle: string) => {
      if (!tripleTapEnterEnabled || !visibleTerminalHandlesRef.current.includes(handle)) {
        return
      }
      clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef)
      handleTerminalInteraction(handle)
      if (
        !liveInputTerminalHandlesRef.current.has(handle) &&
        handle === activeHandle &&
        draftInput.trim().length > 0
      ) {
        await handleSend()
        return
      }
      const sendOrigin = {
        tab: activeSessionTab,
        generation: getSendCompletionGeneration(),
        interaction: getLiveInteractionGeneration()
      }
      const accepted = await handleAccessoryKey({ bytes: '\r' }, handle)
      dismissKeyboardAfterAgentSend(
        sendOrigin,
        accepted && sendOrigin.interaction === getLiveInteractionGeneration()
      )
    },
    [
      activeHandle,
      activeSessionTab,
      dismissKeyboardAfterAgentSend,
      draftInput,
      getLiveInteractionGeneration,
      getSendCompletionGeneration,
      handleAccessoryKey,
      handleSend,
      handleTerminalInteraction,
      liveInputFocusTimerRef,
      liveInputTerminalHandlesRef,
      tripleTapEnterEnabled,
      visibleTerminalHandlesRef
    ]
  )
}
