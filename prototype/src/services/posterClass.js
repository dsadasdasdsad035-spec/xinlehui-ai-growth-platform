// 班级集体海报的渲染与导出（[海报 US-305] / FR-308、FR-312、FR-322）。
//
// 与 `services/posterSingle.js` / `services/posterPeriod.js` 同一条分工，**不做任何版式判断**
// （格子、网格、分批、占位与文件名规则全在 `data/posterClass.js`）：
//   ① 预览：`renderPosterClass(plan)` → 同一个 `renderPoster`、`scale = 1`（1080×1920）；
//   ② 导出：`exportPosterClassPng(plan)` → 同一个 `renderPoster`、`scale = 2`（2160×3840）
//      —— 预览与导出是同一次绘制的两种分辨率，不存在「预览一套、导出一套」（FR-312）；
//   ③ 分批：`exportPosterClassBatches(plan)` 按批重建 plan（`posterClassBatchPlan`，同一份上下文）
//      再逐批渲染下载，文件名带 `1of2` 页码 —— 不分批就出不了第 31 位学员（FR-322）。
//
// 素材地址与坏素材的处理都在渲染引擎里（`services/poster.js`）：一格解码失败只让那一格消失、
// 整张海报照样出图；本模块因此不 try/catch 渲染结果，只判「有没有 Blob」。

import { posterClassBatchPlan, posterClassExportGate } from '../data/posterClass';
import { renderPoster } from './poster';
// 下载那一支与单作品 / 阶段海报**共用**（`<a download>` + 延后回收 object URL 的理由都写在那边），
// 别为了改个名字再写第二份。
import { downloadPosterSingleBlob as downloadPosterBlob } from './posterSingle';

/** 预览倍数（逻辑画布 1080×1920 → 预览图 1080×1920）。 */
export const POSTER_CLASS_PREVIEW_SCALE = 1;
/** 导出倍数（→ 2160×3840，仍在 canvas 单边上限 4096 之内）。 */
export const POSTER_CLASS_EXPORT_SCALE = 2;
/** 渲染没出图时的可读原因（导出回执与面板提示读同一句）。 */
export const POSTER_CLASS_RENDER_FAILED_TEXT = '海报没有渲染成功：请检查网络或换一张模板后重试。';
/** 分批导出时某一批没出图的原因（界面按批列出，不糊成一句）。 */
export function posterClassBatchFailedText(index) {
  return `第 ${Math.max(1, Math.trunc(Number(index) || 1))} 批没有渲染成功：这一批没有下载，其余批次不受影响。`;
}
/**
 * 批次之间的间隔（毫秒）：浏览器对「一次点击触发多个下载」有节流，
 * 隔一下比连发两下更容易两张都落地。分批出图的张数本来就只有 2~3 张，这点等待可接受。
 */
export const POSTER_CLASS_BATCH_DOWNLOAD_GAP_MS = 120;

/**
 * 渲染一张班级作品墙海报（预览 / 导出 / 分批共用）。`plan` 来自 `buildPosterClassPlan()`。
 * `type` / `quality` 是编码档（缺省 PNG；导出 JPG 时传 `POSTER_MIME_JPEG` + 0.9）。
 * 返回 `renderPoster` 的完整结果（`{ blob, dataURL, canvas, plan, warnings, … }`）；
 * 没有班级 / 没有 canvas 能力时返回 `null`（调用方自己决定怎么降级）。
 */
// `encodeDataURL` 放在参数表**最前**是刻意的：US-101 的源码守卫认的是这段签名里的
// `type, quality }`（「五个 renderPosterX 都转发编码档」），新选项插到末尾会把那条老断言判红。
// 调顺序之前先看 /tmp/assert-us101.mjs 的 G5（导出档不产 dataURL 的理由见 `services/posterDialog.js`）。
export async function renderPosterClass(plan, { encodeDataURL, scale = POSTER_CLASS_PREVIEW_SCALE, type, quality } = {}) {
  const value = plan && typeof plan === 'object' ? plan : null;
  if (!value || !value.hasClass || !value.spec) return null;
  return renderPoster({ spec: value.spec, data: value.data, scale, type, quality, encodeDataURL });
}

/** 预览用的地址（object URL，用完必须 `releasePosterClassUrl` 回收）。 */
export function createPosterClassUrl(rendered) {
  return rendered && rendered.blob ? URL.createObjectURL(rendered.blob) : '';
}

export function releasePosterClassUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

/**
 * 导出当前这一批 PNG：先过导出门（没有班级 / 一个格子都数不出来 → 不下载，原因可读），
 * 再渲染 2× 并下载。返回 `{ ok, reason, filename, bytes, mimeType, warnings, rendered }`。
 */
export async function exportPosterClassPng(plan, { scale = POSTER_CLASS_EXPORT_SCALE, filename = '' } = {}) {
  const gate = posterClassExportGate(plan);
  if (!gate.allowed) return { ok: false, reason: gate.reason, filename: '', bytes: 0, mimeType: '', warnings: [], rendered: null };
  const rendered = await renderPosterClass(plan, { scale });
  if (!rendered || !rendered.blob) {
    return { ok: false, reason: POSTER_CLASS_RENDER_FAILED_TEXT, filename: '', bytes: 0, mimeType: '', warnings: [], rendered: rendered || null };
  }
  const name = filename || (plan.batch && plan.batch.filename) || '';
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

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, Math.max(0, Number(ms) || 0)); });
}

/**
 * 分批导出全部批次（FR-322 的「支持分批出图」）：逐批重建 plan → 渲染 → 下载，
 * 文件名带 `1of2` 页码；某一批失败只记进 `failures`，**不影响其它批次**。
 * 返回 `{ ok, total, count, filenames, failures, results }` —— 界面直接渲染这几个读数。
 */
export async function exportPosterClassBatches(plan, {
  scale = POSTER_CLASS_EXPORT_SCALE,
  onProgress = null,
  gapMs = POSTER_CLASS_BATCH_DOWNLOAD_GAP_MS
} = {}) {
  const gate = posterClassExportGate(plan);
  if (!gate.allowed) {
    return { ok: false, reason: gate.reason, total: 0, count: 0, filenames: [], failures: [], results: [] };
  }
  const total = Math.max(1, Number(plan.batch && plan.batch.total) || 1);
  const results = [];
  const failures = [];
  const filenames = [];
  for (let index = 1; index <= total; index += 1) {
    const batchPlan = posterClassBatchPlan(plan, index);
    if (typeof onProgress === 'function') onProgress({ index, total, phase: 'rendering' });
    const rendered = await renderPosterClass(batchPlan, { scale });
    if (!rendered || !rendered.blob) {
      const reason = posterClassBatchFailedText(index);
      failures.push({ index, reason });
      results.push({ ok: false, index, reason, filename: '', bytes: 0, warnings: [] });
      continue;
    }
    const name = (batchPlan && batchPlan.batch && batchPlan.batch.filename) || '';
    downloadPosterBlob(rendered.blob, name);
    filenames.push(name);
    results.push({
      ok: true,
      index,
      reason: '',
      filename: name,
      bytes: rendered.blob.size,
      warnings: rendered.warnings || []
    });
    if (typeof onProgress === 'function') onProgress({ index, total, phase: 'downloaded', filename: name });
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
