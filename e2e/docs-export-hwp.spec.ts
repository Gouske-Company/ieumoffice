/**
 * Save As › Hangul (.hwpx, .hwp) in the Word editor: the built app converts the
 * document in its worker with the engine's WebAssembly, writes a copy Hangul
 * can open, asks first when something does not carry over, and leaves the Word
 * document, its file and its tab as they were. The copy opens in a Hangul tab.
 */
import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

const execFileAsync = promisify(execFile)
const REPO_ROOT = join(__dirname, '..')
const NOTICE = join(REPO_ROOT, 'packages/docx2hwp/tests/fixtures/notice.docx')
const KITCHEN_SINK = join(
  REPO_ROOT,
  'apps/docs/tests/pagination-corpus/docx/fixture-kitchen-sink.docx',
)

/** the notice's body paragraphs as the converter writes them (packages/docx2hwp/tests) */
const NOTICE_TEXTS = [
  '2026학년도 겨울방학 안내',
  '보통 글 굵게 기울임 밑줄 빨간 글 형광펜 취소선 위첨자 맑은 고딕 14pt',
  '1. 방학 기간',
  '방학식: 12월 31일',
  '개학식: 2월 2일',
  '2. 준비물',
  '필통',
  '연필 두 자루',
  '공책',
  '',
  '그림:',
  '',
  '오른쪽 정렬 문단',
  '',
  '',
  '쪽 나눔 뒤 문단',
]

/** body paragraph texts of a Hangul file, read with the engine build the Hangul editor runs */
async function hangulTexts(path: string): Promise<string[]> {
  const core = pathToFileURL(join(REPO_ROOT, 'vendor/rhwp-core/rhwp.js')).href
  const wasm = join(REPO_ROOT, 'vendor/rhwp-core/rhwp_bg.wasm')
  const script = [
    "import { readFileSync } from 'node:fs'",
    `const { default: init, HwpDocument } = await import(${JSON.stringify(core)})`,
    `await init({ module_or_path: readFileSync(${JSON.stringify(wasm)}) })`,
    'const doc = new HwpDocument(readFileSync(process.argv[1]))',
    'const texts = []',
    'for (let p = 0; p < doc.getParagraphCount(0); p++) {',
    '  const n = doc.getParagraphLength(0, p)',
    "  texts.push(n ? doc.getTextRange(0, p, 0, n) : '')",
    '}',
    'process.stdout.write(JSON.stringify(texts))',
  ].join('\n')
  const { stdout } = await execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    script,
    path,
  ])
  return JSON.parse(stdout) as string[]
}

/** Save As picks `target`; the loss confirmation is recorded and answered with `answer` */
async function stubDialogs(app: ElectronApplication, target: string, answer: number) {
  await app.evaluate(
    ({ dialog }, [path, response]) => {
      const host = globalThis as unknown as { __hwpConfirms: unknown[] }
      host.__hwpConfirms = []
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never
      dialog.showMessageBox = (async (...args: unknown[]) => {
        host.__hwpConfirms.push(args[args.length - 1])
        return { response, checkboxChecked: false }
      }) as never
    },
    [target, answer] as const,
  )
}

const confirms = (app: ElectronApplication) =>
  app.evaluate(
    () =>
      (globalThis as unknown as { __hwpConfirms: Array<{ message?: string; detail?: string }> })
        .__hwpConfirms,
  )

async function saveAs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ webContents }) => {
    webContents
      .getAllWebContents()
      .find((w) => w.getURL().includes('://docs/'))
      ?.send('menu:command', 'save-as')
  })
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  )

test('Save As .hwpx and .hwp writes Hangul copies and leaves the Word document alone', async () => {
  test.setTimeout(240_000)
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-docs-export-hwp-'))
  const docxPath = join(dir, 'notice.docx')
  await copyFile(NOTICE, docxPath)
  const original = await readFile(docxPath)

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'docs-export-hwp',
    openFile: docxPath,
  })
  const { app } = launched
  try {
    const docs = await waitForPageWithUrl(app, '://docs/')
    await expect(docs.locator('.ProseMirror').first()).toContainText('2026학년도 겨울방학 안내', {
      timeout: 60_000,
    })
    const shell = await waitForPageWithUrl(app, 'shell/out')
    const tabs = shell.locator('.tab-bar .tab-item:not(.tab-home)')

    for (const ext of ['hwpx', 'hwp'] as const) {
      const target = join(dir, `notice.${ext}`)
      await stubDialogs(app, target, 0)
      await saveAs(app)
      await expect.poll(() => exists(target), { timeout: 120_000 }).toBe(true)
      expect((await confirms(app)).length, `${ext}: the notice loses nothing`).toBe(0)
      expect(await hangulTexts(target)).toEqual(NOTICE_TEXTS)
      // the generated copy opens in a Hangul tab beside the Word one
      await expect(
        tabs.locator('.tab-title').getByText(`notice.${ext}`, { exact: true }),
      ).toHaveCount(1, { timeout: 60_000 })
    }
    expect(Buffer.compare(await readFile(docxPath), original)).toBe(0)
    const word = tabs.filter({ hasText: 'notice.docx' })
    await expect(word).toHaveCount(1)
    await expect(word).toHaveAttribute('title', `notice.docx\n${docxPath}`)
    await expect(tabs.locator('.tab-title')).toHaveText([
      'notice.docx',
      'notice.hwpx',
      'notice.hwp',
    ])
    expect(app.windows().some((w) => w.url().includes('://hwp/'))).toBe(true)
  } finally {
    await closeAndSaveVideo(launched, 'docs-export-hwp')
  }
})

test('a copy that loses something is confirmed first: Cancel writes nothing, Save writes', async () => {
  test.setTimeout(240_000)
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-docs-export-hwp-loss-'))
  const docxPath = join(dir, 'kitchen.docx')
  await copyFile(KITCHEN_SINK, docxPath)
  const original = await readFile(docxPath)

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'docs-export-hwp-loss',
    openFile: docxPath,
  })
  const { app } = launched
  try {
    const docs = await waitForPageWithUrl(app, '://docs/')
    await expect(docs.locator('.ProseMirror').first()).not.toBeEmpty({ timeout: 60_000 })
    const target = join(dir, 'kitchen.hwp')

    await stubDialogs(app, target, 1)
    await saveAs(app)
    await expect.poll(async () => (await confirms(app)).length, { timeout: 120_000 }).toBe(1)
    const [asked] = await confirms(app)
    expect(asked.detail).toContain('Equations')
    await docs.waitForTimeout(1000)
    expect(await exists(target)).toBe(false)

    await stubDialogs(app, target, 0)
    await saveAs(app)
    await expect.poll(() => exists(target), { timeout: 120_000 }).toBe(true)
    expect((await hangulTexts(target)).some((text) => text.length > 0)).toBe(true)
    expect(Buffer.compare(await readFile(docxPath), original)).toBe(0)
  } finally {
    await closeAndSaveVideo(launched, 'docs-export-hwp-loss')
  }
})
