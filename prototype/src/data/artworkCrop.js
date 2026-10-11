/**
 * 裁剪框（US-004b「编辑器裁剪框与比例预设」/ PRD FR-6、FR-8）的唯一真源。
 *
 * 与 `data/artworkEdit.js` 同一套纪律：**零依赖纯函数 + 常量**（只 import 同层的另一个 data 模块），
 * 不碰 DOM、不碰 canvas、不碰网络 —— 于是「8 点拖拽 / 四边吸附 / 最小 10% / 越界回弹 / 比例预设」
 * 这些规则可以直接用 Node 跑断言（见 prototype/AGENTS.md 的「验证技巧」）。
 *
 * 坐标口径只有一份：`{x, y, w, h}` 都是 **0–1 的相对值**，相对「已按 rotateDeg 摆正之后的那张图」
 * （也就是编辑器里显示的那张预览稿）。画布像素与预览像素之间只差一个等比缩放，
 * 所以同一份归一化矩形既能量在预览上，也能原样用于原图的裁剪（`services/artworkEditor.js`）。
 *
 * 八点 = 四角（nw/ne/se/sw）+ 四边（n/e/s/w）；另有 `move` 表示拖动整框。
 * 四边吸附 = 被拖的边靠近画布边缘（`CROP_SNAP_RATIO` 之内）时贴齐到 0 / 1。
 */

import { normalizeCrop } from './artworkEdit.js';

/** 裁剪框最小尺寸：原图的 10%（US-004b 验收原文）。x 与 y 两个方向各自成立。 */
export const CROP_MIN_RATIO = 0.1;

/** 四边吸附的距离阈值：相对画布短边…直接用「相对值」表示，0.02 = 靠近边缘 2% 以内就贴齐。 */
export const CROP_SNAP_RATIO = 0.02;

/** 判断「这个框是不是某个比例」的容差（像素比例的相对误差）。 */
export const CROP_ASPECT_TOLERANCE = 0.02;

/** 八点拖拽的把手。顺序固定（渲染顺序 = 断言顺序）。 */
export const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** 每个把手会移动哪些边。`move` 是整框平移（不在 CROP_HANDLES 里，因为它不改变尺寸）。 */
export const CROP_HANDLE_EDGES = {
  nw: { left: true, top: true },
  n: { top: true },
  ne: { right: true, top: true },
  e: { right: true },
  se: { right: true, bottom: true },
  s: { bottom: true },
  sw: { left: true, bottom: true },
  w: { left: true }
};

/** 拖动整框（平移）用的 handle 名。 */
export const CROP_BODY_HANDLE = 'move';

/** 比例预设（US-004b 验收原文的六项）。`ratio` 是**像素**宽高比；`original` 取原图比例。 */
export const CROP_ASPECT_PRESETS = [
  { id: 'free', label: '自由', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: 'original', label: '原图比例', ratio: 'original' }
];

/** 「自由」的预设 id：不锁比例（界面与断言都从这里取，别在别处写 'free' 字面量）。 */
export const CROP_FREE_ASPECT_ID = 'free';

const clampNumber = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** 画布宽高比（>0）。认不出来按 1 处理（不会因为图还没加载就把裁剪算崩）。 */
export function normalizeImageAspect(value) {
  const aspect = finiteOr(value, 1);
  return aspect > 0 ? aspect : 1;
}

/** 整幅画面的裁剪框（= 不裁剪）。 */
export function fullCrop() {
  return { x: 0, y: 0, w: 1, h: 1 };
}

/** 把任意输入收敛成一个可用的裁剪框：认不出来（null / 脏数据）= 整幅画面。 */
export function cropRectOf(crop) {
  return normalizeCrop(crop) || fullCrop();
}

/** 是不是「整幅画面」（= 没有实际裁剪）。JS 浮点误差用 1e-4 兜住。 */
export function cropIsFull(crop) {
  const rect = cropRectOf(crop);
  return rect.x <= 1e-4 && rect.y <= 1e-4 && rect.w >= 1 - 1e-4 && rect.h >= 1 - 1e-4;
}

/** 比例预设 id → 归一化后的 id（认不出来回落 `free`）。 */
export function normalizeCropAspectId(presetId) {
  const id = String(presetId ?? '');
  return CROP_ASPECT_PRESETS.some((preset) => preset.id === id) ? id : 'free';
}

