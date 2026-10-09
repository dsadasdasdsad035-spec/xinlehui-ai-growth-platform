// 实景图 → 3D 展厅重建。
//
// 设计原则：**不做任何凭空建模**。房间的长宽高、相机位置、墙面材质全部从这张照片里推出来。
// 只有两个外部假设，都作为可调参数暴露：镜头水平视场角、拍摄者眼高。
//
// 推导链（一点透视）：
//   1. 从照片里检测后墙矩形 (x0,y0,x1,y1)——它是画面中央那个被四条强边围住的矩形。
//   2. 针孔模型：imgX = px + f·X/d，imgY = py − f·(Y−camY)/d，其中 d 是景深（相机前方距离）。
//      取主点 = 画面中心，f = (W/2)/tan(hfov/2)。
//   3. 后墙下沿就是地板线：y1 = py + f·camY/d_far  →  d_far = f·camY/(y1 − py)。
//      这一条直接给出「相机到后墙的距离」，不需要假设房间多大。
//   4. 后墙上沿给出层高：H = camY + (py − y0)·d_far/f。
//   5. 后墙左右边给出房间宽：xL = (x0 − px)·d_far/f，xR = (x1 − px)·d_far/f。
//   6. 墙面材质：为每个面取一块世界坐标矩形，把四个角投影回图像得到源四边形，
//      再用单应变换做透视矫正 —— 所以贴图是真的从照片里"拉平"出来的，不是纯色。
//
// 关键取舍：房间的近端边界取在「所有面都还完整落在画面内」的那个景深处（dNear）。
// 这样五个面（后墙/左墙/右墙/地板/天花板）都能被完整矫正、无越界采样，
// 重建出的就是照片里真实存在的那一段房间。

// 版本号变更原因（room-reconstruct-v1 → v2）：
// 边检测加入「阶跃一致性」权重，把壁灯光晕/木纹缝这类会翻转符号的对称特征压掉；
// 修复明亮白顶天花板上筒灯阈值失效（mean·1.12 会超过 255）导致的静默退化。
// 检测结果与 v1 不同，缓存必须失效 —— 改算法请同步 +1。
export const ROOM_RECONSTRUCT_VERSION = 'room-reconstruct-v2';

export const DEFAULT_ROOM_OPTIONS = {
  hfovDeg: 66,        // 镜头水平视场角：手机主摄/24mm 广角大致 65°~75°
  eyeHeight: 1.6,     // 拍摄者眼高（米）
  hangingHeight: 1.55,// 作品中心挂高（美术馆惯例：画心中心离地约 1.5~1.6m）
  slotPitch: 1.1,     // 槽位间距（米）：按儿童作品挂墙的真实尺度，不是展厅海报尺度
  maxTextureEdge: 1024,
  analysisWidth: 800
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function normalizeRoomOptions(options = {}) {
  const next = { ...DEFAULT_ROOM_OPTIONS, ...options };
  return {
    hfovDeg: clamp(Number(next.hfovDeg) || DEFAULT_ROOM_OPTIONS.hfovDeg, 30, 110),
    eyeHeight: clamp(Number(next.eyeHeight) || DEFAULT_ROOM_OPTIONS.eyeHeight, 0.8, 2.4),
    hangingHeight: clamp(Number(next.hangingHeight) || DEFAULT_ROOM_OPTIONS.hangingHeight, 0.8, 2.6),
    slotPitch: clamp(Number(next.slotPitch) || DEFAULT_ROOM_OPTIONS.slotPitch, 0.6, 4),
    maxTextureEdge: clamp(Number(next.maxTextureEdge) || DEFAULT_ROOM_OPTIONS.maxTextureEdge, 256, 2048),
    analysisWidth: clamp(Number(next.analysisWidth) || DEFAULT_ROOM_OPTIONS.analysisWidth, 240, 1600)
  };
}

export function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('实景图读取失败，请换一张 JPG / PNG 再试。'));
    image.src = source;
  });
}

// ---------------------------------------------------------------- 后墙矩形检测

