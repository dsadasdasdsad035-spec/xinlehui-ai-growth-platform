// 归档数据的**保留期与到期清理**（[第四步 US-211] / F-ARCHIVE-PERM-01）。
//
// 验收原文：「归档数据保留期可配置（默认与平台隐私策略一致），到期清理需可预览影响范围」。
// 三条口径都在这里（零依赖纯函数 + 常量，可 `node` 直跑断言）：
//
//  ① **默认保留期与平台隐私策略一致**：平台「系统配置 → 数据保存与隐私」的默认是 365 天，
//     这里就用 `ARCHIVE_RETENTION_DEFAULT_DAYS = 365`；服务端也声明同一份默认
//     （`GET /api/compliance/archive-policy` 的 `retention.defaultDays`，管理端面板拿它对表）。
//  ② **保留期可配**：180 / 365（默认）/ 730 天与「长期保留（不自动清理）」；脏数据收敛到区间里，永不抛错。
//     「长期保留」= `retentionDays: 0`（没有截止日，清理永远是 0 条）。
//  ③ **到期清理先预览影响范围**：预览与执行读**同一份**纯函数（`archiveCleanupPreview` /
//     `applyArchiveRetentionCleanup`），所以不会出现「预览说 3 条、执行删掉 5 条」。
//     预览逐条报出「哪位学员、哪一天、第几版、几张素材、几条分享链接」—— 删的是孩子的成长记录，
//     影响范围必须先看清楚（与 `data/reviewTracePolicy.js` 的到期清理同一条纪律）。
//
// 到期判据锚在**归档时间**（`record.archivedAt`）而不是课次日期：保留期算的是「归档数据留了多久」。
// 读不出归档时间的记录按课次日期兜底（`date`），两个都读不出就**不清理**（宁可留着，也不误删）。

/** 本机镜像的键（与 `xinlehui-review-trace-policy-v1` 同一套：配置只在本机落地）。 */
export const ARCHIVE_RETENTION_STORAGE_KEY = 'xinlehui-archive-retention-v1';

/** 默认保留期：与平台隐私策略一致（365 天）。 */
export const ARCHIVE_RETENTION_DEFAULT_DAYS = 365;

/** 收敛区间（天）：1 ~ 3650；0 = 长期保留（不自动清理）。 */
export const ARCHIVE_RETENTION_RANGE = [1, 3650];

/** 下拉可选项（面板与断言读同一份）。 */
export const ARCHIVE_RETENTION_OPTIONS = [
  { days: 180, label: '180 天' },
  { days: 365, label: `365 天（默认 · 与平台隐私策略一致）` },
  { days: 730, label: '730 天' },
  { days: 0, label: '长期保留（不自动清理）' }
];

/** 界面文案（唯一真源，界面不各写一份）。 */
export const ARCHIVE_RETENTION_SECTION_TITLE = '归档数据：保留期与到期清理';
export const ARCHIVE_RETENTION_SECTION_DESC = '保留期默认与平台隐私策略一致（365 天）；到期清理前会先列出将被清理的档案与影响范围，确认后才执行。';
export const ARCHIVE_RETENTION_PREVIEW_LABEL = '预览到期清理影响范围';
export const ARCHIVE_RETENTION_CLEANUP_LABEL = '执行清理';
export const ARCHIVE_RETENTION_POLICY_NOTE = '保留期从每条档案的「归档时间」起算；课次日期只用于展示。清理只删到期的那几条，未到期的档案一条都不动。';
export const ARCHIVE_RETENTION_LONG_TERM_TEXT = '长期保留（不自动清理）';
export const ARCHIVE_RETENTION_EMPTY_PREVIEW_TEXT = '还没有归档记录可以清理：成长档案里一条记录都没有。';

const str = value => (value === null || value === undefined ? '' : String(value).trim());
const pad2 = value => String(value).padStart(2, '0');
const DAY_MS = 24 * 60 * 60 * 1000;

