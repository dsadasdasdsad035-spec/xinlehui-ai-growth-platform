// 成长报告长图海报的渲染与导出（[海报 US-307] / FR-308、FR-312、FR-317）。
//
// 与 `services/posterSingle.js` / `posterPeriod.js` / `posterClass.js` / `posterVideoCover.js`
// 同一条分工，**不做任何版式判断**（分段、高度自适应、降级档位与文件名全在 `data/posterReportLong.js`）：
//   ① 预览：`renderPosterReport(plan, { pageIndex })` → 同一个 `renderPoster`、`scale = 1`；
//   ② 导出：`exportPosterReportPng(plan, { pageIndex })` → 同一个 `renderPoster`，
//      倍数**读数据层的 `degrade.exportScale`**（不降级 2×、降 DPI 后 1×）——
//      「先降 DPI」因此是数据层的决定，这里不自己判一遍；
//   ③ 分段出多张：`exportPosterReportPages(plan)` 逐张渲染下载，文件名带页码（`…_长图_1of3.png`），
//      某一张失败只进 `failures`，不影响其它张（与班级分批出图同一条纪律）。
//
// 素材地址与坏素材的处理都在渲染引擎里（`services/poster.js`）：一格解码失败只让那一格消失、
// 整张长图照样出图；本模块因此不 try/catch 渲染结果，只判「有没有 Blob」。

import { posterReportExportGate } from '../data/posterReportLong';
import { renderPoster } from './poster';
// 下载那一支与其它海报**共用**（`<a download>` + 延后回收 object URL 的理由都写在那边），
// 别为了改个名字再写第二份。批间隔也复用班级分批出图那一个常量（浏览器对连续下载有节流）。
import { downloadPosterSingleBlob as downloadPosterBlob } from './posterSingle';
import { POSTER_CLASS_BATCH_DOWNLOAD_GAP_MS } from './posterClass';

/** 预览倍数（逻辑画布 1080×自适应高 → 预览图 1×；长图预览永远是 1×，否则会撞 canvas 单边上限）。 */
export const POSTER_REPORT_PREVIEW_SCALE = 1;
/** 张与张之间的下载间隔（毫秒）：与班级分批出图共用同一份理由。 */
export const POSTER_REPORT_PAGE_DOWNLOAD_GAP_MS = POSTER_CLASS_BATCH_DOWNLOAD_GAP_MS;
/** 渲染没出图时的可读原因（导出回执与面板提示读同一句）。 */
export const POSTER_REPORT_RENDER_FAILED_TEXT = '长图没有渲染成功：请检查网络或换一张模板后重试。';
/** 某一张没出图时的可读原因（界面按张列出，不糊成一句）。 */
export function posterReportPageFailedText(index) {
  return `第 ${Math.max(1, Math.trunc(Number(index) || 1))} 张没有渲染成功：这一张没有下载，其余张不受影响。`;
}

/**
 * 渲染长图的第 `pageIndex` 张（预览与导出共用）。`plan` 来自 `buildPosterReportLongPlan()`。
 * 返回 `renderPoster` 的完整结果（`{ blob, dataURL, canvas, plan, warnings, … }`）；
 * 没有学员 / 没有这一张 / 没有 canvas 能力时返回 `null`（调用方自己决定怎么降级）。
 */
export async function renderPosterReport(plan, { pageIndex = 0, scale = POSTER_REPORT_PREVIEW_SCALE } = {}) {
  const value = plan && typeof plan === 'object' ? plan : null;
  if (!value || !value.hasStudent) return null;
  const pages = Array.isArray(value.pages) ? value.pages : [];
  const index = Number.isFinite(Number(pageIndex)) && Number(pageIndex) > 0
    ? Math.min(Math.max(1, Math.trunc(Number(pageIndex))), Math.max(1, pages.length))
    : Math.max(1, Number(value.page && value.page.index) || 1);
  const page = pages[index - 1] || value.page || null;
  if (!page || !page.spec) return null;
  return renderPoster({ spec: page.spec, data: value.data, scale });
}

/** 预览用的地址（object URL，用完必须 `releasePosterReportUrl` 回收）。 */
export function createPosterReportUrl(rendered) {
  return rendered && rendered.blob ? URL.createObjectURL(rendered.blob) : '';
}

export function releasePosterReportUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

