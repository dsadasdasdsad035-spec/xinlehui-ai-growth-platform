/**
 * 成长档案的移动端与性能规则（[第四步 US-212]「档案移动端与性能」/ FR-212）。
 *
 * 与 `data/intakePerformance.js` / `data/framingPerformance.js` 同一套纪律：**纯函数 + 常量**，
 * 不碰 DOM、不碰网络，可以直接用 Node 跑断言（见 prototype/AGENTS.md 的「验证技巧」一节）；
 * 浏览器侧的执行（缩略图、首屏计时、滚动采帧）在 `services/archivePerformance.js`。
 *
 * 这里放四件事，每一件都只有一份真源：
 * 1. **首屏预算** `ARCHIVE_FIRST_PAINT_BUDGET_MS`（1000ms）—— 50 条归档记录以内，时间线首屏渲染 ≤1 秒；
 * 2. **分页窗口** `archiveTimelineWindow()` —— 超过 `ARCHIVE_TIMELINE_PAGE_SIZE`（20）条就只把当前窗口
 *    的卡放进 DOM（「分页或虚拟滚动」的落地方式：DOM 里永远 ≤20 张卡，滚动不必为一学期的记录买单）；
 * 3. **滚动帧率下限** `ARCHIVE_SCROLL_MIN_FPS`（30fps）；
 * 4. **列表缩略图** `ARCHIVE_THUMB_MAX_EDGE`（320px，与录入页共用 `THUMBNAIL_MAX_EDGE` 这一个数）。
 *
 * 界面上的「档案性能」读数、浏览器断言与 Node 断言读的都是 `archivePerformanceChecks()` 的同一份结论
 * —— 不要在面板或脚本里各写一遍「多少算超标」。
 */
import { formatPerfMs } from './framingPerformance.js';
import { TAP_TARGET_MIN, THUMBNAIL_MAX_EDGE, thumbnailPlan } from './intakePerformance.js';

/** 验收使用的手机宽度（390px）。 */
export const ARCHIVE_MOBILE_WIDTH = 390;

/** 可点区域下限：390px 下第四步的归档摘要与操作按钮不小于 44x44px（唯一真源是 `TAP_TARGET_MIN`）。 */
export const ARCHIVE_TAP_MIN = TAP_TARGET_MIN;

/** 时间线首屏渲染预算（验收原文：50 条归档记录以内，首屏 ≤ 1 秒）。 */
export const ARCHIVE_FIRST_PAINT_BUDGET_MS = 1000;

/** 「50 条归档记录以内」这条验收前提（读数里如实写出这一次的条数）。 */
export const ARCHIVE_FIRST_PAINT_RECORD_LIMIT = 50;

/** 分页窗口大小：**超过**这个条数才分页，每页条数也是它（DOM 里的卡数上限）。 */
export const ARCHIVE_TIMELINE_PAGE_SIZE = 20;

/** 滚动帧率下限：不低于 30fps。 */
export const ARCHIVE_SCROLL_MIN_FPS = 30;

/** 列表缩略图的长边上限（320px）：卡片里先渲染小图，原图留给点开看。 */
export const ARCHIVE_THUMB_MAX_EDGE = THUMBNAIL_MAX_EDGE;

/** 懒加载的视口外扩：距视口 240px 以内的卡片才开始要缩略图（滚动时不至于「还没出图」）。 */
export const ARCHIVE_LAZY_ROOT_MARGIN = '240px';

/** 四项检查的清单（界面顺序、`data-archive-perf-row` 的 id 都读它）。 */
export const ARCHIVE_PERF_CHECK_IDS = ['first-paint', 'page', 'scroll-fps', 'thumb'];

export const ARCHIVE_PERF_CHECK_LABELS = {
  'first-paint': '时间线首屏渲染',
  page: '超过 20 条的分页',
  'scroll-fps': '滚动帧率',
  thumb: '缩略图与懒加载'
};

