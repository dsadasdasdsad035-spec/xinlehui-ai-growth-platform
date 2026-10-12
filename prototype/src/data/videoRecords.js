// 成片记录（云端表 `video_records`）—— 版本 / 更新提示 / 历史版本 / 删除与级联的唯一真源
// （[第四步 US-222] / FR-301 ~ FR-304，tasks/prd-archive-share.md 的 US-222）。
//
// 「老师改完作品之后，视频该不该重做，要有主动权」拆成五件事，全部收在这一份**零依赖纯模块**里
// （界面只渲染它的产物，可 `node` 直跑断言）：
//
//  ① **唯一键 `videoKey` = 对象 + 周期 + 类型**（FR-301）：与渲染任务的 `jobKey` **同构**
//     （同一条成片与它的渲染任务共用同一个业务键 —— 键怎么拼只在 `data/videoJobs.js` 算一次，
//     这里只做委托，不抄第二份拼法）。`version / generatedAt / specSnapshot` 是落库必填
//     （`videoRecordMissingFields` 可当场查缺哪一项）。
//  ② **不自动重出**（FR-302）：归档作品更新后，这一份记录**一个字节都不动** ——
//     `videoRecordUpdateView` 是只读计算，负责数出「有 N 幅作品已更新」并给出那句建议；
//     重新生成本身只能由老师点按钮触发（界面侧），模块里没有任何自动写入路径。
//  ③ **版本与历史**（FR-303）：重新生成走 `updateVideoRecordVersion`，`version` 自增，
//     被替换的那一版整份进 `history`（上限 `VIDEO_RECORD_VERSION_LIMIT`），历史版本可回看；
//     成片三件套（地址 / 时长 / 体积）每一版独立留痕，「可下载」由 `videoOutputView` 判定 ——
//     渲染服务未接入时不提供假 mp4（与 US-219 同一句实话）。
//  ④ **删除只动成片**（FR-304）：`removeVideoRecord` 只摘掉这一条（含历史版本与中间产物记录），
//     归档记录在另一份账里，一个字节都不碰。
//  ⑤ **级联删除**：归档记录被删除时，`videoRecordsCascadeRemoved` 把覆盖到它的成片一起摘掉
//     （界面在到期清理那一处调用；任何新的「删归档记录」入口都必须走这一支）。
//
// 口径不在这里另写一套：状态词表 `VIDEO_JOB_ACTIVE_STATUSES` 与键 / 快照 / 类型都读 `data/videoJobs.js`；
// 周期窗口读 `data/archiveTargets.js` 的 `filterArchiveRecordsByPeriod`；版本读数与时间读数读
// `data/archiveSummary.js`；成片三件套的判定读 `data/videoShare.js` 的 `videoOutputView`（唯一判据）。

import { archiveVersionLabel, formatArchiveTime } from './archiveSummary';
import { filterArchiveRecordsByPeriod, resolveArchivePeriod } from './archiveTargets';
import {
  VIDEO_JOB_ACTIVE_STATUSES,
  normalizeVideoJobSnapshot,
  normalizeVideoJobType,
  videoJobKey,
  videoJobOutputUrlIssue,
  videoJobSpecRows,
  videoJobTypeLabel
} from './videoJobs';
import { VIDEO_DOWNLOAD_UNAVAILABLE_TEXT, videoOutputView } from './videoShare';

const str = value => String(value ?? '').trim();
const num = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const int = value => Math.trunc(num(value));

/** 成片记录的本机镜像键（云端表是 `video_records`）。 */
export const VIDEO_RECORD_STORAGE_KEY = 'xinlehui-video-records-v1';

/** 保留的历史版本数（超出时丢掉最老的 —— 与阶段报告的 6 版同一口径）。 */
export const VIDEO_RECORD_VERSION_LIMIT = 6;