/**
 * 竖直/水平边能量剖面。
 * 三点针对性的设计：
 *  - 竖直边只在画面中带统计（后墙左右棱就在这个带里），把地板木纹缝、天花板轨道灯
 *    这类"局部很亮但很短的线"排除掉；
 *  - 用一条以画面中心为峰的钟形权重，让靠近中心的后墙棱优先于画面外侧的踢脚线；
 *  - **阶跃一致性**（关键）：一条墙棱是「阶跃」——整段梯度同号；而壁灯的光晕、
 *    亮面墙上的暗条、地板木纹缝是「条纹」——左右两侧梯度符号相反、互相抵消。
 *    用 |Σg| / Σ|g| 做权重，光晕这类对称特征会被压到接近 0，
 *    否则一排筒灯的光晕弧线会比天花板棱还"亮"，直接把房间尺寸算错。
 */
function edgeProfiles(gray, w, h) {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      gx[i] = gray[i + 1] - gray[i - 1];
      gy[i] = gray[i + w] - gray[i - w];
    }
  }

  const colScore = new Float32Array(w);
  const rowScore = new Float32Array(h);
  const cx = w / 2, cy = h / 2;

  const yLo = Math.round(h * 0.16), yHi = Math.round(h * 0.70);   // 竖直边的统计带
  const xLo = Math.round(w * 0.22), xHi = Math.round(w * 0.78);   // 水平边的统计带
  const nCol = Math.max(1, yHi - yLo), nRow = Math.max(1, xHi - xLo);

  for (let x = 2; x < w - 2; x += 1) {
    let sum = 0, abs = 0;
    for (let y = yLo; y < yHi; y += 1) { const v = gx[y * w + x]; sum += v; abs += Math.abs(v); }
    const coherence = abs > 1e-6 ? Math.abs(sum) / abs : 0;
    const bell = Math.exp(-(((x - cx) / (w * 0.40)) ** 2));
    // 除以统计带长度后，量纲就是「这条棱的阶跃高度（灰度/像素）」，便于直接判断强弱
    colScore[x] = (abs / nCol) * coherence * coherence * bell;
  }
  for (let y = 2; y < h - 2; y += 1) {
    let sum = 0, abs = 0;
    for (let x = xLo; x < xHi; x += 1) { const v = gy[y * w + x]; sum += v; abs += Math.abs(v); }
    const coherence = abs > 1e-6 ? Math.abs(sum) / abs : 0;
    const bell = Math.exp(-(((y - cy) / (h * 0.30)) ** 2));
    rowScore[y] = (abs / nRow) * coherence * coherence * bell;
  }
  return { colScore, rowScore };
}

/**
 * 在 [from,to) 里找分数最高的下标，并给出「峰值 / 最强的远处竞争者」的信噪比。
 * 近邻（±4% 区间宽）不算竞争者：真实的棱在相邻几列都有能量，那是同一条边。
 */
function bestInRange(score, from, to) {
  const lo = Math.max(0, Math.round(from));
  const hi = Math.min(score.length, Math.round(to));
  if (hi - lo < 3) return null;
  let bestIndex = -1, bestValue = 0;
  for (let i = lo; i < hi; i += 1) if (score[i] > bestValue) { bestValue = score[i]; bestIndex = i; }
  const win = Math.max(3, Math.round((hi - lo) * 0.04));
  let rival = 0;
  for (let i = lo; i < hi; i += 1) {
    if (Math.abs(i - bestIndex) <= win) continue;
    if (score[i] > rival) rival = score[i];
  }
  return { index: bestIndex, value: bestValue, ratio: bestValue / Math.max(0.05, rival) };
}

/**
 * 检测后墙矩形。返回归一化 0..1 的框，以及这次识别是否可信。
 * 识别不可信时交由上层决定：要么用兜底框，要么让管理员手动拖线。
 */
