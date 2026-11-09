/**
 * Growth tracking for the GitHub deployment repository. One JSON snapshot per
 * day, appended to a tracked history file, so downloads and repository signals
 * can be compared over time without any in-app telemetry (PRIVACY.md).
 *
 * Pure record/merge/report logic lives here so tests can drive it without
 * network access; tools/track-growth.mjs adds the GitHub fetch and the file
 * append around it.
 */
export const GROWTH_REPO = 'pblsketch/ieumoffice'
export const GROWTH_HISTORY_FILE = 'docs/tracking/growth-history.json'
export const GROWTH_LATEST_FILE = 'docs/tracking/growth-latest.json'

/** Installer downloads count as downloads; electron-builder support files
 * (.blockmap) are ignored, and the auto-update manifests (*.yml) are the
 * installed apps' update checks, kept out of the download totals. */
const INSTALLER_RE = /\.(exe|dmg|zip|AppImage|deb|rpm)$/i
const LINUX_INSTALLER_RE = /\.(AppImage|deb|rpm)$/i
const UPDATE_MANIFEST_RE = /\.yml$/

function sumDownloads(releases) {
  let installers = 0
  let updateChecks = 0
  const perAsset = []
  for (const release of releases) {
    for (const asset of release.assets ?? []) {
      if (!INSTALLER_RE.test(asset.name) && !UPDATE_MANIFEST_RE.test(asset.name)) continue
      perAsset.push({
        release: release.tag_name,
        asset: asset.name,
        downloads: asset.download_count,
      })
      if (INSTALLER_RE.test(asset.name)) installers += asset.download_count
      else updateChecks += asset.download_count
    }
  }
  return { installers, updateChecks, perAsset }
}

/** Shape one GitHub API response (array of releases) into a snapshot record. */
export function buildSnapshot({ releases, stars, forks, date }) {
  if (!Array.isArray(releases)) {
    throw new Error('GitHub API returned a non-array payload: ' + JSON.stringify(releases))
  }
  const { installers, updateChecks, perAsset } = sumDownloads(releases)
  return {
    date,
    totalDownloads: installers,
    installs: {
      windows: perAsset
        .filter((a) => a.asset.endsWith('.exe'))
        .reduce((n, a) => n + a.downloads, 0),
      // dmg plus the zip alternate package
      macos: perAsset
        .filter((a) => a.asset.endsWith('.dmg') || a.asset.endsWith('.zip'))
        .reduce((n, a) => n + a.downloads, 0),
      linux: perAsset
        .filter((a) => LINUX_INSTALLER_RE.test(a.asset))
        .reduce((n, a) => n + a.downloads, 0),
    },
    updateChecks,
    releaseCount: releases.length,
    stars,
    forks,
    releases: releases.map((r) => ({
      tag: r.tag_name,
      publishedAt: r.published_at ?? '',
      downloads: (r.assets ?? [])
        .filter((a) => INSTALLER_RE.test(a.name))
        .reduce((n, a) => n + a.download_count, 0),
    })),
    perAsset,
  }
}

/** Flat shape the README badge reads from growth-latest.json. */
export function buildSummary(snapshot) {
  return {
    date: snapshot.date,
    totalDownloads: snapshot.totalDownloads,
    windowsInstalls: snapshot.installs.windows,
    macosInstalls: snapshot.installs.macos,
    linuxInstalls: snapshot.installs.linux ?? 0,
    updateChecks: snapshot.updateChecks,
    stars: snapshot.stars,
    forks: snapshot.forks,
  }
}

/**
 * Append today's snapshot to the history. An entry for the same date is
 * replaced (re-runs after failures), every other day is kept verbatim so the
 * timeline never loses a day to a later fetch.
 */
export function mergeSnapshot(history, snapshot) {
  const withoutDate = history.filter((entry) => entry.date !== snapshot.date)
  return [...withoutDate, snapshot].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function pctChange(previous, current) {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

function deltaLine(label, previous, current) {
  const diff = current - previous
  const pct = pctChange(previous, current)
  const pctText = pct === null ? '' : ` (${pct > 0 ? '+' : ''}${pct}%)`
  return `${label}: ${current} (${diff >= 0 ? '+' : ''}${diff}${pctText})`
}

/**
 * Human-readable digest: the latest snapshot, the change since the previous
 * recorded day, and the 7-day install trend used for the weekly check-in.
 */
export function renderReport(history) {
  if (history.length === 0) {
    return 'No growth snapshots recorded yet.'
  }
  const latest = history[history.length - 1]
  const previous = history.length > 1 ? history[history.length - 2] : undefined
  const lines = []
  lines.push(`Growth report — ${latest.date} (repo ${GROWTH_REPO})`)
  lines.push('')
  if (previous) {
    lines.push('Since previous day:')
    lines.push(`  ${deltaLine('total downloads', previous.totalDownloads, latest.totalDownloads)}`)
    lines.push(
      `  ${deltaLine('windows installs', previous.installs.windows, latest.installs.windows)}`,
    )
    lines.push(`  ${deltaLine('macOS installs', previous.installs.macos, latest.installs.macos)}`)
    lines.push(
      `  ${deltaLine('linux installs', previous.installs.linux ?? 0, latest.installs.linux ?? 0)}`,
    )
    lines.push(`  ${deltaLine('update checks', previous.updateChecks, latest.updateChecks)}`)
    lines.push(`  ${deltaLine('stars', previous.stars, latest.stars)}`)
    lines.push(`  ${deltaLine('forks', previous.forks, latest.forks)}`)
  } else {
    lines.push('First recorded day — no previous day to compare.')
  }
  const weekAgo = history[history.length - 8]
  if (weekAgo && weekAgo.date !== latest.date) {
    const days = Math.max(
      1,
      Math.round((Date.parse(latest.date) - Date.parse(weekAgo.date)) / 86400000),
    )
    const gained = latest.installs.windows - weekAgo.installs.windows
    lines.push('')
    lines.push(
      `Windows installs over the last ${days} days: +${gained} ` +
        `(${(gained / days).toFixed(1)}/day)`,
    )
  }
  lines.push('')
  lines.push('Releases:')
  for (const release of latest.releases) {
    lines.push(`  ${release.tag} (${release.publishedAt.slice(0, 10)}): ${release.downloads}`)
  }
  lines.push('')
  lines.push('History length: ' + history.length + ' day(s)')
  return lines.join('\n')
}
