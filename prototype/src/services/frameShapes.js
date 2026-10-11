/**
 * 相框形状几何：`arch`（顶部半圆拱形）与 `bevel`（四角斜切）。
 *
 * 这里只有几何（纯函数、零依赖，可直接用 Node 跑断言），画布绘制在 `services/framing.js` 里。
 * 直角（`square`）与圆角（`rounded`）**不走这里** —— 它们是 US-002a 的既有路径，必须逐像素不变。
 *
 * 三条尺寸纪律（US-002 的验收：横版 / 竖版 / 正方形都不破图、不露底、框宽均匀）：
 *   1. **同心内缩**：卡纸与外框由同一个形状向内缩 `outer` 像素得到，所以框带沿弧线与直边等宽。
 *      bevel 的斜边要按 `2 - √2` 修正切角长度（`CHAMFER_INSET_FACTOR`），否则斜边上的垂直框宽
 *      只有直边上的 1/√2 —— 这就是「框宽不均」的成因。
 *   2. **作品只画在形状内能放下的最大等比矩形里**（`inscribeAspectRect`）：作品永远不被裁切，
 *      形状内没被作品占满的部分留给白色作品底。这是「不露底」的实现方式：先按形状铺底，
 *      再把作品放进去，而不是让作品矩形自己去顶形状的边。
 *   3. 几何退化（半径 / 切角被收敛到 0）时形状自动退化成矩形，调用方据此回落到直角路径，不画崩。
 *
 * 坐标一律是画布像素（1800×1360 合成画布）。**每一种形状的尺寸都由外框矩形派生**，没有新的 spec 字段：
 * `frame.shape` 已经进 `frameSpecRenderKey()`，所以形状不同的两套模板不会共用画展缓存。
 */

/** 拱形半径的上限系数：拱高不超过外框高度的这个比例，保证拱下还留有直边（否则拱吃掉整个框）。 */
export const ARCH_MAX_RISE_RATIO = 0.7;
/** 斜角切角长度 = 外框短边的这个比例（45° 切角）。 */
export const BEVEL_CHAMFER_RATIO = 0.09;
/** 45° 斜角内缩 `distance` 后，切角长度应减少 `distance × (2 - √2)` 才是等宽的斜边。 */
export const CHAMFER_INSET_FACTOR = 2 - Math.SQRT2;

const insetRect = (rect, distance) => ({
  x: rect.x + distance,
  y: rect.y + distance,
  width: Math.max(0, rect.width - distance * 2),
  height: Math.max(0, rect.height - distance * 2)
});

/**
 * 拱形：上边是以 `r` 为半径的半圆（圆心在外框上边往下 `r` 处），下接直边到 `bottom`。
 * `r` 取 `min(宽度/2, 高度 × riseRatio)` —— 横版画布上宽度/2 是半圆（真正的「半圆拱形」），
 * 极端扁的画布上会被高度限制，退化成弧高更小的拱（不画崩）。
 */
export function archShape(rect, { riseRatio = ARCH_MAX_RISE_RATIO } = {}) {
  const r = Math.max(0, Math.min(rect.width / 2, rect.height, rect.height * riseRatio));
  return { kind: 'arch', cx: rect.x + rect.width / 2, cy: rect.y + r, r, bottom: rect.y + rect.height };
}

/** 拱形向内缩 `distance`：半径与底边一起收，圆心不动 —— 于是拱带处处等宽。 */
export function archInset(shape, distance) {
  return {
    kind: 'arch',
    cx: shape.cx,
    cy: shape.cy,
    r: Math.max(0, shape.r - distance),
    bottom: shape.bottom - distance
  };
}

/** 斜角矩形：四角 45° 切掉 `chamfer` 像素（`chamfer` 为 0 时就是矩形）。 */
export function bevelShape(rect, { chamferRatio = BEVEL_CHAMFER_RATIO, chamfer } = {}) {
  const explicit = Number.isFinite(chamfer) ? Math.max(0, chamfer) : null;
  const base = explicit === null ? Math.max(0, Math.min(rect.width, rect.height) * chamferRatio) : explicit;
  return { kind: 'bevel', rect: { ...rect }, chamfer: Math.min(base, rect.width / 2, rect.height / 2) };
}

/** 斜角矩形向内缩 `distance`：切角按 `CHAMFER_INSET_FACTOR` 修正，保证斜边上的垂直框宽也是 `distance`。 */
export function bevelInset(shape, distance) {
  return {
    kind: 'bevel',
    rect: insetRect(shape.rect, distance),
    chamfer: Math.max(0, shape.chamfer - distance * CHAMFER_INSET_FACTOR)
  };
}