/** 时间入参：Date / ISO / 时间戳；读不出来回落「现在」（永不抛错）。 */
function toTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(str(value));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** 日期读数：「2026-10-12」（读不出来原样返回）。 */
export function archiveRetentionDateText(value) {
  const text = str(value);
  if (!text) return '';
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text;
  const date = new Date(parsed);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 保留天数收敛：非数字 / 负数回落默认（365 天）；越界收敛到区间里；`0` 与 `'长期'` = 长期保留。 */
export function normalizeArchiveRetentionDays(value) {
  const text = str(value);
  if (text === '长期' || text === '长期保留') return 0;
  const days = Math.trunc(Number(value));
  if (!Number.isFinite(days)) return ARCHIVE_RETENTION_DEFAULT_DAYS;
  if (days < 0) return ARCHIVE_RETENTION_DEFAULT_DAYS;
  if (days === 0) return 0;
  const [min, max] = ARCHIVE_RETENTION_RANGE;
  return Math.min(max, Math.max(min, days));
}

/** 归一化策略：`{retentionDays, longTerm, updatedBy, updatedAt}`（永不抛错）。 */
export function normalizeArchiveRetentionPolicy(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const retentionDays = normalizeArchiveRetentionDays(source.retentionDays);
  return {
    retentionDays,
    longTerm: retentionDays === 0,
    updatedBy: str(source.updatedBy),
    updatedAt: str(source.updatedAt)
  };
}

/** 保留期的可读说法（下拉选项里的那一个；自定义天数原样报出来）。 */
export function archiveRetentionText(value) {
  const days = normalizeArchiveRetentionDays(value);
  if (days === 0) return ARCHIVE_RETENTION_LONG_TERM_TEXT;
  const option = ARCHIVE_RETENTION_OPTIONS.find(item => item.days === days);
  if (option) return option.label;
  return `${days} 天`;
}

/** 改策略（唯一写入口）：脏补丁收敛、留痕 `updatedBy` / `updatedAt`（与轨迹策略同一条纪律）。 */
export function archiveRetentionPolicyPatch(policy, patch = {}, { updatedBy = '', at = '' } = {}) {
  const current = normalizeArchiveRetentionPolicy(policy);
  const next = patch && typeof patch === 'object' ? patch : {};
  const merged = {
    ...current,
    ...('retentionDays' in next ? { retentionDays: next.retentionDays } : {})
  };
  const normalized = normalizeArchiveRetentionPolicy(merged);
  return {
    ...normalized,
    updatedBy: str(updatedBy) || current.updatedBy,
    updatedAt: str(at) || new Date().toISOString()
  };
}

/** 面板上的一行读数：「保留 365 天（默认 · 与平台隐私策略一致） · 最近变更：平台管理员 2026-10-12 10:00」。 */
export function archiveRetentionSummary(policy) {
  const item = normalizeArchiveRetentionPolicy(policy);
  const parts = [`保留 ${archiveRetentionText(item.retentionDays)}`];
  if (item.updatedBy || item.updatedAt) {
    const who = item.updatedBy || '未知操作人';
    const when = archiveRetentionDateText(item.updatedAt);
    parts.push(`最近变更：${who}${when ? ` ${when}` : ''}`);
  } else {
    parts.push('尚未修改过');
  }
  return parts.join(' · ');
}

/** 读本机镜像：读坏回落默认策略（不抛错、不编造修改人）。 */
export function loadArchiveRetentionPolicy() {
  if (typeof window === 'undefined' || !window.localStorage) return normalizeArchiveRetentionPolicy({ retentionDays: ARCHIVE_RETENTION_DEFAULT_DAYS });
  let parsed = null;
  try { parsed = JSON.parse(window.localStorage.getItem(ARCHIVE_RETENTION_STORAGE_KEY)); } catch { parsed = null; }
  return normalizeArchiveRetentionPolicy(parsed && typeof parsed === 'object' ? parsed : { retentionDays: ARCHIVE_RETENTION_DEFAULT_DAYS });
}

/** 落本机镜像（配额不够时静默跳过：策略已经在本机界面上生效）。 */
export function persistArchiveRetentionPolicy(policy) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try { window.localStorage.setItem(ARCHIVE_RETENTION_STORAGE_KEY, JSON.stringify(normalizeArchiveRetentionPolicy(policy))); } catch { /* 配额满：不阻断配置 */ }
}

/** 到期截止时刻（ISO）：长期保留返回空串（没有截止日）。 */
export function archiveRetentionCutoff(policy, now = null) {
  const item = normalizeArchiveRetentionPolicy(policy);
  if (item.retentionDays === 0) return '';
  return new Date(toTime(now) - item.retentionDays * DAY_MS).toISOString();
}

/** 一条记录的保留期锚点：归档时间优先，退回课次日期；两个都读不出返回空串。 */
export function archiveRecordRetentionAnchor(record) {
  const source = record && typeof record === 'object' ? record : {};
  return str(source.archivedAt) || str(source.date);
}

/** 这条记录到期了吗（读不出锚点 → false：宁可留着也不误删）。 */
export function isArchiveRecordExpired(record, policy, now = null) {
  const cutoff = archiveRetentionCutoff(policy, now);
  if (!cutoff) return false;
  const anchor = archiveRecordRetentionAnchor(record);
  if (!anchor) return false;
  const time = Date.parse(anchor);
  if (!Number.isFinite(time)) return false;
  return time < Date.parse(cutoff);
}

/**
 * 一条记录的素材张数（成品图 + 课堂照片；读不到就是 0）。
 * 真实记录上 `media` 是**扁平的素材数组**（每项带 `kind`，见 `data/archiveMedia.js` 的
 * `normalizeArchiveMediaList`）；这里也容忍 `{artwork, photos}` 这种分组写法（老的夹具 / 手写快照），
 * 两种形状数出来的是同一件事。
 */
