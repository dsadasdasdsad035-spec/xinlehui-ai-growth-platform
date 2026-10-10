/**
 * 上传素材的准入规则与隐私约定（US-408「上传校验与素材隐私」）。
 *
 * 这里是**纯函数 + 常量**，不碰 DOM、不碰网络，所以可以直接用 Node 跑断言
 * （见 prototype/AGENTS.md 的「验证技巧」一节）。
 *
 * 三条硬规则：
 * 1. 格式白名单只有 JPEG / PNG / WebP —— 其它一律拒绝，并给出可读文案；
 * 2. 单张体积上限 10MB、长边上限 3000px（超过就在本机降采样，见 `downsamplePlan`）；
 * 3. 素材**只在当次会话里有效**：条目的 `url` 是会话内 object URL，
 *    任何持久化路径都必须先过 `buildSessionMediaDraft()`，把 url / base64 / 图片本体剔掉。
 *
 * 数量上限（作品每人 5 幅、照片每人 10 张）不在本模块定义：单一真源是
 * `data/uploadBinding.js` 的 `UPLOAD_SLOTS_PER_STUDENT`，界面文案通过
 * `mediaRulesText({artworkMax, photoMax})` 传入，避免两处各写一份数字。
 */

/** 允许的 MIME 白名单（顺序即界面文案里的顺序）。 */
export const MEDIA_MIME_WHITELIST = ['image/jpeg', 'image/png', 'image/webp'];

/** 界面/提示语里统一用的格式说法。 */
export const MEDIA_FORMAT_LABEL = 'JPEG / PNG / WebP';

/** 单张素材体积上限：10MB。 */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

/** 长边上限：超过就在客户端降采样后再处理。 */
export const MAX_LONG_EDGE = 3000;

/**
 * 非标准但确实等价的 MIME 别名。
 * 老浏览器/部分安卓文件选择器会给 `image/jpg`、`image/x-png`，它们仍是白名单里的格式，
 * 归一化而不是拒绝；反过来，`text/plain` 之类一律拒绝。
 */
const MIME_ALIASES = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png'
};

/** 扩展名 → MIME（只在文件没给 MIME 或给了 application/octet-stream 时兜底）。 */
const EXTENSION_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};

/** 没有 MIME 时可以按扩展名兜底的类型（相机导出、部分安卓选择器会这样）。 */
const BLANK_TYPES = ['', 'application/octet-stream', 'binary/octet-stream'];

/** 文件名后缀（小写、不含点）。 */
export function extensionOf(name) {
  const value = String(name || '').trim().toLowerCase();
  const index = value.lastIndexOf('.');
  return index > -1 ? value.slice(index + 1) : '';
}

/**
 * 这份文件真正是什么图片类型：白名单 MIME > MIME 别名 > （没有 MIME 时）扩展名。
 * 返回空串表示「不是白名单图片」，调用方据此拒绝。
 */
export function mediaTypeOf(file) {
  const raw = String(file?.type || '').trim().toLowerCase();
  if (MEDIA_MIME_WHITELIST.includes(raw)) return raw;
  if (MIME_ALIASES[raw]) return MIME_ALIASES[raw];
  if (BLANK_TYPES.includes(raw)) return EXTENSION_TYPES[extensionOf(file?.name)] || '';
  // 给了明确但不是白名单的 MIME（如 text/plain、image/gif）：即使后缀伪装成 .jpg 也不放行。
  return '';
}

