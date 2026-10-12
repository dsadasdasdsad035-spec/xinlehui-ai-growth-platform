/**
 * 归档素材的**持久化与降级**规则（[第四步 US-203] / tasks/prd-archive-share.md US-203）。
 *
 * 一条归档记录里除了正文与点评，还要能带着**图**给家长看。老师端的素材本来都是会话内的
 * object URL（blob:）—— 刷新即失效、家长端根本取不到，所以归档这一刻必须把它们换成
 * **持久地址**：
 *
 *  ① `synced`：私有对象存储里的 https 地址（带 `storageKey`）。生产口径，家长端直接能看；
 *  ② `local`  ：对象存储还没接入时的**降级**：只留一份**本地持久副本**（data URL，跟着记录
 *     进本机镜像），界面上明确标注「仅本地留存（对象存储未接入）」，家长端显示占位；
 *  ③ `pending`：上传失败 / 还没试过（例如开发适配器没启动）——**不阻断归档**，素材标成
 *     「图片同步中」并给出重试入口；
 *  ④ `missing`：连本地副本都没有（例如配额清理把地址摘掉了）——同样只是占位，不出现破图。
 *
 * 另外两条硬口径：
 *  - **原图永不上传**：`originalUrl` / `orientedUrl` 这类字段在结构上就进不了归档 payload
 *    （见 `stripOriginalMediaFields` 与 `archivePayloadOriginalIssue`，断言可直查）；
 *  - **非持久地址不入库**：写云端前一律过 `cloudArchiveMedia`，只有 https 地址进得去，
 *    其余地址原样丢掉、只剩一条 `pending` 的占位记录（家长端据此显示「图片同步中」）。
 *
 * 本模块是**零依赖纯函数 + 常量**（唯一 import 是同样零依赖的 `data/artworkWriteBack.js`，
 * 复用「档案展示口径」那一份常量，不抄第二份），可直接用 Node 跑断言；做网络 / 画布动作的
 * 部分在 `services/archiveMediaApi.js`。
 */

import { ARTWORK_WRITE_BACK_IMAGE } from './artworkWriteBack';

/** 归档素材的两类：装裱成品图与修正后的课堂照片。原图不在这两类里（FR-46 / US-203）。 */
export const ARCHIVE_MEDIA_KINDS = [
  { id: 'artwork', label: '装裱成品图', note: '老师装裱 / 保存后的成品图，档案与家长端展示的就是它。' },
  { id: 'photo', label: '修正后的课堂照片', note: '旋转校正后的课堂照片；原始拍摄图（originalUrl）不进归档。' }
];

/**
 * 素材同步状态。**四种都不算错误**：没有对象存储时降级是正常结果（只是要标注清楚）。
 * `placeholder: true` 的两态在家长端一律渲染成「图片同步中」占位，而不是破图。
 */
export const ARCHIVE_MEDIA_STATUSES = [
  { id: 'synced', label: '已同步到对象存储', short: '已同步', tone: 'ok', note: 'https 持久地址 + storageKey 已写入素材记录。' },
  { id: 'pending', label: '图片同步中', short: '同步中', tone: 'warn', note: '上传还没成功：记录照常归档，素材留在本地持久副本，可重试同步。' },
  { id: 'local', label: '仅本地留存（对象存储未接入）', short: '仅本地', tone: 'warn', note: '对象存储未接入，素材只有本机持久副本；接入后重试即可补传。' },
  { id: 'missing', label: '素材缺失', short: '缺失', tone: 'muted', note: '连本地副本也没有（例如配额清理），家长端显示占位而不是破图。' }
];

/** 家长端 / 云端缺素材时的占位文案（验收原文）。 */
export const ARCHIVE_MEDIA_PLACEHOLDER_TEXT = '图片同步中';

/** 对象存储这一侧的登记（与 `data/mediaStoragePolicy.js` 的 `private-object-storage` 同一 id）。 */
export const ARCHIVE_MEDIA_OBJECT_STORAGE = Object.freeze({
  id: 'private-object-storage',
  label: '私有对象存储',
  note: '生产口径：私有桶 + 服务端签名，地址是 https。'
});

/** 降级落点：本机持久副本（与 `data/artworkWriteBack.js` 的 `local-persistent-copy` 同一 id）。 */
export const ARCHIVE_MEDIA_LOCAL_STORAGE = Object.freeze({
  id: 'local-persistent-copy',
  label: '本机持久副本',
  note: '素材以 data URL 跟着记录进本机镜像，刷新 / 重开还在，但家长端取不到 —— 接入对象存储前只是降级。'
});