export function detectBackWall(gray, w, h) {
  const { colScore, rowScore } = edgeProfiles(gray, w, h);
  const marginX = w * 0.03, marginY = h * 0.03;

  const left = bestInRange(colScore, marginX, w * 0.47);
  const right = bestInRange(colScore, w * 0.53, w - marginX);
  const top = bestInRange(rowScore, marginY, h * 0.46);
  const bottom = bestInRange(rowScore, h * 0.54, h - marginY);

  const note = {
    verticals: [left, right].filter(Boolean).map(v => ({ at: +(v.index / w).toFixed(4), strength: Math.round(v.value), snr: +v.ratio.toFixed(2) })),
    horizontals: [top, bottom].filter(Boolean).map(v => ({ at: +(v.index / h).toFixed(4), strength: Math.round(v.value), snr: +v.ratio.toFixed(2) }))
  };

  if (!left || !right || !top || !bottom) return { ok: false, note, fallback: { x0: 0.34, y0: 0.32, x1: 0.66, y1: 0.64 }, confidence: 0 };

  const rect = { x0: left.index / w, y0: top.index / h, x1: right.index / w, y1: bottom.index / h };
  const widthRatio = rect.x1 - rect.x0, heightRatio = rect.y1 - rect.y0;
  const areaRatio = widthRatio * heightRatio;

  // 后墙必须是一个「居中、不太小也不太大」的矩形，否则说明检测跑偏了。
  const centered = Math.abs((rect.x0 + rect.x1) / 2 - 0.5) < 0.18 && Math.abs((rect.y0 + rect.y1) / 2 - 0.5) < 0.18;
  const plausible = widthRatio > 0.10 && widthRatio < 0.72 && heightRatio > 0.08 && heightRatio < 0.62 && areaRatio > 0.012;
  // 可信度三件套：几何合理 + 四条棱相对远处竞争者够突出（信噪比）+ 阶跃高度够强
  const snr = Math.min(left.ratio, right.ratio, top.ratio, bottom.ratio);
  const weakest = Math.min(left.value, right.value, top.value, bottom.value);
  const confidence = clamp(
    (plausible ? 0.45 : 0) + clamp((weakest - 4) / 16, 0, 0.35) + clamp((snr - 1.5) / 3, 0, 0.20),
    0, 1
  );

  if (!centered || !plausible) return { ok: false, note, rect, confidence: confidence * 0.4, fallback: { x0: 0.34, y0: 0.32, x1: 0.66, y1: 0.64 } };
  return { ok: true, note, rect, confidence: clamp(confidence, 0.2, 1) };
}

// ---------------------------------------------------------------- 单应变换与透视矫正

/** 解 8×8 线性方程组，返回把 from[4] 映射到 to[4] 的单应矩阵（行主序 3×3）。 */
function solveHomography(from, to) {
  const A = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // 高斯消元（带部分选主元）
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    if (Math.abs(A[pivot][col]) < 1e-9) return null;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    const p = A[col][col];
    for (let k = col; k < 9; k += 1) A[col][k] /= p;
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue;
      const factor = A[row][col];
      if (!factor) continue;
      for (let k = col; k < 9; k += 1) A[row][k] -= factor * A[col][k];
    }
  }
  return new Float64Array([A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1]);
}

const bilinear = (data, w, h, x, y, out) => {
  const cx = clamp(x, 0, w - 1.001), cy = clamp(y, 0, h - 1.001);
  const x0 = cx | 0, y0 = cy | 0;
  const fx = cx - x0, fy = cy - y0;
  const i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
  for (let c = 0; c < 3; c += 1) {
    const a = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * fx;
    const b = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * fx;
    out[c] = a + (b - a) * fy;
  }
};

/**
 * 把源图里的一个四边形透视矫正成正视矩形。
 * @param {ImageData} sourceData 整张原图的像素
 * @param {Array<[number,number]>} srcQuad 源四边形，顺序：左上/右上/右下/左下（图像坐标）
 * @param {number} outW 输出宽
 * @param {number} outH 输出高
 */
export function rectifyQuad(sourceData, srcQuad, outW, outH) {
  const w = sourceData.width, h = sourceData.height;
  const dstQuad = [[0, 0], [outW, 0], [outW, outH], [0, outH]];
  const H = solveHomography(dstQuad, srcQuad);
  if (!H) return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(outW));
  canvas.height = Math.max(2, Math.round(outH));
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const out = ctx.createImageData(canvas.width, canvas.height);
  const src = sourceData.data, dst = out.data;
  const rgb = [0, 0, 0];
  let p = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const denom = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / denom;
      const sy = (H[3] * x + H[4] * y + H[5]) / denom;
      bilinear(src, w, h, sx, sy, rgb);
      dst[p] = rgb[0]; dst[p + 1] = rgb[1]; dst[p + 2] = rgb[2]; dst[p + 3] = 255;
      p += 4;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