/** 界面文案（一处定义，界面与断言读同一份）。 */
export const VIDEO_RECORD_SECTION_TITLE = '成片版本与更新';
export const VIDEO_RECORD_SECTION_DESC = '一条成片按「对象 + 周期 + 类型」唯一落库（videoKey），带版本号与生成时间。归档里的作品改了不会自动重出成片：这里会提示要不要重新生成；旧版本留在历史里，可回看与下载。';
export const VIDEO_RECORD_TITLE = '生成记录（这一版）';
export const VIDEO_RECORD_EMPTY_TEXT = '还没有成片记录：提交一条视频任务后，这里会落第一版（videoKey / 版本 / 生成时间 / specSnapshot）。';
export const VIDEO_RECORD_EMPTY_ACTION_HINT = '下面的「生成成长记录视频」一提交就会落库。';

/** 验收原文那句提示（唯一一份）：`videoRecordUpdatedHint(n)` 与界面、断言读的都是它。 */
export function videoRecordUpdatedHint(count) {
  return `有 ${Math.max(0, int(count))} 幅作品已更新，建议重新生成`;
}
export const VIDEO_RECORD_ADDED_HINT = count => `有 ${Math.max(0, int(count))} 幅新作品已归档，建议重新生成`;
export const VIDEO_RECORD_REMOVED_HINT = count => `有 ${Math.max(0, int(count))} 幅作品已从档案移除，建议重新生成`;
export const VIDEO_RECORD_IN_SYNC_TEXT = '归档内容与这一版成片一致：成片不会自动重出，改完作品这里会提示重新生成。';
export const VIDEO_RECORD_AUTO_NOTE = '成片不会因为归档更新而自动重出：这里只负责提示，生成由老师点「重新生成」触发。';

/** 动作文案与两步确认（与阶段报告同一套写法）。 */
export const VIDEO_RECORD_REGENERATE_LABEL = '重新生成';
export const VIDEO_RECORD_DELETE_LABEL = '删除成片';
export const VIDEO_RECORD_DELETE_CONFIRM_LABEL = '确认删除';
export const VIDEO_RECORD_DELETE_CANCEL_LABEL = '取消';
export const VIDEO_RECORD_DELETE_NOTE = '删除成片只摘掉这条成片本身（含历史版本与渲染中间产物记录）：归档记录、作品与点评一条都不会动。';
export const VIDEO_RECORD_DELETE_DONE = '成片已删除：历史版本与渲染中间产物一起清掉了，归档记录一条都没有动。';
export const VIDEO_RECORD_REGENERATE_DONE = version => `成片已重新生成（${archiveVersionLabel(version)}）：上一版完整留在历史版本里，可以回看与下载。`;

/** 历史版本区的文案。 */
export const VIDEO_RECORD_HISTORY_TITLE = '历史版本';
export const VIDEO_RECORD_HISTORY_EMPTY = '还没有历史版本：点「重新生成」后，当前这一版会完整保留在这里。';
export const VIDEO_RECORD_HISTORY_NOTE = '历史版本是生成那一刻的冻结快照（对象 / 周期 / 课次与作品数 / 当时的音乐），回看时看到的就是当时的数据。';
export const VIDEO_RECORD_HISTORY_VIEW = '查看这一版';
export const VIDEO_RECORD_HISTORY_BACK = '回到最新版本';
export const VIDEO_RECORD_DOWNLOAD_LABEL = '下载这一版';

/** 成片三件套不齐时那一句实话（历史版本的下载也走它）。 */
export const VIDEO_RECORD_OUTPUT_PENDING_NOTE = '成片地址 / 时长 / 体积由渲染服务给出：接入前这里不显示任何假成片，也不编时长与体积。';
export const VIDEO_RECORD_DOWNLOAD_UNAVAILABLE_TEXT = VIDEO_DOWNLOAD_UNAVAILABLE_TEXT;

/** 本机镜像 / 云端表还没建时的说明（与「阶段报告」的 local note 同一套口径）。 */
export const VIDEO_RECORD_LOCAL_NOTE = '成片记录先落本机镜像；云端 video_records 表接上后随下一次写入同步。';

/** 级联删除的回执（归档记录被清理时，覆盖到它的成片一起被摘掉）。 */
export function videoRecordCascadeNotice(count) {
  const total = Math.max(0, int(count));
  if (!total) return '';
  return `级联删除 ${total} 条成片：这些成片覆盖的归档记录已被清理（成片与渲染中间产物一起清掉，归档记录本身的清理结果不受影响）。`;
}

