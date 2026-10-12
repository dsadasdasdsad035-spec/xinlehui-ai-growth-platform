// 海报渲染引擎（[海报 US-301b] / FR-308 ~ FR-312）。
//
// 一份 spec + 一份数据 → 一张图。**预览与导出是同一个函数、只差 `scale`**（FR-312）：
// 预览 `scale = 1`（1080 宽）、导出 `scale = 2`（2160 宽）。绘制坐标系始终是 spec 里的
// 逻辑画布（1080×1440 之类），最后用一次 `ctx.scale` 映射到设备像素 —— 于是位置、尺寸、
// 字号这些「相对短边的比例」在任意导出尺寸下完全同构（与装裱 US-008a 的导出同一条口径）。
//
// 分层（沿 US-301a 的分工，别在这里另发明一套规则）：
//   - 结构 / 收敛 / 网格档位：`data/posterTemplates.js`（`normalizePosterSpec`、`posterGridShape`）
//   - 比例换算：`posterShortEdge()` / `posterRatioToPixels()`（唯一换算入口）
//   - 变量替换：`applyOverlayVariables` + 海报变量表（overlayLayout.js，与装裱同一支实现）
//   - 二维码落笔：`paintQrMatrixBox`（framing.js，与装裱水印 / 分享二维码同一支画笔）
//   - 本模块：canvas 能力 + 文本测量 + 版式编排
//
// 三条硬纪律：
//   1. **作品像素只做等比缩放与留边**（FR-309）：`contain` 适配、不裁切、不调色、不重绘；
//      作品图**必须**是归档后的成品素材（FR-310 由调用方保证 —— 传进来是原图那是调用方的错）。
//   2. **不画假东西**：`visible: false` 的占位区一个像素都不碰；文本为空 / 图片解码失败 /
//      二维码编不出来 → 那一支不画（并如实写进 `plan` 的 `reason`，绝不画一个扫不出来的假码）。
//   3. **永不抛错**：脏 spec 一律过 `normalizePosterSpec`；坏素材只让这一支消失，不让整张海报渲染失败。
//
// 返回值里除了 `blob` / `dataURL` 还有一份 `plan`（每个占位区「画没画、画在哪、文字几行、
// 有没有被省略」）与 `warnings`（FR-311 的溢出警告）—— 预览提示、导出前校验（US-311a）与
// 断言都读这一份，别各自反推渲染结果。

import {
  normalizePosterSpec,
  posterShortEdge,
  posterRatioToPixels,
  posterImageUrl,
  posterGridShape,
  posterEvenSample,
  POSTER_CANVAS_EDGE_RANGE,
  POSTER_MUTED_COLORS,
  POSTER_VARIABLE_KEYS
} from '../data/posterTemplates';
// 编码口径的**唯一定义**在 `data/posterExport.js`（导出格式表与这里认的两个 mime 是同一份）；
// 这一层只 re-export，既有调用方（五个 renderPosterX / 断言）一字不改。
import { POSTER_MIME_PNG, POSTER_MIME_JPEG } from '../data/posterExport';
import { paintQrMatrixBox } from './framing';
import { applyOverlayVariables, estimateTextWidth, QR_QUIET_MODULES } from './overlayLayout';
import { QR_DEFAULT_ECC, qrMatrix } from './qrCode';

export { POSTER_MIME_PNG, POSTER_MIME_JPEG };

/** 卡片阴影（image slot 的 `shadow: true`）：颜色 / 模糊 / 下移全部相对画布短边，随导出倍数放大。 */
export const POSTER_SHADOW = {
  color: 'rgba(43, 39, 31, 0.18)',
  blurRatio: 0.012,
  offsetYRatio: 0.006
};

/** 省略号（FR-311：超过 `maxLines` 截断并加省略号）。 */
export const POSTER_ELLIPSIS = '…';

/**
 * 占位格里的那句话（`placeholderText`，如 FR-321 的「本期暂无作品」）：
 * 字号按**格子宽度**的比例算、上限压在画布短边的 3%（大格子里不至于夸张成一整块字）。
 * 三处（班级墙的占位格、断言与将来的其它拼贴）读同一份。
 */
export const POSTER_CELL_PLACEHOLDER_FONT_RATIO = 0.12;
export const POSTER_CELL_PLACEHOLDER_MAX_RATIO = 0.03;
export const POSTER_CELL_PLACEHOLDER_MAX_LINES = 2;

/**
 * 设备画布尺寸：`scale` 是导出倍数，但要**封顶在 canvas 单边上限**（默认 4096）。
 * 超长图（report-long）在 iOS Safari 上会得到一张空白图（PRD 9.4 点名的坑），
 * 所以这里给一个结构性的保护：**统一缩**（宽高同一个倍率）而不是只夹一个方向 ——
 * 只夹一边会改变版式比例。返回 `{ width, height, scale, requestedScale, clamped }`。
 */
export function posterCanvasScale({ canvas, scale = 1, maxEdge = POSTER_CANVAS_EDGE_RANGE.max } = {}) {
  const source = canvas && typeof canvas === 'object' ? canvas : {};
  const width = Math.max(1, Math.round(Number(source.width) || 0) || 1);
  const height = Math.max(1, Math.round(Number(source.height) || 0) || 1);
  const wanted = Number(scale);
  const requested = Number.isFinite(wanted) && wanted > 0 ? wanted : 1;
  const limit = Number(maxEdge);
  const edge = Number.isFinite(limit) && limit > 0 ? limit : POSTER_CANVAS_EDGE_RANGE.max;
  const effective = Math.min(requested, edge / width, edge / height);
  return {
    width: Math.max(1, Math.round(width * effective)),
    height: Math.max(1, Math.round(height * effective)),
    scale: effective,
    requestedScale: requested,
    clamped: effective < requested - 1e-9
  };
}

