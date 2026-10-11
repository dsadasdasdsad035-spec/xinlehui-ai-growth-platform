import { frameSpecRenderView, clampRatio, FRAME_WIDTH_RATIO_RANGE, MAT_WIDTH_RATIO_RANGE, CORNER_RADIUS_RATIO_RANGE } from './frameSpec';
import { archShape, archInset, bevelShape, bevelInset, shapeBox, inscribeAspectRect, traceShape } from './frameShapes';
import {
  overlayVariableContext,
  planOverlayText,
  visibleOverlayElements,
  overlayElementEntries,
  DRAWN_OVERLAY_KINDS,
  resolveOverlayImageBox,
  textPlanBox,
  overlayElementBoxes,
  evaluateOverlayCoverage,
  OVERLAY_COVERAGE_LIMIT
} from './overlayLayout';

/** 合成画布的固定尺寸（装裱输出口径：1800×1360 JPEG 0.92）。几何与遮挡统计都从这里取，别各写一份。 */
const FRAME_CANVAS_WIDTH = 1800;
const FRAME_CANVAS_HEIGHT = 1360;
/** 展签区高度（相对开口下沿）。 */
const PLAQUE_HEIGHT = 96;

const FRAME_STYLES = {
  '星光展': { outer: '#cfa52e', inner: '#f3ede2', plaque: '#2b271f' },
  '自然原木': { outer: '#8d6439', inner: '#f3ede2', plaque: '#3e3022' },
  '东方雅境': { outer: '#27241f', inner: '#eee8dd', plaque: '#27241f' }
};

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('作品图片暂时无法读取。'));
    image.src = source;
  });
}

/** 只旋转完整原图，不做抠图、裁剪、滤镜或装裱。 */
export async function rotateArtworkOriginal({ source, rotation = 0 }) {
  const image = await loadImage(source);
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  if (!normalizedRotation) return source;
  const sideways = normalizedRotation % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = sideways ? image.naturalHeight : image.naturalWidth;
  canvas.height = sideways ? image.naturalWidth : image.naturalHeight;
  const context = canvas.getContext('2d');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((normalizedRotation * Math.PI) / 180);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvas.toDataURL('image/png');
}

/**
 * 画心提取算法的版本号。调用方用它判断缓存是否过期：
 * 算法一改，旧结果就必须重算。改动本文件时同步 +1。
 */
export const ARTWORK_CLEAN_ALGORITHM = 'artwork-crop-v5';

/** 中性色判定阈值：三通道极差。白纸/灰墙/木桌都是低极差，孩子的笔触是高极差。 */
const NEUTRAL_SPREAD = 46;
/** 提取结果的输出上限（长边像素）。只影响预览与 AI 输入，原图始终单独保留。 */
const CLEAN_MAX_EDGE = 2600;

const clampNumber = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/**
 * 自适应纸张亮度阈值。
 *
 * 不能用固定阈值：室内暖光下白纸可能只有 205，阴天更暗；固定 222 会整张漏检。
 * 做法是先挑出全图的中性（低饱和）像素，取它们亮度分布的**上沿**作为「纸面参考亮度」，
 * 再往下留一点余量。灰地砖、木桌面这些中性但更暗的表面就自然落在阈值下方。
 *
 * 取 99 分位而不是 90 分位：浅色墙面往往比白纸只暗二三十级，而且面积可能远大于画纸，
 * 90 分位会被墙面「拉低」，于是墙面和画纸一起被当成纸张，裁出来的框里还是留着墙。
 */
function resolvePaperThreshold(pixels) {
  const histogram = new Uint32Array(256);
  let neutral = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread > NEUTRAL_SPREAD) continue;
    histogram[Math.round((r + g + b) / 3)] += 1;
    neutral += 1;
  }
  // 中性像素太少（例如整幅都是彩色画面），说明这不是「白纸上的作品」，直接判为不该裁。
  if (neutral < (pixels.length / 4) * 0.04) return 256;
  let seen = 0;
  const target = neutral * 0.01;
  let reference = 222;
  for (let level = 255; level >= 0; level -= 1) {
    seen += histogram[level];
    if (seen >= target) { reference = level; break; }
  }
  return clampNumber(reference - 26, 198, 238);
}

/**
 * 由一组点求最小外接四边形：直接取 x±y 的四个极值点。
 * 对旋转角在 45° 以内的矩形，这四个极值点正好就是四个角；
 * 角度接近 45° 时会退化，调用方会用面积比做校验并回退。
 * 返回顺序：左上、右上、右下、左下（按 x−y 与 x+y 的组合）。
 */
function quadFromPoints(points) {
  let topLeft = null, bottomRight = null, bottomLeft = null, topRight = null;
  let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
  for (const [x, y] of points) {
    const sum = x + y, diff = x - y;
    if (sum < minSum) { minSum = sum; topLeft = [x, y]; }
    if (sum > maxSum) { maxSum = sum; bottomRight = [x, y]; }
    if (diff < minDiff) { minDiff = diff; bottomLeft = [x, y]; }
    if (diff > maxDiff) { maxDiff = diff; topRight = [x, y]; }
  }
  return [topLeft, topRight, bottomRight, bottomLeft];
}

const polygonArea = (quad) => {
  let sum = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const [x1, y1] = quad[i], [x2, y2] = quad[(i + 1) % quad.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
};

/** 把四边形的四个顶点从质心向外推 margin 个像素，给识别误差留安全边。 */
function growQuad(quad, margin) {
  const cx = quad.reduce((sum, p) => sum + p[0], 0) / quad.length;
  const cy = quad.reduce((sum, p) => sum + p[1], 0) / quad.length;
  return quad.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const length = Math.hypot(dx, dy) || 1;
    const k = (length + margin) / length;
    return [cx + dx * k, cy + dy * k];
  });
}

/**
 * 作品画心提取：把老师实拍照片里的桌面、地板、杂物裁掉，只留作品本身。
 *
 * 现有实现的三条硬规则（前两条是原本就有的承诺，第三条本次新增）：
 *   1. 先按老师确认的方向整图旋转，再判定边界；
 *   2. 作品像素只做「原样搬运」，不重绘、不调色、不加滤镜、不生成任何内容；
 *   3. 边界识别不可靠时一律回退为「不裁剪」——宁可留着背景，也绝不能把孩子的画裁掉。
 *
 * 流程：降采样 → 自适应阈值找纸 → 网格桥接把被笔触切碎的纸连成一体 → 取最大连通域
 * → 用 x±y 极值求纸的四角 → 四角外推安全边 → 四边形内像素原样保留、四边形外填白 → 裁到四边形外接矩形。
 */
