// 单作品海报的渲染与导出（[海报 US-303] / FR-308、FR-312、FR-313）。
//
// 这一层只做三件事，**不做任何版式判断**（版式与内容规则全在 `data/posterSingle.js`）：
//   ① 预览：`renderPosterSingle(plan)` → 同一个 `renderPoster`、`scale = 1`（1080×1440）；
//   ② 导出：`exportPosterSinglePng(plan)` → 同一个 `renderPoster`、`scale = 2`（2160×2880）
//      —— 预览与导出是同一次绘制的两种分辨率，不存在「预览一套、导出一套」（FR-312）；
//   ③ 导出门：`posterSingleExportGate()` 说不行就不下载（作品缺失时提示验收原文
//      「作品尚未同步完成」），并如实回报失败原因，绝不「先下载一张空图再说」。
//
// 素材地址与坏素材的处理都在渲染引擎里（`services/poster.js`）：解码失败只让那一支消失、
// 整张海报照样出图；本模块因此不 try/catch 渲染结果，只判「有没有 Blob」。

import { posterSingleExportGate, posterSingleFilename } from '../data/posterSingle';
import { renderPoster } from './poster';

/** 预览倍数（逻辑画布 1080×1440 → 预览图 1080×1440）。 */
export const POSTER_SINGLE_PREVIEW_SCALE = 1;
/** 导出倍数（→ 2160×2880，仍在 canvas 单边上限 4096 之内）。 */
export const POSTER_SINGLE_EXPORT_SCALE = 2;
/** 渲染没出图时的可读原因（导出回执与面板提示读同一句）。 */
export const POSTER_SINGLE_RENDER_FAILED_TEXT = '海报没有渲染成功：请检查网络或换一张模板后重试。';

/**
 * 渲染一张单作品海报（预览与导出共用）。`plan` 来自 `buildPosterSinglePlan()`。
 * `type` / `quality` 是编码档（缺省 PNG；导出 JPG 时传 `POSTER_MIME_JPEG` + 0.9）。
 * 返回 `renderPoster` 的完整结果（`{ blob, dataURL, canvas, plan, warnings, … }`）；
 * 没有记录 / 没有 canvas 能力时返回 `null`（调用方自己决定怎么降级）。
 */
export async function renderPosterSingle(plan, { scale = POSTER_SINGLE_PREVIEW_SCALE, type, quality } = {}) {
  const value = plan && typeof plan === 'object' ? plan : null;
  if (!value || !value.hasRecord || !value.spec) return null;
  return renderPoster({ spec: value.spec, data: value.data, scale, type, quality });
}

/** 预览用的地址（object URL，用完必须 `releasePosterSingleUrl` 回收）。 */
export function createPosterSingleUrl(rendered) {
  return rendered && rendered.blob ? URL.createObjectURL(rendered.blob) : '';
}

export function releasePosterSingleUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

/**
 * 常规浏览器的下载（与装裱导出同一支写法：`<a download>` + 延后回收 object URL）。
 * iOS Safari / 微信内置浏览器的降级路径（长按保存）属 US-311a，这里只做桌面路径。
 */
export function downloadPosterSingleBlob(blob, filename) {
  if (!blob || typeof document === 'undefined') return '';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 立刻 revoke 会让下载拿到空文件，所以延后回收（与 `downloadArtworkExport` 同一条注释）。
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return filename;
}

/**
 * 导出 PNG：先过导出门（作品缺失 → 不下载，原因用验收原文），再渲染 2× 并下载。
 * 返回 `{ ok, reason, filename, bytes, mimeType, warnings, rendered }`：
 * 失败时 `ok: false` 且 `reason` 可读，界面直接渲染它（别自己拼一句）。
 */
export async function exportPosterSinglePng(plan, { scale = POSTER_SINGLE_EXPORT_SCALE, filename = '' } = {}) {
  const gate = posterSingleExportGate(plan);
  if (!gate.allowed) return { ok: false, reason: gate.reason, filename: '', bytes: 0, mimeType: '', warnings: [], rendered: null };
  const rendered = await renderPosterSingle(plan, { scale });
  if (!rendered || !rendered.blob) {
    return { ok: false, reason: POSTER_SINGLE_RENDER_FAILED_TEXT, filename: '', bytes: 0, mimeType: '', warnings: [], rendered: rendered || null };
  }
  const name = filename || posterSingleFilename({
    student: plan.studentName,
    artworkTitle: plan.artworkTitle,
    date: plan.date
  });
  downloadPosterSingleBlob(rendered.blob, name);
  return {
    ok: true,
    reason: '',
    filename: name,
    bytes: rendered.blob.size,
    mimeType: rendered.mimeType || 'image/png',
    warnings: rendered.warnings || [],
    rendered
  };
}