// ---------------------------------------------------------------------------
// 文案变量（FR-304）：15 个变量名 → 渲染上下文里的字段
// ---------------------------------------------------------------------------

const variableValue = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return value.trim();
  // 布尔 / 数组 / 对象一律当「没有值」—— 绝不把 `[object Object]` 印到孩子的海报上。
  return '';
};

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** `{日期}` 的展示口径：认得 `2026-08-04` / `2026.08.04` / Date 就归一成 `YYYY.MM.DD`，认不出来原样返回。 */
function posterDateText(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}.${pad2(value.getMonth() + 1)}.${pad2(value.getDate())}`;
  }
  const text = String(value ?? '').trim();
  if (!text) return '';
  const separated = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (separated) return `${separated[1]}.${pad2(separated[2])}.${pad2(separated[3])}`;
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}.${compact[2]}.${compact[3]}`;
  return text;
}

/**
 * 渲染上下文：把 `data` 里的文案字段收敛成**一定是字符串**的一层。
 * 变量表（`POSTER_VARIABLE_KEYS`）是唯一真源：表里有什么字段，这里就有什么字段
 * （多出来的字段不进上下文 —— 免得「模板里能用什么变量」出现第二份答案）。
 */
export function posterVariableContext(data = {}) {
  const source = data && typeof data === 'object' ? data : {};
  const context = {};
  for (const key of Object.values(POSTER_VARIABLE_KEYS)) {
    context[key] = variableValue(source[key]);
  }
  context.date = posterDateText(source.date !== undefined ? source.date : context.date);
  return context;
}

/** 变量替换（海报变量表）。未知占位符保留原文、命中但没值替换成空串 —— 与装裱同一支实现。 */
export function applyPosterVariables(template, context = {}) {
  return applyOverlayVariables(template, context, POSTER_VARIABLE_KEYS);
}

// ---------------------------------------------------------------------------
// 文本换行与省略（FR-305 / FR-311）
// ---------------------------------------------------------------------------

/**
 * 按字符测量宽度自动换行：中文没有空格，**必须逐字测量**（依赖 `\n` 或自动断词都不成立）。
 * 拉丁单词尽量不拆（整词放不下时退化为逐字符），显式 `\n` 是强制换行。
 *
 * `measure(text)` 是**注入的**测量函数（浏览器里是 `ctx.measureText(...).width`，
 * 断言里可以给一个确定性的假测量）—— 换行与省略的判据因此可以脱离 canvas 单独验证。
 * `letterSpacing` 由本函数自己加上（注入的 measure 只管不含字距的字符串宽度）。
 */
export function layoutPosterText({ text, maxWidth, maxLines = 1, letterSpacing = 0, measure, fontSize = 0 } = {}) {
  const source = String(text ?? '');
  const width = Number(maxWidth);
  const limit = Number.isFinite(width) && width > 0 ? width : 0;
  const lineLimit = Math.max(1, Math.round(Number(maxLines) || 1));
  const spacing = Number.isFinite(Number(letterSpacing)) && Number(letterSpacing) > 0 ? Number(letterSpacing) : 0;
  const base = typeof measure === 'function'
    ? measure
    : (value) => estimateTextWidth(value, fontSize);
  const measureLine = (value) => {
    if (!value) return 0;
    return base(value) + spacing * Math.max(0, [...value].length - 1);
  };
  const empty = { lines: [], truncated: false, dropped: 0, text: source };
  if (!source.trim() || !limit) return empty;

  const lines = [];
  for (const paragraph of source.split('\n')) {
    let line = '';
    const pushLine = () => { lines.push(line.replace(/\s+$/, '')); line = ''; };
    // 词元：一段拉丁字母 / 数字连写算一个整体，其余（中日韩字、空格、标点）逐字符。
    for (const token of paragraph.match(/[A-Za-z0-9]+|[\s\S]/g) || []) {
      if (line && measureLine(line + token) > limit) {
        pushLine();
        if (/^\s+$/.test(token)) continue; // 换行处的空格吞掉，不让它顶到行首
      }
      if (!line && measureLine(token) > limit) {
        // 单个词元本身就超宽（长英文单词 / 连续数字）→ 逐字符硬拆。
        for (const character of token) {
          if (line && measureLine(line + character) > limit) pushLine();
          line += character;
        }
        continue;
      }
      line += token;
    }
    if (line.trim()) lines.push(line.replace(/\s+$/, ''));
  }
  if (!lines.length) return empty;
  if (lines.length <= lineLimit) {
    return { lines, truncated: false, dropped: 0, text: source };
  }

  // 超出 maxLines：保留前 N 行，最后一行腾出省略号的位置（FR-311）。
  const kept = lines.slice(0, lineLimit);
  const rest = lines.slice(lineLimit).join('').length;
  let last = kept[lineLimit - 1];
  let trimmed = 0;
  while (last.length > 0 && measureLine(last + POSTER_ELLIPSIS) > limit) {
    last = last.slice(0, -1);
    trimmed += 1;
  }
  kept[lineLimit - 1] = `${last.replace(/\s+$/, '')}${POSTER_ELLIPSIS}`;
  return { lines: kept, truncated: true, dropped: rest + trimmed, text: source };
}

