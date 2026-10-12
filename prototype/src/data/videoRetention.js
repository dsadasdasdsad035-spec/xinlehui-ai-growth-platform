// 视频任务**渲染中间产物与成片的保留期**（[第四步 US-223] 第 3 条 / FR-313）。
//
// 验收原文：「渲染中间产物与成片的保留期可配置，到期清理需可预览影响范围」。
// 两条口径都在这里（零依赖纯函数 + 常量，可 `node` 直跑断言）：
//
//  ① **两份保留期分开配**：中间产物（渲染过程中的临时记录）与成片（最终文件）留多久是两件事
//     —— 中间产物脏且大、成片是给家长看的产物。默认「中间产物 7 天 / 成片 180 天」，
//     各自可配到「长期保留」（不自动清理）。
//  ② **预览与执行同源**：`videoRetentionPreview` 与 `applyVideoRetentionCleanup` 读同一支
//     纯函数 —— 「预览说 N 条、执行删 N 条」是结构性的，不会漂移。预览逐条报出
//     「谁的任务、什么时候结束的、属于哪条成片」。
//
// 到期判据锚在**任务结束时间**（`finishedAt`，退回 `updatedAt` / `createdAt`）与
// **成片生成时间**（`generatedAt`）：保留期算的是「产物留了多久」，不是课次日期。
// 时间读不出的一律**不清理**（宁可留着，也不误删孩子的成片）。

import { VIDEO_JOB_STATUSES, normalizeVideoJob } from './videoJobs';
import { normalizeVideoRecord } from './videoRecords';

/** 本机镜像的键（配置只在本机落地，与「归档保留期」同一套）。 */
export const VIDEO_RETENTION_STORAGE_KEY = 'xinlehui-video-retention-v1';

/** 中间产物默认保留 7 天；成片默认保留 180 天（与平台隐私策略同一条口径）。 */
export const VIDEO_RETENTION_DEFAULT_INTERMEDIATE_DAYS = 7;
export const VIDEO_RETENTION_DEFAULT_OUTPUT_DAYS = 180;

/** 收敛区间（天）：1 ~ 3650；0 = 长期保留（不自动清理）。 */
export const VIDEO_RETENTION_RANGE = [1, 3650];

/** 中间产物的可选项。 */
export const VIDEO_RETENTION_INTERMEDIATE_OPTIONS = [
  { days: 1, label: '1 天' },
  { days: 7, label: '7 天（默认）' },
  { days: 30, label: '30 天' },
  { days: 0, label: '长期保留（渲染中间产物不自动清理）' }
];

/** 成片的可选项。 */
export const VIDEO_RETENTION_OUTPUT_OPTIONS = [
  { days: 30, label: '30 天' },
  { days: 180, label: '180 天（默认）' },
  { days: 365, label: '365 天' },
  { days: 730, label: '730 天' },
  { days: 0, label: '长期保留（成片不自动清理）' }
];

/** 界面文案（唯一真源，界面不各写一份）。 */
export const VIDEO_RETENTION_SECTION_TITLE = '视频产物：保留期与到期清理';
export const VIDEO_RETENTION_SECTION_DESC = '渲染中间产物与成片各有一份保留期（默认 7 天 / 180 天），可分别配置；到期清理前先列出将被清理的任务与成片及影响范围，确认后才执行。';
export const VIDEO_RETENTION_PREVIEW_LABEL = '预览到期清理影响范围';
export const VIDEO_RETENTION_CLEANUP_LABEL = '执行清理';
export const VIDEO_RETENTION_POLICY_NOTE = '保留期从「任务结束时间」与「成片生成时间」起算；课次日期只用于展示。清理只删到期的那几条，未到期的一条都不动。';
export const VIDEO_RETENTION_LONG_TERM_TEXT = '长期保留（不自动清理）';
export const VIDEO_RETENTION_EMPTY_PREVIEW_TEXT = '还没有视频产物可以清理：演示队列里没有任务，成片记录也是空的。';

const str = value => String(value === null || value === undefined ? '' : value).trim();
const DAY_MS = 24 * 60 * 60 * 1000;
const pad2 = value => String(value).padStart(2, '0');

