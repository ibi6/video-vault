import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORMS } from './normalize.js';

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'vault.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY, platform TEXT NOT NULL, external_id TEXT NOT NULL,
        title TEXT NOT NULL, author TEXT NOT NULL, cover TEXT NOT NULL, url TEXT NOT NULL,
        duration REAL NOT NULL, published_at INTEGER, saved_at INTEGER NOT NULL,
        folders TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', starred INTEGER NOT NULL DEFAULT 0,
        watched INTEGER NOT NULL DEFAULT 0, first_seen INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS videos_saved ON videos(saved_at DESC);
      CREATE INDEX IF NOT EXISTS videos_platform ON videos(platform);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
    for (const job of this.jobs()) if (job.status === 'running') this.saveJob({ ...job, status: 'interrupted', message: '上次运行中断，已保存的数据仍保留，请重新同步。', finishedAt: Date.now() });
  }
  close() { this.db.close(); }
  getSetting(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  setSetting(key, value) {
    this.db.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }
  upsert(items) {
    let added = 0;
    const get = this.db.prepare('SELECT folders FROM videos WHERE id=?');
    const insert = this.db.prepare(`INSERT INTO videos(id,platform,external_id,title,author,cover,url,duration,published_at,saved_at,folders,first_seen,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,author=excluded.author,
      cover=excluded.cover,url=excluded.url,duration=excluded.duration,published_at=excluded.published_at,
      folders=excluded.folders,updated_at=excluded.updated_at`);
    this.db.exec('BEGIN');
    try {
      for (const v of items) {
        const previous = get.get(v.id);
        const folders = [...new Set([...(previous ? JSON.parse(previous.folders) : []), ...v.folders])];
        const now = Date.now();
        insert.run(v.id, v.platform, v.externalId, v.title, v.author, v.cover, v.url, v.duration, v.publishedAt, v.savedAt || now, JSON.stringify(folders), now, now);
        if (!previous) added++;
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return added;
  }
  map(row) {
    if (!row) return null;
    return { id: row.id, platform: row.platform, externalId: row.external_id, title: row.title, author: row.author,
      cover: row.cover, url: row.url, duration: row.duration, publishedAt: row.published_at, savedAt: row.saved_at,
      folders: JSON.parse(row.folders), tags: JSON.parse(row.tags), starred: Boolean(row.starred), watched: Boolean(row.watched), firstSeen: row.first_seen };
  }
  getVideo(id) { return this.map(this.db.prepare('SELECT * FROM videos WHERE id=?').get(id)); }
  list({ q = '', platform = '', view = '', folder = '', sort = 'newest', page = 1, limit = 24 } = {}) {
    const conditions = []; const args = [];
    if (PLATFORMS.includes(platform)) { conditions.push('platform=?'); args.push(platform); }
    if (view === 'later') conditions.push('starred=1 AND watched=0');
    if (view === 'watched') conditions.push('watched=1');
    if (view === 'unwatched') conditions.push('watched=0');
    if (q.trim()) {
      conditions.push('(title LIKE ? ESCAPE \'\\\' OR author LIKE ? ESCAPE \'\\\' OR tags LIKE ? ESCAPE \'\\\')');
      const search = `%${q.trim().slice(0, 200).replace(/[\\%_]/g, '\\$&')}%`; args.push(search, search, search);
    }
    if (folder) { conditions.push('EXISTS (SELECT 1 FROM json_each(videos.folders) WHERE value=?)'); args.push(folder); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT count(*) AS n FROM videos ${where}`).get(...args).n;
    limit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 24)));
    page = Math.max(1, Math.min(Math.ceil(total / limit) || 1, Math.floor(Number(page) || 1)));
    const orders = { newest: 'saved_at DESC, id', oldest: 'saved_at ASC, id', title: 'title COLLATE NOCASE, id' };
    const items = this.db.prepare(`SELECT * FROM videos ${where} ORDER BY ${orders[sort] || orders.newest} LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit).map(row => this.map(row));
    return { items, total, page, pages: Math.ceil(total / limit), limit };
  }
  stats() {
    const row = this.db.prepare(`SELECT count(*) AS total, COALESCE(sum(platform='bilibili'),0) AS bilibili,
      COALESCE(sum(platform='douyin'),0) AS douyin, COALESCE(sum(starred=1 AND watched=0),0) AS later,
      COALESCE(sum(watched=1),0) AS watched FROM videos`).get();
    return { ...row, folders: this.db.prepare('SELECT DISTINCT value AS name FROM videos, json_each(videos.folders) ORDER BY name').all().map(v => v.name) };
  }
  updateVideo(id, patch) {
    const video = this.getVideo(id);
    if (!video) return null;
    const tags = patch.tags ?? video.tags;
    this.db.prepare('UPDATE videos SET starred=?,watched=?,tags=? WHERE id=?').run(Number(patch.starred ?? video.starred), Number(patch.watched ?? video.watched), JSON.stringify(tags), id);
    return this.getVideo(id);
  }
  export() { return this.db.prepare('SELECT * FROM videos ORDER BY saved_at DESC').all().map(row => this.map(row)); }
  saveJob(job) {
    this.db.prepare('INSERT INTO jobs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id, JSON.stringify(job));
    this.db.exec('DELETE FROM jobs WHERE rowid NOT IN (SELECT rowid FROM jobs ORDER BY rowid DESC LIMIT 50)');
  }
  jobs() { return this.db.prepare('SELECT data FROM jobs ORDER BY rowid DESC LIMIT 50').all().map(row => JSON.parse(row.data)); }
}
