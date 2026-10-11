import { renderFramedArtwork } from './framing';
import { frameSpecRenderKey } from './frameSpec';
import { artworkUrlFingerprint } from '../data/artworkLayers';

/**
 * 相框样式缩略图（[第二步 US-006]）：**用当前作品实时渲染**的小图。
 *
 * 为什么不是「另画一套便宜的预览」：缩略图必须与成品图逐处一致（框宽、形状、卡纸、展签），
 * 另写一份绘制就会漂移（`buildFramingLayout` 是渲染与遮挡统计共用的几何。
 * 所以这里的做法是：
 *   1. 调**同一个** `renderFramedArtwork`（输出 1800×1360 JPEG，与成品一致）；
 *   2. 把它等比缩到长边 ≤ `FRAME_THUMBNAIL_LONG_EDGE` 再存 —— 缩略图只在内存里放小图，
 *      1800px 的位图用完即弃（否则 10 来张全尺寸位图会把解码内存顶到几十 MB）。
 *
 * 用量纪律：**串行**渲染（调用方按顺序 await），并把结果按 `frameThumbnailKey()` 缓存 ——
 * 缓存键取整份渲染视图（`frameSpecRenderKey`），换形状 / 换色 / 换框宽一定会换键，
 * 两套只有微小差异的样式绝不会共用同一张缩略图。
 */

/** 缩略图长边上限（CSS 里的展示宽度更小，留 2 倍给高清屏）。 */
export const FRAME_THUMBNAIL_LONG_EDGE = 320;
/**
 * 老师端「水印 · 落款 · 时间」面板里那张成品预览的长边上限（US-007）。
 * 比缩略图大一档（看得清水印与落款），但同样只留小图，1800px 的位图用完即弃。
 */
export const FRAME_PREVIEW_LONG_EDGE = 480;
/** 内存里最多留多少张缩略图（小图 ~10–20KB，超上限就不再写缓存，避免长时间会话无限增长）。 */
export const FRAME_THUMB_CACHE_LIMIT = 96;
const FRAME_THUMBNAIL_QUALITY = 0.82;

/**
 * 缩略图缓存键：spec（渲染视图）+ 作品地址指纹 + 展签变量 + 长边上限。
 * 任何一项变化都必须换键 —— 少一项的后果是「换了一套样式却看到上一套的缩略图」。
 * `lessonDate`（US-007 起）是渲染入参之一（时间元素的 lesson 来源与 `{课次日期}` 读它），
 * 会影响输出，所以一并进键；缺省为 undefined（两侧一致即可）。
 */
export function frameThumbnailKey({ spec, source, student = '', title = '', date = '', lessonDate, orgName = '', teacherName = '', maxEdge = FRAME_THUMBNAIL_LONG_EDGE } = {}) {
  return JSON.stringify([
    frameSpecRenderKey(spec),
    artworkUrlFingerprint(source),
    student,
    title,
    date,
    lessonDate === undefined || lessonDate === null ? null : lessonDate,
    orgName,
    teacherName,
    maxEdge
  ]);
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('缩略图素材暂时无法读取。'));
    image.src = source;
  });
}

/** 等比缩到长边 ≤ maxEdge 并重新编码（小图体积只有几十 KB 量级）。 */
async function downscaleImageUrl(url, maxEdge) {
  const image = await loadImage(url);
  const width = image.naturalWidth || 1;
  const height = image.naturalHeight || 1;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', FRAME_THUMBNAIL_QUALITY);
}

/**
 * 渲染一张样式缩略图：与成品图同一条渲染路径，再缩到长边 ≤ `maxEdge`。
 * 渲染失败（素材读不出来等）会 throw，由调用方决定「这一张显示占位」。
 * `lessonDate`（US-007）透传给渲染函数：老师端面板的实时预览要按本次课次日期画时间元素。
 */
export async function renderFrameStyleThumbnail({ source, spec, student = '', title = '', date = '', lessonDate, orgName = '', teacherName = '', maxEdge = FRAME_THUMBNAIL_LONG_EDGE } = {}) {
  const framed = await renderFramedArtwork({
    source,
    spec,
    student,
    title,
    date,
    lessonDate,
    rotation: 0,
    orgName,
    teacherName
  });
  return downscaleImageUrl(framed, maxEdge);
}