/** 时间入参：Date / ISO / 时间戳；读不出来回落「现在」（永不抛错）。 */
function toTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(str(value));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** 时间读数：「2026-10-12」（读不出来原样返回）。 */
export function videoRetentionDateText(value) {
  const text = str(value);
  if (!text) return '';
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text;
  const date = new Date(parsed);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 保留天数收敛：非数字 / 负数回落默认；越界收敛到区间里；`0` / 「长期」= 长期保留。 */
export function normalizeVideoRetentionDays(value, fallback = VIDEO_RETENTION_DEFAULT_INTERMEDIATE_DAYS) {
  const text = str(value);
  if (text === '长期' || text === '长期保留') return 0;
  const days = Math.trunc(Number(value));
  if (!Number.isFinite(days)) return fallback;
  if (days < 0) return fallback;
  if (days === 0) return 0;
  const [min, max] = VIDEO_RETENTION_RANGE;
  return Math.min(max, Math.max(min, days));
}

/** 归一化策略：`{intermediateDays, outputDays, updatedBy, updatedAt}`（永不抛错）。 */
export function normalizeVideoRetentionPolicy(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const intermediateDays = normalizeVideoRetentionDays(source.intermediateDays, VIDEO_RETENTION_DEFAULT_INTERMEDIATE_DAYS);
  const outputDays = normalizeVideoRetentionDays(source.outputDays, VIDEO_RETENTION_DEFAULT_OUTPUT_DAYS);
  return {
    intermediateDays,
    outputDays,
    intermediateLongTerm: intermediateDays === 0,
    outputLongTerm: outputDays === 0,
    updatedBy: str(source.updatedBy),
    updatedAt: str(source.updatedAt)
  };
}

/** 保留期的可读说法（下拉选项里的那一个；自定义天数原样报出来）。 */
export function videoRetentionText(days, options) {
  const value = Math.trunc(Number(days));
  if (value === 0) return VIDEO_RETENTION_LONG_TERM_TEXT;
  const found = (Array.isArray(options) ? options : []).find(item => item.days === value);
  return found ? found.label : `${value} 天`;
}

/** 改策略（唯一写入口）：脏补丁收敛、留痕 `updatedBy` / `updatedAt`。 */
export function videoRetentionPolicyPatch(policy, patch = {}, { updatedBy = '', at = '' } = {}) {
  const current = normalizeVideoRetentionPolicy(policy);
  const next = patch && typeof patch === 'object' ? patch : {};
  const merged = {
    ...current,
    ...('intermediateDays' in next ? { intermediateDays: next.intermediateDays } : {}),
    ...('outputDays' in next ? { outputDays: next.outputDays } : {})
  };
  const normalized = normalizeVideoRetentionPolicy(merged);
  return {
    ...normalized,
    updatedBy: str(updatedBy) || current.updatedBy,
    updatedAt: str(at) || new Date().toISOString()
  };
}

/** 面板上的一行读数。 */
export function videoRetentionSummary(policy) {
  const item = normalizeVideoRetentionPolicy(policy);
  const parts = [
    `中间产物 保留 ${videoRetentionText(item.intermediateDays, VIDEO_RETENTION_INTERMEDIATE_OPTIONS)}`,
    `成片 保留 ${videoRetentionText(item.outputDays, VIDEO_RETENTION_OUTPUT_OPTIONS)}`
  ];
  if (item.updatedBy || item.updatedAt) {
    const when = videoRetentionDateText(item.updatedAt);
    parts.push(`最近变更：${item.updatedBy || '未知操作人'}${when ? ` ${when}` : ''}`);
  } else {
    parts.push('尚未修改过');
  }
  return parts.join(' · ');
}

/** 读本机镜像：读坏回落默认策略（不抛错、不编造修改人）。 */
export function loadVideoRetentionPolicy() {
  const fallback = { intermediateDays: VIDEO_RETENTION_DEFAULT_INTERMEDIATE_DAYS, outputDays: VIDEO_RETENTION_DEFAULT_OUTPUT_DAYS };
  if (typeof window === 'undefined' || !window.localStorage) return normalizeVideoRetentionPolicy(fallback);
  let parsed = null;
  try { parsed = JSON.parse(window.localStorage.getItem(VIDEO_RETENTION_STORAGE_KEY)); } catch { parsed = null; }
  return normalizeVideoRetentionPolicy(parsed && typeof parsed === 'object' ? parsed : fallback);
}

/** 落本机镜像（配额不够时静默跳过：策略已经在本机界面上生效）。 */
export function persistVideoRetentionPolicy(policy) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try { window.localStorage.setItem(VIDEO_RETENTION_STORAGE_KEY, JSON.stringify(normalizeVideoRetentionPolicy(policy))); } catch { /* 配额满：不阻断配置 */ }
}

