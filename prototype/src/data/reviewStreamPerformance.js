// 第三步「五维点评」的移动端与流式渲染性能规则（[第三步 US-113]「点评移动端与流式渲染性能」）。
//
// 与 `data/framingPerformance.js`（US-012 装裱性能）同一套纪律：**纯函数 + 常量**，不碰 DOM、
// 不碰网络，可以直接用 Node 跑断言（见 prototype/AGENTS.md 的「验证技巧」一节）。
// 浏览器侧的执行（推理增量缓冲、主线程长任务观测、展开 / 折叠响应计时、长推理滚动测量、内存采样）
// 在 `services/reviewStreamPerformance.js`。
//
// 这里放五件事，每一件都只有一份真源：
// 1. 推理增量的批量 flush 间隔 `REVIEW_STREAM_FLUSH_MS`（验收原文「不小于 100ms 批量 flush 渲染，
//    不逐 chunk 触发全量重渲染」）；
// 2. 展开 / 折叠的响应上限 `REVIEW_TOGGLE_BUDGET_MS`（100ms）与主线程长任务上限
//    `REVIEW_LONG_TASK_BUDGET_MS`（200ms，验收原文「全程无超过 200ms 的主线程长任务」）；
// 3. 长推理阈值 `REVIEW_LONG_REASONING_CHARS`（10000 字）与「展开后可滚动」的判据；
// 4. 390px 手风琴断点 `REVIEW_ACCORDION_MAX_WIDTH`（与第二步抽屉断点同值 430）+ 六个分区的展开计划
//    （手风琴 = 同时只展开一个；桌面 = 六个平铺展开）；
// 5. 内存占用峰值上限（复用第二步的 `FRAMING_MEMORY_BUDGET_MB` = 300MB，同一个验收数字只写一处）。
//
// 界面上那块「点评性能」读数、浏览器断言与 Node 断言读的都是 `reviewPerformanceChecks()`
// 的同一份结论 —— 不要在面板或脚本里各写一遍「多少算超标」。
import { FRAMING_MEMORY_BUDGET_MB, evaluateMemoryPeak, formatPerfMs } from './framingPerformance';
import { REVIEW_DETAIL_SECTION_KEYS } from './reviewDetailPanel';

/** 推理（与正文）增量的批量 flush 间隔：不小于 100ms，逐 chunk 触发的只是「攒着」，不是渲染。 */
export const REVIEW_STREAM_FLUSH_MS = 100;

/** 主线程长任务上限：全程不允许出现超过 200ms 的单个任务。 */
export const REVIEW_LONG_TASK_BUDGET_MS = 200;

/** 展开 / 折叠的响应上限：点一下到界面更新完毕小于 100ms。 */
export const REVIEW_TOGGLE_BUDGET_MS = 100;

/** 长推理的字数阈值：超过 10000 字的推理展开后要能顺畅滚动。 */
export const REVIEW_LONG_REASONING_CHARS = 10000;

/** 手风琴断点（与第二步的抽屉断点 `STUDIO_DRAWER_MAX_WIDTH` 同值；CSS 里同值，改一处要同步另一处）。 */
export const REVIEW_ACCORDION_MAX_WIDTH = 430;

/** 内存占用峰值上限：不超过 300MB（与装裱性能同一个数字，这里只做转出，不另写一份）。 */
export const REVIEW_MEMORY_BUDGET_MB = FRAMING_MEMORY_BUDGET_MB;

/** 六项性能检查的清单（界面顺序、断言钩子 id 都读它）。 */
export const REVIEW_PERF_CHECK_IDS = ['flush', 'toggle', 'longtask', 'long-reasoning', 'accordion', 'memory'];

export const REVIEW_PERF_CHECK_LABELS = {
  flush: '推理增量批量 flush',
  toggle: '展开与折叠响应',
  longtask: '主线程长任务',
  'long-reasoning': '长推理展开后滚动',
  accordion: '390px 六个分区手风琴',
  memory: '内存占用峰值'
};

/** 六项预算的可读口径（界面顶部一句话，断言按同一份字符串对照）。 */
export const REVIEW_PERF_BUDGET_TEXT = `推理增量按 ≥${REVIEW_STREAM_FLUSH_MS}ms 批量 flush · 展开与折叠 <${REVIEW_TOGGLE_BUDGET_MS}ms · 主线程无 >${REVIEW_LONG_TASK_BUDGET_MS}ms 长任务 · 推理 ≥${REVIEW_LONG_REASONING_CHARS} 字展开后可滚动 · ≤${REVIEW_ACCORDION_MAX_WIDTH}px 六个分区走手风琴 · 内存峰值 ≤${REVIEW_MEMORY_BUDGET_MB}MB`;

