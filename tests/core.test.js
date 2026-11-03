import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { Store } from '../lib/store.js';
import { biliVideo, douyinVideo, CollectionTracker, coverUrl } from '../lib/normalize.js';
import { syncBilibili } from '../lib/bilibili.js';
import { SyncManager } from '../lib/sync.js';
import { createApp } from '../server.js';

const video = () => biliVideo({ bvid: 'BV1xx411c7mD', title: '百分百 100%_测试', upper: { name: '作者' }, duration: 125, fav_time: 1700000000, type: 2 }, '技术');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'video-vault-test-'));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}

test('normalization validates platform IDs, dates and image URLs', () => {
  const v = video();
  assert.equal(v.savedAt, 1700000000000);
  assert.equal(v.url, 'https://www.bilibili.com/video/BV1xx411c7mD');
  assert.equal(biliVideo({ type: 12, id: 123 }, 'x'), null);
  assert.equal(douyinVideo({ aweme_id: 7777777777777777777 }), null);
  assert.equal(douyinVideo({ aweme_id: '7777777777777777777' }).externalId, '7777777777777777777');
  assert.equal(coverUrl('javascript:alert(1)'), '');
  assert.equal(coverUrl('https://hdslb.com.evil.com/x'), '');
  assert.equal(coverUrl('//i0.hdslb.com/a.jpg'), 'https://i0.hdslb.com/a.jpg');
});

test('upsert is idempotent, preserves user annotations and archive folders', t => {
  const store = fixture(t); const v = video();
  assert.equal(store.upsert([v]), 1);
  store.updateVideo(v.id, { watched: true, starred: true, tags: ['学习'] });
  assert.equal(store.upsert([{ ...v, title: 'new', savedAt: Date.now(), folders: ['设计'] }]), 0);
  const saved = store.getVideo(v.id);
  assert.deepEqual(saved.folders, ['技术', '设计']);
  assert.deepEqual(saved.tags, ['学习']);
  assert.equal(saved.watched, true);
  assert.equal(saved.savedAt, v.savedAt);
  assert.equal(store.stats().watched, 1);
  assert.equal(store.list({ view: 'later' }).total, 0);
  assert.equal(store.list({ folder: '设计' }).total, 1);
});

test('search escapes wildcard inputs and supports tags, filtering, pagination', t => {
  const store = fixture(t); store.upsert([video()]);
  assert.equal(store.list({ q: '%_' }).total, 1);
  assert.equal(store.list({ q: '%unknown' }).total, 0);
  assert.equal(store.list({ platform: 'douyin' }).total, 0);
  assert.equal(store.list({ page: -9, limit: 999 }).limit, 100);
  store.updateVideo(video().id, { tags: ['收藏标签'] });
  assert.equal(store.list({ q: '收藏标签' }).total, 1);
});

test('Douyin only reports complete for a contiguous cursor chain from zero', () => {
  const tracker = new CollectionTracker();
  const raw = { aweme_id: '7777777777777777777', desc: '收藏' };
  tracker.add({ status_code: 0, aweme_list: [raw], has_more: 0 }, '20');
  assert.equal(tracker.complete, false);
  tracker.add({ status_code: 0, aweme_list: [raw], has_more: 1, cursor: 20 }, '0');
  assert.equal(tracker.complete, true);
  assert.equal(tracker.items.size, 1);
  assert.throws(() => tracker.add({ status_code: 8, aweme_list: [] }, '0'));
  assert.throws(() => tracker.add({ status_code: 0, aweme_list: [] }, '0'));
  const cycle = new CollectionTracker();
  cycle.add({ status_code: 0, aweme_list: [], has_more: 1, cursor: 0 }, '0');
  assert.equal(cycle.complete, false);
});

test('Bilibili authenticates and reads every page and folder', async () => {
  const calls = []; const saved = [];
  const result = await syncBilibili({
    context: {}, save: items => saved.push(...items), progress() {}, check() {}, account() {}, pause: async () => {},
    request: async (_context, endpoint, params) => {
      calls.push([endpoint, params]);
      if (endpoint.endsWith('/nav')) return { isLogin: true, mid: 1 };
      if (endpoint.endsWith('list-all')) return { count: 2, list: [{ id: 10, title: 'a' }, { id: 11, title: 'b' }] };
      return { has_more: params.pn === 1, medias: [{ id: params.media_id * 100 + params.pn, type: 2 }] };
    },
  });
  assert.equal(result.complete, true);
  assert.equal(saved.length, 4);
  assert.equal(calls.length, 6);
});

test('Bilibili refuses unauthenticated and repeated/invalid pages', async () => {
  const base = { context: {}, save() {}, progress() {}, check() {}, account() {}, pause: async () => {} };
  await assert.rejects(syncBilibili({ ...base, request: async () => ({ isLogin: false }) }), /尚未登录/);
  await assert.rejects(syncBilibili({ ...base, request: async (_, path) => path.endsWith('/nav') ? { isLogin: true, mid: 1 } : path.endsWith('list-all') ? { list: [{ id: 1 }] } : { has_more: true, medias: [{ id: 1, type: 2 }] } }), /重复返回/);
});

test('sync jobs retain partial results and prevent overlapping operations', async t => {
  const store = fixture(t);
  let unblock; const gate = new Promise(resolve => { unblock = resolve; });
  const browsers = { get: async () => ({}), closeAll: async () => {}, hasProfile: () => true, contexts: new Map() };
  const sync = new SyncManager(store, browsers, { bilibili: async ({ save }) => { save([video()]); await gate; throw new Error('B 站测试断网'); } });
  const job = sync.start('bilibili');
  assert.throws(() => sync.start('bilibili'), /运行中/);
  unblock();
  await sync.active.get('bilibili').promise;
  assert.equal(job.status, 'partial');
  assert.equal(job.added, 1);
  assert.equal(store.getSetting('account:bilibili'), null);
  await sync.close();
});

test('API enforces local hosts, same origin, mutation token and schema', async t => {
  const store = fixture(t); store.upsert([video()]);
  const sync = { accounts: () => [], close: async () => {} };
  const { app } = createApp({ store, sync, browsers: {} });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/api/session`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(`${base}/api/session`, { headers: { Origin: 'https://evil.example' } })).status, 403);
  const { token } = await (await fetch(`${base}/api/session`)).json();
  const endpoint = `${base}/api/videos/${encodeURIComponent(video().id)}`;
  assert.equal((await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const patch = body => fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Vault-Token': token }, body: JSON.stringify(body) });
  assert.equal((await patch({ watched: 'yes' })).status, 400);
  assert.equal((await patch({ tags: ['a'.repeat(31)] })).status, 400);
  assert.equal((await patch({ url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await patch({ watched: true, tags: ['安全'] })).status, 200);
  const exported = await (await fetch(`${base}/api/export`)).json();
  assert.equal(exported.videos.length, 1);
  assert.ok(!JSON.stringify(exported).includes(token));
  assert.equal((await fetch(`${base}/api/no-such-route`)).status, 404);
});