/** 取预设的**像素**宽高比：`free` → null（自由），`original` → 原图比例。 */
export function resolveCropAspect(presetId, imageAspect) {
  const preset = CROP_ASPECT_PRESETS.find((item) => item.id === normalizeCropAspectId(presetId));
  if (!preset || preset.ratio === null) return null;
  if (preset.ratio === 'original') return normalizeImageAspect(imageAspect);
  return preset.ratio;
}

/**
 * 当前框的像素宽高比。
 * 归一化矩形要先乘回画布宽高才是**像素**比例：`(w·W)/(h·H) = (w/h)·imageAspect`。
 */
export function cropAspectOf(crop, imageAspect) {
  const rect = cropRectOf(crop);
  if (rect.h <= 0) return normalizeImageAspect(imageAspect);
  return (rect.w / rect.h) * normalizeImageAspect(imageAspect);
}

/** 这个框对得上哪个预设（对不上回落 `free`）。用来决定打开编辑器时高亮哪一颗按钮。 */
export function matchCropPreset(crop, imageAspect) {
  const normalized = normalizeCrop(crop);
  if (!normalized) return 'free';
  const aspect = cropAspectOf(normalized, imageAspect);
  for (const preset of CROP_ASPECT_PRESETS) {
    const ratio = resolveCropAspect(preset.id, imageAspect);
    if (!ratio) continue;
    if (Math.abs(aspect - ratio) / ratio <= CROP_ASPECT_TOLERANCE) return preset.id;
  }
  return 'free';
}

/**
 * 选一个比例预设：以当前框的中心为中心，取「面积与当前框相近、且能放进画布」的同比例框。
 *
 * 为什么不是「直接放到最大」：老师点 1:1 通常是想微调成方图，框子突然铺满整幅画面会让他
 * 丢掉刚才的取景。所以先按面积推一个尺寸，再用画布与最小尺寸夹住，最后把中心夹回画布内（越界回弹）。
 * `free` 不改画面（只是解锁比例），原框原样返回。
 */
export function applyCropPreset(crop, presetId, imageAspect) {
  const base = cropRectOf(crop);
  const ratio = resolveCropAspect(presetId, imageAspect);
  if (!ratio) return base;
  const canvasAspect = normalizeImageAspect(imageAspect);
  // h = w·k（k = 画布比例 / 目标比例）：下面的上下限都由 k 推出来。
  const k = canvasAspect / ratio;
  const area = Math.max(base.w * base.h, CROP_MIN_RATIO * CROP_MIN_RATIO);
  const minW = Math.max(CROP_MIN_RATIO, CROP_MIN_RATIO / k);
  const maxW = Math.min(1, 1 / k);
  // 只夹宽度、高度由宽度推出来 —— 两个方向各夹一次会把比例夹歪（验收要的是像素比例精确）。
  const width = clampNumber(Math.sqrt(area / k), Math.min(minW, maxW), maxW);
  const height = width * k;
  const centerX = base.x + base.w / 2;
  const centerY = base.y + base.h / 2;
  return {
    x: clampNumber(centerX - width / 2, 0, 1 - width),
    y: clampNumber(centerY - height / 2, 0, 1 - height),
    w: width,
    h: height
  };
}

/**
 * 八点拖拽的几何（纯函数）。
 *
 * 三条规则按顺序生效：
 *   1. **四边吸附**：被拖的边落进 `snapRatio` 之内就贴到画布边（0 或 1）；
 *   2. **最小尺寸**：任一方向不得小于原图的 `minRatio`（默认 10%），顶住不再缩；
 *   3. **越界回弹**：框永远留在画布内 —— 锚点是「没被拖的那条对侧边」，推出画布就缩回边界。
 *
 * 锁定比例（`aspectRatio` 非空）时以锚点为基准换算：`h = w·k`（k = 画布比例 / 目标比例）。
 *   角把手锚定对角；边把手只驱动一个方向，另一个方向以原框中心为准展开（上下/左右各一半）。
 *   拖动方向由「两个方向里变化更大的那一个」决定 —— 只横向拖或只纵向拖都能改尺寸。
 */
