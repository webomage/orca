#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MANIFEST_COMMENT_RE = /<!--\s*w0m-overlay-manifest:\s*(\{[^\n]*?\})\s*-->/
const STABLE_TAG_RE = /^v?(\d+)\.(\d+)\.(\d+)$/
const OVERLAY_TAG_RE = /^v?(\d+)\.(\d+)\.(\d+)-w0m\.(\d+)$/

export function parseStableVersion(tagOrVersion) {
  const match = String(tagOrVersion).trim().match(STABLE_TAG_RE)
  if (!match) {
    return null
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  }
}

export function compareOverlayTuples(a, b) {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  // SemVer: normal release (overlayBuild === null) > prerelease (-w0m.N)
  if (a.overlayBuild === null && b.overlayBuild === null) return 0
  if (a.overlayBuild === null) return 1
  if (b.overlayBuild === null) return -1
  return a.overlayBuild - b.overlayBuild
}

function parseOverlayOrStableTuple(tagOrVersion) {
  const stable = parseStableVersion(tagOrVersion)
  if (stable) {
    return { ...stable, overlayBuild: null }
  }
  const match = String(tagOrVersion).trim().match(OVERLAY_TAG_RE)
  if (!match) {
    return null
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    overlayBuild: Number(match[4])
  }
}

/**
 * Given upstream latest stable tag `vX.Y.Z`, compute `X.Y.(Z+1)-w0m.N` such that:
 *   1. It is strictly newer than stock `X.Y.Z`
 *   2. It increments `.N` over any existing `X.Y.(Z+1)-w0m.*` release on the overlay repo
 *   3. It never regresses below any higher existing tag on the overlay repo
 *   4. Stock `X.Y.(Z+1)` (and next overlay `X.Y.(Z+2)-w0m.1`) remain strictly newer
 */
export function computeNextOverlayVersion(upstreamStableTag, existingOverlayTags = []) {
  const base = parseStableVersion(upstreamStableTag)
  if (!base) {
    throw new Error(`Invalid upstream stable tag: ${upstreamStableTag}`)
  }

  let target = {
    major: base.major,
    minor: base.minor,
    patch: base.patch + 1
  }

  const parsedExisting = existingOverlayTags
    .map((tag) => parseOverlayOrStableTuple(tag))
    .filter((item) => item !== null)

  for (const existing of parsedExisting) {
    const candidateFloor =
      existing.overlayBuild === null
        ? { major: existing.major, minor: existing.minor, patch: existing.patch + 1 }
        : { major: existing.major, minor: existing.minor, patch: existing.patch }
    if (
      candidateFloor.major > target.major ||
      (candidateFloor.major === target.major && candidateFloor.minor > target.minor) ||
      (candidateFloor.major === target.major &&
        candidateFloor.minor === target.minor &&
        candidateFloor.patch > target.patch)
    ) {
      target = candidateFloor
    }
  }

  let maxSeq = 0
  for (const existing of parsedExisting) {
    if (
      existing.major === target.major &&
      existing.minor === target.minor &&
      existing.patch === target.patch &&
      existing.overlayBuild !== null &&
      existing.overlayBuild > maxSeq
    ) {
      maxSeq = existing.overlayBuild
    }
  }

  return `${target.major}.${target.minor}.${target.patch}-w0m.${maxSeq + 1}`
}

export function buildOverlayManifestComment(manifest) {
  return `<!-- w0m-overlay-manifest: ${JSON.stringify(manifest)} -->`
}

