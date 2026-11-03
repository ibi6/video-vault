import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, ROOT } from '../server.js';
import { biliVideo, douyinVideo } from '../lib/normalize.js';
import { syncDouyin } from '../lib/douyin.js';

const dir = mkdtempSync(join(tmpdir(), 'video-vault-ui-'));
const instance = createApp({ dataDir: dir });
const server = instance.app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const artifacts = join(ROOT, 'artifacts');
mkdirSync(artifacts, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ channel: process.env.VAULT_BROWSER || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // External players are not part of this deterministic test and never receive fixture IDs.
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>播放器测试占位</title>' }));
  await page.goto(origin);
  await page.getByText('给你的好内容，安一个家').waitFor();
  assert.equal(await page.locator('.video-card').count(), 0);
  await page.screenshot({ path: join(artifacts, 'desktop-empty.png'), fullPage: true });
  await page.getByRole('button', { name: '连接第一个来源' }).click();
  await page.locator('#settings-dialog[open]').waitFor();
  assert.equal(await page.locator('.settings-account').count(), 2);
  await page.locator('[data-auto="bilibili"]').check();
  await page.waitForFunction(async () => (await (await fetch('/api/status')).json()).accounts.find(a => a.platform === 'bilibili').autoSync);
  await page.locator('[data-auto="bilibili"]').uncheck();
  await page.waitForFunction(async () => !(await (await fetch('/api/status')).json()).accounts.find(a => a.platform === 'bilibili').autoSync);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  console.log('✓ Empty state, settings dialog, auto-sync preference persistence');

  // Only this disposable database contains synthetic records; production never seeds sample favorites.
  const titles = ['测试收藏 · 城市漫游与光影', '测试收藏 · 用代码记录灵感', '测试收藏 · 日常也有电影感', '<img src=x onerror=alert(1)> 安全测试'];
  const rows = Array.from({ length: 27 }, (_, i) => i % 2 === 0
    ? biliVideo({ id: 100000 + i, title: titles[i % titles.length], type: 2, duration: 120 + i * 5, upper: { name: '测试作者' }, fav_time: 1700000000 + i }, i % 4 ? '设计灵感' : '技术学习')
    : douyinVideo({ aweme_id: String(7777000000000000000n + BigInt(i)), desc: titles[i % titles.length], author: { nickname: '测试作者' }, collect_time: 1700000000 + i, video: { duration: 40000 } }));
  instance.store.upsert(rows);
  await page.reload();
  await page.locator('.video-card').first().waitFor();
  assert.equal(await page.locator('.video-card').count(), 24);
  assert.equal(await page.locator('.card-title img').count(), 0);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.video-card').length === 3);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.video-card').length === 24);
  await page.screenshot({ path: join(artifacts, 'desktop-fixture-library.png'), fullPage: true });
  console.log('✓ Persistent library, pagination, HTML escaping');

  await page.locator('[data-action="platform"][data-platform="douyin"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.video-card').length === 13);
  assert.equal(await page.locator('.thumbnail.bilibili').count(), 0);
  await page.locator('#search').fill('不存在的关键词');
  await page.getByText('这里还没有匹配的收藏').waitFor();
  await page.getByRole('button', { name: '清除筛选，看看全部' }).click();
  await page.locator('.video-card').first().waitFor();
  await page.locator('.card-tools [data-action="star"]').first().click();
  await page.waitForFunction(() => document.querySelector('#count-later').textContent === '1');
  await page.locator('[data-view="later"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.video-card').length === 1);
  await page.locator('.thumbnail').click();
  await page.locator('#player-dialog[open]').waitFor();
  assert.match(await page.locator('#player-frame iframe').getAttribute('src'), /^https:\/\/player\.bilibili\.com/);
  await page.locator('#tag-input').fill('测试标签，灵感');
  await page.getByRole('button', { name: '保存标签', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.card-tags').textContent.includes('测试标签'));
  await page.locator('#player-actions [data-action="watch"]').click();
  await page.waitForFunction(() => document.querySelector('#count-watched').textContent === '1');
  await page.getByRole('button', { name: '关闭播放器', exact: true }).click();
  assert.equal(await page.locator('#player-frame iframe').count(), 0);
  await page.locator('[data-view="watched"]').click();
  await page.locator('.video-card').waitFor();
  console.log('✓ Platform/search filters, later/watched flags, player, persisted tags');

  await page.locator('[data-view="all"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出收藏', exact: true }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /拾影收藏-.*\.json$/);
  assert.equal(await download.failure(), null);
  await page.getByRole('button', { name: '同步记录', exact: true }).click();
  await page.getByText('还没有同步记录。连接一个来源，开始第一次同步。').waitFor();
  await page.getByRole('button', { name: '关闭记录', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => document.querySelector('#toast').hidden);
  await page.screenshot({ path: join(artifacts, 'mobile-fixture-library.png'), fullPage: false });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.screenshot({ path: join(artifacts, 'mobile-settings.png'), fullPage: false });
  assert.equal(await page.evaluate(() => { const d = document.querySelector('dialog[open]'); return d.scrollWidth > d.clientWidth; }), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('✓ Export action, sync history, mobile layout, dialog keyboard dismissal, zero JS errors');
  for (const mode of ['complete', 'partial', 'login-error']) {
    const platformContext = await browser.newContext();
    const saved = new Map();
    const html = `<!doctype html><meta charset="utf-8"><main style="height:400px;overflow-y:auto"><div style="height:4000px">模拟收藏页，仅用于测试</div></main><script>
      const path = '/aweme/v1/web/aweme/listcollection/';
      fetch('/aweme/v1/web/aweme/favorite/');
      fetch(path, { method: 'POST', body: new URLSearchParams({cursor:'0'}) });
      let requested = false;
      document.querySelector('main').addEventListener('scroll', () => { if (!requested) { requested = true; fetch(path, {method:'POST',body:new URLSearchParams({cursor:'20'})}); } });
      </script>`;
    await platformContext.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.startsWith('/user/')) return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/aweme/v1/web/aweme/listcollection/') {
        const cursor = new URLSearchParams(request.postData()).get('cursor');
        return route.fulfill({ json: { status_code: mode === 'login-error' ? 8 : 0, aweme_list: [{ aweme_id: cursor === '0' ? '7777777777777777001' : '7777777777777777002', desc: '测试收藏' }], has_more: cursor === '0' || mode === 'partial' ? 1 : 0, cursor: cursor === '0' ? 20 : 40 } });
      }
      return route.fulfill({ json: { status_code: 0, aweme_list: [{ aweme_id: '8888888888888888888', desc: '非收藏，不应导入' }], has_more: 0 } });
    });
    const operation = syncDouyin({ context: platformContext, save: items => items.forEach(v => saved.set(v.id, v)), progress() {}, check() {}, account() {}, maxRounds: 3 });
    if (mode === 'login-error') { await assert.rejects(operation, /有效收藏列表/); assert.equal(saved.size, 0); }
    else {
      const result = await operation;
      assert.equal(result.complete, mode === 'complete');
      assert.equal(saved.size, 2);
      assert.ok(!saved.has('douyin:8888888888888888888'));
    }
    await platformContext.close();
  }
  console.log('✓ Douyin browser adapter: complete chain, partial pagination, login error, ignoring likes');
  console.log(`UI screenshots: ${artifacts} (fixture screenshots are test data only)`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await instance.close();
  rmSync(dir, { recursive: true, force: true });
}