/** 体积的可读说法：10MB / 1.4MB / 820KB。 */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) {
    const mb = value / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10}MB`;
  }
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

/** 单份文件的准入校验。永不抛错，缺字段按「不合格」处理。 */
export function validateMediaFile(file) {
  const name = String(file?.name || '').trim() || '未命名文件';
  const type = mediaTypeOf(file);
  const size = Number(file?.size) || 0;
  if (!type) {
    return { ok: false, code: 'unsupported-format', name, type: '', size, message: `「${name}」格式不支持：只能上传 ${MEDIA_FORMAT_LABEL} 图片。` };
  }
  if (size <= 0) {
    return { ok: false, code: 'empty', name, type, size, message: `「${name}」是空文件，无法作为素材，请重新导出后再试。` };
  }
  if (size > MAX_MEDIA_BYTES) {
    return { ok: false, code: 'too-large', name, type, size, message: `「${name}」有 ${formatBytes(size)}，超过单张 ${formatBytes(MAX_MEDIA_BYTES)} 上限，请压缩后重新选择。` };
  }
  return { ok: true, code: 'ok', name, type, size, message: '' };
}

/** 把被拒的原因拼成一段可读提示（最多列 3 个文件名，其余只说数量）。 */
export function describeMediaRejections(rejected = []) {
  const list = (rejected || []).filter(item => item && item.message);
  if (!list.length) return '';
  const head = list.slice(0, 3).map(item => item.message).join('');
  const rest = list.length > 3 ? `另外还有 ${list.length - 3} 份不合格。` : '';
  return `${head}${rest}已跳过 ${list.length} 份不合格素材，其余文件不受影响。`;
}

/**
 * 一次选择的全部文件过一遍准入规则：合格的进 `accepted`，不合格的连原因进 `rejected`。
 * **不因为单个文件不合格就中止整批** —— 老师一次选 5 张，其中 1 张超限时其余 4 张照常处理。
 */
export function screenMediaFiles(files = []) {
  const accepted = [];
  const rejected = [];
  Array.from(files || []).forEach(file => {
    const check = validateMediaFile(file);
    if (check.ok) accepted.push(file);
    else rejected.push(check);
  });
  return { accepted, rejected, message: describeMediaRejections(rejected) };
}

/**
 * 降采样方案（纯计算，实际绘制在 services/mediaIntake.js）：
 * 长边超过 `maxLongEdge` 才需要缩放，宽高按同一比例收敛且至少留 1px。
 */
export function downsamplePlan(width, height, maxLongEdge = MAX_LONG_EDGE) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const limit = Number(maxLongEdge) > 0 ? Number(maxLongEdge) : MAX_LONG_EDGE;
  const longEdge = Math.max(w, h);
  if (!(w > 0) || !(h > 0) || longEdge <= limit) {
    return { needed: false, scale: 1, width: w, height: h, longEdge };
  }
  const scale = limit / longEdge;
  return {
    needed: true,
    scale,
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    longEdge: limit
  };
}

/** 持久化媒体元数据时允许保留的字段：只有描述信息，没有任何可还原画面的内容。 */
export const DRAFT_MEDIA_FIELDS = ['id', 'name', 'type', 'size', 'storage'];

/**
 * 把 `media` 收敛成**可持久化的元数据**（草稿只存这些）。
 *
 * `url / originalUrl / orientedUrl / cleanUrl / framedUrl` 全部剔除：它们可能是
 * `blob:` 会话地址，也可能是 canvas 产出的 `data:` base64（那等于把图片本体写进 localStorage）。
 * 这是 US-408「素材不写入 localStorage / IndexedDB」在代码里的唯一执行点。
 */
export function buildSessionMediaDraft(media = {}) {
  const out = {};
  Object.entries(media || {}).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') {
      out[key] = null;
      return;
    }
    const meta = {};
    DRAFT_MEDIA_FIELDS.forEach(field => {
      if (value[field] !== undefined && value[field] !== null) meta[field] = value[field];
    });
    out[key] = meta;
  });
  return out;
}

/** 一段文本里是否藏着素材本体（data URL / object URL / base64）。 */
const MEDIA_PAYLOAD_PATTERN = /(data:image\/|blob:|;base64,)/i;

/** 深度扫描任意值，判断里面有没有图片本体。给断言与自检用（`buildSessionMediaDraft` 的产物必须为 false）。 */
export function containsMediaPayload(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return MEDIA_PAYLOAD_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsMediaPayload);
  if (typeof value === 'object') return Object.values(value).some(containsMediaPayload);
  return false;
}

/**
 * 递归把**会话内 object URL**（`blob:...`）清成空串。
 *
 * 会话素材地址刷新即失效，写进任何持久化数据都只是垃圾（还可能让人误以为素材还在）。
 * 已处理好的作品图如果本身是 `data:` URL，那是成长档案的正式内容，**不在这里清洗** ——
 * 归档素材的存储策略属于归档/成长档案那组故事，本模块只保证「上传会话不落浏览器存储」。
 */
export function stripSessionMediaUrls(value) {
  if (typeof value === 'string') return value.startsWith('blob:') ? '' : value;
  if (Array.isArray(value)) return value.map(stripSessionMediaUrls);
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([key, item]) => { out[key] = stripSessionMediaUrls(item); });
    return out;
  }
  return value;
}

/**
 * 界面上「上传规则」那一行文案（把规则明确写给老师看，而不是只藏在代码里）。
 * 数量上限由调用方传入（单一真源是 `UPLOAD_SLOTS_PER_STUDENT`，形状与这里的
 * `{artwork, photo}` 一致，直接传进去即可）；默认值只服务于单独调用与断言。
 */
export function mediaRulesText({ artwork = 5, photo = 10 } = {}) {
  return `上传规则：格式限 ${MEDIA_FORMAT_LABEL}，单张不超过 ${formatBytes(MAX_MEDIA_BYTES)}，长边超过 ${MAX_LONG_EDGE}px 会在本机自动降采样后再处理；作品每人最多 ${artwork} 幅、课堂照片每人最多 ${photo} 张。素材只在当次会话内有效（只使用会话内 object URL，不写入 localStorage / IndexedDB），页面刷新或重新进入后请重新选择原始素材。`;
}
