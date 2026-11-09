import {
  normalizeAgentStatusPayload,
  type ParsedAgentStatusPayload
} from '../../agent-status/contracts/agent-status-types'
import {
  antigravityRosterToSnapshots,
  createAntigravitySubagentRoster,
  extractAntigravitySubagentSpawnIdentity,
  finishAntigravitySubagent,
  hasWaitingAntigravitySubagent,
  queueAntigravitySubagentSpawn,
  upsertAntigravitySubagent,
  type AntigravitySubagentRoster
} from '../../antigravity-subagent-roster'
import { readFirstString } from '../interactive-tool'
import type { HookListenerState } from '../listener-state'
import { resolvePrompt, resolveToolState } from '../prompt-fields'
import { extractToolFields, isNewTurnEvent } from '../provider-event-routing'
import { readLastUserPromptFromTranscript } from '../transcript-lines'
import { readAntigravityToolCall } from './antigravity-tool-fields'
import { isAntigravityStopStillBusy } from './antigravity-event-rules'

export function isAntigravityFeedbackTool(toolName: string | undefined): boolean {
  return toolName === 'ask_question' || toolName === 'ask_permission'
}

function isAntigravitySubagentTool(toolName: string | undefined): boolean {
  return toolName === 'invoke_subagent' || toolName === 'send_message'
}

/** agy sends a backgrounded run_command's PostToolUse only when the command ends; daemons are never expected to. */
function trackAntigravityBackgroundCommand(
  state: HookListenerState,
  paneKey: string,
  eventName: unknown,
  conversationId: string | undefined,
  hookPayload: Record<string, unknown>
): void {
  const { toolName, toolInputSource } = readAntigravityToolCall(hookPayload)
  const stepIdx = hookPayload.stepIdx
  if (
    toolName !== 'run_command' ||
    !conversationId ||
    typeof stepIdx !== 'number' ||
    (eventName !== 'PreToolUse' && eventName !== 'PostToolUse')
  ) {
    return
  }
  const key = `${conversationId}:${stepIdx}`
  if (eventName === 'PostToolUse') {
    state.antigravityChildWorkByPaneKey.get(paneKey)?.commands?.delete(key)
    return
  }
  const args =
    typeof toolInputSource === 'object' && toolInputSource !== null ? toolInputSource : {}
  if ('IsDaemon' in args && args.IsDaemon === true) {
    return
  }
  const work = antigravityChildWork(state, paneKey)
  work.commands = (work.commands ?? new Set()).add(key)
}

function antigravityChildWork(
  state: HookListenerState,
  paneKey: string
): { subagentParent?: string; commands?: Set<string> } {
  let work = state.antigravityChildWorkByPaneKey.get(paneKey)
  if (!work) {
    work = {}
    state.antigravityChildWorkByPaneKey.set(paneKey, work)
  }
  return work
}

function getOrCreateAntigravityRoster(
  state: HookListenerState,
  paneKey: string
): AntigravitySubagentRoster {
  let roster = state.antigravitySubagentRosterByPaneKey.get(paneKey)
  if (!roster) {
    roster = createAntigravitySubagentRoster()
    state.antigravitySubagentRosterByPaneKey.set(paneKey, roster)
  }
  return roster
}

function normalizeAntigravityChildEvent(
  state: HookListenerState,
  eventName: unknown,
  paneKey: string,
  conversationId: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const roster = getOrCreateAntigravityRoster(state, paneKey)
  const toolCall = readAntigravityToolCall(hookPayload)
  if (eventName === 'PreToolUse' && toolCall.toolName === 'invoke_subagent') {
    const identity = extractAntigravitySubagentSpawnIdentity(toolCall.toolInputSource)
    if (identity) {
      queueAntigravitySubagentSpawn(roster, identity)
    }
  }

  if (eventName === 'Stop') {
    if (isAntigravityStopStillBusy(hookPayload)) {
      upsertAntigravitySubagent(roster, conversationId, 'working', Date.now())
    } else {
      finishAntigravitySubagent(roster, conversationId)
    }
  } else if (eventName === 'PreToolUse' && isAntigravityFeedbackTool(toolCall.toolName)) {
    upsertAntigravitySubagent(roster, conversationId, 'waiting', Date.now())
  } else if (
    eventName === 'PreInvocation' ||
    eventName === 'PostInvocation' ||
    eventName === 'PreToolUse' ||
    eventName === 'PostToolUse'
  ) {
    upsertAntigravitySubagent(roster, conversationId, 'working', Date.now())
  } else {
    return null
  }

  const lead = roster.lead
  if (lead?.state === 'done' && !lead.heldOpenByHelpers && roster.children.size === 0) {
    return null
  }

  const combinedState =
    lead?.state === 'waiting' || hasWaitingAntigravitySubagent(roster) ? 'waiting' : 'working'
  const snapshot = state.lastToolByPaneKey.get(paneKey) ?? {}
  return normalizeAgentStatusPayload({
    state: combinedState,
    prompt: state.lastPromptByPaneKey.get(paneKey) ?? '',
    agentType: 'antigravity',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    lastAssistantMessageIsToolOutput: snapshot.lastAssistantMessageIsToolOutput,
    subagents: antigravityRosterToSnapshots(roster),
    mainAgent: lead?.heldOpenByHelpers
      ? { state: 'done', stateStartedAt: lead.stateStartedAt }
      : undefined
  })
}

