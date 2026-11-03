import { CollectionTracker, collectionCursor } from './normalize.js';

export async function syncDouyin({ context, save, progress, check, account, maxRounds = 60 }) {
  const page = context.pages().find(p => !p.isClosed()) || await context.newPage();
  const tracker = new CollectionTracker();
  const pending = new Set();
  let responseError = null;
  let active = true;
  const handler = response => {
    const url = new URL(response.url());
    // Only the user's collection endpoint. Never import likes, recommendations or search results.
    if (url.hostname !== 'www.douyin.com' || url.pathname !== '/aweme/v1/web/aweme/listcollection/' || !active) return;
    const work = (async () => {
      if (!response.ok()) throw new Error('抖音收藏请求受限，请在专用窗口完成验证。');
      const payload = await response.json();
      if (!active) return;
      check();
      tracker.add(payload, collectionCursor(response.request()));
      save([...tracker.items.values()]);
      account({ name: '抖音账号（已读取收藏）', verifiedAt: Date.now() });
      progress(`已读取 ${tracker.items.size} 条抖音收藏 · ${tracker.responses} 页`);
    })().catch(error => { responseError = error; });
    pending.add(work);
    work.finally(() => pending.delete(work));
  };
  page.on('response', handler);
  try {
    check();
    progress('正在打开抖音收藏页；若出现登录或验证，请在专用窗口完成。');
    await page.goto('https://www.douyin.com/user/self?showTab=collection', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    if (!tracker.responses) {
      // Best-effort UI navigation; selectors may change. The response listener is the source of truth.
      const tabs = page.getByText(/^收藏(?:\s*\d[\d.万]*)?$/);
      for (let i = 0; i < Math.min(await tabs.count(), 8); i++) {
        if (await tabs.nth(i).isVisible()) { await tabs.nth(i).click({ timeout: 3000 }).catch(() => {}); break; }
      }
    }
    let idle = 0; let seen = 0;
    for (let round = 0; round < maxRounds; round++) {
      check();
      await Promise.all([...pending]);
      if (responseError) throw responseError;
      if (tracker.complete) break;
      if (tracker.items.size === seen) idle++; else { idle = 0; seen = tracker.items.size; }
      if (tracker.responses && idle >= 8) break;
      if (!tracker.responses && idle >= 25) break;
      await page.evaluate(() => {
        const candidates = [...document.querySelectorAll('main, section, div')].filter(el => {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return rect.width > 200 && rect.height > 150 && rect.top < innerHeight && rect.bottom > 0 &&
            /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 100;
        }).sort((a, b) => b.clientHeight - a.clientHeight);
        for (const el of candidates.slice(0, 3)) el.scrollBy(0, el.clientHeight * 0.85);
        window.scrollBy(0, innerHeight * 0.85);
      });
      await page.waitForTimeout(1800);
    }
    await Promise.all([...pending]);
    if (responseError) throw responseError;
    if (!tracker.responses) throw new Error('未读取到抖音收藏响应。请在专用窗口登录，进入“我 → 收藏 → 视频”，然后重试；验证码和页面变更不会被绕过。');
    const skipped = tracker.skipped ? `；${tracker.skipped} 条无法识别的内容未导入` : '';
    return { complete: tracker.complete, message: tracker.complete
      ? `抖音视频收藏已从首页读取至末页${skipped}。不包含单独收藏夹/音乐收藏。`
      : `已保存 ${tracker.items.size} 条已加载收藏，但未确认从首页到末页的完整分页。请检查收藏页后重试${skipped}。` };
  } finally {
    active = false;
    page.off('response', handler);
    await Promise.all([...pending]);
  }
}
