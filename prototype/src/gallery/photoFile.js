// 上传图片的通用处理：读取 → 等比缩小 → 转成紧凑的 data URL。
//
// 为什么必须缩小：云存储端点在当前匿名模式下不可用，图片只能以 data URL 存进
// 数据库 text 列。手机原图 4000×3000 转 base64 约 6MB，几条就把库撑爆了；
// 缩到长边 1600 并转 JPEG 之后约 300KB，既够 3D 贴图用，也不至于把行写崩。

import { loadImageElement } from '../services/roomReconstruct';

export const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('读取文件失败'));
  reader.readAsDataURL(file);
});

/**
 * 把一张本地图片压到长边 maxEdge 以内。
 * @returns {Promise<{dataUrl:string,width:number,height:number,name:string}>}
 */
export async function shrinkImageFile(file, { maxEdge = 1600, quality = 0.88, name } = {}) {
  const raw = await readFileAsDataUrl(file);
  const image = await loadImageElement(raw);
  const sourceW = image.naturalWidth || image.width || maxEdge;
  const sourceH = image.naturalHeight || image.height || maxEdge;
  const scale = Math.min(1, maxEdge / Math.max(sourceW, sourceH));
  const width = Math.max(1, Math.round(sourceW * scale));
  const height = Math.max(1, Math.round(sourceH * scale));
  if (scale === 1 && raw.length < 400_000) {
    return { dataUrl: raw, width: sourceW, height: sourceH, name: name || file.name };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // JPEG 没有 alpha 通道，直接画会让透明 PNG 变成黑底，先铺一层白。
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width, height, name: name || file.name };
}