/** 面板整块的说明（一句话讲清四项读数分别对应哪条验收）。 */
export const ARCHIVE_PERF_HINT = `档案时间线的四项性能读数：首屏渲染 ≤ ${ARCHIVE_FIRST_PAINT_BUDGET_MS}ms（${ARCHIVE_FIRST_PAINT_RECORD_LIMIT} 条记录以内）、超过 ${ARCHIVE_TIMELINE_PAGE_SIZE} 条自动分页（DOM 里只放当前窗口）、滚动不低于 ${ARCHIVE_SCROLL_MIN_FPS}fps、列表图先出长边 ≤ ${ARCHIVE_THUMB_MAX_EDGE}px 的缩略图并懒加载。`;

/**
 * 时间线的分页窗口（「超过 20 条记录时分页或虚拟滚动」的唯一判据）。
 *
 * `page` 是 1 起的页码；窗口永远是**从最早的一节课开始**的前 N 页（时间线按日期升序，
 * 「加载更多」往后长而不是跳页 —— 老师看的是孩子的成长顺序，不该被页码打断）。
 * 返回的 `visible` 就是这一次真正渲染进 DOM 的卡数，`hidden` 是还没放进 DOM 的条数。
 */
export function archiveTimelineWindow({ count = 0, page = 1, pageSize = ARCHIVE_TIMELINE_PAGE_SIZE } = {}) {
  const total = Math.max(0, Math.trunc(Number(count) || 0));
  const size = Math.max(1, Math.trunc(Number(pageSize) || ARCHIVE_TIMELINE_PAGE_SIZE));
  const pageCount = Math.max(1, Math.ceil(total / size));
  const mode = total > size ? 'paged' : 'full';
  const current = Math.min(Math.max(1, Math.trunc(Number(page) || 1)), pageCount);
  const end = mode === 'paged' ? Math.min(total, current * size) : total;
  const start = 0;
  const visible = Math.max(0, end - start);
  const hidden = Math.max(0, total - visible);
  return {
    total,
    pageSize: size,
    page: current,
    pageCount,
    // `paged` = 需要分页（超过一页的条数）；`full` = 一次渲染全部（不超过 20 条）。
    mode,
    paged: mode === 'paged',
    start,
    end,
    visible,
    hidden,
    hasMore: hidden > 0,
    hasPrev: current > 1,
    // 界面文案由 data 层给（界面不自己拼「还有几节课」）：
    moreLabel: hidden > 0 ? `加载更多（还有 ${hidden} 节课）` : '',
    prevLabel: current > 1 ? '上一页' : '',
    rangeLabel: `显示 ${visible}/${total} 节课`,
    hint: mode === 'paged'
      ? `共 ${total} 节课：时间线按每页 ${size} 条分页，当前只渲染最早的 ${visible} 条，滚动不必为一学期的记录买单。`
      : `共 ${total} 节课：不超过 ${size} 条，时间线一次渲染全部。`
  };
}

/** 按窗口切出这一次真正渲染的条目（越界安全：窗口比数组长时返回全部）。 */
export function archiveWindowEntries(entries, window) {
  const list = Array.isArray(entries) ? entries : [];
  const end = window && Number.isFinite(Number(window.end)) ? Math.max(0, Math.trunc(Number(window.end))) : list.length;
  return list.slice(0, Math.min(list.length, end));
}

/** 缩略图缩放方案（纯计算；实际绘制在 `services/archivePerformance.js` 的 `createArchiveThumbnail`）。 */
export function archiveThumbnailPlan(width, height, maxEdge = ARCHIVE_THUMB_MAX_EDGE) {
  const limit = Number(maxEdge) > 0 ? Number(maxEdge) : ARCHIVE_THUMB_MAX_EDGE;
  const plan = thumbnailPlan(width, height, limit);
  return { ...plan, maxEdge: limit };
}

/** 毫秒的可读说法：320ms / 1.1s（与装裱性能面板共用 `formatPerfMs`，不另写一份）。 */
export function formatArchivePerfMs(ms) {
  return formatPerfMs(ms);
}

