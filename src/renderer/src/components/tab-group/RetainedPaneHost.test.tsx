// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SYNC_FIT_PANES_EVENT } from '@/constants/terminal'
import { RetainedPaneHost } from './RetainedPaneHost'
import { registerTabGroupBody } from './tab-group-body-geometry'

const disconnect = vi.fn()
const observerCreated = vi.fn()
let notifyResize: () => void
let anchors: HTMLDivElement[]
let unregisterAnchors: (() => void)[]

beforeEach(() => {
  vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notifyResize = callback
        observerCreated()
      }
      observe(): void {}
      unobserve(): void {}
      disconnect = disconnect
    }
  )
  disconnect.mockClear()
  observerCreated.mockClear()
  anchors = ['left', 'right'].map((id, index) => {
    const anchor = document.createElement('div')
    anchor.dataset.tabGroupBodyId = id
    anchor.getBoundingClientRect = () => new DOMRect(index * 400, 32, 400, 568)
    document.body.append(anchor)
    return anchor
  })
  unregisterAnchors = ['left', 'right'].map((id, index) => registerTabGroupBody(id, anchors[index]))
})

afterEach(() => {
  cleanup()
  unregisterAnchors.forEach((unregister) => unregister())
  anchors.forEach((anchor) => anchor.remove())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('retains pane content across group moves and visibility changes using measured browser bounds', () => {
  const focus = vi.fn()
  const content = <input defaultValue="draft" />
  const view = render(
    <RetainedPaneHost groupId="left" isVisible onFocusOwningGroup={focus}>
      {content}
    </RetainedPaneHost>
  )
  const host = view.container.firstElementChild as HTMLDivElement
  const input = view.getByRole('textbox')
  expect(host.style.top).toBe('32px')
  expect(host.style.width).toBe('400px')
  fireEvent.change(input, { target: { value: 'unsent draft' } })

  view.rerender(
    <RetainedPaneHost groupId="right" isVisible onFocusOwningGroup={focus}>
      {content}
    </RetainedPaneHost>
  )
  expect(host.style.left).toBe('400px')
  expect(view.getByRole('textbox')).toBe(input)
  expect((input as HTMLInputElement).value).toBe('unsent draft')
  fireEvent.pointerDown(input)
  expect(focus).toHaveBeenLastCalledWith('right')

  anchors[1].getBoundingClientRect = () => new DOMRect(450, 32, 350, 500)
  act(() => notifyResize())
  expect(host.style.left).toBe('450px')
  expect(host.style.width).toBe('350px')

  view.rerender(
    <RetainedPaneHost groupId="right" isVisible={false}>
      {content}
    </RetainedPaneHost>
  )
  expect(host.style.display).toBe('none')
  expect(host.hasAttribute('inert')).toBe(true)
  expect(host.contains(input)).toBe(true)
  view.rerender(
    <RetainedPaneHost groupId="right" isVisible>
      {content}
    </RetainedPaneHost>
  )
  expect(host.style.display).toBe('flex')
  expect(host.hasAttribute('inert')).toBe(false)
  expect(view.getByRole('textbox')).toBe(input)
  view.unmount()
  expect(disconnect).toHaveBeenCalled()
})
it('deduplicates SYNC_FIT_PANES_EVENT across rAF and fallback timers when dimensions stay unchanged', () => {
  vi.useFakeTimers()
  const onSyncFit = vi.fn()
  window.addEventListener(SYNC_FIT_PANES_EVENT, onSyncFit)
  const view = render(
    <RetainedPaneHost groupId="left" isVisible fitTerminal>
      <span />
    </RetainedPaneHost>
  )
  const host = view.container.firstElementChild as HTMLDivElement
  host.getBoundingClientRect = () => new DOMRect(0, 32, 400, 568)

  act(() => {
    vi.advanceTimersByTime(200)
  })
  expect(onSyncFit).toHaveBeenCalledTimes(1)

  host.getBoundingClientRect = () => new DOMRect(0, 32, 520, 568)
  anchors[0].getBoundingClientRect = () => new DOMRect(0, 32, 520, 568)
  act(() => {
    notifyResize()
    vi.advanceTimersByTime(16)
  })
  act(() => {
    vi.advanceTimersByTime(200)
  })
  expect(onSyncFit).toHaveBeenCalledTimes(2)

  window.removeEventListener(SYNC_FIT_PANES_EVENT, onSyncFit)
  vi.useRealTimers()
})
