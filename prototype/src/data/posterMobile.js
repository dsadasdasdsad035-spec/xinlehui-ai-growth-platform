// 海报的移动端与导出性能（[海报 US-314] / FR-361、FR-363 ~ FR-366）。
//
// 这一份只放**规则**（零依赖纯函数 + 常量，可 `node` 直跑断言）；浏览器侧的执行在
// `services/posterMobile.js`（让出主线程 / 阻塞探针）与 `services/framingPerformance.js`
// （内存采样器：全仓一份 —— 装裱的「内存峰值 ≤300MB」与这里读同一支采样，也读同一个上限）。
//
// 五件事，每件一份真源：
//   ① 390px 验收宽度与窄屏口径（`posterNarrowView()`，断点复用装裱的 800px —— CSS 里同值）；
//   ② 四条预算：首张预览 ≤3 秒（FR-361，与弹窗那一支共用 `POSTER_DIALOG_FIRST_PREVIEW_BUDGET_MS`）、
//      报告长图渲染 ≤1.5 秒（FR-363）、导出内存峰值 ≤300MB（FR-364，复用装裱的内存上限）、
//      导出期间单次阻塞 ≤1 秒（FR-365）；
//   ③ 预览缩放（FR-366）：档位 + 步进 / 夹取 + 读数（`posterPreviewZoomView()`）—— 100% = 与预览像素 1:1；
//   ④ 导出进度（FR-365）：`posterExportProgressView()` 把「第几张 / 哪一步」翻成百分比与一句可读提示；
//   ⑤ 四项读数：`posterMobilePerfChecks()` —— 界面、浏览器断言与验收原文读同一份结论。
//
// 纪律（与 `data/framingPerformance.js` / `data/posterDialog.js` 同源）：
//   - `null` = **还没测到**，面板写「待测」，绝不写成 0（`Number(null)` 是 0，会把「还没测」读成「达标」）；
//   - 阈值只在这一份里出现，界面与断言都不抄数字；
//   - 这一层不碰 DOM / 不碰 canvas / 不碰计时器。

import { POSTER_DIALOG_FIRST_PREVIEW_BUDGET_MS } from './posterDialog';
import {
  FRAMING_MEMORY_BUDGET_MB,
  MOBILE_PROFILE_MAX_WIDTH,
  MOBILE_STUDIO_WIDTH,
  formatPerfMs,
  framingDeviceProfile
} from './framingPerformance';

/** 验收使用的手机宽度（390px）——与装裱 / 档案共用同一个数。 */
export const POSTER_MOBILE_WIDTH = MOBILE_STUDIO_WIDTH;

/** 窄屏断点：模板列表变横向滑动条、预览控件吃到 44px 的那一档（CSS 的 `@media(max-width:800px)` 同值）。 */
export const POSTER_NARROW_MAX_WIDTH = MOBILE_PROFILE_MAX_WIDTH;

/** 首张预览渲染预算（FR-361：≤3 秒；弹窗那一支已经立过，这里只 re-export，别抄第二份 3000）。 */
export const POSTER_PREVIEW_BUDGET_MS = POSTER_DIALOG_FIRST_PREVIEW_BUDGET_MS;
/** 报告长图渲染预算（FR-363 原文：≤1.5 秒）。 */
export const POSTER_LONG_RENDER_BUDGET_MS = 1500;
/** 导出内存峰值上限（FR-364 原文：≤300MB）——与装裱共用同一个上限。 */
export const POSTER_EXPORT_MEMORY_BUDGET_MB = FRAMING_MEMORY_BUDGET_MB;
/** 导出期间单次阻塞上限（FR-365 原文：不得阻塞交互超过 1 秒）。 */
export const POSTER_EXPORT_BLOCK_BUDGET_MS = 1000;

/** 四项读数的清单（界面顺序、`data-poster-mobile-perf-row` 的 id 都读它）。 */
export const POSTER_MOBILE_PERF_CHECK_IDS = ['first-preview', 'long-render', 'memory', 'block'];

