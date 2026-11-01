import { expect, it } from 'vitest'

export function mermaidRenderTest(getBrowser, openPage) {
  it('renders a mermaid code block as an SVG diagram while preserving its Markdown source on edit', async () => {
    const { page, consoleErrors } = await openPage(getBrowser())
    try {
      const mermaidMd = [
        '# Architecture',
        '',
        '```mermaid',
        'flowchart LR',
        '  A[Client] --> B[Daemon]',
        '```',
        '',
        'Trailing paragraph'
      ].join('\n')
      await page.evaluate((next) => globalThis.__orcaEditor.set({ content: next }), mermaidMd)
      await page.waitForFunction(
        () =>
          document.querySelector(
            '#first-surface #editor pre[data-language="mermaid"] [data-orca-mermaid-preview="true"] svg[aria-roledescription]'
          ) !== null,
        null,
        { timeout: 15_000 }
      )
      const rendered = await page.evaluate(() => {
        const pre = document.querySelector('#first-surface #editor pre[data-language="mermaid"]')
        const code = pre?.querySelector('code')
        const svg = pre?.querySelector('svg[aria-roledescription]')
        return {
          renderedAttr: pre?.getAttribute('data-mermaid-rendered') ?? null,
          codeDisplay: code ? getComputedStyle(code).display : null,
          role: svg?.getAttribute('aria-roledescription') ?? null
        }
      })
      expect(rendered).toEqual({
        renderedAttr: 'true',
        codeDisplay: 'none',
        role: 'flowchart-v2'
      })

      await page.evaluate(() => {
        globalThis.__orcaEditor.changes.length = 0
        const p = document.querySelector('#first-surface #editor > p')
        p.textContent = 'Updated paragraph'
        document
          .querySelector('#first-surface #editor')
          .dispatchEvent(new Event('input', { bubbles: true }))
      })
      await page.waitForFunction(() => globalThis.__orcaEditor.changes.length > 0)
      expect(await page.evaluate(() => globalThis.__orcaEditor.changes.at(-1))).toBe(
        [
          '# Architecture',
          '',
          '```mermaid',
          'flowchart LR',
          '  A[Client] --> B[Daemon]',
          '```',
          '',
          'Updated paragraph'
        ].join('\n')
      )
      expect(await page.evaluate(() => globalThis.__orcaCspViolations)).toEqual([])
      expect(consoleErrors).toEqual([])
    } finally {
      await page.close()
    }
  }, 600_000)
}