export async function extractArtworkSurface({ source, rotation = 0 }) {
  const orientedSource = await rotateArtworkOriginal({ source, rotation });
  const image = await loadImage(orientedSource);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  const full = document.createElement('canvas');
  full.width = width; full.height = height;
  full.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0);

  // 识别不可靠时走这里：原样输出旋转后的完整画面，不做任何裁剪或透明化。
  const keepWholeImage = () => {
    const scale = Math.min(1, CLEAN_MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.93);
  };

  // 分析画布：宽 1000 足够定位纸边，逐像素计算量却只有原图的 1/10。
  const analysisWidth = Math.min(1000, width);
  const analysisHeight = Math.max(1, Math.round((height * analysisWidth) / width));
  const analysis = document.createElement('canvas');
  analysis.width = analysisWidth; analysis.height = analysisHeight;
  const actx = analysis.getContext('2d', { willReadFrequently: true });
  actx.drawImage(image, 0, 0, analysisWidth, analysisHeight);
  const pixels = actx.getImageData(0, 0, analysisWidth, analysisHeight).data;

  const baseThreshold = resolvePaperThreshold(pixels);
  // 中性像素太少（整幅都是彩色）时 resolvePaperThreshold 返回 256，表示「这不是白纸上的作品」。
  if (baseThreshold > 255) return keepWholeImage();

  // 4px 的采样步长是精度与耗时的折中：纸边定位误差不超过 4px，逐格计算量却只有逐像素的 1/16。
  const sample = 4;
  // 一档阈值不够，要往两边兜一手：
  //   - 抬高阈值：浅色墙面/浅灰地板只比白纸暗二三十级时，把它们筛出去；
  //   - 降低阈值：画面里有更亮的白色物体把参考亮度顶高了，导致真正的画纸反而落选。
  // 先信任自适应阈值，再依次试更松和更严的两档；三档都不成立就回退为不裁剪。
  const candidates = [...new Set([
    baseThreshold,
    clampNumber(baseThreshold - 24, 176, 250),
    clampNumber(baseThreshold + 16, 176, 250)
  ])];
  let detected = null;
  for (const candidate of candidates) {
    const attempt = detectSheet({ pixels, analysisWidth, analysisHeight, sample, threshold: candidate });
    if (attempt) { detected = attempt; break; }
  }
  if (!detected) return keepWholeImage();

  const { best, paperGrid, gridWidth, sample: step, boxCells } = detected;

  // 用「真正被判定为纸」的格子求角点，而不是桥接后的格子，
  // 否则外框会白多出一圈约 bridge×sample 像素的背景。
  const paperCells = best.cells.filter((point) => paperGrid[point]);
  const anchors = paperCells.length > 24 ? paperCells : best.cells;
  const points = anchors.map((point) => {
    const gx = point % gridWidth;
    return [gx * step + step / 2, ((point - gx) / gridWidth) * step + step / 2];
  });

  const extremeQuad = quadFromPoints(points);
  const boxQuad = [
    [best.minX * step, best.minY * step],
    [(best.maxX + 1) * step, best.minY * step],
    [(best.maxX + 1) * step, (best.maxY + 1) * step],
    [best.minX * step, (best.maxY + 1) * step]
  ];
  // 旋转接近 45° 时 x±y 极值会退化成一个点，用「四边形面积 / 外接框面积」把它筛掉。
  const quadUsable = polygonArea(extremeQuad) > boxCells * step * step * 0.62;
  const baseQuad = quadUsable ? extremeQuad : boxQuad;
  // 两个范围分开用，避免在作品四周留下一圈看得见的桌面：
  //   - keepQuad 决定「哪些像素保留」，贴着纸边切，只留 1.5px 容差吸收采样误差；
  //   - cropQuad 决定「画布裁多大」，多留 0.6% 安全边，多出来的部分本来就是透明的。
  const keepMargin = 1.5;
  const cropMargin = Math.max(4, Math.round(Math.min(analysisWidth, analysisHeight) * 0.006));
  const keepQuad = growQuad(baseQuad, keepMargin);
  const cropQuad = growQuad(baseQuad, cropMargin);

  // 把四边形换算到原图坐标，取外接矩形作为裁剪范围。
  const scaleX = width / analysisWidth, scaleY = height / analysisHeight;
  const cropQuadFull = cropQuad.map(([x, y]) => [x * scaleX, y * scaleY]);
  const allX = cropQuadFull.map((p) => p[0]), allY = cropQuadFull.map((p) => p[1]);
  const cropX = clampNumber(Math.floor(Math.min(...allX)), 0, width - 1);
  const cropY = clampNumber(Math.floor(Math.min(...allY)), 0, height - 1);
  const cropRight = clampNumber(Math.ceil(Math.max(...allX)), cropX + 1, width);
  const cropBottom = clampNumber(Math.ceil(Math.max(...allY)), cropY + 1, height);
  const cropWidth = cropRight - cropX, cropHeight = cropBottom - cropY;
  // 裁剪范围几乎等于整幅画面时没有裁剪价值，保持原图更干净（也避免无谓重编码）。
  if (cropWidth >= width * 0.995 && cropHeight >= height * 0.995) return keepWholeImage();

  // 输出画布：只搬运，不缩放内容（仅在超过上限时等比缩小）。
  const outScale = Math.min(1, CLEAN_MAX_EDGE / Math.max(cropWidth, cropHeight));
  const outWidth = Math.max(1, Math.round(cropWidth * outScale));
  const outHeight = Math.max(1, Math.round(cropHeight * outScale));
  const result = document.createElement('canvas');
  result.width = outWidth; result.height = outHeight;
  const resultContext = result.getContext('2d', { willReadFrequently: true });
  resultContext.imageSmoothingQuality = 'high';
  resultContext.drawImage(full, cropX, cropY, cropWidth, cropHeight, 0, 0, outWidth, outHeight);

  // 只处理作品四边形以外的像素（即纸外的桌面/地面/背景）。
  // 做法是「填白」而不是「透明」：纸外区域本来就不是作品，而装裱时卡纸底色也是白的，
  // 所以两者视觉完全一致；但填白后的图是纯不透明图，JPEG 能把它压到透明 PNG 的 1/5 左右，
  // 模型输入和内存都省下近 1MB。四边形内部的像素一个都不动。
  const quadOut = keepQuad.map(([x, y]) => [(x * scaleX - cropX) * outScale, (y * scaleY - cropY) * outScale]);
  const spans = quadColumnSpans(quadOut, outWidth, outHeight);
  const cleanPixels = resultContext.getImageData(0, 0, outWidth, outHeight);
  const data = cleanPixels.data;
  for (let x = 0; x < outWidth; x += 1) {
    const lo = spans.top[x], hi = spans.bottom[x];
    const columnInside = hi > lo;
    for (let y = 0; y < outHeight; y += 1) {
      // 完全落在作品内部的像素直接跳过，一个字节都不改。
      const coverage = columnInside ? Math.min(y + 1, hi) - Math.max(y, lo) : 0;
      if (coverage >= 1) continue;
      const index = (y * outWidth + x) * 4;
      const mix = 1 - Math.max(0, coverage);
      data[index] += (255 - data[index]) * mix;
      data[index + 1] += (255 - data[index + 1]) * mix;
      data[index + 2] += (255 - data[index + 2]) * mix;
      data[index + 3] = 255;
    }
  }
  resultContext.putImageData(cleanPixels, 0, 0);
  return result.toDataURL('image/jpeg', 0.94);
}