export const POSTER_MOBILE_PERF_CHECK_LABELS = {
  'first-preview': '首张预览渲染',
  'long-render': '长图渲染',
  memory: '导出内存峰值',
  block: '导出最长阻塞'
};

/** 面板整块的说明（一句话讲清四项读数分别对应哪条验收）。 */
export const POSTER_MOBILE_PERF_HINT = `四项读数：首张预览 ≤ ${POSTER_PREVIEW_BUDGET_MS}ms（1080×1440）、报告长图渲染 ≤ ${POSTER_LONG_RENDER_BUDGET_MS}ms、导出内存峰值 ≤ ${POSTER_EXPORT_MEMORY_BUDGET_MB}MB、导出期间单次阻塞 ≤ ${POSTER_EXPORT_BLOCK_BUDGET_MS}ms（导出时按张报进度，不让一次长任务霸住界面）。`;

/** 读不到内存时的如实说法（`performance.memory` 是 Chromium 扩展，别编一个数字）。 */
export const POSTER_MEMORY_UNSUPPORTED_TEXT = '这个浏览器没有 performance.memory（Chromium 扩展），内存峰值读不到。';

/**
 * 窄屏口径（FR-366 的 390px 那条）：`width` 是当前视口宽度。
 * 判据只有一条 —— 视口 ≤ `POSTER_NARROW_MAX_WIDTH`（800px），与 CSS 的断点、与「模板列表横向滑动」
 * 的媒体查询同值；390px 自然命中。
 */
export function posterNarrowView(viewportWidth = 0) {
  const width = Math.max(0, Math.round(Number(viewportWidth) || 0));
  const narrow = width > 0 && width <= POSTER_NARROW_MAX_WIDTH;
  return {
    width,
    maxWidth: POSTER_NARROW_MAX_WIDTH,
    acceptanceWidth: POSTER_MOBILE_WIDTH,
    narrow,
    atAcceptanceWidth: width > 0 && width <= POSTER_MOBILE_WIDTH,
    row: narrow ? '横向滑动条' : '左栏列表',
    text: width > 0
      ? `视口 ${width}px：${narrow ? `≤ ${POSTER_NARROW_MAX_WIDTH}px，模板列表是横向滑动条、预览可缩放` : `> ${POSTER_NARROW_MAX_WIDTH}px，模板列表是左栏竖列`}（390px 验收宽度）。`
      : '还没量到视口宽度：模板列表与预览缩放在窄屏下自动切换。'
  };
}

/** 手机口径（预算按设备分档时用；这里复用装裱那一支，别写第二份 UA 正则）。 */
export function posterDeviceProfile({ userAgent = '', maxTouchPoints = 0, viewportWidth = 0 } = {}) {
  return framingDeviceProfile({ userAgent, maxTouchPoints, viewportWidth });
}

// ---------------------------------------------------------------------------
// 预览缩放（FR-366：390px 下「预览可缩放查看」）
// ---------------------------------------------------------------------------

/**
 * 缩放档位（百分比，相对**预览图自己的像素**）：100% = 与 1080 宽的预览像素 1:1
 * （手机上看细节的那一档）；再往上只是把同一张图拉大，所以最大到 300%。
 * `0` 不是档位，是「适应屏幕」（等比缩进框里，弹窗打开时的默认档）。
 */
export const POSTER_PREVIEW_ZOOM_STEPS = [50, 100, 150, 200, 300];
/** `0` = 适应屏幕（等比缩进框里）。 */
export const POSTER_PREVIEW_FIT_PERCENT = 0;
/** 「放大到看得清」的默认档：100% = 与预览像素 1:1。 */
export const POSTER_PREVIEW_ZOOM_DEFAULT_PERCENT = 100;
export const POSTER_PREVIEW_FIT_LABEL = '适应屏幕';
export const POSTER_PREVIEW_ZOOM_IN_LABEL = '放大';
export const POSTER_PREVIEW_ZOOM_OUT_LABEL = '缩小';
export const POSTER_PREVIEW_ZOOM_NOTE = '放大到 100% = 与预览像素 1:1（看细节用）；缩放只改这一块显示，不改导出文件。';

