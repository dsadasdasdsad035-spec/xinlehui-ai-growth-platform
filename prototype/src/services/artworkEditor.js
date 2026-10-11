/**
 * 作品编辑器的画布渲染（US-004a「编辑器旋转与撤销重做」/ US-004b「编辑器裁剪框与比例预设」）。
 *
 * 分工与 `services/mediaIntake.js` 一致：角度、范围、撤销栈、裁剪框几何这些**纯规则**在
 * `data/artworkEdit.js` / `data/artworkCrop.js`（零依赖、可 Node 断言），这里只做
 * 「必须有 canvas 才能做」的那部分 —— 把原图按 `artworkEdit` 真的画出来，得到「旋转稿」与「裁剪稿」。
 *
 * 四层地址里本文件负责 `originalUrl → 旋转稿`（orientedUrl）与「旋转稿 → 裁剪稿」的手动分支：
 * 原图**只读**，编辑结果是一份新的画布产物，任何情况下都不回写 `originalUrl`。
 */
import { rotateArtworkOriginal, CLEAN_MAX_EDGE } from './framing';
import { normalizeRotationDeg } from '../data/artworkEdit';
import { cropIsFull, cropRectOf } from '../data/artworkCrop';

/**
 * 手动裁剪（`artworkEdit.crop`）产出的画心标识。与 `framing.js` 的 `ARTWORK_CLEAN_ALGORITHM`
 * 一起构成「画心可用」的判据（main.jsx 的 `ARTWORK_CLEAN_ALGORITHMS`）：
 * 两条路径的下游完全一样，界面上只有「框是老师画的还是系统找的」这点区别。
 */
export const ARTWORK_MANUAL_CROP_ALGORITHM = 'artwork-manual-crop-v1';

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('作品图片暂时无法读取。'));
    image.src = source;
  });
}

/**
 * 按旋转角生成「旋转稿」。
 *
 * - `0° / 360°`：**原样返回 source**（不重新编码 —— 没转就是没转，连一像素都不动）；
 * - `90°` 的整数倍且要高清：走 `framing.js` 的 `rotateArtworkOriginal`（旧实现的精确路径，逐字节一致）；
 * - 任意角度、或低分辨率预览：先把源图等比缩到长边 ≤ `maxEdge`（预览时用，低分辨率才跟手），
 *   再把画布按「旋转后的外接框」放大、用背景色补齐四角 —— 任意角度旋转后原图的角会转出画布，
 *   补齐保证**作品本身一个像素都不被裁掉**（补白交给下游的自动裁剪处理）。
 *
 * @param {{source:string, rotation?:number, maxEdge?:number, background?:string}} options
 * @returns {Promise<string>} data URL（或原图地址本身）
 */
export async function renderArtworkRotation({ source, rotation = 0, maxEdge = 0, background = '#FFFFFF' } = {}) {
  if (!source) throw new Error('缺少作品原图地址。');
  const deg = normalizeRotationDeg(rotation);
  if (!deg) return source;
  const limit = Number(maxEdge) > 0 ? Math.floor(Number(maxEdge)) : 0;
  if (!limit && deg % 90 === 0) return rotateArtworkOriginal({ source, rotation: deg });

  const image = await loadImage(source);
  let sourceWidth = image.naturalWidth || 1;
  let sourceHeight = image.naturalHeight || 1;
  if (limit && Math.max(sourceWidth, sourceHeight) > limit) {
    const scale = limit / Math.max(sourceWidth, sourceHeight);
    sourceWidth = Math.max(1, Math.round(sourceWidth * scale));
    sourceHeight = Math.max(1, Math.round(sourceHeight * scale));
  }

  const radians = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = Math.max(1, Math.round(sourceWidth * cos + sourceHeight * sin));
  const height = Math.max(1, Math.round(sourceWidth * sin + sourceHeight * cos));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = background || '#FFFFFF';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.translate(width / 2, height / 2);
  context.rotate(radians);
  context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
  return limit ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png');
}

/**
 * 按 `artworkEdit.crop` 裁剪「旋转稿」（US-004b 的手动裁剪分支）。
 *
 * - 裁剪框是**归一化**坐标（0–1，相对摆正后的整幅画面），乘回像素即可，不做旋转（旋转已经在旋转稿里做过）；
 * - 框 = 整幅且原图没超上限时**原样返回 source**（不重新编码 —— 没裁就是没裁，连一像素都不动）；
 * - 其余情况只搬像素：输出长边不超过 `maxEdge`（与自动画心提取同一个上限），JPEG 0.94。
 *   比自动路径简单是**有意为之**：老师画的框就是最终边界，不做纸边识别、不填白、不再外推安全边。
 *
 * @param {{source:string, crop:object, maxEdge?:number, quality?:number}} options
 * @returns {Promise<{url:string, crop:object, width:number, height:number, source:{width:number,height:number,sx:number,sy:number,sw:number,sh:number}}>}
 */
export async function renderArtworkCrop({ source, crop, maxEdge = CLEAN_MAX_EDGE, quality = 0.94 } = {}) {
  if (!source) throw new Error('缺少作品原图地址。');
  const rect = cropRectOf(crop);
  const image = await loadImage(source);
  const width = image.naturalWidth || 1;
  const height = image.naturalHeight || 1;
  const limit = Number(maxEdge) > 0 ? Math.floor(Number(maxEdge)) : 0;
  if (cropIsFull(rect) && (!limit || Math.max(width, height) <= limit)) {
    return {
      url: source,
      crop: rect,
      width,
      height,
      source: { width, height, sx: 0, sy: 0, sw: width, sh: height }
    };
  }
  const sx = Math.max(0, Math.min(width - 1, Math.round(rect.x * width)));
  const sy = Math.max(0, Math.min(height - 1, Math.round(rect.y * height)));
  const sw = Math.max(1, Math.min(width - sx, Math.round(rect.w * width)));
  const sh = Math.max(1, Math.min(height - sy, Math.round(rect.h * height)));
  const scale = limit ? Math.min(1, limit / Math.max(sw, sh)) : 1;
  const outWidth = Math.max(1, Math.round(sw * scale));
  const outHeight = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, sx, sy, sw, sh, 0, 0, outWidth, outHeight);
  return {
    url: canvas.toDataURL('image/jpeg', quality),
    crop: rect,
    width: outWidth,
    height: outHeight,
    source: { width, height, sx, sy, sw, sh }
  };
}
