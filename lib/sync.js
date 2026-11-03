import { randomUUID } from 'node:crypto';
import { PLATFORMS } from './normalize.js';
import { syncBilibili } from './bilibili.js';
import { syncDouyin } from './douyin.js';

export class SyncManager {
  active = new Map();
  connecting = new Set();
  constructor(store, browsers, adapters = { bilibili: syncBilibili, douyin: syncDouyin }) {
    this.store = store; this.browsers = browsers; this.adapters = adapters;
    this.timer = setInterval(() => this.tick(), 60000);
    this.timer.unref();
  }
  accounts() {
    return PLATFORMS.map(platform => ({
      platform, ...this.store.getSetting(`account:${platform}`, {}),
      profileExists: this.browsers.hasProfile(platform), browserOpen: this.browsers.contexts.has(platform),
      busy: this.active.has(platform) || this.connecting.has(platform),
      autoSync: this.store.getSetting(`auto:${platform}`, false),
    }));
  }
  async connect(platform) {
    if (this.active.has(platform) || this.connecting.has(platform)) throw Object.assign(new Error('该平台正在操作中，请等待完成或先停止同步。'), { status: 409 });
    this.connecting.add(platform);
    try { await this.browsers.open(platform); } finally { this.connecting.delete(platform); }
  }
  start(platform) {
    if (this.active.has(platform) || this.connecting.has(platform)) throw Object.assign(new Error('该平台已有运行中的操作。'), { status: 409 });
    const job = { id: randomUUID(), platform, status: 'running', startedAt: Date.now(), finishedAt: null, count: 0, added: 0, message: '正在打开专用浏览器…' };
    const control = { job, cancelled: false, seen: new Set() };
    this.active.set(platform, control);
    this.store.saveJob(job);
    control.promise = this.run(control);
    return job;
  }
  async run(control) {
    const { job } = control;
    const persist = () => this.store.saveJob(job);
    const check = () => { if (control.cancelled) throw new Error('同步已停止，已保存的收藏保留。'); };
    try {
      const context = await this.browsers.get(job.platform);
      check();
      const result = await this.adapters[job.platform]({ context, check,
        save: items => {
          check();
          job.added += this.store.upsert(items);
          items.forEach(v => control.seen.add(v.id));
          job.count = control.seen.size;
          persist();
        },
        progress: message => { check(); job.message = message; persist(); },
        account: value => { this.store.setSetting(`account:${job.platform}`, { ...this.store.getSetting(`account:${job.platform}`, {}), ...value }); },
      });
      check();
      job.status = result.complete ? 'success' : 'partial';
      job.message = result.message;
      if (result.complete) {
        this.store.setSetting(`account:${job.platform}`, { ...this.store.getSetting(`account:${job.platform}`, {}), lastSuccess: Date.now() });
      }
    } catch (error) {
      job.status = control.cancelled ? 'cancelled' : job.count ? 'partial' : 'error';
      // Playwright errors can contain URLs or request details; expose only our deliberately authored messages.
      job.message = control.cancelled ? '同步已停止，已保存的收藏保留。'
        : /^(B 站|抖音|尚未登录|收藏夹|单个收藏夹|未读取到|无法打开)/.test(error.message) ? error.message.slice(0, 500)
        : '浏览器或网络操作未完成。请检查专用窗口的登录/验证状态后重试。';
    } finally {
      job.finishedAt = Date.now();
      persist();
      this.active.delete(job.platform);
    }
  }
  cancel(platform) {
    const control = this.active.get(platform);
    if (control) control.cancelled = true;
    return Boolean(control);
  }
  tick() {
    for (const platform of PLATFORMS) {
      if (!this.store.getSetting(`auto:${platform}`, false) || this.active.has(platform) || this.connecting.has(platform)) continue;
      const recent = this.store.jobs().find(j => j.platform === platform);
      if (!recent || Date.now() - recent.startedAt >= 30 * 60000) this.start(platform);
    }
  }
  async close() {
    clearInterval(this.timer);
    for (const control of this.active.values()) control.cancelled = true;
    await this.browsers.closeAll();
    await Promise.all([...this.active.values()].map(c => c.promise));
  }
}