/** 溢出警告文案（FR-311 的「预览与导出前给出溢出警告」；界面直接渲染这一句，不许自己拼）。 */
export function posterTextOverflowWarning(slot, layout) {
  const id = slot?.id || slot?.type || '文字位';
  const dropped = Math.max(0, Math.round(Number(layout?.dropped) || 0));
  return `文字位「${id}」超出 ${Math.max(1, Math.round(Number(slot?.maxLines) || 1))} 行，已省略 ${dropped} 个字`;
}

/** 拼贴超上限的提示（US-304 的「共 N 幅，已收录 M 幅」；界面直接渲染这一句）。 */
export function posterGridTrimWarning(slot, shape) {
  const id = slot?.id || slot?.type || '作品区';
  return `作品位「${id}」共 ${shape?.total ?? 0} 幅，已按课次均匀精选 ${shape?.count ?? 0} 幅`;
}

// ---------------------------------------------------------------------------
// 素材解码与分配（坏素材只让这一支消失，不让整张海报失败）
// ---------------------------------------------------------------------------

/** 解码结果的小缓存：同一张素材在一屏模板缩略图里会被解码很多次（换模板重绘 ≤300ms 的口径）。 */
const posterImageCache = new Map();
const POSTER_IMAGE_CACHE_LIMIT = 24;

/** 解码一张素材；**失败一律 `null`**（画笔据此跳过这一支）。跨域素材必须匿名请求，否则画布被污染。 */
export function decodePosterImage(source) {
  const url = posterImageUrl(source);
  if (!url) return Promise.resolve(null);
  if (posterImageCache.has(url)) return posterImageCache.get(url);
  const promise = new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve(null); return; }
    const image = new Image();
    if (/^https?:/i.test(url)) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
  if (posterImageCache.size >= POSTER_IMAGE_CACHE_LIMIT) posterImageCache.clear();
  posterImageCache.set(url, promise);
  return promise;
}

/**
 * 一组素材 → 条目列表（**唯一**的入参归一入口）：
 *   - 字符串 / `{ url }` 对象 → 单条；
 *   - 数组 → 逐条（元素可以是字符串或 `{ url, caption }`，`caption` 供每格标注用）；
 *   - 空值 → 空列表（那一支不画，不猜）。
 * 条目里 `url` 一律过素材地址闸（不把任意串当图片地址），`{ url: '' }` 是**占位格**
 * （保留格子、不画图 —— FR-321 的班级占位格就是这个形状）；
 * 占位格可以再带一句 `placeholderText`（如「本期暂无作品」），它会画在格子里（见
 * `paintPosterCellPlaceholder`）——「保留占位格」才是验收要的东西，一块空白卡片不是。
 */
export function posterImageEntries(value) {
  const list = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
  return list.map((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return {
        url: posterImageUrl(item.url),
        caption: variableValue(item.caption),
        placeholderText: variableValue(item.placeholderText)
      };
    }
    return { url: posterImageUrl(item), caption: '', placeholderText: '' };
  });
}

/**
 * 素材分配：`spec` 的每个 image 占位区 → 条目列表（渲染前一次性算好，纯函数、无副作用）。
 *
 * 三种入参形状（渲染层唯一认这三种，别在调用点各拼一份）：
 *   - `data.images` 是**字符串 / 数组** → 归**第一个** image 占位区（多幅即拼贴）；
 *   - `data.images` 是**对象** → 按占位区 id 取（`{ artwork: '…', collage: [...] }`），
 *     没命中的 image 占位区**不画**（不猜素材）；
 *   - `data.image` 是「只出一张图」的便捷写法（等价于 `images` 给单个字符串）。
 */
