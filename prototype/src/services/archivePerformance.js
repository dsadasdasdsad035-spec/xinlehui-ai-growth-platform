/**
 * 成长档案的浏览器侧实现（[第四步 US-212]「档案移动端与性能」）。
 *
 * `data/archivePerformance.js` 只负责「规则」（预算 / 窗口 / 结论，纯函数、可 Node 断言）；
 * 这里做规则之外必须有浏览器能力的部分：
 * 1. `createArchiveThumbnail()` / `archiveThumbnailQueue` —— 列表图的**缩略图**（长边 ≤320px），
 *    进入视口后按需生成、串行、空闲时段执行，同一地址只做一次（缓存）；
 * 2. `createArchiveScrollProbe()` —— 滚动期间按 rAF 采帧，算出真实帧率（≥30fps 的唯一测量入口）；
 * 3. `nowMs()` / `nextFrame()` —— 首屏计时用的时钟与「下一帧」等待（提交后那一帧 ≈ 浏览器绘制）。
 *
 * 与 `services/mediaIntake.js` / `services/framingPerformance.js` 同一套约定：任何一步失败都
 * **不抛错**，返回 `{ok:false}` 或直接回退原图，界面退回「没有读数」并照常可用；
 * object URL / data URL 都不写进任何持久化数据（缩略图只在内存里）。
 */
import { ARCHIVE_THUMB_MAX_EDGE, archiveThumbnailPlan } from '../data/archivePerformance.js';
import { createFrameSampler } from './framingPerformance.js';
import { scheduleMediaTask } from './mediaIntake.js';

const str = value => (value === null || value === undefined ? '' : String(value).trim());

function canUseDom() {
  return typeof document !== 'undefined' && typeof Image === 'function' && typeof document.createElement === 'function';
}

/** 当前时钟（毫秒）：首屏计时与滚动采样共用。 */
export function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

/** 提交后的下一帧（≈ 浏览器把这一帧画出来的时刻；没有 rAF 的环境退回 setTimeout 16ms）。 */
export function nextFrame() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') { requestAnimationFrame(() => resolve(nowMs())); return; }
    setTimeout(() => resolve(nowMs()), 16);
  });
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
 * 一组图片地址的缓存键（同一地址 + 同一上限 = 同一张缩略图；只做字符串比较，不解析内容）。
 */
export function archiveThumbnailKey(url, maxEdge = ARCHIVE_THUMB_MAX_EDGE) {
  return `${Math.trunc(Number(maxEdge) || ARCHIVE_THUMB_MAX_EDGE)}|${str(url)}`;
}

/**
 * 生成一张缩略图（长边 ≤ `maxEdge`）。
 *
 * 只对**同源可读**的地址做画布缩略图（`data:` / `blob:`）：
 * 跨域的 https 素材画进 canvas 会把画布标脏，`toDataURL` 直接抛错 —— 那种情况如实返回
 * `{ok:false}`，调用方退回「直接用原图 + 懒加载」，而不是假装有缩略图。
 * 本来就不超过上限的图**原样返回**（一个像素都不重编码）。
 */