/** 档位表（`slice` 出去：界面 / 断言都不该改到这一份常量）。 */
export function posterPreviewZoomSteps() {
  return POSTER_PREVIEW_ZOOM_STEPS.slice();
}

/** 把任意数值夹到档位上（老状态 / 手改的值也能用；`≤0` 一律按「适应屏幕」）。 */
export function posterPreviewZoomPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent <= POSTER_PREVIEW_FIT_PERCENT) return POSTER_PREVIEW_FIT_PERCENT;
  if (POSTER_PREVIEW_ZOOM_STEPS.includes(percent)) return percent;
  return POSTER_PREVIEW_ZOOM_STEPS.reduce((best, item) => (Math.abs(item - percent) < Math.abs(best - percent) ? item : best), POSTER_PREVIEW_ZOOM_STEPS[0]);
}

/**
 * 步进一步：`direction = 'in' | 'out'`。
 * 规则：适应屏幕 → 放大走到 100%（1:1）；最小档再缩小 = 回到适应屏幕；到顶就停在顶（不绕回）。
 */
export function posterPreviewZoomStep(percent, direction) {
  const current = posterPreviewZoomPercent(percent);
  const dir = direction === 'out' ? -1 : 1;
  if (current === POSTER_PREVIEW_FIT_PERCENT) return dir > 0 ? POSTER_PREVIEW_ZOOM_DEFAULT_PERCENT : POSTER_PREVIEW_FIT_PERCENT;
  const index = POSTER_PREVIEW_ZOOM_STEPS.indexOf(current);
  const next = index + dir;
  if (next < 0) return POSTER_PREVIEW_FIT_PERCENT;
  if (next >= POSTER_PREVIEW_ZOOM_STEPS.length) return POSTER_PREVIEW_ZOOM_STEPS[POSTER_PREVIEW_ZOOM_STEPS.length - 1];
  return POSTER_PREVIEW_ZOOM_STEPS[next];
}

/**
 * 缩放读数（界面只渲染它，不自己算宽度）。`width` / `height` = 这一次预览渲染的真实像素
 * （预览 1× 时是 1080×1440 / 1080×1920 / 长图 1080×N）；`cssWidth` = 这一档在页面上要占的像素宽度
 * （适应屏幕时是 0 —— 那一档交给 CSS 的 `max-width:100%` 自己等比缩）。
 */
export function posterPreviewZoomView({ percent = 0, width = 0, height = 0 } = {}) {
  const current = posterPreviewZoomPercent(percent);
  const sourceWidth = Math.max(0, Math.round(Number(width) || 0));
  const sourceHeight = Math.max(0, Math.round(Number(height) || 0));
  const index = POSTER_PREVIEW_ZOOM_STEPS.indexOf(current);
  const zoomed = current > POSTER_PREVIEW_FIT_PERCENT && sourceWidth > 0;
  const min = POSTER_PREVIEW_ZOOM_STEPS[0];
  const max = POSTER_PREVIEW_ZOOM_STEPS[POSTER_PREVIEW_ZOOM_STEPS.length - 1];
  return {
    percent: current,
    mode: current > POSTER_PREVIEW_FIT_PERCENT ? 'zoom' : 'fit',
    zoomed,
    // 适应屏幕那一档是 0（界面把它显示成「适应屏幕」而不是「0%」）。
    label: current > POSTER_PREVIEW_FIT_PERCENT ? `${current}%` : POSTER_PREVIEW_FIT_LABEL,
    fit: current === POSTER_PREVIEW_FIT_PERCENT,
    atPixelPerfect: current === POSTER_PREVIEW_ZOOM_DEFAULT_PERCENT,
    min,
    max,
    steps: posterPreviewZoomSteps(),
    canZoomIn: current <= POSTER_PREVIEW_FIT_PERCENT ? true : index < POSTER_PREVIEW_ZOOM_STEPS.length - 1,
    canZoomOut: current > POSTER_PREVIEW_FIT_PERCENT,
    // 这一档在页面上占多少像素宽（0 = 交给 CSS 等比缩）；高度按同一比例给，供断言核对。
    cssWidth: zoomed ? Math.max(1, Math.round((sourceWidth * current) / 100)) : 0,
    cssHeight: zoomed ? Math.max(1, Math.round((sourceHeight * current) / 100)) : 0,
    sourceWidth,
    sourceHeight,
    note: POSTER_PREVIEW_ZOOM_NOTE
  };
}

