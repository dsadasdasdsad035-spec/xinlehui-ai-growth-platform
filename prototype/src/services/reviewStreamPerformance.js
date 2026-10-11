/**
 * 点评流式渲染性能的浏览器侧实现（[第三步 US-113]「点评移动端与流式渲染性能」）。
 *
 * `data/reviewStreamPerformance.js` 只负责「规则」（预算 / 口径 / 结论，纯函数、可 Node 断言）；
 * 这里做规则之外必须有运行时能力的部分：
 * 1. `createReviewStreamBuffer()` —— 推理 / 正文增量**按不小于 100ms 批量 flush**：
 *    逐 chunk 进来的只是攒着（`pushReasoning` / `pushContent`），到点才把最新的整段文本回调给界面，
 *    所以一次生成里几十上百段增量只会触发个位数到十几次渲染（首字仍然是立刻渲染，不拖延）。
 * 2. `createMainThreadProbe()` —— 主线程长任务观测：优先 `PerformanceObserver('longtask')`，
 *    不支持时退化为定时器漂移采样（结论里的 `mode` 如实写明用的是哪一种）。
 * 3. `createResponseProbe()` —— 展开 / 折叠的响应计时（点一下 → 界面更新完毕）。
 * 4. `measureReasoningScroll()` —— 长推理展开后的滚动区读数（`scrollHeight > clientHeight`）。
 * 5. `createMemorySampler` 复用 `services/framingPerformance.js`（300MB 同一个上限，不另写一份采样器）。
 *
 * 与 `services/mediaIntake.js` / `services/framingPerformance.js` 同一套约定：任何一步失败都
 * **不抛错**，返回空读数，界面退回「还没有读数」而不是崩掉。
 */
import { REVIEW_LONG_TASK_BUDGET_MS, REVIEW_STREAM_FLUSH_MS, REVIEW_TOGGLE_BUDGET_MS } from '../data/reviewStreamPerformance';

export { createMemorySampler, measureHeapBytes } from './framingPerformance';

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

/**
 * 推理 / 正文增量的批量 flush 缓冲。
 *
 * 语义（与 `data/reviewStreamPerformance.js` 的 `reviewStreamFlushDelay()` 同一条口径）：
 * - `pushReasoning(full)` / `pushContent(full)`：只更新内部的最新整段文本并累加段数，
 *   **距上次 flush 已经够 `intervalMs`**（或这是第一次）就立刻渲染，否则登记一次性定时器，
 *   到「上次 flush + intervalMs」时补一次渲染 —— 因此相邻两次 flush 的间隔不小于 `intervalMs`。
 * - `flushNow(reason)`：收尾用（生成结束 / 失败 / 停止），把还没渲染的增量立刻补上，并撤销待发的定时器
 *   （否则会出现一次重复渲染）。
 * - `stop()`：撤销待发定时器（不补渲染）；之后不再有任何回调。
 * - `stats()`：`{ pushes, reasonPushes, contentPushes, flushTimes, intervalMs }` —— 原始计数，
 *   「够不够 100ms 一批、有没有逐 chunk 渲染」的结论由 data 层的 `reviewStreamFlushStats()` 给。
 *
 * `now` / `schedule` / `cancel` 可注入，Node 里能直接断言批量行为（不必等真实时钟）。
 */
