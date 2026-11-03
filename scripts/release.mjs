import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'scripts/release-manifest.json';
const rootFiles = new Set(['.gitignore', '.gitattributes', 'README.md', 'SECURITY.md', 'package.json', 'package-lock.json', 'server.js', '打开拾影.bat']);
const privateParts = /(?:^|\/)(?:data|browser-profiles|research|artifacts|exports|logs|backups|node_modules|dist|coverage|\.git|\.vscode|\.idea)(?:\/|$)/i;
const privateNames = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|credentials[^/]*|cookies[^/]*|storage-?state[^/]*|auth\.json|Login Data(?:-journal)?|Local State|video-vault-export[^/]*|拾影收藏-[^/]*)(?:$|\/)|\.(?:sqlite[^/]*|db(?:-[^/]*)?|pem|key|p12|pfx|har|jsonl|log|zip|tar|tgz|bak|tmp)$/i;
const textExtensions = /\.(?:js|mjs|json|md|css|html|svg|ya?ml|bat)$/i;
const MAX_BYTES = 2 * 1024 * 1024;

export function pathAllowed(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.startsWith('/') || path.includes(':') || path.split('/').some(p => !p || p === '.' || p === '..')) return false;
  if (privateParts.test(path) || privateNames.test(path)) return false;
  return rootFiles.has(path) || (/^(?:lib|public|scripts|tests|docs|\.github\/workflows)\//.test(path) && textExtensions.test(path));
}

