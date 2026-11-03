import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathAllowed, inspectContent, checkRelease, stageRelease, packRelease } from '../scripts/release.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'vault-release-test-'));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts/release-manifest.json'), JSON.stringify(['README.md', 'scripts/release-manifest.json']));
  writeFileSync(join(root, 'README.md'), '# Safe example\n');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `Test Git operation failed: ${args[0]}`);
  return result.stdout;
}

test('release policy excludes profiles, captures, secrets, archives and traversal', () => {
  for (const path of ['data/vault.sqlite', 'lib/private.db', '.env', '.env.local', 'research/context.txt', 'artifacts/screenshot.png', '.git/config', 'public/cookies.json', 'docs/../data/file.js', 'scripts/auth.json', 'dist/video.zip', '/tmp/file.js', 'lib/link.pem', 'node_modules/a/index.js']) assert.equal(pathAllowed(path), false, path);
  for (const path of ['README.md', '.gitignore', '.gitattributes', 'lib/sync.js', 'tests/release.test.js', '.github/workflows/ci.yml', '打开拾影.bat']) assert.equal(pathAllowed(path), true, path);
});

test('scanner detects example secrets and personal metadata without returning values', () => {
  const samples = [
    ['gh' + 'p_' + 'a'.repeat(36), 'github-token'],
    ['SESS' + 'DATA=' + 'x'.repeat(30), 'cookie-value'],
    ['pass' + 'word: "' + 'a'.repeat(12) + '"', 'literal-credential'],
    ['owner' + '@' + 'mail.example', 'email-address'],
    ['C:' + '\\' + 'Users' + '\\' + 'someone' + '\\' + 'vault', 'personal-directory'],
    ['{"coo' + 'kies": []}', 'browser-storage-export'],
  ];
  for (const [value, kind] of samples) {
    const findings = inspectContent('README.md', Buffer.from(value));
    assert.ok(findings.some(f => f.kind === kind), kind);
    assert.ok(!JSON.stringify(findings).includes(value));
  }
  assert.equal(inspectContent('README.md', Buffer.from('hello@example.com')).length, 0);
  assert.equal(inspectContent('public/a.js', Buffer.from([0, 1, 2]))[0].kind, 'binary-file');
});

test('staging and packing include only approved files and create no commit', t => {
  const root = fixture(t);
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data/private.db'), Buffer.from([0, 1, 2]));
  git(root, 'init', '-b', 'main');
  assert.deepEqual(checkRelease(root).findings, []);
  const result = stageRelease(root);
  assert.equal(result.entries.length, 2);
  assert.ok(result.entries.every(e => !e.path.startsWith('data/')));
  const packed = packRelease(root);
  assert.equal(packed.count, 2);
  assert.equal(readFileSync(packed.output).subarray(0, 4).toString('hex'), '504b0304');
  const head = spawnSync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'], { windowsHide: true });
  assert.notEqual(head.status, 0);
  writeFileSync(join(root, 'README.md'), '# Not yet staged\n');
  assert.throws(() => packRelease(root), /未暂存/);
});

test('scanner checks staged blob even if worktree copy was cleaned', t => {
  const root = fixture(t);
  git(root, 'init', '-b', 'main');
  writeFileSync(join(root, 'README.md'), 'gh' + 'p_' + 'b'.repeat(36));
  git(root, 'add', 'README.md');
  writeFileSync(join(root, 'README.md'), '# Cleaned worktree\n');
  assert.ok(checkRelease(root).findings.some(f => f.kind === 'index:github-token'));
});

test('scanner refuses unexpected tracked files, even if ignored elsewhere', t => {
  const root = fixture(t);
  git(root, 'init', '-b', 'main');
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data/notes.json'), '{}');
  git(root, 'add', '-f', 'data/notes.json');
  assert.ok(checkRelease(root).findings.some(f => f.kind === 'not-in-release-manifest'));
});
