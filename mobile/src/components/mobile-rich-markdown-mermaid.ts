import { readableMermaidFlowchartSvg } from '../../../src/shared/mermaid-flowchart-contrast'
import { colors, type MobileColorScheme } from '../theme/mobile-theme'
import { mermaidDiagramConfig } from './pr-sidebar/mermaid-diagram-config'
import { loadPageMermaid } from './pr-sidebar/mermaid-page-engine'

export type RichMarkdownMermaidPreviewOptions = {
  getColorScheme: () => MobileColorScheme
  expandCopy: string
  codeToggleCopy: string
  onExpand: (svg: string) => void
}

export type RichMarkdownMermaidPreviewHandle = {
  sync: () => void
  dispose: () => void
}

let renderQueue: Promise<void> = Promise.resolve()
let nextDiagramSeq = 0

function enqueueMermaidRender(task: () => Promise<void>): void {
  const tail = renderQueue.then(task, task).then(() => {
    if (renderQueue === tail) {
      renderQueue = Promise.resolve()
    }
  })
  renderQueue = tail
}

function readMermaidCode(pre: HTMLElement): string {
  const code = pre.querySelector('code')
  if (code) {
    return (code.textContent ?? '').replace(/\n+$/, '').trim()
  }
  let text = ''
  for (const child of Array.from(pre.childNodes)) {
    if (child instanceof Element && child.hasAttribute('data-orca-mermaid-preview')) {
      continue
    }
    text += child.textContent ?? ''
  }
  return text.replace(/\n+$/, '').trim()
}