export function posterImagePlan(spec, data = {}) {
  const normalized = normalizePosterSpec(spec);
  const source = data && typeof data === 'object' ? data : {};
  const raw = source.images !== undefined ? source.images : source.image;
  const keyed = raw && typeof raw === 'object' && !Array.isArray(raw);
  const plan = {};
  let unkeyedTaken = false;
  for (const slot of normalized.slots) {
    if (slot.type !== 'image') continue;
    let value = null;
    if (keyed) {
      if (Object.prototype.hasOwnProperty.call(raw, slot.id)) value = raw[slot.id];
    } else if (!unkeyedTaken && raw !== undefined && raw !== null && raw !== '') {
      value = raw;
      unkeyedTaken = true;
    }
    plan[slot.id] = posterImageEntries(value);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// 绘制小工具
// ---------------------------------------------------------------------------

/** 圆角矩形路径（半径为 0 时退化成直角矩形；与装裱的框 / 卡纸同一套写法）。 */
function roundedRectPath(ctx, rect, radius) {
  const r = Math.max(0, Math.min(Number(radius) || 0, rect.width / 2, rect.height / 2));
  ctx.beginPath();
  if (r > 0) { ctx.roundRect(rect.x, rect.y, rect.width, rect.height, r); return; }
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
}

/** CSS 口径的线性渐变端点（0deg = 向上、90deg = 向右、135deg = 右下）。 */
function gradientEndpoints(rect, angle) {
  const degrees = Number.isFinite(Number(angle)) ? Number(angle) : 135;
  const radians = (degrees * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const half = (Math.abs(dx) * rect.width + Math.abs(dy) * rect.height) / 2;
  return { x0: cx - dx * half, y0: cy - dy * half, x1: cx + dx * half, y1: cy + dy * half };
}

/** contain 适配：等比缩放 + 居中（**绝不裁切**，多余的空间留给白底）。 */
export function containPosterRect(box, imageWidth, imageHeight) {
  const w = Number(imageWidth) > 0 ? Number(imageWidth) : 1;
  const h = Number(imageHeight) > 0 ? Number(imageHeight) : 1;
  const scale = Math.min(box.width / w, box.height / h);
  const width = w * scale;
  const height = h * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
    scale
  };
}

/** cover 适配（**只用于背景底图**：它是底，不是孩子的作品）。 */
function coverRect(box, imageWidth, imageHeight) {
  const w = Number(imageWidth) > 0 ? Number(imageWidth) : 1;
  const h = Number(imageHeight) > 0 ? Number(imageHeight) : 1;
  const scale = Math.max(box.width / w, box.height / h);
  const width = w * scale;
  const height = h * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height, scale };
}

function insetRect(rect, distance) {
  const dx = Math.min(Math.max(0, Number(distance) || 0), rect.width / 2);
  const dy = Math.min(Math.max(0, Number(distance) || 0), rect.height / 2);
  return { x: rect.x + dx, y: rect.y + dy, width: Math.max(0, rect.width - dx * 2), height: Math.max(0, rect.height - dy * 2) };
}

/**
 * 一行文字：字距为 0 时整行 `fillText`（保留字形连写），否则逐字推进
 * （与装裱展签的 `drawWithSpacing` 同一口径：对齐语义按整行总宽算，不是按首字）。
 */
function paintPosterTextLine(ctx, { line, x, y, letterSpacing = 0, align = 'left' }) {
  if (!line) return;
  if (!letterSpacing) { ctx.fillText(line, x, y); return; }
  const characters = [...line];
  const widths = characters.map((character) => ctx.measureText(character).width);
  const total = widths.reduce((sum, value) => sum + value, 0) + Math.max(0, characters.length - 1) * letterSpacing;
  const start = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const previousAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  let cursor = start;
  characters.forEach((character, index) => {
    ctx.fillText(character, cursor, y);
    cursor += widths[index] + letterSpacing;
  });
  ctx.textAlign = previousAlign;
}

const alphaOf = (value) => (Number.isFinite(Number(value)) ? Math.min(1, Math.max(0, Number(value))) : 1);

// ---------------------------------------------------------------------------
// 占位区画笔（每个画笔返回该占位区的 plan 条目）
// ---------------------------------------------------------------------------

function paintPosterBackground(ctx, { background, canvas, image }) {
  const rect = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  if (background.image && image) {
    // 预留字段位（第二期的手绘底图）：底图铺满画布算 cover —— 它是底，不是孩子的作品。
    const cover = coverRect(rect, image.naturalWidth, image.naturalHeight);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, rect.width, rect.height);
    ctx.clip();
    ctx.drawImage(image, cover.x, cover.y, cover.width, cover.height);
    ctx.restore();
    return { type: 'image', url: background.image };
  }
  if (background.type === 'linear-gradient' && background.stops.length > 1) {
    const points = gradientEndpoints(rect, background.angle);
    const gradient = ctx.createLinearGradient(points.x0, points.y0, points.x1, points.y1);
    const last = background.stops.length - 1;
    background.stops.forEach((color, index) => {
      gradient.addColorStop(last ? index / last : 0, color);
    });
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, rect.width, rect.height);
    return { type: 'linear-gradient', stops: [...background.stops], angle: background.angle };
  }
  ctx.fillStyle = background.stops[0] || '#FFFFFF';
  ctx.fillRect(0, 0, rect.width, rect.height);
  return { type: 'solid', color: background.stops[0] || '#FFFFFF' };
}

function paintPosterDecor(ctx, { decor, canvas }) {
  const hairline = decor.hairline;
  if (!hairline.visible) return null;
  const height = posterRatioToPixels(hairline.widthRatio, canvas);
  const box = {
    x: posterRatioToPixels(hairline.x, canvas),
    y: posterRatioToPixels(hairline.y, canvas),
    width: posterRatioToPixels(hairline.w, canvas),
    height: Math.max(height, 0.5)
  };
  ctx.save();
  ctx.globalAlpha = alphaOf(hairline.opacity);
  ctx.fillStyle = hairline.color;
  ctx.fillRect(box.x, box.y, box.width, box.height);
  ctx.restore();
  return { ...box, color: hairline.color, opacity: hairline.opacity };
}

function paintPosterFrame(ctx, { frame, canvas }) {
  const ring = posterRatioToPixels(frame.widthRatio, canvas);
  const radius = posterRatioToPixels(frame.cornerRadiusRatio, canvas);
  if (!(ring > 0)) return null;
  const box = insetRect({ x: 0, y: 0, width: canvas.width, height: canvas.height }, ring / 2);
  ctx.save();
  ctx.strokeStyle = frame.color;
  ctx.lineWidth = ring;
  roundedRectPath(ctx, box, Math.max(0, radius - ring / 2));
  ctx.stroke();
  ctx.restore();
  return { ring, box, color: frame.color };
}

/**
 * 单张作品卡片（image slot 的基本单元，拼贴的每一格也走它）：
 * 白底（可配）→ 圆角 → 可选阴影 → 作品 contain 居中 → 可选边框。
 *
 * 作品**只做等比缩放与居中**：`drawImage` 只给目标框、不给源裁剪参数，也不设任何滤镜
 * （FR-309）。圆角裁的是卡纸的四个角 —— 内圈半径按「圆角 − 留白」缩小，留白足够时
 * 连这个裁剪都不发生（作品像素一个都不碰）。
 */