// Heuristics only: report location/type, never print matching secret values.
const patterns = [
  ['private-key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ['service-token', /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16})\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g],
  ['cookie-value', /\b(?:SESSDATA|bili_jct|DedeUserID|sessionid(?:_ss)?|sid_tt|sid_guard|passport_csrf_token)\s*=\s*["']?[^\s;"']{6,}/gi],
  ['literal-credential', /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|_authToken)["']?\s*[:=]\s*["'][^\s"']{8,}["']/gi],
  ['url-credentials', /https?:\/\/[^\s/:@]+:[^\s/@]+@/gi],
  ['authorization-header', /\b(?:Bearer|Basic)\s+[A-Za-z0-9+\/_=-]{20,}/g],
  ['browser-storage-export', /["']cookies["']\s*:\s*\[/g],
  ['personal-directory', /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+|\/(?:Users|home)\/[^/\s"']+\//g],
  ['email-address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
];

export function inspectContent(path, bytes) {
  if (bytes.length > MAX_BYTES) return [{ path, kind: 'oversized-file' }];
  if (bytes.includes(0)) return [{ path, kind: 'binary-file' }];
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return [{ path, kind: 'non-utf8-file' }]; }
  const findings = [];
  for (const [kind, pattern] of patterns) {
    for (const match of content.matchAll(new RegExp(pattern.source, pattern.flags))) {
      // Reserved documentation email domains, not real account addresses.
      if (kind === 'email-address' && /@(?:example\.(?:com|org|net))$/i.test(match[0])) continue;
      findings.push({ path, kind, line: content.slice(0, match.index).split('\n').length });
    }
  }
  return findings;
}

function git(root, args, allowFailure = false) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: null, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if ((result.error || result.status !== 0) && !allowFailure) throw new Error(`Git 操作失败：${args[0]}。请检查仓库状态（不会打印潜在敏感输出）。`);
  return result;
}
function repository(root) {
  const result = git(root, ['rev-parse', '--show-toplevel'], true);
  if (result.error || result.status !== 0) {
    if (existsSync(join(root, '.git'))) throw new Error('仓库存在但不可读取，请检查 Git 安装或目录权限。');
    return false;
  }
  if (resolve(result.stdout.toString().trim()) !== resolve(root)) throw new Error('源码目录必须是独立 Git 仓库，不能使用上级目录的仓库。');
  return true;
}
function manifest(root) {
  const paths = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
  if (!Array.isArray(paths) || paths.some(p => !pathAllowed(p)) || new Set(paths).size !== paths.length || !paths.includes(MANIFEST)) throw new Error('发布白名单有重复项、缺少清单自身或包含不允许的路径。');
  return paths;
}
function safeRead(root, path) {
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`拒绝发布符号链接：${path}`);
  }
  if (!lstatSync(current).isFile()) throw new Error(`发布条目不是普通文件：${path}`);
  return readFileSync(current);
}
function indexEntries(root) {
  return git(root, ['ls-files', '--stage', '-z']).stdout.toString().split('\0').filter(Boolean).map(entry => {
    const tab = entry.indexOf('\t');
    const [mode, hash, stage] = entry.slice(0, tab).split(' ');
    return { mode, hash, stage, path: entry.slice(tab + 1) };
  });
}
export function checkRelease(root = ROOT) {
  const paths = manifest(root);
  const allowed = new Set(paths);
  const findings = [];
  for (const path of paths) findings.push(...inspectContent(path, safeRead(root, path)));
  const hasGit = repository(root);
  const entries = hasGit ? indexEntries(root) : [];
  for (const entry of entries) {
    if (!allowed.has(entry.path) || !pathAllowed(entry.path)) { findings.push({ path: entry.path, kind: 'not-in-release-manifest' }); continue; }
    if (!['100644', '100755'].includes(entry.mode) || entry.stage !== '0') { findings.push({ path: entry.path, kind: 'unsafe-index-entry' }); continue; }
    const bytes = git(root, ['cat-file', 'blob', entry.hash]).stdout;
    findings.push(...inspectContent(entry.path, bytes).map(f => ({ ...f, kind: `index:${f.kind}` })));
  }
  return { paths, entries, hasGit, findings };
}
function requireClean(report) {
  if (report.findings.length) {
    for (const f of report.findings) console.error(`${f.path}${f.line ? `:${f.line}` : ''} [${f.kind}]`);
    throw new Error(`发布检查失败：${report.findings.length} 个待处理项。敏感值未输出。`);
  }
}
export function stageRelease(root = ROOT) {
  const report = checkRelease(root); requireClean(report);
  if (!report.hasGit) throw new Error('请先在项目目录执行 git init -b main。');
  git(root, ['add', '--', ...report.paths]);
  const staged = checkRelease(root); requireClean(staged);
  return staged;
}
export function packRelease(root = ROOT) {
  const report = checkRelease(root); requireClean(report);
  if (!report.hasGit || report.entries.length !== report.paths.length) throw new Error('请先运行 npm run release:stage，完整暂存发布白名单。');
  const diff = git(root, ['diff', '--quiet', '--', ...report.paths], true);
  if (diff.status !== 0 || diff.error) throw new Error('有未暂存的源码修改。检查后重新运行 release:stage，再打包。');
  const directory = join(root, 'dist');
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error('dist 不得为符号链接。');
  mkdirSync(directory, { recursive: true });
  const tree = git(root, ['write-tree']).stdout.toString().trim();
  const temporary = join(directory, `source-${randomUUID()}.zip`);
  const output = join(directory, 'video-vault-source.zip');
  try {
    git(root, ['archive', '--format=zip', '--prefix=video-vault/', `--output=${temporary}`, tree]);
    renameSync(temporary, output);
  } finally { rmSync(temporary, { force: true }); }
  return { output, sha256: createHash('sha256').update(readFileSync(output)).digest('hex'), count: report.paths.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const action = process.argv[2] || 'check';
    if (action === 'check') {
      const report = checkRelease(); requireClean(report);
      console.log(`发布检查通过：${report.paths.length} 个白名单文件，${report.entries.length} 个 Git 索引条目。${report.hasGit ? '' : '当前没有 Git 仓库；已检查工作区源码。'}`);
    } else if (action === 'stage') {
      const report = stageRelease(); console.log(`已安全暂存 ${report.entries.length} 个白名单文件；未提交、未推送。`);
    } else if (action === 'pack') {
      const result = packRelease(); console.log(`源码包：dist/video-vault-source.zip（${result.count} 个文件）\nSHA-256: ${result.sha256}`);
    } else throw new Error('支持的操作：check、stage、pack。');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
