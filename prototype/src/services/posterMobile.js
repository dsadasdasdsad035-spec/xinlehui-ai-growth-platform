// 海报移动端与导出性能的**执行层**（[海报 US-314] / FR-364、FR-365）。
//
// `data/posterMobile.js` 只放规则（预算 / 档位 / 结论，纯函数、可 Node 断言）；这里做规则之外
// 必须有浏览器能力的两件事：
//   ① `yieldToInteraction()` —— 导出的每个阶段之间**让出主线程**（一帧 + 一个宏任务），
//      于是「点导出 → 渲染 → 编码 → 存下」不会连成一次长任务把界面霸住（FR-365 的「不阻塞交互」）；
//   ② `createBlockingProbe()` —— 量这一次导出的**最长阻塞**：优先读 `longtask` 性能条目
//      （浏览器自己量的长任务），读不到就退回「定时器间隔被拖长了多少」（≥ 阈值才算一次阻塞）。
//
// 内存那一支**不在这里重写**：复用装裱的 `createMemorySampler()`（`services/framingPerformance.js`）
// —— 全仓只有一份 `performance.memory` 采样实现，装裱的「内存峰值 ≤300MB」与海报的 FR-364 读同一份数据。
//
// 与装裱性能同一套约定：任何一步失败都**不抛错**（探针失败就让读数为空，界面写「待测」）。

import { createMemorySampler, measureHeapBytes } from './framingPerformance';
import { POSTER_EXPORT_BLOCK_BUDGET_MS } from '../data/posterMobile';

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

/**
 * 让出主线程：优先等一帧（浏览器有机会绘制与处理输入），**但最多等 `maxWaitMs`**。
 *
 * 为什么要带上限（[海报 US-314] 真踩）：后台标签 / 隐藏页面（`document.hidden === true` —— 真机上
 * 「导出时老师切去微信看一眼再回来」就是这一档）**不会触发 `requestAnimationFrame`**。只等 rAF 的话
 * 这个 Promise 永远不 resolve，导出会卡死在 busy 上（本轮 390px 的用例撞上了：页面转后台后 rAF 停发，
 * 导出一直不结束）。上限保证每一步都能往前走：有 rAF 就等一帧，没有（或后台）就等一次定时器收尾。
 */
export function yieldToInteraction({ maxWaitMs = 200 } = {}) {
  const limit = Number(maxWaitMs) > 0 ? Number(maxWaitMs) : 200;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const canSetTimeout = typeof setTimeout === 'function';
    if (canSetTimeout) setTimeout(finish, limit);
    if (typeof requestAnimationFrame === 'function') {
      try {
        requestAnimationFrame(() => { if (canSetTimeout) setTimeout(finish, 0); else finish(); });
        return;
      } catch { /* rAF 抛错就退回定时器那一支 */ }
    }
    if (!canSetTimeout) finish();
  });
}

/** 浏览器认不认 `longtask` 条目（读 `PerformanceObserver.supportedEntryTypes`，读不到就当不认）。 */
export function canObserveLongTasks() {
  try {
    const types = typeof PerformanceObserver !== 'undefined' ? PerformanceObserver.supportedEntryTypes : null;
    return Array.isArray(types) && types.includes('longtask');
  } catch {
    return false;
  }
}

/**
 * 阻塞探针：`start()` 起记账，`stop()` 给出这一段里**最长的一次阻塞**（毫秒）。
 *
 * 两路取最大：
 *   - `longtask` 条目（浏览器量的、≥50ms 的主线程任务）——有就用它的 `duration`；
 *   - 定时器间隔：`intervalMs` 采一次时间戳，两次之间的间隔减去基准间隔就是被拖住的时长
 *     （长任务执行期间定时器回调排在后面，所以间隔会被拉长）。
 *
 * 返回 `{ maxBlockMs, longTaskMs, gapMs, longTasks, source, supported, blocked }`：
 * `supported: false` = 两路都没量到（界面写「待测」，不写 0）。
 */
