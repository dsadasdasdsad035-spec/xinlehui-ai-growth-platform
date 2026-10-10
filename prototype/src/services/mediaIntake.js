/**
 * 素材准入的浏览器侧实现（US-408）：降采样与 object URL 生命周期。
 *
 * `data/mediaValidation.js` 只负责「规则」（纯函数、可 Node 断言）；这里做规则之外
 * 必须有浏览器能力的部分：解码图片拿真实像素、canvas 降采样、File 类型归一化、
 * 以及会话内 object URL 的回收。
 *
 * 关键约定：
 * - 超长边图片**在客户端降采样后再处理**，上传/预览用的都是降采样后的文件；
 * - object URL 是会话内的临时地址，条目被移除 / 换班 / 新建草稿时要 `revokeMediaUrl` 回收，
 *   绝不能让会话素材地址流进持久化数据（持久化走 `buildSessionMediaDraft`）。
 */
import { MAX_LONG_EDGE, MAX_MEDIA_BYTES, downsamplePlan, mediaTypeOf } from '../data/mediaValidation';

function canUseDom() {
  return typeof document !== 'undefined'
    && typeof URL !== 'undefined'
    && typeof URL.createObjectURL === 'function';
}

/** 文件没有给出白名单 MIME（相机导出、部分选择器）时，用解析出的类型补上。 */
export function applyResolvedType(file, type) {
  const resolved = String(type || '').trim();
  if (!file || !resolved || file.type === resolved) return file;
  try {
    if (typeof File === 'function') return new File([file], file.name || 'media', { type: resolved });
  } catch {
    /* 构造失败时退回原文件：上传接口仍能按扩展名处理 */
  }
  return file;
}

/** 按 `data/mediaValidation` 的规则归一化一批文件的 MIME（不合格的文件原样返回，由 screenMediaFiles 拒绝）。 */
export function resolveMediaTypes(files = []) {
  return Array.from(files || []).map(file => applyResolvedType(file, mediaTypeOf(file)));
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image-decode-failed'));
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob(blob => resolve(blob), type, quality);
  });
}

/**
 * 单份文件的降采样：长边不超过 3000px 时**原样返回**（不重新编码，避免无意义的有损压缩）。
 *
 * @returns {{ok:boolean, file:File|null, downsampled:boolean, width:number, height:number,
 *            originalWidth:number, originalHeight:number, message:string}}
 *          `message` 是给老师看的可读说明（降采样了会说明从多少 px 到多少 px）。
 */
export async function downsampleImageFile(file, options = {}) {
  const source = file;
  if (!source) return { ok: false, file: null, downsampled: false, width: 0, height: 0, originalWidth: 0, originalHeight: 0, message: '没有可处理的素材。' };
  const maxLongEdge = Number(options.maxLongEdge) > 0 ? Number(options.maxLongEdge) : MAX_LONG_EDGE;
  // Node / 无 DOM 环境（构建期的任何调用）不做处理，直接放行原文件。
  if (!canUseDom()) {
    return { ok: true, file: source, downsampled: false, width: 0, height: 0, originalWidth: 0, originalHeight: 0, message: '' };
  }
  const probeUrl = URL.createObjectURL(source);
  try {
    let image = null;
    try {
      image = await loadImageElement(probeUrl);
    } catch {
      return { ok: false, file: null, downsampled: false, width: 0, height: 0, originalWidth: 0, originalHeight: 0, message: `「${source.name || '这张图片'}」无法在本机读取（文件可能已损坏或并不是真正的图片），请重新导出后再试。` };
    }
    const originalWidth = image.naturalWidth || image.width || 0;
    const originalHeight = image.naturalHeight || image.height || 0;
    const plan = downsamplePlan(originalWidth, originalHeight, maxLongEdge);
    const originalSource = file;
    if (!plan.needed) {
      return { ok: true, file: originalSource, downsampled: false, width: originalWidth, height: originalHeight, originalWidth, originalHeight, message: '' };
    }
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no-2d-context');
    // 只做等比缩放，不裁切、不调色（与装裱渲染的同一条纪律）。
    context.drawImage(image, 0, 0, plan.width, plan.height);
    const targetType = ['image/jpeg', 'image/png', 'image/webp'].includes(originalSource.type) ? originalSource.type : 'image/jpeg';
    let blob = await canvasToBlob(canvas, targetType, targetType === 'image/png' ? undefined : 0.92);
    if (!blob && targetType !== 'image/jpeg') blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    if (!blob) throw new Error('encode-failed');
    const nextType = blob.type || targetType;
    const nextFile = typeof File === 'function'
      ? new File([blob], originalSource.name || 'media', { type: nextType })
      : originalSource;
    return {
      ok: true,
      file: nextFile,
      downsampled: true,
      width: plan.width,
      height: plan.height,
      originalWidth,
      originalHeight,
      message: `「${originalSource.name}」长边 ${Math.max(originalWidth, originalHeight)}px，已在本机降采样到 ${plan.longEdge}px 后再处理。`
    };
  } catch {
    return {
      ok: false,
      file: null,
      downsampled: false,
      width: 0,
      height: 0,
      originalWidth: 0,
      originalHeight: 0,
      message: `「${source.name || '这张图片'}」超过长边 ${maxLongEdge}px 且无法在本机压缩，请先导出为长边不超过 ${maxLongEdge}px 的图片再上传。`
    };
  } finally {
    URL.revokeObjectURL(probeUrl);
  }
}

/** 回收一个会话内 object URL（只回收 blob:，http(s) 地址不属于本次会话，不能动）。 */
export function revokeMediaUrl(url) {
  try {
    const value = String(url || '');
    if (!value.startsWith('blob:')) return;
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(value);
  } catch {
    /* 回收失败不影响主流程 */
  }
}

/** 回收一组素材条目的 object URL（移除条目 / 换班 / 新建草稿时调用）。 */
export function revokeMediaEntries(entries = []) {
  (entries || []).forEach(item => revokeMediaUrl(item?.url));
}

/** 会话内素材只允许 object URL：上传前的最后一道守卫（防止把 http/data 地址当作「本次会话素材」）。 */
export function isSessionMediaUrl(url) {
  const value = String(url || '');
  return value.startsWith('blob:') || value === '';
}

/** 单张上限的可读说法，供界面提示复用。 */
export function maxMediaBytesLabel() {
  return `${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))}MB`;
}
