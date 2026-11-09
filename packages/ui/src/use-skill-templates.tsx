import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import { windowMcpState, type UserSkillText } from '@genoffice/agent-core'
import type { SkillProposals } from './use-skill-proposals'
import type { OnTemplateSkill, SkillUse } from './use-composer-skills'
import { buildSkillRequest, readSkillsForRequest } from './skill-send'
import { skillTemplateText } from './strings-skill-template'
import {
  chipRefForSkill,
  chipRefOf,
  handedRequestOf,
  isTemplateMissing,
  isUnsavedCurrent,
  skillTemplateBridge,
  templateChoice,
  templateOpenResultOf,
  type HandedRequest,
  type SkillTemplateBridge,
  type TemplateEditor,
} from './skill-template-model'
import type { SkillChipRef } from './skill-picker-model'

/** How long a handed-over request may wait to start before the preview's card shows anyway */
const UNSTARTED_RUN_MS = 5000

/** Told to the model when the person chose to run a template skill in the open document */
export const SKILL_HERE_NOTE =
  '\n\nThe person chose to do this in the document that is open now: apply the skill to ' +
  'this document. The skill’s template document is not opened.'

/** Told to the model in a template copy's tab that took the asking document along */
export const SKILL_ATTACHED_NOTE =
  '\n\nThe person’s earlier document is attached. This document is a copy of the skill’s ' +
  'template: fill it with the content of the attached document.'

/** One line the template flow leaves in a panel's chat */
export type SkillTemplateNote =
  | {
      kind: 'taken'
      key: string
      tabId: string
      /** several chips had a template: whose template is used */
      firstOf?: string | undefined
      /** the asking document was to go along, but the template's editor takes no attachments */
      notAttached?: boolean | undefined
    }
  | { kind: 'missing'; key: string; title: string }
  | { kind: 'failed'; key: string }
  | { kind: 'not-sent'; key: string }
  | { kind: 'attach-failed'; key: string }
  | {
      kind: 'offer'
      key: string
      skill: SkillChipRef
      /** the person's request of the turn the model used the skill in */
      request: string
      opening?: boolean | undefined
      /** the document has content but is not saved: it cannot go along yet */
      needsSave?: boolean | undefined
    }
  | {
      /**
       * A template skill was called in a document with content: run it here,
       * or open the template's copy with this document attached.
       */
      kind: 'choose'
      key: string
      /** the chip whose template would open */
      skill: SkillChipRef
      /** every chip the request carried */
      chips: SkillChipRef[]
      request: string
      firstOf?: string | undefined
      busy?: boolean | undefined
      /** the document is not saved: it cannot go along yet */
      needsSave?: boolean | undefined
    }
  | { kind: 'card'; key: string; cardKey: string }

export interface SkillTemplatesOptions {
  lang: Lang
  /** this panel's editor; null for a panel with no document (the home ask panel) */
  editor: TemplateEditor | null
  /** the panel's skill cards: a template preview's card opens there */
  cards?: Pick<SkillProposals, 'addPreview' | 'render'> | undefined
  /**
   * The panel's send for a handed-over request (and for a template skill run
   * in this document), through its normal send gate; false (or nothing) when
   * nothing started. It takes the composer's attachments as a send does.
   */
  send?: ((text: string, use: SkillUse) => boolean | void) | undefined
  /**
   * The document open now has content (business-rules "양식 쓰기"): a template
   * skill called here asks whether to run in this document or in the
   * template's copy. Absent or false: the copy opens right away, as before.
   */
  hasContent?: (() => boolean | Promise<boolean>) | undefined
  /**
   * Put files into the composer as the panel's own attachments (a hand-off
   * that brought the asking document along, read through the panel's usual
   * attachment route); true when all of them went in. Absent in panels
   * without attachments.
   */
  attach?: ((paths: string[]) => Promise<boolean>) | undefined
  /** a run is going in this panel */
  busy?: boolean | undefined
  /** the panel can send now (its document is open); true when absent */
  ready?: boolean | undefined
  /** a request was handed over: bring the panel into view */
  onTaken?: (() => void) | undefined
  /**
   * The handed-over request is about to go through `send` (spec 6): the panel
   * may save the copy into its project once that run ends well. `preview` is
   * true for a template preview's clearing request, which is never saved there.
   */
  onHandedRun?: ((info: { preview: boolean }) => void) | undefined
  /** put text into the composer (a handed-over request that did not start; '' clears it) */
  setComposer?: ((text: string) => void) | undefined
  /** tests inject one; the default is the window's `aiOfficeUserSkills` */
  bridge?: SkillTemplateBridge | null | undefined
}

