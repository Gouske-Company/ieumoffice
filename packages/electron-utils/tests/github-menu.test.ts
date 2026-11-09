import { describe, expect, it } from 'vitest'
import { PRODUCT_REPO_NAME, PRODUCT_REPO_OWNER } from '@genoffice/i18n'
import {
  GITHUB_ISSUES_URL,
  GITHUB_LATEST_RELEASE_URL,
  GITHUB_NEW_ISSUE_URL,
  GITHUB_RELEASES_URL,
  GITHUB_REPO_DISPLAY,
  GITHUB_REPO_NAME,
  GITHUB_REPO_OWNER,
  GITHUB_REPO_SLUG,
  GITHUB_REPO_URL,
  githubReleaseTagUrl,
} from '../src/github-menu'

describe('repository coordinates', () => {
  it("points at the product's own public repository", () => {
    expect(GITHUB_REPO_OWNER).toBe('pblsketch')
    expect(GITHUB_REPO_NAME).toBe('ieumoffice')
    expect(GITHUB_REPO_SLUG).toBe('pblsketch/ieumoffice')
    expect(GITHUB_REPO_URL).toBe('https://github.com/pblsketch/ieumoffice')
  })

  it('takes owner and repo from the one product definition', () => {
    expect(GITHUB_REPO_OWNER).toBe(PRODUCT_REPO_OWNER)
    expect(GITHUB_REPO_NAME).toBe(PRODUCT_REPO_NAME)
  })

  it('derives every link from the repository URL', () => {
    expect(GITHUB_REPO_DISPLAY).toBe('github.com/pblsketch/ieumoffice')
    expect(GITHUB_ISSUES_URL).toBe('https://github.com/pblsketch/ieumoffice/issues')
    expect(GITHUB_NEW_ISSUE_URL).toBe('https://github.com/pblsketch/ieumoffice/issues/new')
    expect(GITHUB_RELEASES_URL).toBe('https://github.com/pblsketch/ieumoffice/releases')
    expect(GITHUB_LATEST_RELEASE_URL).toBe(
      'https://github.com/pblsketch/ieumoffice/releases/latest',
    )
    for (const url of [
      GITHUB_ISSUES_URL,
      GITHUB_NEW_ISSUE_URL,
      GITHUB_RELEASES_URL,
      GITHUB_LATEST_RELEASE_URL,
    ]) {
      expect(url.startsWith(`${GITHUB_REPO_URL}/`), url).toBe(true)
    }
  })

  it('builds the page of one released version', () => {
    expect(githubReleaseTagUrl('1.2.3')).toBe(
      'https://github.com/pblsketch/ieumoffice/releases/tag/v1.2.3',
    )
    expect(githubReleaseTagUrl('v1.2.3')).toBe(
      'https://github.com/pblsketch/ieumoffice/releases/tag/v1.2.3',
    )
  })
})