function paintPosterCard(ctx, { box, slot, image, canvas }) {
  const radius = posterRatioToPixels(slot.radiusRatio, canvas);
  const padding = posterRatioToPixels(slot.paddingRatio, canvas);
  const shortEdge = posterShortEdge(canvas);
  const alpha = alphaOf(slot.opacity);

  ctx.save();
  ctx.globalAlpha = alpha;
  if (slot.shadow) {
    ctx.shadowColor = POSTER_SHADOW.color;
    ctx.shadowBlur = shortEdge * POSTER_SHADOW.blurRatio;
    ctx.shadowOffsetY = shortEdge * POSTER_SHADOW.offsetYRatio;
  }
  roundedRectPath(ctx, box, radius);
  ctx.fillStyle = slot.bg;
  ctx.fill();
  ctx.restore();

  let imageBox = null;
  if (image) {
    const inner = insetRect(box, padding);
    if (inner.width > 0 && inner.height > 0) {
      imageBox = containPosterRect(inner, image.naturalWidth, image.naturalHeight);
      const innerRadius = Math.max(0, radius - padding);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (innerRadius > 0) { roundedRectPath(ctx, inner, innerRadius); ctx.clip(); }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, imageBox.x, imageBox.y, imageBox.width, imageBox.height);
      ctx.restore();
    }
  }

  let border = null;
  if (slot.border && slot.border.widthRatio > 0) {
    const lineWidth = posterRatioToPixels(slot.border.widthRatio, canvas);
    const strokeBox = insetRect(box, lineWidth / 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = slot.border.color;
    ctx.lineWidth = lineWidth;
    roundedRectPath(ctx, strokeBox, Math.max(0, radius - lineWidth / 2));
    ctx.stroke();
    ctx.restore();
    border = { box: strokeBox, color: slot.border.color, lineWidth };
  }
  return { box, imageBox, border };
}

/**
 * 占位格里的那句话（如「本期暂无作品」）：白卡片已经在 `paintPosterCard` 里画好，
 * 这里只把一句文案居中写进格子 —— 字号随格子宽度走、上限压在短边 3%（大格子里不至于夸张），
 * 超过两行时按渲染层统一的换行器截断（与文字位同一支 `layoutPosterText`）。
 *
 * 为什么必须有这一笔：`{url:''}` 的占位格在绘制层本来是「留一块白卡片」，而验收（FR-321）要的是
 * 「保留一个『本期暂无作品』占位格」—— 只留格子不写字，家长看不出那是「还没交作品」还是「漏了」。
 */
function paintPosterCellPlaceholder(ctx, { box, text, slot, canvas }) {
  const value = variableValue(text);
  const caption = slot.cellCaption || {};
  const padding = posterRatioToPixels(slot.paddingRatio, canvas);
  const maxWidth = Math.max(0, box.width - padding * 2);
  const fontSize = Math.min(
    box.width * POSTER_CELL_PLACEHOLDER_FONT_RATIO,
    posterShortEdge(canvas) * POSTER_CELL_PLACEHOLDER_MAX_RATIO
  );
  if (!value || !(fontSize > 0) || !(maxWidth > 0)) return null;
  const font = `${fontSize}px sans-serif`;
  ctx.save();
  ctx.globalAlpha = alphaOf(slot.opacity);
  // **先设字体再测量**（与文字位同一条纪律：measureText 量的是当前字体）。
  ctx.font = font;
  ctx.fillStyle = caption.color || POSTER_MUTED_COLORS.brown;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const measure = (needle) => ctx.measureText(needle).width;
  const layout = layoutPosterText({ text: value, maxWidth, maxLines: POSTER_CELL_PLACEHOLDER_MAX_LINES, measure });
  const lineHeight = fontSize * 1.35;
  const totalHeight = lineHeight * layout.lines.length;
  const startY = box.y + Math.max(0, (box.height - totalHeight) / 2);
  layout.lines.forEach((line, index) => {
    ctx.fillText(line, box.x + box.width / 2, startY + index * lineHeight);
  });
  ctx.restore();
  if (!layout.lines.length) return null;
  return { text: value, lines: layout.lines, truncated: layout.truncated, box, fontSize, lineHeight, centerX: box.x + box.width / 2 };
}

/** 每格下方（或上方）的课次日期 / 作品名标注（`cellCaption`）。 */
function paintPosterCellCaption(ctx, { box, text, slot, canvas }) {  const caption = slot.cellCaption;
  const fontSize = posterRatioToPixels(caption.sizeRatio, canvas);
  if (!text || !(fontSize > 0) || !(box.width > 0)) return null;
  ctx.save();
  ctx.globalAlpha = alphaOf(slot.opacity);
  ctx.fillStyle = caption.color;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const measure = (value) => ctx.measureText(value).width;
  const layout = layoutPosterText({ text, maxWidth: box.width, maxLines: caption.maxLines, measure });
  const lineHeight = fontSize * 1.3;
  layout.lines.forEach((line, index) => {
    ctx.fillText(line, box.x + box.width / 2, box.y + index * lineHeight);
  });
  ctx.restore();
  if (!layout.lines.length) return null;
  return { text: layout.text, lines: layout.lines, truncated: layout.truncated, fontSize, lineHeight, box };
}