/**
 * 本地持久副本的口径（长边 ≤1600 · JPEG 0.85）。与 `ARTWORK_WRITE_BACK_IMAGE` 是同一组数字：
 * 家长看的本来就是展示口径，而 localStorage 装不下几张原图的 data URL。
 */
export const ARCHIVE_MEDIA_LOCAL_COPY = Object.freeze({
  mimeType: ARTWORK_WRITE_BACK_IMAGE.mimeType,
  maxLongEdge: ARTWORK_WRITE_BACK_IMAGE.maxLongEdge,
  jpegQuality: ARTWORK_WRITE_BACK_IMAGE.jpegQuality,
  label: ARTWORK_WRITE_BACK_IMAGE.label
});

/** 重试入口的文案（第四步面板与管理端清单共用）。 */
export const ARCHIVE_MEDIA_RETRY_LABEL = '重试同步';

/**
 * 一条归档记录最多带几张课堂照片。记录是给家长看的展示口径，不是素材库：
 * 太多张会让本地镜像变重（配额兜底的第一号受害者），超出部分在候选阶段就被忽略并报数。
 */
export const ARCHIVE_MEDIA_PHOTO_LIMIT = 4;

/** 一句话说明（面板副标题）：素材同步状态怎么读。 */
export const ARCHIVE_MEDIA_SYNC_HINT = '归档会同时把装裱成品图与修正后的课堂照片写成素材记录：对象存储接入时是 https 持久地址 + storageKey；未接入时降级为本地持久副本并在界面标注；上传失败不阻断归档，可重试；原图永不上传。';

/** 归档 payload 里**不允许出现**的字段名模式：原图以及任何"还没处理过"的地址（US-203 第 3 条）。 */
export const ARCHIVE_MEDIA_ORIGINAL_KEY_PATTERN = /original/i;

const str = value => (value === null || value === undefined ? '' : String(value).trim());

/** FNV-1a 32 位（与 `data/feedbackRecords.js` / `data/artworkLayers.js` 同一套算法）。 */
function archiveMediaHash(text) {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function normalizeArchiveMediaKind(kind) {
  const value = str(kind);
  return ARCHIVE_MEDIA_KINDS.some(item => item.id === value) ? value : 'artwork';
}

/** 素材类别的可读名（认不出回落「素材」，别谎报成成品图）。 */
export function archiveMediaKindLabel(kind) {
  const found = ARCHIVE_MEDIA_KINDS.find(item => item.id === str(kind));
  return found ? found.label : '素材';
}

export function normalizeArchiveMediaStatus(status) {
  const value = str(status);
  return ARCHIVE_MEDIA_STATUSES.some(item => item.id === value) ? value : '';
}

/** 状态的可读名（认不出回落「未知状态」+ 原值，不谎报成已同步）。 */
export function archiveMediaStatusLabel(status) {
  const found = ARCHIVE_MEDIA_STATUSES.find(item => item.id === str(status));
  return found ? found.label : (str(status) ? `未知状态（${str(status)}）` : '未同步');
}

/**
 * **持久地址**的判据（US-203 第 4 条）：只有 `https://` 才算。
 * `http://`（含本地开发适配器的 127.0.0.1 地址）/ `blob:`（会话内）/ `data:`（本机副本）/
 * 空串都不算 —— 它们写进云端只会让家长端看到一张取不到的图。
 */
export function persistentMediaUrlIssue(url) {
  const value = str(url);
  if (!value) return '素材地址为空。';
  if (value.startsWith('https://')) return '';
  if (value.startsWith('http://')) return `不是 https 持久地址（${value.slice(0, 60)}）：http 地址不入库。`;
  if (value.startsWith('blob:')) return '会话内地址（blob:）刷新即失效，不能入库。';
  if (value.startsWith('data:')) return '本机内嵌副本（data:）只有本机能读，不能入库。';
  return `无法识别的素材地址（${value.slice(0, 40)}）：只有 https 持久地址可以入库。`;
}

export function isPersistentMediaUrl(url) {
  return !persistentMediaUrlIssue(url);
}

/** 从地址推状态（脏数据兜底：没有显式状态时按地址判断，而不是一律当成已同步）。 */
export function archiveMediaStatusFromUrl(url) {
  const value = str(url);
  if (!value) return 'missing';
  if (value.startsWith('https://')) return 'synced';
  if (value.startsWith('data:')) return 'local';
  return 'pending';
}

const num = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
};

