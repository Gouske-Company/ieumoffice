/**
 * The provider row of a document job's pre-start confirmation (translation,
 * AI page reading, AI highlights). The model chip beside it lists only the
 * providers that are connected now; this list also names the subscriptions
 * that are not, so a person can switch to Claude, ChatGPT or Codex from the
 * confirmation and connect it there: the dialog's connect card follows the
 * stored choice. A program turned off in this app (decision 0114) is listed
 * as off and cannot be picked here; Settings turns it back on.
 *
 * The choice is the user's and is saved in the settings ("AI to use"), like
 * the chip's; the route is still `selectAiProvider`'s answer for it. Key
 * providers are listed only once their key is filled in, and only picking one
 * selects it: "automatic" never runs on a key. Changing the provider keeps the
 * model each provider was set to.
 */
import type { ReactElement } from 'react'
import {
  AI_SUBSCRIPTION_PROVIDERS,
  subscriptionConnection,
  subscriptionOffIn,
  subscriptionStateOf,
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
  /** a program turned off in this app: shown, not offered */
  readonly off: boolean
}

const optionValue = (s: { provider: string; endpoint?: string | undefined }): string =>
  s.provider === 'custom' && s.endpoint ? `custom:${s.endpoint}` : s.provider

/**
 * What the row offers: "automatic" (with what it runs on), every subscription
 * whether connected or not (one turned off in this app marked so, and not
 * offered), then the key providers and servers that are filled in. A stored
 * choice that is none of these is listed too, so the row shows it.
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
    off: false,
  })
  for (const id of AI_SUBSCRIPTION_PROVIDERS) {
    const name = aiProviderDisplayName(id)
    if (subscriptionOffIn(settings, id)) {
      options.push({
        value: id,
        label: `${name} · ${aiSubscriptionText(lang, 'cardOff')}`,
        selection: { provider: id },
        notConnected: false,
        off: true,
      })
      continue
    }
    const connection = subscriptionConnection(settings, statuses[id])
    // while the program is being checked, its state is not known yet: no "not connected"
    const unknown = subscriptionStateOf(statuses, id) === 'checking'
    options.push({
      value: id,
      label:
        connection === 'metered'
          ? `${name} · ${aiSubscriptionText(lang, 'pickerPaid')}`
          : !connection && !unknown
            ? notConnected(name)
            : name,
      selection: { provider: id },
      notConnected: !connection && !unknown,
      off: false,
    })
  }
  for (const g of groups) {
    if (g.kind !== 'key') continue
    options.push({
      value: optionValue({ provider: g.id, endpoint: g.endpoint }),
      label: g.label,
      selection: { provider: g.id, endpoint: g.endpoint },
      notConnected: false,
      off: false,
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
      off: false,
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
    if (!option || option.off || next === value) return
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
          <option
            key={o.value}
            value={o.value}
            // the stored choice stays readable even when it is off; it is not offered otherwise
            disabled={o.off && o.value !== value}
            data-not-connected={o.notConnected || undefined}
            data-off={o.off || undefined}
          >
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