function drawTextSlot(ctx, { slot, canvas, context, warnings }) {
  const template = applyPosterVariables(slot.template, context);
  const x = posterRatioToPixels(slot.x, canvas);
  const y = posterRatioToPixels(slot.y, canvas);
  const maxWidth = posterRatioToPixels(slot.w, canvas);
  const fontSize = posterRatioToPixels(slot.sizeRatio, canvas);
  const letterSpacing = posterRatioToPixels(slot.letterSpacingRatio, canvas);
  const text = template.text.trim();
  const font = `${slot.weight} ${fontSize}px ${slot.font}`;
  const base = {
    id: slot.id,
    type: 'text',
    text: template.text,
    missing: template.missing,
    empty: template.empty,
    box: { x, y, width: maxWidth, height: 0 }
  };
  if (!text || !(fontSize > 0) || !(maxWidth > 0)) {
    return { ...base, drawn: false, reason: text ? 'empty-box' : 'empty-text' };
  }
  // **先设字体再测量**：`measureText` 量的是当前字体，字体没设就量等于拿默认 10px 去断行
  // （表现是「怎么都不换行、整行溢出画布」——本轮真踩到）。测量与绘制因此共用同一个 `font`。
  ctx.save();
  ctx.font = font;
  const measure = (value) => ctx.measureText(value).width;
  const layout = layoutPosterText({ text, maxWidth, maxLines: slot.maxLines, letterSpacing, measure });
  if (!layout.lines.length) {
    ctx.restore();
    return { ...base, drawn: false, reason: 'empty-text' };
  }
  const anchorX = slot.align === 'center' ? x + maxWidth / 2 : slot.align === 'right' ? x + maxWidth : x;
  const lineHeight = fontSize * slot.lineHeight;
  ctx.globalAlpha = alphaOf(slot.opacity);
  ctx.fillStyle = slot.color;
  ctx.textAlign = slot.align;
  ctx.textBaseline = 'top';
  layout.lines.forEach((line, index) => {
    paintPosterTextLine(ctx, { line, x: anchorX, y: y + index * lineHeight, letterSpacing, align: slot.align });
  });
  ctx.restore();
  if (layout.truncated) warnings.push(posterTextOverflowWarning(slot, layout));
  return {
    ...base,
    drawn: true,
    lines: layout.lines,
    truncated: layout.truncated,
    dropped: layout.dropped,
    box: { x, y, width: maxWidth, height: lineHeight * layout.lines.length },
    anchorX,
    fontSize,
    lineHeight,
    letterSpacing,
    align: slot.align,
    font,
    color: slot.color,
    opacity: slot.opacity
  };
}

function drawImageSlot(ctx, { slot, canvas, context, entries, warnings }) {
  const shape = posterGridShape({
    columns: slot.grid.columns,
    rows: slot.grid.rows,
    count: entries.length,
    maxItems: slot.grid.maxItems
  });
  const sampled = posterEvenSample(entries, slot.grid.maxItems);
  const box = {
    x: posterRatioToPixels(slot.x, canvas),
    y: posterRatioToPixels(slot.y, canvas),
    width: posterRatioToPixels(slot.w, canvas),
    height: posterRatioToPixels(slot.h, canvas)
  };
  const base = { id: slot.id, type: 'image', box, layout: shape };
  if (!(box.width > 0) || !(box.height > 0)) {
    return { ...base, drawn: false, reason: 'empty-box' };
  }
  if (!sampled.length) {
    return { ...base, drawn: false, reason: 'no-image' };
  }
  if (shape.trimmed > 0) warnings.push(posterGridTrimWarning(slot, shape));

  const grid = shape.count > 1;
  const columns = grid ? shape.columns : 1;
  const rows = grid ? shape.rows : 1;
  const gap = grid ? posterRatioToPixels(slot.grid.gapRatio, canvas) : 0;
  const cellWidth = (box.width - gap * (columns - 1)) / columns;
  const cellHeight = (box.height - gap * (rows - 1)) / rows;
  const captionHeight = slot.cellCaption.visible ? posterRatioToPixels(slot.cellCaption.sizeRatio, canvas) * 1.3 : 0;
  const captionBelow = slot.cellCaption.position === 'below';

  const cells = [];
  for (let index = 0; index < shape.count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellBox = {
      x: box.x + column * (cellWidth + gap),
      y: box.y + row * (cellHeight + gap),
      width: cellWidth,
      height: cellHeight
    };
    const cardBox = captionHeight > 0
      ? {
        x: cellBox.x,
        y: captionBelow ? cellBox.y : cellBox.y + captionHeight,
        width: cellBox.width,
        height: Math.max(0, cellBox.height - captionHeight)
      }
      : cellBox;
    const captionBox = captionHeight > 0
      ? {
        x: cellBox.x,
        y: captionBelow ? cellBox.y + cellBox.height - captionHeight : cellBox.y,
        width: cellBox.width,
        height: captionHeight
      }
      : null;
    const entry = sampled[index] || null;
    const image = entry?.image || null;
    const painted = paintPosterCard(ctx, { box: cardBox, slot, image, canvas });
    // 没有作品的那一格：白卡片已经画好，再把「本期暂无作品」写进去（FR-321 的占位格）。
    const placeholder = image
      ? null
      : paintPosterCellPlaceholder(ctx, { box: cardBox, text: entry?.placeholderText || '', slot, canvas });
    const captionText = entry?.caption ? applyPosterVariables(entry.caption, context).text : '';
    const caption = captionBox ? paintPosterCellCaption(ctx, { box: captionBox, text: captionText, slot, canvas }) : null;
    cells.push({
      index,
      box: cardBox,
      imageBox: painted.imageBox,
      border: painted.border,
      captionBox,
      caption,
      placeholder,
      placeholderText: entry?.placeholderText || '',
      url: entry?.url || '',
      drawn: !!image
    });
  }
  return {
    ...base,
    drawn: cells.some((cell) => cell.drawn),
    reason: cells.some((cell) => cell.drawn) ? '' : 'decode-failed',
    layout: {
      ...shape,
      gap,
      columns,
      rows,
      cellWidth,
      cellHeight,
      captionHeight,
      captionPosition: slot.cellCaption.position
    },
    cells
  };
}

