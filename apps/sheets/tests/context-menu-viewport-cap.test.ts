// @vitest-environment jsdom
/**
 * Regression pin for issue #390: the right-click cell menu ran off the bottom
 * of the window instead of scrolling.
 *
 * Univer caps the context-menu panel with an inline max-height, but its
 * useScrollYOverContainer hook wipes that value when the menu closes (it
 * measures the display:none popup as 0x0 and decides the menu fits) and React
 * never writes it back. From the second open on the panel is unbounded.
 * styles.css restores the cap with an !important rule on the panel.
 *
 * jsdom applies no stylesheet, so a computed-style check would be vacuous.
 * What is checkable is that the rule as committed (a) caps to the viewport and
 * beats the hook's inline write, and (b) its selector still matches the panel
 * the way the installed Univer emits it. The DOM is built from the class
 * string read out of Univer's shipped ContextMenuPanel, not transcribed by
 * hand, so an upgrade that changes the panel's shape fails here instead of
 * silently bringing the overflow back.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// jsdom rewrites import.meta.url to an http URL, so resolve from cwd instead.
const readFirst = (relatives: string[]): string => {
  const candidates = relatives.map((rel) => resolve(process.cwd(), rel))
  const found = candidates.find((path) => existsSync(path))
  if (!found) throw new Error(`not found; looked in ${candidates.join(', ')}`)
  return readFileSync(found, 'utf8')
}

const css = readFirst(['src/renderer/styles.css', 'apps/sheets/src/renderer/styles.css'])

const univerSource = (pkg: '@univerjs/ui' | '@univerjs/design'): string => {
  const require = createRequire(resolve(process.cwd(), 'package.json'))
  // the "require" export points at lib/cjs; the ESM build is the readable one
  const cjs = require.resolve(pkg)
  return readFileSync(cjs.replace(/[\\/]cjs[\\/]index\.js$/, '/es/index.js'), 'utf8')
}

/** Rules in styles.css that cap a panel inside a Univer popup. */
function capRules(): Array<{ selector: string; body: string }> {
  return [...css.matchAll(/([^{}]*\.univer-popup\s*>[^{}]*)\{([^{}]*)\}/g)]
    .map((m) => ({ selector: m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: m[2]! }))
    .filter((rule) => /max-height/.test(rule.body))
}

/** The class string Univer's ContextMenuPanel puts on its scroll container. */
function contextMenuPanelClass(source: string): string {
  const start = source.indexOf('function ContextMenuPanel(')
  expect(start, 'ContextMenuPanel not found in @univerjs/ui').toBeGreaterThan(-1)
  const end = source.indexOf('function ContextMenuMenu(', start)
  const body = source.slice(start, end > start ? end : undefined)
  const match = body.match(/className:\s*clsx\("([^"]+)"/)
  expect(match, 'ContextMenuPanel className not found').not.toBeNull()
  return match![1]!
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('context menu viewport cap (issue #390)', () => {
  it('caps the panel to the viewport over any inline max-height', () => {
    const rules = capRules()
    expect(rules).toHaveLength(1)
    const { body } = rules[0]!
    expect(body).toMatch(/max-height:\s*max\(120px,\s*calc\(100vh - 16px\)\)\s*!important/)
  })

  it('matches the context-menu panel as the installed Univer renders it', () => {
    const source = univerSource('@univerjs/ui')
    const panelClass = contextMenuPanelClass(source)
    // Popup (from @univerjs/design) renders section.univer-popup;
    // AnchoredContextMenu puts a bare <section> inside it and the panel
    // inside that.
    const design = univerSource('@univerjs/design')
    const popup = design.slice(design.indexOf('function Popup('))
    expect(popup).toMatch(/jsx\("section",\s*\{[^}]*className:\s*"univer-popup"/)
    const anchored = source.slice(source.indexOf('function AnchoredContextMenu('))
    expect(anchored).toMatch(/jsx\(Popup,[\s\S]*?jsx\("section",\s*\{\s*ref: contentRef/)

    document.body.innerHTML =
      `<section class="univer-popup"><section><div class="${panelClass}"></div></section></section>` +
      `<div data-u-context-menu-submenu="true"><div class="univer-overflow-y-auto"></div></div>`
    const { selector } = capRules()[0]!
    const panel = document.querySelector('.univer-popup > section > div')!
    expect(panel.matches(selector)).toBe(true)
    // Submenus are portaled to body with their own cap; the rule leaves them be.
    const submenuScroller = document.querySelector('[data-u-context-menu-submenu] > div')!
    expect(submenuScroller.matches(selector)).toBe(false)
  })
})
