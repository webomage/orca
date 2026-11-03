import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compareAppVersions } from '../../../shared/app-version'
import {
  getMainReleaseRepo,
  getReleaseNotesUrlForVersion,
  getReleaseRepoForChannel,
  getVersionChannel,
  isOverlayVersion
} from '../../../shared/release-channel'
import { installNetRequestFetchAdapter } from '../testing/updater-net-request.fixture'

const ORIGINAL_PLATFORM = process.platform
const ORIGINAL_ARCH = process.arch
const ORIGINAL_RELEASE_REPO = process.env.ORCA_RELEASE_REPO

const { netFetchMock, netRequestMock } = vi.hoisted(() => ({
  netFetchMock: vi.fn(),
  netRequestMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock, request: netRequestMock }
}))

function buildAtomFeed(repo: string, tags: string[]): string {
  const entries = tags
    .map(
      (tag) =>
        `<entry><link rel="alternate" type="text/html" href="https://github.com/${repo}/releases/tag/${tag}"/><updated>2026-11-03T12:00:00Z</updated><title>${tag}</title></entry>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><feed>${entries}</feed>`
}

function buildLinuxManifest(tag: string): string {
  const version = tag.replace(/^v/i, '')
  return [
    `version: ${version}`,
    'files:',
    '  - url: orca-linux.AppImage',
    '    sha512: test',
    'path: orca-linux.AppImage'
  ].join('\n')
}

describe('w0m overlay release feed and SemVer progression', () => {
  beforeEach(() => {
    netFetchMock.mockReset()
    netRequestMock.mockReset()
    installNetRequestFetchAdapter(netRequestMock, netFetchMock)
    Object.defineProperty(process, 'platform', { value: 'linux' })
    Object.defineProperty(process, 'arch', { value: 'x64' })
    delete process.env.ORCA_RELEASE_REPO
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM })
    Object.defineProperty(process, 'arch', { value: ORIGINAL_ARCH })
    if (ORIGINAL_RELEASE_REPO === undefined) {
      delete process.env.ORCA_RELEASE_REPO
    } else {
      process.env.ORCA_RELEASE_REPO = ORIGINAL_RELEASE_REPO
    }
  })

  it('resolves ORCA_RELEASE_REPO override while rejecting malformed slugs', () => {
    expect(getMainReleaseRepo()).toBe('stablyai/orca')
    process.env.ORCA_RELEASE_REPO = 'webomage/orca'
    expect(getMainReleaseRepo()).toBe('webomage/orca')
    expect(getReleaseRepoForChannel('stable')).toBe('webomage/orca')
    expect(getReleaseRepoForChannel('rc')).toBe('webomage/orca')
    expect(getReleaseRepoForChannel('hourly')).toBe('stablyai/orca-hourly')

    process.env.ORCA_RELEASE_REPO = '../bad/slug'
    expect(getMainReleaseRepo()).toBe('stablyai/orca')
  })

  it('classifies -w0m.N versions on the stable channel and maintains monotonic SemVer transitions', () => {
    process.env.ORCA_RELEASE_REPO = 'webomage/orca'
    expect(isOverlayVersion('1.4.248-w0m.1')).toBe(true)
    expect(isOverlayVersion('v1.4.248-w0m.12')).toBe(true)
    expect(isOverlayVersion('1.4.248-rc.1')).toBe(false)
    expect(getVersionChannel('1.4.248-w0m.1')).toBe('stable')
    expect(getReleaseNotesUrlForVersion('1.4.248-w0m.1')).toBe(
      'https://github.com/webomage/orca/releases/tag/v1.4.248-w0m.1'
    )

    // Stock -> overlay -> overlay rebuild -> stock next patch -> next overlay
    expect(compareAppVersions('1.4.248-w0m.1', '1.4.247')).toBeGreaterThan(0)
    expect(compareAppVersions('1.4.248-w0m.2', '1.4.248-w0m.1')).toBeGreaterThan(0)
    expect(compareAppVersions('1.4.248', '1.4.248-w0m.2')).toBeGreaterThan(0)
    expect(compareAppVersions('1.4.249-w0m.1', '1.4.248-w0m.2')).toBeGreaterThan(0)
  })

  it('discovers -w0m.N overlay builds on stable checks without opting into -rc.N tags', async () => {
    process.env.ORCA_RELEASE_REPO = 'webomage/orca'
    const tags = ['v1.4.249-rc.1', 'v1.4.248-w0m.2', 'v1.4.248-w0m.1']
    netFetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === 'https://github.com/webomage/orca/releases.atom') {
        return new Response(buildAtomFeed('webomage/orca', tags), { status: 200 })
      }
      const manifestMatch = url.match(
        /^https:\/\/github\.com\/webomage\/orca\/releases\/download\/([^/]+)\/latest-linux\.yml$/
      )
      if (manifestMatch) {
        return new Response(buildLinuxManifest(decodeURIComponent(manifestMatch[1])), {
          status: 200
        })
      }
      if (
        url.startsWith('https://github.com/webomage/orca/releases/download/') &&
        init?.method === 'HEAD'
      ) {
        return new Response(null, { status: 200 })
      }
      return new Response(null, { status: 404 })
    })

    const { fetchNewerReleaseTagsWithReadiness } = await import('./updater-prerelease-feed')
    const fromStock = await fetchNewerReleaseTagsWithReadiness('1.4.247', 1, {
      includePrerelease: false
    })
    expect(fromStock).toEqual({ tags: ['v1.4.248-w0m.2'], state: 'ready' })

    const upToDate = await fetchNewerReleaseTagsWithReadiness('1.4.248-w0m.2', 1, {
      includePrerelease: false
    })
    expect(upToDate).toEqual({ tags: [], state: 'no-newer' })
  })

  it('resolves fetchLatestStableReleaseTag from webomage/orca /releases/latest for -w0m.N tags', async () => {
    process.env.ORCA_RELEASE_REPO = 'webomage/orca'
    netFetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://github.com/webomage/orca/releases/latest') {
        return new Response(null, {
          status: 302,
          headers: { location: '/webomage/orca/releases/tag/v1.4.248-w0m.1' }
        })
      }
      if (
        url ===
        'https://github.com/webomage/orca/releases/download/v1.4.248-w0m.1/latest-linux.yml'
      ) {
        return new Response(buildLinuxManifest('v1.4.248-w0m.1'), { status: 200 })
      }
      if (
        url ===
        'https://github.com/webomage/orca/releases/download/v1.4.248-w0m.1/orca-linux.AppImage'
      ) {
        return new Response(null, { status: 200 })
      }
      return new Response(null, { status: 404 })
    })

    const { fetchLatestStableReleaseTag } = await import('./updater-prerelease-feed')
    await expect(fetchLatestStableReleaseTag()).resolves.toBe('v1.4.248-w0m.1')
  })
})