// ---------------------------------------------------------------------------
// 导出进度（FR-365：导出大图时显示进度提示）
// ---------------------------------------------------------------------------

/** 每一张图两步：渲染（画 + 编码）→ 存下（下载 / 交回界面长按保存）。 */
export const POSTER_EXPORT_PROGRESS_STEPS_PER_PAGE = 2;

/**
 * 服务层 `onProgress` 报的六个阶段 → 界面上那句提示。
 * `stage` 是**这张图内部**的进度（0 起步、2 收尾），百分比由它折算 —— 多张（班级分批 / 长图分段）时按张累加。
 */
export const POSTER_EXPORT_PROGRESS_PHASES = {
  start: { stage: 0, text: '正在准备导出…' },
  rendering: { stage: 1, text: '正在渲染要发出去的那一张（画布 + 编码）…' },
  saved: { stage: 2, text: '这一张已写入下载' },
  ready: { stage: 2, text: '这一张已出图：长按图片保存到相册' },
  blocked: { stage: 2, text: '这一张被导出前校验拦下' },
  failed: { stage: 2, text: '这一张没有渲染成功' },
  done: { stage: 2, text: '导出完成' }
};

/**
 * 进度读数：`{ on, phase, percent, done, step, total, label }`。
 * `percent` 只由「第几张 + 这张走到哪一步」折算（不掺时间，所以不会卡在 99% 不动——每张都会走到 100%）。
 */
export function posterExportProgressView({ index = 0, total = 0, phase = '', filename = '' } = {}) {
  const pages = Math.max(0, Math.trunc(Number(total) || 0));
  const page = Math.max(0, Math.trunc(Number(index) || 0));
  const id = POSTER_EXPORT_PROGRESS_PHASES[phase] ? phase : '';
  if (!id && !filename) return { on: false, phase: '', percent: 0, done: false, step: 0, total: pages, page, label: '', filename: '' };
  const done = id === 'done';
  const units = Math.max(1, pages * POSTER_EXPORT_PROGRESS_STEPS_PER_PAGE);
  const stage = id ? POSTER_EXPORT_PROGRESS_PHASES[id].stage : 0;
  const finished = done ? units : Math.min(units, Math.max(0, (Math.max(1, page) - 1) * POSTER_EXPORT_PROGRESS_STEPS_PER_PAGE + stage));
  const percent = done ? 100 : Math.round((finished / units) * 100);
  const text = id ? POSTER_EXPORT_PROGRESS_PHASES[id].text : '';
  const head = pages > 1 && !done ? `第 ${Math.max(1, page)}/${pages} 张 · ` : '';
  return {
    on: true,
    phase: id || 'rendering',
    percent,
    done,
    step: finished,
    total: units,
    page: Math.max(1, page),
    pages,
    filename: String(filename || ''),
    label: `${head}${text}（${percent}%）`
  };
}

// ---------------------------------------------------------------------------
// 四项读数（界面 / 浏览器断言 / 验收原文读同一份结论）
// ---------------------------------------------------------------------------

const ms = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
};

const bytes = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
};

/**
 * 四项读数：**结论只在数据层算**（界面只渲染 `value` / `budget` / `ok` / `text`）。
 * `ok === null` = 还没测到（面板写「待测」）；`memory` 那一行的 `supported` 为假时如实写
 * 「读不到 performance.memory」，不写成 0MB 达标。
 */