export function mountRichMarkdownMermaidPreview(
  host: HTMLElement,
  options: RichMarkdownMermaidPreviewOptions
): RichMarkdownMermaidPreviewHandle {
  const editor = host.querySelector<HTMLElement>('#editor')
  if (!editor) {
    return { sync: () => {}, dispose: () => {} }
  }

  let disposed = false
  let mutating = false
  const renderTokenByPre = new WeakMap<HTMLElement, number>()

  const withPausedObserver = (fn: () => void) => {
    mutating = true
    observer.disconnect()
    try {
      fn()
    } finally {
      mutating = false
      if (!disposed) {
        observer.observe(editor, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['data-language']
        })
      }
    }
  }

  const ensurePreviewNode = (pre: HTMLElement): HTMLElement => {
    const existing = pre.querySelector<HTMLElement>('[data-orca-mermaid-preview="true"]')
    if (existing) {
      return existing
    }
    const preview = document.createElement('div')
    preview.setAttribute('contenteditable', 'false')
    preview.setAttribute('data-orca-mermaid-preview', 'true')
    preview.className = 'orca-mermaid-preview'

    const bar = document.createElement('div')
    bar.className = 'orca-mermaid-preview-bar'

    const heading = document.createElement('span')
    heading.className = 'orca-mermaid-preview-title'
    heading.textContent = 'mermaid'

    const actions = document.createElement('div')
    actions.className = 'orca-mermaid-preview-actions'

    const toggleBtn = document.createElement('button')
    toggleBtn.type = 'button'
    toggleBtn.className = 'orca-mermaid-btn'
    toggleBtn.setAttribute('data-mermaid-action', 'toggle-code')
    toggleBtn.setAttribute('aria-label', options.codeToggleCopy)
    toggleBtn.textContent = '</>'

    const expandBtn = document.createElement('button')
    expandBtn.type = 'button'
    expandBtn.className = 'orca-mermaid-btn'
    expandBtn.setAttribute('data-mermaid-action', 'expand')
    expandBtn.setAttribute('aria-label', options.expandCopy)
    expandBtn.textContent = '⤢'

    actions.appendChild(toggleBtn)
    actions.appendChild(expandBtn)
    bar.appendChild(heading)
    bar.appendChild(actions)

    const svgHost = document.createElement('div')
    svgHost.className = 'orca-mermaid-svg'
    svgHost.setAttribute('data-testid', 'mermaid-diagram')

    preview.appendChild(bar)
    preview.appendChild(svgHost)

    preview.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target) {
        return
      }
      const actionBtn = target.closest('[data-mermaid-action]')
      const action = actionBtn?.getAttribute('data-mermaid-action')
      if (action === 'toggle-code') {
        event.preventDefault()
        event.stopPropagation()
        withPausedObserver(() => {
          const showing = pre.getAttribute('data-mermaid-show-code') === 'true'
          if (showing) {
            pre.removeAttribute('data-mermaid-show-code')
          } else {
            pre.setAttribute('data-mermaid-show-code', 'true')
          }
        })
        return
      }
      if (action === 'expand' || target.closest('.orca-mermaid-svg')) {
        event.preventDefault()
        event.stopPropagation()
        const serialized = preview.dataset.serializedSvg
        if (serialized) {
          options.onExpand(serialized)
        }
      }
    })

    pre.appendChild(preview)
    return preview
  }

  const sync = () => {
    if (disposed || mutating) {
      return
    }
    const blocks = editor.querySelectorAll<HTMLElement>('pre[data-language="mermaid"]')
    if (blocks.length === 0) {
      return
    }
    const scheme = options.getColorScheme()
    for (const pre of Array.from(blocks)) {
      const source = readMermaidCode(pre)
      if (!source) {
        withPausedObserver(() => {
          pre.removeAttribute('data-mermaid-rendered')
          pre.querySelector('[data-orca-mermaid-preview="true"]')?.remove()
        })
        continue
      }
      const existing = pre.querySelector<HTMLElement>('[data-orca-mermaid-preview="true"]')
      if (
        existing &&
        existing.dataset.renderedSource === source &&
        existing.dataset.renderedScheme === scheme &&
        pre.getAttribute('data-mermaid-rendered') === 'true'
      ) {
        continue
      }
      const token = (renderTokenByPre.get(pre) ?? 0) + 1
      renderTokenByPre.set(pre, token)
      const diagramId = `orca-rich-mermaid-${String(++nextDiagramSeq)}`

      enqueueMermaidRender(async () => {
        if (disposed || !pre.isConnected || renderTokenByPre.get(pre) !== token) {
          return
        }
        try {
          const mermaid = await loadPageMermaid()
          if (disposed || !pre.isConnected || renderTokenByPre.get(pre) !== token) {
            return
          }
          mermaid.initialize(mermaidDiagramConfig(scheme))
          const { svg } = await mermaid.render(diagramId, source)
          if (disposed || !pre.isConnected || renderTokenByPre.get(pre) !== token) {
            return
          }
          const readable = readableMermaidFlowchartSvg(svg, colors.textPrimary, colors.bgRaised)
          withPausedObserver(() => {
            const preview = ensurePreviewNode(pre)
            const svgHost = preview.querySelector<HTMLElement>('.orca-mermaid-svg')
            if (svgHost) {
              svgHost.innerHTML = readable
              const drawing = svgHost.querySelector('svg')
              preview.dataset.serializedSvg = drawing
                ? new XMLSerializer().serializeToString(drawing)
                : readable
            }
            preview.dataset.renderedSource = source
            preview.dataset.renderedScheme = scheme
            pre.setAttribute('data-mermaid-rendered', 'true')
          })
        } catch {
          document.getElementById(`d${diagramId}`)?.remove()
          document.getElementById(diagramId)?.remove()
          if (!disposed && pre.isConnected && renderTokenByPre.get(pre) === token) {
            withPausedObserver(() => {
              pre.removeAttribute('data-mermaid-rendered')
              pre.querySelector('[data-orca-mermaid-preview="true"]')?.remove()
            })
          }
        }
      })
    }
  }

  const observer = new MutationObserver(() => {
    sync()
  })
  observer.observe(editor, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-language']
  })
  sync()

  return {
    sync,
    dispose: () => {
      disposed = true
      observer.disconnect()
    }
  }
}
