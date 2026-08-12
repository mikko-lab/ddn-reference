#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  collectGitPublicFiles,
  collectSnapshotPublicFiles,
  parseSha256Manifest,
  renderSha256Manifest,
} from './public-snapshot-files.mjs';

const fixtureManifest = {
  allowedRoots: ['src'],
  allowedRootFiles: ['README.md', 'eslint.config.js', 'public-snapshot-manifest.json'],
  excludedPaths: ['src/private'],
  vendoredSources: [],
};

function makeFixture() {
  const scratch = mkdtempSync(join(tmpdir(), 'ddn-public-snapshot-test-'));
  const worktree = join(scratch, 'worktree');
  const snapshot = join(scratch, 'snapshot');
  const sha256Manifest = join(scratch, 'snapshot-files.sha256');
  for (const root of [worktree, snapshot]) {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'README.md'), 'public fixture\n');
    writeFileSync(join(root, 'eslint.config.js'), 'export default [];\n');
    writeFileSync(join(root, 'public-snapshot-manifest.json'), `${JSON.stringify(fixtureManifest)}\n`);
    writeFileSync(join(root, 'src/index.js'), 'export const value = 1;\n');
  }
  execFileSync('git', ['init', '-q'], { cwd: worktree });
  execFileSync('git', ['add', '.'], { cwd: worktree });
  const gitFiles = collectGitPublicFiles(worktree, fixtureManifest);
  writeFileSync(sha256Manifest, renderSha256Manifest(snapshot, gitFiles));
  return { gitFiles, scratch, sha256Manifest, snapshot, worktree };
}

function withFixture(run) {
  const fixture = makeFixture();
  try {
    run(fixture);
  } finally {
    rmSync(fixture.scratch, { recursive: true, force: true });
  }
}

test('Git-worktree and history-free snapshot select the same public files', () => {
  withFixture(({ gitFiles, sha256Manifest, snapshot }) => {
    const snapshotFiles = collectSnapshotPublicFiles(snapshot, fixtureManifest, sha256Manifest);
    assert.deepEqual(snapshotFiles, gitFiles);
    assert.equal(snapshotFiles.includes('eslint.config.js'), true);
  });
});

test('positive allowlisting does not disclose or select a private sibling', () => {
  withFixture(({ worktree }) => {
    mkdirSync(join(worktree, 'src', 'private'));
    writeFileSync(join(worktree, 'src', 'private', 'internal.txt'), 'private\n');
    const positiveManifest = {
      ...fixtureManifest,
      allowedRoots: ['src/index.js'],
      excludedPaths: [],
    };
    const selected = collectGitPublicFiles(worktree, positiveManifest);
    assert.deepEqual(selected.filter((path) => path.startsWith('src/')), ['src/index.js']);
    assert.equal(JSON.stringify(positiveManifest).includes('internal.txt'), false);
  });
});

test('history-free snapshot rejects an extra file outside the allowlist', () => {
  withFixture(({ sha256Manifest, snapshot }) => {
    writeFileSync(join(snapshot, 'internal.txt'), 'must not ship\n');
    assert.throws(
      () => collectSnapshotPublicFiles(snapshot, fixtureManifest, sha256Manifest),
      /outside the public allowlist/
    );
  });
});

test('history-free snapshot rejects a missing manifest file', () => {
  withFixture(({ sha256Manifest, snapshot }) => {
    unlinkSync(join(snapshot, 'src/index.js'));
    assert.throws(() => collectSnapshotPublicFiles(snapshot, fixtureManifest, sha256Manifest), /file is missing/);
  });
});

test('history-free snapshot rejects symlinks without following them', () => {
  withFixture(({ scratch, sha256Manifest, snapshot }) => {
    const outside = join(scratch, 'outside.txt');
    writeFileSync(outside, 'outside\n');
    unlinkSync(join(snapshot, 'src/index.js'));
    symlinkSync(outside, join(snapshot, 'src/index.js'));
    assert.throws(() => collectSnapshotPublicFiles(snapshot, fixtureManifest, sha256Manifest), /symlink is forbidden/);
  });
});

test('SHA-256 manifest rejects parent-directory traversal', () => {
  withFixture(({ sha256Manifest }) => {
    writeFileSync(sha256Manifest, `${'0'.repeat(64)}  ../escape\n`);
    assert.throws(() => parseSha256Manifest(sha256Manifest), /path traversal/);
  });
});

test('history-free snapshot rejects embedded Git metadata', () => {
  withFixture(({ sha256Manifest, snapshot }) => {
    mkdirSync(join(snapshot, '.git'));
    assert.throws(() => collectSnapshotPublicFiles(snapshot, fixtureManifest, sha256Manifest), /must not contain \.git/);
  });
});