export function normalizeAntigravityEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const transcriptPath = readFirstString(hookPayload, ['transcriptPath', 'transcript_path'])
  const conversationId = readFirstString(hookPayload, ['conversationId', 'conversation_id'])
  const subagentParent =
    state.antigravitySubagentParentByPaneKey.get(paneKey) ??
    state.antigravityChildWorkByPaneKey.get(paneKey)?.subagentParent
  if (subagentParent && conversationId && conversationId !== subagentParent) {
    // Subagents run inside the parent agy under their own conversationId and never carry user input.
    if (!readFirstString(hookPayload, ['lastUserInput'])) {
      return normalizeAntigravityChildEvent(state, eventName, paneKey, conversationId, hookPayload)
    }
    delete antigravityChildWork(state, paneKey).subagentParent
    state.antigravitySubagentParentByPaneKey.delete(paneKey)
    state.antigravitySubagentRosterByPaneKey.delete(paneKey)
  }
  if (eventName === 'PreInvocation') {
    state.antigravityCompletedTranscriptByPaneKey.delete(paneKey)
  } else if (
    transcriptPath &&
    eventName !== 'Stop' &&
    state.antigravityCompletedTranscriptByPaneKey.get(paneKey) === transcriptPath
  ) {
    // Ignore bookkeeping PostToolUse after Stop so finished rows do not resurrect.
    return null
  }

  const toolCall = readAntigravityToolCall(hookPayload)
  const toolName = toolCall.toolName
  if (
    conversationId &&
    (eventName === 'PreToolUse' || eventName === 'PostToolUse') &&
    isAntigravitySubagentTool(toolName)
  ) {
    antigravityChildWork(state, paneKey).subagentParent = conversationId
    state.antigravitySubagentParentByPaneKey.set(paneKey, conversationId)
    if (eventName === 'PreToolUse' && toolName === 'invoke_subagent') {
      const identity = extractAntigravitySubagentSpawnIdentity(toolCall.toolInputSource)
      if (identity) {
        queueAntigravitySubagentSpawn(getOrCreateAntigravityRoster(state, paneKey), identity)
      }
    }
  }
  trackAntigravityBackgroundCommand(state, paneKey, eventName, conversationId, hookPayload)

  const stopStillBusy = eventName === 'Stop' && isAntigravityStopStillBusy(hookPayload)
  // agy ends the parent's turn with fullyIdle=false while its helpers run; they hold the pane open.
  const childWork = state.antigravityChildWorkByPaneKey.get(paneKey)
  const heldOpenByHelpers =
    stopStillBusy &&
    (state.antigravitySubagentParentByPaneKey.has(paneKey) ||
      childWork?.subagentParent !== undefined)
  // A backgrounded command holds it the same way, as monitoring so silence can still bound it.
  const heldOpenByCommands =
    stopStillBusy && !heldOpenByHelpers && (childWork?.commands?.size ?? 0) > 0
  const leadState =
    eventName === 'PreToolUse' && isAntigravityFeedbackTool(toolName)
      ? 'waiting'
      : eventName === 'Stop'
        ? stopStillBusy
          ? 'working'
          : 'done'
        : eventName === 'PreInvocation' ||
            eventName === 'PostInvocation' ||
            eventName === 'PreToolUse' ||
            eventName === 'PostToolUse'
          ? 'working'
          : null

  if (!leadState) {
    return null
  }

  const roster = state.antigravitySubagentRosterByPaneKey.get(paneKey)
  if (roster || state.antigravitySubagentParentByPaneKey.has(paneKey)) {
    const activeRoster = getOrCreateAntigravityRoster(state, paneKey)
    const nextLeadState = heldOpenByHelpers ? 'done' : leadState
    const previousLead = activeRoster.lead
    const stateStartedAt =
      previousLead &&
      previousLead.state === nextLeadState &&
      previousLead.heldOpenByHelpers === heldOpenByHelpers
        ? previousLead.stateStartedAt
        : Date.now()
    activeRoster.lead = {
      state: nextLeadState,
      stateStartedAt,
      heldOpenByHelpers
    }
  }

  const resetsTurn = isNewTurnEvent('antigravity', eventName)
  // Cache prompts per turn instead of rescanning large transcripts per hook.
  const cachedPrompt = resetsTurn ? undefined : state.lastPromptByPaneKey.get(paneKey)
  const effectivePrompt =
    promptText || cachedPrompt || readLastUserPromptFromTranscript(transcriptPath) || ''
  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields('antigravity', eventName, hookPayload),
    { resetOnNewTurn: resetsTurn }
  )

  const stateName =
    leadState === 'working' && hasWaitingAntigravitySubagent(roster) ? 'waiting' : leadState

  // Stop between tools can report fullyIdle=false; only an idle Stop is terminal.
  if (eventName === 'Stop' && !stopStillBusy) {
    state.antigravityChildWorkByPaneKey.delete(paneKey)
    state.antigravitySubagentParentByPaneKey.delete(paneKey)
    state.antigravitySubagentRosterByPaneKey.delete(paneKey)
    if (transcriptPath) {
      state.antigravityCompletedTranscriptByPaneKey.set(paneKey, transcriptPath)
    }
  }

  const activeRoster = state.antigravitySubagentRosterByPaneKey.get(paneKey)
  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, effectivePrompt, {
      resetOnNewTurn: resetsTurn
    }),
    agentType: 'antigravity',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    lastAssistantMessageIsToolOutput: snapshot.lastAssistantMessageIsToolOutput,
    ...(heldOpenByCommands ? { workingMode: 'monitoring' as const } : {}),
    subagents: antigravityRosterToSnapshots(activeRoster),
    mainAgent:
      heldOpenByHelpers || heldOpenByCommands
        ? { state: 'done', stateStartedAt: activeRoster?.lead?.stateStartedAt ?? Date.now() }
        : undefined
  })
}
