import { renderFramedArtwork } from './framing';

/**
 * 后台「装裱设置」面板的**实时预览**（[第二步 US-011a]）。
 *
 * 验收原文：「参数区旁提供实时预览，预览与真实渲染**使用同一个渲染函数**」——
 * 所以这里只做两件事：造一张占位作品，然后调用成品图那一支 `renderFramedArtwork()`
 * （老师端第二步、3D 画廊、保存图片读的都是它）。任何「预览专用画法」都会立刻变成
 * 「面板上好看、老师端不是这样」，所以这一层**不允许**有第二种画法。
 *
 * 抽成模块（而不是留在 main.jsx 的组件里）的原因：浏览器验证脚本可以
 * `await import('/src/services/framePreview.js')` 用同一份占位作品 + 同一份参数**独立重算**
 * 一次预览，与面板上的 `<img>` 逐字节比对 —— 「预览跟着参数走」因此是可断言的，不是靠肉眼。
 */

/** 占位作品的像素尺寸（遮挡统计与预览共用；改它等于改所有面板断言的坐标系）。 */
export const FRAME_PREVIEW_ARTWORK_SIZE = { width: 900, height: 680 };

/**
 * 预览用的**示例课次日期**（US-014 起展签日期取 `lesson.lessonDate`，后台没有真实课次上下文）。
 * 面板上看到的仍是「创作于 + 某种格式」：格式来自模板（`spec.plaque.dateFormat`），值用这份固定的
 * 示例日期 —— **不要用 `new Date()`**，否则同一份模板在不同日子预览出不同的图。
 */
export const FRAME_PREVIEW_LESSON_DATE = '2026.08.11';

let placeholderCache = '';

/** 占位作品：只在后台设置页使用，不参与任何真实渲染。 */
export function placeholderArtwork() {
  if (placeholderCache) return placeholderCache;
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_PREVIEW_ARTWORK_SIZE.width;
  canvas.height = FRAME_PREVIEW_ARTWORK_SIZE.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fdfbf6';
  ctx.fillRect(0, 0, FRAME_PREVIEW_ARTWORK_SIZE.width, FRAME_PREVIEW_ARTWORK_SIZE.height);
  ctx.fillStyle = '#f6c445'; ctx.beginPath(); ctx.arc(420, 300, 140, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e2603c'; ctx.beginPath(); ctx.arc(590, 215, 62, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#2f6fbf'; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(150, 560); ctx.quadraticCurveTo(450, 392, 760, 560); ctx.stroke();
  ctx.strokeStyle = '#3f8f5f'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(420, 440); ctx.quadraticCurveTo(392, 540, 300, 596); ctx.stroke();
  ctx.fillStyle = '#6d6559'; ctx.font = '26px serif'; ctx.fillText('占位作品 · 仅用于预览装裱', 300, 646);
  placeholderCache = canvas.toDataURL('image/png');
  return placeholderCache;
}

/**
 * 用占位作品渲染一次装裱预览，返回成品图那一档的 data URL（1800×1360 JPEG 0.92）。
 * 参数与老师端 `renderFramedArtwork` 的调用完全同形，所以面板上看到的就是老师端会拿到的。
 */
export function renderFramePreview({
  spec = null,
  student = '',
  title = '',
  date = '',
  lessonDate,
  orgName = '',
  teacherName = '',
  today
} = {}) {
  return renderFramedArtwork({
    source: placeholderArtwork(),
    spec: spec || {},
    student,
    title,
    date,
    lessonDate,
    orgName,
    teacherName,
    today
  });
}
