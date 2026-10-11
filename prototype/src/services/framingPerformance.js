/**
 * 装裱性能的浏览器侧实现（US-012「装裱移动端与合成性能」）。
 *
 * `data/framingPerformance.js` 只负责「规则」（预算 / 口径 / 结论，纯函数、可 Node 断言）；
 * 这里做规则之外必须有浏览器能力的部分：
 * 1. `prepareEditBase()` —— 手机原图**先降采样到长边 2400 再编辑**，并量出「解码 + 降采样 + 编码 + 底图可显示」的耗时；
 * 2. `createFrameSampler()` —— 编辑拖动期间按 rAF 采帧，算出真实帧率（拖动帧率不低于 30fps 的唯一测量入口）；
 * 3. `createMemorySampler()` / `measureHeapBytes()` —— 采样 `performance.memory.usedJSHeapSize` 的峰值（≤300MB）。
 *
 * 与 `services/mediaIntake.js` 同一套约定：任何一步失败都**不抛错**，返回 `{ok:false}` 或 0，
 * 界面退回「没有读数」而不是崩掉；object URL / data URL 都不写进任何持久化数据。
 */
import { EDIT_BASE_MAX_EDGE, editBasePlan } from '../data/framingPerformance';

function canUseDom() {
  return typeof document !== 'undefined' && typeof Image === 'function';
}

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image-decode-failed'));
    image.src = source;
  });
}

/**
 * 准备「编辑底图」：编辑期间用长边 ≤ `EDIT_BASE_MAX_EDGE`（2400）的那张图，
 * 而不是让 4000×3000 的手机原图反复参与解码与绘制（这正是「加载并显示 ≤ 2 秒」的落地方式）。
 *
 * - 原图长边本来就 ≤ 上限：**原样返回原图地址**（不重新编码），`downsampled: false`；
 * - 超过上限：等比画到 canvas 再编码成 JPEG 0.92（与 `renderArtworkRotation` 的预览口径一致），
 *   并**立刻再解码一次**底图（`loadMs`），量出「底图可显示」的时刻 —— 老师看到的第一帧就是这个时间点。
 *
 * @returns {Promise<{ok:boolean, url:string, downsampled:boolean, width:number, height:number,
 *   originalWidth:number, originalHeight:number, ms:number, loadMs:number, totalMs:number,
 *   maxEdge:number, plan:object, message:string}>}
 *   `ms` = 解码原图 + 降采样 + 编码；`loadMs` = 底图解码（可显示）；`totalMs` = 两者之和（= 验收里的「加载并显示」）。
 */
