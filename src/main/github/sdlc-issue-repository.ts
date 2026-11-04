import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { GitHubApiRepository } from './github-api-repository'
import { isValidGitHubApiRepository } from './github-api-repository-validation'
import { shouldSkipDirectory } from '../project-groups/nested-repo-scan-rules'

export type SdlcWorkspaceConfig = {
  vcsRepo: GitHubApiRepository | null
  canonicalRepoSubpath: string | null
  repoSubpaths: string[]
}

export function parseGitHubOwnerRepoSlug(raw: unknown): GitHubApiRepository | null {
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
  const parts = trimmed.split('/')
  if (parts.length !== 2) {
    return null
  }
  const candidate: GitHubApiRepository = {
    owner: parts[0]?.trim() ?? '',
    repo: parts[1]?.trim() ?? '',
    host: 'github.com'
  }
  return isValidGitHubApiRepository(candidate) ? candidate : null
}

function parseIssueRepositoryValue(raw: unknown): GitHubApiRepository | null {
  if (typeof raw === 'string') {
    return parseGitHubOwnerRepoSlug(raw)
  }
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const record = raw as { owner?: unknown; repo?: unknown; host?: unknown }
  if (typeof record.owner !== 'string' || typeof record.repo !== 'string') {
    return null
  }
  const candidate: GitHubApiRepository = {
    owner: record.owner.trim(),
    repo: record.repo.trim(),
    host: typeof record.host === 'string' && record.host.trim() ? record.host.trim() : 'github.com'
  }
  return isValidGitHubApiRepository(candidate) ? candidate : null
}

export async function readLocalIssueRepositoryOverride(
  repoPath: string
): Promise<GitHubApiRepository | null> {
  try {
    const raw = await readFile(join(repoPath, '.orca', 'project.json'), 'utf8')
    const parsed = JSON.parse(raw) as { issueRepository?: unknown }
    return parseIssueRepositoryValue(parsed?.issueRepository)
  } catch {
    return null
  }
}

const projectedIssueRepoCache = new Map<
  string,
  { expiresAt: number; value: GitHubApiRepository | null }
>()
const PROJECTED_ISSUE_REPO_CACHE_TTL_MS = 2_000

export function readProjectedLocalIssueRepositorySync(repoPath: string): GitHubApiRepository | null {
  const now = Date.now()
  const cached = projectedIssueRepoCache.get(repoPath)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }
  let resolved: GitHubApiRepository | null = null
  try {
    const rawOverride = readFileSync(join(repoPath, '.orca', 'project.json'), 'utf8')
    const parsedOverride = JSON.parse(rawOverride) as { issueRepository?: unknown }
    resolved = parseIssueRepositoryValue(parsedOverride?.issueRepository)
  } catch {
    resolved = null
  }
  if (!resolved) {
    try {
      const rawSdlc = readFileSync(join(repoPath, '.w0m', 'sdlc.json'), 'utf8')
      const parsedSdlc = JSON.parse(rawSdlc) as {
        vcs?: { provider?: unknown; repo?: unknown }
      }
      const provider =
        typeof parsedSdlc?.vcs?.provider === 'string'
          ? parsedSdlc.vcs.provider.trim().toLowerCase()
          : 'github'
      const vcsRepo = provider === 'github' ? parseGitHubOwnerRepoSlug(parsedSdlc?.vcs?.repo) : null
      if (vcsRepo) {
        let isWrapperOrigin = false
        try {
          const gitConfig = readFileSync(join(repoPath, '.git', 'config'), 'utf8')
          isWrapperOrigin = /-w0m(?:\.git)?\s*$/im.test(gitConfig)
        } catch {
          isWrapperOrigin = false
        }
        if (!isWrapperOrigin) {
          resolved = vcsRepo
        }
      }
    } catch {
      resolved = null
    }
  }
  projectedIssueRepoCache.set(repoPath, {
    expiresAt: now + PROJECTED_ISSUE_REPO_CACHE_TTL_MS,
    value: resolved
  })
  return resolved
}