export function posterMobilePerfChecks({ firstPreviewMs = null, longRenderMs = null, memoryBytes = null, blockMs = null } = {}) {
  const first = ms(firstPreviewMs);
  const long = ms(longRenderMs);
  const memory = bytes(memoryBytes);
  const block = ms(blockMs);
  const memoryMb = memory === null ? null : Math.round(memory / (1024 * 1024));
  const memorySupported = memory !== null;
  const rows = [
    {
      id: 'first-preview',
      label: POSTER_MOBILE_PERF_CHECK_LABELS['first-preview'],
      value: first === null ? '' : formatPerfMs(first),
      budget: `≤ ${formatPerfMs(POSTER_PREVIEW_BUDGET_MS)}`,
      ok: first === null ? null : first <= POSTER_PREVIEW_BUDGET_MS,
      text: first === null
        ? '待测：打开弹窗（或换一次模板）后给出读数'
        : (first <= POSTER_PREVIEW_BUDGET_MS ? '打开弹窗到首张出图，达标' : '首张预览超预算：先出图再补缩略图，别让它带更多活')
    },
    {
      id: 'long-render',
      label: POSTER_MOBILE_PERF_CHECK_LABELS['long-render'],
      value: long === null ? '' : formatPerfMs(long),
      budget: `≤ ${formatPerfMs(POSTER_LONG_RENDER_BUDGET_MS)}`,
      ok: long === null ? null : long <= POSTER_LONG_RENDER_BUDGET_MS,
      text: long === null
        ? '待测：选一套成长报告长图后给出读数'
        : (long <= POSTER_LONG_RENDER_BUDGET_MS ? '报告长图渲染达标（高度仍受 canvas 单边上限保护）' : '长图渲染超预算：先降 DPI / 分段，别让一张长图把手机拖住')
    },
    {
      id: 'memory',
      label: POSTER_MOBILE_PERF_CHECK_LABELS.memory,
      value: memoryMb === null ? '' : `${memoryMb}MB`,
      budget: `≤ ${POSTER_EXPORT_MEMORY_BUDGET_MB}MB`,
      ok: memoryMb === null ? null : memoryMb <= POSTER_EXPORT_MEMORY_BUDGET_MB,
      supported: memorySupported,
      text: memoryMb === null
        ? `待测：导出一次后给出读数（${POSTER_MEMORY_UNSUPPORTED_TEXT}）`
        : (memoryMb <= POSTER_EXPORT_MEMORY_BUDGET_MB ? '导出这一次的内存峰值在预算内（iOS Safari 不会因为这一张被回收）' : '内存峰值超预算：导出路径已经不产 base64 副本了，进一步要降导出倍数或分批')
    },
    {
      id: 'block',
      label: POSTER_MOBILE_PERF_CHECK_LABELS.block,
      value: block === null ? '' : formatPerfMs(block),
      budget: `≤ ${formatPerfMs(POSTER_EXPORT_BLOCK_BUDGET_MS)}`,
      ok: block === null ? null : block <= POSTER_EXPORT_BLOCK_BUDGET_MS,
      text: block === null
        ? '待测：导出一次后给出读数'
        : (block <= POSTER_EXPORT_BLOCK_BUDGET_MS ? '导出期间没有超过 1 秒的阻塞（阶段之间让出主线程）' : '导出期间有一次超过 1 秒的阻塞：把这一张拆小或换成 JPG（编码更便宜）')
    }
  ];
  const measured = rows.filter((item) => item.ok !== null);
  return {
    rows,
    measured: measured.length,
    total: rows.length,
    allOk: measured.length ? rows.every((item) => item.ok !== false) : null,
    memorySupported,
    summary: measured.length
      ? rows.filter((item) => item.ok !== null).map((item) => `${item.label} ${item.value}`).join(' · ')
      : '待测：打开弹窗、选一次长图并导出一次后给出四项读数'
  };
}

/** 一句可读的行内结论（导出回执旁边那行小字用；缺读数时不写数字、只说怎么量）。 */
export function posterMobilePerfLine(checks) {
  const value = checks && typeof checks === 'object' ? checks : null;
  if (!value || !Array.isArray(value.rows)) return '';
  const parts = value.rows
    .filter((row) => row.ok !== null)
    .map((row) => `${row.label} ${row.value} / ${row.budget}${row.ok ? '' : '（超标）'}`);
  return parts.length ? parts.join(' · ') : '导出后这里会给出内存峰值与最长阻塞两项读数。';
}