/**
 * 收敛一条素材记录（读旧记录 / 云端 payload 一律过这一道，永不抛错）。
 *
 * 字段：`kind`（类别）/ `name`（作品名或照片名）/ `url`（当前可显示地址）/
 * `status`（同步状态）/ `storage`（落点 id）/ `storageKey`（对象存储里的键）/
 * `attempts`（试过几次）/ `lastError`（最近一次的可读原因）/ `updatedAt`。
 */
export function normalizeArchiveMedia(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const url = str(source.url);
  const status = normalizeArchiveMediaStatus(source.status) || archiveMediaStatusFromUrl(url);
  return {
    kind: normalizeArchiveMediaKind(source.kind),
    name: str(source.name),
    url,
    status,
    storage: str(source.storage) || (status === 'synced' ? ARCHIVE_MEDIA_OBJECT_STORAGE.id : (url ? ARCHIVE_MEDIA_LOCAL_STORAGE.id : '')),
    storageKey: str(source.storageKey),
    attempts: num(source.attempts),
    lastError: str(source.lastError),
    updatedAt: str(source.updatedAt)
  };
}

/** 收敛一整份素材清单（非数组 → 空数组；逐条 normalize）。 */
export function normalizeArchiveMediaList(list) {
  return (Array.isArray(list) ? list : [])
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map(normalizeArchiveMedia);
}

/** 造一条素材记录：状态没给就按地址推（见 `archiveMediaStatusFromUrl`）。 */
export function createArchiveMediaEntry({ kind = 'artwork', name = '', url = '', status = '', storage = '', storageKey = '', attempts = 0, lastError = '', updatedAt = '' } = {}) {
  return normalizeArchiveMedia({ kind, name, url, status, storage, storageKey, attempts, lastError, updatedAt });
}

/**
 * 归档这一刻的**候选素材**（只从成品图与修正后的照片里取，原图不经这里）：
 * 空地址的候选直接丢掉（宁可不带，也不带一个假地址）。
 * `photos` 里超过 `limit` 的份数被忽略并在返回值里报数（与素材上限同一条口径）。
 */
export function archiveMediaCandidates({ framedArtwork = null, photos = [], limit = 0 } = {}) {
  const artwork = framedArtwork && typeof framedArtwork === 'object' ? framedArtwork : {};
  const candidates = [];
  if (str(artwork.url)) {
    candidates.push({ kind: 'artwork', name: str(artwork.name) || '装裱成品图', url: str(artwork.url), rotation: num(artwork.rotation) });
  }
  const source = (Array.isArray(photos) ? photos : []).filter(item => item && str(item.url));
  const capped = Number(limit) > 0 ? source.slice(0, Math.trunc(Number(limit))) : source;
  capped.forEach(item => {
    candidates.push({ kind: 'photo', name: str(item.name) || '课堂照片', url: str(item.url), rotation: num(item.rotation) });
  });
  return { candidates, ignoredPhotos: source.length - capped.length };
}

/**
 * 对象存储里的键（幂等：同一个学员的同一类素材每次算出同一个键，重复上传不会多出一份）。
 * 形状 `archive/<kind>/<hash>.jpg` —— 中文姓名 / id 只参与哈希，不进路径。
 */
export function archiveMediaStorageKey({ kind = 'artwork', index = 0, studentId = '', lessonId = '', lessonDate = '', classId = '' } = {}) {
  const mediaKind = normalizeArchiveMediaKind(kind);
  const seed = [mediaKind, str(studentId) || str(classId), str(lessonId) || str(lessonDate), String(num(index))].join('|');
  return `archive/${mediaKind}/${archiveMediaHash(seed)}.jpg`;
}

/** 这条素材能不能再试一次同步：已经有 https 持久地址的不必重试（重试也只是白跑一趟）。 */
export function archiveMediaCanSync(entry) {
  const media = normalizeArchiveMedia(entry);
  if (!media.url && media.status === 'missing') return false;
  return !isPersistentMediaUrl(media.url);
}

/**
 * 某个界面**看到**的素材视图。
 *
 * `surface` 决定「什么地址算能显示」：
 *  - `'teacher'`：本地持久副本也看得到（老师就是在本机归档的）；
 *  - `'cloud'` / `'parent'`：**只有 https 持久地址**能显示，其余一律占位 —— 家长端不可能读到
 *    老师本机的 data URL，宁可显示「图片同步中」，也不要一张破图。
 *
 * 占位是**结构上**的判据（`placeholder`），界面只渲染它，不自己判断地址前缀。
 */
