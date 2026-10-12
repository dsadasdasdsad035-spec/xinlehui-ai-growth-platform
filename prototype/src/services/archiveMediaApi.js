/**
 * 归档素材的**持久化通道**（[第四步 US-203]）。
 *
 * 规则（状态机、https 闸门、原图守卫、占位判据）在 `data/archiveMedia.js`；这里只做必须有
 * 网络 / 画布能力的部分：
 *
 *   ① `buildArchiveMediaCopy`：把会话内地址（blob:）或原始拍摄地址换成**本地持久副本**
 *      （data URL，档案展示口径：长边 ≤1600 · JPEG 0.85），并按需要把旋转角烘进像素 ——
 *      这就是「修正后的课堂照片」；
 *   ② `uploadArchiveMedia`：把副本交给对象存储适配器（`POST /api/archive-media`，带鉴权头），
 *      响应过两道闸门：落点必须合格（`assertChildMediaStorage`）**且地址必须是 https**
 *      （`persistentMediaUrlIssue`）。适配器声明自己不是持久落点（本地内存适配器）时，
 *      结果如实降级为 `local`，而不是假装同步成功；
 *   ③ `syncArchiveMedia` / `retryArchiveMediaRecord`：逐条同步、**永不抛错**（上传失败不阻断
 *      归档，只是标成 `pending` 并可重试）。
 *
 * 原图永不上传：候选素材由 `data/archiveMedia.js` 的 `archiveMediaCandidates` 从成品图与
 * 修正后的照片里取，这条通道拿到的只有副本；`data/feedbackRecords.js` 另有 `originalUrl`
 * 的结构守卫。
 */

import {
  ARCHIVE_MEDIA_LOCAL_COPY,
  ARCHIVE_MEDIA_LOCAL_STORAGE,
  ARCHIVE_MEDIA_OBJECT_STORAGE,
  archiveMediaCandidates,
  archiveMediaCanSync,
  archiveMediaRecordView,
  archiveMediaStorageKey,
  archiveMediaSyncSummary,
  applyArchiveMediaSync,
  createArchiveMediaEntry,
  isPersistentMediaUrl,
  normalizeArchiveMedia,
  normalizeArchiveMediaList,
  persistentMediaUrlIssue
} from '../data/archiveMedia';
import { childMediaStorageLabel } from '../data/mediaStoragePolicy';
import { CHILD_MEDIA_API_BASE, assertChildMediaStorage, childMediaUploadHeaders } from './mediaStorage';

export const ARCHIVE_MEDIA_ENDPOINT = '/api/archive-media';

/** 单条素材的上传上限（超时按失败处理，**绝不**把归档拖死在那里）。 */
export const ARCHIVE_MEDIA_UPLOAD_TIMEOUT_MS = 8000;

const str = value => (value === null || value === undefined ? '' : String(value).trim());

const canUseDom = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('素材读取失败'));
    image.src = source;
  });
}

async function sourceToBlob(url) {
  const value = str(url);
  if (!value) throw new Error('没有可上传的素材地址。');
  if (value.startsWith('data:')) {
    // data URL 不经过 fetch（某些环境下 fetch(data:) 不可用），直接手工解码。
    const matched = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!matched) throw new Error('素材数据无法解析。');
    const type = matched[1] || 'application/octet-stream';
    const raw = matched[2] ? atob(matched[3]) : decodeURIComponent(matched[3]);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    return new Blob([bytes], { type });
  }
  const response = await fetch(value);
  if (!response.ok) throw new Error(`素材读取失败（HTTP ${response.status}）。`);
  return response.blob();
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => {
    if (typeof canvas.toBlob !== 'function') { resolve(null); return; }
    canvas.toBlob(blob => resolve(blob), type, quality);
  });
}