const canvasToUrl = (canvas, quality = 0.92) => canvas.toDataURL('image/jpeg', quality);

// ---------------------------------------------------------------- 主流程

export async function reconstructGalleryRoom({ source, options = {}, overrideRect = null }) {
  const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const opts = normalizeRoomOptions(options);
  const image = await loadImageElement(source);
  const photoW = image.naturalWidth || image.width;
  const photoH = image.naturalHeight || image.height;

  // 高清整图，用于裁材质；分析图另存小尺寸，用于跑边检测。
  const full = document.createElement('canvas');
  full.width = photoW; full.height = photoH;
  const fullCtx = full.getContext('2d', { willReadFrequently: true });
  fullCtx.drawImage(image, 0, 0, photoW, photoH);
  const fullData = fullCtx.getImageData(0, 0, photoW, photoH);

  const aw = Math.min(opts.analysisWidth, photoW);
  const ah = Math.max(1, Math.round((photoH * aw) / photoW));
  const small = document.createElement('canvas');
  small.width = aw; small.height = ah;
  const smallCtx = small.getContext('2d', { willReadFrequently: true });
  smallCtx.drawImage(image, 0, 0, aw, ah);
  const smallData = smallCtx.getImageData(0, 0, aw, ah);

  const gray = new Float32Array(aw * ah);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = (smallData.data[p] * 0.299 + smallData.data[p + 1] * 0.587 + smallData.data[p + 2] * 0.114);
  }

  const detected = detectBackWall(gray, aw, ah);
  const rect = overrideRect || (detected.ok ? detected.rect : detected.fallback);
  const wallSource = overrideRect ? 'manual' : detected.ok ? 'detected' : 'fallback';
  const confidence = overrideRect ? 1 : (detected.confidence || 0);

  // ---- 针孔模型：先算出画布坐标系下的主点与焦距（按分析图比例换算到原图）
  const scale = photoW / aw;
  const px = (photoW - 1) / 2;
  const py = (photoH - 1) / 2;
  const fPx = (photoW / 2) / Math.tan((opts.hfovDeg * Math.PI / 180) / 2);

  const x0 = rect.x0 * photoW, x1 = rect.x1 * photoW;
  const y0 = rect.y0 * photoH, y1 = rect.y1 * photoH;

  // 相机到后墙的距离由「地板线」直接推出（y1 必须落在主点下方，否则这张照片没拍到地板）
  if (!(y1 > py + 4)) {
    throw new Error('这张实景图看不到清晰的地板交界线，无法反推房间尺寸。请换一张正对展厅、能看到地板与天花板交界的照片。');
  }
  const camY = opts.eyeHeight;
  const dFar = (fPx * camY) / (y1 - py);
  const ceilingH = camY + ((py - y0) * dFar) / fPx;
  const xLWorld = ((x0 - px) * dFar) / fPx;
  const xRWorld = ((x1 - px) * dFar) / fPx;

  // 近端边界：取「天花板线与地板线都还在画面内」的最小景深，保证所有面都能完整矫正。
  const depthForCeilingInside = (py > 2) ? (fPx * (ceilingH - camY)) / (py - 2) : dFar;
  const depthForFloorInside = (photoH - 2 > py) ? (fPx * camY) / (photoH - 2 - py) : dFar;
  const depthForWallSide = (() => {
    const worst = Math.max(Math.abs(xLWorld), Math.abs(xRWorld));
    const halfPx = Math.min(px, photoW - 1 - px);
    return (fPx * worst) / halfPx;
  })();
  const dNear = clamp(Math.max(depthForCeilingInside, depthForFloorInside, depthForWallSide), dFar * 0.18, dFar * 0.94);
  const roomDepth = Math.max(1.2, dFar - dNear);

  // 世界坐标：相机在 (0, camY, 0)，朝 −Z 看；后墙在 z = −dFar，近端在 z = −dNear。
  const zFar = -dFar, zNear = -dNear;
  const project = (X, Y, Z) => {
    const d = -Z;
    return [px + (fPx * X) / d, py - (fPx * (Y - camY)) / d];
  };

  // ---- 逐面矫正材质
  const maxEdge = opts.maxTextureEdge;
  const fitOut = (worldW, worldH) => {
    const ratio = worldW / Math.max(0.001, worldH);
    return ratio >= 1
      ? [Math.min(maxEdge, Math.round(worldW * 60)), Math.max(64, Math.round(Math.min(maxEdge, Math.round(worldW * 60)) / ratio))]
      : [Math.max(64, Math.round(Math.min(maxEdge, Math.round(worldH * 60)) * ratio)), Math.min(maxEdge, Math.round(worldH * 60))];
  };

  const rectified = {};
  const wallHeight = ceilingH;
  const roomWidth = xRWorld - xLWorld;

  // 后墙：正视面，四角就是后墙矩形
  const [bw, bh] = fitOut(roomWidth, wallHeight);
  const backCanvas = rectifyQuad(fullData,
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], bw, bh);
  rectified.backWall = backCanvas;

  // 左墙 / 右墙：世界矩形是 (x=常值, y∈[0,H], z∈[zNear,zFar])，投影后是梯形
  const sideQuad = (xWall) => [
    project(xWall, ceilingH, zNear), project(xWall, ceilingH, zFar),
    project(xWall, 0, zFar), project(xWall, 0, zNear)
  ];
  const [sw, sh] = fitOut(roomDepth, wallHeight);
  rectified.leftWall = rectifyQuad(fullData, sideQuad(xLWorld), sw, sh);
  rectified.rightWall = rectifyQuad(fullData, sideQuad(xRWorld), sw, sh);

  // 地板 / 天花板：世界矩形 (x∈[xL,xR], z∈[zNear,zFar])
  const planeQuad = (yPlane) => [
    project(xLWorld, yPlane, zNear), project(xRWorld, yPlane, zNear),
    project(xRWorld, yPlane, zFar), project(xLWorld, yPlane, zFar)
  ];
  const [fw, fh] = fitOut(roomWidth, roomDepth);
  rectified.floor = rectifyQuad(fullData, planeQuad(0), fw, fh);
  rectified.ceiling = rectifyQuad(fullData, planeQuad(ceilingH), fw, fh);

  const textures = {};
  for (const key of Object.keys(rectified)) {
    const canvas = rectified[key];
    if (!canvas) continue;
    textures[key] = { url: canvasToUrl(canvas), width: canvas.width, height: canvas.height };
  }

  // ---- 灯位：从照片天花板区域找亮斑，反投影回天花板上
  const lights = detectCeilingLights({
    imageData: smallData, aw, ah, photoW, photoH,
    ceilingLineRatio: y0 / photoH, px, py, fPx, camY, ceilingH
  });

  // ---- 墙面槽位：按各面真实长度均分
  const slots = buildWallSlots({
    xLWorld, xRWorld, ceilingH, zNear, zFar,
    hangingHeight: clamp(opts.hangingHeight, 0.9, Math.max(1, ceilingH - 0.6)),
    pitch: opts.slotPitch
  });
  // 挂高要按"实际用上的值"回报，否则超过了展厅净高的 h 会被悄悄夹住、而相机还按原值取景。
  const hangingHeight = clamp(opts.hangingHeight, 0.9, Math.max(1, ceilingH - 0.6));

  const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;

  return {
    version: ROOM_RECONSTRUCT_VERSION,
    source,
    options: opts,
    photo: { width: photoW, height: photoH },
    analysis: { width: aw, height: ah, scale },
    camera: {
      fPx, hfovDeg: opts.hfovDeg, eyeHeight: camY,
      principal: [px, py],
      position: [(xLWorld + xRWorld) / 2, camY, clamp(zNear + roomDepth * 0.12, zNear + 0.8, zNear + 3)],
      lookAt: [(xLWorld + xRWorld) / 2, camY, zFar]
    },
    room: {
      xL: xLWorld, xR: xRWorld,
      width: roomWidth, height: ceilingH, depth: roomDepth,
      zNear, zFar, dNear, dFar,
      backWallCenterX: (xLWorld + xRWorld) / 2,
      // 相机眼高与实际挂高放进几何对象里，让 room 是自描述的 ——
      // three.js 场景只吃这个对象，不用再去别处找参数。
      eyeHeight: camY, hangingHeight
    },
    detected: { rect, source: wallSource, confidence, note: detected.note },
    textures,
    lights,
    slots,
    stats: { ms: Math.round(elapsed), surfaceCount: Object.keys(textures).length, slotCount: slots.length }
  };
}