export function parseManifestFromReleaseBody(body) {
  if (typeof body !== 'string' || !body) {
    return null
  }
  const match = body.match(MANIFEST_COMMENT_RE)
  if (!match) {
    return null
  }
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

export function manifestsEqual(left, right) {
  if (!left || !right) {
    return false
  }
  if (
    left.upstreamTag !== right.upstreamTag ||
    left.baseSha !== right.baseSha ||
    left.updaterSha !== right.updaterSha
  ) {
    return false
  }
  const leftIncluded = Array.isArray(left.included) ? left.included : []
  const rightIncluded = Array.isArray(right.included) ? right.included : []
  if (leftIncluded.length !== rightIncluded.length) {
    return false
  }
  for (let i = 0; i < leftIncluded.length; i += 1) {
    if (
      leftIncluded[i]?.branch !== rightIncluded[i]?.branch ||
      leftIncluded[i]?.sha !== rightIncluded[i]?.sha ||
      (leftIncluded[i]?.overlaySha ?? null) !== (rightIncluded[i]?.overlaySha ?? null)
    ) {
      return false
    }
  }
  return true
}

function runGit(repoDir, args, { allowFailure = false } = {}) {
  try {
    const stdout = execFileSync('git', args, {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { ok: true, stdout: stdout.trim(), stderr: '' }
  } catch (error) {
    if (allowFailure) {
      return {
        ok: false,
        stdout: String(error.stdout ?? '').trim(),
        stderr: String(error.stderr ?? '').trim()
      }
    }
    throw new Error(
      `git ${args.join(' ')} failed: ${String(error.stderr || error.message).trim()}`
    )
  }
}

function isAncestor(repoDir, ancestor, descendant) {
  return runGit(repoDir, ['merge-base', '--is-ancestor', ancestor, descendant], {
    allowFailure: true
  }).ok
}

function resolveRefCommit(repoDir, ref) {
  const res = runGit(repoDir, ['rev-parse', '--verify', `${ref}^{commit}`], { allowFailure: true })
  return res.ok ? res.stdout : null
}

function getPendingBranchCommits(repoDir, baseSha, branchSha, upstreamMainRef) {
  const mbRes = runGit(repoDir, ['merge-base', upstreamMainRef, branchSha], { allowFailure: true })
  const limitSha = mbRes.ok ? mbRes.stdout : baseSha
  const cherry = runGit(repoDir, ['cherry', baseSha, branchSha, limitSha], { allowFailure: true })
  if (!cherry.ok) {
    const revList = runGit(repoDir, ['rev-list', '--reverse', '--no-merges', `${limitSha}..${branchSha}`])
    return revList.stdout ? revList.stdout.split('\n').filter(Boolean) : []
  }
  if (!cherry.stdout) {
    return []
  }
  const needed = []
  for (const line of cherry.stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('+ ')) {
      needed.push(trimmed.slice(2).trim())
    }
  }
  return needed
}

export function formatOverlayReleaseNotes({
  version,
  upstreamRepo,
  overlayRepo,
  upstreamTag,
  tagCommit,
  baseSha,
  updaterBranch,
  updaterSha,
  included,
  retired,
  skipped,
  manifest
}) {
  const lines = [
    `## Orca \`v${version}\` — w0m Self-Healing Overlay Release`,
    '',
    `- **Upstream stable release**: [\`${upstreamRepo}@${upstreamTag}\`](https://github.com/${upstreamRepo}/releases/tag/${upstreamTag}) (\`${tagCommit.slice(0, 11)}\`)`,
    `- **Assembly base commit**: \`${baseSha.slice(0, 11)}\`${baseSha === tagCommit ? ' (exact upstream release tag)' : ' (advanced to `upstream/main` merge-base for newer PR branches)'}`,
    `- **Updater feed branch**: \`${updaterBranch}\` (\`${updaterSha.slice(0, 11)}\`) → \`https://github.com/${overlayRepo}/releases\``,
    ''
  ]

  lines.push(`### Included w0m Branches (${included.length})`)
  if (included.length === 0) {
    lines.push('- _None (pure upstream passthrough + overlay feed)_')
  } else {
    for (const item of included) {
      const desc = item.description ? ` — ${item.description}` : ''
      const overlayNote = item.overlaySha
        ? `, adapted via \`overlay/${item.branch}\` @ \`${item.overlaySha.slice(0, 11)}\``
        : ''
      lines.push(
        `- \`${item.branch}\` (\`${item.sha.slice(0, 11)}\`, ${item.commitCount} commit${item.commitCount === 1 ? '' : 's'}${overlayNote})${desc}`
      )
    }
  }
  lines.push('')

  if (retired.length > 0) {
    lines.push(`### Auto-Retired (Merged Upstream) (${retired.length})`)
    for (const item of retired) {
      lines.push(`- \`${item.branch}\` (\`${item.reason}\`)`)
    }
    lines.push('')
  }

  if (skipped.length > 0) {
    lines.push(`### Skipped — Needs Rebase (${skipped.length})`)
    for (const item of skipped) {
      const detail =
        item.conflicts && item.conflicts.length > 0
          ? `conflicts in \`${item.conflicts.slice(0, 5).join('`, `')}\`${item.conflicts.length > 5 ? ` (+${item.conflicts.length - 5} more)` : ''}`
          : item.reason
      lines.push(`- \`${item.branch}\`${item.sha ? ` (\`${item.sha.slice(0, 11)}\`)` : ''} — ${detail}`)
    }
    lines.push('')
  }

  lines.push(buildOverlayManifestComment(manifest))
  return `${lines.join('\n')}\n`
}

export function assembleOverlayInRepo({
  repoDir,
  config,
  upstreamTag,
  upstreamMainRef = 'upstream/main',
  remoteName = 'origin',
  existingOverlayTags = [],
  previousReleaseBody = null,
  mergedPrBranches = new Set(),
  force = false,
  explicitVersion = null,
  dryRun = false
}) {
  const tagCommit = resolveRefCommit(repoDir, upstreamTag)
  if (!tagCommit) {
    throw new Error(`Cannot resolve upstream tag commit: ${upstreamTag}`)
  }
  const tagMergeBaseRes = runGit(repoDir, ['merge-base', upstreamMainRef, tagCommit], {
    allowFailure: true
  })
  const tagLineageCommit = tagMergeBaseRes.ok ? tagMergeBaseRes.stdout : tagCommit

  const updaterRef = `${remoteName}/${config.updaterBranch}`
  const updaterSha = resolveRefCommit(repoDir, updaterRef)
  if (!updaterSha) {
    throw new Error(`Missing required updater branch ref: ${updaterRef}`)
  }

  // Advance assembly base beyond tagCommit only when an active branch has a newer merge-base on upstream/main.
  let baseSha = tagCommit
  let lineageTip = tagLineageCommit
  const refsForBaseCheck = [updaterSha]
  for (const entry of config.branches ?? []) {
    if (mergedPrBranches.has(entry.branch)) {
      continue
    }
    const sha = resolveRefCommit(repoDir, `${remoteName}/${entry.branch}`)
    if (sha) {
      refsForBaseCheck.push(sha)
    }
  }
  for (const sha of refsForBaseCheck) {
    const mb = runGit(repoDir, ['merge-base', upstreamMainRef, sha], { allowFailure: true })
    if (mb.ok && mb.stdout !== lineageTip && isAncestor(repoDir, lineageTip, mb.stdout)) {
      lineageTip = mb.stdout
      baseSha = mb.stdout
    }
  }

  runGit(repoDir, ['checkout', '--detach', baseSha])
  runGit(repoDir, ['reset', '--hard', baseSha])

  const gitIdentityArgs = [
    '-c',
    'user.name=w0m-overlay[bot]',
    '-c',
    'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'tag.gpgSign=false'
  ]

  const updaterCommits = getPendingBranchCommits(repoDir, baseSha, updaterSha, upstreamMainRef)
  if (updaterCommits.length > 0) {
    const pickUpdater = runGit(
      repoDir,
      [...gitIdentityArgs, 'cherry-pick', '--no-gpg-sign', ...updaterCommits],
      { allowFailure: true }
    )
    if (!pickUpdater.ok) {
      const conflicts = runGit(repoDir, ['diff', '--name-only', '--diff-filter=U'], {
        allowFailure: true
      }).stdout
      runGit(repoDir, ['cherry-pick', '--abort'], { allowFailure: true })
      throw new Error(
        `Updater branch ${config.updaterBranch} conflicted on ${baseSha.slice(0, 11)}: ${conflicts || pickUpdater.stderr}`
      )
    }
  }

  const included = []
  const retired = []
  const skipped = []

  for (const entry of config.branches ?? []) {
    const branch = entry.branch
    const ref = `${remoteName}/${branch}`
    const tipSha = resolveRefCommit(repoDir, ref)
    if (!tipSha) {
      skipped.push({ branch, sha: null, reason: `missing ref ${ref}`, conflicts: [] })
      continue
    }

    if (mergedPrBranches.has(branch)) {
      retired.push({ branch, sha: tipSha, reason: 'PR merged upstream' })
      continue
    }

    if (isAncestor(repoDir, tipSha, baseSha)) {
      retired.push({ branch, sha: tipSha, reason: 'ancestor of upstream base' })
      continue
    }

    const commits = getPendingBranchCommits(repoDir, baseSha, tipSha, upstreamMainRef)
    if (commits.length === 0) {
      retired.push({ branch, sha: tipSha, reason: 'patch-equivalent in upstream base' })
      continue
    }

    const beforeHead = runGit(repoDir, ['rev-parse', 'HEAD']).stdout
    const pick = runGit(
      repoDir,
      [...gitIdentityArgs, 'cherry-pick', '--no-gpg-sign', ...commits],
      { allowFailure: true }
    )
    if (pick.ok) {
      included.push({
        branch,
        sha: tipSha,
        commitCount: commits.length,
        description: entry.description ?? ''
      })
    } else {
      const conflictOut = runGit(repoDir, ['diff', '--name-only', '--diff-filter=U'], {
        allowFailure: true
      }).stdout
      const conflicts = conflictOut ? conflictOut.split('\n').filter(Boolean) : []
      runGit(repoDir, ['cherry-pick', '--abort'], { allowFailure: true })
      runGit(repoDir, ['reset', '--hard', beforeHead])

      const overlayRef = `${remoteName}/overlay/${branch}`
      const overlaySha = resolveRefCommit(repoDir, overlayRef)
      if (overlaySha) {
        const pickOverlay = runGit(
          repoDir,
          [...gitIdentityArgs, 'cherry-pick', '--no-gpg-sign', overlaySha],
          { allowFailure: true }
        )
        if (pickOverlay.ok) {
          included.push({
            branch,
            sha: tipSha,
            overlaySha,
            commitCount: commits.length,
            description: entry.description ?? ''
          })
          continue
        }
        const overlayConflictOut = runGit(repoDir, ['diff', '--name-only', '--diff-filter=U'], {
          allowFailure: true
        }).stdout
        const overlayConflicts = overlayConflictOut
          ? overlayConflictOut.split('\n').filter(Boolean)
          : conflicts
        runGit(repoDir, ['cherry-pick', '--abort'], { allowFailure: true })
        runGit(repoDir, ['reset', '--hard', beforeHead])
        skipped.push({
          branch,
          sha: tipSha,
          reason: `merge conflict (including overlay/${branch})`,
          conflicts: overlayConflicts
        })
        continue
      }

      skipped.push({
        branch,
        sha: tipSha,
        reason: 'merge conflict',
        conflicts
      })
    }
  }

  const manifest = {
    schema: 1,
    upstreamTag,
    baseSha,
    updaterSha,
    included: included.map((item) =>
      item.overlaySha
        ? { branch: item.branch, sha: item.sha, overlaySha: item.overlaySha }
        : { branch: item.branch, sha: item.sha }
    )
  }
  const previousManifest = parseManifestFromReleaseBody(previousReleaseBody)
  const shouldBuild = Boolean(force) || !manifestsEqual(manifest, previousManifest)
  const version = explicitVersion || computeNextOverlayVersion(upstreamTag, existingOverlayTags)
  const tag = `v${version}`

  if (!dryRun) {
    const pkgPath = resolve(repoDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    pkg.version = version
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    runGit(repoDir, ['add', 'package.json'])
    runGit(repoDir, [
      ...gitIdentityArgs,
      'commit',
      '--no-gpg-sign',
      '--allow-empty',
      '-m',
      `chore(release): stamp w0m overlay ${tag}`
    ])
  }

  const releaseNotes = formatOverlayReleaseNotes({
    version,
    upstreamRepo: config.upstreamRepo ?? 'stablyai/orca',
    overlayRepo: config.overlayRepo ?? 'webomage/orca',
    upstreamTag,
    tagCommit,
    baseSha,
    updaterBranch: config.updaterBranch,
    updaterSha,
    included,
    retired,
    skipped,
    manifest
  })

  return {
    shouldBuild,
    version,
    tag,
    upstreamTag,
    tagCommit,
    baseSha,
    updaterSha,
    included,
    retired,
    skipped,
    manifest,
    releaseNotes
  }
}

function parseCliArgs(argv) {
  const args = {
    mode: 'plan',
    repoDir: process.cwd(),
    configPath: 'config/w0m-overlay-branches.json',
    upstreamTag: '',
    upstreamMainRef: 'upstream/main',
    remoteName: 'origin',
    existingTagsJson: '',
    previousReleaseBodyFile: '',
    mergedPrBranchesJson: '',
    force: false,
    version: '',
    notesOut: '',
    githubOutput: process.env.GITHUB_OUTPUT || ''
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = () => argv[++i] ?? ''
    if (token === '--mode') args.mode = next()
    else if (token === '--repo-dir') args.repoDir = next()
    else if (token === '--config') args.configPath = next()
    else if (token === '--upstream-tag') args.upstreamTag = next()
    else if (token === '--upstream-main-ref') args.upstreamMainRef = next()
    else if (token === '--remote') args.remoteName = next()
    else if (token === '--existing-tags-json') args.existingTagsJson = next()
    else if (token === '--previous-body-file') args.previousReleaseBodyFile = next()
    else if (token === '--merged-branches-json') args.mergedPrBranchesJson = next()
    else if (token === '--force') args.force = true
    else if (token === '--version') args.version = next()
    else if (token === '--notes-out') args.notesOut = next()
    else if (token === '--github-output') args.githubOutput = next()
    else throw new Error(`Unknown CLI argument: ${token}`)
  }
  return args
}

function main() {
  const args = parseCliArgs(process.argv.slice(2))
  if (args.mode !== 'plan' && args.mode !== 'assemble') {
    throw new Error(`Invalid --mode ${args.mode}; expected plan or assemble`)
  }
  const config = JSON.parse(readFileSync(resolve(args.configPath), 'utf8'))
  if (!args.upstreamTag) {
    throw new Error('--upstream-tag is required')
  }
  const existingOverlayTags = args.existingTagsJson ? JSON.parse(args.existingTagsJson) : []
  const previousReleaseBody =
    args.previousReleaseBodyFile && existsSync(args.previousReleaseBodyFile)
      ? readFileSync(args.previousReleaseBodyFile, 'utf8')
      : null
  const mergedPrBranches = new Set(
    args.mergedPrBranchesJson ? JSON.parse(args.mergedPrBranchesJson) : []
  )

  const result = assembleOverlayInRepo({
    repoDir: resolve(args.repoDir),
    config,
    upstreamTag: args.upstreamTag,
    upstreamMainRef: args.upstreamMainRef,
    remoteName: args.remoteName,
    existingOverlayTags,
    previousReleaseBody,
    mergedPrBranches,
    force: args.force,
    explicitVersion: args.version || null,
    dryRun: args.mode === 'plan'
  })

  if (args.notesOut) {
    writeFileSync(resolve(args.notesOut), result.releaseNotes)
  }

  if (args.githubOutput) {
    const kv = [
      `should_build=${result.shouldBuild ? 'true' : 'false'}`,
      `version=${result.version}`,
      `tag=${result.tag}`,
      `upstream_tag=${result.upstreamTag}`,
      `base_sha=${result.baseSha}`,
      `included_count=${result.included.length}`,
      `retired_count=${result.retired.length}`,
      `skipped_count=${result.skipped.length}`
    ]
    appendFileSync(args.githubOutput, `${kv.join('\n')}\n`)
  }

  console.log(
    JSON.stringify(
      {
        mode: args.mode,
        shouldBuild: result.shouldBuild,
        version: result.version,
        tag: result.tag,
        upstreamTag: result.upstreamTag,
        baseSha: result.baseSha,
        included: result.included.map((x) => x.branch),
        retired: result.retired,
        skipped: result.skipped
      },
      null,
      2
    )
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