export async function prepareEditBase({ source, maxEdge = EDIT_BASE_MAX_EDGE, quality = 0.92 } = {}) {
  const limit = Number(maxEdge) > 0 ? Number(maxEdge) : EDIT_BASE_MAX_EDGE;
  const failed = {
    ok: false, url: '', downsampled: false, width: 0, height: 0, originalWidth: 0, originalHeight: 0,
    ms: 0, loadMs: 0, totalMs: 0, maxEdge: limit, plan: null, message: '没有可用的作品原图，无法准备编辑底图。'
  };
  if (!source) return failed;
  // Node / 无 DOM 环境（构建期的任何调用）不做降采样，调用方退回原图。
  if (!canUseDom()) return { ...failed, ok: true, url: source, message: '当前环境没有 canvas，编辑直接用原图。' };
  const started = nowMs();
  try {
    const image = await loadImageElement(source);
    const originalWidth = image.naturalWidth || image.width || 0;
    const originalHeight = image.naturalHeight || image.height || 0;
    const plan = editBasePlan(originalWidth, originalHeight, limit);
    if (!plan.needed) {
      // 已经在上限内：一个像素都不动（不重新编码），耗时就是这一次解码。
      const ms = Math.max(0, nowMs() - started);
      return {
        ok: true, url: source, downsampled: false,
        width: plan.width, height: plan.height, originalWidth, originalHeight,
        ms, loadMs: 0, totalMs: ms, maxEdge: limit, plan,
        message: `原图长边 ${plan.sourceLongEdge}px 未超过 ${limit}px，直接作为编辑底图（不重新编码）。`
      };
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, plan.width);
    canvas.height = Math.max(1, plan.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no-2d-context');
    // 只做等比缩放，不裁切、不调色（与上传降采样、装裱渲染同一条纪律）。
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', quality);
    const ms = Math.max(0, nowMs() - started);
    // 底图可显示的时刻：把刚编码出来的这张再解一次（浏览器随后渲染 <img> 时会命中同一份解码缓存）。
    const loadStarted = nowMs();
    let loadMs = 0;
    try {
      const decoded = await loadImageElement(url);
      if (typeof decoded.decode === 'function') { try { await decoded.decode(); } catch { /* decode 只是加速提示，失败不影响可显示 */ } }
      loadMs = Math.max(0, nowMs() - loadStarted);
    } catch {
      loadMs = 0;
    }
    return {
      ok: true, url, downsampled: true,
      width: canvas.width, height: canvas.height, originalWidth, originalHeight,
      ms, loadMs, totalMs: ms + loadMs, maxEdge: limit, plan,
      message: `原图 ${originalWidth}×${originalHeight} 已先降采样到长边 ${limit}px（${canvas.width}×${canvas.height}）再编辑。`
    };
  } catch {
    return { ...failed, url: source, message: '编辑底图准备失败，已退回原图直接编辑。' };
  }
}

/**
 * 由「rAF 时间戳序列」算帧率（纯函数，方便在页面里独立重算）。
 * `frames` 是间隔数（N 个时间戳 = N-1 帧）；`worstFps` 是最长那一帧的瞬时帧率。
 */
export function frameSampleStats(samples = []) {
  const points = Array.from(samples || []).filter(value => Number.isFinite(value));
  const frames = Math.max(0, points.length - 1);
  if (!frames) return { frames: 0, durationMs: 0, fps: 0, worstFrameMs: 0, worstFps: 0 };
  const deltas = [];
  for (let index = 1; index < points.length; index += 1) deltas.push(points[index] - points[index - 1]);
  const durationMs = points[points.length - 1] - points[0];
  const worstFrameMs = Math.max(...deltas);
  const fps = durationMs > 0 ? frames / (durationMs / 1000) : 0;
  return {
    frames,
    durationMs: Math.round(durationMs),
    fps: Number(fps.toFixed(1)),
    worstFrameMs: Number(worstFrameMs.toFixed(1)),
    worstFps: worstFrameMs > 0 ? Number((1000 / worstFrameMs).toFixed(1)) : 0
  };
}

/**
 * 拖动帧率采样器：`start()` 起按 rAF 记账，`stop()` 返回这一段的帧率统计（没在跑时返回 null）。
 * 一次拖动会话 = 一次 start/stop；`stop()` 是幂等的（裁剪拖拽与缩放手势的 pointerup 都会尝试收尾，
 * 第二次拿到 null 就不会重复记录）。没有 rAF 的环境（Node / 老浏览器）`start()` 返回 false，界面显示「还没量到」。
 */
export function createFrameSampler() {
  let rafId = 0;
  let running = false;
  let samples = [];
  const tick = () => {
    if (!running) return;
    samples.push(nowMs());
    rafId = requestAnimationFrame(tick);
  };
  return {
    get running() { return running; },
    start() {
      if (running) return false;
      if (typeof requestAnimationFrame !== 'function') return false;
      running = true;
      samples = [nowMs()];
      rafId = requestAnimationFrame(tick);
      return true;
    },
    stop() {
      if (!running) return null;
      running = false;
      if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      rafId = 0;
      const stats = frameSampleStats(samples);
      samples = [];
      return stats;
    }
  };
}

/** 当前 JS 堆用量（字节）。浏览器不支持 `performance.memory` 时返回 0（界面显示「未提供」而不是编一个数字）。 */
export function measureHeapBytes() {
  try {
    const memory = typeof performance !== 'undefined' ? performance.memory : null;
    const value = Number(memory?.usedJSHeapSize);
    return value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * 内存峰值采样器：按 `intervalMs` 采 `usedJSHeapSize` 并记住峰值。
 * `onPeak` 只在**确实抬高**峰值时回调一次 —— 主线程上每次 setState 都会重渲染第二步（几百个节点），
 * 所以界面读数不能跟着定时器刷新（与 US-413「录入用时不用定时器」同一条纪律）。
 */
export function createMemorySampler({ intervalMs = 500, onPeak } = {}) {
  const step = Number(intervalMs) > 0 ? Number(intervalMs) : 500;
  let timer = 0;
  let peak = 0;
  let active = false;
  let samples = 0;
  const sample = () => {
    const bytes = measureHeapBytes();
    samples += 1;
    if (bytes > peak) {
      const previous = peak;
      peak = bytes;
      if (typeof onPeak === 'function') {
        try { onPeak(peak, previous); } catch { /* 回调失败不影响采样 */ }
      }
    }
    return bytes;
  };
  return {
    get active() { return active; },
    get peakBytes() { return peak; },
    get sampleCount() { return samples; },
    sampleNow: sample,
    start() {
      if (active) return false;
      if (typeof setInterval !== 'function') return false;
      active = true;
      sample();
      timer = setInterval(sample, step);
      return true;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = 0;
      active = false;
    },
    /** 采样结论：给 `data/framingPerformance.js` 的 `evaluateMemoryPeak()` 用（这里只报原始值）。 */
    stats() {
      return { bytes: peak, supported: peak > 0, samples };
    }
  };
}