/** 导出倍数：读数据层的降级结论（不降级 2×、降 DPI / 分段后 1×）。 */
export function posterReportPageScale(plan, pageIndex = 0) {
  const value = plan && typeof plan === 'object' ? plan : {};
  const pages = Array.isArray(value.pages) ? value.pages : [];
  const index = Math.max(1, Math.trunc(Number(pageIndex) || 1));
  const page = pages[index - 1] || null;
  const scale = page && page.estimate ? Number(page.estimate.scale) : 0;
  if (Number.isFinite(scale) && scale > 0) return scale;
  const fallback = value.degrade ? Number(value.degrade.exportScale) : 0;
  return Number.isFinite(fallback) && fallback > 0 ? fallback : POSTER_REPORT_PREVIEW_SCALE;
}

/**
 * 导出长图的第 `pageIndex` 张 PNG：先过导出门（没有学员 / 这个周期没有归档记录 → 不下载，
 * 原因可读），再按数据层给的倍数渲染并下载（文件名取这一张的页码名）。
 * 返回 `{ ok, reason, filename, bytes, mimeType, warnings, rendered, page }`。
 */
export async function exportPosterReportPng(plan, { pageIndex = 0, filename = '' } = {}) {
  const gate = posterReportExportGate(plan);
  if (!gate.allowed) return { ok: false, reason: gate.reason, filename: '', bytes: 0, mimeType: '', warnings: [], rendered: null, page: null };
  const pages = Array.isArray(plan && plan.pages) ? plan.pages : [];
  const index = Math.max(1, Math.trunc(Number(pageIndex) || 1));
  const page = pages[index - 1] || null;
  if (!page) {
    return { ok: false, reason: POSTER_REPORT_RENDER_FAILED_TEXT, filename: '', bytes: 0, mimeType: '', warnings: [], rendered: null, page: null };
  }
  const rendered = await renderPosterReport(plan, { pageIndex: page.index, scale: posterReportPageScale(plan, page.index) });
  if (!rendered || !rendered.blob) {
    return { ok: false, reason: POSTER_REPORT_RENDER_FAILED_TEXT, filename: '', bytes: 0, mimeType: '', warnings: [], rendered: rendered || null, page };
  }
  const name = filename || pageFilename(plan, page);
  downloadPosterBlob(rendered.blob, name);
  return {
    ok: true,
    reason: '',
    filename: name,
    bytes: rendered.blob.size,
    mimeType: rendered.mimeType || 'image/png',
    warnings: rendered.warnings || [],
    rendered,
    page: { index: page.index, total: page.total }
  };
}

function pageFilename(plan, page) {
  const next = plan && plan.pages && plan.pages[page.index - 1];
  if (next && next.filename) return next.filename;
  return '';
}

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, Math.max(0, Number(ms) || 0)); });
}

/**
 * 分段出多张：逐张渲染 → 下载，文件名带页码；某一张失败只记进 `failures`，不影响其它张。
 * 返回 `{ ok, total, count, filenames, failures, results }` —— 界面直接渲染这几个读数。
 */
export async function exportPosterReportPages(plan, {
  gapMs = POSTER_REPORT_PAGE_DOWNLOAD_GAP_MS,
  onProgress = null
} = {}) {
  const gate = posterReportExportGate(plan);
  if (!gate.allowed) {
    return { ok: false, reason: gate.reason, total: 0, count: 0, filenames: [], failures: [], results: [] };
  }
  const pages = Array.isArray(plan && plan.pages) ? plan.pages : [];
  const total = pages.length;
  const results = [];
  const failures = [];
  const filenames = [];
  for (let index = 1; index <= total; index += 1) {
    if (typeof onProgress === 'function') onProgress({ index, total, phase: 'rendering' });
    const result = await exportPosterReportPng(plan, { pageIndex: index });
    if (!result.ok) {
      const reason = result.reason || posterReportPageFailedText(index);
      failures.push({ index, reason });
      results.push({ ok: false, index, reason, filename: '', bytes: 0, warnings: [] });
      continue;
    }
    filenames.push(result.filename);
    results.push({ ok: true, index, reason: '', filename: result.filename, bytes: result.bytes, warnings: result.warnings });
    if (typeof onProgress === 'function') onProgress({ index, total, phase: 'downloaded', filename: result.filename });
    if (index < total) await wait(gapMs);
  }
  return {
    ok: failures.length === 0,
    reason: failures.length ? failures[0].reason : '',
    total,
    count: filenames.length,
    filenames,
    failures,
    results
  };
}