export function archiveMediaView(entry, { surface = 'teacher' } = {}) {
  const media = normalizeArchiveMedia(entry);
  const cloudSide = surface === 'parent' || surface === 'cloud';
  const renderable = cloudSide ? isPersistentMediaUrl(media.url) : Boolean(media.url);
  const placeholder = !renderable;
  // 家长 / 云端口径的状态与 `cloudArchiveMedia` 一致：**只有 https 才算已同步**，其余一律
  // 「图片同步中」—— parent 一侧读到 `local`（仅本地留存）这种老师端词汇只会让人困惑，
  // 而家长能感知的事实只有「现在看不看得到图」。
  const status = cloudSide && placeholder ? 'pending' : media.status;
  return {
    kind: media.kind,
    kindLabel: archiveMediaKindLabel(media.kind),
    name: media.name,
    status,
    statusLabel: archiveMediaStatusLabel(status),
    storage: media.storage,
    storageKey: media.storageKey,
    url: renderable ? media.url : '',
    placeholder,
    placeholderText: placeholder ? ARCHIVE_MEDIA_PLACEHOLDER_TEXT : '',
    attemptText: archiveMediaAttemptText(media)
  };
}

/** 「已尝试 N 次 · 最近一次：<原因>」这类读数（没试过就空串）。 */
export function archiveMediaAttemptText(entry) {
  const media = normalizeArchiveMedia(entry);
  if (!media.attempts && !media.lastError) return '';
  const tried = media.attempts ? `已尝试 ${media.attempts} 次` : '尚未尝试上传';
  return media.lastError ? `${tried} · 最近一次：${media.lastError}` : tried;
}

const STATUS_ORDER = ['pending', 'local', 'missing', 'synced'];

/** 一个记录 / 一份素材清单的汇总（状态取「最需要处理」的那一个，与界面文案同源）。 */
export function archiveMediaSyncSummary(media) {
  const list = normalizeArchiveMediaList(media);
  const counts = { synced: 0, pending: 0, local: 0, missing: 0 };
  list.forEach(item => { counts[item.status] = (counts[item.status] || 0) + 1; });
  const status = list.length ? (STATUS_ORDER.find(item => counts[item] > 0) || 'synced') : 'none';
  const parts = [];
  if (counts.synced) parts.push(`${counts.synced} 张已同步到对象存储`);
  if (counts.pending) parts.push(`${counts.pending} 张图片同步中`);
  if (counts.local) parts.push(`${counts.local} 张仅本地留存（对象存储未接入）`);
  if (counts.missing) parts.push(`${counts.missing} 张素材缺失`);
  const text = list.length
    ? (status === 'synced'
      ? `${parts.join(' · ')}：家长端可以直接看到这些素材。`
      : `${parts.join(' · ')}：记录已经归档，素材可以重试同步。`)
    : '这条记录还没有素材需要同步。';
  return { total: list.length, counts, status, text, canRetry: list.some(item => archiveMediaCanSync(item)) };
}

/**
 * 一条记录在界面上要读的那一份（第四步面板 / 管理端清单 / 家长端都读它，避免各处自己算状态）。
 */
export function archiveMediaRecordView(record) {
  const source = record && typeof record === 'object' ? record : {};
  const media = normalizeArchiveMediaList(source.media);
  const summary = archiveMediaSyncSummary(media);
  return {
    media,
    summary,
    status: summary.status,
    statusLabel: summary.status === 'none' ? '暂无素材' : archiveMediaStatusLabel(summary.status),
    text: summary.text,
    canRetry: summary.canRetry,
    entries: media.map(item => archiveMediaView(item, { surface: 'teacher' }))
  };
}

/**
 * 写云端之前的地址闸门（US-203 第 4 条 / 沿用 `httpOnly()` 的思路，但更严格：只认 https）。
 *
 * **地址**不是 https 的素材不得入库 —— 但「有素材正在同步」这件事本身要留下：
 * 于是它变成一条 `url: ''` 的 `pending` 记录，家长端据此显示「图片同步中」占位。
 */
export function cloudArchiveMedia(media) {
  return normalizeArchiveMediaList(media).map(item => {
    if (isPersistentMediaUrl(item.url)) {
      return { kind: item.kind, name: item.name, status: 'synced', url: item.url, storage: item.storage || ARCHIVE_MEDIA_OBJECT_STORAGE.id, storageKey: item.storageKey, storageLabel: ARCHIVE_MEDIA_OBJECT_STORAGE.label };
    }
    return { kind: item.kind, name: item.name, status: 'pending', url: '', storage: '', storageKey: '', storageLabel: ARCHIVE_MEDIA_LOCAL_STORAGE.label };
  });
}

