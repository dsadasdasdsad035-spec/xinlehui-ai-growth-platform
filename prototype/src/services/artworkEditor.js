/**
 * 作品编辑器的画布渲染（US-004a「编辑器旋转与撤销重做」）。
 *
 * 分工与 `services/mediaIntake.js` 一致：角度、范围、撤销栈这些**纯规则**在
 * `data/artworkEdit.js`（零依赖、可 Node 断言），这里只做「必须有 canvas 才能做」的那部分 ——
 * 把原图按 `artworkEdit.rotateDeg` 真的画出来，得到「旋转稿」。
 *
 * 四层地址里本文件负责 `originalUrl → 旋转稿`（orientedUrl）这一段：
 * 原图**只读**，旋转结果是一份新的画布产物，任何情况下都不回写 `originalUrl`。
 */
import { rotateArtworkOriginal } from './framing';
import { normalizeRotationDeg } from '../data/artworkEdit';

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
