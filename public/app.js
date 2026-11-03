const $ = selector => document.querySelector(selector);
const icons = {
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  link: '<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l3-4a4 4 0 0 0-6-6l-1 1" transform="translate(1 -1) scale(.95)"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  'hard-drive': '<rect x="3" y="12" width="18" height="8" rx="2"/><path d="m3 13 3-9h12l3 9M7 16h.01M11 16h.01"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  settings: '<path d="m9 3-1 3-3 1-2 4 2 2v4l4 3 3-1 3 1 4-3v-4l2-2-2-4-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 8a7 7 0 0 1 12-3l3 3M4 16l3 3a7 7 0 0 0 12-3"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  'arrow-right': '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  folder: '<path d="M3 7V5h6l3 3h9v12H3z"/>',
  sort: '<path d="M8 4v16m-4-4 4 4 4-4M14 5h7m-7 5h5m-5 5h3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 5H4v15h15v-6"/>',
  bilibili: '<rect x="3" y="7" width="18" height="13" rx="3"/><path d="m7 3 3 4m7-4-3 4M7 11v3m10-3v3m-8 3 3-1 3 1"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4m-4 8h4m10-8h4m-4 8h4"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.bookmark}</svg>`;
const fillIcons = (root = document) => root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const names = { bilibili: '哔哩哔哩', douyin: '抖音' };
const views = { all: '全部收藏', later: '稍后再看', watched: '已经看过' };
const statusLabels = { running: '同步中', success: '已完成', partial: '部分同步', error: '同步失败', cancelled: '已停止', interrupted: '已中断' };
const state = { token: '', view: 'all', platform: 'all', q: '', folder: '', sort: 'newest', page: 1, items: [], status: null, selected: null, pending: new Set(), signature: '', sequence: 0 };
let toastTimer;
function toast(message, error = false) {
  const el = $('#toast');
  (document.querySelector('dialog[open]') || document.body).append(el);
  el.textContent = message; el.className = `toast${error ? ' error' : ''}`; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 5500);
}
async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, { method, cache: 'no-store', headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-Vault-Token': state.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(70000) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '操作失败，请稍后重试。');
  }
  return response.json();
}
const date = timestamp => timestamp ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(timestamp) : '尚未同步';
const shortDate = timestamp => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(timestamp);
function duration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function logo(platform) { return `<span class="platform-logo ${platform}">${platform === 'bilibili' ? icon('bilibili') : '♪'}</span>`; }
function showDialog(id) {
  document.querySelectorAll('dialog[open]').forEach(el => el.close());
  $(id).showModal();
}
function renderSources() {
  if (!state.status) return;
  $('#sources').innerHTML = state.status.accounts.map(a => {
    const job = state.status.jobs.find(j => j.platform === a.platform);
    const busy = a.busy || state.pending.has(a.platform);
    const verified = Boolean(a.verifiedAt);
    const last = job?.status === 'running' ? job.message : job && ['error', 'partial', 'interrupted'].includes(job.status) ? `${statusLabels[job.status]} · 点击记录查看原因` : a.lastSuccess ? `上次完成 ${date(a.lastSuccess)}` : '连接账号，把收藏带回这里';
    return `<article class="source-card">${logo(a.platform)}<div class="source-info"><div class="source-title"><h3>${names[a.platform]}</h3><span class="source-label${verified ? ' verified' : ''}">${verified ? '曾验证' : '未验证'}</span></div><p title="${esc(last)}">${esc(last)}</p></div><div class="source-buttons"><button class="text-button" data-action="connect" data-platform="${a.platform}" ${busy ? 'disabled' : ''}>${a.profileExists ? '登录 / 连接' : '连接账号'} ${icon('arrow-right')}</button>${job?.status === 'running' ? `<button class="text-button source-cancel spinning" data-action="history">${icon('refresh')} 查看进度</button>` : a.profileExists ? `<button class="text-button" data-action="sync" data-platform="${a.platform}" ${busy ? 'disabled' : ''}>${icon('refresh')} 同步</button>` : ''}</div></article>`;
  }).join('');
  const running = state.status.jobs.some(j => j.status === 'running');
  $('#activity-dot').hidden = !running;
  $('#sync-all').classList.toggle('spinning', running);
  $('#sync-all').disabled = running;
}
function renderStats() {
  const { stats, accounts } = state.status;
  for (const [id, value] of Object.entries({ '#count-all': stats.total, '#count-later': stats.later, '#count-watched': stats.watched, '#stat-total': stats.total, '#stat-later': stats.later })) $(id).textContent = Number(value).toLocaleString();
  $('#stat-platforms').innerHTML = `${accounts.filter(a => a.verifiedAt).length}<span class="stat-denominator"> / 2</span>`;
  const folder = $('#folder');
  const next = `<option value="">全部收藏夹</option>${stats.folders.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}`;
  if (folder.innerHTML !== next) { folder.innerHTML = next; folder.value = state.folder; }
}
function renderSettings() {
  if (!state.status) return;
  $('#settings-accounts').innerHTML = state.status.accounts.map(a => {
    const busy = a.busy || state.pending.has(a.platform);
    return `<section class="settings-account"><div class="settings-account-header">${logo(a.platform)}<div><h3>${names[a.platform]}</h3><p>${a.verifiedAt ? `${esc(a.name)} · 上次验证 ${date(a.verifiedAt)}` : '尚未验证登录 · 同步时检查真实登录状态'}</p></div></div><div class="settings-actions"><button class="button primary small" data-action="connect" data-platform="${a.platform}" ${busy ? 'disabled' : ''}>${icon('external')} 登录 / 连接</button><button class="button secondary small" data-action="sync" data-platform="${a.platform}" ${busy ? 'disabled' : ''}>${icon('refresh')} 开始同步</button>${a.busy ? `<button class="button secondary small" data-action="history">查看进度</button>` : ''}</div><label class="auto-toggle"><input type="checkbox" data-auto="${a.platform}" ${a.autoSync ? 'checked' : ''}>每 30 分钟自动同步（服务运行期间）</label></section>`;
  }).join('');
}
function renderHistory() {
  const jobs = state.status?.jobs || [];
  $('#history-list').innerHTML = jobs.length ? jobs.map(j => `<article class="job"><div class="job-heading"><div><strong>${names[j.platform]}</strong><span class="job-status ${esc(j.status)}">${statusLabels[j.status] || '未知'}</span></div><span class="job-date">${date(j.startedAt)}</span></div><p>${esc(j.message)}</p><div class="job-metrics"><span>读取 ${j.count} 条 · 新增 ${j.added} 条</span>${j.status === 'running' ? `<button class="text-button" data-action="cancel" data-platform="${j.platform}">停止本次同步</button>` : `<span>${j.finishedAt ? `${Math.max(1, Math.round((j.finishedAt - j.startedAt) / 1000))} 秒` : ''}</span>`}</div></article>`).join('') : `<div class="history-empty">${icon('activity')}<p>还没有同步记录。连接一个来源，开始第一次同步。</p></div>`;
}
async function refreshStatus() {
  state.status = await api('/status');
  $('#offline').hidden = true;
  renderStats(); renderSources();
  if ($('#history-dialog').open) renderHistory();
  const signature = JSON.stringify([state.status.stats, state.status.jobs.map(j => [j.id, j.status, j.count, j.added])]);
  if (state.signature && state.signature !== signature) await loadVideos();
  state.signature = signature;
}
function activeFilters() { return state.q || state.folder || state.platform !== 'all' || state.view !== 'all'; }
function renderVideos(data) {
  state.items = data.items; state.page = data.page;
  $('#library-count').textContent = `${data.total.toLocaleString()} 个视频`;
  $('#reset-filters').hidden = !activeFilters();
  const grid = $('#video-grid');
  if (!data.items.length) {
    const filtered = activeFilters();
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon(filtered ? 'search' : 'bookmark')}</div><h3>${filtered ? '这里还没有匹配的收藏' : '给你的好内容，安一个家'}</h3><p>${filtered ? '试试别的关键词，或切换来源和收藏分类。' : '连接你的第一个账号。那些收藏时的灵光一现，很快就会在这里重逢。'}</p><button class="button primary" data-action="${filtered ? 'reset' : 'settings'}">${icon(filtered ? 'refresh' : 'link')}${filtered ? '清除筛选，看看全部' : '连接第一个来源'}</button>${filtered ? '' : '<div class="onboard-steps"><span><b>1</b>连接平台账号</span><span><b>2</b>同步真实收藏</span><span><b>3</b>随时回来再看</span></div>'}</div>`;
  } else {
    grid.innerHTML = data.items.map(v => `<article class="video-card" data-id="${esc(v.id)}"><button class="thumbnail ${v.platform}" data-action="play" data-id="${esc(v.id)}" aria-label="播放 ${esc(v.title)}">${v.cover ? `<img src="${esc(v.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="thumb-fallback">${icon('film')}<span>KEEP THE GOOD STUFF</span></span>`}<span class="platform-badge"><i class="platform-dot ${v.platform === 'bilibili' ? 'bili' : 'douyin'}"></i>${names[v.platform]}</span><span class="play-overlay">${icon('play')}</span>${v.duration ? `<span class="duration">${duration(v.duration)}</span>` : ''}${v.watched ? '<span class="watched-badge">已看过</span>' : ''}</button><div class="card-content"><button class="card-title" data-action="play" data-id="${esc(v.id)}">${esc(v.title)}</button><p class="card-author">${esc(v.author)}</p><div class="card-tags">${[...v.tags, ...v.folders].slice(0, 3).map(t => `<span class="card-tag" title="${esc(t)}">${esc(t)}</span>`).join('')}</div><div class="card-footer"><span>${shortDate(v.savedAt)}</span><div class="card-tools"><button class="icon-button ${v.starred ? 'selected' : ''}" data-action="star" data-id="${esc(v.id)}" aria-label="${v.starred ? '移出稍后再看' : '加入稍后再看'}" aria-pressed="${v.starred}">${icon('clock')}</button><button class="icon-button ${v.watched ? 'selected' : ''}" data-action="watch" data-id="${esc(v.id)}" aria-label="${v.watched ? '标记为未看' : '标记为已看'}" aria-pressed="${v.watched}">${icon('check-circle')}</button><a class="icon-button" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer" aria-label="在原平台打开">${icon('external')}</a></div></div></div></article>`).join('');
    grid.querySelectorAll('img').forEach(image => { image.addEventListener('error', () => { image.replaceWith(Object.assign(document.createElement('span'), { className: 'thumb-fallback', innerHTML: `${icon('film')}<span>封面暂不可用</span>` })); }, { once: true }); });
  }
  $('#pagination').hidden = data.pages <= 1;
  $('#pagination').innerHTML = `<button data-action="page" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>上一页</button><span>${data.page} / ${data.pages}</span><button data-action="page" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>下一页</button>`;
}
async function loadVideos() {
  const sequence = ++state.sequence;
  const params = new URLSearchParams({ q: state.q, view: state.view, platform: state.platform, folder: state.folder, sort: state.sort, page: state.page, limit: 24 });
  const data = await api(`/videos?${params}`);
  if (sequence === state.sequence) renderVideos(data);
}
function renderPlayerActions() {
  const v = state.selected;
  if (!v) return;
  $('#player-actions').innerHTML = `<a class="button primary" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">${icon('external')}去原平台播放</a><button class="button secondary" data-action="star" data-id="${esc(v.id)}">${icon('clock')}${v.starred ? '移出稍后再看' : '稍后再看'}</button><button class="button secondary" data-action="watch" data-id="${esc(v.id)}">${icon('check-circle')}${v.watched ? '标记为未看' : '标记为已看'}</button>`;
}
function openPlayer(id) {
  const v = state.items.find(item => item.id === id);
  if (!v) return;
  state.selected = v;
  $('#player-platform').textContent = `${names[v.platform]} · 官方嵌入播放器`;
  $('#player-title').textContent = v.title;
  $('#player-author').textContent = `${v.author} · 收藏于 ${shortDate(v.savedAt)}`;
  $('#player-notice').textContent = v.platform === 'douyin' ? '抖音嵌入播放受平台、作品权限及浏览器限制。若空白或无法播放，请用下方按钮前往原平台。' : '使用 B 站官方播放器。若需要登录、视频失效或播放受限，请前往原平台。不会自动标记为已看。';
  const iframe = document.createElement('iframe');
  const parameter = v.externalId.startsWith('BV') ? `bvid=${encodeURIComponent(v.externalId)}` : `aid=${encodeURIComponent(v.externalId.replace(/^av/, ''))}`;
  iframe.src = v.platform === 'bilibili' ? `https://player.bilibili.com/player.html?${parameter}&autoplay=0&high_quality=1` : `https://open.douyin.com/player/video?vid=${encodeURIComponent(v.externalId)}&autoplay=0`;
  iframe.title = `${names[v.platform]}官方播放器`;
  iframe.allow = 'fullscreen; picture-in-picture; encrypted-media';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation');
  iframe.allowFullscreen = true;
  $('#player-frame').replaceChildren(iframe);
  $('#tag-input').value = v.tags.join('，');
  renderPlayerActions(); showDialog('#player-dialog');
}
async function updateVideo(id, patch) {
  const video = await api(`/videos/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
  if (state.selected?.id === id) { state.selected = video; renderPlayerActions(); }
  await refreshStatus(); await loadVideos();
}
function updateNavigation() {
  $('#breadcrumb-title').textContent = views[state.view]; $('#library-title').textContent = views[state.view];
  document.querySelectorAll('[data-action="view"]').forEach(el => { el.classList.toggle('active', el.dataset.view === state.view); if (el.dataset.view === state.view) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  document.querySelectorAll('[data-action="platform"]').forEach(el => { el.classList.toggle('active', el.dataset.platform === state.platform); el.setAttribute('aria-pressed', String(el.dataset.platform === state.platform)); });
}
async function startSync(platform) {
  await api(`/accounts/${platform}/sync`, { method: 'POST', body: {} });
  await refreshStatus(); renderHistory(); showDialog('#history-dialog');
}
async function handleAction(button) {
  const { action, platform, id } = button.dataset;
  switch (action) {
    case 'view': state.view = button.dataset.view; state.page = 1; updateNavigation(); await loadVideos(); break;
    case 'platform': state.platform = platform; state.page = 1; updateNavigation(); await loadVideos(); break;
    case 'reset': Object.assign(state, { q: '', folder: '', platform: 'all', view: 'all', page: 1 }); $('#search').value = ''; $('#folder').value = ''; updateNavigation(); await loadVideos(); break;
    case 'settings': renderSettings(); showDialog('#settings-dialog'); break;
    case 'history': renderHistory(); showDialog('#history-dialog'); break;
    case 'close': button.closest('dialog').close(); break;
    case 'export': {
      const data = await api('/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `拾影收藏-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('收藏清单已导出，不含 Cookie 或登录信息。'); break;
    }
    case 'connect':
      if (state.pending.has(platform)) return;
      state.pending.add(platform); renderSources(); renderSettings(); toast('正在打开专用浏览器，请在平台窗口登录…');
      try { const result = await api(`/accounts/${platform}/connect`, { method: 'POST', body: {} }); toast(result.message); }
      finally { state.pending.delete(platform); await refreshStatus(); renderSettings(); }
      break;
    case 'sync': await startSync(platform); break;
    case 'sync-all': {
      const targets = state.status?.accounts.filter(a => a.profileExists && !a.busy) || [];
      if (!targets.length) { renderSettings(); showDialog('#settings-dialog'); toast('先连接一个来源，在专用窗口登录后再同步。'); break; }
      for (const a of targets) await api(`/accounts/${a.platform}/sync`, { method: 'POST', body: {} });
      await refreshStatus(); renderHistory(); showDialog('#history-dialog'); break;
    }
    case 'cancel': await api(`/accounts/${platform}/cancel`, { method: 'POST', body: {} }); toast('正在停止，当前请求结束后生效。已保存的收藏保留。'); break;
    case 'play': openPlayer(id); break;
    case 'star': case 'watch': {
      const v = state.selected?.id === id ? state.selected : state.items.find(item => item.id === id);
      if (!v) return;
      await updateVideo(id, action === 'star' ? { starred: !v.starred } : { watched: !v.watched });
      toast(action === 'star' ? v.starred ? '已移出稍后再看。' : '已加入稍后再看。' : v.watched ? '已标记为未看。' : '已标记为看过。'); break;
    }
    case 'page': state.page = Number(button.dataset.page); await loadVideos(); $('#library').scrollIntoView({ behavior: 'smooth' }); break;
  }
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  handleAction(button).catch(error => toast(error.message, true));
});
document.addEventListener('change', async event => {
  const el = event.target;
  try {
    if (el.dataset.auto) {
      const checked = el.checked; el.disabled = true;
      try { await api(`/accounts/${el.dataset.auto}/settings`, { method: 'PATCH', body: { autoSync: checked } }); toast(checked ? '已开启，每 30 分钟尝试同步一次。' : '已关闭定时同步。'); }
      catch (error) { el.checked = !checked; throw error; }
      finally { el.disabled = false; }
      await refreshStatus();
    }
    if (el.id === 'folder' || el.id === 'sort') { state[el.id] = el.value; state.page = 1; await loadVideos(); }
  } catch (error) { toast(error.message, true); }
});
let searchTimer;
$('#search').addEventListener('input', event => { state.q = event.target.value; state.page = 1; clearTimeout(searchTimer); searchTimer = setTimeout(() => loadVideos().catch(error => toast(error.message, true)), 220); });
$('#tag-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!state.selected) return;
  const tags = [...new Set($('#tag-input').value.split(/[,，]/).map(t => t.trim()).filter(Boolean))];
  try { await updateVideo(state.selected.id, { tags }); toast('标签已保存。'); } catch (error) { toast(error.message, true); }
});
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => {
    if (dialog.id === 'player-dialog') { $('#player-frame').replaceChildren(); state.selected = null; }
    if (dialog.contains($('#toast'))) { $('#toast').hidden = true; document.body.append($('#toast')); }
  });
}
document.addEventListener('keydown', event => { if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#search').focus(); } });
fillIcons();
async function poll() {
  try { await refreshStatus(); } catch { $('#offline').hidden = false; }
  setTimeout(poll, state.status?.jobs.some(j => j.status === 'running') ? 1800 : 6500);
}
try {
  const session = await api('/session'); state.token = session.token;
  await refreshStatus(); await loadVideos(); setTimeout(poll, 4000);
} catch (error) {
  $('#offline').hidden = false;
  $('#video-grid').innerHTML = '<div class="empty-state"><h3>暂时连接不到片库</h3><p>请确认本地服务已启动，然后刷新页面。</p></div>';
  toast(error.message, true);
}