/**
 * 「时间线首屏渲染」的结论。`ms` 是**数据就绪 → 时间线首帧**的实测耗时
 * （`services/archivePerformance.js` 的首屏探针量出来的），`count` 是这一次要渲染的条数。
 */
export function evaluateArchiveFirstPaint({ ms, count = 0 } = {}) {
  const value = Math.max(0, Number(ms) || 0);
  const budget = ARCHIVE_FIRST_PAINT_BUDGET_MS;
  const records = Math.max(0, Math.trunc(Number(count) || 0));
  const ok = value <= budget;
  const over = records > ARCHIVE_FIRST_PAINT_RECORD_LIMIT;
  return {
    id: 'first-paint',
    ok,
    ms: Math.round(value),
    budgetMs: budget,
    count: records,
    value: formatArchivePerfMs(value),
    budget: formatArchivePerfMs(budget),
    text: `时间线首屏渲染 ${formatArchivePerfMs(value)}（${records} 条归档记录，预算 ${formatArchivePerfMs(budget)}，${ok ? '达标' : '超标'}${over ? '；条数超过验收前提 50 条' : ''}）`
  };
}

/**
 * 「超过 20 条的分页」的结论：`mode` 为 `paged` 时只渲染窗口内的卡（`visible` ≤ `pageSize`）。
 * 条数没超过阈值（`full`）时这一行如实写「一次渲染全部」，同样算达标。
 */
export function evaluateArchivePaging({ count = 0, mode = 'full', pageSize = ARCHIVE_TIMELINE_PAGE_SIZE, visible = 0 } = {}) {
  const total = Math.max(0, Math.trunc(Number(count) || 0));
  const size = Math.max(1, Math.trunc(Number(pageSize) || ARCHIVE_TIMELINE_PAGE_SIZE));
  const shown = Math.max(0, Math.trunc(Number(visible) || 0));
  const paged = mode === 'paged';
  const ok = !paged || shown <= size;
  return {
    id: 'page',
    ok,
    mode: paged ? 'paged' : 'full',
    count: total,
    pageSize: size,
    visible: shown,
    value: paged ? `${shown}/${total}` : `${total}`,
    budget: `≤ ${size}`,
    text: paged
      ? `${total} 条超过 ${size} 条：已分页，DOM 里只放当前窗口的 ${shown} 张卡（每页 ${size} 条）`
      : `${total} 条未超过 ${size} 条：时间线一次渲染全部卡`
  };
}

/**
 * 滚动帧率的结论：`frames` 太少（< 4）时不给结论（`ok: null`）—— 两帧算出来的「500fps」没有意义，
 * 不能拿来当达标证据（与 `evaluateDragFps` 同一口径）。
 */
export function evaluateArchiveScrollFps({ fps, frames } = {}) {
  const count = Math.max(0, Number(frames) || 0);
  const value = Math.max(0, Number(fps) || 0);
  if (count < 4) {
    return {
      id: 'scroll-fps',
      ok: null,
      fps: Math.round(value),
      frames: count,
      minFps: ARCHIVE_SCROLL_MIN_FPS,
      value: '',
      budget: `${ARCHIVE_SCROLL_MIN_FPS}fps`,
      text: '滚动帧率：还没量到足够长的一次滚动'
    };
  }
  const ok = value >= ARCHIVE_SCROLL_MIN_FPS;
  return {
    id: 'scroll-fps',
    ok,
    fps: Math.round(value),
    frames: count,
    minFps: ARCHIVE_SCROLL_MIN_FPS,
    value: `${Math.round(value)}fps`,
    budget: `${ARCHIVE_SCROLL_MIN_FPS}fps`,
    text: `档案滚动 ${Math.round(value)}fps（不低于 ${ARCHIVE_SCROLL_MIN_FPS}fps，${ok ? '达标' : '未达标'}）`
  };
}

