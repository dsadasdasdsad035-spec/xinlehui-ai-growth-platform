// 分享二维码的生成与下载（[第四步 US-208b]）的执行层。
//
// 规则（纠错等级 / 静区 / 画布边长 / 文件名 / 说明文字）全在 `data/archiveShare.js`，
// 编码与绘制**复用现有能力**，本模块只做「必须有 DOM / canvas 能力」的那一段编排：
//   ① 编码：`services/qrCode.js` 的 `qrMatrix()`（与装裱水印同一个编码器，零依赖、有参考实现对照）；
//   ② 绘制：`services/framing.js` 的 `paintQrMatrixToCanvas()`（与装裱水印同一支画笔，
//      白底 + 静区 + 模块取整都走同一套口径）；
//   ③ 下载：`services/artworkExport.js` 的 `downloadArtworkExport()`（与「保存图片」同一条
//      `<a download>` 路径；iOS / 微信内置浏览器的长按保存由界面按 UA 判据分流）。
//
// 编码不出来（空令牌 / 超长 / 画布不可用）一律返回 `null` —— 调用方按「这一支不画」处理：
// 绝不画一个扫不出来的假二维码发给家长（与 US-003c 同一条纪律）。

import {
  ARCHIVE_SHARE_QR_CANVAS_SIZE,
  ARCHIVE_SHARE_QR_ECC,
  shareQrBoxRatio,
  shareQrFilename,
  shareQrPayload
} from '../data/archiveShare';
import { downloadArtworkExport } from './artworkExport';
import { paintQrMatrixToCanvas } from './framing';
import { qrMatrix } from './qrCode';

/**
 * 渲染一张分享二维码：`{ token, url, ready, matrix, canvas, dataUrl, width, height, modules, version, ecc, box, quiet }`。
 *
 * `matrix` 可注入（断言用固定矩阵），默认按 `shareQrPayload()` 的 URL 现编。
 * `size` 是画布边长（正方形）；`caption` 缺省为空 —— 说明文字由界面用 HTML 渲染，
 * 免得在方框里再挤一行字（分享二维码的画布就是码本体，静区正好铺满）。
 */
export function renderShareQr({
  token = '',
  origin = '',
  size = ARCHIVE_SHARE_QR_CANVAS_SIZE,
  ecc = ARCHIVE_SHARE_QR_ECC,
  caption = '',
  matrix = null
} = {}) {
  const payload = shareQrPayload({ token, origin });
  if (!payload.ready) return null;
  if (typeof document === 'undefined') return null;
  const code = matrix || qrMatrix(payload.url, { ecc });
  if (!code) return null;
  const side = Math.max(160, Math.round(Number(size) || ARCHIVE_SHARE_QR_CANVAS_SIZE));
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const plan = paintQrMatrixToCanvas(ctx, {
    matrix: code,
    canvasWidth: side,
    canvasHeight: side,
    boxRatio: shareQrBoxRatio(code.size),
    caption
  });
  if (!plan) return null;
  return {
    token: payload.token,
    url: payload.url,
    ready: true,
    matrix: code,
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    width: side,
    height: side,
    modules: code.size,
    version: code.version,
    ecc: code.ecc,
    box: plan.box,
    plate: plan.plate,
    quiet: plan.quiet,
    moduleSize: plan.moduleSize
  };
}

/** 画布 → PNG blob（`toBlob` 的 Promise 包装；不支持 `toBlob` 时返回 null，界面给「请换浏览器」）。 */
export function shareQrBlob(rendered) {
  return new Promise(resolve => {
    const canvas = rendered?.canvas || null;
    if (!canvas || typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob(blob => resolve(blob || null), 'image/png');
  });
}

/**
 * 组装下载产物：`{ blob, filename, bytes, width, height, url, modules }`（与「保存图片」的
 * 导出产物同形状，因此 `downloadArtworkExport()` 与 UA 判据分流都能直接复用）。
 * 渲染 / 编码失败时返回 `null`（界面给可读原因，不谎报「已保存」）。
 */
export async function buildShareQrDownload({ token = '', origin = '', student = '', lessonDate = '', size, ecc } = {}) {
  const rendered = renderShareQr({ token, origin, size, ecc });
  if (!rendered) return null;
  const blob = await shareQrBlob(rendered);
  if (!blob) return null;
  return {
    blob,
    filename: shareQrFilename({ student, lessonDate }),
    bytes: blob.size,
    width: rendered.width,
    height: rendered.height,
    url: rendered.url,
    modules: rendered.modules,
    version: rendered.version
  };
}

/** 真下载（与「保存图片」同一条 `<a download>` 路径，返回实际用的文件名）。 */
export function downloadShareQr(result) {
  return downloadArtworkExport(result);
}
