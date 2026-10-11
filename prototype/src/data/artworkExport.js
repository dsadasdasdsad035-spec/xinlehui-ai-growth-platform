// 保存图片（[第二步 US-008a] / FR-25 / FR-26）—— 两档导出与保存路径的唯一真源。
//
// 这个模块回答四个问题，全部是零依赖纯函数（不 import 任何 services，可直接用 Node 跑断言）：
//   ① 导出什么：「高清 PNG」与「微信 JPG」两档的口径（格式 / 长边上限 / JPEG 质量 / 体积上限）
//      写在 ARTWORK_EXPORT_QUALITIES 里一处，界面文案、渲染参数与断言都读它 —— 改规则只改一处；
//   ② 导出多大：`artworkExportPlan` 由「作品画到 1:1 所需的倍数」与长边上限推出导出画布尺寸。
//      「保留裁剪后的原始像素」是**结构上的性质**（导出图里作品占的设备像素 ≥ 原图像素，
//      即 plan.keepsOriginalPixels 为真），不是靠人眼看，也不是「画布大一点就行」；
//   ③ 文件叫什么：`artworkExportFilename` —— `{学员名}_{作品名}_{课次日期}_装裱.{png|jpg}`，
//      空格与非法字符一律去掉；去掉后为空的片段直接不参与拼接（不会留下 `__` 或开头就是 `_`）；
//   ④ 怎么存下去：`artworkExportSaveStrategy` 按 UA 选路径 —— 常规浏览器走 `<a download>`；
//      iOS Safari 与微信内置浏览器会**忽略** blob 下载（Safari 直接打开图片、微信只给「用其他应用打开」），
//      这两类降级为「长按图片保存」的提示页（PRD US-008 明确要求「必要时降级为长按保存提示」）。
//
// 日期口径：文件名里的课次日期复用 `data/lessons.js` 的 `formatLessonDateDots`（`2026.08.04`）——
// 展签、海报与文件名用同一份日期格式，别各写一遍。

import { formatLessonDateDots } from './lessons';

/**
 * 两档输出。`longEdgeMode` 是缩放策略：
 *   - `'native'`：高清档 —— 先把作品画到 1:1（不放大），再受长边上限约束；作品像素因此只增不减；
 *   - `'fixed'`：微信档 —— 画布长边收敛到 `maxLongEdge`，不做无意义放大。
 * `maxBytes` 只对 JPEG 有意义（PNG 无损，体积随像素走，验收也没给它设上限）。
 */
export const ARTWORK_EXPORT_QUALITIES = [
  {
    id: 'hd',
    label: '高清 PNG',
    format: 'png',
    extension: 'png',
    mimeType: 'image/png',
    longEdgeMode: 'native',
    maxLongEdge: 4000,
    quality: null,
    maxBytes: null,
    actionLabel: '保存高清 PNG',
    summary: '保留裁剪后的原始像素（不缩水），长边不超过 4000px，适合打印、留档与二次加工。'
  },
  {
    id: 'wechat',
    label: '微信 JPG',
    format: 'jpeg',
    extension: 'jpg',
    mimeType: 'image/jpeg',
    longEdgeMode: 'fixed',
    maxLongEdge: 1600,
    quality: 0.85,
    maxBytes: 1024 * 1024,
    actionLabel: '保存微信 JPG',
    summary: '长边 1600px、质量 0.85、体积控制在 1MB 以内，适合直接发给家长。'
  }
];

export const ARTWORK_EXPORT_QUALITY_IDS = ARTWORK_EXPORT_QUALITIES.map(item => item.id);
/** 默认档：高清 PNG（「既能直接发微信，也能留档」里的留档那一档）。 */
export const ARTWORK_EXPORT_DEFAULT_QUALITY = 'hd';
/** 文件名的固定后缀（FR-26）。 */
export const ARTWORK_EXPORT_FILENAME_SUFFIX = '装裱';
/** 单个名字片段的最长字数：Windows 与 macOS 的 255 字节上限在中文标题下很容易撞到，先各自截断。 */
export const ARTWORK_EXPORT_SEGMENT_MAX_CHARS = 40;
/** JPEG 超体积上限时的降质阶梯（从高到低，逐级重编码直到装进 maxBytes）。 */
export const ARTWORK_EXPORT_JPEG_QUALITY_LADDER = [0.85, 0.78, 0.72, 0.66, 0.6, 0.55];