function drawQrSlot(ctx, { slot, canvas, context }) {
  const value = applyPosterVariables(slot.value, context);
  const payload = value.text.trim();
  const size = posterRatioToPixels(slot.sizeRatio, canvas);
  const box = {
    x: posterRatioToPixels(slot.x, canvas),
    y: posterRatioToPixels(slot.y, canvas),
    width: size,
    height: size
  };
  const base = { id: slot.id, type: 'qrcode', box, value: payload, missing: value.missing, empty: value.empty };
  if (!payload) return { ...base, drawn: false, reason: 'empty-value' };
  const matrix = qrMatrix(payload, { ecc: QR_DEFAULT_ECC });
  if (!matrix || !(size > 0)) return { ...base, drawn: false, reason: 'unencodable' };
  const moduleSize = size / matrix.size;
  const quiet = moduleSize * QR_QUIET_MODULES;
  const plate = { x: box.x - quiet, y: box.y - quiet, width: size + quiet * 2, height: size + quiet * 2 };
  paintQrMatrixBox(ctx, { matrix, box, plate, plateColor: slot.bg });
  let caption = null;
  if (slot.caption) {
    const fontSize = posterRatioToPixels(slot.captionSizeRatio, canvas);
    ctx.save();
    ctx.globalAlpha = alphaOf(slot.opacity);
    ctx.fillStyle = slot.captionColor;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const captionY = plate.y + plate.height + fontSize * 0.4;
    ctx.fillText(slot.caption, plate.x + plate.width / 2, captionY);
    ctx.restore();
    caption = { text: slot.caption, fontSize, box: { x: plate.x, y: captionY, width: plate.width, height: fontSize * 1.3 } };
  }
  return {
    ...base,
    drawn: true,
    box,
    plate,
    quiet,
    moduleSize,
    modules: matrix.size,
    version: matrix.version,
    ecc: matrix.ecc,
    caption
  };
}

function drawLogoSlot(ctx, { slot, canvas, logo = {} }) {
  const box = {
    x: posterRatioToPixels(slot.x, canvas),
    y: posterRatioToPixels(slot.y, canvas),
    width: posterRatioToPixels(slot.maxWRatio, canvas),
    height: 0
  };
  const url = logo.source || slot.url || '';
  if (!logo.image || !(box.width > 0)) {
    return { id: slot.id, type: 'logo', drawn: false, reason: 'no-logo-image', box, url };
  }
  const image = logo.image;
  const ratio = image.naturalWidth > 0 ? image.naturalHeight / image.naturalWidth : 0.3;
  // Logo 原样等比：宽度按 `maxWRatio`，高度按图片自身比例 —— 不拉伸（拉伸的 Logo 一眼假）。
  box.height = box.width * ratio;
  ctx.save();
  ctx.globalAlpha = alphaOf(slot.opacity);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, box.x, box.y, box.width, box.height);
  ctx.restore();
  return { id: slot.id, type: 'logo', drawn: true, box, url, source: { width: image.naturalWidth, height: image.naturalHeight } };
}

// ---------------------------------------------------------------------------
// 渲染主流程
// ---------------------------------------------------------------------------

/**
 * 渲染到画布（预览 / 导出 / 缩略图共用；`renderPoster` 在它之上加编码）。
 * 返回 `null` 表示当前环境没有 canvas（Node / 老浏览器）—— 调用方自己决定怎么降级。
 */