export function createReviewStreamBuffer({ intervalMs = REVIEW_STREAM_FLUSH_MS, onFlush, now = nowMs, schedule, cancel } = {}) {
  const interval = Number(intervalMs) > 0 ? Number(intervalMs) : REVIEW_STREAM_FLUSH_MS;
  const timer = typeof schedule === 'function' ? schedule : (fn, delay) => setTimeout(fn, delay);
  const untimer = typeof cancel === 'function' ? cancel : (handle) => clearTimeout(handle);
  let reasoning = '';
  let content = '';
  let pushes = 0;
  let reasonPushes = 0;
  let contentPushes = 0;
  // `null` = 还没 flush 过（**不能用 0 当哨兵**：注入时钟 / 相对时间下第一次 flush 就发生在 0，
  // 那会让每一次 push 都被当成「距上次 flush 够久了」而立刻渲染 —— 逐 chunk 渲染的 bug 就回来了）。
  let lastFlushAt = null;
  let dirty = false;
  let pendingHandle = null;
  let stopped = false;
  const flushTimes = [];
  // 每次 flush 的原因（'push' / 'timer' = 周期性渲染；'settle' 等 = 流结束时的收尾补渲染）。
  // 判定「相邻渲染间隔 ≥100ms」只用周期性渲染 —— 收尾补渲染可能紧跟最后一次周期渲染（差几毫秒）。
  const flushReasons = [];

  const emit = (reason) => {
    if (pendingHandle !== null) {
      untimer(pendingHandle);
      pendingHandle = null;
    }
    const at = now();
    lastFlushAt = at;
    dirty = false;
    flushTimes.push(at);
    flushReasons.push(String(reason || 'push'));
    if (typeof onFlush === 'function') onFlush({ reasoning, content, reason, at, pushes });
  };

  // 到点但还没 flush：登记一次补渲染（多次 push 只会登记一次）。
  const scheduleFlush = () => {
    if (pendingHandle !== null || stopped) return;
    const at = now();
    // `Math.ceil`：定时器延迟的小数部分会被浏览器截断，用 floor 会出现「间隔 99.2ms」这种
    // 擦着边过去的读数；向上取整保证相邻两次渲染的间隔**从不小于** intervalMs。
    const wait = lastFlushAt === null ? 0 : Math.max(0, Math.ceil(interval - (at - lastFlushAt)));
    pendingHandle = timer(() => {
      pendingHandle = null;
      if (stopped || !dirty) return;
      emit('timer');
    }, wait);
  };

  const push = (full) => {
    if (stopped) return;
    pushes += 1;
    dirty = true;
    const at = now();
    if (lastFlushAt === null || at - lastFlushAt >= interval) emit('push');
    else scheduleFlush();
  };

  return {
    get intervalMs() { return interval; },
    get stopped() { return stopped; },
    pushReasoning(full) {
      reasoning = typeof full === 'string' ? full : String(full ?? '');
      reasonPushes += 1;
      push(full);
    },
    pushContent(full) {
      content = typeof full === 'string' ? full : String(full ?? '');
      contentPushes += 1;
      push(full);
    },
    /** 把还没渲染的增量立刻补上（收尾路径的唯一入口）；没有新增量时只撤销待发定时器，不多渲染一次。 */
    flushNow(reason = 'now') {
      if (stopped) return null;
      if (!dirty) {
        if (pendingHandle !== null) { untimer(pendingHandle); pendingHandle = null; }
        return null;
      }
      emit(reason);
      return { reasoning, content };
    },
    stop() {
      stopped = true;
      if (pendingHandle !== null) {
        untimer(pendingHandle);
        pendingHandle = null;
      }
    },
    stats() {
      return {
        pushes,
        reasonPushes,
        contentPushes,
        flushTimes: flushTimes.slice(),
        flushReasons: flushReasons.slice(),
        intervalMs: interval,
        // 还没 flush 过时给 0（「没有任何一次渲染」的读数），不把这个哨兵值泄漏给界面。
        lastFlushAt: lastFlushAt === null ? 0 : lastFlushAt
      };
    }
  };
}

/**
 * 主线程长任务观测器（验收原文「全程无超过 200ms 的主线程长任务」）。
 *
 * - 支持 `PerformanceObserver('longtask')` 时用它（`mode: 'longtask'`）：每个条目就是一次 >50ms 的任务，
 *   `maxMs` 取最长的一条；
 * - 不支持时退化为定时器漂移采样（`mode: 'lag'`）：`setInterval(lagIntervalMs)` 的实际触发间隔减掉名义间隔，
 *   得到的是「事件循环被占住」的最坏值 —— 口径更粗，但结论里会写明用的是哪一种，不冒充 longtask。
 *
 * `start()` / `stop()` 成对使用（一次生成 = 一个观测窗口）；`stats()` 给 data 层的
 * `evaluateReviewLongTask()` 判结论。
 */