/**
 * 缩略图与懒加载的结论：只统计**进入过视口**（被请求过）的图 ——
 * `pending` 是正在生成的张数，`lazy` 是还没进入视口、按需再要的张数。
 * `pending === 0` 且没有失败才算达标：滚动经过的每一张都已经拿小图渲染过了。
 */
export function evaluateArchiveThumbnails({ ready = 0, pending = 0, lazy = 0, failed = 0, total = 0 } = {}) {
  const done = Math.max(0, Math.trunc(Number(ready) || 0));
  const waiting = Math.max(0, Math.trunc(Number(pending) || 0));
  const untouched = Math.max(0, Math.trunc(Number(lazy) || 0));
  const broken = Math.max(0, Math.trunc(Number(failed) || 0));
  const all = Math.max(0, Math.trunc(Number(total) || done + waiting + untouched + broken));
  const ok = waiting === 0 && broken === 0;
  return {
    id: 'thumb',
    ok,
    ready: done,
    pending: waiting,
    lazy: untouched,
    failed: broken,
    total: all,
    value: `${done}/${all}`,
    budget: `≤ ${ARCHIVE_THUMB_MAX_EDGE}px`,
    text: `列表缩略图（长边 ≤ ${ARCHIVE_THUMB_MAX_EDGE}px）${done} 张就绪${waiting ? `，${waiting} 张生成中` : ''}${untouched ? `，${untouched} 张未进视口待懒加载` : ''}${broken ? `，${broken} 张回退原图` : ''}`
  };
}

/**
 * 四项检查的汇总（界面读数与断言读同一份）。
 * 每行 `{ id, label, ok, value, budget, text, detail }`：`ok === null` 表示「还没测到」（pending），
 * 界面据此显示灰字，而不是把「没测」当成「达标」。
 */
export function archivePerformanceChecks({ firstPaint, paging, scrollFps, thumbnails } = {}) {
  const rows = [];
  const push = (id, row) => rows.push({
    id,
    label: ARCHIVE_PERF_CHECK_LABELS[id],
    ok: row.ok,
    value: row.value,
    budget: row.budget,
    text: row.text,
    detail: row.detail || ''
  });
  push('first-paint', firstPaint
    ? evaluateArchiveFirstPaint(firstPaint)
    : { ok: null, value: '', budget: formatArchivePerfMs(ARCHIVE_FIRST_PAINT_BUDGET_MS), text: `时间线首屏渲染：进入成长档案后测量（预算 ${formatArchivePerfMs(ARCHIVE_FIRST_PAINT_BUDGET_MS)}）` });
  push('page', paging
    ? evaluateArchivePaging(paging)
    : { ok: null, value: '', budget: `≤ ${ARCHIVE_TIMELINE_PAGE_SIZE}`, text: `超过 ${ARCHIVE_TIMELINE_PAGE_SIZE} 条的分页：时间线渲染后测量` });
  push('scroll-fps', scrollFps
    ? evaluateArchiveScrollFps(scrollFps)
    : { ok: null, value: '', budget: `${ARCHIVE_SCROLL_MIN_FPS}fps`, text: `滚动帧率：滚动一次时间线后测量（不低于 ${ARCHIVE_SCROLL_MIN_FPS}fps）` });
  push('thumb', thumbnails
    ? evaluateArchiveThumbnails(thumbnails)
    : { ok: null, value: '', budget: `≤ ${ARCHIVE_THUMB_MAX_EDGE}px`, text: `缩略图与懒加载：卡片进入视口后按需生成（长边 ≤ ${ARCHIVE_THUMB_MAX_EDGE}px）` });
  const measured = rows.filter(row => row.ok !== null);
  const allOk = measured.length === rows.length && measured.every(row => row.ok);
  return {
    rows,
    measured: measured.length,
    total: rows.length,
    allOk,
    summary: measured.length === rows.length
      ? `四项性能检查${allOk ? '全部达标' : '有超标项'}`
      : `性能检查已测 ${measured.length}/${rows.length} 项`
  };
}