export async function renderPosterToCanvas({ spec, data = {}, scale = 1, maxEdge = POSTER_CANVAS_EDGE_RANGE.max } = {}) {
  if (typeof document === 'undefined') return null;
  const normalized = normalizePosterSpec(spec);
  const canvasSpec = normalized.canvas;
  const shortEdge = posterShortEdge(canvasSpec);
  const size = posterCanvasScale({ canvas: canvasSpec, scale, maxEdge });
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // 逻辑坐标 → 设备像素只做这一次映射：字号 / 位置 / 圆角 / 阴影全部按逻辑坐标算。
  ctx.scale(size.width / canvasSpec.width, size.height / canvasSpec.height);

  const context = posterVariableContext(data);
  const warnings = [];
  const slots = Array.isArray(normalized.slots) ? normalized.slots : [];
  const imagePlan = posterImagePlan(normalized, data);

  // 先把要画的素材全部解码好（一次并行），再同步落笔 —— 绘制顺序因此与 slots 顺序严格一致。
  const decoded = new Map();
  await Promise.all(slots.map(async (slot) => {
    if (slot.type === 'image') {
      const entries = imagePlan[slot.id] || [];
      decoded.set(slot, await Promise.all(entries.map(async (entry) => ({ ...entry, image: await decodePosterImage(entry.url) }))));
      return;
    }
    if (slot.type === 'logo') {
      // 模板自带的 Logo 优先，否则用渲染时传进来的 `data.logo`（两条都过同一把素材地址闸）。
      const source = slot.url || posterImageUrl(data && typeof data === 'object' ? data.logo : '');
      decoded.set(slot, { source, image: await decodePosterImage(source) });
    }
  }));
  const backgroundImage = normalized.background.image ? await decodePosterImage(normalized.background.image) : null;

  const plan = {
    kind: normalized.kind,
    canvas: {
      width: canvasSpec.width,
      height: canvasSpec.height,
      shortEdge,
      scale: size.scale,
      requestedScale: size.requestedScale,
      clamped: size.clamped,
      deviceWidth: size.width,
      deviceHeight: size.height
    },
    background: paintPosterBackground(ctx, { background: normalized.background, canvas: canvasSpec, image: backgroundImage }),
    decor: paintPosterDecor(ctx, { decor: normalized.decor, canvas: canvasSpec }),
    frame: null,
    slots: []
  };

  for (const slot of slots) {
    // 不可见的占位区**完全不进绘制层**：不画、不留空白占位（与装裱 US-003a 同一条纪律）。
    if (slot.visible === false) {
      plan.slots.push({ id: slot.id, type: slot.type, drawn: false, reason: 'hidden' });
      continue;
    }
    if (slot.type === 'text') {
      plan.slots.push(drawTextSlot(ctx, { slot, canvas: canvasSpec, context, warnings }));
      continue;
    }
    if (slot.type === 'image') {
      plan.slots.push(drawImageSlot(ctx, { slot, canvas: canvasSpec, context, entries: decoded.get(slot) || [], warnings }));
      continue;
    }
    if (slot.type === 'qrcode') {
      plan.slots.push(drawQrSlot(ctx, { slot, canvas: canvasSpec, context }));
      continue;
    }
    plan.slots.push(drawLogoSlot(ctx, { slot, canvas: canvasSpec, logo: decoded.get(slot) || {} }));
  }

  // 相框最后画：它是整张海报最外圈的一道装饰，任何占位区都不该盖住它。
  if (normalized.frame.enabled) {
    plan.frame = paintPosterFrame(ctx, { frame: normalized.frame, canvas: canvasSpec });
  }

  return {
    spec: normalized,
    canvas,
    plan,
    warnings,
    width: size.width,
    height: size.height,
    logicalWidth: canvasSpec.width,
    logicalHeight: canvasSpec.height,
    shortEdge,
    scale: size.scale,
    requestedScale: size.requestedScale,
    scaleClamped: size.clamped
  };
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') { resolve(null); return; }
    const done = (blob) => resolve(blob || null);
    if (quality === undefined || quality === null) canvas.toBlob(done, mimeType);
    else canvas.toBlob(done, mimeType, quality);
  });
}

/**
 * 渲染一张海报：`renderPoster({ spec, data, scale })` → `{ blob, dataURL, canvas, plan, warnings, … }`。
 *
 * **预览与导出就是这一个函数、只差 `scale`**（FR-312）：`scale = 1` 得 1080 宽的预览图、
 * `scale = 2` 得 2160 宽的导出图，两者是同一次绘制的两种分辨率 —— 不存在「预览一套、导出一套」。
 * `type` / `quality` 是编码档（缺省 PNG；导出故事 US-311a 会传 JPEG + 质量）。
 *
 * `encodeDataURL = false` = **不产 `dataURL`**（返回 `''`）：那是一次**同步**的全图 base64 编码，
 * 会给导出路径多留一份整图字符串（内存）并把主线程按住一小会儿 —— 导出只交付 `blob`，
 * 所以导出档（`renderPosterDialogExport`）关掉它（[海报 US-314] / FR-364、FR-365）。
 * 预览与缩略图仍按原口径带 `dataURL`（既有调用方一字不改）。
 *
 * 没有 canvas 能力的环境返回 `null`（本工程只在浏览器里跑海报渲染）。
 */
export async function renderPoster({ spec, data = {}, scale = 1, type = POSTER_MIME_PNG, quality, maxEdge = POSTER_CANVAS_EDGE_RANGE.max, encodeDataURL = true } = {}) {
  const rendered = await renderPosterToCanvas({ spec, data, scale, maxEdge });
  if (!rendered) return null;
  const mimeType = type === POSTER_MIME_JPEG ? POSTER_MIME_JPEG : POSTER_MIME_PNG;
  const jpegQuality = mimeType === POSTER_MIME_JPEG
    ? (Number.isFinite(Number(quality)) ? Number(quality) : 0.92)
    : undefined;
  const blob = await canvasToBlob(rendered.canvas, mimeType, jpegQuality);
  return {
    ...rendered,
    blob,
    dataURL: encodeDataURL === false ? '' : rendered.canvas.toDataURL(mimeType, jpegQuality),
    bytes: blob ? blob.size : 0,
    mimeType,
    quality: jpegQuality === undefined ? null : jpegQuality,
    encoded: !!blob,
    dataURLSkipped: encodeDataURL === false
  };
}

/** 预览用的地址（object URL，用完必须 `releasePosterUrl` 回收）。 */
export function createPosterUrl(result) {
  return result?.blob ? URL.createObjectURL(result.blob) : '';
}

export function releasePosterUrl(url) {
  if (url) URL.revokeObjectURL(url);
}