function archiveRecordMediaCount(record) {
  const media = record && typeof record === 'object' ? record.media : null;
  if (Array.isArray(media)) return media.filter(item => item && typeof item === 'object').length;
  if (media && typeof media === 'object') {
    return ['artwork', 'photos'].reduce((total, key) => total + (Array.isArray(media[key]) ? media[key].length : 0), 0);
  }
  return 0;
}

/** 这条记录名下的分享链接条数（令牌账里按学员名数）。 */
function archiveRecordShareCount(tokens, record) {
  const student = str(record && record.student);
  if (!student) return 0;
  return (Array.isArray(tokens) ? tokens : []).filter(item => str(item && item.student) === student).length;
}

/** 预览里的一行（逐条说清「删的是谁、哪一天、第几版、影响多少素材与链接」）。 */
function archiveCleanupRow(record, tokens) {
  const source = record && typeof record === 'object' ? record : {};
  const student = str(source.student) || '未命名学员';
  const date = archiveRetentionDateText(source.date);
  const version = Math.trunc(Number(source.version));
  const mediaCount = archiveRecordMediaCount(source);
  const shareCount = archiveRecordShareCount(tokens, source);
  const parts = [student];
  if (date) parts.push(date);
  if (str(source.title)) parts.push(`《${str(source.title)}》`);
  const details = [];
  if (Number.isFinite(version) && version > 0) details.push(`第 ${version} 版`);
  if (mediaCount) details.push(`${mediaCount} 张素材`);
  if (shareCount) details.push(`${shareCount} 条分享链接`);
  const archivedText = archiveRetentionDateText(source.archivedAt);
  if (archivedText) details.push(`归档于 ${archivedText}`);
  return {
    id: str(source.id),
    student,
    className: str(source.className),
    date,
    archivedAt: str(source.archivedAt),
    version: Number.isFinite(version) && version > 0 ? version : 1,
    mediaCount,
    shareCount,
    text: `${parts.join(' · ')}${details.length ? ` · ${details.join(' · ')}` : ''}`
  };
}

/**
 * **到期清理的预览**（验收第 3 条）：按策略算出截止日、将被清理的条数与逐条明细、保留条数。
 * 预览与执行共用这一份（`applyArchiveRetentionCleanup` 直接调它）——「预览说几条就删几条」是结构性的。
 */
export function archiveCleanupPreview(records, policy, now = null, { tokens = [] } = {}) {
  const list = (Array.isArray(records) ? records : []).filter(item => item && typeof item === 'object');
  const item = normalizeArchiveRetentionPolicy(policy);
  const cutoff = archiveRetentionCutoff(item, now);
  const expired = list.filter(record => isArchiveRecordExpired(record, item, now)).map(record => archiveCleanupRow(record, tokens));
  const total = list.length;
  const expiredCount = expired.length;
  const keepCount = total - expiredCount;
  const mediaTotal = expired.reduce((sum, row) => sum + row.mediaCount, 0);
  const shareTotal = expired.reduce((sum, row) => sum + row.shareCount, 0);
  const retentionText = archiveRetentionText(item.retentionDays);
  const cutoffText = cutoff ? archiveRetentionDateText(cutoff) : '';
  const text = total === 0
    ? ARCHIVE_RETENTION_EMPTY_PREVIEW_TEXT
    : cutoffText
      ? `按「保留 ${retentionText}」计算：截止 ${cutoffText} 之前归档的档案将到期清理，共 ${expiredCount} 条（涉及 ${mediaTotal} 张素材、${shareTotal} 条分享链接）；保留 ${keepCount} 条（当前共 ${total} 条）。`
      : `按「${retentionText}」计算：没有截止日，不会自动清理任何档案（当前共 ${total} 条）。`;
  return {
    retentionDays: item.retentionDays,
    retentionText,
    longTerm: item.longTerm,
    cutoff,
    cutoffText,
    total,
    expiredCount,
    keepCount,
    mediaTotal,
    shareTotal,
    expired,
    text
  };
}

/** 执行清理：返回 `{kept, removed, preview}`（`removed` 是被清掉的那些记录，预览与它同源）。 */
export function applyArchiveRetentionCleanup(records, policy, now = null, { tokens = [] } = {}) {
  const list = (Array.isArray(records) ? records : []).filter(item => item && typeof item === 'object');
  const preview = archiveCleanupPreview(list, policy, now, { tokens });
  const expiredIds = new Set(preview.expired.map(row => row.id));
  const kept = list.filter(record => !expiredIds.has(str(record.id)));
  const removed = list.filter(record => expiredIds.has(str(record.id)));
  return { kept, removed, preview };
}

/** 清理完成后的回执（面板与 toast 读同一句）。 */
export function archiveCleanupNotice(preview = {}) {
  const count = Math.trunc(Number(preview.expiredCount)) || 0;
  if (!count) return '没有到期档案需要清理。';
  return `已按「保留 ${str(preview.retentionText)}」清理 ${count} 条到期档案（截止 ${str(preview.cutoffText) || '—'}）。`;
}