export interface SkillTemplates {
  /** pass to useComposerSkills: a chip with a template runs in a new tab (spec 5.7) */
  onTemplateSkill: OnTemplateSkill
  /** pass to panelUserSkills: a skill the model used on its own offers its template */
  onUsed: (skill: UserSkillText) => void
  /** the person's request that just went out (the offer opens the template with it) */
  noteRequest: (text: string) => void
  /** the lines, buttons and the preview card, placed after the chat's messages */
  notes: React.ReactNode
  /** a new conversation: the lines go */
  reset: () => void
  /** what the panel shows now (tests) */
  current: readonly SkillTemplateNote[]
}

/**
 * The MCP servers usable in this window now (user MCP spec 8), for a request
 * handed to a tab that just opened: its server list may not have been read
 * yet, so it is read first. Empty without an MCP bridge.
 */
async function windowMcpUsableNow(): Promise<ReadonlySet<string>> {
  const mcp = windowMcpState()
  if (!mcp) return new Set()
  if (mcp.servers().length === 0) await mcp.refresh()
  return mcp.usableServers()
}

/**
 * The template flow of one AI panel (spec 5.6, 5.7):
 *
 * - a chip whose skill has a template opens the template's copy as a new
 *   document in its editor's tab, hands the request and the chips over, and
 *   leaves "Working with the template in a new tab [Go to the tab]" here;
 *   in a document that has content it first asks: [Do it in this document]
 *   runs the request here, [New document from the template] opens the copy
 *   with this (saved) document handed over as its attachment;
 * - a template skill the model used on its own offers
 *   [Open a new document from this template] with that turn's request;
 * - a tab opened for a hand-off takes it once and sends it through the
 *   panel's own send (the send gate runs as for any send); a template
 *   preview's card opens once that run ends.
 *
 * Nothing here starts a run by itself except the handed-over request in the
 * tab it was handed to, and nothing is written to the skills folder.
 */