/** 文件名里必须去掉的字符：Windows 保留字符 + 控制字符（空格另行处理，见 sanitize）。 */
const ILLEGAL_FILENAME_PATTERN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** 某一档的完整口径。认不出的 id 回落默认档（不抛错、也不返回空值）。 */
export function artworkExportQuality(id) {
  return ARTWORK_EXPORT_QUALITIES.find(item => item.id === id)
    || ARTWORK_EXPORT_QUALITIES.find(item => item.id === ARTWORK_EXPORT_DEFAULT_QUALITY);
}

/**
 * 文件名片段：去掉空格（含全角空格）与非法字符。下划线是**分隔符**，一律不留在片段里
 * ——否则用户填的 `陈_一诺` 会拼出分不清边界的两段。截断放在最后（截断可能又留下分隔符，
 * 所以截断后再收一次尾）。
 */
export function sanitizeArtworkExportSegment(value) {
  return String(value ?? '')
    .replace(ILLEGAL_FILENAME_PATTERN, '')
    .replace(/\s+/g, '')
    .replace(/_/g, '')
    .replace(/^[.\-]+/, '')
    .slice(0, ARTWORK_EXPORT_SEGMENT_MAX_CHARS)
    .replace(/[.\-_]+$/, '');
}

/** 文件名里的课次日期：`2026-08-04` / `2026.08.04` / `2026年8月4日` 一律收敛成 `2026.08.04`。
 * 认不出的值（`上周三` 这类人类说法）收敛成空串，那一段就从文件名里去掉 ——
 * 与 data/lessons.js 同一条纪律：不编造日期。 */
export function artworkExportDateText(value) {
  return sanitizeArtworkExportSegment(formatLessonDateDots(value));
}

/**
 * 文件名：`{学员名}_{作品名}_{课次日期}_装裱.{png|jpg}`。
 * 空片段（没选学员 / 没作品名 / 没课次日期）不参与拼接 —— 生成 `__装裱.png` 这种名字既难看
 * 又会被不同的作品覆盖成同名文件。`装裱` 后缀永远保留，它是「这是装裱成品」的标识。
 */
export function artworkExportFilename(options = {}) {
  const { student = '', title = '', lessonDate = '', quality = ARTWORK_EXPORT_DEFAULT_QUALITY } = options || {};
  const entry = artworkExportQuality(quality);
  const segments = [student, title, artworkExportDateText(lessonDate)]
    .map(sanitizeArtworkExportSegment)
    .filter(Boolean);
  if (!segments.length) segments.push('作品');
  return [...segments, ARTWORK_EXPORT_FILENAME_SUFFIX].join('_') + `.${entry.extension}`;
}