export async function createArchiveThumbnail(url, { maxEdge = ARCHIVE_THUMB_MAX_EDGE, quality = 0.72 } = {}) {
  const source = str(url);
  const limit = Math.trunc(Number(maxEdge) || ARCHIVE_THUMB_MAX_EDGE);
  const failed = reason => ({ ok: false, url: '', width: 0, height: 0, maxEdge: limit, ms: 0, reason, plan: null });
  if (!source) return failed('没有可生成缩略图的地址。');
  if (/^https?:\/\//i.test(source)) return failed('外链素材不做画布缩略图（退回原图 + 懒加载）。');
  if (!canUseDom()) return failed('当前环境没有画布能力。');
  const started = nowMs();
  try {
    const image = await loadImageElement(source);
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    if (!width || !height) return failed('素材尺寸读取失败。');
    const plan = archiveThumbnailPlan(width, height, limit);
    if (!plan.needed) {
      // 原图本来就不大于上限：不重新编码（与 `prepareEditBase` 的「不传就完全不出现」同一条纪律）。
      return { ok: true, url: source, width, height, maxEdge: limit, ms: Math.max(0, nowMs() - started), reencoded: false, plan };
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, plan.width);
    canvas.height = Math.max(1, plan.height);
    const context = canvas.getContext('2d');
    if (!context) return failed('当前环境没有画布能力。');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    // 只做等比缩放，不裁切、不调色（与上传降采样、装裱渲染同一条纪律）。
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL('image/jpeg', quality);
    if (!encoded || !encoded.startsWith('data:')) return failed('缩略图编码失败。');
    return { ok: true, url: encoded, width: canvas.width, height: canvas.height, maxEdge: limit, ms: Math.max(0, nowMs() - started), reencoded: true, plan };
  } catch (error) {
    return failed(`缩略图生成失败：${str(error && error.message) || '未知原因'}`);
  }
}

/**
 * 缩略图队列（所有卡片共用一份）：**串行 + 空闲时段**执行，同一地址只生成一次。
 *
 * - `request(url, onDone)`：登记一次需求（重复登记同一地址只执行一次，结果发给所有等它的人）；
 * - `stats()`：`{done, failed, pending, lazy, total}` —— 面板读数与断言读它；
 * - 队列是**按需**的：没进视口的图不会被登记（`lazy` 由界面自己数），滚动经过才生成。
 */
export function createArchiveThumbnailQueue({ maxEdge = ARCHIVE_THUMB_MAX_EDGE, maxEntries = 96 } = {}) {
  const cache = new Map();
  const waiters = new Map();
  const queue = [];
  let busy = false;
  let done = 0;
  let failed = 0;
  const limit = Math.max(4, Math.trunc(Number(maxEntries) || 96));
  const remember = (key, value) => {
    cache.set(key, value);
    if (cache.size > limit) {
      // 简单的 LRU 兜底：最早写入的那一条先走（缩略图只是展示缓存，丢了会按需重算）。
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
  };
  const flush = key => {
    const list = waiters.get(key) || [];
    waiters.delete(key);
    const value = cache.get(key);
    list.forEach(callback => { try { callback(value); } catch { /* 回调失败不影响队列 */ } });
  };
  const run = async () => {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const key = queue.shift();
      const source = waiters.get(key)?.source || '';
      // eslint-disable-next-line no-await-in-loop -- 串行是有意的：一次只解码/编码一张，滚动不掉帧
      const result = await createArchiveThumbnail(source, { maxEdge });
      if (result.ok) done += 1; else failed += 1;
      remember(key, result);
      flush(key);
    }
    busy = false;
  };
  return {
    maxEdge,
    request(url, onDone) {
      const source = str(url);
      const key = archiveThumbnailKey(source, maxEdge);
      if (cache.has(key)) {
        const value = cache.get(key);
        if (typeof onDone === 'function') { try { onDone(value); } catch { /* 同上 */ } }
        return key;
      }
      const list = waiters.get(key);
      if (list) {
        if (typeof onDone === 'function') list.push(onDone);
        return key;
      }
      const holder = typeof onDone === 'function' ? [onDone] : [];
      holder.source = source;
      waiters.set(key, holder);
      queue.push(key);
      // 空闲时段执行（与录入页的缩略图同一条调度）：滚动中不抢主线程，滚动停下来的空隙里生成。
      scheduleMediaTask(() => { void run(); });
      return key;
    },
    /** 队列读数：`total` 是登记过的地址数（含命中缓存的），`lazy` 由界面按未登记的图另外报。 */
    stats() {
      return { done, failed, pending: waiters.size, total: cache.size, cached: cache.size };
    },
    get cacheSize() { return cache.size; },
    has(url) { return cache.has(archiveThumbnailKey(url, maxEdge)); }
  };
}

/** 档案页共用的那一份缩略图队列（所有卡片一个队列，串行生成）。 */
export const archiveThumbnailQueue = createArchiveThumbnailQueue();

/**
 * 滚动帧率探针：滚动期间按 rAF 采帧，滚动停下 `idleMs` 毫秒后收束并回调这一次的统计。
 * 与编辑拖动共用 `createFrameSampler`（帧率算法只有一份）。
 */
export function createArchiveScrollProbe({ onSample, idleMs = 400 } = {}) {
  const sampler = createFrameSampler();
  const wait = Math.max(60, Math.trunc(Number(idleMs) || 400));
  let idleTimer = 0;
  const clear = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; } };
  const settle = () => {
    clear();
    const stats = sampler.stop();
    if (stats && typeof onSample === 'function') { try { onSample(stats); } catch { /* 回调失败不影响采样 */ } }
  };
  return {
    get sampling() { return sampler.running; },
    /** 滚一下：第一次滚就把采样开起来，之后每滚一次把「停下」的计时推后。 */
    scroll() {
      sampler.start();
      clear();
      if (typeof setTimeout === 'function') idleTimer = setTimeout(settle, wait);
    },
    settle,
    cancel() { clear(); sampler.stop(); }
  };
}
