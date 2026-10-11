/**
 * 单幅作品的编辑状态 `artworkEdit`
 * （US-004a「编辑器旋转与撤销重做」/ US-004b「裁剪框与比例预设」/ US-004c「缩放平移与低分辨率预览节流」；
 * PRD FR-5/FR-6/FR-7 与 US-005 的撤销栈）。
 *
 * 与 `data/mediaValidation.js` / `data/intakePerformance.js` 同一套纪律：**零依赖纯函数 + 常量**，
 * 不 import 任何模块、不碰 DOM、不碰网络，可以直接用 Node 跑断言（见 prototype/AGENTS.md 的「验证技巧」）。
 * 浏览器侧只保留「必须有 canvas 才能做」的部分（把角度真的画出来）在 `services/artworkEditor.js`。
 *
 * 这里放五件事，每一件都只有一份真源：
 * 1. `artworkEdit` 的形状（`rotateDeg / crop / zoom / offsetX / offsetY`，FR-5）与归一化 —— 脏数据永不抛错；
 * 2. 旋转角度的算法：90° 粗旋转 + 任意角度微调（±15°、步进 0.5°，US-004a 验收）；
 * 3. 撤销 / 重做的历史栈（验收要求「至少 20 步」，上限 `ARTWORK_EDIT_HISTORY_LIMIT` = 40 步）；
 * 4. 缩放 / 平移的几何与规则（0.5×–5×、锚点缩放、按裁剪窗口的偏移区间，US-004c）——
 *    编辑器舞台的 CSS transform 与 `renderArtworkCrop` 的裁剪渲染都读这一份（`artworkImageTransform` /
 *    `artworkContentRect`），所以「看到的」与「成品图」不可能对不上；
 * 5. 界面用的可读文案（`rotationSummary` / `artworkViewSummary` / `describeArtworkEdit`）。
 *
 * 铁律：编辑结果只写进这一个对象，**原图 `originalUrl` 全程只读**（FR-5 / FR-30），
 * 也不进装裱模板（模板是 `spec`，那是 `frameSpec.js` 的事，两者互不覆盖）。
 */

/** 编辑状态的结构版本。改结构时 +1（与 frameSpec 的 version 同一套用法）。 */
export const ARTWORK_EDIT_VERSION = 1;

/** 90° 粗旋转的步进：左旋 / 右旋各一步。 */
export const ROTATE_STEP_DEG = 90;

/** 任意角度微调：范围 ±15°、步进 0.5°（US-004a 验收原文）。 */
export const FINE_ROTATION_RANGE = { min: -15, max: 15, step: 0.5 };

/** 微调按钮一步的度数。 */
export const FINE_ROTATION_STEP = FINE_ROTATION_RANGE.step;

/** 撤销栈上限：验收要求「至少 20 步」，这里留 40 步余量（limit 指最多可撤销多少步）。 */
export const ARTWORK_EDIT_HISTORY_LIMIT = 40;

/** 编辑态实时预览的长边上限：低分辨率画布先保证跟手，高清图在确认编辑时才合成。 */
export const EDIT_PREVIEW_MAX_EDGE = 900;

/** 高清预览的长边上限（US-004c「停止操作 300ms 后合成高清预览」）。 */
export const EDIT_PREVIEW_HD_MAX_EDGE = 2400;

/** 停止操作多久算「停手」：300ms 后合成高清预览，同时把缩放/平移压成一步撤销栈。 */
export const ARTWORK_PREVIEW_SETTLE_MS = 300;

/** 缩放范围（US-004c 的 0.5×–5×）与平移范围，先落成常量给下游故事复用，收敛在这里一处。 */
export const ARTWORK_ZOOM_RANGE = { min: 0.5, max: 5 };

/**
 * 缩放值的量化步进（0.01）：滚轮与双指是连续量，不量化的话读数、缓存键与撤销栈里全是
 * `1.0000000000000002` 这类噪声。
 */
export const ARTWORK_ZOOM_QUANTIZE = 0.01;

/** 缩放按钮一步的倍率（放大 ×1.25 / 缩小 ÷1.25）。 */
export const ARTWORK_ZOOM_BUTTON_FACTOR = 1.25;

