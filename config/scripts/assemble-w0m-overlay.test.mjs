import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  assembleOverlayInRepo,
  computeNextOverlayVersion,
  manifestsEqual,
  parseManifestFromReleaseBody
} from './assemble-w0m-overlay.mjs'

function git(cwd, ...args) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'tag.gpgSign=false',
      ...args
    ],
    { cwd, encoding: 'utf8' }
  ).trim()
}

test('computeNextOverlayVersion maintains monotonic SemVer progression', () => {
  assert.equal(computeNextOverlayVersion('v1.4.247', []), '1.4.248-w0m.1')
  assert.equal(computeNextOverlayVersion('v1.4.247', ['v1.4.248-w0m.1']), '1.4.248-w0m.2')
  assert.equal(
    computeNextOverlayVersion('v1.4.247', ['v1.4.248-w0m.1', 'v1.4.248-w0m.3']),
    '1.4.248-w0m.4'
  )
  // Upstream cuts v1.4.248 -> jumps to 1.4.249-w0m.1
  assert.equal(
    computeNextOverlayVersion('v1.4.248', ['v1.4.248-w0m.1', 'v1.4.248-w0m.2']),
    '1.4.249-w0m.1'
  )
  // Never regress below an existing higher tag
  assert.equal(computeNextOverlayVersion('v1.4.247', ['v1.4.250-w0m.2']), '1.4.250-w0m.3')
})