/**
 * 下一次 flush 还要等多久（毫秒；0 = 现在就该 flush）。
 *
 * 传输层用的就是这一条：距离上次 flush 已经够 `intervalMs` 就立刻渲染（首字不拖延），
 * 否则把渲染推迟到「上次 flush + intervalMs」——因此**相邻两次 flush 的间隔不小于 intervalMs**，
 * 几十毫秒里涌进来的一串 chunk 只会渲染一次。
 */
export function reviewStreamFlushDelay({ now = 0, lastFlushAt = 0, intervalMs = REVIEW_STREAM_FLUSH_MS } = {}) {
  const interval = Number(intervalMs) > 0 ? Number(intervalMs) : REVIEW_STREAM_FLUSH_MS;
  const last = Number(lastFlushAt) || 0;
  if (!last) return 0;
  const elapsed = (Number(now) || 0) - last;
  return elapsed >= interval ? 0 : interval - elapsed;
}

/**
 * 批量 flush 的读数（`chunks` = 收到的增量段数，`times` = 每次 flush 的时刻，毫秒，
 * `reasons` = 每次 flush 的原因（'push' / 'timer' / 收尾补渲染的 'settle'）。
 *
 * `batched` = 增量比渲染次数多（即真的攒了批，不是逐 chunk 渲染）；
 * `intervalOk` = **周期性**渲染之间（push / timer）的相邻间隔都不小于 `intervalMs`。
 * 收尾那一次补渲染（流结束时把还没渲染的尾段补上）不算周期性渲染 —— 它可能紧跟在最后一次
 * 周期渲染后面（差几毫秒），把它算进间隔里会把「流结束」误判成「渲染太快」，见 `settleFlushes`。
 */
export function reviewStreamFlushStats({ chunks = 0, times = [], reasons = [], intervalMs = REVIEW_STREAM_FLUSH_MS, toleranceMs = 5 } = {}) {
  const interval = Number(intervalMs) > 0 ? Number(intervalMs) : REVIEW_STREAM_FLUSH_MS;
  const tolerance = Math.max(0, Number(toleranceMs) || 0);
  const points = Array.from(times || [])
    .map((value, index) => ({ at: Number(value), reason: String((Array.isArray(reasons) ? reasons[index] : '') || 'push') }))
    .filter(point => Number.isFinite(point.at))
    .sort((a, b) => a.at - b.at);
  const cadence = points.filter(point => point.reason === 'push' || point.reason === 'timer');
  const gapsOf = list => {
    const out = [];
    for (let index = 1; index < list.length; index += 1) out.push(list[index].at - list[index - 1].at);
    return out.map(value => Math.round(value));
  };
  const gaps = gapsOf(points);
  const cadenceGaps = gapsOf(cadence);
  const chunkCount = Math.max(0, Number(chunks) || 0);
  const flushCount = points.length;
  const settleFlushes = points.length - cadence.length;
  const minGapMs = cadenceGaps.length ? Math.min(...cadenceGaps) : 0;
  const maxGapMs = cadenceGaps.length ? Math.max(...cadenceGaps) : 0;
  const avgGapMs = cadenceGaps.length ? Math.round(cadenceGaps.reduce((sum, value) => sum + value, 0) / cadenceGaps.length) : 0;
  return {
    chunks: chunkCount,
    flushCount,
    // 全部相邻间隔（含收尾补渲染那一段）与**周期性**渲染的间隔（判定用后者）。
    gaps,
    cadenceGaps,
    settleFlushes,
    minGapMs,
    maxGapMs,
    avgGapMs,
    intervalMs: interval,
    // 「不逐 chunk 触发全量重渲染」的判据：一段增量渲染一次是逐 chunk；多段增量挤进更少的渲染才是攒批。
    batched: chunkCount > 1 ? flushCount < chunkCount : true,
    // 每多少次增量渲染一次（越接近 1 越像逐 chunk；脚本与面板显示同一个读数）。
    chunksPerFlush: flushCount > 0 ? Number((chunkCount / flushCount).toFixed(2)) : 0,
    intervalOk: cadenceGaps.every(gap => gap >= interval - tolerance)
  };
}