// ---------------------------------------------------------------------------
// ① 唯一键与落库字段（FR-301）
// ---------------------------------------------------------------------------

/**
 * 成片的业务键 `videoKey`（对象 + 周期 + 类型）：与 `videoJobKey` **同构** ——
 * 委托给它，键怎么拼只有那一份实现（同一条成片与它的渲染任务永远对得上）。
 */
export function videoRecordKey(options = {}) {
  return videoJobKey(options);
}

/** FNV-1a 32 位（与 `data/archiveReports.js` / `data/artworkLayers.js` 同一套算法）。 */
function videoRecordHash(text) {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 成片 id 由 `videoKey` 派生：同一个键永远得到同一个 id（幂等写入的基础）。 */
export function deriveVideoRecordId(videoKey) {
  return `video-record-${videoRecordHash(str(videoKey))}`;
}

/** 验收点名的落库字段（`videoRecordMissingFields` 是必填清单的唯一判据）。 */
export const VIDEO_RECORD_REQUIRED_FIELDS = ['videoKey', 'version', 'generatedAt', 'specSnapshot'];

/** 全部字段白名单（归一化之外的键一律丢掉 —— 与阶段报告同一条口径）。 */
export const VIDEO_RECORD_FIELDS = [
  ...VIDEO_RECORD_REQUIRED_FIELDS,
  'id', 'type', 'studentId', 'classId', 'period', 'objectName', 'generatedBy',
  'sources', 'history', 'outputUrl', 'durationSec', 'bytes'
];

/** 一条成片还缺哪些落库必填项（空数组 = 齐全）。 */
export function videoRecordMissingFields(record) {
  const source = record && typeof record === 'object' ? record : {};
  return VIDEO_RECORD_REQUIRED_FIELDS.filter(field => {
    if (field === 'specSnapshot') return !(source.specSnapshot && typeof source.specSnapshot === 'object');
    if (field === 'version') return !(Number.isFinite(Number(source.version)) && Number(source.version) >= 1);
    return !str(source[field]);
  });
}

// ---------------------------------------------------------------------------
// ② 归档里的「这一版覆盖了哪些作品」（更新提示与级联都读它）
// ---------------------------------------------------------------------------

/** 归档记录的变化指纹（`updatedAt` 优先、退回 `archivedAt`）—— 「有没有更新」只看这个时间戳。 */
function recordStamp(record) {
  const source = record && typeof record === 'object' ? record : {};
  return str(source.updatedAt) || str(source.archivedAt);
}

/** 一条归档记录的身份键（级联与对账都用它：recordKey 优先、退回 id）。 */
function recordIdentity(record) {
  const source = record && typeof record === 'object' ? record : {};
  return str(source.recordKey) || str(source.id);
}

/**
 * 这条成片**覆盖**的归档记录（对象 + 周期窗口）：个人成片按 `record.student`，
 * 班级成片按 `record.className`；周期窗口复用 `filterArchiveRecordsByPeriod`。
 * 返回每一行的**冻结读数**（记录键 / 日期 / 作品名 / 变化指纹），用于生成时的 `sources`
 * 与事后的「有没有更新」对账 —— 两边读同一支函数，口径不可能漂移。
 */
export function videoRecordSources(records = [], { type = 'personal', studentId = '', classId = '', period = '', today = null } = {}) {
  const kind = normalizeVideoJobType(type);
  const objectName = kind === 'class' ? str(classId) : str(studentId);
  const list = filterArchiveRecordsByPeriod(records, resolveArchivePeriod(period), today);
  return list
    .filter(record => {
      const source = record && typeof record === 'object' ? record : null;
      if (!source) return false;
      const owner = kind === 'class' ? str(source.className) : str(source.student);
      return owner === objectName;
    })
    .map(record => ({
      recordKey: str(record.recordKey),
      id: str(record.id),
      student: str(record.student),
      className: str(record.className),
      date: str(record.date),
      title: str(record.title),
      updatedAt: recordStamp(record)
    }))
    .filter(row => row.recordKey || row.id);
}

/** `sources` 归一化：只留身份与指纹（脏行丢掉，绝不抛错）。 */
export function normalizeVideoRecordSources(list) {
  return (Array.isArray(list) ? list : [])
    .map(row => {
      const source = row && typeof row === 'object' ? row : {};
      const recordKey = str(source.recordKey);
      const id = str(source.id);
      if (!recordKey && !id) return null;
      return {
        recordKey,
        id,
        student: str(source.student),
        className: str(source.className),
        date: str(source.date),
        title: str(source.title),
        updatedAt: str(source.updatedAt)
      };
    })
    .filter(Boolean);
}

/** `sources` 行 → 身份键。 */
function sourceIdentity(row) {
  const source = row && typeof row === 'object' ? row : {};
  return str(source.recordKey) || str(source.id);
}

/**
 * 「归档作品更新后不自动重出成片」的**只读对账**（FR-302，验收原文那句提示的唯一来源）：
 *  - `updatedCount`：生成这一版时收录过的记录里，之后又改过的（`updatedAt` / `archivedAt` 比
 *    `generatedAt` 新）—— 这就是「有 N 幅作品已更新」的 N；
 *  - `addedCount`：这一版之后新归档进来的作品（视频里没有它们）；
 *  - `removedCount`：这一版收录过、现在已从档案移除的记录；
 *  - `hint`：三项都为 0 时是「内容一致」的说明，否则给一句具体的建议（updated 优先走验收原文那句）。
 *
 * 这个函数**不写任何东西**：成片记录不会被它改一个字节（「不自动重出」在结构上成立）。
 */
export function videoRecordUpdateView(record, records = []) {
  const current = normalizeVideoRecord(record);
  if (!current) {
    return { present: false, stale: false, updatedCount: 0, addedCount: 0, removedCount: 0, hint: '', detail: '', inSyncText: VIDEO_RECORD_IN_SYNC_TEXT };
  }
  const scoped = videoRecordSources(records, current);
  const byIdentity = new Map(scoped.map(row => [sourceIdentity(row), row]));
  const sourceIds = new Set(current.sources.map(sourceIdentity));
  const updated = current.sources.filter(row => {
    const live = byIdentity.get(sourceIdentity(row));
    if (!live) return false;
    return Boolean(live.updatedAt) && live.updatedAt > current.generatedAt;
  });
  const added = scoped.filter(row => !sourceIds.has(sourceIdentity(row)));
  const removed = current.sources.filter(row => !byIdentity.has(sourceIdentity(row)));
  const updatedCount = updated.length;
  const addedCount = added.length;
  const removedCount = removed.length;
  const stale = updatedCount > 0 || addedCount > 0 || removedCount > 0;
  const hint = updatedCount > 0
    ? videoRecordUpdatedHint(updatedCount)
    : addedCount > 0
      ? VIDEO_RECORD_ADDED_HINT(addedCount)
      : removedCount > 0
        ? VIDEO_RECORD_REMOVED_HINT(removedCount)
        : VIDEO_RECORD_IN_SYNC_TEXT;
  const extras = [];
  if (updatedCount > 0 && addedCount > 0) extras.push(`另有 ${addedCount} 幅新作品已归档`);
  if (updatedCount > 0 && removedCount > 0) extras.push(`另有 ${removedCount} 幅作品已从档案移除`);
  return {
    present: true,
    stale,
    updatedCount,
    addedCount,
    removedCount,
    hint,
    detail: extras.length ? `${extras.join('；')}。${VIDEO_RECORD_AUTO_NOTE}` : VIDEO_RECORD_AUTO_NOTE,
    inSyncText: VIDEO_RECORD_IN_SYNC_TEXT
  };
}

// ---------------------------------------------------------------------------
// ③ 记录实体、归一化与版本历史（FR-301 / FR-303）
// ---------------------------------------------------------------------------

/** 成片三件套归一化：只有 http(s) 地址才算成片地址（与 US-219 同一判据），其余清空。 */
function outputFields(source) {
  const raw = source && typeof source === 'object' ? source : {};
  const url = videoJobOutputUrlIssue(raw.outputUrl) ? '' : str(raw.outputUrl);
  return {
    outputUrl: url,
    durationSec: Math.max(0, num(raw.durationSec)),
    bytes: Math.max(0, int(raw.bytes))
  };
}

/**
 * 新建一份成片记录（**第一版**）：`version: 1`、`history: []`。
 * `generatedAt` 是「这一版是什么时候生成的」；`specSnapshot` 是那一刻的冻结输入；
 * `sources` 是那一刻覆盖的归档记录指纹（更新提示与级联对账都读它）。
 */
export function createVideoRecord({ type = 'personal', studentId = '', classId = '', period = '', objectName = '', specSnapshot = null, generatedAt = '', generatedBy = '', sources = null, outputUrl = '', durationSec = 0, bytes = 0 } = {}) {
  const kind = normalizeVideoJobType(type);
  const videoKey = videoRecordKey({ type: kind, studentId, classId, period });
  const at = str(generatedAt) || new Date().toISOString();
  return {
    videoKey,
    id: deriveVideoRecordId(videoKey),
    type: kind,
    studentId: kind === 'class' ? '' : str(studentId),
    classId: kind === 'class' ? str(classId) : '',
    period: str(period),
    objectName: str(objectName),
    version: 1,
    generatedAt: at,
    generatedBy: str(generatedBy),
    specSnapshot: normalizeVideoJobSnapshot(specSnapshot),
    sources: normalizeVideoRecordSources(sources),
    ...outputFields({ outputUrl, durationSec, bytes }),
    history: []
  };
}

/** 历史版本条目归一化：只保留「有版本号 + 有快照」的行，脏条目丢掉而不是让界面读到 undefined。 */
export function normalizeVideoRecordHistory(list) {
  return (Array.isArray(list) ? list : [])
    .map(entry => {
      const source = entry && typeof entry === 'object' ? entry : {};
      const version = int(source.version);
      if (!Number.isFinite(version) || version <= 0) return null;
      return {
        version,
        generatedAt: str(source.generatedAt),
        generatedBy: str(source.generatedBy),
        specSnapshot: source.specSnapshot && typeof source.specSnapshot === 'object' ? source.specSnapshot : {},
        sources: normalizeVideoRecordSources(source.sources),
        ...outputFields(source)
      };
    })
    .filter(Boolean);
}

/** 读盘 / 云端 payload 一律过这一道：脏值不抛错、缺字段补默认。没有 `videoKey` 就没有身份，丢掉。 */
export function normalizeVideoRecord(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const videoKey = str(source.videoKey) || videoRecordKey({ type: source.type, studentId: source.studentId, classId: source.classId, period: source.period });
  if (!videoKey || videoKey === videoRecordKey({})) return null;
  const version = int(source.version);
  return {
    videoKey,
    id: str(source.id) || deriveVideoRecordId(videoKey),
    type: normalizeVideoJobType(source.type),
    studentId: str(source.studentId),
    classId: str(source.classId),
    period: str(source.period),
    objectName: str(source.objectName),
    version: Number.isFinite(version) && version > 0 ? version : 1,
    generatedAt: str(source.generatedAt),
    generatedBy: str(source.generatedBy),
    specSnapshot: normalizeVideoJobSnapshot(source.specSnapshot),
    sources: normalizeVideoRecordSources(source.sources),
    ...outputFields(source),
    history: normalizeVideoRecordHistory(source.history)
  };
}

/** 按 `videoKey` 去重（同一个键永远只有一份「最新版本」；同键后来者覆盖，位置保序）。 */
export function normalizeVideoRecordList(records) {
  const byKey = new Map();
  (Array.isArray(records) ? records : []).forEach(item => {
    const record = normalizeVideoRecord(item);
    if (record) byKey.set(record.videoKey, record);
  });
  return [...byKey.values()];
}

/** 读盘 / 展示顺序：按生成时间倒序（最近生成的排前面）。 */
export function dedupeVideoRecords(records) {
  return normalizeVideoRecordList(records).sort((a, b) => str(b.generatedAt).localeCompare(str(a.generatedAt)));
}

/** 按 `videoKey` 找那一条（先归一化：界面读到的字段永远齐全）。 */
export function findVideoRecord(records, videoKey) {
  const key = str(videoKey);
  if (!key) return null;
  return normalizeVideoRecordList(records).find(record => record.videoKey === key) || null;
}

/** 生成 / 重新生成之后把它并进列表：同 `videoKey` **就地替换**、其余不动（顺序不动）。 */
export function applyVideoRecord(records, record) {
  const next = normalizeVideoRecord(record);
  const list = normalizeVideoRecordList(records);
  if (!next) return list;
  const index = list.findIndex(item => item.videoKey === next.videoKey);
  if (index < 0) return [next, ...list];
  return list.map((item, position) => (position === index ? next : item));
}

/**
 * 重新生成（FR-303）：`version` 自增，**被替换的那一版整份进 `history`**（最新在前），
 * 超过 `VIDEO_RECORD_VERSION_LIMIT` 时丢掉最老的。`videoKey` / `id` 全程不变。
 * 快照与 `sources` 必须是**为同一个键**重新取的（界面按当前对象与周期取，天然一致）。
 */
export function updateVideoRecordVersion(record, { specSnapshot = null, generatedAt = '', generatedBy = '', sources = null, outputUrl = '', durationSec = 0, bytes = 0 } = {}) {
  const current = normalizeVideoRecord(record);
  if (!current) return createVideoRecord({ specSnapshot, generatedAt, generatedBy, sources, outputUrl, durationSec, bytes });
  const at = str(generatedAt) || new Date().toISOString();
  const previous = {
    version: current.version,
    generatedAt: current.generatedAt,
    generatedBy: current.generatedBy,
    specSnapshot: current.specSnapshot,
    sources: current.sources,
    outputUrl: current.outputUrl,
    durationSec: current.durationSec,
    bytes: current.bytes
  };
  return {
    ...current,
    specSnapshot: specSnapshot && typeof specSnapshot === 'object' ? normalizeVideoJobSnapshot(specSnapshot) : current.specSnapshot,
    sources: sources ? normalizeVideoRecordSources(sources) : current.sources,
    version: current.version + 1,
    generatedAt: at,
    generatedBy: str(generatedBy) || current.generatedBy,
    ...outputFields({ outputUrl, durationSec, bytes }),
    history: [previous, ...current.history].slice(0, VIDEO_RECORD_VERSION_LIMIT)
  };
}

/**
 * 删除成片（FR-304）：只摘掉这一条（含 `history` 与渲染中间产物记录），**归档记录一个字节都不动**
 * （记录在 `xinlehui-feedback-records-v1` / 云端 `feedback_records`，与成片是两套数据）。
 */
export function removeVideoRecord(records, videoKey) {
  const key = str(videoKey);
  if (!key) return normalizeVideoRecordList(records);
  return normalizeVideoRecordList(records).filter(record => record.videoKey !== key);
}

/**
 * 这条成片覆盖到「被删除的归档记录」中的任何一条吗（级联判据）。
 * 两边都先过身份归一化：`recordKey` 优先、退回 `id`。
 */
export function videoRecordCoversRemovedRecords(record, removedRecords = []) {
  const current = normalizeVideoRecord(record);
  if (!current) return false;
  const removed = new Set(
    (Array.isArray(removedRecords) ? removedRecords : [])
      .map(recordIdentity)
      .filter(Boolean)
  );
  if (!removed.size) return false;
  return current.sources.some(row => removed.has(sourceIdentity(row)));
}

/**
 * 归档记录被删除时的级联（FR-304）：覆盖到这些记录的成片一并摘掉，其余成片原样保留。
 * 返回 `{ kept, removed }` —— `removed` 的 `videoKey` 由调用方拿去把渲染任务记录一起清掉。
 */
export function videoRecordsCascadeRemoved(videoRecords = [], removedRecords = []) {
  const list = normalizeVideoRecordList(videoRecords);
  const removed = list.filter(record => videoRecordCoversRemovedRecords(record, removedRecords));
  const removedKeys = new Set(removed.map(record => record.videoKey));
  return { kept: list.filter(record => !removedKeys.has(record.videoKey)), removed };
}

// ---------------------------------------------------------------------------
// ④ 视图产物（所有状态同形状；界面只渲染它）
// ---------------------------------------------------------------------------

/** 「重新生成」现在能不能点（空串 = 可以；否则给可读原因）—— 界面与写入侧读同一份。 */
export function videoRecordRegenerateIssue({ record = null, jobStatus = '' } = {}) {
  const current = normalizeVideoRecord(record);
  if (!current) return '还没有成片记录：先提交一条视频任务生成第一版。';
  if (VIDEO_JOB_ACTIVE_STATUSES.includes(str(jobStatus))) return '这一版还在渲染：等它结束后再重新生成（也可以在任务卡片上取消这一轮）。';
  return '';
}

/** 某一版（当前版或历史版本）的归一化读数；`version` 传 0 / 不传 = 最新版。 */
export function videoRecordVersionEntry(record, version = 0) {
  const current = normalizeVideoRecord(record);
  if (!current) return null;
  const { history: _history, ...latest } = current;
  const wanted = int(version);
  if (!wanted || wanted === current.version) return latest;
  const found = current.history.find(entry => entry.version === wanted);
  return found ? { ...found, videoKey: current.videoKey, id: current.id, type: current.type, period: current.period, objectName: current.objectName } : null;
}

/** 历史版本列表（版本倒序，最新在前）。 */
export function videoRecordHistoryRows(record) {
  const current = normalizeVideoRecord(record);
  if (!current) return [];
  return current.history.map(entry => ({
    version: entry.version,
    versionLabel: archiveVersionLabel(entry.version),
    generatedAt: entry.generatedAt,
    generatedAtText: formatArchiveTime(entry.generatedAt),
    generatedBy: entry.generatedBy,
    generatedByText: entry.generatedBy ? `由 ${entry.generatedBy} 生成` : '生成人未记录',
    annotation: `${archiveVersionLabel(entry.version)} · 生成于 ${formatArchiveTime(entry.generatedAt) || '未记录时间'}`,
    rows: videoJobSpecRows(entry.specSnapshot)
  }));
}

/**
 * 整块面板的视图产物（**所有状态返回同一组字段**）。
 * 界面渲染的每一行（videoKey / 版本 / 生成时间 / 生成人 / 快照读数 / 更新提示 / 历史版本 /
 * 正在回看的那一版 / 下载判据）都在这里，组件不自己拼字符串、也不自己判断能不能下载。
 */
export function videoRecordView(record, { records = [], viewingVersion = 0 } = {}) {
  const current = normalizeVideoRecord(record);
  const wanted = int(viewingVersion);
  const viewingEntry = current ? videoRecordVersionEntry(current, wanted) : null;
  const latestOutput = videoOutputView(current || {});
  const viewingOutput = videoOutputView(viewingEntry || {});
  const versionRows = (source, output) => [
    { id: 'version', label: '版本', value: archiveVersionLabel(source.version) },
    { id: 'generatedAt', label: '生成时间', value: formatArchiveTime(source.generatedAt) || '未记录时间' },
    { id: 'generatedBy', label: '生成人', value: str(source.generatedBy) || '未记录' },
    { id: 'output', label: '成片', value: output.ready ? `${output.durationText} · ${output.bytesText}` : '未产出（渲染服务未接入）' }
  ];
  return {
    present: Boolean(current),
    videoKey: current ? current.videoKey : '',
    id: current ? current.id : '',
    version: current ? current.version : 0,
    versionLabel: current ? archiveVersionLabel(current.version) : '',
    generatedAt: current ? current.generatedAt : '',
    generatedAtText: current ? (formatArchiveTime(current.generatedAt) || '未记录时间') : '',
    generatedBy: current ? current.generatedBy : '',
    generatedByText: current ? (current.generatedBy ? `由 ${current.generatedBy} 生成` : '生成人未记录') : '',
    typeLabel: current ? videoJobTypeLabel(current.type) : '',
    objectName: current ? (current.objectName || current.studentId || current.classId || '未记录对象') : '',
    period: current ? current.period : '',
    specRows: current ? videoJobSpecRows(current.specSnapshot) : [],
    sourceCount: current ? current.sources.length : 0,
    sourceNote: current
      ? `这一版生成时覆盖 ${current.sources.length} 条归档记录；它们所属的对象与周期就是 videoKey 的两段。`
      : '',
    rows: current ? versionRows(current, latestOutput) : [],
    output: latestOutput,
    outputNote: current && !latestOutput.ready ? VIDEO_RECORD_OUTPUT_PENDING_NOTE : '',
    update: videoRecordUpdateView(current, records),
    historyRows: current ? videoRecordHistoryRows(current) : [],
    hasHistory: Boolean(current && current.history.length),
    historyTitle: VIDEO_RECORD_HISTORY_TITLE,
    historyEmptyText: VIDEO_RECORD_HISTORY_EMPTY,
    historyNote: VIDEO_RECORD_HISTORY_NOTE,
    historyViewLabel: VIDEO_RECORD_HISTORY_VIEW,
    historyBackLabel: VIDEO_RECORD_HISTORY_BACK,
    emptyText: VIDEO_RECORD_EMPTY_TEXT,
    emptyActionHint: VIDEO_RECORD_EMPTY_ACTION_HINT,
    // 正在回看的那一版（`viewingVersion` 为 0 / 等于最新版时 `viewing.active` 为假 —— 界面不渲染回看块）。
    viewing: {
      active: Boolean(current && viewingEntry && wanted && wanted !== current.version),
      version: viewingEntry ? viewingEntry.version : 0,
      versionLabel: viewingEntry ? archiveVersionLabel(viewingEntry.version) : '',
      generatedAtText: viewingEntry ? (formatArchiveTime(viewingEntry.generatedAt) || '未记录时间') : '',
      generatedByText: viewingEntry ? (viewingEntry.generatedBy ? `由 ${viewingEntry.generatedBy} 生成` : '生成人未记录') : '',
      rows: viewingEntry ? versionRows(viewingEntry, viewingOutput) : [],
      specRows: viewingEntry ? videoJobSpecRows(viewingEntry.specSnapshot) : [],
      output: viewingOutput,
      download: {
        label: VIDEO_RECORD_DOWNLOAD_LABEL,
        enabled: viewingOutput.ready,
        unavailableText: viewingOutput.ready ? '' : VIDEO_RECORD_DOWNLOAD_UNAVAILABLE_TEXT
      }
    }
  };
}

// ---------------------------------------------------------------------------
// ⑤ 本机镜像（读写 / 合并；云端行映射在 `services/videoRecordsApi.js`）
// ---------------------------------------------------------------------------

/** 读本机镜像（没有 / 读坏都给空数组：成片是可选内容，读不到就当还没生成过）。 */
export function loadVideoRecords() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VIDEO_RECORD_STORAGE_KEY) || '[]');
    return dedupeVideoRecords(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

/** 落本机镜像（配额不够时静默跳过：记录还在界面里，下一次写入再试）。 */
export function persistVideoRecords(records) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIDEO_RECORD_STORAGE_KEY, JSON.stringify(dedupeVideoRecords(records)));
  } catch {
    /* 配额不够：不阻断生成流程。 */
  }
}

/**
 * 合并本机镜像与云端（与阶段报告同一套写法）：**同键本机优先** ——
 * 本机刚生成、还没推上云的那一版不能被云端旧记录顶掉（云端表没建出来时本机镜像就是唯一副本）。
 * 云端只补本机没有的 `videoKey`（老版本不会把新版本的版本号拉回去）。
 */
export function mergeVideoRecords(localRecords, remoteRecords) {
  const byKey = new Map();
  (Array.isArray(remoteRecords) ? remoteRecords : []).forEach(item => {
    const record = normalizeVideoRecord(item);
    if (record) byKey.set(record.videoKey, record);
  });
  (Array.isArray(localRecords) ? localRecords : []).forEach(item => {
    const record = normalizeVideoRecord(item);
    if (record) byKey.set(record.videoKey, record);
  });
  return dedupeVideoRecords([...byKey.values()]);
}