/**
 * 递归找出 payload 里**原图字段**的位置（US-203 第 3 条）。
 * 判据只看键名（`/original/i`）：值长什么样都不影响 —— `originalUrl` 这个名字本身就不该出现。
 */
export function findOriginalMediaPaths(payload, prefix = '') {
  const paths = [];
  if (!payload || typeof payload !== 'object') return paths;
  Object.entries(payload).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (ARCHIVE_MEDIA_ORIGINAL_KEY_PATTERN.test(key)) paths.push(path);
    if (value && typeof value === 'object' && !Array.isArray(value)) paths.push(...findOriginalMediaPaths(value, path));
    else if (Array.isArray(value)) value.forEach((item, index) => paths.push(...findOriginalMediaPaths(item, `${path}[${index}]`)));
  });
  return paths;
}

/**
 * 结构上把原图字段摘掉（归档 payload 的唯一入口都要过它）：
 * 深拷贝 + 丢弃键名命中 `/original/i` 的字段，原对象一个字不动。
 */
export function stripOriginalMediaFields(payload) {
  if (Array.isArray(payload)) return payload.map(stripOriginalMediaFields);
  if (!payload || typeof payload !== 'object') return payload;
  const out = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (ARCHIVE_MEDIA_ORIGINAL_KEY_PATTERN.test(key)) return;
    out[key] = stripOriginalMediaFields(value);
  });
  return out;
}

/**
 * 归档 payload 里还有没有原图字段：空串 = 干净，否则是可读的点名原因。
 * 写入侧的正解不是「判断一下」，而是先过 `stripOriginalMediaFields`（结构上就放不进来），
 * 这个函数是给断言与界面读数用的复核口径。
 */
export function archivePayloadOriginalIssue(record) {
  const paths = findOriginalMediaPaths(record);
  if (!paths.length) return '';
  return `归档数据里出现了原图字段（${paths.slice(0, 5).join('、')}）：原图永不上传。`;
}

/**
 * 素材同步结果写回记录（首次归档 / 重试共用）。
 *
 * **不动 `version` 与 `updatedAt`**：它们记的是「老师的正文改到第几版」，素材同步不是老师的修改
 * （否则「档案已更新（第 N 版）」会因为同步成功而谎报一次改稿）。待同步的状态记在 `media` 里。
 */
export function applyArchiveMediaSync(record, media) {
  const source = record && typeof record === 'object' ? record : {};
  return { ...source, media: normalizeArchiveMediaList(media) };
}

/**
 * 配额兜底：只摘掉**非 https 的本地副本地址**（data: URL 这种几百 KB 的大块字符串），
 * 并把状态降级为「同步中」—— 不谎报已同步。https 持久地址几乎不占空间，原样保留
 * （摘掉它只会让家长端凭空少一张本来就有的图）。
 */
export function stripArchiveMediaUrls(record) {
  const source = record && typeof record === 'object' ? record : {};
  const media = normalizeArchiveMediaList(source.media).map(item => {
    if (!item.url || isPersistentMediaUrl(item.url)) return item;
    return {
      ...item,
      url: '',
      status: item.status === 'missing' ? 'missing' : 'pending',
      storage: '',
      storageKey: '',
      lastError: item.lastError || '本机副本已随配额清理，请重试同步。'
    };
  });
  return { ...source, media };
}

/**
 * 管理端的「素材同步失败」清单（待处理的素材才进清单；已同步的不出现）：
 * 每条给出记录身份 + 待处理的素材条目 + 一句可读原因。
 */
export function pendingArchiveMediaRecords(records) {
  return (Array.isArray(records) ? records : [])
    .map(record => {
      const source = record && typeof record === 'object' ? record : {};
      const pending = normalizeArchiveMediaList(source.media).filter(item => archiveMediaCanSync(item));
      if (!pending.length) return null;
      const summary = archiveMediaSyncSummary(pending);
      return {
        id: str(source.id),
        student: str(source.student),
        className: str(source.className),
        date: str(source.date),
        title: str(source.title),
        entries: pending,
        status: summary.status,
        reasonText: summary.text,
        attemptText: pending.map(item => `${archiveMediaKindLabel(item.kind)}：${archiveMediaAttemptText(item) || '尚未尝试上传'}`).join('；')
      };
    })
    .filter(Boolean);
}
