/**
 * The provider row of a document job's pre-start confirmation (translation,
 * AI page reading, AI highlights, long-document overview). The model chip
 * beside it lists only the providers that are connected now; this list also
 * names the subscriptions that are not, so a person can switch to Claude or
 * Codex from the confirmation and connect it there: the dialog's connect card
 * follows the stored choice.
 *
 * The choice is the user's and is saved in the settings ("AI to use"), like
 * the chip's; the route is still `selectAiProvider`'s answer for it. Changing
 * the provider keeps the model each provider was set to.
 */
import type { ReactElement } from 'react'
import {
  AI_SUBSCRIPTION_PROVIDERS,
  subscriptionConnection,
  type AiSettings,
  type AiSubscriptionStatuses,
} from '@genoffice/ai-provider/browser'
import type { Lang } from '@genoffice/i18n'
import {
  aiProviderPickerGroups,
  aiProviderPickerSelection,
  aiProviderDisplayName,
  aiSubscriptionText,
  changeStoredAiSettings,
  withAiProviderSelection,
  type AiModelPickerBridge,
  type AiProviderPickerSelection,
} from '@genoffice/ui'

export interface JobProviderOption {
  /** `auto`, a provider id, or `custom:<endpoint id>` */
  readonly value: string
  readonly label: string
  readonly selection: Omit<AiProviderPickerSelection, 'model'>
  /** a subscription whose program is not connected now */
  readonly notConnected: boolean
}

const optionValue = (s: { provider: string; endpoint?: string | undefined }): string =>
  s.provider === 'custom' && s.endpoint ? `custom:${s.endpoint}` : s.provider

/**
 * What the row offers: "automatic" (with what it runs on), both subscriptions
 * whether connected or not, then the key providers and servers that are filled
 * in. A stored choice that is none of these is listed too, so the row shows it.
 */
export function jobProviderOptions(
  settings: AiSettings,
  statuses: AiSubscriptionStatuses,
  lang: Lang,
  notConnected: (provider: string) => string,
): { options: JobProviderOption[]; value: string } {
  const groups = aiProviderPickerGroups(settings, statuses)
  const current = aiProviderPickerSelection(settings, statuses)
  const options: JobProviderOption[] = []
  const auto = groups.find((g) => g.kind === 'auto')
  options.push({
    value: 'auto',
    label: auto
      ? aiSubscriptionText(lang, 'pickerAutoUsing', { provider: auto.label })
      : aiSubscriptionText(lang, 'pickerAuto'),
    selection: { provider: 'auto' },
    notConnected: false,
  })
  for (const id of AI_SUBSCRIPTION_PROVIDERS) {
    const status = statuses[id]
    const connection = subscriptionConnection(settings, status)
    const name = aiProviderDisplayName(id)
    // while the program is being checked, its state is not known yet: no "not connected"
    const known = !!status && status.state !== 'checking'
    options.push({
      value: id,
      label:
        connection === 'metered'
          ? `${name} · ${aiSubscriptionText(lang, 'pickerPaid')}`
          : !connection && known
            ? notConnected(name)
            : name,
      selection: { provider: id },
      notConnected: !connection && known,
    })
  }
  for (const g of groups) {
    if (g.kind !== 'key') continue
    options.push({
      value: optionValue({ provider: g.id, endpoint: g.endpoint }),
      label: g.label,
      selection: { provider: g.id, endpoint: g.endpoint },
      notConnected: false,
    })
  }
  const value = optionValue(current)
  if (!options.some((o) => o.value === value)) {
    const name = aiProviderDisplayName(current.provider === 'auto' ? undefined : current.provider)
    options.push({
      value,
      label: notConnected(name),
      selection: { provider: current.provider, endpoint: current.endpoint },
      notConnected: true,
    })
  }
  return { options, value }
}

/** the stored settings with `selection` chosen, each provider keeping its own model */
export function withJobProvider(
  settings: AiSettings,
  selection: Omit<AiProviderPickerSelection, 'model'>,
): AiSettings {
  if (selection.provider === 'auto')
    return withAiProviderSelection(settings, { provider: 'auto', model: '' })
  const model =
    selection.provider === 'custom'
      ? (settings.customEndpoints?.find((e) => e.id === selection.endpoint)?.model ?? '')
      : (settings.providers?.[selection.provider]?.model ?? '')
  return withAiProviderSelection(settings, { ...selection, model })
}

export function JobProviderSelect({
  bridge,
  settings,
  statuses,
  lang,
  label,
  notConnected,
  onSaved,
}: {
  bridge: AiModelPickerBridge
  /** the dialog's copy of the stored settings */
  settings: AiSettings
  statuses: AiSubscriptionStatuses
  lang: Lang
  label: string
  notConnected: (provider: string) => string
  /** the settings as written, so the dialog's route follows at once */
  onSaved: (settings: AiSettings) => void
}): ReactElement {
  const { options, value } = jobProviderOptions(settings, statuses, lang, notConnected)
  const choose = (next: string) => {
    const option = options.find((o) => o.value === next)
    if (!option || next === value) return
    onSaved(withJobProvider(settings, option.selection))
    // written onto what is stored now, so a change another window saved since is kept
    void changeStoredAiSettings(
      bridge,
      (latest) => withJobProvider(latest, option.selection),
      settings,
    ).then((written) => {
      if (written) onSaved(written)
    })
  }
  return (
    <label className="pdf-job-provider" data-provider-select={value}>
      <span>{label}</span>
      <select
        className="pdf-modal-input"
        data-field="provider"
        value={value}
        onChange={(e) => choose(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} data-not-connected={o.notConnected || undefined}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
