// 海报导出的编排（[海报 US-311a] / FR-341 ~ FR-343、FR-348）的执行层。
//
// 这一层只做四件事，**规则与文案全在 `data/posterExport.js`**（零依赖，可 Node 直跑断言）：
//   ① 渲染：`renderPosterDialogExport()`（五类版式各自的导出倍数 + 编码档）——
//      与预览/缩略图同一支 `renderPoster`，不存在「预览一套、导出一套」（FR-312）；
//   ② 校验：`posterExportChecks()` 读**这一次渲染的产物**（素材 / 二维码 / 文字，FR-343），
//      没过就**不下这一张**（原因用数据层给的整句，界面直接渲染它）；
//   ③ 交付：`mode = 'download'` 走 `<a download>`（复用装裱导出的那一支，延后回收 object URL）；
//      `mode = 'longpress'`（iOS / 微信不执行 blob 下载）**不触发下载**，只把 blob 交回界面显示，
//      由界面给「长按保存」提示与（能的话）`navigator.share` 直接分享（FR-348）；
//   ④ 多张：班级分批 / 长图分段逐张走同一套「渲染 → 校验 → 交付」，某一张没过只记进 `skipped`。
//
// 三条纪律：
//   - **校验没过就一张字节都不给**（不「先下载再提示」）；
//   - 渲染失败与校验没过**分开记**（`renderFailed` 对 `blocked`），界面能把两件事分别说清；
//   - 多张之间留间隔（复用班级分批那一支常量）—— 浏览器对「一次点击触发多个下载」有节流。

import {
  POSTER_EXPORT_BLOCKED_TITLE,
  POSTER_EXPORT_DEFAULT_FORMAT,
  POSTER_EXPORT_SHARE_EMPTY_TEXT,
  posterExportBlockedText,
  posterExportChecks,
  posterExportFilename,
  posterExportFormat,
  posterExportPages
} from '../data/posterExport';
import { downloadArtworkExport } from './artworkExport';
import { renderPosterDialogExport } from './posterDialog';
import { POSTER_CLASS_BATCH_DOWNLOAD_GAP_MS } from './posterClass';

/** 渲染没出图时的可读原因（与五支 renderPosterX 的回执同一条口径）。 */
export const POSTER_EXPORT_RENDER_FAILED_TEXT = '海报没有渲染成功：请检查网络或换一张模板后重试。';

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, Math.max(0, Number(ms) || 0)); });
}

/**
 * 导出这一张海报（`plan` = 弹窗里选中且打过微调的那一份）。
 *
 * `download = true`（常规浏览器）：每张过了校验就 `<a download>` 落盘；
 * `download = false`（iOS Safari / 微信内置浏览器）：一张都不触发下载，把 blob 交回界面显示。
 *
 * 返回 `{ ok, blocked, reason, format, total, count, files, skipped, checks }`：
 *   - `files[]` = 真的交付出去的那几张（`{ pageIndex, pageTotal, filename, bytes, width, height, blob, … }`）；
 *   - `skipped[]` = 没交付的那几张（`{ pageIndex, blocked, renderFailed, reason, checks }`）；
 *   - `checks` = 第一张的校验读数（单张时就是唯一一张；界面与断言读它，不自己数一遍）。
 */