export function useSkillTemplates(options: SkillTemplatesOptions): SkillTemplates {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const bridge = options.bridge !== undefined ? options.bridge : skillTemplateBridge()
  const bridgeRef = useRef(bridge)
  bridgeRef.current = bridge
  const [notes, setNotes] = useState<SkillTemplateNote[]>([])
  const seqRef = useRef(0)
  const nextKey = () => `tpl-${++seqRef.current}`
  const lastRequestRef = useRef('')
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])

  const push = useCallback((note: SkillTemplateNote) => {
    setNotes((prev) => [...prev, note])
  }, [])

  /** the panel says its document has content (never for a panel with no document) */
  const documentHasContent = useCallback(async (): Promise<boolean> => {
    const hasContent = optionsRef.current.hasContent
    if (optionsRef.current.editor === null || !hasContent) return false
    try {
      return (await hasContent()) === true
    } catch {
      return false
    }
  }, [])

  const onTemplateSkill: OnTemplateSkill = useCallback(
    async (request) => {
      const b = bridgeRef.current
      if (!b) return false
      const choice = templateChoice(request)
      if (choice.skill.template && (await documentHasContent())) {
        if (!liveRef.current) return 'stop'
        optionsRef.current.setComposer?.('')
        push({
          kind: 'choose',
          key: nextKey(),
          skill: chipRefOf(choice.skill),
          chips: request.chips.map(chipRefOf),
          request: request.text,
          ...(choice.several ? { firstOf: choice.skill.title } : {}),
        })
        return true
      }
      const opened = templateOpenResultOf(
        await b
          .openTemplate({
            skillId: choice.skill.id,
            text: request.text,
            chips: request.chips.map(chipRefOf),
          })
          .catch(() => null),
      )
      if (!liveRef.current) return opened.ok
      if (opened.ok) {
        optionsRef.current.setComposer?.('')
        push({
          kind: 'taken',
          key: nextKey(),
          tabId: opened.tabId,
          ...(choice.several ? { firstOf: choice.skill.title } : {}),
        })
        return true
      }
      // spec 5.7: a template file that is gone sends nothing and says so
      if (isTemplateMissing(opened.reason)) {
        push({ kind: 'missing', key: nextKey(), title: choice.skill.title })
      } else {
        push({ kind: 'failed', key: nextKey() })
      }
      return 'stop'
    },
    [push, documentHasContent],
  )

  const onUsed = useCallback((skill: UserSkillText) => {
    if (!skill.template) return
    const request = lastRequestRef.current
    setNotes((prev) =>
      prev.some((n) => n.kind === 'offer' && n.skill.id === skill.id && n.request === request)
        ? prev
        : [...prev, { kind: 'offer', key: nextKey(), skill: chipRefForSkill(skill), request }],
    )
  }, [])

  const noteRequest = useCallback((text: string) => {
    lastRequestRef.current = text
  }, [])

  /**
   * [Open a new document from this template]: with `attach` undefined the
   * document goes along when it has content; `false` is "open without
   * attaching" after a save was asked for.
   */
  const openOffer = async (key: string, attach?: boolean) => {
    const b = bridgeRef.current
    const offer = notes.find((n) => n.key === key)
    if (!b || !offer || offer.kind !== 'offer' || offer.opening) return
    setNotes((prev) => prev.map((n) => (n.key === key ? { ...offer, opening: true } : n)))
    const withCurrent = attach ?? (await documentHasContent())
    const opened = templateOpenResultOf(
      await b
        .openTemplate({
          skillId: offer.skill.id,
          text: offer.request,
          chips: [offer.skill],
          ...(withCurrent ? { withCurrent: true } : {}),
        })
        .catch(() => null),
    )
    if (!liveRef.current) return
    const replacement: SkillTemplateNote = opened.ok
      ? {
          kind: 'taken',
          key,
          tabId: opened.tabId,
          ...(withCurrent && !opened.attached ? { notAttached: true } : {}),
        }
      : isTemplateMissing(opened.reason)
        ? { kind: 'missing', key, title: offer.skill.title }
        : {
            ...offer,
            opening: false,
            ...(isUnsavedCurrent(opened.reason) ? { needsSave: true } : {}),
          }
    setNotes((prev) => prev.map((n) => (n.key === key ? replacement : n)))
    if (!opened.ok && !isTemplateMissing(opened.reason) && !isUnsavedCurrent(opened.reason)) {
      push({ kind: 'failed', key: nextKey() })
    }
  }

  const updateChoose = (key: string, patch: { busy?: boolean; needsSave?: boolean }) =>
    setNotes((prev) =>
      prev.map((n) => (n.key === key && n.kind === 'choose' ? { ...n, ...patch } : n)),
    )

  /** [Do it in this document]: the request runs here with the chips' skills */
  const chooseHere = async (key: string) => {
    const b = bridgeRef.current
    const note = notes.find((n) => n.key === key)
    if (!b || !note || note.kind !== 'choose' || note.busy) return
    updateChoose(key, { busy: true })
    const { skills, missing } = await readSkillsForRequest(
      b,
      note.chips.map((c) => c.id),
    )
    const usable = await windowMcpUsableNow()
    const built = buildSkillRequest(skills, undefined, {
      mcpServerUsable: (name) => usable.has(name),
    })
    if (!liveRef.current) return
    if (missing.length > 0 || !built.ok) {
      // spec 9.1: nothing is sent without a chosen skill
      setNotes((prev) => prev.filter((n) => n.key !== key))
      optionsRef.current.setComposer?.(note.request)
      push({ kind: 'not-sent', key: nextKey() })
      return
    }
    lastRequestRef.current = note.request
    const started = optionsRef.current.send?.(note.request, {
      text: built.text + SKILL_HERE_NOTE,
      chips: note.chips,
    })
    if (started === false) {
      // the gate held or refused it: the choice stays to press again
      updateChoose(key, { busy: false })
      return
    }
    setNotes((prev) => prev.filter((n) => n.key !== key))
  }

  /** [New document from the template]: with this document attached, or (after a save was asked) without */
  const chooseNew = async (key: string, withCurrent: boolean) => {
    const b = bridgeRef.current
    const note = notes.find((n) => n.key === key)
    if (!b || !note || note.kind !== 'choose' || note.busy) return
    updateChoose(key, { busy: true })
    const opened = templateOpenResultOf(
      await b
        .openTemplate({
          skillId: note.skill.id,
          text: note.request,
          chips: note.chips,
          ...(withCurrent ? { withCurrent: true } : {}),
        })
        .catch(() => null),
    )
    if (!liveRef.current) return
    if (opened.ok) {
      const taken: SkillTemplateNote = {
        kind: 'taken',
        key,
        tabId: opened.tabId,
        ...(note.firstOf ? { firstOf: note.firstOf } : {}),
        ...(withCurrent && !opened.attached ? { notAttached: true } : {}),
      }
      setNotes((prev) => prev.map((n) => (n.key === key ? taken : n)))
      return
    }
    if (isUnsavedCurrent(opened.reason)) {
      updateChoose(key, { busy: false, needsSave: true })
      return
    }
    if (isTemplateMissing(opened.reason)) {
      const gone: SkillTemplateNote = { kind: 'missing', key, title: note.skill.title }
      setNotes((prev) => prev.map((n) => (n.key === key ? gone : n)))
      return
    }
    updateChoose(key, { busy: false })
    push({ kind: 'failed', key: nextKey() })
  }

  // ---- the hand-off this tab was opened for ----

  const takenRef = useRef(false)
  const [handed, setHanded] = useState<HandedRequest | null>(null)
  /** the run of the handed-over request: sent, seen running, or done */
  const [runPhase, setRunPhase] = useState<'idle' | 'sent' | 'running' | 'done'>('idle')

  /** a handed-over request waiting for the render that shows its attachment */
  const [deferred, setDeferred] = useState<{ text: string; use: SkillUse } | null>(null)

  /** the handed-over request through the panel's own send (and its gate) */
  const sendHanded = (text: string, use: SkillUse, preview: boolean) => {
    lastRequestRef.current = text
    optionsRef.current.onHandedRun?.({ preview })
    const started = optionsRef.current.send?.(text, use)
    if (started === false) {
      // the gate held or refused it: the request waits in the composer
      optionsRef.current.setComposer?.(text)
      setRunPhase('done')
    } else {
      setRunPhase('sent')
    }
  }
  const ready = options.ready !== false

  useEffect(() => {
    const editor = optionsRef.current.editor
    const b = bridgeRef.current
    if (!ready || takenRef.current || !editor || !b) return
    takenRef.current = true
    void (async () => {
      const taken = handedRequestOf(await b.takeHandoff(editor).catch(() => null), editor)
      if (!taken || !liveRef.current) return
      optionsRef.current.onTaken?.()
      setHanded(taken)
      let use: SkillUse = { text: '', chips: [] }
      if (taken.chips.length > 0) {
        const { skills, missing } = await readSkillsForRequest(
          b,
          taken.chips.map((c) => c.id),
        )
        const usable = await windowMcpUsableNow()
        const built = buildSkillRequest(skills, undefined, {
          mcpServerUsable: (name) => usable.has(name),
        })
        if (!liveRef.current) return
        if (missing.length > 0 || !built.ok) {
          // spec 9.1: nothing is sent without a chosen skill
          optionsRef.current.setComposer?.(taken.text)
          push({ kind: 'not-sent', key: nextKey() })
          setRunPhase('done')
          return
        }
        use = { text: built.text, chips: taken.chips.map(chipRefOf) }
      }
      if (taken.attach && taken.attach.length > 0 && optionsRef.current.attach) {
        const added = await optionsRef.current.attach(taken.attach).catch(() => false)
        if (!liveRef.current) return
        if (!added) {
          // the request is about that document: it does not go without it
          optionsRef.current.setComposer?.(taken.text)
          push({ kind: 'attach-failed', key: nextKey() })
          setRunPhase('done')
          return
        }
        // the attachment is in the composer now: send once the panel has
        // rendered it, so the run takes it like one the person added
        setDeferred({ text: taken.text, use: { ...use, text: use.text + SKILL_ATTACHED_NOTE } })
        return
      }
      sendHanded(taken.text, use, taken.preview !== undefined)
    })()
  }, [ready, push])

  useEffect(() => {
    if (!deferred) return
    setDeferred(null)
    sendHanded(deferred.text, deferred.use, false)
  }, [deferred])

  const busy = options.busy === true
  useEffect(() => {
    if (runPhase === 'sent' && busy) setRunPhase('running')
    else if (runPhase === 'running' && !busy) setRunPhase('done')
  }, [busy, runPhase])
  // a send that does not say whether it started (and never did: the gate held
  // it) must not keep the preview's card away for good
  useEffect(() => {
    if (runPhase !== 'sent') return
    const timer = setTimeout(
      () => setRunPhase((phase) => (phase === 'sent' ? 'done' : phase)),
      UNSTARTED_RUN_MS,
    )
    return () => clearTimeout(timer)
  }, [runPhase])

  // the preview's card opens once the clearing run has ended (spec 5.6 step 3)
  const previewShownRef = useRef(false)
  useEffect(() => {
    const preview = handed?.preview
    const cards = optionsRef.current.cards
    if (runPhase !== 'done' || !preview || !cards || previewShownRef.current) return
    previewShownRef.current = true
    const cardKey = cards.addPreview(preview)
    push({ kind: 'card', key: nextKey(), cardKey })
  }, [runPhase, handed, push])

  const reset = useCallback(() => {
    // the preview's card stays: it is what this tab was opened for
    setNotes((prev) => prev.filter((n) => n.kind === 'card'))
  }, [])

  const { lang } = options
  const t = (key: Parameters<typeof skillTemplateText>[1], params?: Record<string, string>) =>
    skillTemplateText(lang, key, params)
  const goTo = (tabId: string) => {
    void bridgeRef.current?.focusTab(tabId).catch(() => undefined)
  }

  const rendered =
    notes.length === 0 ? null : (
      <div className="ai-skill-template-notes">
        {notes.map((note) => {
          switch (note.kind) {
            case 'taken':
              return (
                <div key={note.key} className="ai-skill-card-line is-template" dir="auto">
                  <span className="ai-skill-card-line-text">
                    {t('takenOver')}
                    {note.firstOf ? ` · ${t('firstTemplateOnly', { title: note.firstOf })}` : ''}
                    {note.notAttached ? ` · ${t('notAttachedEditor')}` : ''}
                  </span>
                  {' · '}
                  <button
                    type="button"
                    className="ai-skill-card-link"
                    onClick={() => goTo(note.tabId)}
                  >
                    {t('goToTab')}
                  </button>
                </div>
              )
            case 'missing':
              return (
                <div key={note.key} className="ai-skill-card-line is-error" role="alert" dir="auto">
                  {t('templateMissing', { title: note.title })}
                </div>
              )
            case 'failed':
              return (
                <div key={note.key} className="ai-skill-card-line is-error" role="alert">
                  {t('openFailed')}
                </div>
              )
            case 'not-sent':
              return (
                <div key={note.key} className="ai-skill-card-line is-error" role="alert">
                  {t('handoffNotSent')}
                </div>
              )
            case 'attach-failed':
              return (
                <div key={note.key} className="ai-skill-card-line is-error" role="alert">
                  {t('attachFailed')}
                </div>
              )
            case 'choose':
              return (
                <div key={note.key} className="ai-skill-card-line is-template" dir="auto">
                  <span className="ai-skill-card-line-text">
                    {note.skill.title} · {note.needsSave ? t('needsSave') : t('chooseWhere')}
                    {note.firstOf ? ` · ${t('firstTemplateOnly', { title: note.firstOf })}` : ''}
                  </span>
                  {' · '}
                  <button
                    type="button"
                    className="ai-skill-card-link"
                    disabled={note.busy === true}
                    onClick={() => void chooseHere(note.key)}
                  >
                    {t('runHere')}
                  </button>
                  {' · '}
                  <button
                    type="button"
                    className="ai-skill-card-link"
                    disabled={note.busy === true}
                    onClick={() => void chooseNew(note.key, true)}
                  >
                    {t('openNewWithCurrent')}
                  </button>
                  {note.needsSave ? (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="ai-skill-card-link"
                        disabled={note.busy === true}
                        onClick={() => void chooseNew(note.key, false)}
                      >
                        {t('openWithoutAttach')}
                      </button>
                    </>
                  ) : null}
                </div>
              )
            case 'offer':
              return (
                <div key={note.key} className="ai-skill-card-line is-template" dir="auto">
                  <span className="ai-skill-card-line-text">
                    {note.skill.title}
                    {note.needsSave ? ` · ${t('needsSave')}` : ''}
                  </span>
                  {' · '}
                  <button
                    type="button"
                    className="ai-skill-card-link"
                    disabled={note.opening === true}
                    onClick={() => void openOffer(note.key)}
                  >
                    {t('openWithTemplate')}
                  </button>
                  {note.needsSave ? (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="ai-skill-card-link"
                        disabled={note.opening === true}
                        onClick={() => void openOffer(note.key, false)}
                      >
                        {t('openWithoutAttach')}
                      </button>
                    </>
                  ) : null}
                </div>
              )
            case 'card':
              return (
                <React.Fragment key={note.key}>
                  {optionsRef.current.cards?.render(note.cardKey)}
                </React.Fragment>
              )
            default:
              return null
          }
        })}
      </div>
    )

  return {
    onTemplateSkill,
    onUsed,
    noteRequest,
    notes: rendered,
    reset,
    current: notes,
  }
}