/**
 * 在给定亮度阈值下，找出「作品所在的那张纸」的最大连通域。
 *
 * 步骤：阈值化 → 4px 网格采样 → 桥接（把被笔触切碎的纸连成一体）→ 四邻域连通域 → 取最大者。
 * 任何一步判断不成立都返回 null，由调用方决定是换阈值重试还是干脆不裁。
 */
function detectSheet({ pixels, analysisWidth, analysisHeight, sample, threshold }) {
  const isPaper = (x, y) => {
    const index = (y * analysisWidth + x) * 4;
    const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
    return (r + g + b) / 3 >= threshold && Math.max(r, g, b) - Math.min(r, g, b) <= NEUTRAL_SPREAD;
  };
  const gridWidth = Math.ceil(analysisWidth / sample);
  const gridHeight = Math.ceil(analysisHeight / sample);
  const total = gridWidth * gridHeight;
  const paperGrid = new Uint8Array(total);
  let paperCount = 0;
  for (let gy = 0; gy < gridHeight; gy += 1) for (let gx = 0; gx < gridWidth; gx += 1) {
    if (isPaper(Math.min(analysisWidth - 1, gx * sample), Math.min(analysisHeight - 1, gy * sample))) {
      paperGrid[gy * gridWidth + gx] = 1;
      paperCount += 1;
    }
  }
  // 判定为纸的格子太少：不是「白纸上的作品」这张图，没必要继续。
  if (paperCount < total * 0.05) return null;

  // 孩子的彩色笔触会把一张纸切成几十个小块；先把邻近纸块连起来，
  // 才能得到「一整张纸」的轮廓，而不是一堆碎片各自成为一个小连通域。
  const bridge = 5;
  const sheetGrid = new Uint8Array(total);
  for (let gy = 0; gy < gridHeight; gy += 1) for (let gx = 0; gx < gridWidth; gx += 1) {
    if (!paperGrid[gy * gridWidth + gx]) continue;
    for (let dy = -bridge; dy <= bridge; dy += 1) for (let dx = -bridge; dx <= bridge; dx += 1) {
      if (dx * dx + dy * dy > bridge * bridge) continue;
      const nx = gx + dx, ny = gy + dy;
      if (nx >= 0 && ny >= 0 && nx < gridWidth && ny < gridHeight) sheetGrid[ny * gridWidth + nx] = 1;
    }
  }

  const visited = new Uint8Array(total);
  let best = null;
  for (let seed = 0; seed < total; seed += 1) {
    if (!sheetGrid[seed] || visited[seed]) continue;
    const queue = [seed]; visited[seed] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const point = queue[cursor], gx = point % gridWidth, gy = (point - gx) / gridWidth;
      for (const [nx, ny] of [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]]) {
        if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) continue;
        const next = ny * gridWidth + nx;
        if (sheetGrid[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
      }
    }
    if (!best || queue.length > best.cells.length) {
      let minX = gridWidth, maxX = -1, minY = gridHeight, maxY = -1;
      for (const point of queue) {
        const gx = point % gridWidth, gy = (point - gx) / gridWidth;
        if (gx < minX) minX = gx; if (gx > maxX) maxX = gx;
        if (gy < minY) minY = gy; if (gy > maxY) maxY = gy;
      }
      best = { cells: queue, minX, maxX, minY, maxY };
    }
  }
  if (!best) return null;

  // 合理性校验：纸要占够画面的比例，轮廓要接近矩形（填满自己的外接框）。
  // 否则说明检出的可能是一面墙或一块桌面，放弃这一档阈值。
  const boxCells = (best.maxX - best.minX + 1) * (best.maxY - best.minY + 1);
  const areaRatio = best.cells.length / total;
  const fillRatio = best.cells.length / boxCells;
  if (areaRatio < 0.06 || fillRatio < 0.42) return null;
  // 三边以上贴到画面边缘的「纸」，几乎一定是墙面或桌布而不是画纸：
  // 孩子把作品放在桌面/地面上拍时，四周总会有环境。这种情况退到更严格的阈值，
  // 仍不成立就由调用方回退为不裁剪。
  const touchingBorders = [
    best.minX <= 0, best.maxX >= gridWidth - 1, best.minY <= 0, best.maxY >= gridHeight - 1
  ].filter(Boolean).length;
  if (touchingBorders >= 3) return null;

  return { best, paperGrid, gridWidth, gridHeight, total, boxCells, areaRatio, fillRatio, touchingBorders, sample };
}

/**
 * 为凸四边形逐列求上下边界（列坐标系即输出画布坐标系）。
 * 凸四边形与一条竖线最多交于两点，取最小/最大 y 即为该列的可见区间。
 * 列内无边（NaN）表示该列完全在作品之外。
 */
