import { biliVideo } from './normalize.js';

export async function biliRequest(context, endpoint, params = {}) {
  const url = new URL(endpoint, 'https://api.bilibili.com');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let response;
  try {
    response = await context.request.get(url.href, { headers: { Referer: 'https://www.bilibili.com/' }, timeout: 20000, maxRedirects: 0 });
  } catch { throw new Error('B 站请求超时或网络不可用，请稍后重试。'); }
  try {
    if (!response.ok()) throw new Error(`B 站返回 HTTP ${response.status()}，请在登录窗口完成验证后重试。`);
    let body;
    try { body = await response.json(); } catch { throw new Error('B 站返回了非 JSON 内容，可能需要登录验证。'); }
    if (body.code !== 0) throw new Error(`B 站接口错误（${Number(body.code) || '未知'}），请检查登录状态或稍后重试。`);
    return body.data;
  } finally { await response.dispose(); }
}

export async function syncBilibili({ context, save, progress, check, account, request = biliRequest, pause = ms => new Promise(r => setTimeout(r, ms)) }) {
  check();
  const user = await request(context, '/x/web-interface/nav');
  if (!user?.isLogin || !user.mid) throw new Error('尚未登录 B 站，请先点击“登录 / 连接”，在专用窗口完成登录。');
  account({ name: user.uname || 'B 站用户', verifiedAt: Date.now() });
  const result = await request(context, '/x/v3/fav/folder/created/list-all', { up_mid: user.mid });
  if (!result || !(Array.isArray(result.list) || (result.count === 0 && result.list == null))) throw new Error('B 站收藏夹格式已变化，无法确认是否完整。');
  const folders = result.list || [];
  if (Number.isFinite(result.count) && result.count !== folders.length) throw new Error('B 站未返回全部收藏夹，未报告完整同步。');
  let skipped = 0;
  for (const [index, folder] of folders.entries()) {
    if (!folder.id) throw new Error('收藏夹缺少 ID，请稍后重试。');
    const signatures = new Set();
    for (let pn = 1; pn <= 1000; pn++) {
      check();
      progress(`读取收藏夹 ${index + 1}/${folders.length}「${String(folder.title).slice(0, 100)}」· 第 ${pn} 页`);
      const data = await request(context, '/x/v3/fav/resource/list', { media_id: folder.id, pn, ps: 20, platform: 'web', order: 'mtime', type: 0, tid: 0 });
      if (!data || ![true, false, 0, 1].includes(data.has_more) || !(Array.isArray(data.medias) || (data.medias == null && !data.has_more && data.info?.media_count === 0))) throw new Error('B 站收藏分页格式异常，已读取的内容保留。');
      const medias = data.medias || [];
      if (medias.length) {
        const signature = medias.map(m => m.bvid || m.id).join(',');
        if (signatures.has(signature)) throw new Error('B 站重复返回同一页，已停止以避免无限请求。');
        signatures.add(signature);
      } else if (data.has_more) throw new Error('B 站返回空页但提示仍有内容，请稍后重试。');
      const videos = medias.map(m => biliVideo(m, folder.title));
      skipped += videos.filter(v => !v).length;
      save(videos.filter(Boolean));
      if (!data.has_more) break;
      if (pn === 1000) throw new Error('单个收藏夹超过本次 20,000 条上限，已保存本次读取结果。');
      await pause(500);
    }
    await pause(400);
  }
  return { complete: true, message: `已读取全部 ${folders.length} 个自建收藏夹${skipped ? `；跳过 ${skipped} 条非视频/无法识别的条目` : ''}。不含订阅收藏夹。` };
}
