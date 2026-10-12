// 视频任务的**机构配额**：存储与流量（[第四步 US-223] 第 4 条 / FR-314）。
//
// 验收原文：「存储与流量按机构配额受限，超限时阻止新任务并给出提示」。
// 三件事收在这一份零依赖模块里：
//
//  ① **两份配额分开算**：`storageLimitBytes`（成片占的存储）与 `trafficLimitBytes`
//     （一个月内的下载流量）。默认 50 GB / 200 GB，可配（管理端）。
//  ② **用量来自真实读数**：存储 = 成片记录里的 `bytes` 之和（真成片才有体积，演示任务
//     结构上为 0，因此演示不会虚报用量）；流量 = 审计日志里「下载成片」那几条的 `bytes`
//     之和（本月窗口）—— 每一次下载都留了体积，用量与留痕同源。
//  ③ **超限阻止新任务**：`videoQuotaSubmitIssue(view)` 返回可读原因（点名是哪一份超了、
//     用了多少、上限多少），界面把它渲染在提交按钮旁并禁用提交 —— 判定与写入侧读同一份。
//
// 口径说明：配额按「机构」算，原型里只有一家机构（`DEFAULT_ORG_ID`），所以用量就是全量；
// 读不出的体积不虚报（记 0），也不会把别人的任务算到自己头上。

import { AUDIT_ACTIONS } from './auditLog';
import { normalizeVideoRecord } from './videoRecords';

const str = value => String(value === null || value === undefined ? '' : value).trim();

const GB = 1024 * 1024 * 1024;

/** 本机镜像的键（配额配置只在本机落地，与保留期同一套）。 */
export const VIDEO_QUOTA_STORAGE_KEY = 'xinlehui-video-quota-v1';

/** 默认配额：存储 50 GB、流量（每月）200 GB。 */
export const VIDEO_QUOTA_DEFAULT_STORAGE_BYTES = 50 * GB;
export const VIDEO_QUOTA_DEFAULT_TRAFFIC_BYTES = 200 * GB;

/** 收敛区间：1 GB ~ 10 TB。 */
export const VIDEO_QUOTA_RANGE = [GB, 10240 * GB];

/** 可选项（面板下拉与断言读同一份）。 */
export const VIDEO_QUOTA_STORAGE_OPTIONS = [
  { bytes: 10 * GB, label: '10 GB' },
  { bytes: 50 * GB, label: '50 GB（默认）' },
  { bytes: 200 * GB, label: '200 GB' },
  { bytes: 1024 * GB, label: '1 TB' }
];
export const VIDEO_QUOTA_TRAFFIC_OPTIONS = [
  { bytes: 50 * GB, label: '50 GB / 月' },
  { bytes: 200 * GB, label: '200 GB / 月（默认）' },
  { bytes: 500 * GB, label: '500 GB / 月' },
  { bytes: 2048 * GB, label: '2 TB / 月' }
];

/** 界面文案（唯一真源）。 */
export const VIDEO_QUOTA_SECTION_TITLE = '视频存储与流量配额';
export const VIDEO_QUOTA_SECTION_DESC = '存储（成片体积）与流量（月度下载）各有一份机构配额；任一份用满时阻止新任务并给出提示，直到清理产物或调高配额。';
export const VIDEO_QUOTA_POLICY_NOTE = '存储按成片记录里的体积合计；流量按本月「下载成片」的留痕体积合计 —— 用量与留痕同源，读不出的体积记 0，不虚报。';
export const VIDEO_QUOTA_BLOCKED_NOTE = '配额已满：新的渲染任务会被拒绝，直到到期清理释放空间或管理员调高配额。';
export const VIDEO_QUOTA_OK_NOTE = '配额内：还能继续提交任务与下载成片。';

/** 体积读数（「12.4 GB」/「820 MB」/「12 KB」；0 给「0」）。 */
export function videoQuotaBytesText(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < GB) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  return `${Math.round((bytes / GB) * 10) / 10} GB`;
}

/** 配额数值收敛：非数字 / 越界收敛到区间里（永不抛错）。 */
export function normalizeVideoQuotaBytes(value, fallback = VIDEO_QUOTA_DEFAULT_STORAGE_BYTES) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return fallback;
  const [min, max] = VIDEO_QUOTA_RANGE;
  return Math.min(max, Math.max(min, Math.trunc(bytes)));
}

/** 归一化配额策略：`{storageLimitBytes, trafficLimitBytes, updatedBy, updatedAt}`。 */
export function normalizeVideoQuotaPolicy(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    storageLimitBytes: normalizeVideoQuotaBytes(source.storageLimitBytes, VIDEO_QUOTA_DEFAULT_STORAGE_BYTES),
    trafficLimitBytes: normalizeVideoQuotaBytes(source.trafficLimitBytes, VIDEO_QUOTA_DEFAULT_TRAFFIC_BYTES),
    updatedBy: str(source.updatedBy),
    updatedAt: str(source.updatedAt)
  };
}

/** 改策略（唯一写入口）：脏补丁收敛、留痕。 */
export function videoQuotaPolicyPatch(policy, patch = {}, { updatedBy = '', at = '' } = {}) {
  const current = normalizeVideoQuotaPolicy(policy);
  const next = patch && typeof patch === 'object' ? patch : {};
  const merged = {
    ...current,
    ...('storageLimitBytes' in next ? { storageLimitBytes: next.storageLimitBytes } : {}),
    ...('trafficLimitBytes' in next ? { trafficLimitBytes: next.trafficLimitBytes } : {})
  };
  const normalized = normalizeVideoQuotaPolicy(merged);
  return {
    ...normalized,
    updatedBy: str(updatedBy) || current.updatedBy,
    updatedAt: str(at) || new Date().toISOString()
  };
}