function quadColumnSpans(quad, width, height) {
  const top = new Float32Array(width);
  const bottom = new Float32Array(width);
  for (let x = 0; x < width; x += 1) {
    const columnX = x + 0.5;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < quad.length; i += 1) {
      const [ax, ay] = quad[i], [bx, by] = quad[(i + 1) % quad.length];
      if ((ax - columnX) * (bx - columnX) > 0) continue;
      const t = Math.abs(bx - ax) < 1e-6 ? 0 : (columnX - ax) / (bx - ax);
      const y = ay + (by - ay) * t;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    if (!Number.isFinite(lo) || hi <= lo) { top[x] = NaN; bottom[x] = NaN; }
    else { top[x] = clampNumber(lo, 0, height); bottom[x] = clampNumber(hi, 0, height); }
  }
  return { top, bottom };
}

/**
 * 自然课堂照片优化：只做轻微曝光、对比与色彩校正，不改变五官、身材、表情或画面内容。
 * 保留完整画面，后续再由相片框函数添加白边和署名。
 */
export async function enhanceClassroomPhoto({ source }) {
  const image = await loadImage(source);
  // 输出 4:5 人像比例；横向居中、纵向略向上取景，优先保留脸部与上半身。
  // 这是不改变人物本身的裁剪，不做人脸重绘或五官修改。
  const targetRatio = 4 / 5;
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  let cropWidth = image.naturalWidth;
  let cropHeight = image.naturalHeight;
  let cropX = 0;
  let cropY = 0;
  if (sourceRatio > targetRatio) {
    cropWidth = image.naturalHeight * targetRatio;
    cropX = (image.naturalWidth - cropWidth) / 2;
  } else {
    cropHeight = image.naturalWidth / targetRatio;
    // 比纯居中略上移，让课堂人物的脸部和手部更容易保留在画面中。
    cropY = Math.max(0, (image.naturalHeight - cropHeight) * 0.28);
  }
  const height = 1800;
  const width = Math.round(height * targetRatio);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.filter = 'brightness(1.055) contrast(1.045) saturate(1.025)';
  ctx.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, width, height);
  ctx.filter = 'none';
  return canvas.toDataURL('image/jpeg', 0.92);
}