/** 天花板亮斑 → 灯位。反投影：给定天花面上的图像点，先求景深再求世界坐标。 */
function detectCeilingLights({ imageData, aw, ah, photoW, photoH, ceilingLineRatio, px, py, fPx, camY, ceilingH }) {
  const sx = photoW / aw, sy = photoH / ah;
  const data = imageData.data;
  const yStart = Math.max(1, Math.round(ceilingLineRatio * ah * 0.02));
  const yEnd = Math.max(yStart + 2, Math.round(ceilingLineRatio * ah - 1));
  const xStart = Math.round(aw * 0.16), xEnd = Math.round(aw * 0.84);
  if (yEnd - yStart < 4) return [{ position: [0, ceilingH - 0.02, 0], intensity: 1.1, radius: 3.2, source: 'default' }];

  const luma = (x, y) => {
    const p = (y * aw + x) * 4;
    return data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
  };
  let sum = 0, count = 0, max = 0;
  for (let y = yStart; y < yEnd; y += 1) for (let x = xStart; x < xEnd; x += 1) {
    const v = luma(x, y); sum += v; count += 1; if (v > max) max = v;
  }
  const mean = sum / Math.max(1, count);
  // 阈值必须自适应「这张照片的天花板有多亮」：
  // 早期写法是 threshold = max(mean + span·0.45, mean·1.12)。在明亮的白顶天花板上
  // mean 已经 240，mean·1.12 = 269 超过 255 上限，于是没有任何像素能过阈值、
  // 亮斑数为 0，还会静默退化成默认灯位。现在：只要天花板自身有足够起伏，
  // 阈值就压在「最高亮 - 一点余量」以下，保证一定能取到亮斑中心。
  const span = max - mean;
  if (span < 4) {
    return [{ position: [0, ceilingH - 0.05, 0], intensity: 1.6, radius: 3.4, source: 'default' }];
  }
  const threshold = Math.min(mean + span * 0.5, max - 3);

  // 亮斑连通域（4 邻域，步长 1），取质心
  const visited = new Uint8Array(aw * ah);
  const blob = [];
  const stack = [];
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const key = y * aw + x;
      if (visited[key] || luma(x, y) < threshold) continue;
      stack.length = 0; stack.push([x, y]); visited[key] = 1;
      let cx = 0, cy = 0, n = 0, peak = 0;
      while (stack.length) {
        const [ax0, ay0] = stack.pop();
        cx += ax0; cy += ay0; n += 1;
        const l = luma(ax0, ay0); if (l > peak) peak = l;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = ax0 + dx, ny = ay0 + dy;
          if (nx < xStart || nx >= xEnd || ny < yStart || ny >= yEnd) continue;
          const nk = ny * aw + nx;
          if (visited[nk] || luma(nx, ny) < threshold) continue;
          visited[nk] = 1; stack.push([nx, ny]);
        }
      }
      if (n >= 4) blob.push({ x: cx / n, y: cy / n, weight: peak - mean, size: n });
    }
  }
  // 只保留最亮的几处（真实拍到的筒灯/灯带），按亮度降序取前 6 个
  blob.sort((a, b) => b.weight * Math.sqrt(b.size) - a.weight * Math.sqrt(a.size));
  const picked = blob.slice(0, 6);

  const lights = picked.map((b) => {
    const ix = b.x * sx, iy = b.y * sy;
    // 天花面上的点：imgY = py − f·(H − camY)/d → d = f·(H − camY)/(py − iy)
    const denom = py - iy;
    if (denom <= 2) return null;
    const d = (fPx * (ceilingH - camY)) / denom;
    const X = ((ix - px) * d) / fPx;
    return {
      position: [X, ceilingH - 0.05, -d],
      intensity: clamp(1.5 + b.weight / 34, 1.5, 5.2),
      radius: clamp(2.0 + Math.sqrt(b.size) / 22, 2.0, 5.5),
      weight: b.weight * Math.sqrt(b.size),
      source: 'photo'
    };
  }).filter(Boolean);

  // 一个筒灯的光晕常被它自身的暗环切成「内盘 + 外环」两块连通域，会被算成两盏灯。
  // 按世界距离做一次归并，避免天花板上一盏灯叠出两个重叠光斑。
  const merged = [];
  for (const light of lights) {
    const near = merged.find((m) => {
      const dx = m.position[0] - light.position[0], dz = m.position[2] - light.position[2];
      return Math.hypot(dx, dz) < 0.6;
    });
    if (!near) { merged.push(light); continue; }
    const wSum = near.weight + light.weight;
    near.position = [
      (near.position[0] * near.weight + light.position[0] * light.weight) / wSum,
      near.position[1],
      (near.position[2] * near.weight + light.position[2] * light.weight) / wSum
    ];
    near.intensity = Math.max(near.intensity, light.intensity);
    near.radius = clamp(near.radius * 0.7 + light.radius * 0.7, 2.0, 6.0);
    near.weight = wSum;
  }
  const out = merged.map(({ weight, ...rest }) => rest);

  if (!out.length) out.push({ position: [0, ceilingH - 0.05, 0], intensity: 1.6, radius: 3.4, source: 'default' });
  return out;
}