export async function writeLocalIssueRepositoryOverride(
  repoPath: string,
  repository: { owner: string; repo: string; host?: string } | null
): Promise<void> {
  projectedIssueRepoCache.delete(repoPath)
  let rootStat: Awaited<ReturnType<typeof stat>>
  try {
    rootStat = await stat(repoPath)
  } catch {
    return
  }
  if (!rootStat.isDirectory()) {
    return
  }
  const orcaDir = join(repoPath, '.orca')
  const filePath = join(orcaDir, 'project.json')
  let existing: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = { ...(parsed as Record<string, unknown>) }
    }
  } catch {
    existing = {}
  }
  const normalized = repository ? parseIssueRepositoryValue(repository) : null
  if (normalized) {
    existing.issueRepository = normalized
    await mkdir(orcaDir, { recursive: true })
    await writeFile(filePath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')
    return
  }
  delete existing.issueRepository
  if (Object.keys(existing).length === 0) {
    await unlink(filePath).catch(() => {})
    return
  }
  await mkdir(orcaDir, { recursive: true })
  await writeFile(filePath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')
}

export function isGovernanceWrapperRepository(repo: GitHubApiRepository | null): boolean {
  return Boolean(repo && repo.repo.toLowerCase().endsWith('-w0m'))
}

export async function readSdlcWorkspaceConfig(
  repoPath: string
): Promise<SdlcWorkspaceConfig | null> {
  try {
    const raw = await readFile(join(repoPath, '.w0m', 'sdlc.json'), 'utf8')
    const parsed = JSON.parse(raw) as {
      canonical_repo?: unknown
      repos?: Record<string, unknown>
      vcs?: {
        provider?: unknown
        repo?: unknown
      }
    }
    const provider =
      typeof parsed?.vcs?.provider === 'string'
        ? parsed.vcs.provider.trim().toLowerCase()
        : 'github'
    const vcsRepo = provider === 'github' ? parseGitHubOwnerRepoSlug(parsed?.vcs?.repo) : null
    const canonicalRepoSubpath =
      typeof parsed?.canonical_repo === 'string' && parsed.canonical_repo.trim().length > 0
        ? parsed.canonical_repo.trim()
        : null
    const repoSubpaths: string[] = []
    if (parsed?.repos && typeof parsed.repos === 'object') {
      for (const value of Object.values(parsed.repos)) {
        if (typeof value === 'string' && value.trim().length > 0) {
          repoSubpaths.push(value.trim())
        }
      }
    }
    return {
      vcsRepo,
      canonicalRepoSubpath,
      repoSubpaths
    }
  } catch {
    return null
  }
}

async function hasGitMarkerAtPath(dirPath: string): Promise<boolean> {
  try {
    const marker = await stat(join(dirPath, '.git'))
    return marker.isDirectory() || marker.isFile()
  } catch {
    return false
  }
}

export async function findDirectChildGitRepoPaths(
  repoPath: string,
  preferredSubpaths: string[] = []
): Promise<string[]> {
  const results: string[] = []
  const seen = new Set<string>()

  const tryAddCandidate = async (candidatePath: string): Promise<void> => {
    const normalized = resolve(candidatePath)
    if (seen.has(normalized)) {
      return
    }
    if (await hasGitMarkerAtPath(candidatePath)) {
      seen.add(normalized)
      results.push(candidatePath)
    }
  }

  for (const subpath of preferredSubpaths) {
    if (!subpath || subpath === '.' || subpath.startsWith('/')) {
      continue
    }
    await tryAddCandidate(join(repoPath, subpath))
  }

  try {
    const entries = await readdir(repoPath, { withFileTypes: true })
    const dirs = entries
      .filter(
        (entry) =>
          (entry.isDirectory() || entry.isSymbolicLink()) &&
          !entry.name.startsWith('.') &&
          !shouldSkipDirectory(entry.name, 0)
      )
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of dirs) {
      await tryAddCandidate(join(repoPath, entry.name))
    }
  } catch {
    // Ignore unreadable or virtual test paths.
  }

  return results
}

export async function resolveSdlcOrNestedIssueRepository(args: {
  repoPath: string
  origin: GitHubApiRepository | null
  connectionId?: string | null
  probeRemote: (
    targetPath: string,
    remoteName: 'origin' | 'upstream'
  ) => Promise<GitHubApiRepository | null>
}): Promise<GitHubApiRepository | null> {
  if (args.connectionId) {
    return args.origin
  }

  const localOverride = await readLocalIssueRepositoryOverride(args.repoPath)
  if (localOverride) {
    return localOverride
  }

  const sdlcConfig = await readSdlcWorkspaceConfig(args.repoPath)
  const preferredSubpaths = [
    ...(sdlcConfig?.canonicalRepoSubpath ? [sdlcConfig.canonicalRepoSubpath] : []),
    ...(sdlcConfig?.repoSubpaths ?? [])
  ]
  const wrapperOrMissingOrigin = !args.origin || isGovernanceWrapperRepository(args.origin)

  if (sdlcConfig?.vcsRepo && !wrapperOrMissingOrigin) {
    return sdlcConfig.vcsRepo
  }

  if (wrapperOrMissingOrigin) {
    const childPaths = await findDirectChildGitRepoPaths(args.repoPath, preferredSubpaths)
    for (const childPath of childPaths) {
      const childUpstream = await args.probeRemote(childPath, 'upstream')
      if (childUpstream) {
        return childUpstream
      }
      const childOrigin = await args.probeRemote(childPath, 'origin')
      if (childOrigin && !isGovernanceWrapperRepository(childOrigin)) {
        return childOrigin
      }
    }
    if (sdlcConfig?.vcsRepo) {
      return sdlcConfig.vcsRepo
    }
  }

  return args.origin
}

export async function resolveNestedPrRepositoryFallback(args: {
  repoPath: string
  origin: GitHubApiRepository | null
  connectionId?: string | null
  probeRemote: (
    targetPath: string,
    remoteName: 'origin' | 'upstream'
  ) => Promise<GitHubApiRepository | null>
}): Promise<{
  originCandidate: GitHubApiRepository | null
  upstreamCandidate: GitHubApiRepository | null
}> {
  if (args.connectionId || (args.origin && !isGovernanceWrapperRepository(args.origin))) {
    return { originCandidate: args.origin, upstreamCandidate: null }
  }

  const sdlcConfig = await readSdlcWorkspaceConfig(args.repoPath)
  const preferredSubpaths = [
    ...(sdlcConfig?.canonicalRepoSubpath ? [sdlcConfig.canonicalRepoSubpath] : []),
    ...(sdlcConfig?.repoSubpaths ?? [])
  ]
  const childPaths = await findDirectChildGitRepoPaths(args.repoPath, preferredSubpaths)
  for (const childPath of childPaths) {
    const [childOrigin, childUpstream] = await Promise.all([
      args.probeRemote(childPath, 'origin'),
      args.probeRemote(childPath, 'upstream')
    ])
    if (childOrigin || childUpstream) {
      return {
        originCandidate: childOrigin,
        upstreamCandidate: childUpstream
      }
    }
  }

  return { originCandidate: args.origin, upstreamCandidate: null }
}