/** 第一版真实装裱：只做完整展示与画布合成，绝不重绘或裁掉孩子的作品。 */
export async function createExhibitionFrame({ source, style = '星光展', student = '陈一诺', title = '向着光的花', date = '2026.08.11', rotation = 0 }) {
  const image = await loadImage(source);
  const palette = FRAME_STYLES[style] || FRAME_STYLES['星光展'];
  const width = 1800, height = 1360, outer = 56, mat = 88, plaqueHeight = 96;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fbf8f2'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = palette.outer; ctx.fillRect(34, 34, width - 68, height - 68);
  ctx.fillStyle = palette.inner; ctx.fillRect(34 + outer, 34 + outer, width - 68 - outer * 2, height - 68 - outer * 2);
  const area = { x: 34 + outer + mat, y: 34 + outer + mat, width: width - 68 - (outer + mat) * 2, height: height - 68 - (outer + mat) * 2 - plaqueHeight };
  const ratio = Math.min(area.width / image.naturalWidth, area.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * ratio, renderedHeight = image.naturalHeight * ratio;
  const x = area.x + (area.width - renderedWidth) / 2, y = area.y + (area.height - renderedHeight) / 2;
  ctx.fillStyle = '#fff'; ctx.fillRect(area.x, area.y, area.width, area.height);
  ctx.save();
  ctx.translate(area.x + area.width / 2, area.y + area.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  const rotated = rotation % 180 !== 0;
  const scale = rotated ? Math.min(area.width / renderedHeight, area.height / renderedWidth) : 1;
  ctx.drawImage(image, -renderedWidth * scale / 2, -renderedHeight * scale / 2, renderedWidth * scale, renderedHeight * scale);
  ctx.restore();
  const plaqueY = area.y + area.height + 26;
  ctx.fillStyle = palette.plaque; ctx.fillRect(area.x, plaqueY, area.width, 2);
  ctx.font = '600 30px serif'; ctx.fillText(`${student}  ·  《${title}》`, area.x, plaqueY + 39);
  ctx.fillStyle = '#6d6559'; ctx.font = '24px sans-serif'; ctx.fillText(`创作于 ${date}`, area.x, plaqueY + 74);
  return canvas.toDataURL('image/jpeg', 0.92);
}

/** 课堂照片的保守呈现：完整保留人物，只添加白边、阴影和日期，不做人像重绘。 */
export async function createPortraitPrint({ source, student = '陈一诺', date = '2026.08.11' }) {
  return enhanceClassroomPhoto({ source });
}

/**
 * 相框（或卡纸）的填充：半径为 0 时走 `fillRect`，与升级前的实色矩形**逐像素一致**；
 * 只有圆角形状才走路径填充。
 */
function fillFrameShape(ctx, rect, radius, fill) {
  if (radius > 0) {
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    return;
  }
  ctx.fillStyle = fill;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

/** 按形状路径填充（拱形 / 斜角用）。 */
function fillShapePath(ctx, shape, fill) {
  traceShape(ctx, shape);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * arch / bevel 的同心几何：外框 → 卡纸 → 卡纸开口，三层都是「外框形状向内缩外层厚度」得到的，
 * 所以框带处处等宽（斜边的切角长度另有 `CHAMFER_INSET_FACTOR` 修正，见 `frameShapes.js`）。
 *
 * 形状不可用（半径 / 开口被收敛到 0，例如画布过扁）时也返回 null，调用方回落到直角路径 —— 宁可画平框，
 * 也不能画崩或把作品裁掉。
 */
function buildShapedGeometry({ shape, frameRect, outer, mat, plaqueHeight }) {
  // **只有 arch / bevel 走这条路径**：square / rounded 是 US-002a 的既有渲染路径，
  // 一旦被这里接管就会换形状（踩过的坑：漏了形状判断，`rounded` 与 v1 平面 spec 全被画成斜角）。
  if (shape !== 'arch' && shape !== 'bevel') return null;
  const base = shape === 'arch' ? archShape(frameRect) : bevelShape(frameRect);
  const inset = (current, distance) => (shape === 'arch' ? archInset(current, distance) : bevelInset(current, distance));
  const matShape = inset(base, outer);
  const windowShape = inset(matShape, mat);
  const box = shapeBox(windowShape);
  if (!(box.width > 0) || !(box.height > 0)) return null;
  // 拱形的开口必须还剩正半径，否则拱顶已经吃到直边，回落到直角更稳。
  if (shape === 'arch' && !(windowShape.r > 0)) return null;
  return {
    base,
    matShape,
    windowShape,
    // 卡纸内细分隔线画在开口外沿 6px 处（与直角分支的 strokeRect(area-6, +12) 同一个口径）。
    innerLineShape: inset(windowShape, -6),
    box,
    // 展签与直角分支一样占开口底部 96px。
    artBottom: box.y + box.height - plaqueHeight
  };
}

/**
 * 相框的光影：沿 `frame.lighting.angle` 铺一条「高光 → 本色 → 暗部」的线性渐变，
 * 让暖金 / 木质看起来有体积感，而不是一块死色。
 *
 * `angle` 与 CSS `linear-gradient` 同角度语义（0° 朝上、90° 朝右、135° 由左上到右下），
 * 渐变**起点**一侧朝向光源，所以默认的 135° 是「高光在左上、暗部在右下」。
 * 渐变只铺在外框上，不会盖到卡纸与作品（卡纸随后绘制在其内圈）。
 */
function frameLightingFill(ctx, rect, lighting, baseColor) {
  const angle = (((Number(lighting.angle) || 0) % 360) + 360) % 360;
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad);
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  // 沿光方向穿过整个外框的投影长度：高光与暗部两端都完整落在框上，不被截断。
  const span = Math.abs(dx) * rect.width + Math.abs(dy) * rect.height;
  const gradient = ctx.createLinearGradient(
    cx - (dx * span) / 2, cy - (dy * span) / 2,
    cx + (dx * span) / 2, cy + (dy * span) / 2
  );
  gradient.addColorStop(0, lighting.highlight);
  gradient.addColorStop(0.5, baseColor);
  gradient.addColorStop(1, lighting.shadow);
  return gradient;
}

/**
 * 叠加元素图片（机构 Logo / 手写签名图）的加载缓存：同一份模板连续渲染（批量套用、画廊）时
 * 不必反复解码同一张图。键是地址，值是 `Promise<Image|null>`。
 */
const overlayImageCache = new Map();

/**
 * 加载一张叠加元素图片，**失败一律返回 `null`**（画笔自己跳过）：一张坏 Logo 的失败面应该是
 * 「少了水印」，绝不该是「整幅成品图渲染失败」。
 */
function loadOverlayImage(url) {
  const source = String(url ?? '').trim();
  if (!source) return Promise.resolve(null);
  if (overlayImageCache.has(source)) return overlayImageCache.get(source);
  const promise = loadImage(source).catch(() => null);
  // 简单上限：机构 Logo / 签名图只有个位数，缓存别无限涨（超出直接清空，重新解码的代价可以接受）。
  if (overlayImageCache.size >= 8) overlayImageCache.clear();
  overlayImageCache.set(source, promise);
  return promise;
}

/**
 * 载入叠加元素里**已接画笔的图片类元素**（US-003b 是机构 Logo）。
 * 只解码「`visible === true`」的那些 —— 不可见的元素连解码都不做，与「不绘制、不留占位」是同一条纪律。
 */
async function loadOverlayImages(overlays) {
  const entries = visibleOverlayElements(overlayElementEntries(overlays))
    .filter(({ kind }) => DRAWN_OVERLAY_KINDS.includes(kind));
  const images = {};
  await Promise.all(entries.map(async ({ kind, element }) => {
    const url = kind === 'signature' ? element?.imageUrl : element?.url;
    if (!url) return;
    const image = await loadOverlayImage(url);
    if (image) images[kind] = image;
  }));
  return images;
}

/**
 * 文本类叠加元素的画笔（US-003a 的绘制层入口）。
 *
 * 位置、字号、对齐、透明度与旋转**全部由 `planOverlayText()`（overlayLayout.js）算好**，
 * 这里只做 fillText —— 绘制层再做一次位置推算就会和后台面板的九宫格预览漂移。
 * `plan` 为 null（元素不可见 / 内容替换后为空）时一个像素都不碰。
 */
function paintOverlayText(ctx, plan) {
  if (!plan || !plan.text) return;
  ctx.save();
  ctx.globalAlpha = plan.opacity;
  ctx.fillStyle = plan.color;
  ctx.font = `${plan.fontSize}px ${plan.fontFamily}`;
  ctx.textAlign = plan.textAlign;
  ctx.textBaseline = plan.textBaseline;
  if (plan.rotateDeg) {
    // 绕锚点旋转：锚点就是 textAlign / textBaseline 指定的那个点，转完仍在同一格子。
    ctx.translate(plan.x, plan.y);
    ctx.rotate((plan.rotateDeg * Math.PI) / 180);
    ctx.fillText(plan.text, 0, 0);
  } else {
    ctx.fillText(plan.text, plan.x, plan.y);
  }
  ctx.restore();
}

/**
 * 图片类叠加元素的画笔（US-003b：机构 Logo）。
 *
 * 框（位置 + 尺寸）由 `resolveOverlayImageBox()` 按「宽度比例 + 图片自身比例」算好并做过越界收敛，
 * 这里只 `drawImage` —— **不拉伸、不裁切、不调色**（框的比例就等于图片比例）。
 * 框或图片缺失时什么都不画，也不留空白占位。
 */
function paintOverlayImage(ctx, box, image, opacity) {
  if (!image || !box || !(box.width > 0) || !(box.height > 0)) return;
  const alpha = Number(opacity);
  ctx.save();
  ctx.globalAlpha = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, box.x, box.y, box.width, box.height);
  ctx.restore();
}

/**
 * 叠加元素绘制层（水印 / 落款 / 时间 / 二维码），画在**最上层**（作品、卡纸、相框都已画完），
 * 位置相对整块画布短边。
 *
 * **绘制门控**：只有 `visible === true` 且**已经接了画笔**的类别会进这一层
 * （`visibleOverlayElements` + `DRAWN_OVERLAY_KINDS`），不可见的元素连画笔都不会被调用 ——
 * 所以既不会画出东西，也不会留下任何空白占位（US-003a 的验收原文）。
 *
 * 已接画笔：文字水印（US-003a）、机构 Logo（US-003b）。
 * 二维码 / 落款（含印章）/ 时间的画笔由 US-003c 接在同一个门控后面 —— 新增时三处一起改：
 * `overlayLayout.js` 的 `DRAWN_OVERLAY_KINDS` + 这里的画笔分支 + `loadOverlayImages` 的取图分支。
 */
async function drawOverlayElements(ctx, { width, height, overlays, context, images }) {
  const entries = visibleOverlayElements(overlayElementEntries(overlays))
    .filter(({ kind }) => DRAWN_OVERLAY_KINDS.includes(kind));
  for (const { kind, element } of entries) {
    if (kind === 'watermark.text') {
      paintOverlayText(ctx, planOverlayText({ element, canvasWidth: width, canvasHeight: height, context }));
      continue;
    }
    if (kind === 'watermark.logo') {
      const image = images?.[kind] || null;
      if (!image) continue;
      paintOverlayImage(ctx, resolveOverlayImageBox({
        element,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        canvasWidth: width,
        canvasHeight: height
      }), image, element?.opacity);
    }
  }
}

/** 文本测量的临时 canvas（只在 `measureFramingCoverage` 里用来量墨迹，不进渲染结果）。 */
let overlayMeasureCanvas = null;

function overlayMeasureContext() {
  if (!overlayMeasureCanvas && typeof document !== 'undefined') {
    overlayMeasureCanvas = document.createElement('canvas').getContext('2d') || null;
  }
  return overlayMeasureCanvas;
}

/**
 * 注入给 `overlayLayout` 的文本测量：宽度 + 墨迹 ascent / descent。
 * Chrome 给得出 `actualBoundingBox*`，拿不到时按 `0.8em / 0.2em` 估（与 textPlanBox 的兜底同一个口径）。
 */
function measureOverlayTextForBox(text, font) {
  const ctx = overlayMeasureContext();
  if (!ctx) return {};
  ctx.font = font;
  const metrics = ctx.measureText(String(text ?? ''));
  const fontSize = Number.parseFloat(String(font).match(/(\d+(?:\.\d+)?)px/)?.[1] || '') || 0;
  const ascent = Number(metrics.actualBoundingBoxAscent) > 0 ? metrics.actualBoundingBoxAscent : fontSize * 0.8;
  const descent = Number(metrics.actualBoundingBoxDescent) > 0 ? metrics.actualBoundingBoxDescent : fontSize * 0.2;
  return { width: metrics.width, ascent, descent };
}

/**
 * 「水印 / 落款遮挡作品主体」的统计（US-003b 的验收：超过 15% 面积给出提示）。
 *
 * 与 `renderFramedArtwork` **共用同一份几何**（`buildFramingLayout`）与同一份取框规则
 * （`overlayElementBoxes` + `resolveOverlayImageBox`），所以面板上算出来的百分比就是成品图上
 * 真实压住的面积 —— 不要在这里另算一套「作品区」矩形。
 *
 * 入参口径：`imageWidth / imageHeight` 是**作品原始像素**（与渲染时同一张图），
 * `rotation` 不传则按 `spec.art.rotateDeg`（与渲染一致）。返回
 * `evaluateOverlayCoverage()` 的结果（含 `coveredRatio` / `exceeds` / `message` / `items`）。
 */
export async function measureFramingCoverage({
  spec = {},
  imageWidth,
  imageHeight,
  rotation,
  orgName = '',
  teacherName = '',
  student = '',
  title = '',
  date = '',
  variables = null,
  limit = OVERLAY_COVERAGE_LIMIT
} = {}) {
  const view = frameSpecRenderView(spec);
  const layout = buildFramingLayout({ view, imageWidth, imageHeight, rotation });
  if (!view.overlays) {
    // v1 平面 spec 一个叠加元素都不画 → 遮挡恒为 0（与渲染层同一个判据）。
    return evaluateOverlayCoverage({ boxes: [], subjectRect: layout.subjectRect, limitRatio: limit });
  }
  const context = overlayVariableContext({
    orgName,
    studentName: student,
    workTitle: title,
    teacherName,
    lessonDate: date,
    ...(variables && typeof variables === 'object' ? variables : {})
  });
  const images = await loadOverlayImages(view.overlays);
  const imageSizes = {};
  for (const [kind, image] of Object.entries(images)) {
    imageSizes[kind] = { width: image.naturalWidth, height: image.naturalHeight };
  }
  const boxes = overlayElementBoxes({
    overlays: view.overlays,
    canvasWidth: layout.width,
    canvasHeight: layout.height,
    context,
    measureText: measureOverlayTextForBox,
    imageSizes
  });
  return evaluateOverlayCoverage({ boxes, subjectRect: layout.subjectRect, limitRatio: limit });
}

/**
 * 按「装裱参数」渲染装裱图（后台可配置 / 大模型生成的那套参数）。
 *
 * 与 createExhibitionFrame 的差别：这里没有硬编码样式表，颜色、框宽、形状、卡纸与光影全部来自 spec。
 * 不变量保持不变 —— 作品只做等比缩放与居中，不裁切、不重绘、不调色。
 *
 * spec 可以是 **v1 平面结构**，也可以是 **v2 结构**（`services/frameSpec.js`）；
 * 统一由 `frameSpecRenderView()` 取渲染视图：v1 原样返回（老模板逐像素不变，形状按直角、不画光影），
 * v2 映射出平面字段 + shape / cornerRadiusRatio / lighting / matVisible。
 *
 * 本故事（US-002a/002b）落地的形状是四种：`square`（直角）、`rounded`（圆角）、
 * `arch`（顶部半圆拱形）、`bevel`（四角斜切）。
 * 直角与圆角走既有路径（逐像素不变）；arch / bevel 走「同心内缩 + 形状内最大等比矩形」的路径
 * （`services/frameShapes.js`）：作品永远不被裁切，形状内剩余部分留给白色作品底。
 *
 * 平面字段（frameSpecRenderView 的产物）：
 *   outer / mat / innerLine / plaqueBg / plaqueText  十六进制颜色（innerLine 可为 null）
 *   outerWidthRatio / matWidthRatio                  相对画布短边的比例（越界收敛到生效范围）
 *   plaqueFontFamily / plaqueLetterSpacing           展签字体与字距
 *   artRotateDeg                                     0 或 90
 *   shape / cornerRadiusRatio                        形状与圆角半径（相对画布短边）
 *   lighting                                         { highlight, shadow, angle } 或 null（不画光影）
 *   matVisible                                       卡纸开关
 *   overlays                                         v2 的水印 / 落款 / 时间分组；v1 平面 spec 为 null
 *
 * 叠加元素的变量上下文（US-003a）：`{机构名}` / `{学员名}` / `{作品名}` / `{老师姓名}` / `{课次日期}`
 * 由 `orgName` / `student` / `title` / `teacherName` / `date` 拼出来，也可以用 `variables` 直接覆盖
 * （批量套用与另存模板时用得上）。上下文里的空值替换成空串，因此不会把 `{机构名}` 原样印在画面上。
 */
/**
 * 装裱几何：从**渲染视图 + 作品像素尺寸**算出这次渲染要用的全部矩形。
 *
 * 抽出来是因为 US-003b 的「水印遮挡作品主体」统计必须和渲染**看同一份几何** ——
 * 在面板里另算一套「作品区」迟早会和真正的作画区域漂移（形状分支的作品区是形状内最大等比矩形，
 * 不是固定的那个 `area`）。`renderFramedArtwork` 与 `measureFramingCoverage` 都调它。
 *
 * 返回里几个词的口径：
 *   - `area`        直角 / 圆角分支的固定作品区（卡纸开口扣掉展签）；
 *   - `artRect`     作品**实际可以铺开**的区域：直角 / 圆角 = `area`，arch / bevel = 形状内最大等比矩形；
 *   - `subjectRect` 作品**真正占住**的那块矩形（等比缩放 + 居中之后的大小），
 *                   「水印遮挡作品主体 15%」的分母就是它 —— 不是整块画布，也不是卡纸开口。
 */
function buildFramingLayout({ view, imageWidth = 1, imageHeight = 1, rotation }) {
  const width = FRAME_CANVAS_WIDTH;
  const height = FRAME_CANVAS_HEIGHT;
  const shortEdge = Math.min(width, height);
  const imageW = Number(imageWidth) > 0 ? Number(imageWidth) : 1;
  const imageH = Number(imageHeight) > 0 ? Number(imageHeight) : 1;

  const wall = Math.round(shortEdge * 0.025);
  // 框宽 / 卡纸宽的收敛在渲染层再做一次：v1 平面 spec 原样进来，没有收敛器兜着。
  const outer = Math.max(4, Math.round(shortEdge * clampRatio(view.outerWidthRatio, FRAME_WIDTH_RATIO_RANGE, 0.0412)));
  const mat = view.matVisible === false ? 0 : Math.max(6, Math.round(shortEdge * clampRatio(view.matWidthRatio, MAT_WIDTH_RATIO_RANGE, 0.0647)));
  const plaqueHeight = PLAQUE_HEIGHT;

  const frameRect = { x: wall, y: wall, width: width - wall * 2, height: height - wall * 2 };
  const matRect = {
    x: frameRect.x + outer, y: frameRect.y + outer,
    width: frameRect.width - outer * 2, height: frameRect.height - outer * 2
  };
  // 卡纸开口：直角 / 圆角分支的固定作品区就是它的上半部分（扣掉展签）。
  const windowRect = {
    x: matRect.x + mat, y: matRect.y + mat,
    width: matRect.width - mat * 2, height: matRect.height - mat * 2
  };
  const area = { x: windowRect.x, y: windowRect.y, width: windowRect.width, height: windowRect.height - plaqueHeight };

  // rotation 显式传入时优先（老师手动旋转）；否则用 spec 里的 artRotateDeg。
  const deg = Number.isFinite(rotation) ? rotation : (Number(view.artRotateDeg) === 90 ? 90 : 0);
  const sideways = ((deg % 360) + 360) % 360 % 180 !== 0;

  // arch / bevel：形状不可用时 geometry 为 null，两个分支都回落到直角路径（不画崩）。
  const geometry = buildShapedGeometry({ shape: view.shape, frameRect, outer, mat, plaqueHeight });
  const shaped = !!geometry;
  const shapedArt = shaped
    ? inscribeAspectRect(geometry.windowShape, {
      aspect: sideways ? imageH / imageW : imageW / imageH,
      top: geometry.box.y,
      bottom: geometry.artBottom
    })
    : null;
  // 作品区：直角 / 圆角 = 既有的固定 area；arch / bevel = 形状内放得下的最大等比矩形。
  const artRect = shapedArt || area;
  // 展签锚在「作品区下沿」而不是作品自身下沿：与直角分支一致（作品居中时展签仍然贴开口底部）。
  const artRegionBottom = shaped ? geometry.artBottom : area.y + area.height;
  const plaqueX = shaped ? geometry.box.x : area.x;
  const plaqueW = shaped ? geometry.box.width : area.width;

  // 圆角半径的三条上限，缺一条就会踩到红线：
  //   ① 越界值收敛到 0~0.5（相对短边）；
  //   ② 不超过外框短边的一半（否则路径自交）；
  //   ③ 内圈半径不超过卡纸宽 —— 否则圆角会切进作品窗口，等于把孩子的画裁掉四个角。
  const outerRadius = view.shape === 'rounded'
    ? Math.min(Math.round(shortEdge * clampRatio(view.cornerRadiusRatio, CORNER_RADIUS_RATIO_RANGE, 0.06)), Math.max(0, Math.floor(Math.min(frameRect.width, frameRect.height) / 2)))
    : 0;
  const matRadius = Math.max(0, Math.min(outerRadius - outer, mat));

  // 作品的等比缩放（只缩放与居中，不裁切、不调色、不重绘）与它真正占住的矩形。
  const ratio = Math.min(artRect.width / imageW, artRect.height / imageH);
  const renderedWidth = imageW * ratio;
  const renderedHeight = imageH * ratio;
  const drawScale = sideways ? Math.min(artRect.width / renderedHeight, artRect.height / renderedWidth) : 1;
  const subjectWidth = (sideways ? renderedHeight : renderedWidth) * drawScale;
  const subjectHeight = (sideways ? renderedWidth : renderedHeight) * drawScale;
  const subjectRect = {
    x: artRect.x + artRect.width / 2 - subjectWidth / 2,
    y: artRect.y + artRect.height / 2 - subjectHeight / 2,
    width: subjectWidth,
    height: subjectHeight
  };

  return {
    width, height, shortEdge, wall, outer, mat, plaqueHeight,
    frameRect, matRect, windowRect, area,
    geometry, shaped, artRect, artRegionBottom, plaqueX, plaqueW,
    outerRadius, matRadius,
    deg, sideways, ratio, renderedWidth, renderedHeight, drawScale,
    subjectRect
  };
}

export async function renderFramedArtwork({ source, spec = {}, student = '', title = '', date = '', rotation, orgName = '', teacherName = '', variables = null }) {
  const image = await loadImage(source);

  const view = frameSpecRenderView(spec);
  const outerColor = view.outer || '#cfa52e';
  const matColor = view.mat || '#f3ede2';
  const plaqueBg = view.plaqueBg || '#2b271f';
  const plaqueText = view.plaqueText || '#fbf8f2';
  const plaqueFont = view.plaqueFontFamily || 'serif';
  const letterSpacing = Number.isFinite(view.plaqueLetterSpacing) ? view.plaqueLetterSpacing : 1;

  const layout = buildFramingLayout({ view, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight, rotation });
  const {
    width, height, outer, mat, plaqueHeight,
    frameRect, matRect, area,
    geometry, shaped, artRect, artRegionBottom, plaqueX, plaqueW,
    outerRadius, matRadius,
    deg, sideways, renderedWidth, renderedHeight, drawScale
  } = layout;

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');

  // 最外圈是展墙，用卡纸色的浅色版本，避免出现纯白死边。
  ctx.fillStyle = matColor; ctx.fillRect(0, 0, width, height);
  if (shaped) {
    // 相框与卡纸：同一形状同心内缩，保证框带（含拱边与斜边）处处等宽。
    fillShapePath(ctx, geometry.base, view.lighting ? frameLightingFill(ctx, frameRect, view.lighting, outerColor) : outerColor);
    fillShapePath(ctx, geometry.matShape, matColor);
  } else {
    // 相框：显式配了 lighting 就用方向性渐变画高光与暗部，否则是 v1 的实色框。
    fillFrameShape(ctx, frameRect, outerRadius, view.lighting ? frameLightingFill(ctx, frameRect, view.lighting, outerColor) : outerColor);
    // 卡纸：与外框同圆角（内圈），保证圆角处不露底、不出现白缝。
    fillFrameShape(ctx, matRect, matRadius, matColor);
  }

  // 可选：卡纸内的细分隔线，只画线，不遮挡作品。卡纸关掉时不画（线会落在作品边上）。
  if (view.innerLine && mat > 0) {
    ctx.strokeStyle = view.innerLine;
    ctx.lineWidth = 2;
    if (shaped) {
      traceShape(ctx, geometry.innerLineShape);
      ctx.stroke();
    } else {
      ctx.strokeRect(area.x - 6, area.y - 6, area.width + 12, area.height + 12);
    }
  }

  // 作品底色固定为白，保证透明底 PNG 不会露出墙色。
  // arch / bevel：白底按形状铺、只铺到展签上沿，形状外的部分一律不碰（不露底、不越界）。
  ctx.fillStyle = '#ffffff';
  if (shaped) {
    ctx.save();
    traceShape(ctx, geometry.windowShape);
    ctx.clip();
    ctx.fillRect(geometry.box.x, geometry.box.y, geometry.box.width, geometry.artBottom - geometry.box.y);
    ctx.restore();
  } else {
    ctx.fillRect(area.x, area.y, area.width, area.height);
  }

  // 作品的等比缩放与居中（尺寸由 buildFramingLayout 算好，与遮挡统计共用一份）。
  ctx.save();
  ctx.translate(artRect.x + artRect.width / 2, artRect.y + artRect.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, -renderedWidth * drawScale / 2, -renderedHeight * drawScale / 2, renderedWidth * drawScale, renderedHeight * drawScale);
  ctx.restore();

  // 展签：只在有内容时绘制。
  // 必须先把 plaqueBg 铺成一块展签底色再写字——旧实现只画了 2px 分隔线，
  // 于是 plaqueText（多数预设是浅色）直接落在浅色卡纸上，落款几乎看不见。
  const plaqueTop = artRegionBottom + 10;
  const line1 = [student, title ? `《${title}》` : ''].filter(Boolean).join('  ·  ');
  const line2 = date ? `创作于 ${date}` : '';
  if (line1 || line2) {
    if (shaped) { ctx.save(); traceShape(ctx, geometry.windowShape); ctx.clip(); }
    ctx.fillStyle = plaqueBg;
    ctx.fillRect(plaqueX, plaqueTop, plaqueW, plaqueHeight - 10);
    const drawWithSpacing = (text, x, y, font, color) => {
      ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
      if (!letterSpacing) { ctx.fillText(text, x, y); return; }
      let cursor = x;
      for (const char of text) { ctx.fillText(char, cursor, y); cursor += ctx.measureText(char).width + letterSpacing; }
    };
    if (line1) drawWithSpacing(line1, plaqueX, plaqueTop + 36, `600 28px ${plaqueFont}`, plaqueText);
    if (line2) drawWithSpacing(line2, plaqueX, plaqueTop + 70, `21px ${plaqueFont}`, plaqueText);
    if (shaped) ctx.restore();
  }

  // 叠加元素（水印 / 落款 / 时间 / 二维码）永远画在最上层，位置相对**整块画布短边**
  // （不是作品区）—— 这样同一份模板在展签、卡纸、相框上都不会因为作品比例变化而跑位。
  // `view.overlays` 只有 v2 spec 才有；v1 平面 spec 是 null，一个像素都不碰。
  if (view.overlays) {
    // 显式传入的 variables 优先（批量套用 / 另存模板的场景），其余从既有入参拼。
    const overlayContext = overlayVariableContext({
      orgName,
      studentName: student,
      workTitle: title,
      teacherName,
      lessonDate: date,
      ...(variables && typeof variables === 'object' ? variables : {})
    });
    // 图片类元素（机构 Logo）先解码再画：解码失败 → 这一张不画（不留占位），其余照画。
    const images = await loadOverlayImages(view.overlays);
    await drawOverlayElements(ctx, { width, height, overlays: view.overlays, context: overlayContext, images });
  }

  return canvas.toDataURL('image/jpeg', 0.92);
}
