/**
 * 装裱素材（机构 Logo / 手写签名 / 二维码底图）的上传准入规则（[第二步 US-003b]，FR-22）。
 *
 * 这是**纯函数 + 常量**，不碰 DOM、不碰网络，所以可以直接用 Node 跑断言
 * （见 prototype/AGENTS.md 的「验证技巧」一节）。浏览器侧只保留「必须有 DOM 能力」的部分
 * —— 解码图片拿到真实宽高、把文件读成 data URL —— 见 `services/framingAssets.js`。
 *
 * 三条规则（验收原文：PNG/JPG、不超过 512×512、不超过 200KB，超限给出明确错误文案）：
 *   1. 格式白名单只有 **PNG / JPG**（注意比儿童素材的 JPEG/PNG/WebP 更窄：WebP 在部分打印 /
 *      微信链路里会掉格式，Logo 是机构长期资产，不收）；
 *   2. 单边不得超过 **512px**（两个方向都要满足）；
 *   3. 单文件不得超过 **200KB**。
 *
 * 为什么规则不在界面里写死：界面的文案、判定与常量都从这一份取（`framingAssetRulesText()`），
 * 改规则只改这里；否则「界面上写 512、判定里写 1024」这类漂移迟早会出现。
 */

/** 允许的 MIME 白名单（顺序即界面文案里的顺序）。 */
export const FRAMING_ASSET_MIME_WHITELIST = ['image/png', 'image/jpeg'];

/** 界面/提示语里统一用的格式说法。 */
export const FRAMING_ASSET_FORMAT_LABEL = 'PNG / JPG';

/** 单张体积上限：200KB。 */
export const MAX_FRAMING_ASSET_BYTES = 200 * 1024;

/** 单边上限：宽、高都不得超过 512px。 */
export const FRAMING_ASSET_MAX_EDGE = 512;

/** 素材用途的中文名（文案里带上它，老师才知道是哪一类素材不合格）。 */
export const FRAMING_ASSET_KIND_LABELS = {
  logo: '机构 Logo',
  signature: '手写签名',
  qr: '二维码底图'
};

/**
 * 非标准但确实等价的 MIME 别名。
 * 部分系统 / 老浏览器会给 `image/jpg`、`image/pjpeg`、`image/x-png`，它们仍是白名单里的格式，
 * 归一化而不是拒绝；`image/webp` 之类**不在**白名单里，一律拒绝（见文件头注释）。
 */
const MIME_ALIASES = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png'
};

/** 扩展名 → MIME（只在文件没给 MIME 或给的是 octet-stream 时兜底）。 */
const EXTENSION_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg'
};

/** 没有有效 MIME 时可以按扩展名兜底的类型（相机导出、部分安卓选择器会这样）。 */
const BLANK_TYPES = ['', 'application/octet-stream', 'binary/octet-stream'];

/** 文件名后缀（小写、不含点）。 */
export function framingAssetExtension(name) {
  const value = String(name || '').trim().toLowerCase();
  const index = value.lastIndexOf('.');
  return index > -1 ? value.slice(index + 1) : '';
}

/**
 * 归一化素材的 MIME：白名单 + 别名 + 扩展名兜底。
 * 「明确给了非白名单 MIME」**不做扩展名兜底**（`text/plain` 伪装 `.png` 一律拒绝）。
 */
export function framingAssetTypeOf(file) {
  const source = file && typeof file === 'object' ? file : {};
  const raw = String(source.type || '').trim().toLowerCase();
  const ext = framingAssetExtension(source.name);
  if (MIME_ALIASES[raw]) return MIME_ALIASES[raw];
  if (FRAMING_ASSET_MIME_WHITELIST.includes(raw)) return raw;
  if (BLANK_TYPES.includes(raw)) return EXTENSION_TYPES[ext] || '';
  return '';
}

/** 「48KB」「1.2MB」这类可读体积（文案里用，别在界面里各写一份）。 */
export function formatFramingAssetBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 1024) return `${Math.round(value)}B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`;
  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

/** 展示名：文件名去掉路径，空文件名给一个占位。 */
export function framingAssetName(file) {
  const raw = String((file && file.name) || '').trim();
  return raw || '未命名文件';
}

/**
 * 只判尺寸（FR-22 的 512×512 那条）。
 *
 * 用途：复核一条**已经存进模板的**素材地址时，格式已经无从得知（data URL 能解码就等于格式可用、
 * http(s) 地址更不该按扩展名猜），这时只该判尺寸。别再拿 `validateFramingAsset` 去判它 ——
 * 名称是给老师看的标签（「机构 Logo」）而不是文件名，按扩展名判会一律报「格式不支持」（US-003b 踩到）。
 */
export function validateFramingAssetDimensions(asset) {
  const source = asset && typeof asset === 'object' ? asset : {};
  const name = framingAssetName(source);
  const limits = {
    formats: FRAMING_ASSET_FORMAT_LABEL,
    maxBytes: MAX_FRAMING_ASSET_BYTES,
    maxEdge: FRAMING_ASSET_MAX_EDGE
  };
  const rejection = dimensionRejection({ name, width: source.width, height: source.height });
  if (rejection) return { ok: false, reason: 'dimension', type: '', limits, message: rejection };
  return { ok: true, reason: '', type: '', limits, message: '' };
}

