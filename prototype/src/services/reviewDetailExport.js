// 本次点评详情面板的「复制全部 / 导出 JSON / 导出 Markdown」（[第三步 US-103b] / FR-113）。
//
// 文本与文件名的口径全在 data 层（`data/reviewDetailPanel.js` 的 `reviewDetailExportText` /
// `reviewDetailExportFilename`）：界面、落盘文件与验证脚本读同一份。本模块只做三件
// **必须有 DOM / Blob 能力**的事：
//  ① 组装 Blob 与文件名（`buildReviewDetailExport`）；
//  ② `<a download>` 真下载（沿用「保存图片」这一条下载路径：`services/artworkExport.js`）；
//  ③ 写入剪贴板（`copyReviewDetailText`：Clipboard API + 老浏览器兜底）。
import { reviewDetailExportFormat, reviewDetailExportFilename, reviewDetailExportText } from '../data/reviewDetailPanel';
import { artworkExportSizeText } from '../data/artworkExport';
import { downloadArtworkExport } from './artworkExport';

/**
 * 组装导出产物：`{ format, formatLabel, mimeType, filename, text, blob, bytes, sizeText }`。
 * `text` 原样返回，验证脚本可以直接拿它跟剪贴板里的内容比对（同一份口径）。
 */
export function buildReviewDetailExport(payload, { format = 'markdown', student = '', lessonDate = '' } = {}) {
  const entry = reviewDetailExportFormat(format);
  const text = reviewDetailExportText(payload, entry.id);
  const filename = reviewDetailExportFilename({ student, lessonDate, format: entry.id });
  const blob = new Blob([text], { type: entry.mimeType });
  return {
    format: entry.id,
    formatLabel: entry.label,
    mimeType: entry.mimeType,
    filename,
    text,
    blob,
    bytes: blob.size,
    sizeText: artworkExportSizeText(blob.size)
  };
}

/** 真下载（桌面与微信/iOS 都走 `<a download>`；返回值是实际用的文件名）。 */
export function downloadReviewDetailExport(result) {
  return downloadArtworkExport(result);
}

/**
 * 复制到剪贴板：优先 Clipboard API，失败（无权限 / 非安全上下文 / 老浏览器）时用
 * 临时 textarea + `execCommand('copy')` 兜底。返回是否成功 —— 界面据此给「已复制 / 请手动选择复制」。
 */
export async function copyReviewDetailText(text) {
  const value = String(text ?? '');
  if (!value) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* 无剪贴板权限时走下面的兜底 */ }
  try {
    if (typeof document === 'undefined') return false;
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    area.remove();
    return Boolean(ok);
  } catch { return false; }
}
