// 技能包解析：把上传的 .zip / .md 变成技能库里的一条技能。
//
// 为什么自己解析 ZIP 而不装 jszip：ZIP 的中央目录是定长结构，偏移算对就能拿到每个
// 成员；解压只需要 inflate，Chrome 103+ 原生就有 DecompressionStream('deflate-raw')。
// 为这两件事引一个几百 KB 的依赖不值得 —— 原型里每 KB bundle 都要算。

const ZIP_EOCD = 0x06054b50;
const ZIP_CEN = 0x02014b50;
const ZIP_LOC = 0x04034b50;

// 导入前扫一遍的特征词。命中不等于有害，但老师必须在写入技能库前看到。
const RISK_PATTERNS = [
  { label: '删除文件', re: /rm\s+-rf|rmtree|del\s+\/[fs]/i },
  { label: '执行系统命令', re: /\beval\s*\(|exec\s*\(|os\.system|subprocess|child_process|osascript/i },
  { label: '提权运行', re: /\bsudo\b|chmod\s+777|launchctl|crontab/i },
  { label: '读取凭据', re: /\.ssh|id_rsa|\.env\b|aws_secret|api[_-]?key|password\s*=/i },
  { label: '对外传输数据', re: /\bcurl\b|\bwget\b|\bnc\s|scp\s|rsync\s/i },
  { label: '联网安装依赖', re: /npm\s+install|pnpm\s+install|pip\s+install|brew\s+install|apt-get\s+install/i },
  { label: '写库语句', re: /drop\s+table|truncate\s+table|delete\s+from/i },
];

const textDecoder = new TextDecoder('utf-8', { fatal: false });

/** 极简 YAML frontmatter 解析：只支持 `key: value` 与 `key: |` 折叠块，够读 SKILL.md。 */
export function parseFrontmatter(text = '') {
  const matched = /^\ufeff?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(String(text));
  if (!matched) return { data: {}, body: String(text) };
  const data = {};
  let key = null;
  for (const line of matched[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const pair = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (pair) {
      key = pair[1];
      let value = pair[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value === '|' || value === '>') { data[key] = ''; continue; }
      data[key] = value;
    } else if (key && /^\s+/.test(line)) {
      data[key] = (data[key] ? `${data[key]} ` : '') + line.trim();
    }
  }
  return { data, body: String(text).slice(matched[0].length) };
}

/** SKILL.md → 技能元数据。缺 name 时用第一级标题或文件名兜底。 */
export function parseSkillMarkdown(text = '', fallbackName = '') {
  const { data, body } = parseFrontmatter(text);
  const heading = (body.match(/^#\s+(.+)$/m) || [])[1] || '';
  const name = String(data.name || fallbackName || heading).trim();
  return {
    name,
    displayName: String(data.display_name || data.displayName || data.display_name_en || heading || name).trim(),
    description: String(data.description || data.description_zh || data.description_en || '').replace(/\s+/g, ' ').trim(),
    version: String(data.version || '').trim(),
    author: String(data.author || '').trim(),
    license: String(data.license || '').trim(),
    body,
  };
}

async function inflateRaw(bytes) {
  // ZIP 的 deflate 是裸流（无 zlib 头），对应 'deflate-raw'。
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 解析 ZIP 中央目录，返回包内所有成员。不支持 ZIP64（技能包用不到）。 */
async function readZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i -= 1) {
    if (view.getUint32(i, true) === ZIP_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('这不是有效的 zip 包：找不到结尾记录。');

  const total = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let n = 0; n < total; n += 1) {
    if (view.getUint32(cursor, true) !== ZIP_CEN) break;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = textDecoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    if (!name.endsWith('/')) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const raw = bytes.subarray(start, start + compressedSize);
      entries.push({ path: name, method, raw, size: view.getUint32(cursor + 24, true) });
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 对包内文件做一遍导入前体检。只做静态特征匹配，不执行任何内容。 */
export function auditPackage(files = []) {
  const scriptFiles = files.filter(file => /^scripts\//.test(file.path) || /\.(sh|py|js|mjs|cjs|ps1|bat)$/i.test(file.path));
  const hits = [];
  for (const file of files) {
    if (!file.text) continue;
    for (const pattern of RISK_PATTERNS) {
      if (pattern.re.test(file.text)) {
        hits.push({ path: file.path, label: pattern.label });
      }
    }
  }
  const uniqueLabels = [...new Set(hits.map(hit => hit.label))];
  const level = uniqueLabels.length ? 'risky' : scriptFiles.length ? 'review' : 'safe';
  return {
    level,
    scriptFiles: scriptFiles.map(file => file.path),
    hits,
    labels: uniqueLabels,
    totalFiles: files.length,
  };
}

const TEXT_LIMIT = 200 * 1024;

/**
 * 读一个上传文件（.zip 或 .md），产出技能元数据 + 包内文件清单 + 安全体检结果。
 */
export async function readSkillPackage(file) {
  const lowerName = String(file.name || '').toLowerCase();
  if (lowerName.endsWith('.zip')) {
    const buffer = await file.arrayBuffer();
    const entries = await readZip(buffer);
    if (!entries.length) throw new Error('zip 包里没有找到任何文件。');

    const files = [];
    for (const entry of entries) {
      let content = null;
      try {
        const data = entry.method === 0 ? entry.raw : await inflateRaw(entry.raw);
        content = textDecoder.decode(data);
      } catch {
        content = null; // 二进制成员（图片等）不解码，仍计入清单
      }
      files.push({ path: entry.path, size: entry.size, text: content });
    }
    // SKILL.md 可能在包的任意层级，取路径最浅的那个。
    const md = files
      .filter(item => /(^|\/)SKILL\.md$/i.test(item.path) && item.text)
      .sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0];
    if (!md) throw new Error('zip 包里没有 SKILL.md，无法识别为技能包。');

    const fallback = md.path.split('/').slice(-2)[0] || String(file.name).replace(/\.zip$/i, '');
    return {
      kind: 'zip',
      sourceName: file.name,
      size: file.size,
      skillPath: md.path,
      files: files.map(({ path, size }) => ({ path, size })),
      audit: auditPackage(files),
      ...parseSkillMarkdown(md.text, fallback),
    };
  }

  if (lowerName.endsWith('.md') || String(file.type || '').startsWith('text/')) {
    const text = textDecoder.decode(await file.arrayBuffer());
    if (!text.trim()) throw new Error('文件内容是空的。');
    const fallback = String(file.name).replace(/\.md$/i, '');
    const files = [{ path: file.name, size: file.size, text: text.slice(0, TEXT_LIMIT) }];
    return {
      kind: 'markdown',
      sourceName: file.name,
      size: file.size,
      skillPath: file.name,
      files: [{ path: file.name, size: file.size }],
      audit: auditPackage(files),
      ...parseSkillMarkdown(text, fallback),
    };
  }

  throw new Error('只支持 .zip 技能包或 .md 技能文件。');
}

// 云存储模块在匿名模式下强制要求用户凭证（storage 端点 401），而 database 通道
// 只需 publishable key 即可读写。原型没有真实用户体系，所以技能包不进对象存储，
// 直接以 base64 归档进技能行：小包（<2MB）随时可回溯、可下载，够用且真实。
const INLINE_BLOB_LIMIT = 2 * 1024 * 1024;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('读取文件失败。'));
    reader.readAsDataURL(file);
  });
}

/**
 * 归档技能包：返回可写进技能行的内联归档信息。
 * 包体超过 2MB 时不做内联（原型数据库不适合放大对象），只保留文件清单。
 */
export async function archiveSkillPackage(file) {
  if (!file) return null;
  if (file.size > INLINE_BLOB_LIMIT) return { inlined: false, reason: '包体超过 2MB，仅保留文件清单。' };
  return { inlined: true, base64: await fileToBase64(file) };
}