export function createBlockingProbe({ intervalMs = 100, longTaskThresholdMs = 50 } = {}) {
  const step = Number(intervalMs) > 0 ? Math.max(20, Number(intervalMs)) : 100;
  const threshold = Number(longTaskThresholdMs) > 0 ? Number(longTaskThresholdMs) : 50;
  let active = false;
  let timer = 0;
  let observer = null;
  let last = 0;
  let gapMs = 0;
  let longTaskMs = 0;
  let longTasks = [];
  let samples = 0;
  const observeLongTasks = () => {
    if (!canObserveLongTasks()) return false;
    try {
      observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          const duration = Math.max(0, Number(entry && entry.duration) || 0);
          if (duration < threshold) return;
          longTaskMs = Math.max(longTaskMs, duration);
          longTasks.push({ duration: Math.round(duration), startTime: Math.round(Number(entry.startTime) || 0), name: String(entry.name || 'self') });
        });
      });
      observer.observe({ entryTypes: ['longtask'] });
      return true;
    } catch {
      observer = null;
      return false;
    }
  };
  const tick = () => {
    const stamp = nowMs();
    samples += 1;
    // 两次采样之间被拖住的时长：间隔 - 基准间隔（小于 0 说明没被拖住）。
    const gap = Math.max(0, stamp - last - step);
    gapMs = Math.max(gapMs, gap);
    last = stamp;
  };
  const stats = () => {
    const maxBlockMs = Math.round(Math.max(gapMs, longTaskMs));
    return {
      intervalMs: step,
      longTaskThresholdMs: threshold,
      samples,
      gapMs: Math.round(gapMs),
      longTaskMs: Math.round(longTaskMs),
      longTasks: longTasks.slice(),
      maxBlockMs,
      usedLongTasks: longTasks.length > 0,
      // 两路都没量到（没起过 / 没有计时器）→ `supported:false`，界面如实写「待测」。
      supported: samples > 0 || longTasks.length > 0,
      budgetMs: POSTER_EXPORT_BLOCK_BUDGET_MS,
      ok: (samples > 0 || longTasks.length > 0) ? maxBlockMs <= POSTER_EXPORT_BLOCK_BUDGET_MS : null
    };
  };
  return {
    get active() { return active; },
    start() {
      if (active) return false;
      if (typeof setInterval !== 'function') return false;
      active = true;
      gapMs = 0;
      longTaskMs = 0;
      longTasks = [];
      samples = 0;
      last = nowMs();
      observeLongTasks();
      timer = setInterval(tick, step);
      return true;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = 0;
      if (observer) { try { observer.disconnect(); } catch { /* 忽略 */ } observer = null; }
      // 停之前补一次采样：最后一次间隔里被拖住的那一段也算数。
      if (active) tick();
      active = false;
      return stats();
    },
    stats
  };
}

/**
 * 一次导出的性能探针：内存（复用装裱采样器）+ 阻塞（上面这一支）两路一起记账。
 * 用法：`const probe = createPosterPerfProbe(); probe.start(); …; const perf = probe.stop();`
 * `perf = { memoryBytes, memorySupported, memorySamples, blockMs, blockSupported, longTasks, ok }`。
 */
export function createPosterPerfProbe({ intervalMs = 100, memoryIntervalMs = 250 } = {}) {
  const memory = createMemorySampler({ intervalMs: memoryIntervalMs });
  const blocking = createBlockingProbe({ intervalMs });
  const reading = () => {
    const memoryStats = memory.stats();
    const blockStats = blocking.stats();
    return {
      memoryBytes: memoryStats.bytes,
      memorySupported: Boolean(memoryStats.supported),
      memorySamples: memoryStats.samples,
      blockMs: blockStats.supported ? blockStats.maxBlockMs : 0,
      blockSupported: blockStats.supported,
      blockGapMs: blockStats.gapMs,
      longTaskMs: blockStats.longTaskMs,
      longTasks: blockStats.longTasks,
      budgetMs: blockStats.budgetMs,
      ok: blockStats.ok
    };
  };
  return {
    memory,
    blocking,
    get active() { return memory.active || blocking.active; },
    start() {
      const memoryStarted = memory.start();
      const blockingStarted = blocking.start();
      // 采一帧现成的（内存起步值）：`performance.memory` 本来就有当前值，不必等第一次定时器。
      memory.sampleNow();
      return { memoryStarted, blockingStarted };
    },
    stop() {
      blocking.stop();
      memory.stop();
      return reading();
    },
    stats: reading
  };
}

export { measureHeapBytes };