export function resizeCrop(crop, handle, dx, dy, options = {}) {
  const edges = CROP_HANDLE_EDGES[handle];
  const base = cropRectOf(crop);
  if (!edges) return base;
  const min = clampNumber(finiteOr(options.minRatio, CROP_MIN_RATIO), 0, 1);
  const snap = Math.max(0, finiteOr(options.snapRatio, 0));
  const ratio = Number.isFinite(Number(options.aspectRatio)) && Number(options.aspectRatio) > 0
    ? Number(options.aspectRatio)
    : null;
  const canvasAspect = normalizeImageAspect(options.imageAspect);

  // 1) 被拖的边跟着指针走，其余边不动。
  let left = base.x + (edges.left ? finiteOr(dx, 0) : 0);
  let right = base.x + base.w + (edges.right ? finiteOr(dx, 0) : 0);
  let top = base.y + (edges.top ? finiteOr(dy, 0) : 0);
  let bottom = base.y + base.h + (edges.bottom ? finiteOr(dy, 0) : 0);

  // 2) 四边吸附（只对被拖的边）+ 夹回画布。
  if (snap > 0) {
    if (edges.left && left <= snap) left = 0;
    if (edges.right && right >= 1 - snap) right = 1;
    if (edges.top && top <= snap) top = 0;
    if (edges.bottom && bottom >= 1 - snap) bottom = 1;
  }
  left = clampNumber(left, 0, 1);
  right = clampNumber(right, 0, 1);
  top = clampNumber(top, 0, 1);
  bottom = clampNumber(bottom, 0, 1);

  if (!ratio) {
    let w = Math.max(right - left, min);
    let h = Math.max(bottom - top, min);
    // 最小尺寸由「把被拖的边顶回锚点方向」实现；锚点到画布边的距离一定 ≥ 最小尺寸（初始框 ≥ 10%）。
    if (edges.left) left = Math.max(0, right - w); else right = Math.min(1, left + w);
    if (edges.top) top = Math.max(0, bottom - h); else bottom = Math.min(1, top + h);
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  // h = w·k：k 是「归一化高度 / 归一化宽度」。最小尺寸两个方向都要满足 → 换算成 w 的下限。
  const k = canvasAspect / ratio;
  const minW = Math.max(min, min / k);
  const draggedW = Math.max(right - left, 1e-6);
  const draggedH = Math.max(bottom - top, 1e-6);
  const wFromHeight = draggedH / k;
  const horizontalDragged = Boolean(edges.left || edges.right);
  const verticalDragged = Boolean(edges.top || edges.bottom);
  // 角把手的「谁驱动谁」按**指针位移**判（像素单位下比较，画布高为 1）：不要拿推导出来的尺寸
  // 与原框比大小 —— 原框可能还不是目标比例（例如刚切到某个预设之前），那样会选错驱动轴。
  const drivenByHeight = Math.abs(finiteOr(dy, 0)) > Math.abs(finiteOr(dx, 0)) * canvasAspect;

  if (horizontalDragged && verticalDragged) {
    // 角把手：锚定对角，两个方向都跟着指针走。
    const availW = edges.left ? right : 1 - left;
    const availH = edges.top ? bottom : 1 - top;
    const maxW = Math.min(availW, availH / k);
    const w = clampNumber(drivenByHeight ? wFromHeight : draggedW, Math.min(minW, maxW), maxW);
    const h = w * k;
    return {
      x: edges.left ? right - w : left,
      y: edges.top ? bottom - h : top,
      w,
      h
    };
  }

  if (horizontalDragged) {
    // 左右边把手：纵向不动（指针纵向的位移不改变任何边），只由横向位移驱动宽度。
    const centerY = base.y + base.h / 2;
    const availW = edges.left ? right : 1 - left;
    const availH = 2 * Math.min(centerY, 1 - centerY);
    const maxW = Math.min(availW, availH / k);
    const w = clampNumber(draggedW, Math.min(minW, maxW), maxW);
    const h = w * k;
    return {
      x: edges.left ? right - w : left,
      y: clampNumber(centerY - h / 2, 0, 1 - h),
      w,
      h
    };
  }

  // 上下边把手：横向不动，只由纵向位移驱动高度（横向以原框中心展开）。
  const centerX = base.x + base.w / 2;
  const availH = edges.top ? bottom : 1 - top;
  const availW = 2 * Math.min(centerX, 1 - centerX);
  const minH = Math.max(min, min * k);
  const maxH = Math.min(availH, availW * k);
  const h = clampNumber(draggedH, Math.min(minH, maxH), maxH);
  const w = h / k;
  return {
    x: clampNumber(centerX - w / 2, 0, 1 - w),
    y: edges.top ? bottom - h : top,
    w,
    h
  };
}

/**
 * 拖动整框（平移）：夹在画布内（越界回弹），靠边时同样吸附。
 * 平移不改变尺寸，所以最小尺寸规则在这里不参与。
 */
export function moveCrop(crop, dx, dy, options = {}) {
  const base = cropRectOf(crop);
  const snap = Math.max(0, finiteOr(options.snapRatio, 0));
  let x = clampNumber(base.x + finiteOr(dx, 0), 0, 1 - base.w);
  let y = clampNumber(base.y + finiteOr(dy, 0), 0, 1 - base.h);
  if (snap > 0) {
    if (x <= snap) x = 0;
    if (1 - (x + base.w) <= snap) x = 1 - base.w;
    if (y <= snap) y = 0;
    if (1 - (y + base.h) <= snap) y = 1 - base.h;
  }
  return { x, y, w: base.w, h: base.h };
}

/** 定长百分比字符串：DOM 上的 inline style 与断言都读它，避免 `0.30000000000000004%` 这类噪声。 */
export function cropPercent(value) {
  const number = clampNumber(finiteOr(value, 0), 0, 1);
  return `${Number((number * 100).toFixed(3))}%`;
}

/** 裁剪框的 inline style（相对舞台的百分比定位）。舞台尺寸 = 图片渲染尺寸，所以不用知道像素。 */
export function cropBoxStyle(crop) {
  const rect = cropRectOf(crop);
  return {
    left: cropPercent(rect.x),
    top: cropPercent(rect.y),
    width: cropPercent(rect.w),
    height: cropPercent(rect.h)
  };
}

/** 把手的中文名（无障碍标签与提示文案）。 */
export function cropHandleLabel(handle) {
  const table = {
    nw: '左上角', n: '上边', ne: '右上角', e: '右边',
    se: '右下角', s: '下边', sw: '左下角', w: '左边', move: '整框'
  };
  return table[handle] || '裁剪框';
}

/** 一行尺寸文案：`62% × 78%`。 */
export function cropSizeText(crop) {
  const rect = cropRectOf(crop);
  return `${Math.round(rect.w * 100)}% × ${Math.round(rect.h * 100)}%`;
}

/** 像素比例文案：`≈1:1` / `≈4:3`（对不上任何常用比例时给化简后的两位小数）。 */
export function cropRatioText(crop, imageAspect) {
  const aspect = cropAspectOf(crop, imageAspect);
  if (!Number.isFinite(aspect) || aspect <= 0) return '';
  const known = [[1, '1:1'], [4 / 3, '4:3'], [3 / 4, '3:4'], [16 / 9, '16:9'], [9 / 16, '9:16']];
  for (const [value, label] of known) {
    if (Math.abs(aspect - value) / value <= CROP_ASPECT_TOLERANCE) return `≈${label}`;
  }
  return aspect >= 1 ? `≈${aspect.toFixed(2)}:1` : `≈1:${(1 / aspect).toFixed(2)}`;
}

/** 折叠态的摘要：`未手动裁剪（沿用系统识别）` / `已裁剪 62% × 78%（≈1:1）`。 */
export function cropSummary(crop, imageAspect) {
  const normalized = normalizeCrop(crop);
  if (!normalized) return '未手动裁剪（沿用系统识别）';
  if (cropIsFull(normalized)) return '已还原为完整作品';
  const ratio = cropRatioText(normalized, imageAspect);
  return `已裁剪 ${cropSizeText(normalized)}${ratio ? `（${ratio}）` : ''}`;
}

/** 面板上的一句话描述（包含最小尺寸与吸附口径，让规则对老师可见）。 */
export function describeCropRules() {
  return `拖动八个把手或整框调整裁剪区域；靠近边缘 ${Math.round(CROP_SNAP_RATIO * 100)}% 内会自动吸附，最小 ${Math.round(CROP_MIN_RATIO * 100)}%。`;
}