/** 滚轮灵敏度：一格 ≈ 1.2 倍（`pow(1+s, -deltaY)`，向上滚 deltaY 为负 = 放大）。 */
export const ARTWORK_ZOOM_WHEEL_SENSITIVITY = 0.0015;

/** 单次滚轮事件最多缩放多少倍（触控板惯性滚动时防止一帧跳到底）。 */
export const ARTWORK_ZOOM_WHEEL_MAX_FACTOR = 1.5;

/**
 * 平移的**绝对**上限（±9 个窗口宽/高）。真正的可用区间由 `artworkOffsetBounds()` 按「内容与裁剪窗口的关系」
 * 推出来，这里只是脏数据兜底：最小裁剪框是 10%，此时整幅画面最多能在窗口里平移 9 个窗口宽。
 */
export const ARTWORK_OFFSET_RANGE = { min: -9, max: 9 };

/** 没有裁剪框时的窗口 = 整幅画面。 */
const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 };

/** `artworkEdit` 的字段清单：构造与归一化的唯一真源（界面只读这些字段）。 */
export const ARTWORK_EDIT_FIELDS = ['version', 'rotateDeg', 'crop', 'zoom', 'offsetX', 'offsetY'];

const clampNumber = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/** 认不出的值（NaN / 字符串 / null / 缺省）一律按 0° 处理，不抛错。 */
function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** 消掉 `-0`：`-0 === 0` 但 `Object.is(-0,0)` 为假，断言与缓存键都会因此漂移。 */
function trimZero(value) {
  return value === 0 ? 0 : value;
}

/** 角度归一化到 `[0, 360)`。 */
export function normalizeRotationDeg(value) {
  const number = finiteOr(value, 0);
  return trimZero(((number % 360) + 360) % 360);
}

/** 把角度量化到 0.5° 的整数倍（微调的步进），并消掉 `-0`。 */
export function quantizeRotationDeg(value) {
  const number = finiteOr(value, 0);
  return trimZero(Math.round((number / FINE_ROTATION_STEP)) * FINE_ROTATION_STEP);
}

/** 距离最近的 90° 整角（粗旋转的基准），结果 ∈ {0, 90, 180, 270}。 */
export function quarterBaseOf(value) {
  const normalized = normalizeRotationDeg(value);
  return normalizeRotationDeg(Math.round(normalized / ROTATE_STEP_DEG) * ROTATE_STEP_DEG);
}

/**
 * 相对最近 90° 整角的微调量，∈ [-45, 45]。
 * 之所以按「最近整角」而不是「向下取整」：换 90° 时微调量要跟着一起转过去，
 * 否则「右旋 90° + 微调 3°」会变成 273°（微调被吞进粗旋转里，界面上看不出为什么）。
 */
export function fineRotationOf(value) {
  const normalized = normalizeRotationDeg(value);
  const base = Math.round(normalized / ROTATE_STEP_DEG) * ROTATE_STEP_DEG;
  return trimZero(normalized - base);
}

function clampFineRotation(value) {
  return trimZero(clampNumber(quantizeRotationDeg(value), FINE_ROTATION_RANGE.min, FINE_ROTATION_RANGE.max));
}

/**
 * 裁剪矩形归一化：`{x, y, w, h}` 都是 0–1 的相对值（US-004b 写入，本故事先收敛好形状）。
 * 认不出来（缺值 / 非数字 / 宽高非正）一律 `null` = 未裁剪 —— 不要编造一个「看起来有裁剪」的框。
 */
export function normalizeCrop(crop) {
  if (!crop || typeof crop !== 'object') return null;
  const x = Number(crop.x);
  const y = Number(crop.y);
  const w = Number(crop.w);
  const h = Number(crop.h);
  if (![x, y, w, h].every((item) => Number.isFinite(item))) return null;
  if (w <= 0 || h <= 0) return null;
  const width = Math.min(1, w);
  const height = Math.min(1, h);
  return {
    x: trimZero(clampNumber(x, 0, 1 - width)),
    y: trimZero(clampNumber(y, 0, 1 - height)),
    w: trimZero(width),
    h: trimZero(height)
  };
}