/** 到期截止时刻（ISO）：长期保留返回空串（没有截止日）。 */
export function videoRetentionCutoff(days, now = null) {
  const value = normalizeVideoRetentionDays(days, 0);
  if (value === 0) return '';
  return new Date(toTime(now) - value * DAY_MS).toISOString();
}

/** 一条任务（中间产物）的保留期锚点：结束时间优先，退回更新时间 / 创建时间。 */
export function videoJobRetentionAnchor(job) {
  const source = job && typeof job === 'object' ? job : {};
  return str(source.finishedAt) || str(source.updatedAt) || str(source.createdAt);
}

/** 一条成片记录的保留期锚点：生成时间（读不出返回空串 → 不清理）。 */
export function videoRecordRetentionAnchor(record) {
  const source = record && typeof record === 'object' ? record : {};
  return str(source.generatedAt);
}

/** 任务到期了吗（只算终态；进行中的任务不清理；锚点读不出 → false）。 */
export function isVideoJobExpired(job, policy, now = null) {
  const item = normalizeVideoRetentionPolicy(policy);
  const job_ = normalizeVideoJob(job);
  const cutoff = videoRetentionCutoff(item.intermediateDays, now);
  if (!cutoff) return false;
  const finished = str(job_.finishedAt);
  if (!finished) return false;
  const terminal = [VIDEO_JOB_STATUSES.done, VIDEO_JOB_STATUSES.failed, VIDEO_JOB_STATUSES.canceled].includes(job_.status);
  if (!terminal) return false;
  const time = Date.parse(finished);
  if (!Number.isFinite(time)) return false;
  return time < Date.parse(cutoff);
}

/** 成片到期了吗（锚点读不出 → false：宁可留着也不误删）。 */
export function isVideoRecordExpired(record, policy, now = null) {
  const item = normalizeVideoRetentionPolicy(policy);
  const record_ = normalizeVideoRecord(record);
  if (!record_) return false;
  const cutoff = videoRetentionCutoff(item.outputDays, now);
  if (!cutoff) return false;
  const anchor = str(record_.generatedAt);
  if (!anchor) return false;
  const time = Date.parse(anchor);
  if (!Number.isFinite(time)) return false;
  return time < Date.parse(cutoff);
}

/** 预览里的一行（逐条说清删的是谁、什么时候的、多大）。 */
function videoIntermediateRow(job) {
  const source = normalizeVideoJob(job);
  const object = str(source.specSnapshot?.objectName) || source.studentId || source.classId || '未记录对象';
  const finishedText = videoRetentionDateText(source.finishedAt);
  const parts = [object];
  if (finishedText) parts.push(`结束于 ${finishedText}`);
  parts.push(source.jobKey);
  return { id: source.jobKey, jobKey: source.jobKey, type: source.type, status: source.status, object, finishedAt: source.finishedAt, text: parts.join(' · ') };
}

/** 成片预览行。 */
function videoOutputRow(record) {
  const source = normalizeVideoRecord(record);
  const object = str(source.objectName) || source.studentId || source.classId || '未记录对象';
  const generatedText = videoRetentionDateText(source.generatedAt);
  const parts = [object];
  if (generatedText) parts.push(`生成于 ${generatedText}`);
  parts.push(source.videoKey);
  return {
    id: source.videoKey,
    videoKey: source.videoKey,
    version: source.version,
    object,
    generatedAt: source.generatedAt,
    bytes: source.bytes,
    text: parts.join(' · ')
  };
}

/**
 * **到期清理的预览**（验收第 3 条）：按策略算出两份截止日、将被清理的任务与成片、保留条数，
 * 以及影响范围（几条任务 / 几条成片 / 多少体积）。预览与执行共用这一份。
 */
