import type { TerminalDocumentScope } from './document-scope'
import { notify } from './host-notify'
import {
  buildMouseClickInput,
  getMouseTrackingMode,
  isClickMouseTrackingMode
} from './mouse-input-encoding'
import { oscLinkAtViewportPoint } from './osc-link-tap'
import { viewportToCell } from './viewport-cell'
import type { ParsedFileLinkLocation } from '../../../../src/shared/file-links/file-link-location'
import {
  findTerminalFileLinksAtBufferPosition,
  findTerminalHttpLinkAtBufferPosition
} from '../../../../src/shared/terminal/links/terminal-link-buffer-hit-testing'

const MULTI_TAP_MAX_INTERVAL_MS = 400
const MULTI_TAP_MAX_DISTANCE_PX = 45
export const QUAD_TAP_SETTLE_MS = 280

export function cancelPendingTripleTap(scope: TerminalDocumentScope) {
  if (scope.pendingTripleTapTimer !== null) {
    clearTimeout(scope.pendingTripleTapTimer)
    scope.pendingTripleTapTimer = null
  }
}

export function notifyTerminalSurfaceTap(
  scope: TerminalDocumentScope,
  originX: number,
  originY: number,
  focusKeyboard: boolean
) {
  const tappedOscLink = oscLinkAtViewportPoint(scope, originX, originY)
  if (tappedOscLink && tappedOscLink.kind === 'file') {
    cancelPendingTripleTap(scope)
    scope.tapStreak = null
    notify(scope, { type: 'terminal-file-tap', candidates: [tappedOscLink.fileTap] })
    return
  }
  if (tappedOscLink && tappedOscLink.kind === 'url') {
    cancelPendingTripleTap(scope)
    scope.tapStreak = null
    notify(scope, { type: 'open-url', url: tappedOscLink.url })
    return
  }
  const cell = viewportToCell(scope, originX, originY)
  const term = scope.term
  if (cell && term) {
    // Desktop's link detectors take 1-based cells and rebuild rows that wrap.
    const position = { x: cell.col + 1, y: cell.row + 1 }
    const buffer = term.buffer.active
    const url = findTerminalHttpLinkAtBufferPosition(buffer, position, term.cols)
    if (url) {
      cancelPendingTripleTap(scope)
      scope.tapStreak = null
      notify(scope, { type: 'open-url', url })
      return
    }
    const { links, guesses } = findTerminalFileLinksAtBufferPosition(buffer, position, term.cols)
    // Why: a tap decides now, so only a path as written makes it a file tap; the host checks the guesses.
    if (links.length > 0) {
      cancelPendingTripleTap(scope)
      scope.tapStreak = null
      const candidates = uniqueFileTapCandidates([...links, ...guesses])
      notify(scope, { type: 'terminal-file-tap', candidates })
      return
    }
  }
  if (focusKeyboard && (scope.tripleTapEnterEnabled || scope.quadTapAltMEnabled)) {
    const now = Date.now()
    const prev = scope.tapStreak
    const dx = prev ? originX - prev.x : 0
    const dy = prev ? originY - prev.y : 0
    const withinStreak =
      prev !== null &&
      now - prev.t <= MULTI_TAP_MAX_INTERVAL_MS &&
      dx * dx + dy * dy <= MULTI_TAP_MAX_DISTANCE_PX * MULTI_TAP_MAX_DISTANCE_PX
    if (!withinStreak) {
      cancelPendingTripleTap(scope)
    }
    const nextCount = withinStreak ? prev.count + 1 : 1
    if (nextCount >= 4 && scope.quadTapAltMEnabled) {
      cancelPendingTripleTap(scope)
      scope.tapStreak = null
      notify(scope, { type: 'haptic', kind: 'selection' })
      notify(scope, { type: 'terminal-quad-tap' })
      return
    }
    if (nextCount === 3 && scope.tripleTapEnterEnabled) {
      cancelPendingTripleTap(scope)
      if (!scope.quadTapAltMEnabled) {
        scope.tapStreak = null
        notify(scope, { type: 'haptic', kind: 'selection' })
        notify(scope, { type: 'terminal-triple-tap' })
        return
      }
      scope.tapStreak = { count: 3, t: now, x: originX, y: originY }
      scope.pendingTripleTapTimer = setTimeout(function () {
        scope.pendingTripleTapTimer = null
        scope.tapStreak = null
        if (!scope.interactionActive || !scope.tripleTapEnterEnabled) {
          return
        }
        notify(scope, { type: 'haptic', kind: 'selection' })
        notify(scope, { type: 'terminal-triple-tap' })
      }, QUAD_TAP_SETTLE_MS)
      return
    }
    scope.tapStreak = { count: nextCount, t: now, x: originX, y: originY }
  } else {
    cancelPendingTripleTap(scope)
    scope.tapStreak = null
  }
  const clickInput = buildMouseClickInput(scope, originX, originY)
  if (clickInput) {
    // Flush pending live text before a click can move the TUI cursor.
    notify(scope, { type: 'terminal-input', bytes: clickInput, click: true })
  }
  // Touch still needs native focus after TUI clicks; unproven mouse encoding falls back to a plain tap.
  if (
    focusKeyboard ||
    !isClickMouseTrackingMode(getMouseTrackingMode(scope)) ||
    !scope.mouseEncodingKnown
  ) {
    notify(scope, { type: 'terminal-tap' })
  }
}

// One reading per path, the first, as desktop's existence probes keep.
function uniqueFileTapCandidates(links: readonly ParsedFileLinkLocation[]) {
  const seen = new Set<string>()
  const candidates: ParsedFileLinkLocation[] = []
  for (const { pathText, line, column } of links) {
    if (!seen.has(pathText)) {
      seen.add(pathText)
      candidates.push({ pathText, line, column })
    }
  }
  return candidates
}
