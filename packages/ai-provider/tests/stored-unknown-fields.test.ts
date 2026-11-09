/**
 * A save puts back what the settings file holds that this build does not know,
 * and nothing else: a field this build knows and the new settings leave out
 * stays out, so clearing a value still clears it.
 */
import { describe, expect, it } from 'vitest'
import { withStoredUnknownFields } from '../src/providers'
import type { AiSettings } from '../src/types'

const next = (): AiSettings =>
  ({
    provider: 'auto',
    providers: { openai: { apiKey: 'k', model: 'm' } },
  }) as unknown as AiSettings

describe('withStoredUnknownFields', () => {
  it('puts back unknown fields at the top and in a provider config', () => {
    const stored = {
      futureTop: { mode: 'x' },
      providers: { openai: { apiKey: 'sealed:v1:b2xk', futureField: 'kept' } },
    }
    const saved = withStoredUnknownFields(next(), stored) as AiSettings & Record<string, unknown>
    expect(saved.futureTop).toEqual({ mode: 'x' })
    expect(saved.providers.openai).toEqual({ apiKey: 'k', model: 'm', futureField: 'kept' })
  })

  it('does not bring back a known field the new settings leave out', () => {
    const stored = {
      internetTools: false,
      maxOutputTokens: 4096,
      customEndpoints: [{ id: 'a' }],
      providers: { openai: { apiKey: 'old', model: 'old', baseUrl: 'https://x', effort: 'high' } },
    }
    expect(withStoredUnknownFields(next(), stored)).toEqual(next())
  })

  it('drops the pre-provider key fields and configs under an unknown provider id', () => {
    const stored = {
      apiKey: 'sk-plain-legacy',
      baseUrl: 'https://legacy',
      model: 'legacy',
      providers: { 'vendor-from-the-future': { apiKey: 'k' } },
    }
    expect(withStoredUnknownFields(next(), stored)).toEqual(next())
  })

  it('keeps what the new settings carry over the file', () => {
    const withValue = { ...next(), futureTop: 'new' } as AiSettings & Record<string, unknown>
    const saved = withStoredUnknownFields(withValue, { futureTop: 'old' })
    expect(saved.futureTop).toBe('new')
  })
})