/** 读本机镜像：读坏回落默认配额。 */
export function loadVideoQuotaPolicy() {
  const fallback = { storageLimitBytes: VIDEO_QUOTA_DEFAULT_STORAGE_BYTES, trafficLimitBytes: VIDEO_QUOTA_DEFAULT_TRAFFIC_BYTES };
  if (typeof window === 'undefined' || !window.localStorage) return normalizeVideoQuotaPolicy(fallback);
  let parsed = null;
  try { parsed = JSON.parse(window.localStorage.getItem(VIDEO_QUOTA_STORAGE_KEY)); } catch { parsed = null; }
  return normalizeVideoQuotaPolicy(parsed && typeof parsed === 'object' ? parsed : fallback);
}

/** 落本机镜像（配额不够时静默跳过）。 */
export function persistVideoQuotaPolicy(policy) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try { window.localStorage.setItem(VIDEO_QUOTA_STORAGE_KEY, JSON.stringify(normalizeVideoQuotaPolicy(policy))); } catch { /* 配额满：不阻断配置 */ }
}

/** 存储用量：成片记录里的体积合计（真成片才有体积）。 */
export function videoStorageUsedBytes(records) {
  return (Array.isArray(records) ? records : []).reduce((sum, raw) => {
    const record = normalizeVideoRecord(raw);
    if (!record) return sum;
    return sum + (Number.isFinite(Number(record.bytes)) ? Math.max(0, Number(record.bytes)) : 0);
  }, 0);
}

/** 本月窗口的起点（ISO，整月第一天 00:00 本地时间）。 */
export function videoTrafficWindowStart(now = null) {
  const date = now === null || now === undefined ? new Date() : new Date(now instanceof Date ? now.getTime() : (Number.isFinite(Number(now)) ? Number(now) : Date.parse(str(now)) || Date.now()));
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0).toISOString();
}

/** 流量用量：本月「下载成片」留痕的体积合计。 */
export function videoTrafficUsedBytes(entries, now = null, { allTime = false } = {}) {
  const start = allTime ? '' : videoTrafficWindowStart(now);
  return (Array.isArray(entries) ? entries : []).reduce((sum, entry) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    if (str(item.action) !== AUDIT_ACTIONS.videoDownload) return sum;
    // 被拒绝的下载不算流量（没有真的流出字节）。
    if (str(item.outcome) === 'denied') return sum;
    if (start && str(item.at) && String(item.at) < start) return sum;
    const bytes = Number(item.bytes);
    return sum + (Number.isFinite(bytes) ? Math.max(0, bytes) : 0);
  }, 0);
}

/** 一份配额行的读数（用量 / 上限 / 占比 / 是否超限）。 */
function quotaRow(used, limit, label) {
  const usage = Math.max(0, Number(used) || 0);
  const cap = Math.max(1, Number(limit) || 0);
  const ratio = Math.min(1, usage / cap);
  return {
    label,
    used: usage,
    limit: cap,
    usedText: videoQuotaBytesText(usage),
    limitText: videoQuotaBytesText(cap),
    ratio,
    percentText: `${Math.round(ratio * 100)}%`,
    exceeded: usage >= cap,
    text: `${videoQuotaBytesText(usage)} / ${videoQuotaBytesText(cap)}（${Math.round(ratio * 100)}%）`
  };
}

/**
 * 配额视图（**所有分支同形状**）：`{storage, traffic, exceeded, blocked, issue, text, note, ...}`。
 * `blocked` 为真时界面禁用提交并显示 `issue`（可读原因点名是哪一份超了）。
 */
export function videoQuotaView({ policy = null, records = [], auditLog = [], now = null } = {}) {
  const item = normalizeVideoQuotaPolicy(policy);
  const storage = quotaRow(videoStorageUsedBytes(records), item.storageLimitBytes, '存储');
  const traffic = quotaRow(videoTrafficUsedBytes(auditLog, now), item.trafficLimitBytes, '流量（本月）');
  const exceeded = storage.exceeded || traffic.exceeded;
  const exceededRows = [storage, traffic].filter(row => row.exceeded);
  const issue = exceededRows.length
    ? `${VIDEO_QUOTA_BLOCKED_NOTE}（${exceededRows.map(row => `${row.label}已用 ${row.text}`).join('；')}）`
    : '';
  return {
    storage,
    traffic,
    exceeded,
    blocked: exceeded,
    issue,
    text: `${VIDEO_QUOTA_SECTION_TITLE}：存储 ${storage.text} · 流量（本月）${traffic.text}`,
    note: exceeded ? VIDEO_QUOTA_BLOCKED_NOTE : VIDEO_QUOTA_OK_NOTE,
    policy: item,
    storageLimitBytes: item.storageLimitBytes,
    trafficLimitBytes: item.trafficLimitBytes
  };
}

/** 提交前的判据（空串 = 可以提交）：超限时给可读原因 —— 界面禁用按钮与写入侧读同一份。 */
export function videoQuotaSubmitIssue(view = null) {
  const source = view && typeof view === 'object' ? view : {};
  if (source.blocked) return str(source.issue) || VIDEO_QUOTA_BLOCKED_NOTE;
  return '';
}