// ---- 缩放 / 平移（US-004c）--------------------------------------------------------------
// 口径（三处共用这一份几何：编辑器舞台的 CSS transform、裁剪渲染 renderArtworkCrop、面板读数）：
//   * 缩放与平移都相对**裁剪窗口**（= artworkEdit.crop；没裁剪过时是整幅画面）表达；
//   * `zoom = 1` 且 `offsetX = offsetY = 0` 是 **identity**：内容原样铺在窗口上（逐像素等于没缩放）；
//   * `zoom` 以**窗口中心**为基准缩放；`offsetX/offsetY` 是「窗口宽/高的比例」（正数 = 内容往右下走）；
//   * 偏移永远被夹进 `artworkOffsetBounds()`：内容比窗口大时「刚好盖住窗口」，
//     比窗口小时「完全落在窗口内」—— 于是画面上不会出现内容之外的空背景。

/** 缩放收敛：夹在 0.5–5，量化到 0.01（读数与缓存键都不出现浮点噪声）。 */
export function clampArtworkZoom(value) {
  const number = finiteOr(value, 1);
  const clamped = clampNumber(number, ARTWORK_ZOOM_RANGE.min, ARTWORK_ZOOM_RANGE.max);
  return trimZero(Math.round(clamped / ARTWORK_ZOOM_QUANTIZE) * ARTWORK_ZOOM_QUANTIZE);
}

/** 这一步缩放是否真的会改变画面（到 0.5× / 5× 边界后按钮置灰，而不是点了没反应）。 */
export function canZoomArtworkEdit(edit, factor) {
  const current = normalizeArtworkEdit(edit);
  const ratio = finiteOr(factor, 1);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) return false;
  return clampArtworkZoom(current.zoom * ratio) !== current.zoom;
}

/**
 * 滚轮一格 → 缩放倍率：向上滚（deltaY < 0）放大。
 * `pow(1 + sensitivity, -deltaY)` 连续换算，再夹在 `1/1.5`–`1.5` 之间（触控板惯性不会一帧跳到底）。
 */
export function wheelZoomFactor(deltaY) {
  const delta = finiteOr(deltaY, 0);
  const factor = Math.pow(1 + ARTWORK_ZOOM_WHEEL_SENSITIVITY, -delta);
  return clampNumber(factor, 1 / ARTWORK_ZOOM_WHEEL_MAX_FACTOR, ARTWORK_ZOOM_WHEEL_MAX_FACTOR);
}

/**
 * 平移的可用区间（每个轴一条）。两条边界的含义：
 *   * 「起始边贴住窗口起点」= `-base`；「结束边贴住窗口终点」= `1 - base - span`；
 *   * 区间取两者的 min–max —— 内容比窗口大时它是「刚好盖住窗口」的范围（不会露底），
 *     内容比窗口小时它是「完全落在窗口内」的范围（不会飘出去）。
 * 两个特例都落在这个公式里：整幅画面 + `zoom=1` → `[0, 0]`（= 居中，不能平移）；
 * 整幅画面 + `zoom=2` → `[-0.5, 0.5]`。
 */
export function artworkOffsetBounds(zoom, crop) {
  const scale = clampArtworkZoom(zoom);
  const rect = normalizeCrop(crop) || FULL_CROP;
  const axis = (start, size) => {
    const base = 0.5 + (start - 0.5) * scale;
    const span = size * scale;
    const flushStart = -base;
    const flushEnd = 1 - base - span;
    return { min: Math.min(flushStart, flushEnd), max: Math.max(flushStart, flushEnd) };
  };
  return {
    x: axis(-rect.x / rect.w, 1 / rect.w),
    y: axis(-rect.y / rect.h, 1 / rect.h)
  };
}

/** 「生效窗口」：显式传入的裁剪框优先，其次编辑自身的 crop，都没有就是整幅画面。 */
function resolveWindow(crop, edit) {
  return normalizeCrop(crop) || normalizeCrop(edit && edit.crop) || FULL_CROP;
}

