// 海报弹窗的渲染（[海报 US-308] / FR-308、FR-312、FR-334）。
//
// **全仓只有一份海报渲染实现**：这一层不画任何像素，只把 `data/posterDialog.js` 装配出来的 plan
// 按 `kind` 交给对应的那一支渲染函数 —— 五支最终都走进同一个 `services/poster.js` 的 `renderPoster()`
// （FR-312：预览与导出同源、只差 `scale`）。预览 1×、缩略图 0.25×、导出 2× 都是同一支函数的不同倍数。
//
// 为什么要有这一层：弹窗的模板清单里混着五类版式，组件不该知道「哪一类用哪个渲染函数」
// （那是分派规则，属数据 / 服务侧）；US-309 的课后反馈入口复用同一支分派时也不会分叉出第二份。
//
// 三条纪律：
//   ① 渲染失败返回 `null`（与五个 renderPosterX 同一口径），界面渲染 `POSTER_DIALOG_RENDER_FAILED_TEXT`；
//   ② 单边上限 / 降级这类决定在数据层（长图的 `degrade.exportScale`），这里只传 `scale`；
//   ③ object URL 用完必须回收（`releasePosterDialogUrl`），换模板与关闭弹窗各回收一次。

import { POSTER_DIALOG_PREVIEW_SCALE } from '../data/posterDialog';
import { POSTER_EXPORT_DEFAULT_FORMAT, posterExportFormat } from '../data/posterExport';
import { POSTER_SINGLE_EXPORT_SCALE, renderPosterSingle } from './posterSingle';
import { POSTER_PERIOD_EXPORT_SCALE, renderPosterPeriod } from './posterPeriod';
import { POSTER_CLASS_EXPORT_SCALE, renderPosterClass } from './posterClass';
import { POSTER_VIDEO_COVER_EXPORT_SCALE, renderPosterVideoCover } from './posterVideoCover';
import { posterReportPageScale, renderPosterReport } from './posterReportLong';

export { POSTER_DIALOG_PREVIEW_SCALE };

/**
 * 渲染一张海报（预览 / 缩略图共用）：`scale` 决定设备像素（1× 预览、0.25× 缩略图、2× 导出）。
 * 没有 plan / 这一类版式还没有对应实现时返回 `null`（调用方自己决定怎么降级）。
 */
export async function renderPosterDialog(plan, { scale = POSTER_DIALOG_PREVIEW_SCALE, pageIndex = 0 } = {}) {
  const value = plan && typeof plan === 'object' ? plan : null;
  if (!value) return null;
  if (value.kind === 'period') return renderPosterPeriod(value, { scale });
  if (value.kind === 'class') return renderPosterClass(value, { scale });
  if (value.kind === 'video-cover') return renderPosterVideoCover(value, { scale });
  // 长图：弹窗里先看第一张（分段出多张是 US-311a 的导出口径，预览不必把 1of3 全画一遍）。
  if (value.kind === 'report-long') return renderPosterReport(value, { pageIndex: pageIndex || 1, scale });
  return renderPosterSingle(value, { scale });
}

/**
 * 五类版式的**导出倍数**：单作品 / 阶段 / 班级 / 封面一律 2×（2160 宽，仍在 canvas 单边上限内）；
 * 长图由数据层的降级结论逐页给出（`posterReportPageScale`：不降级 2×、降 DPI 或分段后 1×）。
 * 分派仍然只有这一处 —— 导出与预览走同一组渲染函数，只是倍数与编码档不同（FR-312）。
 */
export function posterDialogExportScale(plan, pageIndex = 0) {
  const value = plan && typeof plan === 'object' ? plan : {};
  if (value.kind === 'period') return POSTER_PERIOD_EXPORT_SCALE;
  if (value.kind === 'class') return POSTER_CLASS_EXPORT_SCALE;
  if (value.kind === 'video-cover') return POSTER_VIDEO_COVER_EXPORT_SCALE;
  if (value.kind === 'report-long') return posterReportPageScale(value, pageIndex);
  return POSTER_SINGLE_EXPORT_SCALE;
}

/**
 * 渲染**要交付的那一张**（[海报 US-311a] 的导出档）：倍数按上面的分派、编码档按导出格式表
 * （PNG 无损 / JPG 质量 0.9）。返回值与 `renderPoster` 同形（`blob` / `mimeType` / `quality` / ...），
 * 于是「导出前校验」与「下载字节」读的是同一次渲染的产物，不存在第二次绘制。
 *
 * `encodeDataURL` 默认 **false**（[海报 US-314] / FR-364、FR-365）：导出只交付 `blob`，
 * 开关掉的是**同步的全图 base64 编码**——它会给导出路径多留一份整图字符串（内存峰值）、
 * 又把主线程按住一小会儿（导出期间的阻塞）。预览 / 缩略图仍走默认值（带 `dataURL`）。
 */
export async function renderPosterDialogExport(plan, { format = POSTER_EXPORT_DEFAULT_FORMAT, pageIndex = 0, encodeDataURL = false } = {}) {
  const value = plan && typeof plan === 'object' ? plan : null;
  if (!value) return null;
  const entry = posterExportFormat(format);
  const scale = posterDialogExportScale(value, pageIndex);
  const options = { scale, type: entry.mimeType, quality: entry.quality === null ? undefined : entry.quality, encodeDataURL };
  if (value.kind === 'period') return renderPosterPeriod(value, options);
  if (value.kind === 'class') return renderPosterClass(value, options);
  if (value.kind === 'video-cover') return renderPosterVideoCover(value, options);
  if (value.kind === 'report-long') return renderPosterReport(value, { ...options, pageIndex: pageIndex || 1 });
  return renderPosterSingle(value, options);
}

/** 预览 / 缩略图用的地址（object URL，用完必须 `releasePosterDialogUrl` 回收）。 */
export function createPosterDialogUrl(rendered) {
  return rendered && rendered.blob ? URL.createObjectURL(rendered.blob) : '';
}

export function releasePosterDialogUrl(url) {
  if (url) URL.revokeObjectURL(url);
}
