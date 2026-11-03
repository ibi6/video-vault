import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Store } from './lib/store.js';
import { BrowserManager } from './lib/browser.js';
import { SyncManager } from './lib/sync.js';
import { PLATFORMS } from './lib/normalize.js';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export function createApp({ dataDir = process.env.VAULT_DATA_DIR || join(ROOT, 'data'), store = new Store(dataDir), browsers = new BrowserManager(dataDir), sync = new SyncManager(store, browsers) } = {}) {
  const app = express();
  const token = randomBytes(32).toString('hex');
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const port = req.socket.localPort;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(req.headers.host)) return res.status(403).json({ error: '仅允许本机访问。' });
    if (req.headers.origin && !hosts.map(h => `http://${h}`).includes(req.headers.origin)) return res.status(403).json({ error: '拒绝跨站请求。' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: '拒绝跨站请求。' });
    res.set({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; frame-src https://player.bilibili.com https://open.douyin.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    });
    if (req.path.startsWith('/api/')) {
      res.set('Cache-Control', 'no-store');
      if (!['GET', 'HEAD'].includes(req.method)) {
        const supplied = Buffer.from(req.headers['x-vault-token'] || '');
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(403).json({ error: '安全令牌失效，请刷新页面。' });
        if (!req.is('application/json')) return res.status(415).json({ error: '请求必须为 JSON。' });
      }
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/session', (_req, res) => res.json({ token, name: '拾影', version: '1.0.0' }));
  app.get('/api/status', (_req, res) => res.json({ accounts: sync.accounts(), jobs: store.jobs(), stats: store.stats() }));
  app.get('/api/videos', (req, res) => {
    const params = {};
    for (const key of ['q', 'platform', 'view', 'folder', 'sort', 'page', 'limit']) if (typeof req.query[key] === 'string') params[key] = req.query[key];
    res.json(store.list(params));
  });
  app.patch('/api/videos/:id', (req, res) => {
    const body = req.body;
    if (!body || Array.isArray(body) || Object.keys(body).some(k => !['starred', 'watched', 'tags'].includes(k))) return res.status(400).json({ error: '不支持的收藏属性。' });
    for (const field of ['starred', 'watched']) if (field in body && typeof body[field] !== 'boolean') return res.status(400).json({ error: '标记必须为布尔值。' });
    if ('tags' in body && (!Array.isArray(body.tags) || body.tags.length > 12 || body.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 30))) return res.status(400).json({ error: '最多 12 个标签，每个标签 1–30 字。' });
    if (body.tags) body.tags = [...new Set(body.tags.map(t => t.trim()))];
    const video = store.updateVideo(req.params.id, body);
    if (!video) return res.status(404).json({ error: '收藏不存在。' });
    res.json(video);
  });
  app.param('platform', (req, res, next, value) => {
    if (!PLATFORMS.includes(value)) return res.status(400).json({ error: '不支持的平台。' });
    next();
  });
  app.post('/api/accounts/:platform/connect', async (req, res) => {
    try { await sync.connect(req.params.platform); res.json({ message: '专用窗口已打开，请在平台页面登录，然后回到这里同步。' }); }
    catch (error) { res.status(error.status || 502).json({ error: error.status ? error.message : '打开平台窗口失败，请检查浏览器安装或网络后重试。' }); }
  });
  app.post('/api/accounts/:platform/sync', (req, res) => res.status(202).json(sync.start(req.params.platform)));
  app.post('/api/accounts/:platform/cancel', (req, res) => res.json({ cancelled: sync.cancel(req.params.platform) }));
  app.patch('/api/accounts/:platform/settings', (req, res) => {
    if (typeof req.body?.autoSync !== 'boolean') return res.status(400).json({ error: 'autoSync 必须为布尔值。' });
    store.setSetting(`auto:${req.params.platform}`, req.body.autoSync);
    res.json({ autoSync: req.body.autoSync });
  });
  app.get('/api/export', (_req, res) => {
    res.set('Content-Disposition', 'attachment; filename="video-vault-export.json"');
    res.json({ version: 1, exportedAt: new Date().toISOString(), videos: store.export() });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));
  app.use(express.static(join(ROOT, 'public'), { etag: true, maxAge: 0 }));
  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    res.status(status).json({ error: status === 409 ? error.message : status === 413 ? '请求内容过大。' : status === 400 ? '请求格式错误。' : '操作失败，请稍后重试。' });
  });
  return { app, store, sync, browsers, async close() { await sync.close(); store.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1–65535。');
  const instance = createApp();
  const server = instance.app.listen(port, '127.0.0.1', () => console.log(`拾影 Video Vault → http://127.0.0.1:${port}\n数据目录：${resolve(process.env.VAULT_DATA_DIR || join(ROOT, 'data'))}\n仅供本机个人使用；按 Ctrl+C 停止。`));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 被占用，可设置 PORT 后重试。` : '服务启动失败。'); instance.close().finally(() => process.exit(1)); });
  let closing = false;
  const shutdown = async () => {
    if (closing) return; closing = true;
    server.close();
    const timeout = setTimeout(() => process.exit(1), 10000); timeout.unref();
    await instance.close();
    clearTimeout(timeout);
    process.exit(0);
  };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