/** 内容在**裁剪窗口坐标系**里的矩形（0–1 = 窗口本身）。已按该窗口的可用区间夹过偏移。 */
export function artworkContentRect(raw, crop) {
  const rect = resolveWindow(crop, raw);
  const current = normalizeArtworkEdit(raw, rect);
  const zoom = current.zoom;
  return {
    x: 0.5 + (-rect.x / rect.w - 0.5) * zoom + current.offsetX,
    y: 0.5 + (-rect.y / rect.h - 0.5) * zoom + current.offsetY,
    w: zoom / rect.w,
    h: zoom / rect.h
  };
}

/**
 * 内容在**舞台（= 摆正后的那张图）坐标系**里的矩形：裁剪渲染与 <img> 的 CSS transform 共用这一份。
 * 舞台坐标系里内容的边长恒等于 `zoom`（窗口大小只影响它在窗口坐标系里的换算，不影响它在画面上的尺寸）。
 */
export function artworkImageView(edit, crop) {
  const rect = resolveWindow(crop, edit);
  const current = normalizeArtworkEdit(edit, rect);
  const content = artworkContentRect(current, rect);
  return {
    x: rect.x + content.x * rect.w,
    y: rect.y + content.y * rect.h,
    w: content.w * rect.w,
    h: content.h * rect.h
  };
}

/**
 * `<img>` 的 inline transform（translate 的百分比相对元素自身尺寸 = 舞台/整幅画面，scale 以中心为基准）。
 * identity（1× 居中）时返回 `null` —— 不放任何 transform，老路径的 DOM 与渲染逐像素不变。
 */
export function artworkImageTransform(edit, crop) {
  const current = normalizeArtworkEdit(edit);
  if (current.zoom === 1 && current.offsetX === 0 && current.offsetY === 0) return null;
  const view = artworkImageView(current, crop);
  const round = (value) => Number(value.toFixed(6));
  const translateX = view.x - (0.5 - view.w / 2);
  const translateY = view.y - (0.5 - view.h / 2);
  const scale = round(view.w);
  return {
    scale,
    translateX: round(translateX),
    translateY: round(translateY),
    css: `translate(${round(translateX * 100)}%, ${round(translateY * 100)}%) scale(${scale})`
  };
}

/**
 * 以某个锚点缩放。锚点是**裁剪窗口坐标系**里的点（0–1，缺省 = 窗口中心），
 * 缩放后锚点下那块内容仍停在同一处 —— 滚轮/双指就是「指针为中心」缩放的。
 */
export function zoomArtworkEdit(edit, zoomValue, options = {}) {
  const rect = resolveWindow(options.crop, edit);
  const current = normalizeArtworkEdit(edit, rect);
  const next = clampArtworkZoom(zoomValue);
  // 已经顶在 0.5× / 5×：值上没有变化（界面按 artworkEditSnapshotKey 比较，就是「这一下不用记」）。
  if (next === current.zoom) return current;
  const anchorX = clampNumber(finiteOr(options.x, 0.5), 0, 1);
  const anchorY = clampNumber(finiteOr(options.y, 0.5), 0, 1);
  const before = artworkContentRect(current, rect);
  // 锚点落在内容上的归一化位置（缩放前后保持不变）。
  const u = (anchorX - before.x) / before.w;
  const v = (anchorY - before.y) / before.h;
  const offsetX = anchorX - 0.5 - next * (-rect.x / rect.w - 0.5 + u / rect.w);
  const offsetY = anchorY - 0.5 - next * (-rect.y / rect.h - 0.5 + v / rect.h);
  // 只写 zoom / offsetX / offsetY：**不动 crop** —— 把 crop 写成整幅会把「未手动裁剪（沿用系统识别）」
  // 偷偷变成「手动裁剪到整幅画面」，下游的纸边自动裁剪就再也不会跑了。
  return normalizeArtworkEdit({ ...current, zoom: next, offsetX, offsetY }, rect);
}

