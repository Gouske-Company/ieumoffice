import { fileURLToPath } from 'node:url'

/** this package's own fixtures */
export const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url))
/** the Word editor's pagination corpus, read in place */
export const CORPUS = fileURLToPath(
  new URL('../../../../apps/docs/tests/pagination-corpus/docx', import.meta.url),
)