/** 形状的外接矩形（拱形给半圆顶到直边底的外接框）。 */
export function shapeBox(shape) {
  if (shape.kind === 'arch') {
    const top = shape.cy - shape.r;
    return { x: shape.cx - shape.r, y: top, width: shape.r * 2, height: Math.max(0, shape.bottom - top) };
  }
  return { ...shape.rect };
}

/** 形状在高度 `y` 处的水平宽度（形状外返回 0）。 */
export function shapeWidthAt(shape, y) {
  if (shape.kind === 'arch') {
    const top = shape.cy - shape.r;
    if (y < top || y > shape.bottom) return 0;
    if (y >= shape.cy) return shape.r * 2;
    const dy = shape.cy - y;
    return 2 * Math.sqrt(Math.max(0, shape.r * shape.r - dy * dy));
  }
  const { y: top, width, height } = shape.rect;
  if (y < top || y > top + height) return 0;
  const cut = Math.max(0, shape.chamfer - Math.min(y - top, top + height - y));
  return Math.max(0, width - 2 * cut);
}

/**
 * 形状在高度区间 `[top, bottom]` 内的**最小**宽度。
 * 两种形状的宽度曲线都是「先增后平再减」，所以最小值一定落在区间两端或其与拐点之间：
 *   - arch：拱顶到圆心之间单调增、圆心以下恒定 → 取区间上端；
 *   - bevel：两端各有一段切角 → 取区间两端较小者。
 */
export function shapeMinWidth(shape, top, bottom) {
  if (shape.kind === 'arch') {
    const apex = shape.cy - shape.r;
    if (bottom <= apex || top >= shape.bottom) return 0;
    const upper = Math.max(top, apex);
    return upper < shape.cy ? shapeWidthAt(shape, upper) : shape.r * 2;
  }
  const rectTop = shape.rect.y;
  const rectBottom = shape.rect.y + shape.rect.height;
  if (bottom < rectTop || top > rectBottom) return 0;
  const clampY = (v) => Math.min(rectBottom, Math.max(rectTop, v));
  return Math.min(shapeWidthAt(shape, clampY(top)), shapeWidthAt(shape, clampY(bottom)));
}

/** 把形状描成一条闭合路径（调用方负责 fill / clip / stroke）。 */
export function traceShape(ctx, shape) {
  if (shape.kind === 'arch') {
    const { cx, cy, r, bottom } = shape;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    // 角度 π → 0（顺时针，画布 y 轴向下）恰好是上半圆：左 → 顶 → 右。
    ctx.arc(cx, cy, r, Math.PI, 0, false);
    ctx.lineTo(cx + r, bottom);
    ctx.lineTo(cx - r, bottom);
    ctx.closePath();
    return;
  }
  const { x, y, width, height } = shape.rect;
  const c = Math.min(shape.chamfer, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + width - c, y);
  ctx.lineTo(x + width, y + c);
  ctx.lineTo(x + width, y + height - c);
  ctx.lineTo(x + width - c, y + height);
  ctx.lineTo(x + c, y + height);
  ctx.lineTo(x, y + height - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

/**
 * 在形状内（并限制在高度区间 `[top, bottom]`）找**最大的水平居中、宽高比 = `aspect` 的矩形**。
 *
 * 「最大」按高度取（面积与高度同调），扫描高度上端 `y`、对高度做二分：
 * 判据 `height × aspect <= shapeMinWidth(shape, y, y + height)` 对 `height` 单调，
 * 于是二分一定收敛到该上端能放下的最大高度。扫 2px 一档，1800px 画布上不到 500 档。
 * 返回 null 表示这个形状里放不下任何正面积矩形（调用方回落到直角路径）。
 */
export function inscribeAspectRect(shape, { aspect, top, bottom, step = 2 } = {}) {
  const ratio = Number(aspect);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const box = shapeBox(shape);
  const lo = Math.max(top, box.y);
  const hi = Math.min(bottom, box.y + box.height);
  if (!(hi - lo > 0)) return null;
  let best = null;
  for (let y = lo; y <= hi; y += step) {
    let head = 0;
    let tail = hi - y;
    for (let i = 0; i < 30; i += 1) {
      const mid = (head + tail) / 2;
      if (mid * ratio <= shapeMinWidth(shape, y, y + mid)) head = mid; else tail = mid;
    }
    if (head > 0 && (!best || head > best.height)) {
      best = { x: box.x + (box.width - head * ratio) / 2, y, width: head * ratio, height: head };
    }
  }
  return best;
}
