// 管理端「海报模板」的实时预览（[海报 US-312a] / FR-355）。
//
// **全仓只有一份海报渲染实现**，这一层不画海报：它只做两件渲染之外的事，然后把 plan 交给
// `services/posterDialog.js` 的 `renderPosterDialog()` —— 也就是老师端预览 / 缩略图 / 导出用的**同一支分派**
// （五支 `renderPosterX()` → 同一个 `renderPoster()`，只差 `scale` 与编码档）。于是「后台预览好看、
// 老师端出来不是那样」这种分叉在结构上不可能发生：两边是同一支函数画出来的。
//
// 它做的第一件事是**造样例素材**：模板里的作品位需要图才能看出排版（一张空框说明不了任何事）。
// 合成图只是**夹具**（暖色渐变 + 斜带 + 圆点 + 角标序号），不依赖任何外部图片 ——
// 预览要能在任何一台机器上跑，而不是「先上传一张示例作品」。
// 用 canvas 合成 ⇒ 只在这一层做（data 层是零依赖纯函数，不碰 canvas）。
import { POSTER_DIALOG_PREVIEW_SCALE } from '../data/posterDialog';
import {
  POSTER_ADMIN_PREVIEW_DATES,
  posterAdminPreviewArtworkCount,
  posterAdminPreviewPlan
} from '../data/posterAdmin';
import { normalizePosterSpec } from '../data/posterTemplates';
import { createPosterDialogUrl, releasePosterDialogUrl, renderPosterDialog } from './posterDialog';

export { POSTER_DIALOG_PREVIEW_SCALE as POSTER_ADMIN_PREVIEW_SCALE };
export { createPosterDialogUrl as createPosterAdminPreviewUrl, releasePosterDialogUrl as releasePosterAdminPreviewUrl };

/** 合成样例作品图的底色（同一色系的三档，拼贴时相邻格子不撞色）。 */
const POSTER_ADMIN_ARTWORK_PALETTE = [
  { top: '#F4D9A0', bottom: '#CFA52E' },
  { top: '#DCE7D5', bottom: '#7C9A6B' },
  { top: '#F0CFC4', bottom: '#C4705C' },
  { top: '#D9DFEA', bottom: '#6C7A94' },
  { top: '#F1E3C8', bottom: '#A98B54' },
  { top: '#E6D6E4', bottom: '#8C6A88' }
];

const POSTER_ADMIN_ARTWORK_SIZE = { width: 640, height: 480 };

/**
 * 合成一张「样例作品图」（暖色渐变底 + 斜带 + 圆点 + 左上角序号），返回 dataURL。
 * 没有 canvas 能力时返回 `''`（渲染层把那一支当「没素材」，预览照样出图 —— 只是没有作品图）。
 */
export function createPosterAdminArtwork({ width = POSTER_ADMIN_ARTWORK_SIZE.width, height = POSTER_ADMIN_ARTWORK_SIZE.height, tone = 0 } = {}) {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width));
  canvas.height = Math.max(2, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const index = Math.abs(Math.trunc(Number(tone) || 0)) % POSTER_ADMIN_ARTWORK_PALETTE.length;
  const palette = POSTER_ADMIN_ARTWORK_PALETTE[index];
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, palette.top);
  gradient.addColorStop(1, palette.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#FBF8F2';
  ctx.beginPath();
  ctx.moveTo(canvas.width * 0.16, canvas.height * 0.84);
  ctx.lineTo(canvas.width * 0.58, canvas.height * 0.18);
  ctx.lineTo(canvas.width * 0.88, canvas.height * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2B271F';
  ctx.beginPath();
  ctx.arc(canvas.width * 0.7, canvas.height * 0.68, Math.min(canvas.width, canvas.height) * 0.11, 0, Math.PI * 2);
  ctx.fill();
  // 角标序号：拼贴时一眼看出「第几幅」，也让人不会把它当成真实作品。
  ctx.fillStyle = '#FBF8F2';
  ctx.font = `bold ${Math.round(canvas.height * 0.14)}px sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(String(index + 1), canvas.width * 0.06, canvas.height * 0.06);
  return canvas.toDataURL('image/png');
}

/** 合成一个「机构标识」（墨色圆角块 + 暖金横线），返回 dataURL；无 canvas 时返回 `''`。 */
export function createPosterAdminLogo({ width = 360, height = 120 } = {}) {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width));
  canvas.height = Math.max(2, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#2B271F';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, canvas.height * 0.24);
  ctx.fill();
  ctx.fillStyle = '#CFA52E';
  ctx.fillRect(canvas.width * 0.08, canvas.height * 0.46, canvas.width * 0.84, canvas.height * 0.12);
  return canvas.toDataURL('image/png');
}

/**
 * 这份 spec 的预览需要几张样例作品：取各 image 位里最大的那个需求
 * （`posterAdminPreviewArtworkCount()` 是唯一的「这一位要几幅」判据，界面不重复算）。
 */
export function posterAdminPreviewArtworkPoolSize(spec) {
  const normalized = normalizePosterSpec(spec);
  return normalized.slots.reduce((max, slot) => {
    if (slot.type !== 'image' || slot.visible === false) return max;
    return Math.max(max, posterAdminPreviewArtworkCount(slot));
  }, 1);
}

/** 生成一份样例素材池（长度 = 上面那个需求；每一格一张合成图）。 */
export function posterAdminPreviewArtworkPool(spec) {
  const size = posterAdminPreviewArtworkPoolSize(spec);
  return Array.from({ length: size }, (_, index) => createPosterAdminArtwork({ tone: index }));
}

/**
 * 渲染一次预览：样例素材 → plan（data 层）→ **同一支** `renderPosterDialog()`。
 * 返回 `renderPoster` 的完整结果（`{ blob, width, height, plan, warnings, ... }`）；
 * 没有 canvas 能力时返回 `null`（调用方渲染「渲染失败」那一句）。
 */
export async function renderPosterAdminPreview({ spec, kind = '', scale = POSTER_DIALOG_PREVIEW_SCALE, artworks = null, logo = null } = {}) {
  const normalized = normalizePosterSpec(spec);
  const pool = Array.isArray(artworks) ? artworks : posterAdminPreviewArtworkPool(normalized);
  const mark = logo === null ? createPosterAdminLogo() : logo;
  const plan = posterAdminPreviewPlan({ kind, spec: normalized, artworks: pool, logo: mark });
  return renderPosterDialog(plan, { scale });
}

/** 样例作品图的张数说明（面板上一行读数：让「为什么这里出来 9 格」有答案）。 */
export function posterAdminPreviewSampleLine(spec) {
  const count = posterAdminPreviewArtworkPoolSize(spec);
  return `样例素材：${count} 幅合成作品图（每幅都带序号角标，第一次课次日期标注 ${POSTER_ADMIN_PREVIEW_DATES[0]}）`;
}