/** 批量 flush 的结论行（`ok === null` = 还没收到增量，界面显示灰字）。 */
export function evaluateReviewFlush({ chunks = 0, times = [], reasons = [], intervalMs = REVIEW_STREAM_FLUSH_MS, toleranceMs = 5 } = {}) {
  const stats = reviewStreamFlushStats({ chunks, times, reasons, intervalMs, toleranceMs });
  if (!stats.chunks) {
    return {
      id: 'flush',
      ok: null,
      ...stats,
      value: '',
      budget: `≥${stats.intervalMs}ms`,
      text: `推理增量批量 flush：等待第一次生成（每 ≥${stats.intervalMs}ms 渲染一次，不逐 chunk 重渲染）`
    };
  }
  const ok = stats.batched && stats.intervalOk;
  return {
    id: 'flush',
    ok,
    ...stats,
    value: `${stats.chunks} 段 / ${stats.flushCount} 次`,
    budget: `≥${stats.intervalMs}ms`,
    text: `推理增量 ${stats.chunks} 段按 ≥${stats.intervalMs}ms 批量 flush（渲染 ${stats.flushCount} 次 · 平均每次带 ${stats.chunksPerFlush} 段${
      stats.cadenceGaps.length ? ` · 最小间隔 ${stats.minGapMs}ms` : ''
    }${stats.settleFlushes ? ` · 收尾补渲染 ${stats.settleFlushes} 次不计入间隔` : ''}，${ok ? '达标' : stats.batched ? '间隔不足' : '仍在逐段渲染'}）`
  };
}

/**
 * 展开 / 折叠的响应结论。`ms` 传**最慢的一次**（面板展开收起与分区手风琴共用这一个探针），
 * `count` 是累计切换次数（0 次 = 还没量到，给 `ok: null`）。
 */
export function evaluateReviewToggle({ ms = null, count = 0, budgetMs = REVIEW_TOGGLE_BUDGET_MS } = {}) {
  const budget = Number(budgetMs) > 0 ? Number(budgetMs) : REVIEW_TOGGLE_BUDGET_MS;
  const times = Math.max(0, Number(count) || 0);
  const value = Number.isFinite(Number(ms)) && ms !== null ? Math.max(0, Number(ms)) : null;
  if (!times || value === null) {
    return {
      id: 'toggle',
      ok: null,
      ms: null,
      count: times,
      budgetMs: budget,
      value: '',
      budget: `<${budget}ms`,
      text: `展开与折叠响应：点一次摘要行或分区标题后测量（上限 ${budget}ms）`
    };
  }
  const ok = value <= budget;
  return {
    id: 'toggle',
    ok,
    ms: Math.round(value),
    count: times,
    budgetMs: budget,
    value: formatPerfMs(value),
    budget: `<${budget}ms`,
    text: `展开与折叠响应 ${formatPerfMs(value)}（${times} 次切换的最慢一次，上限 ${budget}ms，${ok ? '达标' : '超标'}）`
  };
}

/**
 * 主线程长任务的结论。
 * `mode` 是观测方式：`longtask`（PerformanceObserver 的 longtask 条目，桌面 Chrome 支持）或
 * `lag`（退化为定时器漂移采样）；`unsupported` 时给 `ok: null`，绝不把「没测到」写成「达标」。
 * `samples` = 采样次数（长任务条目数或漂移采样点数，用来区分「真的没有长任务」与「压根没采样」）。
 */
