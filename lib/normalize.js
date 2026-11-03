export const PLATFORMS = ['bilibili', 'douyin'];
export const text = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export function timestamp(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n > 1e12 ? n : n * 1000) : null;
}
export function coverUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const u = new URL(value.startsWith('//') ? `https:${value}` : value);
    const domains = ['hdslb.com', 'bilibili.com', 'douyinpic.com', 'byteimg.com', 'pstatp.com', 'ibytedtos.com', 'douyincdn.com', 'bytecdn.cn'];
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && domains.some(d => u.hostname === d || u.hostname.endsWith(`.${d}`)) ? u.href.replace(/^http:/, 'https:') : '';
  } catch { return ''; }
}
export function biliVideo(item, folder) {
  if (!item || (item.type != null && Number(item.type) !== 2)) return null;
  const bv = text(item.bvid || item.bv_id, 40);
  const av = String(item.id ?? '');
  const externalId = /^BV[a-zA-Z0-9]{10}$/.test(bv) ? bv : /^\d+$/.test(av) && av !== '0' ? `av${av}` : '';
  if (!externalId) return null;
  return {
    id: `bilibili:${externalId}`, platform: 'bilibili', externalId,
    title: text(item.title) || '已失效或未命名的视频', author: text(item.upper?.name, 100) || '未知作者',
    cover: coverUrl(item.cover), url: `https://www.bilibili.com/video/${externalId}`,
    duration: Math.max(0, Number(item.duration) || 0), publishedAt: timestamp(item.pubtime),
    savedAt: timestamp(item.fav_time), folders: [text(folder, 100) || '默认收藏夹'],
  };
}
export function douyinVideo(item) {
  if (!item || (typeof item.aweme_id === 'number' && !Number.isSafeInteger(item.aweme_id))) return null;
  const externalId = String(item.aweme_id ?? '');
  if (!/^\d{5,30}$/.test(externalId)) return null;
  const v = item.video || {};
  return {
    id: `douyin:${externalId}`, platform: 'douyin', externalId,
    title: text(item.desc) || '未命名的抖音作品', author: text(item.author?.nickname, 100) || '未知作者',
    cover: coverUrl(v.cover?.url_list?.[0] || v.origin_cover?.url_list?.[0] || item.images?.[0]?.url_list?.[0]),
    url: `https://www.douyin.com/video/${externalId}`, duration: Math.max(0, Math.floor((Number(v.duration) || 0) / 1000)),
    publishedAt: timestamp(item.create_time), savedAt: timestamp(item.collect_time), folders: ['抖音收藏'],
  };
}
export function collectionCursor(request) {
  try {
    const url = new URL(request.url());
    const post = request.postData() || '';
    const body = post.startsWith('{') ? JSON.parse(post) : Object.fromEntries(new URLSearchParams(post));
    const value = body.cursor ?? body.max_cursor ?? url.searchParams.get('cursor') ?? url.searchParams.get('max_cursor');
    return value == null ? null : String(value);
  } catch { return null; }
}
// Completeness is proven by a contiguous chain starting at cursor zero, not by an idle scroll.
export class CollectionTracker {
  pages = new Map();
  items = new Map();
  responses = 0;
  skipped = 0;
  add(payload, cursor) {
    if (payload?.status_code !== 0 || !Array.isArray(payload.aweme_list)) throw new Error('抖音未返回有效收藏列表，请完成登录/验证后重试。');
    if (![0, 1, false, true].includes(payload.has_more)) throw new Error('抖音分页格式已变化，无法确认同步完整性。');
    this.responses++;
    for (const raw of payload.aweme_list) {
      const item = douyinVideo(raw);
      if (item) this.items.set(item.id, item); else this.skipped++;
    }
    if (cursor != null) this.pages.set(String(cursor), { more: Boolean(payload.has_more), next: String(payload.cursor ?? payload.max_cursor ?? '') });
  }
  get complete() {
    let cursor = '0';
    const visited = new Set();
    while (this.pages.has(cursor) && !visited.has(cursor)) {
      visited.add(cursor);
      const page = this.pages.get(cursor);
      if (!page.more) return true;
      cursor = page.next;
    }
    return false;
  }
}
