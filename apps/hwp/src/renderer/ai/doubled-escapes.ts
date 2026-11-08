/**
 * Some models escape a line break twice in the arguments of a tool call (seen with
 * gemini-3.5-flash-lite): the decoded text then holds a backslash and an "n" where a
 * line break was meant, and the document would show `\n` as two characters.
 *
 * `undoDoubledEscapes` turns those escapes back into what they stand for, but only when
 * the whole text looks escaped twice:
 * - it holds no real line break (a model that sends one knows how to);
 * - it holds `\n` or `\r`;
 * - every backslash starts `\n`, `\r`, `\t` or `\"` (a backslash before anything else,
 *   or two in a row, means the text has real backslashes, as in `C:\Users\new`);
 * - it has no drive path such as `C:\new`.
 * Otherwise the text is returned as it came.
 *
 * A tab becomes a space: the editor refuses control characters in the text it writes.
 */
export function undoDoubledEscapes(text: string): string {
  if (/[\r\n]/.test(text) || !/\\[nr]/.test(text)) return text
  if (/\\(?![nrt"])/.test(text)) return text
  if (/(?:^|[^A-Za-z])[A-Za-z]:\\/.test(text)) return text
  return text.replace(/\\r\\n|\\[nrt"]/g, (escape) => {
    if (escape === '\\t') return ' '
    if (escape === '\\"') return '"'
    return '\n'
  })
}

/** Each string of a list through `undoDoubledEscapes`; anything else as it came. */
export function undoDoubledEscapesInList(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((item) => (typeof item === 'string' ? undoDoubledEscapes(item) : item))
}
