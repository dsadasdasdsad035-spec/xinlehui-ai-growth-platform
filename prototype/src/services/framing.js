import { frameSpecView } from './frameSpec';

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
 * 按「装裱参数」渲染装裱图（后台可配置 / 大模型生成的那套参数）。
 *
 * 与 createExhibitionFrame 的差别：这里没有硬编码样式表，颜色与框宽全部来自 spec。
 * 不变量保持不变 —— 作品只做等比缩放与居中，不裁切、不重绘、不调色。
 *
 * spec 可以是 **v1 平面结构**，也可以是 **v2 结构**（`services/frameSpec.js`）；
 * 统一由 `frameSpecView()` 取 v1 平面视图后再绘制：v1 原样返回（老模板逐像素不变），
 * v2 由 `frameSpecV2ToLegacy()` 映射。v2 独有的形状 / 光影 / 水印 / 落款 / 时间由后续故事接入这里。
 *
 * 平面字段（frameSpecView 的产物）：
 *   outer / mat / innerLine / plaqueBg / plaqueText  十六进制颜色（innerLine 可为 null）
 *   outerWidthRatio / matWidthRatio                  相对画布短边的比例
 *   plaqueFontFamily / plaqueLetterSpacing           展签字体与字距
 *   artRotateDeg                                     0 或 90
 */
export async function renderFramedArtwork({ source, spec = {}, student = '', title = '', date = '', rotation }) {
  const image = await loadImage(source);
  const width = 1800;
  const height = 1360;
  const shortEdge = Math.min(width, height);

  const view = frameSpecView(spec);
  const outerColor = view.outer || '#cfa52e';
  const matColor = view.mat || '#f3ede2';
  const plaqueBg = view.plaqueBg || '#2b271f';
  const plaqueText = view.plaqueText || '#fbf8f2';
  const plaqueFont = view.plaqueFontFamily || 'serif';
  const letterSpacing = Number.isFinite(view.plaqueLetterSpacing) ? view.plaqueLetterSpacing : 1;

  const wall = Math.round(shortEdge * 0.025);
  const outer = Math.max(4, Math.round(shortEdge * (view.outerWidthRatio ?? 0.0412)));
  const mat = Math.max(6, Math.round(shortEdge * (view.matWidthRatio ?? 0.0647)));
  const plaqueHeight = 96;

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');

  // 最外圈是展墙，用卡纸色的浅色版本，避免出现纯白死边。
  ctx.fillStyle = matColor; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = outerColor; ctx.fillRect(wall, wall, width - wall * 2, height - wall * 2);
  ctx.fillStyle = matColor; ctx.fillRect(wall + outer, wall + outer, width - (wall + outer) * 2, height - (wall + outer) * 2);

  const area = {
    x: wall + outer + mat,
    y: wall + outer + mat,
    width: width - (wall + outer + mat) * 2,
    height: height - (wall + outer + mat) * 2 - plaqueHeight
  };

  // 可选：卡纸内的细分隔线，只画线，不遮挡作品。
  if (view.innerLine) {
    ctx.strokeStyle = view.innerLine;
    ctx.lineWidth = 2;
    ctx.strokeRect(area.x - 6, area.y - 6, area.width + 12, area.height + 12);
  }

  // 作品底色固定为白，保证透明底 PNG 不会露出墙色。
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(area.x, area.y, area.width, area.height);

  const ratio = Math.min(area.width / image.naturalWidth, area.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * ratio;
  const renderedHeight = image.naturalHeight * ratio;

  // rotation 显式传入时优先（老师手动旋转）；否则用 spec 里的 artRotateDeg。
  const deg = Number.isFinite(rotation) ? rotation : (Number(view.artRotateDeg) === 90 ? 90 : 0);

  ctx.save();
  ctx.translate(area.x + area.width / 2, area.y + area.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  const sideways = ((deg % 360) + 360) % 360 % 180 !== 0;
  const scale = sideways ? Math.min(area.width / renderedHeight, area.height / renderedWidth) : 1;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, -renderedWidth * scale / 2, -renderedHeight * scale / 2, renderedWidth * scale, renderedHeight * scale);
  ctx.restore();

  // 展签：只在有内容时绘制。
  // 必须先把 plaqueBg 铺成一块展签底色再写字——旧实现只画了 2px 分隔线，
  // 于是 plaqueText（多数预设是浅色）直接落在浅色卡纸上，落款几乎看不见。
  const plaqueTop = area.y + area.height + 10;
  const line1 = [student, title ? `《${title}》` : ''].filter(Boolean).join('  ·  ');
  const line2 = date ? `创作于 ${date}` : '';
  if (line1 || line2) {
    ctx.fillStyle = plaqueBg;
    ctx.fillRect(area.x, plaqueTop, area.width, plaqueHeight - 10);
    const drawWithSpacing = (text, x, y, font, color) => {
      ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
      if (!letterSpacing) { ctx.fillText(text, x, y); return; }
      let cursor = x;
      for (const char of text) { ctx.fillText(char, cursor, y); cursor += ctx.measureText(char).width + letterSpacing; }
    };
    if (line1) drawWithSpacing(line1, area.x, plaqueTop + 36, `600 28px ${plaqueFont}`, plaqueText);
    if (line2) drawWithSpacing(line2, area.x, plaqueTop + 70, `21px ${plaqueFont}`, plaqueText);
  }

  return canvas.toDataURL('image/jpeg', 0.92);
}
