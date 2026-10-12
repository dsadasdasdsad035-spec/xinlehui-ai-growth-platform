// 成长视频封面海报的渲染与导出（[海报 US-306] / FR-308、FR-312、FR-316）。
//
// 与 `services/posterSingle.js` / `posterPeriod.js` / `posterClass.js` 同一条分工，
// **不做任何版式判断**（画布比例、四条叠加件、时长占位与导出门全在 `data/posterVideoCover.js`）：
//   ① 预览：`renderPosterVideoCover(plan)` → 同一个 `renderPoster`、`scale = 1`（1080×1920，与成长视频同比例）；
//   ② 导出：`exportPosterVideoCoverPng(plan)` → 同一个 `renderPoster`、`scale = 2`（2160×3840）
//      —— 预览与导出是同一次绘制的两种分辨率，不存在「预览一套、导出一套」（FR-312）；
//   ③ 导出门：`posterVideoCoverExportGate()` 说不行就不下载（成片还没产出 / 没有主视觉 / 没有对象
//      各给一句可读原因），绝不「先下载一张占位图再说」。
//
// 素材地址与坏素材的处理都在渲染引擎里（`services/poster.js`）：主视觉解码失败只让那一格消失、
// 整张封面照样出图；本模块因此不 try/catch 渲染结果，只判「有没有 Blob」。

import { posterVideoCoverExportGate, posterVideoCoverFilename } from '../data/posterVideoCover';
import { renderPoster } from './poster';
// 下载那一支与其它海报**共用**（`<a download>` + 延后回收 object URL 的理由都写在那边），
// 别为了改个名字再写第二份。
import { downloadPosterSingleBlob as downloadPosterBlob } from './posterSingle';

/** 预览倍数（逻辑画布 1080×1920 → 预览图 1080×1920）。 */
export const POSTER_VIDEO_COVER_PREVIEW_SCALE = 1;
/** 导出倍数（→ 2160×3840，仍在 canvas 单边上限 4096 之内）。 */
export const POSTER_VIDEO_COVER_EXPORT_SCALE = 2;
/** 渲染没出图时的可读原因（导出回执与面板提示读同一句）。 */
export const POSTER_VIDEO_COVER_RENDER_FAILED_TEXT = '封面没有渲染成功：请检查网络或换一张模板后重试。';

/**
 * 渲染一张成长视频封面（预览与导出共用）。`plan` 来自 `buildPosterVideoCoverPlan()`。
 * 返回 `renderPoster` 的完整结果（`{ blob, dataURL, canvas, plan, warnings, … }`）；
 * 没有对象 / 没有 canvas 能力时返回 `null`（调用方自己决定怎么降级）。
 */
export async function renderPosterVideoCover(plan, { scale = POSTER_VIDEO_COVER_PREVIEW_SCALE } = {}) {
  const value = plan && typeof plan === 'object' ? plan : null;
  if (!value || !value.hasObject || !value.spec) return null;
  return renderPoster({ spec: value.spec, data: value.data, scale });
}

/** 预览用的地址（object URL，用完必须 `releasePosterVideoCoverUrl` 回收）。 */
export function createPosterVideoCoverUrl(rendered) {
  return rendered && rendered.blob ? URL.createObjectURL(rendered.blob) : '';
}

export function releasePosterVideoCoverUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

/**
 * 导出 PNG：先过导出门（成片还没产出 → 不下载，原因可读），再渲染 2× 并下载。
 * 返回 `{ ok, reason, filename, bytes, mimeType, warnings, rendered }`。
 */
export async function exportPosterVideoCoverPng(plan, { scale = POSTER_VIDEO_COVER_EXPORT_SCALE, filename = '' } = {}) {
  const gate = posterVideoCoverExportGate(plan);
  if (!gate.allowed) return { ok: false, reason: gate.reason, filename: '', bytes: 0, mimeType: '', warnings: [], rendered: null };
  const rendered = await renderPosterVideoCover(plan, { scale });
  if (!rendered || !rendered.blob) {
    return { ok: false, reason: POSTER_VIDEO_COVER_RENDER_FAILED_TEXT, filename: '', bytes: 0, mimeType: '', warnings: [], rendered: rendered || null };
  }
  const name = filename || posterVideoCoverFilename({
    student: plan.objectName,
    period: plan.period
  });
  downloadPosterBlob(rendered.blob, name);
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