/**
 * 本地**持久副本**（data URL）：把任意会话内地址换成「刷新 / 重开还在」的副本，
 * 顺便按 `rotation` 把老师的旋转校正烘进像素（修正后的课堂照片），并按档案展示口径收敛尺寸。
 *
 * 永不抛错：没有 DOM / 读不出素材时返回 `{ok:false, url:'', reason}`，
 * 调用方据此把素材标成 `pending`，而不是让归档整个失败。
 */
export async function buildArchiveMediaCopy(url, { rotation = 0, maxLongEdge = ARCHIVE_MEDIA_LOCAL_COPY.maxLongEdge, quality = ARCHIVE_MEDIA_LOCAL_COPY.jpegQuality } = {}) {
  const source = str(url);
  if (!source) return { ok: false, url: '', reason: '没有可持久化的素材地址。' };
  if (source.startsWith('data:') && !(Number(rotation) % 360)) {
    // 已经是持久副本、也没有旋转要烘：原样返回（连一次重编码都不做）。
    return { ok: true, url: source, degraded: false, reason: '' };
  }
  if (!canUseDom()) return { ok: false, url: '', reason: '当前环境没有画布能力，无法生成本地持久副本。' };
  try {
    const blob = await sourceToBlob(source);
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await loadImage(objectUrl);
      const width = image.naturalWidth || image.width || 0;
      const height = image.naturalHeight || image.height || 0;
      if (!width || !height) return { ok: false, url: '', reason: '素材尺寸读取失败。' };
      const deg = ((Number(rotation) || 0) % 360 + 360) % 360;
      const quarter = deg % 180 === 90;
      const boxWidth = quarter ? height : width;
      const boxHeight = quarter ? width : height;
      const scale = Math.min(1, Number(maxLongEdge) > 0 ? Number(maxLongEdge) / Math.max(boxWidth, boxHeight) : 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(boxWidth * scale));
      canvas.height = Math.max(1, Math.round(boxHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) return { ok: false, url: '', reason: '当前环境没有画布能力，无法生成本地持久副本。' };
      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((deg * Math.PI) / 180);
      context.drawImage(image, -(width * scale) / 2, -(height * scale) / 2, width * scale, height * scale);
      context.restore();
      const encoded = canvas.toDataURL(ARCHIVE_MEDIA_LOCAL_COPY.mimeType, quality);
      if (!encoded || !encoded.startsWith('data:')) return { ok: false, url: '', reason: '本地持久副本生成失败。' };
      const shrank = scale < 1;
      return {
        ok: true,
        url: encoded,
        degraded: shrank || deg !== 0,
        reason: '',
        width: canvas.width,
        height: canvas.height,
        note: [deg ? `已按 ${deg}° 旋转校正` : '', shrank ? `长边收敛到 ${maxLongEdge}px（${ARCHIVE_MEDIA_LOCAL_COPY.label}）` : ''].filter(Boolean).join(' · ')
      };
    } finally {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    return { ok: false, url: '', reason: `素材读取失败：${str(error?.message) || '未知原因'}` };
  }
}

/**
 * 对象存储适配器的**默认上传实现**（`POST /api/archive-media`，带鉴权头）。
 * 只负责把字节交出去并解析响应；「这个响应算不算同步成功」由 `uploadArchiveMedia` 判定。
 */
export async function archiveMediaUploader({ kind = 'artwork', name = '', blob, storageKey = '', signal } = {}) {
  const response = await fetch(`${CHILD_MEDIA_API_BASE}${ARCHIVE_MEDIA_ENDPOINT}`, {
    method: 'POST',
    headers: childMediaUploadHeaders({
      extra: {
        'Content-Type': blob?.type || 'image/jpeg',
        'X-Media-Kind': kind,
        'X-Media-Name': encodeURIComponent(name),
        'X-Media-Storage-Key': storageKey
      }
    }),
    body: blob,
    signal
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `对象存储返回 HTTP ${response.status}。`);
  return payload;
}

function timeoutMsOf(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : ARCHIVE_MEDIA_UPLOAD_TIMEOUT_MS;
}

/**
 * 同步**一条**素材：先造本地持久副本（保证「降级也有图」），再尝试对象存储。
 *
 * 返回的一定是一条合法的素材记录（`{ok, entry, status, reason}`），
 * 三种结局：`synced`（https + storageKey）/ `local`（适配器不是持久落点 → 降级并标注）/
 * `pending`（没连上 / 上传失败 → 可重试）。
 */
export async function syncArchiveMediaEntry(candidate, { uploader = archiveMediaUploader, timeoutMs = ARCHIVE_MEDIA_UPLOAD_TIMEOUT_MS, index = 0, keyScope = {} } = {}) {
  const base = normalizeArchiveMedia(candidate);
  const attempts = base.attempts + 1;
  const local = await buildArchiveMediaCopy(base.url, { rotation: candidate?.rotation || 0 });
  const localUrl = local.ok ? local.url : '';
  const displayUrl = localUrl || base.url;
  const hasUrl = Boolean(displayUrl);
  const storageKey = base.storageKey || archiveMediaStorageKey({ kind: base.kind, index, ...keyScope });
  // `local` 只表示「对象存储未接入、只剩本机持久副本」；上传**失败**是 `pending`（可重试），
  // 两者都不阻断归档。连一个地址都没有才是 `missing`（家长端占位）。
  const fallback = createArchiveMediaEntry({
    kind: base.kind,
    name: base.name,
    url: displayUrl,
    status: hasUrl ? (localUrl ? 'local' : 'pending') : 'missing',
    storage: localUrl ? ARCHIVE_MEDIA_LOCAL_STORAGE.id : '',
    storageKey: '',
    attempts,
    lastError: local.ok ? '' : local.reason,
    updatedAt: new Date().toISOString()
  });

  if (!hasUrl) {
    return { ok: false, entry: fallback, status: 'missing', reason: local.reason || '没有可同步的素材。' };
  }
  let blob = null;
  try {
    blob = await sourceToBlob(displayUrl);
  } catch (error) {
    const reason = str(error?.message) || '素材读取失败。';
    return { ok: false, entry: createArchiveMediaEntry({ ...fallback, status: 'pending', lastError: reason }), status: 'pending', reason };
  }

  // 超时是**双保险**：① AbortController 让真实的 fetch 断掉；② `Promise.race` 保证即使上传器
  // 不理会 signal（替身 / 卡死的实现）也不会把归档一直挂在 await 上（「上传失败不阻断归档」）。
  const limited = timeoutMsOf(timeoutMs);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      const error = new Error(`上传超过 ${limited / 1000} 秒未完成。`);
      error.name = 'ArchiveMediaTimeout';
      reject(error);
    }, limited);
  });
  try {
    const payload = await Promise.race([
      uploader({ kind: base.kind, name: base.name, blob, storageKey, signal: controller ? controller.signal : undefined }),
      timeout
    ]);
    // 第一道闸门：服务端声明的落点必须合格（本地磁盘 / 公开桶一律拒绝）。
    const sink = assertChildMediaStorage(payload || {});
    // 第二道闸门：地址必须是 https 持久地址，否则「同步成功」是不成立的。
    const urlIssue = persistentMediaUrlIssue(payload?.url);
    if (urlIssue) {
      const reason = `${childMediaStorageLabel(sink.id)}声明的地址不是持久地址：${urlIssue}`;
      return { ok: false, entry: createArchiveMediaEntry({ ...fallback, status: 'local', lastError: reason }), status: 'local', reason };
    }
    const syncedStorageKey = str(payload?.storageKey) || storageKey;
    return {
      ok: true,
      status: 'synced',
      reason: '',
      entry: createArchiveMediaEntry({
        kind: base.kind,
        name: base.name,
        url: str(payload.url),
        status: 'synced',
        storage: sink.sinkId || ARCHIVE_MEDIA_OBJECT_STORAGE.id,
        storageKey: syncedStorageKey,
        attempts,
        lastError: '',
        updatedAt: new Date().toISOString()
      })
    };
  } catch (error) {
    const timedOut = str(error?.name) === 'ArchiveMediaTimeout' || str(error?.name) === 'AbortError';
    const reason = timedOut ? `上传超过 ${limited / 1000} 秒未完成。` : (str(error?.message) || '上传失败。');
    return { ok: false, entry: createArchiveMediaEntry({ ...fallback, status: 'pending', lastError: reason }), status: 'pending', reason };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 同步一整份素材清单（归档那一刻调用）。**串行**执行（对象存储的写入按条计数、便于逐条报错），
 * 逐条永不抛错 —— 归档只需要等一个「尽量试过」的结果。
 * `rotation` 只在候选阶段有意义（要烘进副本像素），所以按序号从候选里取。
 */
export async function syncArchiveMedia(candidates, options = {}) {
  const raw = Array.isArray(candidates) ? candidates : [];
  const list = normalizeArchiveMediaList(raw);
  const keyScope = options.keyScope || {};
  const out = [];
  for (let index = 0; index < list.length; index += 1) {
    const rotation = Number(raw[index]?.rotation) || 0;
    const prepared = rotation ? { ...list[index], rotation } : list[index];
    // eslint-disable-next-line no-await-in-loop -- 串行是有意的：逐条上传、逐条留痕
    const result = await syncArchiveMediaEntry(prepared, { ...options, index, keyScope });
    out.push(result.entry);
  }
  return out;
}

/** 归档那一刻的完整编排：候选 → 同步 → 素材清单 + 汇总（界面 / 记录都读它的产物）。 */
export async function prepareArchiveMedia({ framedArtwork = null, photos = [], photoLimit = 0, ...options } = {}) {
  const prepared = archiveMediaCandidates({ framedArtwork, photos, limit: photoLimit });
  const media = await syncArchiveMedia(prepared.candidates, options);
  return { candidates: prepared.candidates, ignoredPhotos: prepared.ignoredPhotos, media, summary: archiveMediaSyncSummary(media) };
}

/**
 * 重试一条记录里还没同步成功的素材（第四步面板 / 管理端清单共用同一个入口）。
 *
 * 入参是记录本身：每条素材的 `url` 就是本机持久副本，重试时拿它当上传源。
 * 返回 `{record, media, summary, view}` —— 记录用 `applyArchiveMediaSync` 就地换素材，
 * **不动 version / updatedAt**（素材同步不是老师改正文）。
 */
export async function retryArchiveMediaRecord(record, options = {}) {
  const source = record && typeof record === 'object' ? record : {};
  const list = normalizeArchiveMediaList(source.media);
  const keyScope = { studentId: str(source.studentId), lessonId: str(source.lessonId), lessonDate: str(source.date) };
  const next = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    if (!archiveMediaCanSync(item)) { next.push(item); continue; }
    // eslint-disable-next-line no-await-in-loop -- 同上：逐条重试，逐条留痕
    const result = await syncArchiveMediaEntry(item, { ...options, index, keyScope });
    next.push(result.entry);
  }
  const updated = applyArchiveMediaSync(source, next);
  return { record: updated, media: next, summary: archiveMediaSyncSummary(next), view: archiveMediaRecordView(updated) };
}

/** 界面读数：这次归档的素材同步结果一句话（toast / 面板副标题共用）。 */
export function archiveMediaResultText(summary) {
  if (!summary) return '';
  if (!summary.total) return '本次没有需要同步的素材。';
  if (summary.status === 'synced') return `素材已同步到对象存储（${summary.counts.synced} 张）。`;
  if (summary.status === 'local') return `素材已随档案留存为本地持久副本（${summary.counts.local} 张），对象存储未接入：家长端会显示「图片同步中」。`;
  if (summary.status === 'pending') return `素材上传未成功（${summary.counts.pending} 张），已标记「图片同步中」，可在档案里重试。`;
  return `素材缺失（${summary.counts.missing} 张）：家长端会显示「图片同步中」占位。`;
}

export { isPersistentMediaUrl };