/** 三个立面各自按真实长度均分槽位，返回世界坐标 + 朝向。 */
function buildWallSlots({ xLWorld, xRWorld, ceilingH, zNear, zFar, hangingHeight, pitch }) {
  const slots = [];
  const roomWidth = xRWorld - xLWorld;
  const roomDepth = Math.abs(zFar - zNear);
  // 画框最大高度：留出踢脚线与顶部的呼吸空间，并封顶 1.7m
  //（否则 4m 多高的展厅会算出一米八的巨型画框，完全不像孩子的作品展）
  const maxH = clamp(ceilingH - hangingHeight - 0.45, 0.5, 1.7);

  const distribute = (length, wall, axis) => {
    const usable = Math.max(0.6, length - Math.min(1.4, length * 0.14));
    const count = Math.max(1, Math.min(8, Math.floor(usable / pitch) || 1));
    const step = usable / count;
    const start = -usable / 2 + step / 2;
    for (let i = 0; i < count; i += 1) {
      const offset = start + step * i;
      const maxW = Math.min(step * 0.72, 1.6);
      if (axis === 'x') {
        slots.push({
          id: `${wall}-${i + 1}`, wall, index: i,
          position: [xLWorld + roomWidth / 2 + offset, hangingHeight, zFar + 0.03],
          rotationY: 0, normal: [0, 0, 1],
          maxWidth: maxW, maxHeight: Math.min(maxH, maxW / 0.78)
        });
      } else {
        const x = wall === 'left' ? xLWorld + 0.03 : xRWorld - 0.03;
        slots.push({
          id: `${wall}-${i + 1}`, wall, index: i,
          position: [x, hangingHeight, zNear - roomDepth / 2 + offset],
          rotationY: wall === 'left' ? Math.PI / 2 : -Math.PI / 2,
          normal: [wall === 'left' ? 1 : -1, 0, 0],
          maxWidth: maxW, maxHeight: Math.min(maxH, maxW / 0.78)
        });
      }
    }
  };
  distribute(roomWidth, 'back', 'x');
  distribute(roomDepth, 'left', 'z');
  distribute(roomDepth, 'right', 'z');
  return slots;
}

/** 把一个宽高比塞进槽位，返回实际绘制尺寸（米）。 */
export function fitArtworkToSlot(aspect, slot) {
  const maxW = slot?.maxWidth || 1.8;
  const maxH = slot?.maxHeight || 1.4;
  let width = maxW;
  let height = width / Math.max(0.2, aspect);
  if (height > maxH) { height = maxH; width = height * aspect; }
  return { width, height };
}