export async function exportPosterFiles(plan, {
  format = POSTER_EXPORT_DEFAULT_FORMAT,
  download = true,
  onProgress = null,
  gapMs = POSTER_CLASS_BATCH_DOWNLOAD_GAP_MS
} = {}) {
  const value = plan && typeof plan === 'object' ? plan : null;
  const entry = posterExportFormat(format);
  const formatView = { id: entry.id, label: entry.label, shortLabel: entry.shortLabel, extension: entry.extension, mimeType: entry.mimeType, quality: entry.quality };
  if (!value) {
    return { ok: false, blocked: false, reason: POSTER_EXPORT_RENDER_FAILED_TEXT, format: formatView, total: 0, count: 0, files: [], skipped: [], checks: null };
  }
  const gate = value.exportGate && typeof value.exportGate === 'object' ? value.exportGate : null;
  if (gate && gate.allowed === false) {
    // 导出门先说话（与 US-303~307 的面板同一条口径）：没有内容的图连渲染都不必做。
    return { ok: false, blocked: true, reason: gate.reason, format: formatView, total: 0, count: 0, files: [], skipped: [], checks: null };
  }

  const pages = posterExportPages(value);
  const files = [];
  const skipped = [];
  for (const page of pages) {
    if (typeof onProgress === 'function') onProgress({ ...page, phase: 'rendering' });
    // eslint-disable-next-line no-await-in-loop
    const rendered = await renderPosterDialogExport(value, { format: entry.id, pageIndex: page.index }).catch(() => null);
    if (!rendered || !rendered.blob) {
      skipped.push({ ...page, blocked: false, renderFailed: true, reason: POSTER_EXPORT_RENDER_FAILED_TEXT, checks: null });
      if (typeof onProgress === 'function') onProgress({ ...page, phase: 'failed' });
      continue;
    }
    const checks = posterExportChecks({ rendered, gate });
    if (!checks.ok) {
      skipped.push({ ...page, blocked: true, renderFailed: false, reason: posterExportBlockedText(checks) || POSTER_EXPORT_BLOCKED_TITLE, checks });
      if (typeof onProgress === 'function') onProgress({ ...page, phase: 'blocked' });
      continue;
    }
    const filename = posterExportFilename(value, { format: entry.id, pageIndex: page.index });
    if (download) downloadArtworkExport({ blob: rendered.blob, filename });
    files.push({
      ...page,
      filename,
      bytes: rendered.blob.size,
      width: rendered.width,
      height: rendered.height,
      mimeType: rendered.mimeType,
      quality: rendered.quality,
      blob: rendered.blob,
      checks
    });
    if (typeof onProgress === 'function') onProgress({ ...page, phase: download ? 'downloaded' : 'ready', filename });
    if (pages.length > 1) await wait(gapMs);
  }

  const first = files[0] || skipped[0] || null;
  return {
    ok: files.length > 0 && skipped.length === 0,
    blocked: skipped.length > 0 && skipped.every((item) => item.blocked),
    renderFailed: skipped.length > 0 && skipped.every((item) => item.renderFailed),
    reason: skipped.length ? skipped[0].reason : '',
    format: formatView,
    total: pages.length,
    count: files.length,
    files,
    skipped,
    checks: first ? first.checks : null,
    noRender: false
  };
}

/** 预览 / 长按保存用的地址（object URL，用完必须 `releasePosterExportUrl` 回收）。 */
export function createPosterExportUrl(blob) {
  return blob ? URL.createObjectURL(blob) : '';
}

export function releasePosterExportUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

/**
 * 系统分享（`navigator.share({ files })`）：iOS Safari 能直接调起，微信内置浏览器没有这个能力。
 * `canShareFiles()` 是判据的唯一入口（界面用它决定按不按得出「直接分享」这个按钮）；
 * 分享失败（用户取消 / 系统拒绝）返回可读原因，界面据此给「长按保存」的退路 —— 不谎报已分享。
 */
export function canSharePosterFiles() {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  if (typeof File !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([new Blob(['x'])], 'probe.png', { type: 'image/png' })] }) === true;
  } catch {
    return false;
  }
}

/**
 * 直接分享已导出的文件（`files` 来自 `exportPosterFiles`）。
 * 返回 `{ ok, reason, shared }`：`ok: false` 时原因可读（界面照常给长按保存的提示）。
 */
export async function sharePosterFiles(files = [], { title = '', text = '' } = {}) {
  const list = (Array.isArray(files) ? files : []).filter((item) => item && item.blob);
  if (!list.length) return { ok: false, shared: 0, reason: POSTER_EXPORT_SHARE_EMPTY_TEXT };
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof File !== 'function') {
    return { ok: false, shared: 0, reason: '这个浏览器不支持直接分享：长按图片保存到相册。' };
  }
  const payload = list.map((item) => new File([item.blob], item.filename, { type: item.mimeType || 'image/png' }));
  try {
    await navigator.share({ files: payload, title: title || payload[0].name, text: text || '' });
    return { ok: true, shared: payload.length, reason: '' };
  } catch (error) {
    const name = error && error.name ? String(error.name) : '';
    if (name === 'AbortError') return { ok: false, shared: 0, reason: '分享面板被关掉了（没有分享出去）：也可以长按图片保存到相册。' };
    return { ok: false, shared: 0, reason: '系统分享没成功：长按图片保存到相册后从相册分享。' };
  }
}
