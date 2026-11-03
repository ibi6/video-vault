import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HOME = { bilibili: 'https://www.bilibili.com', douyin: 'https://www.douyin.com/user/self?showTab=collection' };
export class BrowserManager {
  contexts = new Map();
  opening = new Map();
  constructor(directory) { this.directory = join(directory, 'browser-profiles'); }
  hasProfile(platform) { return existsSync(join(this.directory, platform, 'Default')); }
  async get(platform) {
    if (this.contexts.has(platform)) return this.contexts.get(platform);
    if (this.opening.has(platform)) return this.opening.get(platform);
    const promise = this.launch(platform);
    this.opening.set(platform, promise);
    try { return await promise; } finally { this.opening.delete(platform); }
  }
  async launch(platform) {
    const directory = join(this.directory, platform);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const channels = process.env.VAULT_BROWSER ? [process.env.VAULT_BROWSER] : ['chrome', 'msedge', undefined];
    for (const channel of channels) {
      try {
        const context = await chromium.launchPersistentContext(directory, {
          channel, headless: false, viewport: { width: 1280, height: 820 }, locale: 'zh-CN',
          acceptDownloads: false, timeout: 20000,
        });
        context.setDefaultTimeout(8000);
        context.setDefaultNavigationTimeout(30000);
        this.contexts.set(platform, context);
        context.on('close', () => { if (this.contexts.get(platform) === context) this.contexts.delete(platform); });
        return context;
      } catch { /* Try an installed browser; never use the user's personal browser profile. */ }
    }
    throw new Error('无法打开专用浏览器。请安装 Chrome/Edge，或运行 npx playwright install chromium；也请关闭该平台残留的专用窗口后重试。');
  }
  async open(platform) {
    const context = await this.get(platform);
    const page = context.pages().find(p => !p.isClosed()) || await context.newPage();
    await page.goto(HOME[platform], { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    return page;
  }
  async close(platform) {
    const pending = this.opening.get(platform);
    if (pending) await pending.catch(() => {});
    await this.contexts.get(platform)?.close();
  }
  async closeAll() { await Promise.all(['bilibili', 'douyin'].map(p => this.close(p))); }
}