export function videoRetentionPreview({ jobs = [], records = [] } = {}, policy, now = null) {
  const item = normalizeVideoRetentionPolicy(policy);
  const jobList = (Array.isArray(jobs) ? jobs : []).filter(row => row && typeof row === 'object');
  const recordList = (Array.isArray(records) ? records : []).filter(row => row && typeof row === 'object');
  const intermediate = jobList.filter(job => isVideoJobExpired(job, item, now)).map(videoIntermediateRow);
  const output = recordList.filter(record => isVideoRecordExpired(record, item, now)).map(videoOutputRow);
  const bytes = output.reduce((sum, row) => sum + (Number.isFinite(Number(row.bytes)) ? Number(row.bytes) : 0), 0);
  const intermediateCutoff = videoRetentionCutoff(item.intermediateDays, now);
  const outputCutoff = videoRetentionCutoff(item.outputDays, now);
  const intermediateText = videoRetentionText(item.intermediateDays, VIDEO_RETENTION_INTERMEDIATE_OPTIONS);
  const outputText = videoRetentionText(item.outputDays, VIDEO_RETENTION_OUTPUT_OPTIONS);
  const total = jobList.length + recordList.length;
  const expiredCount = intermediate.length + output.length;
  const text = total === 0
    ? VIDEO_RETENTION_EMPTY_PREVIEW_TEXT
    : `按「中间产物 ${intermediateText} / 成片 ${outputText}」计算：${expiredCount
      ? `将清理 ${intermediate.length} 条渲染中间产物${intermediateCutoff ? `（截止 ${videoRetentionDateText(intermediateCutoff)}）` : ''}与 ${output.length} 条成片${outputCutoff ? `（截止 ${videoRetentionDateText(outputCutoff)}）` : ''}，涉及 ${bytes} 字节；`
      : '没有到期产物；'}其余保留（当前 ${jobList.length} 条任务、${recordList.length} 条成片）。`;
  return {
    intermediateDays: item.intermediateDays,
    outputDays: item.outputDays,
    intermediateText,
    outputText,
    intermediateLongTerm: item.intermediateLongTerm,
    outputLongTerm: item.outputLongTerm,
    intermediateCutoff,
    outputCutoff,
    jobTotal: jobList.length,
    recordTotal: recordList.length,
    intermediateCount: intermediate.length,
    outputCount: output.length,
    expiredCount,
    keepCount: total - expiredCount,
    bytes,
    intermediate,
    output,
    text
  };
}

/** 执行清理：返回 `{jobs:{kept,removed}, records:{kept,removed}, preview}`（预览与它同源）。 */
export function applyVideoRetentionCleanup({ jobs = [], records = [] } = {}, policy, now = null) {
  const jobList = (Array.isArray(jobs) ? jobs : []).filter(row => row && typeof row === 'object');
  const recordList = (Array.isArray(records) ? records : []).filter(row => row && typeof row === 'object');
  const preview = videoRetentionPreview({ jobs: jobList, records: recordList }, policy, now);
  const expiredJobs = new Set(preview.intermediate.map(row => row.jobKey));
  const expiredRecords = new Set(preview.output.map(row => row.videoKey));
  return {
    jobs: {
      kept: jobList.filter(job => !expiredJobs.has(normalizeVideoJob(job).jobKey)),
      removed: jobList.filter(job => expiredJobs.has(normalizeVideoJob(job).jobKey))
    },
    records: {
      kept: recordList.filter(record => !expiredRecords.has(str(normalizeVideoRecord(record)?.videoKey))),
      removed: recordList.filter(record => expiredRecords.has(str(normalizeVideoRecord(record)?.videoKey)))
    },
    preview
  };
}

/** 清理完成后的回执（面板与 toast 读同一句）。 */
export function videoCleanupNotice(preview = {}) {
  const jobs = Math.trunc(Number(preview.intermediateCount)) || 0;
  const records = Math.trunc(Number(preview.outputCount)) || 0;
  if (!jobs && !records) return '没有到期的视频产物需要清理。';
  return `已清理 ${jobs} 条渲染中间产物与 ${records} 条成片（中间产物保留 ${str(preview.intermediateText)}、成片保留 ${str(preview.outputText)}）。`;
}
