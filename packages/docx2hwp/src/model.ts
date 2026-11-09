/**
 * The document in Hangul terms, with every number already in engine units.
 * Lowering builds it from the docx-engine model without touching the engine;
 * the writer turns it into engine calls. Body, table cells and the header and
 * footer all hold the same paragraphs, so one writer serves every place.
 */
import type { HwpUnit, ParaUnit, Rgb } from './units'

export interface HwpPlan {
  readonly page: PageSetup
  readonly header: Story | null
  readonly footer: Story | null
  readonly body: Story
  /** numbering definitions that numbered paragraphs name by key */
  readonly numberings: ReadonlyMap<string, NumberingPlan>
}

/** the margins are Hangul's: the header band sits below the top margin */
export interface PageSetup {
  readonly width: HwpUnit
  readonly height: HwpUnit
  readonly landscape: boolean
  readonly marginTop: HwpUnit
  readonly marginBottom: HwpUnit
  readonly marginLeft: HwpUnit
  readonly marginRight: HwpUnit
  readonly marginHeader: HwpUnit
  readonly marginFooter: HwpUnit
  readonly marginGutter: HwpUnit
}

export type Story = readonly Block[]
export type Block = Para | Table

export interface Para {
  readonly kind: 'para'
  /** '바탕글', or the outline style '개요 N' for a Word heading */
  readonly style: { readonly kind: 'body' } | { readonly kind: 'outline'; readonly level: number }
  readonly shape: ParaShape
  readonly inlines: readonly Inline[]
}

export type Align = 'left' | 'center' | 'right' | 'justify' | 'distribute'

export interface ParaShape {
  readonly align: Align
  /** Hangul's left margin: with a hanging indent the first line starts here */
  readonly marginLeft: ParaUnit
  readonly marginRight: ParaUnit
  /** positive indents the first line, negative hangs the following lines */
  readonly indent: ParaUnit
  readonly before: ParaUnit
  readonly after: ParaUnit
  readonly line: LineSpacing
  readonly pageBreakBefore: boolean
  readonly keepWithNext: boolean
  readonly keepLines: boolean
  readonly widowOrphan: boolean
  readonly tabStops: readonly TabStop[]
  readonly list: ListRef | null
}

export type LineSpacing =
  | { readonly kind: 'percent'; readonly percent: number }
  | { readonly kind: 'fixed' | 'atLeast'; readonly value: ParaUnit }

export interface TabStop {
  readonly position: ParaUnit
  readonly align: 'left' | 'right' | 'center' | 'decimal'
  readonly leader: 'none' | 'solid' | 'dot' | 'dash'
}

export type ListRef =
  | { readonly kind: 'number'; readonly numbering: string; readonly level: number }
  | { readonly kind: 'bullet'; readonly char: string; readonly level: number }

/** one Hangul numbering: level texts use ^n for the counter of level n */
export interface NumberingPlan {
  readonly levelFormats: readonly string[]
  /** Hangul number shapes per level (0 = 1 2 3, 8 = 가 나 다, ...) */
  readonly numberFormats: readonly number[]
  readonly start: number
}

/**
 * Text holds '\t' for tabs and '\n' for line breaks inside the paragraph; a
 * Word page break inside a paragraph is its own item, never a character.
 */
export type Inline =
  | { readonly kind: 'text'; readonly text: string; readonly chars: CharShape }
  /** header and footer only */
  | { readonly kind: 'field'; readonly field: 'page' | 'pageCount'; readonly chars: CharShape }
  | { readonly kind: 'picture'; readonly picture: Picture }
  | {
      readonly kind: 'note'
      readonly note: 'footnote' | 'endnote'
      readonly paras: readonly string[]
    }
  | { readonly kind: 'pageBreak' }

export interface CharShape {
  /** for the Hangul, Hanja, Japanese and symbol slots */
  readonly eastAsiaFace: string
  /** for the Latin, other and user slots */
  readonly latinFace: string
  readonly size: HwpUnit
  readonly bold: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly strike: boolean
  readonly script: 'normal' | 'superscript' | 'subscript'
  readonly color: Rgb
  readonly shade: Rgb | null
  /** percent of the size, Hangul's 자간 */
  readonly spacing: number
  /** percent, Hangul's 장평 */
  readonly ratio: number
}

export interface Picture {
  readonly bytes: Uint8Array
  readonly ext: 'png' | 'jpg' | 'gif' | 'bmp'
  readonly width: HwpUnit
  readonly height: HwpUnit
  readonly widthPx: number
  readonly heightPx: number
}

export interface Table {
  readonly kind: 'table'
  readonly colWidths: readonly HwpUnit[]
  /** row heights; null = as tall as the content */
  readonly rowHeights: readonly (HwpUnit | null)[]
  /** covering cells only, in row order; merged-away grid places are absent */
  readonly cells: readonly Cell[]
  readonly repeatHeader: boolean
  /** a Hangul table placed like a character follows its paragraph's alignment */
  readonly align: 'left' | 'center' | 'right'
}

export interface Cell {
  readonly row: number
  readonly col: number
  readonly rowSpan: number
  readonly colSpan: number
  readonly fill: Rgb | null
  readonly borders: CellBorders
  readonly vAlign: 'top' | 'center' | 'bottom'
  readonly padding: {
    readonly top: HwpUnit
    readonly right: HwpUnit
    readonly bottom: HwpUnit
    readonly left: HwpUnit
  }
  /** paragraphs only: a nested table arrives flattened into them */
  readonly body: readonly Para[]
}

export interface CellBorders {
  readonly top: Border
  readonly right: Border
  readonly bottom: Border
  readonly left: Border
}

export interface Border {
  readonly style: 'none' | 'solid' | 'dashed' | 'dotted' | 'double'
  readonly widthPt: number
  readonly color: Rgb
}