test('assembleOverlayInRepo merges clean branches, retires squash-merged branches, skips conflicts, and detects no-op reruns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'w0m-overlay-test-'))
  try {
    git(dir, 'init', '-b', 'main')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'orca', version: '1.4.200' }, null, 2))
    writeFileSync(join(dir, 'shared.txt'), 'line1\nline2\nline3\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '--no-gpg-sign', '-m', 'initial upstream')

    // Simulate a PR branch that was later squash-merged into upstream
    git(dir, 'checkout', '-b', 'fix/already-merged')
    writeFileSync(join(dir, 'merged.txt'), 'already in upstream\n')
    git(dir, 'add', 'merged.txt')
    git(dir, 'commit', '--no-gpg-sign', '-m', 'fix: merged feature')
    git(dir, 'update-ref', 'refs/remotes/origin/fix/already-merged', 'HEAD')

    // Squash-merge it on main and cut v1.4.247 detached tag
    git(dir, 'checkout', 'main')
    writeFileSync(join(dir, 'merged.txt'), 'already in upstream\n')
    git(dir, 'add', 'merged.txt')
    git(dir, 'commit', '--no-gpg-sign', '-m', 'fix: merged feature (#100)')
    const mainAtTagBase = git(dir, 'rev-parse', 'HEAD')

    git(dir, 'checkout', '--detach', mainAtTagBase)
    writeFileSync(join(dir, 'hotfix.txt'), 'release-branch cherry-pick\n')
    git(dir, 'add', 'hotfix.txt')
    git(dir, 'commit', '--no-gpg-sign', '-m', 'fix: release hotfix')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'orca', version: '1.4.247' }, null, 2))
    git(dir, 'add', 'package.json')
    git(dir, 'commit', '--no-gpg-sign', '-m', 'release: v1.4.247')
    git(dir, 'tag', 'v1.4.247')

    // Advance upstream/main slightly after v1.4.247
    git(dir, 'checkout', 'main')
    writeFileSync(join(dir, 'post-tag.txt'), 'post-tag commit\n')
    git(dir, 'add', 'post-tag.txt')
    git(dir, 'commit', '--no-gpg-sign', '-m', 'chore: post-tag upstream commit')
    git(dir, 'update-ref', 'refs/remotes/upstream/main', 'HEAD')

    // Create updater branch off latest upstream/main
    git(dir, 'checkout', '-b', 'feat/w0m-overlay-updater-feed', 'refs/remotes/upstream/main')
    writeFileSync(join(dir, 'updater.txt'), 'webomage/orca\n')
    git(dir, 'add', 'updater.txt')
    git(dir, 'commit', '--no-gpg-sign', '-m', 'feat: overlay updater')
    git(dir, 'update-ref', 'refs/remotes/origin/feat/w0m-overlay-updater-feed', 'HEAD')

    // Create a clean feature branch off latest upstream/main
    git(dir, 'checkout', '-b', 'feat/clean-one', 'refs/remotes/upstream/main')
    writeFileSync(join(dir, 'clean.txt'), 'clean enhancement\n')
    git(dir, 'add', 'clean.txt')
    git(dir, 'commit', '--no-gpg-sign', '-m', 'feat: clean enhancement')
    git(dir, 'update-ref', 'refs/remotes/origin/feat/clean-one', 'HEAD')

    // Create a conflicting branch modifying shared.txt incompatibly with clean-one / base
    git(dir, 'checkout', '-b', 'feat/conflicting', mainAtTagBase)
    writeFileSync(join(dir, 'clean.txt'), 'conflicting content\n')
    git(dir, 'add', 'clean.txt')
    git(dir, 'commit', '--no-gpg-sign', '-m', 'feat: conflicting change')
    git(dir, 'update-ref', 'refs/remotes/origin/feat/conflicting', 'HEAD')

    const config = {
      upstreamRepo: 'stablyai/orca',
      overlayRepo: 'webomage/orca',
      updaterBranch: 'feat/w0m-overlay-updater-feed',
      branches: [
        { branch: 'fix/already-merged', description: 'Already squash-merged' },
        { branch: 'feat/clean-one', description: 'Clean feature' },
        { branch: 'feat/conflicting', description: 'Conflicting feature' }
      ]
    }

    const assembled = assembleOverlayInRepo({
      repoDir: dir,
      config,
      upstreamTag: 'v1.4.247',
      existingOverlayTags: [],
      dryRun: false
    })

    assert.equal(assembled.shouldBuild, true)
    assert.equal(assembled.version, '1.4.248-w0m.1')
    assert.deepEqual(
      assembled.included.map((x) => x.branch),
      ['feat/clean-one']
    )
    assert.deepEqual(
      assembled.retired.map((x) => x.branch),
      ['fix/already-merged']
    )
    assert.deepEqual(
      assembled.skipped.map((x) => x.branch),
      ['feat/conflicting']
    )
    assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '1.4.248-w0m.1')
    assert.equal(readFileSync(join(dir, 'clean.txt'), 'utf8'), 'clean enhancement\n')
    assert.equal(readFileSync(join(dir, 'updater.txt'), 'utf8'), 'webomage/orca\n')

    const parsedManifest = parseManifestFromReleaseBody(assembled.releaseNotes)
    assert.equal(manifestsEqual(parsedManifest, assembled.manifest), true)

    // Re-running plan mode with previousReleaseBody should yield shouldBuild=false
    const rerunPlan = assembleOverlayInRepo({
      repoDir: dir,
      config,
      upstreamTag: 'v1.4.247',
      existingOverlayTags: ['v1.4.248-w0m.1'],
      previousReleaseBody: assembled.releaseNotes,
      dryRun: true
    })
    assert.equal(rerunPlan.shouldBuild, false)
    assert.equal(rerunPlan.version, '1.4.248-w0m.2')

    // Supplying origin/overlay/<branch> adapts an inter-branch conflict without altering origin/<branch>
    git(dir, 'checkout', '--detach', 'refs/remotes/origin/feat/clean-one')
    writeFileSync(join(dir, 'clean.txt'), 'clean enhancement\nadapted conflicting content\n')
    git(dir, 'add', 'clean.txt')
    git(dir, 'commit', '--no-gpg-sign', '-m', 'feat: adapted conflicting feature on clean-one')
    git(dir, 'update-ref', 'refs/remotes/origin/overlay/feat/conflicting', 'HEAD')

    const adapted = assembleOverlayInRepo({
      repoDir: dir,
      config,
      upstreamTag: 'v1.4.247',
      existingOverlayTags: ['v1.4.248-w0m.1'],
      previousReleaseBody: assembled.releaseNotes,
      dryRun: false
    })
    assert.equal(adapted.shouldBuild, true)
    assert.equal(adapted.version, '1.4.248-w0m.2')
    assert.deepEqual(
      adapted.included.map((x) => x.branch),
      ['feat/clean-one', 'feat/conflicting']
    )
    assert.deepEqual(adapted.skipped, [])
    assert.equal(
      readFileSync(join(dir, 'clean.txt'), 'utf8'),
      'clean enhancement\nadapted conflicting content\n'
    )
    assert.match(adapted.releaseNotes, /adapted via `overlay\/feat\/conflicting`/)
    assert.equal(manifestsEqual(parseManifestFromReleaseBody(adapted.releaseNotes), adapted.manifest), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
