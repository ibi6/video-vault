import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.js';
import { SyncManager } from '../lib/sync.js';
import { biliRequest } from '../lib/bilibili.js';
import { biliVideo, CollectionTracker, collectionCursor } from '../lib/normalize.js';

const v = biliVideo({ id: 1000, type: 2, title: '持久化测试' }, '默认收藏夹');
const fakeBrowsers = () => ({ get: async () => ({}), contexts: new Map(), hasProfile: () => true, closeAll: async () => {} });
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vault-lifecycle-'));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}

test('database restart restores library and marks running jobs interrupted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-restart-'));
  let store = new Store(dir);
  try {
    store.upsert([v]);
    store.updateVideo(v.id, { starred: true, tags: ['保留'] });
    store.setSetting('auto:bilibili', true);
    store.saveJob({ id: 'interrupted-test', platform: 'bilibili', status: 'running', startedAt: Date.now(), count: 1 });
    store.close(); store = new Store(dir);
    assert.equal(store.stats().total, 1);
    assert.deepEqual(store.getVideo(v.id).tags, ['保留']);
    assert.equal(store.getSetting('auto:bilibili'), true);
    assert.equal(store.jobs()[0].status, 'interrupted');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('cancellation preserves already saved records and never reports success', async t => {
  const store = setup(t);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const sync = new SyncManager(store, fakeBrowsers(), { bilibili: async ({ save, check }) => { save([v]); await gate; check(); return { complete: true, message: '完成' }; } });
  const job = sync.start('bilibili');
  const running = sync.active.get('bilibili').promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sync.cancel('bilibili'), true);
  release(); await running;
  assert.equal(job.status, 'cancelled');
  assert.equal(store.stats().total, 1);
  await sync.close();
});

test('scheduler is opt-in and applies a 30 minute retry interval', async t => {
  const store = setup(t);
  let calls = 0;
  const sync = new SyncManager(store, fakeBrowsers(), { bilibili: async () => { calls++; return { complete: true, message: '完成' }; } });
  sync.tick(); assert.equal(calls, 0);
  store.setSetting('auto:bilibili', true);
  sync.tick();
  await sync.active.get('bilibili').promise;
  assert.equal(calls, 1);
  sync.tick(); assert.equal(calls, 1);
  const [job] = store.jobs(); job.startedAt -= 31 * 60000; store.saveJob(job);
  sync.tick(); await sync.active.get('bilibili').promise;
  assert.equal(calls, 2);
  await sync.close();
});

test('Bilibili responses are disposed and platform errors do not leak bodies', async () => {
  let disposed = 0;
  const context = { request: { get: async () => ({ ok: () => true, json: async () => ({ code: -101, message: 'private-body-must-not-leak' }), dispose: async () => { disposed++; } }) } };
  await assert.rejects(biliRequest(context, '/x/web-interface/nav'), error => error.message.includes('-101') && !error.message.includes('private-body'));
  assert.equal(disposed, 1);
});

test('Douyin parses observed form/JSON cursors; unknown first cursor stays partial', () => {
  const request = (body, query = '') => ({ url: () => `https://www.douyin.com/aweme/v1/web/aweme/listcollection/${query}`, postData: () => body });
  assert.equal(collectionCursor(request('cursor=0')), '0');
  assert.equal(collectionCursor(request('{"max_cursor":20}')), '20');
  assert.equal(collectionCursor(request('', '?cursor=40')), '40');
  assert.equal(collectionCursor(request('')), null);
  const tracker = new CollectionTracker();
  tracker.add({ status_code: 0, aweme_list: [], has_more: 0 }, null);
  assert.equal(tracker.complete, false);
  const empty = new CollectionTracker();
  empty.add({ status_code: 0, aweme_list: [], has_more: 0 }, '0');
  assert.equal(empty.complete, true);
});