/** 尺寸规则的单点实现（`validateFramingAsset` 与 `validateFramingAssetDimensions` 共用）。 */
function dimensionRejection({ name, width, height }) {
  const w = Number(width);
  const h = Number(height);
  if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) return '';
  if (w > FRAMING_ASSET_MAX_EDGE || h > FRAMING_ASSET_MAX_EDGE) {
    return `「${name}」是 ${Math.round(w)}×${Math.round(h)}，超过 ${FRAMING_ASSET_MAX_EDGE}×${FRAMING_ASSET_MAX_EDGE} 上限，请先缩小到单边 ${FRAMING_ASSET_MAX_EDGE}px 以内。`;
  }
  return '';
}

/**
 * 逐份判定一份素材（`{ name, type, size, width, height }`）。
 *
 * `width` / `height` 允许缺省：真正的尺寸要解码后才知道，所以调用分两步 ——
 * 选文件时先判格式与体积（拿不到尺寸），解码之后再带上尺寸判一遍（`services/framingAssets.js`
 * 的 `readFramingAsset` 就是这么串起来的）。缺尺寸时不判尺寸，而不是当成不合格。
 *
 * 返回 `{ ok, reason, message, type, limits }`：
 *   - `ok`    是否可以入库；
 *   - `reason` 机器可读的原因（`format` / `size` / `dimension`），ok 时为 `''`；
 *   - `message` **可读文案**（验收：超限资源给出明确错误文案），带上文件名与实际值 + 上限 + 怎么办。
 * 永不抛错：非对象 / 脏值按不合格处理。
 */
export function validateFramingAsset(file) {
  const source = file && typeof file === 'object' ? file : {};
  const name = framingAssetName(source);
  const limits = {
    formats: FRAMING_ASSET_FORMAT_LABEL,
    maxBytes: MAX_FRAMING_ASSET_BYTES,
    maxEdge: FRAMING_ASSET_MAX_EDGE
  };
  const type = framingAssetTypeOf(source);
  if (!type) {
    return {
      ok: false,
      reason: 'format',
      type: '',
      limits,
      message: `「${name}」格式不支持：装裱素材只收 ${FRAMING_ASSET_FORMAT_LABEL}，请换一张图片再上传。`
    };
  }
  const bytes = Number(source.size);
  if (Number.isFinite(bytes) && bytes > MAX_FRAMING_ASSET_BYTES) {
    return {
      ok: false,
      reason: 'size',
      type,
      limits,
      message: `「${name}」有 ${formatFramingAssetBytes(bytes)}，超过 ${formatFramingAssetBytes(MAX_FRAMING_ASSET_BYTES)} 上限，请压缩后再上传。`
    };
  }
  const dimensionMessage = dimensionRejection({ name, width: source.width, height: source.height });
  if (dimensionMessage) {
    return { ok: false, reason: 'dimension', type, limits, message: dimensionMessage };
  }
  return { ok: true, reason: '', type, limits, message: '' };
}

/**
 * 选文件那一刻的判定（拿不到真实尺寸）：格式 + 体积。
 * 与 `validateFramingAsset` 同一份规则，只是不传尺寸 —— 界面可以先给出最早的反馈，
 * 解码之后再判尺寸（那时才可能报「超过 512×512」）。
 */
export function screenFramingAssetFile(file) {
  return validateFramingAsset(file);
}

/** 规则文案（界面常驻提示用；数字全部来自常量，别在 JSX 里再写一遍）。 */
export function framingAssetRulesText() {
  return `${FRAMING_ASSET_FORMAT_LABEL}，单边不超过 ${FRAMING_ASSET_MAX_EDGE}×${FRAMING_ASSET_MAX_EDGE}，体积不超过 ${formatFramingAssetBytes(MAX_FRAMING_ASSET_BYTES)}`;
}

/**
 * data URL 形式的素材地址长度上限。
 *
 * 由素材上限推出来：200KB 原文件 → base64 约 273KB 字符，再加 `data:image/png;base64,` 前缀的余量。
 * **这个常量必须和 `validateFramingAsset` 的体积上限一起看** —— 装裱 spec 的收敛器
 * （`services/frameSpec.js` 的 `imageUrl`）用它做地址长度上限：上限写小了，一张合规的 Logo
 * 会被**截断**成半张图（US-003b 真踩到：2048 字符的截断让一张 100×400 的 Logo 只画出上面 73%，
 * 而且 PNG 解码器不报错，看起来像「渲染有鬼」）。
 */
export const FRAMING_ASSET_DATA_URL_MAX_CHARS = Math.ceil(MAX_FRAMING_ASSET_BYTES / 3) * 4 + 64;

/** 入库后的素材摘要（面板上显示「logo.png · PNG · 48KB · 512×512」这类一行说明）。 */
export function framingAssetSummary(asset) {
  const source = asset && typeof asset === 'object' ? asset : {};
  const parts = [framingAssetName(source)];
  const type = framingAssetTypeOf(source);
  if (type) parts.push(type === 'image/png' ? 'PNG' : 'JPG');
  const bytes = formatFramingAssetBytes(source.size ?? source.bytes);
  if (bytes) parts.push(bytes);
  const width = Number(source.width);
  const height = Number(source.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    parts.push(`${Math.round(width)}×${Math.round(height)}`);
  }
  return parts.join(' · ');
}