/** `1.2 MB` / `860 KB`：面板与提示里的体积文案（字节数只有一个来源）。 */
export function artworkExportSizeText(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '未知大小';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** 体积是否超上限（只有设了 maxBytes 的档会超；PNG 永远 false）。 */
export function artworkExportOverLimit(bytes, quality) {
  const entry = artworkExportQuality(quality);
  if (!entry.maxBytes) return false;
  return Number(bytes) > entry.maxBytes;
}

/**
 * JPEG 的编码质量计划：先按档位标称质量编一次，超了就按阶梯逐级降质重编。
 * 返回的是**从高到低**的候选序列（第一项就是档位标称值），调用方按顺序试、装进上限就停。
 */
export function artworkExportJpegQualityPlan(quality) {
  const entry = artworkExportQuality(quality);
  const first = Number.isFinite(entry.quality) ? entry.quality : ARTWORK_EXPORT_JPEG_QUALITY_LADDER[0];
  return [first, ...ARTWORK_EXPORT_JPEG_QUALITY_LADDER.filter(item => item < first)];
}

/**
 * 导出画布计划：由装裱几何的 `ratio`（画布 1800×1360 下作品被缩放到的比例）推出倍数与画布尺寸。
 *
 * 高清档的关键推导：作品在画布上的逻辑尺寸 = 原图尺寸 × ratio，导出时画布整体乘以 scale，
 * 作品占的设备像素就是 `原图尺寸 × ratio × scale` —— 要让「保留原始像素」成立，只需
 * `ratio × scale ≥ 1`，即 `scale ≥ 1/ratio`。上限来自长边（4000px 既是 FR-25 的口径，
 * 也顺带落在 iOS 单张画布的面积上限之内，导出不会变成一张空白图）。
 *
 * 契约：`{ qualityId, scale, width, height, longEdge, keepsOriginalPixels }`。
 * `width/height` 是**最终画布尺寸**（整数像素），渲染层必须直接用它们，不要再自己算一遍。
 */
export function artworkExportPlan(options = {}) {
  const { quality = ARTWORK_EXPORT_DEFAULT_QUALITY, ratio, canvasWidth, canvasHeight } = options || {};
  const entry = artworkExportQuality(quality);
  const width = Math.max(1, Number(canvasWidth) || 1);
  const height = Math.max(1, Number(canvasHeight) || 1);
  const longEdge = Math.max(width, height);
  const cap = entry.maxLongEdge / longEdge;
  const artRatio = Number(ratio) > 0 ? Number(ratio) : 0;

  let scale;
  if (entry.longEdgeMode === 'fixed') {
    // 微信档：长边收敛到目标值；画布本来就比目标小就保持 1×（不做无意义放大）。
    scale = Math.min(cap, 1);
  } else {
    // 高清档：先满足「作品不缩水」，再受长边上限约束。
    const needed = artRatio > 0 ? 1 / artRatio : 1;
    scale = Math.min(Math.max(needed, 1), cap);
  }

  let outWidth = Math.max(1, Math.round(width * scale));
  let outHeight = Math.max(1, Math.round(height * scale));
  // 四舍五入对高清档是「贴着边界」的一侧：向上取整保证作品像素真的不低于原图，
  // 但取整不能把长边顶出上限（顶出去就退回按上限算）。
  if (entry.longEdgeMode === 'native') {
    outWidth = Math.max(1, Math.ceil(width * scale));
    outHeight = Math.max(1, Math.ceil(height * scale));
    if (Math.max(outWidth, outHeight) > entry.maxLongEdge) {
      outWidth = Math.max(1, Math.round(width * cap));
      outHeight = Math.max(1, Math.round(height * cap));
    }
  }

  const effectiveScale = outWidth / width;
  return {
    qualityId: entry.id,
    scale: effectiveScale,
    width: outWidth,
    height: outHeight,
    longEdge: Math.max(outWidth, outHeight),
    maxLongEdge: entry.maxLongEdge,
    keepsOriginalPixels: artRatio > 0 ? artRatio * effectiveScale >= 1 - 1e-9 : true
  };
}

/**
 * 保存路径：`download`（`<a download>` 真下载）还是 `longpress`（提示长按图片保存）。
 * iOS 全系（Safari / Chrome / 微信）与微信内置浏览器都不执行 blob 下载，按 UA 判据降级；
 * 判据本身是纯函数，浏览器里断言可以用任意 UA 字符串驱动（真机行为与 UA 一一对应）。
 */
export function artworkExportPlatform(userAgent) {
  const ua = String(userAgent || '');
  return {
    isWeChat: /MicroMessenger/i.test(ua),
    isIOS: /iPad|iPhone|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))
  };
}

export const ARTWORK_EXPORT_LONG_PRESS_HINT = '长按图片 → 选择「保存图片 / 存储到照片」，即可存到相册。';

export function artworkExportSaveStrategy(options = {}) {
  const { userAgent } = options || {};
  const platform = artworkExportPlatform(userAgent);
  if (platform.isWeChat) {
    return { mode: 'longpress', reason: 'wechat', hint: `微信内置浏览器不执行文件下载：${ARTWORK_EXPORT_LONG_PRESS_HINT}` };
  }
  if (platform.isIOS) {
    return { mode: 'longpress', reason: 'ios', hint: `iOS 不执行文件下载：${ARTWORK_EXPORT_LONG_PRESS_HINT}` };
  }
  return { mode: 'download', reason: 'download', hint: '当前浏览器支持直接下载，文件会存进「下载」文件夹。' };
}

/** 面板上那句「这两档分别是什么」的说明（文案读同一份口径，不手抄）。 */
export function artworkExportRulesText() {
  return ARTWORK_EXPORT_QUALITIES.map(item => `${item.label}：${item.summary}`).join(' ');
}