export function evaluateReviewLongTask({ mode = 'unsupported', maxMs = 0, count = 0, samples = 0, over = 0, budgetMs = REVIEW_LONG_TASK_BUDGET_MS } = {}) {
  const budget = Number(budgetMs) > 0 ? Number(budgetMs) : REVIEW_LONG_TASK_BUDGET_MS;
  const value = Math.max(0, Number(maxMs) || 0);
  const modeLabel = mode === 'longtask' ? 'PerformanceObserver longtask' : mode === 'lag' ? '定时器漂移采样（退化）' : '本机浏览器不支持观测';
  if (mode === 'unsupported' || (!samples && !count)) {
    return {
      id: 'longtask',
      ok: null,
      mode,
      maxMs: Math.round(value),
      budgetMs: budget,
      value: '',
      budget: `≤${budget}ms`,
      text: `主线程长任务：${modeLabel}（上限 ${budget}ms）`
    };
  }
  const ok = value <= budget;
  return {
    id: 'longtask',
    ok,
    mode,
    maxMs: Math.round(value),
    count: Math.max(0, Number(count) || 0),
    over: Math.max(0, Number(over) || 0),
    budgetMs: budget,
    value: `${Math.round(value)}ms`,
    budget: `≤${budget}ms`,
    text: `主线程最长任务 ${Math.round(value)}ms（${modeLabel} · ${Math.max(0, Number(count) || 0)} 个记录${
      over ? ` · ${over} 个超 ${budget}ms` : ''
    }，上限 ${budget}ms，${ok ? '达标' : '超标'}）`
  };
}

/** 长推理的判定：字数到没到阈值（`needed` 为假时这一项给 `ok: null`，不假装达标）。 */
export function reviewLongReasoningPlan({ chars = 0, threshold = REVIEW_LONG_REASONING_CHARS } = {}) {
  const limit = Number(threshold) > 0 ? Number(threshold) : REVIEW_LONG_REASONING_CHARS;
  const count = Math.max(0, Number(chars) || 0);
  return { chars: count, threshold: limit, needed: count >= limit };
}

/**
 * 「超过 10000 字的推理展开后可顺畅滚动」的结论。
 * `scrollable` 由 `services/reviewStreamPerformance.js` 的 `measureReasoningScroll()` 量出
 * （`scrollHeight > clientHeight` 才算有滚动区），`scrollHeight` / `clientHeight` 一起显示。
 */
export function evaluateReviewLongReasoning({ chars = 0, scrollable = null, scrollHeight = 0, clientHeight = 0, threshold = REVIEW_LONG_REASONING_CHARS } = {}) {
  const plan = reviewLongReasoningPlan({ chars, threshold });
  const sizeText = `内容 ${Math.round(Number(scrollHeight) || 0)}px / 视口 ${Math.round(Number(clientHeight) || 0)}px`;
  if (!plan.needed) {
    return {
      id: 'long-reasoning',
      ok: null,
      ...plan,
      scrollable: null,
      value: `${plan.chars} 字`,
      budget: `≥${plan.threshold} 字`,
      text: plan.chars
        ? `长推理展开后滚动：推理 ${plan.chars} 字（未到 ${plan.threshold} 字，暂不检查滚动）`
        : `长推理展开后滚动：推理到 ${plan.threshold} 字以上时检查（当前还没有推理增量）`
    };
  }
  if (scrollable === null) {
    return {
      id: 'long-reasoning',
      ok: null,
      ...plan,
      scrollable: null,
      value: `${plan.chars} 字`,
      budget: `≥${plan.threshold} 字`,
      text: `长推理展开后滚动：推理 ${plan.chars} 字，等展开后量一次滚动区`
    };
  }
  const ok = scrollable === true;
  return {
    id: 'long-reasoning',
    ok,
    ...plan,
    scrollable: ok,
    scrollHeight: Math.round(Number(scrollHeight) || 0),
    clientHeight: Math.round(Number(clientHeight) || 0),
    value: `${plan.chars} 字${ok ? ' · 可滚动' : ''}`,
    budget: `≥${plan.threshold} 字`,
    text: `长推理 ${plan.chars} 字展开后${ok ? '可顺畅滚动' : '没有滚动区'}（${sizeText}，${ok ? '达标' : '超标'}）`
  };
}

/** 手风琴口径：视口 ≤ 430px 时六个分区走手风琴（同时只展开一个）。 */
export function reviewAccordionMode({ viewportWidth = 0, maxWidth = REVIEW_ACCORDION_MAX_WIDTH } = {}) {
  const width = Number(viewportWidth) || 0;
  const limit = Number(maxWidth) > 0 ? Number(maxWidth) : REVIEW_ACCORDION_MAX_WIDTH;
  return width > 0 && width <= limit;
}

/**
 * 六个分区的初始展开计划：手风琴只展开**第一个分区**（推理过程 —— 生成中的实时内容），
 * 桌面口径六个全部展开（与 US-103b 的平铺形态一字不变）。
 */
export function reviewSectionOpenPlan({ accordion = false, keys = REVIEW_DETAIL_SECTION_KEYS } = {}) {
  const list = Array.from(keys || []);
  if (!list.length) return [];
  return accordion ? [list[0]] : list.slice();
}

