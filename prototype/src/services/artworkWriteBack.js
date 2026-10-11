// 成品图写回的执行层（[第二步 US-008b]）：只做「必须有 DOM / canvas 能力」的那一件事 ——
// 把合成好的成品图画布再编出一份**持久副本**（data URL），交给上层写进作品位。
//
// 规则（口径、字段白名单、新鲜度键、失败文案）全在 `data/artworkWriteBack.js`，
// 这里不重复判断；**编排**（写哪个作品位、同步哪条归档记录）在 main.jsx 里。
//
// 为什么源码是「合成用的那张画布」而不是下载下来的 blob：
//   画布就在手边（`composeArtworkExport` 已返回它），从它缩到档案口径只多一次缩放绘制；
//   而 blob 是**下载档位**（高清 PNG 可到 3480×2629），直接 data URL 化约 1.5MB，
//   写进 localStorage 会顶爆配额。所以档案副本统一走 ARTWORK_WRITE_BACK_IMAGE 的口径。
//
// 失败一律抛可读错误：上层 catch 后走 PRD 要求的「已保存到本地，未能同步到档案，可重试」，
// **绝不因为写回失败去影响已经完成的下载**。

import { ARTWORK_WRITE_BACK_IMAGE } from '../data/artworkWriteBack';

/** data URL 的正文长度 → 大致字节数（base64 是 4 字符 3 字节）。只用于界面显示。 */
export function dataUrlByteLength(url) {
  const text = typeof url === 'string' ? url : '';
  const comma = text.indexOf(',');
  if (comma < 0) return 0;
  const body = text.slice(comma + 1);
  const padding = body.endsWith('==') ? 2 : (body.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

/**
 * 合成画布 → 档案用的持久副本。
 *
 * @param {HTMLCanvasElement} canvas 合成成品图用的那张画布（`composeArtworkExport` 的返回值）
 * @returns {Promise<{url:string,width:number,height:number,bytes:number}>}
 */
export async function encodeArtworkWriteBackImage({
  canvas,
  maxLongEdge = ARTWORK_WRITE_BACK_IMAGE.maxLongEdge,
  jpegQuality = ARTWORK_WRITE_BACK_IMAGE.jpegQuality
} = {}) {
  const source = canvas;
  if (!source || typeof source.getContext !== 'function' || !source.width || !source.height) {
    throw new Error('成品图还没合成，无法写回档案');
  }
  if (typeof document === 'undefined') throw new Error('当前环境不支持画布导出');
  const edge = Number.isFinite(Number(maxLongEdge)) && Number(maxLongEdge) > 0 ? Number(maxLongEdge) : ARTWORK_WRITE_BACK_IMAGE.maxLongEdge;
  const scale = Math.min(1, edge / Math.max(source.width, source.height));
  const target = document.createElement('canvas');
  target.width = Math.max(1, Math.round(source.width * scale));
  target.height = Math.max(1, Math.round(source.height * scale));
  const context = target.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持把成品图写回档案（缺少 2D 画布）');
  context.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in context) context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, target.width, target.height);
  const url = target.toDataURL(ARTWORK_WRITE_BACK_IMAGE.mimeType, jpegQuality);
  if (!url || !url.startsWith('data:')) throw new Error('成品图编码失败');
  return { url, width: target.width, height: target.height, bytes: dataUrlByteLength(url) };
}

/** 写回副本用的档案口径说明（面板上的那一行小字读它，避免两处各写一遍数字）。 */
export function artworkWriteBackImageRulesText() {
  return `写回档案的是${ARTWORK_WRITE_BACK_IMAGE.label}的持久副本；老师本机下载的文件仍按所选档位（高清 PNG 保留裁剪后的原始像素）。`;
}
