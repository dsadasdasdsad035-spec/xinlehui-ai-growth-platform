// 阶段成长海报的渲染与导出（[海报 US-304] / FR-308、FR-312）。
//
// 与 `services/posterSingle.js` 同一条分工，**不做任何版式判断**（版式与内容规则全在
// `data/posterPeriod.js`）：
//   ① 预览：`renderPosterPeriod(plan)` → 同一个 `renderPoster`、`scale = 1`（1080×1920）；
//   ② 导出：`exportPosterPeriodPng(plan)` → 同一个 `renderPoster`、`scale = 2`（2160×3840）
//      —— 预览与导出是同一次绘制的两种分辨率，不存在「预览一套、导出一套」（FR-312）；
//   ③ 导出门：`posterPeriodExportGate()` 说不行就不下载（没有可收录的作品时给可读原因），
//      绝不「先下载一张空图再说」。
//
// 素材地址与坏素材的处理都在渲染引擎里（`services/poster.js`）：一格解码失败只让那一格消失、
// 整张海报照样出图；本模块因此不 try/catch 渲染结果，只判「有没有 Blob」。

import { posterPeriodExportGate, posterPeriodFilename } from '../data/posterPeriod';
import { renderPoster } from './poster';
// 下载那一支与单作品海报**共用**（`<a download>` + 延后回收 object URL 的注释与理由都写在那边），
// 别为了改个名字再写第二份。
import { downloadPosterSingleBlob as downloadPosterBlob } from './posterSingle';

/** 预览倍数（逻辑画布 1080×1920 → 预览图 1080×1920）。 */
export const POSTER_PERIOD_PREVIEW_SCALE = 1;
/** 导出倍数（→ 2160×3840，仍在 canvas 单边上限 4096 之内）。 */
export const POSTER_PERIOD_EXPORT_SCALE = 2;
/** 渲染没出图时的可读原因（导出回执与面板提示读同一句）。 */
export const POSTER_PERIOD_RENDER_FAILED_TEXT = '海报没有渲染成功：请检查网络或换一张模板后重试。';

/**
 * 渲染一张阶段成长海报（预览与导出共用）。`plan` 来自 `buildPosterPeriodPlan()`。
 * `type` / `quality` 是编码档（缺省 PNG；导出 JPG 时传 `POSTER_MIME_JPEG` + 0.9）。
 * 返回 `renderPoster` 的完整结果（`{ blob, dataURL, canvas, plan, warnings, … }`）；
 * 没有学员 / 没有 canvas 能力时返回 `null`（调用方自己决定怎么降级）。
 */
export async function renderPosterPeriod(plan, { scale = POSTER_PERIOD_PREVIEW_SCALE, type, quality } = {}) {
  const value = plan && typeof plan === 'object' ? plan : null;
  if (!value || !value.hasStudent || !value.spec) return null;
  return renderPoster({ spec: value.spec, data: value.data, scale, type, quality });
}

/** 预览用的地址（object URL，用完必须 `releasePosterPeriodUrl` 回收）。 */
export function createPosterPeriodUrl(rendered) {
  return rendered && rendered.blob ? URL.createObjectURL(rendered.blob) : '';
}

export function releasePosterPeriodUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

/**
 * 导出 PNG：先过导出门（没有可收录的作品 → 不下载，原因可读），再渲染 2× 并下载。
 * 返回 `{ ok, reason, filename, bytes, mimeType, warnings, rendered }`：
 * 失败时 `ok: false` 且 `reason` 可读，界面直接渲染它（别自己拼一句）。
 */
export async function exportPosterPeriodPng(plan, { scale = POSTER_PERIOD_EXPORT_SCALE, filename = '' } = {}) {
  const gate = posterPeriodExportGate(plan);
  if (!gate.allowed) return { ok: false, reason: gate.reason, filename: '', bytes: 0, mimeType: '', warnings: [], rendered: null };
  const rendered = await renderPosterPeriod(plan, { scale });
  if (!rendered || !rendered.blob) {
    return { ok: false, reason: POSTER_PERIOD_RENDER_FAILED_TEXT, filename: '', bytes: 0, mimeType: '', warnings: [], rendered: rendered || null };
  }
  const name = filename || posterPeriodFilename({
    student: plan.studentName,
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