export function createMainThreadProbe({ budgetMs = REVIEW_LONG_TASK_BUDGET_MS, lagIntervalMs = 50, now = nowMs } = {}) {
  const budget = Number(budgetMs) > 0 ? Number(budgetMs) : REVIEW_LONG_TASK_BUDGET_MS;
  const lagInterval = Number(lagIntervalMs) > 0 ? Number(lagIntervalMs) : 50;
  let mode = 'unsupported';
  let observer = null;
  let timerId = 0;
  let running = false;
  let maxMs = 0;
  let count = 0;
  let over = 0;
  let samples = 0;
  let lastTick = 0;

  const record = (durationMs) => {
    const value = Math.max(0, Number(durationMs) || 0);
    count += 1;
    if (value > maxMs) maxMs = value;
    if (value > budget) over += 1;
  };

  const ticks = typeof setInterval === 'function' && typeof clearInterval === 'function';

  return {
    get running() { return running; },
    get mode() { return mode; },
    start() {
      if (running) return false;
      const hasObserver = typeof PerformanceObserver === 'function'
        && Array.isArray(PerformanceObserver.supportedEntryTypes)
        && PerformanceObserver.supportedEntryTypes.includes('longtask');
      if (hasObserver) {
        mode = 'longtask';
        samples = 1;
        try {
          observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) record(entry.duration);
          });
          observer.observe({ entryTypes: ['longtask'] });
        } catch {
          observer = null;
          mode = 'unsupported';
        }
        running = mode === 'longtask';
        return running;
      }
      if (!ticks) {
        mode = 'unsupported';
        return false;
      }
      mode = 'lag';
      running = true;
      lastTick = now();
      timerId = setInterval(() => {
        const at = now();
        // 名义间隔之外多等的时间 = 事件循环被占住的时长。
        record(Math.max(0, at - lastTick - lagInterval));
        samples += 1;
        lastTick = at;
      }, lagInterval);
      return true;
    },
    stop() {
      if (!running) return false;
      running = false;
      if (observer) {
        try { observer.disconnect(); } catch { /* 断开失败不影响读数 */ }
        observer = null;
      }
      if (timerId) {
        clearInterval(timerId);
        timerId = 0;
      }
      return true;
    },
    stats() {
      return { mode, supported: mode !== 'unsupported', budgetMs: budget, count, samples, maxMs, over, lagIntervalMs: lagInterval };
    }
  };
}

/**
 * 展开 / 折叠响应计时（验收原文「展开与折叠响应小于 100ms」）。
 * `start()` 在点击处理里调用，`end()` 在 DOM 提交之后（`useLayoutEffect`）调用；
 * `stats()` 报**最慢的一次**（面板展开收起与分区手风琴共用一个探针实例）。
 */
export function createResponseProbe({ budgetMs = REVIEW_TOGGLE_BUDGET_MS, now = nowMs } = {}) {
  const budget = Number(budgetMs) > 0 ? Number(budgetMs) : REVIEW_TOGGLE_BUDGET_MS;
  let startedAt = 0;
  let count = 0;
  let worstMs = null;
  let lastMs = null;
  return {
    get budgetMs() { return budget; },
    start() {
      startedAt = now();
      return startedAt;
    },
    end() {
      if (!startedAt) return null;
      const ms = Math.max(0, now() - startedAt);
      startedAt = 0;
      count += 1;
      lastMs = ms;
      worstMs = worstMs === null ? ms : Math.max(worstMs, ms);
      return { ms, count, worstMs, ok: ms <= budget };
    },
    stats() {
      return { ms: worstMs, count, lastMs, worstMs, budgetMs: budget };
    },
    reset() {
      startedAt = 0;
      count = 0;
      worstMs = null;
      lastMs = null;
    }
  };
}

/**
 * 长推理展开后的滚动区读数：`scrollHeight > clientHeight` 才算真的有滚动区。
 * 元素不可见（折叠态 / 分区收起）时 `clientHeight` 为 0，返回 `scrollable: null` ——
 * 「量不到」不写成「滚不动」。
 */
export function measureReasoningScroll(node) {
  const empty = { ok: false, chars: 0, scrollHeight: 0, clientHeight: 0, scrollable: null };
  if (!node || typeof node !== 'object') return empty;
  const chars = typeof node.textContent === 'string' ? node.textContent.length : 0;
  const scrollHeight = Math.round(Number(node.scrollHeight) || 0);
  const clientHeight = Math.round(Number(node.clientHeight) || 0);
  const visible = clientHeight > 0;
  return {
    ok: visible,
    chars,
    scrollHeight,
    clientHeight,
    scrollable: visible ? scrollHeight > clientHeight + 1 : null
  };
}

/** 空读数（面板在还没有任何一次生成时显示「还没测到」而不是编一个数字）。 */
export function emptyReviewStreamStats(intervalMs = REVIEW_STREAM_FLUSH_MS) {
  return { pushes: 0, reasonPushes: 0, contentPushes: 0, flushTimes: [], flushReasons: [], intervalMs, lastFlushAt: 0 };
}