/**
 * 点一次分区标题后的展开集合（唯一真源 —— 组件里不许自己写 `open.filter(...)`）：
 * 手风琴：点开的那一个展开、别的收起（点已展开的那一个 = 收起，六个分区可以全部收起）；
 * 桌面：始终六个平铺展开（桌面不渲染分区标题按钮，这里只是让函数是全函数）。
 */
export function toggleReviewSection({ open = [], key = '', accordion = false, keys = REVIEW_DETAIL_SECTION_KEYS } = {}) {
  const list = Array.from(keys || []);
  const current = Array.from(open || []).filter(item => list.includes(item));
  const target = String(key || '');
  if (!list.includes(target)) return current;
  if (!accordion) return list.slice();
  return current.includes(target) ? current.filter(item => item !== target) : [target];
}

/** 某个分区当前是否展开（手风琴与桌面共用：桌面的计划本来就是「全展开」）。 */
export function reviewSectionOpen(open = [], key = '') {
  return Array.from(open || []).includes(String(key || ''));
}

/** 手风琴口径的结论行（`sectionCount` 必须是六个分区都在 DOM 里）。 */
export function evaluateReviewAccordion({ accordion = false, sectionCount = 0, openCount = 0, keys = REVIEW_DETAIL_SECTION_KEYS } = {}) {
  const total = Array.from(keys || []).length;
  const count = Math.max(0, Number(sectionCount) || 0);
  const open = Math.max(0, Number(openCount) || 0);
  const ok = count === total && total > 0;
  return {
    id: 'accordion',
    ok: count ? ok : null,
    accordion,
    sectionCount: count,
    openCount: open,
    total,
    value: accordion ? `手风琴 · 展开 ${open}/${total}` : `平铺 · ${count}/${total}`,
    budget: `≤${REVIEW_ACCORDION_MAX_WIDTH}px`,
    text: accordion
      ? `≤${REVIEW_ACCORDION_MAX_WIDTH}px 口径：六个分区走手风琴（当前展开 ${open}/${total} 个，点标题逐个展开，${ok ? '达标' : '分区数不对'}）`
      : `桌面口径：六个分区平铺展开（当前六个分区都在 DOM 里，${ok ? '达标' : '分区数不对'}）`
  };
}

/**
 * 六项性能检查的汇总（界面读数与断言读同一份）。
 * 每行 `{ id, label, ok, value, budget, text }`：`ok === null` 表示「还没测到」（pending），
 * 界面据此显示灰字，而不是把「没测」当成「达标」。
 */
export function reviewPerformanceChecks({ flush, toggle, longTask, longReasoning, accordion, memory } = {}) {
  const rows = [];
  const push = (id, row) => rows.push({ id, label: REVIEW_PERF_CHECK_LABELS[id], ok: row.ok, value: row.value, budget: row.budget, text: row.text, detail: row });
  push('flush', evaluateReviewFlush(flush || {}));
  push('toggle', evaluateReviewToggle(toggle || {}));
  push('longtask', evaluateReviewLongTask(longTask || {}));
  push('long-reasoning', evaluateReviewLongReasoning(longReasoning || {}));
  push('accordion', evaluateReviewAccordion(accordion || {}));
  push('memory', memory
    ? { ...evaluateMemoryPeak(memory), value: `${(Math.max(0, Number(memory.bytes) || 0) / (1024 * 1024)).toFixed(0)}MB`, budget: `≤${REVIEW_MEMORY_BUDGET_MB}MB` }
    : { id: 'memory', ok: null, value: '', budget: `≤${REVIEW_MEMORY_BUDGET_MB}MB`, text: `内存占用峰值：进入第三步后持续采样（上限 ${REVIEW_MEMORY_BUDGET_MB}MB）` });
  const measured = rows.filter(row => row.ok !== null);
  return {
    rows,
    measured: measured.length,
    total: rows.length,
    allOk: measured.length === rows.length && measured.every(row => row.ok),
    summary: measured.length === rows.length
      ? `六项性能检查${measured.every(row => row.ok) ? '全部达标' : '有超标项'}`
      : `性能检查已测 ${measured.length}/${rows.length} 项`,
    budgetText: REVIEW_PERF_BUDGET_TEXT
  };
}
