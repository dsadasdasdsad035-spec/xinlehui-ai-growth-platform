// 保存图片（[第二步 US-008a]）的执行层：编排「读原图 → 算导出画布 → 渲染 → 编码（PNG / JPEG + 体积闸门）
// → 交给浏览器保存」。规则本身（两档口径 / 文件名 / 画布计划 / 保存路径判据）全在 data/artworkExport.js，
// 这里只做「必须有 DOM / canvas 能力」的那一半。
//
// 编码路径是 PRD 指定的 `canvas.toBlob`：
//   - 高清 PNG：`image/png`，无损，体积随像素走（验收没给它设上限）；
//   - 微信 JPG：`image/jpeg` 质量 0.85，先按标称质量编一次，超 1MB 就按阶梯降质重编，
//     直到装进上限 —— 返回**实际使用的质量**，界面据此如实说明（不是嘴上说 0.85）。
//
// 本模块**不做写回**（写回作品位与溯源记录是 US-008b）：它只负责「合成一档成品并把它交给浏览器保存」，
// 返回值里的 `canvas / blob / filename / plan / qualityUsed` 就是 US-008b 的输入
// （画布用来缩出档案口径的持久副本，blob 是被下载的那份字节），不需要再渲染第二次。

import {
  artworkExportFilename,
  artworkExportJpegQualityPlan,
  artworkExportOverLimit,
  artworkExportQuality,
  artworkExportSaveStrategy,
  artworkExportSizeText
} from '../data/artworkExport';
import { loadImage, planFrameExport, renderFramedArtworkToCanvas } from './framing';

/** `canvas.toBlob` 的 Promise 包装。PNG 不传质量参数（传了也没用，还可能被当成非法调用）。 */
function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('当前浏览器不支持图片导出，请换用较新的浏览器。'));
      return;
    }
    const done = blob => (blob ? resolve(blob) : reject(new Error('图片编码失败，请重试。')));
    if (quality === null || quality === undefined) canvas.toBlob(done, mimeType);
    else canvas.toBlob(done, mimeType, quality);
  });
}

/**
 * 把画布编成一档成品：`{ blob, qualityUsed, overLimit }`。
 * `maxBytes` 可覆盖档位口径（默认 1MB）—— 后台将来把体积上限做成可配置项时这里是唯一入口；
 * 验证脚本也用它把闸门收紧到能真触发降质阶梯的程度（否则 1600px 的图永远一编就过）。
 */
export async function encodeArtworkExportBlob(canvas, quality, { maxBytes } = {}) {
  const entry = artworkExportQuality(quality);
  const limit = Number.isFinite(maxBytes) ? Number(maxBytes) : entry.maxBytes;
  if (entry.format !== 'jpeg') {
    const blob = await canvasToBlob(canvas, entry.mimeType);
    return { blob, qualityUsed: null, overLimit: artworkExportOverLimit(blob.size, entry.id) };
  }
  let last = null;
  for (const qualityValue of artworkExportJpegQualityPlan(entry.id)) {
    const blob = await canvasToBlob(canvas, entry.mimeType, qualityValue);
    last = { blob, qualityUsed: qualityValue, overLimit: Number.isFinite(limit) ? blob.size > limit : artworkExportOverLimit(blob.size, entry.id) };
    if (!last.overLimit) break;
  }
  return last;
}

/**
 * 合成一档成品图（不落盘、不写回）。
 *
 * 顺序很重要：先读原图拿真实像素尺寸，再算导出画布（`planFrameExport`），最后按算出来的倍数渲染。
 * 「高清 PNG 保留裁剪后的原始像素」因此可以断言：`plan.keepsOriginalPixels` 为真时，
 * 导出图里作品占的设备像素不小于原图像素（不是「画布看起来挺大」）。
 */
export async function composeArtworkExport({
  source,
  spec = {},
  student = '',
  title = '',
  date = '',
  lessonDate,
  rotation,
  orgName = '',
  teacherName = '',
  variables = null,
  today,
  qrValues = null,
  quality
} = {}) {
  if (!source) throw new Error('请先完成作品装裱，再保存图片。');
  const entry = artworkExportQuality(quality);
  const image = await loadImage(source);
  const plan = planFrameExport({
    spec,
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
    rotation,
    quality: entry.id
  });
  const { canvas } = await renderFramedArtworkToCanvas({
    source, spec, student, title, date, lessonDate, rotation, orgName, teacherName, variables, today, qrValues,
    scale: plan.scale
  });
  const encoded = await encodeArtworkExportBlob(canvas, entry.id);
  return {
    // 合成用的画布原样带出去：写回档案的持久副本（US-008b）从它缩到档案口径，
    // 不需要再渲染第二次 —— 写回与下载因此必然是同一张画面。
    canvas,
    quality: entry.id,
    qualityLabel: entry.label,
    mimeType: entry.mimeType,
    filename: artworkExportFilename({ student, title, lessonDate, quality: entry.id }),
    blob: encoded.blob,
    bytes: encoded.blob.size,
    sizeText: artworkExportSizeText(encoded.blob.size),
    width: canvas.width,
    height: canvas.height,
    plan,
    qualityUsed: encoded.qualityUsed,
    overLimit: encoded.overLimit,
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight
  };
}

/** 预览 / 长按保存用的地址（object URL）：用完必须 `releaseArtworkExportUrl` 回收。 */
export function createArtworkExportUrl(result) {
  return result?.blob ? URL.createObjectURL(result.blob) : '';
}

export function releaseArtworkExportUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

/**
 * 常规浏览器：`<a download>` 真下载（PRD 指定的路径）。
 * 立刻 revoke 会让下载拿到空文件，所以延后回收 —— 这是本模块唯一的资源泄漏点，写在这里提醒。
 */
export function downloadArtworkExport(result) {
  if (!result?.blob) return '';
  const url = URL.createObjectURL(result.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return result.filename;
}

/** 保存路径的选择（判据在 data 层，界面据此决定「直接下载」还是「长按保存」提示页）。 */
export function artworkExportStrategy(userAgent) {
  return artworkExportSaveStrategy({ userAgent });
}
