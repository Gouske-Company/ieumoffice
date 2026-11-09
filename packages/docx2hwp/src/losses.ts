/**
 * What the Hangul copy does not carry from the Word document, at the level a
 * person recognizes ("comments", "text boxes"), and whether each thing is gone
 * ('dropped') or there but different ('changed'). Declaration order is report
 * order. The ids are this package's own; odt-engine's report ids are a
 * separate published contract and are not shared.
 */
export const LOSS_FEATURES = {
  comment: 'dropped',
  revision: 'dropped',
  equation: 'dropped',
  chart: 'dropped',
  shape: 'dropped',
  textbox: 'dropped',
  object: 'dropped',
  ink: 'dropped',
  watermark: 'dropped',
  hidden_text: 'dropped',
  picture: 'dropped',
  note: 'dropped',
  page_border: 'dropped',
  para_border: 'dropped',
  line_numbers: 'dropped',
  hyperlink: 'changed',
  section: 'changed',
  columns: 'changed',
  header_variant: 'changed',
  header_content: 'changed',
  floating_picture: 'changed',
  nested_table: 'changed',
  table_layout: 'changed',
  numbering: 'changed',
  tab_stop: 'changed',
  toc: 'changed',
  field: 'changed',
  text_effect: 'changed',
  note_format: 'changed',
  text_direction: 'changed',
  plain_paragraph: 'changed',
} as const satisfies Record<string, LossKind>

export type LossKind = 'dropped' | 'changed'
export type LossFeature = keyof typeof LOSS_FEATURES

/** A feature's kind comes from the table: "comment changed" cannot be written. */
export type Loss = {
  [F in LossFeature]: {
    readonly feature: F
    readonly kind: (typeof LOSS_FEATURES)[F]
    readonly count: number
  }
}[LossFeature]

const ORDER = Object.keys(LOSS_FEATURES) as LossFeature[]

/**
 * The tally of one conversion. `where` names the object or paragraph the loss
 * is in, so three small-caps runs in one paragraph count once.
 */
export class LossLedger {
  private readonly seen = new Map<LossFeature, Set<string>>()

  note(feature: LossFeature, where: string): void {
    const places = this.seen.get(feature) ?? new Set<string>()
    places.add(where)
    this.seen.set(feature, places)
  }

  /** fixed table order, features never noted left out */
  list(): Loss[] {
    return ORDER.flatMap((feature) => {
      const count = this.seen.get(feature)?.size ?? 0
      return count > 0 ? [{ feature, kind: LOSS_FEATURES[feature], count } as Loss] : []
    })
  }
}
