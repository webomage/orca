import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { mountFixture } from '../test-support/rpc-recording/recorder-fixture-shape'

vi.mock('react-native', () => ({
  Keyboard: {
    dismiss: vi.fn(),
    addListener: () => ({ remove: () => {} })
  }
}))
vi.mock('../platform/haptics', () => ({ triggerError: vi.fn() }))

import { useMobileSessionTerminalSendActions } from './use-mobile-session-terminal-send-actions'
import type { MobileSessionTerminalWebviewModel } from './use-mobile-session-terminal-webview'

function mountSendActions(overrides: Partial<MobileSessionTerminalWebviewModel>) {
  let latest!: ReturnType<typeof useMobileSessionTerminalSendActions>
  const sendTerminalUserInput = vi.fn().mockResolvedValue({
    id: '1',
    ok: true,
    result: { send: { accepted: true } }
  })
  const handleLiveInputAccessoryBytes = vi.fn().mockResolvedValue({ kind: 'allow-raw' as const })
  const handleTerminalInteraction = vi.fn()
  const client = mountFixture<NonNullable<MobileSessionTerminalWebviewModel['client']>>({})
  const liveInputFocusTimerRef = { current: null as ReturnType<typeof setTimeout> | null }

  function Probe(props: { scope: MobileSessionTerminalWebviewModel }) {
    latest = useMobileSessionTerminalSendActions(props.scope)
    return null
  }

  const baseScope = mountFixture<MobileSessionTerminalWebviewModel>({
    client,
    clientRef: { current: client },
    connStateRef: { current: 'connected' },
    deviceTokenRef: { current: 'dev-1' },
    activeHandle: 'term-1',
    activeHandleRef: { current: 'term-1' },
    activeSessionTab: {
      id: 'tab-1',
      type: 'terminal',
      title: 'agy',
      terminalHandle: 'term-1',
      agentStatus: { agent: 'agy', state: 'working' }
    },
    activeSessionTabTypeRef: { current: 'terminal' },
    visibleTerminalHandlesRef: { current: ['term-1'] },
    liveInputTerminalHandlesRef: { current: new Set<string>() },
    tripleTapEnterEnabled: true,
    canSend: true,
    sendingRef: { current: false },
    ptyModesRef: { current: new Map() },
    terminalRefs: { current: new Map() },
    liveInputRef: { current: null },
    commandInputRef: { current: null },
    liveInputFocusTimerRef,
    sendLiveTerminalInputRef: { current: vi.fn() },
    sessionTabActionSheetKeyboardHideSubRef: { current: null },
    sessionTabActionSheetRequestSeqRef: { current: 0 },
    keyboardHeight: 0,
    bufferedTerminalDraftState: {
      input: '',
      setInput: vi.fn(),
      beginBufferedTerminalDraftSend: vi.fn(() => ({ handle: 'term-1', text: '' })),
      restoreRejectedDraft: vi.fn(),
      settleBufferedTerminalDraftSend: vi.fn(() => true),
      reconcileTerminalTabs: vi.fn()
    },
    getSendCompletionGeneration: () => 1,
    getLiveInteractionGeneration: () => 1,
    handleLiveInputAccessoryBytes,
    handleLiveInputSubmit: vi.fn().mockResolvedValue(true),
    handleTerminalInteraction,
    sendTerminalUserInput,
    sendTerminalOrderedInput: sendTerminalUserInput,
    scheduleDelayedAction: vi.fn(),
    showToast: vi.fn(),
    ...overrides
  })

  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(createElement(Probe, { scope: baseScope }))
  })
  return {
    get actions() {
      return latest
    },
    sendTerminalUserInput,
    handleLiveInputAccessoryBytes,
    handleTerminalInteraction,
    liveInputFocusTimerRef,
    unmount: () => {
      act(() => {
        renderer.unmount()
      })
    }
  }
}

describe('handleTerminalTripleTap', () => {
  it('sends raw Enter in Message mode when the draft is empty (selection dialogs / inline confirm)', async () => {
    const harness = mountSendActions({})
    try {
      const focusCallback = vi.fn()
      harness.liveInputFocusTimerRef.current = setTimeout(focusCallback, 50)

      await act(async () => {
        await harness.actions.handleTerminalTripleTap('term-1')
      })

      expect(harness.liveInputFocusTimerRef.current).toBeNull()
      expect(harness.handleTerminalInteraction).toHaveBeenCalledWith('term-1')
      expect(harness.handleLiveInputAccessoryBytes).toHaveBeenCalledWith({ bytes: '\r' })
      expect(harness.sendTerminalUserInput).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ terminal: 'term-1', text: '\r', enter: false }),
        expect.anything()
      )
    } finally {
      harness.unmount()
    }
  })

  it('submits the buffered draft with Enter when Message mode has unsent text', async () => {
    const harness = mountSendActions({
      bufferedTerminalDraftState: {
        input: 'inline comment',
        setInput: vi.fn(),
        beginBufferedTerminalDraftSend: vi.fn(() => ({ handle: 'term-1', text: 'inline comment' })),
        restoreRejectedDraft: vi.fn(),
        settleBufferedTerminalDraftSend: vi.fn(() => true),
        reconcileTerminalTabs: vi.fn()
      }
    })
    try {
      await act(async () => {
        await harness.actions.handleTerminalTripleTap('term-1')
      })

      expect(harness.sendTerminalUserInput).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ terminal: 'term-1', text: 'inline comment', enter: true }),
        expect.anything()
      )
    } finally {
      harness.unmount()
    }
  })

  it('flushes live input and sends Enter when Live Input mode is enabled', async () => {
    const handleLiveInputAccessoryBytes = vi.fn().mockResolvedValue({ kind: 'handled' as const })
    const harness = mountSendActions({
      liveInputTerminalHandlesRef: { current: new Set(['term-1']) },
      handleLiveInputAccessoryBytes
    })
    try {
      await act(async () => {
        await harness.actions.handleTerminalTripleTap('term-1')
      })

      expect(handleLiveInputAccessoryBytes).toHaveBeenCalledWith({ bytes: '\r' })
      expect(harness.sendTerminalUserInput).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })

  it('ignores triple taps when disabled in settings', async () => {
    const harness = mountSendActions({ tripleTapEnterEnabled: false })
    try {
      await act(async () => {
        await harness.actions.handleTerminalTripleTap('term-1')
      })

      expect(harness.handleTerminalInteraction).not.toHaveBeenCalled()
      expect(harness.sendTerminalUserInput).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })
})