/** 平移：`dx/dy` 是窗口宽/高的比例（正数 = 内容往右下走）。到边界后值不再变化（返回当前值）。 */
export function panArtworkEdit(edit, dx, dy, options = {}) {
  const rect = resolveWindow(options.crop, edit);
  const current = normalizeArtworkEdit(edit, rect);
  const offsetX = current.offsetX + finiteOr(dx, 0);
  const offsetY = current.offsetY + finiteOr(dy, 0);
  if (offsetX === current.offsetX && offsetY === current.offsetY) return current;
  return normalizeArtworkEdit({ ...current, offsetX, offsetY }, rect);
}

/** 缩放/平移的确定性快照键（用它判断「操作停了没有」：依赖数组、压栈节流、缓存键都读它）。 */
export function artworkViewKey(edit) {
  const current = normalizeArtworkEdit(edit);
  return JSON.stringify([current.zoom, current.offsetX, current.offsetY]);
}

/** 缩放读数：`1×` / `1.25×` / `0.5×`（去掉多余的 0）。 */
export function zoomLabel(value) {
  const text = clampArtworkZoom(value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${text}×`;
}

/** 一行视图摘要：`1.25× 缩放 · 已平移` / `1× 缩放 · 居中`。 */
export function artworkViewSummary(edit) {
  const current = normalizeArtworkEdit(edit);
  const moved = current.offsetX !== 0 || current.offsetY !== 0;
  return `${zoomLabel(current.zoom)} 缩放 · ${moved ? '已平移' : '居中'}`;
}

/** 默认（未编辑）状态：不旋转、不裁剪、1× 缩放、居中。 */
export function createArtworkEdit(overrides = {}) {
  return normalizeArtworkEdit(overrides);
}

/**
 * 归一化编辑状态：脏数据永不抛错，非法值一律收敛到默认值。
 * 旧数据兼容：老实现把角度放在 `media.artwork.rotation`（90° 的倍数）上，
 * 所以 `rotateDeg / rotate / rotation` 三种写法都读，读不出来按 0°。
 *
 * 第二个参数是**生效窗口**（界面显示的那一版裁剪框，缺省取编辑自身的 crop）：
 * 偏移量按「这个窗口下的可用区间」再夹一次 —— 于是界面读数永远等于真实绘制（读不出一个画不出来的值）。
 * 注意它只影响偏移的夹取，**不会写进 crop**。
 */
export function normalizeArtworkEdit(raw, windowCrop) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rotateValue = source.rotateDeg ?? source.rotate ?? source.rotation;
  const crop = normalizeCrop(source.crop);
  const zoom = clampArtworkZoom(source.zoom);
  const bounds = artworkOffsetBounds(zoom, normalizeCrop(windowCrop) || crop);
  const clampOffset = (value, span) => trimZero(clampNumber(
    finiteOr(value, 0),
    Math.max(ARTWORK_OFFSET_RANGE.min, span.min),
    Math.min(ARTWORK_OFFSET_RANGE.max, span.max)
  ));
  return {
    version: ARTWORK_EDIT_VERSION,
    rotateDeg: quantizeRotationDeg(normalizeRotationDeg(rotateValue)),
    crop,
    zoom,
    offsetX: clampOffset(source.offsetX, bounds.x),
    offsetY: clampOffset(source.offsetY, bounds.y)
  };
}

/** 左右旋转 90°：`turns` 正数右旋、负数左旋（一次一步），微调量原样保留。 */
export function rotateArtworkEdit(edit, turns = 1) {
  const current = normalizeArtworkEdit(edit);
  const steps = Number.isFinite(Number(turns)) ? Math.trunc(Number(turns)) : 1;
  return { ...current, rotateDeg: normalizeRotationDeg(current.rotateDeg + steps * ROTATE_STEP_DEG) };
}

/**
 * 任意角度微调一步：`deltaDeg` 按 0.5° 量化，微调量被收敛在 ±15° 之内。
 * 边界处「顶住不越界」而不是绕回（验收写的是范围 ±15°，越界就等于老师无法预期画面）。
 */
export function nudgeArtworkEditRotation(edit, deltaDeg = FINE_ROTATION_STEP) {
  const current = normalizeArtworkEdit(edit);
  const base = quarterBaseOf(current.rotateDeg);
  const fine = clampFineRotation(fineRotationOf(current.rotateDeg) + quantizeRotationDeg(finiteOr(deltaDeg, FINE_ROTATION_STEP)));
  return { ...current, rotateDeg: normalizeRotationDeg(base + fine) };
}

/** 这一步微调是否真的会改变角度（到 ±15° 边界后按钮置灰，而不是点了没反应）。 */
export function canNudgeArtworkEditRotation(edit, deltaDeg = FINE_ROTATION_STEP) {
  const current = normalizeArtworkEdit(edit);
  const step = quantizeRotationDeg(finiteOr(deltaDeg, 0));
  if (!step) return false;
  const fine = fineRotationOf(current.rotateDeg);
  return Math.abs(clampFineRotation(fine + step) - fine) > 1e-9;
}

/** 是不是「什么都没改」的默认态（重置 / 提示文案 / 是否值得提交都用它）。 */
export function artworkEditIsDefault(edit) {
  return artworkEditSnapshotKey(edit) === artworkEditSnapshotKey(createArtworkEdit());
}

/** 确定性快照键：进 React 依赖数组与缓存键。字段顺序由本模块固定，所以两次调用逐字符相同。 */
export function artworkEditSnapshotKey(edit) {
  const current = normalizeArtworkEdit(edit);
  return JSON.stringify(ARTWORK_EDIT_FIELDS.map((field) => [field, current[field]]));
}

/** 带符号的角度文案：`+3.5°` / `-2°` / `0°`。 */
export function formatRotationDeg(value) {
  const number = quantizeRotationDeg(value);
  return `${number > 0 ? '+' : ''}${number}°`;
}

/** 一行描述当前旋转：`右旋 90° · 微调 +3.5°`（无旋转时是「未旋转」）。 */
export function rotationSummary(edit) {
  const current = normalizeArtworkEdit(edit);
  const fine = fineRotationOf(current.rotateDeg);
  const turns = Math.round(quarterBaseOf(current.rotateDeg) / ROTATE_STEP_DEG) % 4;
  const parts = [];
  if (turns === 1) parts.push('右旋 90°');
  else if (turns === 2) parts.push('右旋 180°');
  else if (turns === 3) parts.push('左旋 90°');
  if (fine) parts.push(`微调 ${formatRotationDeg(fine)}`);
  return parts.length ? parts.join(' · ') : '未旋转';
}

/** 面板上的一句话全量描述：旋转 + 裁剪 + 缩放 + 平移。 */
export function describeArtworkEdit(edit) {
  const current = normalizeArtworkEdit(edit);
  const fine = fineRotationOf(current.rotateDeg);
  const crop = current.crop
    ? `已裁剪 ${Math.round(current.crop.w * 100)}%×${Math.round(current.crop.h * 100)}%`
    : '未裁剪';
  const center = current.offsetX || current.offsetY ? '已平移' : '居中';
  return `旋转 ${current.rotateDeg}°${fine ? `（${rotationSummary(current)}）` : ''}｜${crop}｜${zoomLabel(current.zoom)} 缩放｜${center}`;
}

// ---- 撤销 / 重做（US-004a「至少 20 步」）------------------------------------------------
// 历史栈存**整份 artworkEdit 快照**（对象很小），所以「撤销」就是把某一版的 edit 原样拿回来，
// 不需要给每种操作写反操作 —— 裁剪 / 缩放（US-004b/c）接进来时天然一起被撤销。

/** 新建一个历史栈：`entries[0]` 是进入编辑时的状态，`index` 指向当前生效的那一版。 */
export function createArtworkEditHistory(seed, options = {}) {
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
    ? Math.trunc(Number(options.limit))
    : ARTWORK_EDIT_HISTORY_LIMIT;
  return {
    limit,
    index: 0,
    entries: [{ edit: normalizeArtworkEdit(seed), label: String(options.label || '开始编辑') }]
  };
}

/**
 * 这个对象是不是一个**已经归一化过**的历史栈。
 * 判据必须够严（字段齐全 + version 相符 + index 落在区间内），否则脏历史会被当成好的直接拿去用；
 * 同时它让 `normalizeArtworkEditHistory` 对合法输入**原样返回同一个对象** ——
 * 界面靠对象同一性判断「撤销到底有没有发生」（返回同一个对象 = 已经在边界上，按钮置灰）。
 */
export function isArtworkEditHistory(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries) || !raw.entries.length) return false;
  if (!Number.isFinite(Number(raw.limit)) || Number(raw.limit) <= 0) return false;
  if (!Number.isInteger(raw.index) || raw.index < 0 || raw.index >= raw.entries.length) return false;
  return raw.entries.every((entry) => entry
    && typeof entry === 'object'
    && entry.edit
    && typeof entry.edit === 'object'
    && entry.edit.version === ARTWORK_EDIT_VERSION
    && ARTWORK_EDIT_FIELDS.every((field) => field in entry.edit));
}

/** 把任意（可能被持久化/外部改坏的）历史栈收敛成可用的结构，认不出来就用 seed 重建。 */
export function normalizeArtworkEditHistory(raw, seed) {
  if (isArtworkEditHistory(raw)) return raw;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries) || !raw.entries.length) {
    return createArtworkEditHistory(seed);
  }
  const limit = Number.isFinite(Number(raw.limit)) && Number(raw.limit) > 0
    ? Math.trunc(Number(raw.limit))
    : ARTWORK_EDIT_HISTORY_LIMIT;
  const entries = raw.entries
    .filter((entry) => entry && typeof entry === 'object' && entry.edit)
    .map((entry) => ({ edit: normalizeArtworkEdit(entry.edit), label: String(entry.label || '编辑') }));
  if (!entries.length) return createArtworkEditHistory(seed);
  const index = clampNumber(Math.trunc(finiteOr(raw.index, entries.length - 1)), 0, entries.length - 1);
  return { limit, entries, index };
}

/**
 * 压入一步编辑：截断「重做」分支后追加，超出上限时丢掉最老的快照。
 * 与当前这一版**完全相同**的编辑不占一步（例如连点两次同一个按钮的边界态），
 * 否则撤销栈会被无变化的空步塞满，「撤销」按下去画面却不动。
 */
export function pushArtworkEditHistory(history, edit, label = '编辑') {
  const base = normalizeArtworkEditHistory(history, edit);
  const next = normalizeArtworkEdit(edit);
  const current = base.entries[base.index];
  if (current && artworkEditSnapshotKey(current.edit) === artworkEditSnapshotKey(next)) return base;
  const entries = base.entries.slice(0, base.index + 1);
  entries.push({ edit: next, label: String(label || '编辑') });
  while (entries.length > base.limit + 1) entries.shift();
  return { ...base, entries, index: entries.length - 1 };
}

/** 撤销一步：已经是最老那一版时原样返回同一个对象（界面据此把按钮置灰）。 */
export function undoArtworkEditHistory(history) {
  const base = normalizeArtworkEditHistory(history);
  if (base.index <= 0) return base;
  return { ...base, index: base.index - 1 };
}

/** 重做一步：已经在最新那一版时原样返回同一个对象。 */
export function redoArtworkEditHistory(history) {
  const base = normalizeArtworkEditHistory(history);
  if (base.index >= base.entries.length - 1) return base;
  return { ...base, index: base.index + 1 };
}

/** 当前生效的编辑状态。 */
export function currentArtworkEdit(history) {
  const base = normalizeArtworkEditHistory(history);
  return base.entries[base.index].edit;
}

/** 界面用的历史状态：可撤销 / 可重做几步、按钮文案、是否已经到上限。 */
export function artworkEditHistoryState(history) {
  const base = normalizeArtworkEditHistory(history);
  const undoSteps = base.index;
  const redoSteps = base.entries.length - 1 - base.index;
  return {
    limit: base.limit,
    index: base.index,
    total: base.entries.length,
    undoSteps,
    redoSteps,
    canUndo: undoSteps > 0,
    canRedo: redoSteps > 0,
    undoLabel: undoSteps > 0 ? base.entries[base.index].label : '',
    redoLabel: redoSteps > 0 ? base.entries[base.index + 1].label : '',
    atLimit: base.index + 1 >= base.limit
  };
}
