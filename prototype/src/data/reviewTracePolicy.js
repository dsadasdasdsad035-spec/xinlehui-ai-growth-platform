/**
 * 点评推理轨迹的**留存期、披露开关与可见性**（[第三步 US-112] / F-REVIEW-TRACE-03）。
 *
 * 轨迹本身（`data/reviewTrace.js`）只回答「这一次点评是怎么产生的」；这一份回答另外四件事：
 *  1. **留多久**：保留期可配置（默认 90 天），到期清理前必须先能**预览影响范围**
 *     （`reviewTraceCleanupPreview` = 将删哪些条、留多少条；执行走 `applyReviewTraceCleanup`）；
 *  2. **谁能看**：老师只看自己经手点评的轨迹，跨机构不可见（`reviewTraceVisibleTo`）；
 *     家长端与家长分享页**不存在任何轨迹入口**（`reviewTraceSurfaceAllowed` 直接为 false）；
 *  3. **提示词正文披露**：平台开关 `allowPromptDisclosure`（默认开启）关闭时，
 *     老师端提示词分区显示「管理员已限制查看，仅显示清单」（`REVIEW_TRACE_DISCLOSURE_NOTE`），
 *     正文不渲染、导出里也不出现（`reviewDetailPanel.js` 的 `reviewPromptDisclosureMask`）；
 *  4. **筛选**：按学员 / 老师 / 模型 / 时间范围 / 状态查轨迹（`filterReviewTraces`）——
 *     界面、服务端把关与断言读同一份判据。
 *
 * 三条硬约定（与 `data/auditLog.js`、`data/reviewTrace.js` 同一套纪律）：
 *  - **零依赖纯函数 + 常量**（只 import 同层 data 模块的状态枚举），不碰 DOM / 网络，
 *    可以直接用 Node 跑断言；
 *  - **默认值即安全值**：认不出的策略读成「90 天 + 允许披露」，认不出的身份一律不可见；
 *  - **文案与判据同源**：界面上的那句「管理员已限制查看，仅显示清单」与断言读同一个常量。
 */

import { REVIEW_TRACE_STATUS, REVIEW_TRACE_STATUS_LABELS } from './reviewTrace';

/** 策略的本机镜像键（主键仍是「裸对象」形状，与审计日志的兄弟键同一套口径）。 */
export const REVIEW_TRACE_POLICY_KEY = 'xinlehui-review-trace-policy-v1';

/** 结构版本：策略字段变化时抬高它（旧策略按版本读出，缺的字段回落默认值）。 */
export const REVIEW_TRACE_POLICY_VERSION = 1;

/** 保留期默认值（PRD 原文：默认 90 天）。 */
export const REVIEW_TRACE_RETENTION_DEFAULT_DAYS = 90;

/** 保留期上限：10 年（再长就等于「长期保留」，界面上给的是显式的「长期保留」选项）。 */
export const REVIEW_TRACE_RETENTION_MAX_DAYS = 3650;

/** 保留期选项（系统配置里那一个下拉的唯一真源；`days: 0` = 长期保留）。 */
export const REVIEW_TRACE_RETENTION_OPTIONS = [
  { days: 30, label: '30 天' },
  { days: 90, label: '90 天（默认）' },
  { days: 180, label: '180 天' },
  { days: 365, label: '365 天' },
  { days: 0, label: '长期保留' }
];

/** 平台开关关闭时，老师端提示词分区显示的那句话（PRD 原文，界面与断言读同一份）。 */
export const REVIEW_TRACE_DISCLOSURE_NOTE = '管理员已限制查看，仅显示清单';

/** 界面位面：只有「管理端生成日志」与「老师端第三步」可能出现轨迹入口（FR-114）。 */
export const REVIEW_TRACE_SURFACES = {
  adminLogs: 'admin-logs',
  teacherFlow: 'teacher-flow',
  parentPortal: 'parent-portal',
  parentShare: 'parent-share'
};

/** 允许出现轨迹入口的位面 —— 家长端与家长分享页**不在**其中。 */
export const REVIEW_TRACE_ALLOWED_SURFACES = [
  REVIEW_TRACE_SURFACES.adminLogs,
  REVIEW_TRACE_SURFACES.teacherFlow
];

/** 允许查看轨迹的角色（家长一律不允许）。 */
export const REVIEW_TRACE_ALLOWED_ROLES = ['teacher', 'admin'];

/** 轨迹的可筛选字段（查询条件与筛选读数的唯一真源）。 */
export const REVIEW_TRACE_FILTER_FIELDS = ['student', 'teacher', 'model', 'status', 'from', 'to'];

/** 状态筛选项（「全部状态」+ 三个终态 + 生成中）。 */
export const REVIEW_TRACE_STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: REVIEW_TRACE_STATUS.success, label: REVIEW_TRACE_STATUS_LABELS[REVIEW_TRACE_STATUS.success] },
  { value: REVIEW_TRACE_STATUS.failed, label: REVIEW_TRACE_STATUS_LABELS[REVIEW_TRACE_STATUS.failed] },
  { value: REVIEW_TRACE_STATUS.aborted, label: REVIEW_TRACE_STATUS_LABELS[REVIEW_TRACE_STATUS.aborted] },
  { value: REVIEW_TRACE_STATUS.running, label: REVIEW_TRACE_STATUS_LABELS[REVIEW_TRACE_STATUS.running] }
];

const str = (value) => (value === null || value === undefined ? '' : String(value).trim());

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * 日期（`YYYY-MM-DD`）或完整时间戳 → 日期那一段；认不出返回空串。
 *
 * **带时间的 ISO 时间戳一律按本地时间折算**（与 `reviewTraceTimeText` 同一口径）：
 * 轨迹的 `createdAt` 是 `new Date().toISOString()`（UTC），直接取前 10 位会把「本地今天凌晨」
 * 的记录算到前一天，管理端「按今天筛」就会漏掉它。只有「纯日期」字符串才按原样取。
 */
export function reviewTraceDateKey(value) {
  const text = str(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
  const pad = (input) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 时间文案（`2026-10-11 20:15`）；认不出的值原样返回。 */
export function reviewTraceTimeText(value) {
  const text = str(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  const pad = (input) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// 保留期策略（系统配置）
// ---------------------------------------------------------------------------

/**
 * 归一策略。**永不抛错**：认不出的保留期读成默认 90 天；
 * `allowPromptDisclosure` 只有显式 `false` 才算关闭（缺省 = 开启，与 PRD「默认开启」一致）。
 */
export function normalizeReviewTracePolicy(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const parsed = num(source.retentionDays);
  const retentionDays = parsed === null || parsed < 0
    ? REVIEW_TRACE_RETENTION_DEFAULT_DAYS
    : Math.min(REVIEW_TRACE_RETENTION_MAX_DAYS, Math.round(parsed));
  return {
    version: REVIEW_TRACE_POLICY_VERSION,
    retentionDays,
    allowPromptDisclosure: source.allowPromptDisclosure === false ? false : true,
    updatedAt: str(source.updatedAt),
    updatedBy: str(source.updatedBy)
  };
}

/** 读本机镜像：坏数据安全降级为默认策略（不抛错）。 */
export function loadReviewTracePolicy() {
  if (typeof window === 'undefined' || !window.localStorage) return normalizeReviewTracePolicy(null);
  let parsed = null;
  try { parsed = JSON.parse(window.localStorage.getItem(REVIEW_TRACE_POLICY_KEY)); } catch { parsed = null; }
  return normalizeReviewTracePolicy(parsed);
}

/** 写本机镜像（配额满时静默不动，返回归一后的那一份）。 */
export function persistReviewTracePolicy(policy) {
  const item = normalizeReviewTracePolicy(policy);
  if (typeof window !== 'undefined' && window.localStorage) {
    try { window.localStorage.setItem(REVIEW_TRACE_POLICY_KEY, JSON.stringify(item)); } catch { /* 配额满时不动本机镜像 */ }
  }
  return item;
}

/** 保留期的说法（`保留 90 天` / `长期保留`）。 */
export function reviewTraceRetentionText(days) {
  const value = normalizeReviewTracePolicy({ retentionDays: days }).retentionDays;
  if (!value) return '长期保留';
  return `保留 ${value} 天`;
}

/** 保留期下拉里的标签（选项表里没有的数值也能给一句可读说法）。 */
export function reviewTraceRetentionLabel(days) {
  const value = normalizeReviewTracePolicy({ retentionDays: days }).retentionDays;
  const found = REVIEW_TRACE_RETENTION_OPTIONS.find((option) => option.days === value);
  return found ? found.label : reviewTraceRetentionText(value);
}

/** 策略摘要（系统配置与生成日志页顶部那句读数）。 */
export function reviewTracePolicySummary(policy) {
  const item = normalizeReviewTracePolicy(policy);
  return `${reviewTraceRetentionText(item.retentionDays)} · ${item.allowPromptDisclosure ? '允许老师查看提示词正文' : '老师不可查看提示词正文（仅清单）'}`;
}

/** 策略副本（改一个字段时的唯一写法；顺带盖上「谁在什么时候改的」）。 */
export function reviewTracePolicyPatch(policy, patch = {}, { updatedBy = '', at = '' } = {}) {
  const item = normalizeReviewTracePolicy({ ...normalizeReviewTracePolicy(policy), ...(patch && typeof patch === 'object' ? patch : {}) });
  item.updatedBy = str(updatedBy) || item.updatedBy;
  item.updatedAt = str(at) || item.updatedAt || new Date().toISOString();
  return item;
}

// ---------------------------------------------------------------------------
// 到期清理（默认 90 天；清理前先预览影响范围）
// ---------------------------------------------------------------------------

/** 清理截止时刻（ISO）；长期保留时返回空串 = 不设截止。 */
export function reviewTraceCutoff(policy, now = new Date().toISOString()) {
  const item = normalizeReviewTracePolicy(policy);
  if (!item.retentionDays) return '';
  const base = new Date(str(now) || Date.now());
  const start = Number.isNaN(base.getTime()) ? new Date() : base;
  return new Date(start.getTime() - item.retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

/** 这条轨迹是否已过保留期（createdAt 早于截止时刻）。 */
export function reviewTraceExpired(trace, policy, now = new Date().toISOString()) {
  const cutoff = reviewTraceCutoff(policy, now);
  if (!cutoff) return false;
  const createdAt = str(trace?.createdAt);
  if (!createdAt) return false;
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() < new Date(cutoff).getTime();
}

/** 清理预览里的一行（写清「将删掉谁的哪一条」，影响范围可读、可点名）。 */
function cleanupRow(trace) {
  const row = reviewTraceRow(trace);
  return {
    traceId: row.traceId,
    studentName: row.studentName,
    teacherName: row.teacherName,
    model: row.model,
    status: row.status,
    statusLabel: row.statusLabel,
    createdAt: row.createdAt,
    createdAtText: row.createdAtText,
    text: [row.createdAtText, row.studentName || '未关联学员', row.model || '未知模型', row.statusLabel].filter(Boolean).join(' · ')
  };
}

/**
 * 到期清理的**影响范围预览**（PRD：清理需可在系统配置中预览影响范围）。
 * 返回 `{ retentionDays, retentionText, cutoff, cutoffText, total, expiredCount, keepCount, expired, text }`；
 * `expired` 是逐条点名（谁、哪一条、什么时候），`text` 是一句话结论。
 */
export function reviewTraceCleanupPreview(traces, policy, now = new Date().toISOString()) {
  const list = Array.isArray(traces) ? traces.filter(Boolean) : [];
  const item = normalizeReviewTracePolicy(policy);
  const cutoff = reviewTraceCutoff(item, now);
  const expired = cutoff ? list.filter((trace) => reviewTraceExpired(trace, item, now)).map(cleanupRow) : [];
  const total = list.length;
  const expiredCount = expired.length;
  const keepCount = total - expiredCount;
  const cutoffText = cutoff ? reviewTraceTimeText(cutoff) : '';
  const text = cutoff
    ? `按「${reviewTraceRetentionText(item.retentionDays)}」计算：截止 ${cutoffText} 之前归档的轨迹将到期清理，共 ${expiredCount} 条；保留 ${keepCount} 条（当前共 ${total} 条）。`
    : `当前为「长期保留」：到期清理不会删除任何轨迹（当前共 ${total} 条）。`;
  return {
    retentionDays: item.retentionDays,
    retentionText: reviewTraceRetentionText(item.retentionDays),
    cutoff,
    cutoffText,
    total,
    expiredCount,
    keepCount,
    expired,
    text
  };
}

/**
 * 执行清理：按同一份预览口径把到期轨迹摘掉。
 * 返回 `{ kept, removed, preview }`（`kept` 就是新的本机镜像内容，调用方直接落盘）。
 */
export function applyReviewTraceCleanup(traces, policy, now = new Date().toISOString()) {
  const list = Array.isArray(traces) ? traces.filter(Boolean) : [];
  const preview = reviewTraceCleanupPreview(list, policy, now);
  if (!preview.cutoff) return { kept: list, removed: [], preview };
  const kept = [];
  const removed = [];
  list.forEach((trace) => {
    if (reviewTraceExpired(trace, policy, now)) removed.push(trace);
    else kept.push(trace);
  });
  return { kept, removed, preview: { ...preview, expiredCount: removed.length, keepCount: kept.length } };
}

// ---------------------------------------------------------------------------
// 位面 / 角色 / 披露
// ---------------------------------------------------------------------------

/**
 * 这个位面 + 角色**能不能出现轨迹入口**（FR-114）。
 * 家长端与家长分享页在任何角色下都是 false —— 界面渲染前问这一份，断言在家长页面上问同一份。
 */
export function reviewTraceSurfaceAllowed({ surface = '', role = 'teacher' } = {}) {
  const surfaceKey = str(surface);
  const roleKey = str(role) || 'teacher';
  if (!REVIEW_TRACE_ALLOWED_SURFACES.includes(surfaceKey)) return false;
  return REVIEW_TRACE_ALLOWED_ROLES.includes(roleKey);
}

/**
 * 「查看提示词正文」是否放开（平台开关 `allowPromptDisclosure`）。
 *  - 家长：任何时候都不放开（家长本来也没有轨迹入口）；
 *  - 平台管理员：始终放开（开关面向老师端：管理员要能审计自己关掉的是什么）；
 *  - 老师：只在开关开启时放开。
 */
export function reviewPromptDisclosureAllowed(policy, { role = 'teacher' } = {}) {
  const item = normalizeReviewTracePolicy(policy);
  const roleKey = str(role) || 'teacher';
  if (roleKey === 'parent') return false;
  if (roleKey === 'admin') return true;
  return item.allowPromptDisclosure !== false;
}

/** 受限时那句话（放开时返回空串，界面据此不渲染提示）。 */
export function reviewTracePromptNote(policy, { role = 'teacher' } = {}) {
  return reviewPromptDisclosureAllowed(policy, { role }) ? '' : REVIEW_TRACE_DISCLOSURE_NOTE;
}

// ---------------------------------------------------------------------------
// 可见性（老师只看自己经手的轨迹；跨机构不可见）
// ---------------------------------------------------------------------------

/** 会话身份 → 可见性判据的入参（`main.jsx` 与断言读同一份口径）。 */
export function reviewTraceViewer(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const role = str(source.role);
  const adminTier = str(source.adminTier) || (role === 'admin' ? 'org' : '');
  return {
    role,
    adminTier,
    actorId: str(source.actorId),
    teacherId: str(source.teacherId),
    teacherName: str(source.teacherName || source.actorName),
    orgId: str(source.orgId)
  };
}

/** 同一个人：actorId / teacherId 命中，或（两边都有姓名时）姓名命中。 */
function sameTeacher(trace, viewer) {
  const ids = [viewer.actorId, viewer.teacherId].filter(Boolean);
  const traceIds = [trace.teacherId].filter(Boolean);
  if (ids.length && traceIds.length && ids.some((id) => traceIds.includes(id))) return true;
  const names = [viewer.teacherName].filter(Boolean);
  const traceNames = [trace.teacherName].filter(Boolean);
  return Boolean(names.length && traceNames.length && names.some((name) => traceNames.includes(name)));
}

/**
 * 这条轨迹对当前会话**可见吗**：
 *  - 家长：永远不可见（家长端连入口都没有）；
 *  - 平台管理员：全部可见（平台审计）；
 *  - 机构管理员：同机构可见（轨迹没写机构的历史记录按本机构读取）；
 *  - 老师：**只看自己经手点评的轨迹**，且必须同机构；轨迹没写老师的（旧记录）判**不可见**（fail-safe）。
 */
export function reviewTraceVisibleTo(trace, viewer) {
  const item = trace && typeof trace === 'object' ? trace : null;
  const who = reviewTraceViewer(viewer);
  if (!item) return false;
  if (!who.role || who.role === 'parent') return false;
  if (who.role === 'admin') {
    if (who.adminTier === 'platform') return true;
    const traceOrg = str(item.orgId);
    return !traceOrg || !who.orgId || traceOrg === who.orgId;
  }
  if (who.role !== 'teacher') return false;
  const traceOrg = str(item.orgId);
  if (traceOrg && who.orgId && traceOrg !== who.orgId) return false; // 跨机构轨迹不可见
  return sameTeacher(item, who);
}

/** 可见性的一句话说明（生成日志页表格里的「范围」列）。 */
export function reviewTraceVisibilityText(trace, viewer) {
  const who = reviewTraceViewer(viewer);
  if (!reviewTraceVisibleTo(trace, who)) return '不可见';
  if (who.role === 'admin' && who.adminTier === 'platform') return '平台审计（全部机构）';
  if (who.role === 'admin') return '本机构';
  return '本人经手';
}

// ---------------------------------------------------------------------------
// 列表行与筛选（按学员 / 老师 / 模型 / 时间范围 / 状态）
// ---------------------------------------------------------------------------

/** 轨迹 → 生成日志列表里的一行（界面、导出、断言读同一份）。 */
export function reviewTraceRow(trace) {
  const item = trace && typeof trace === 'object' ? trace : {};
  const status = str(item.status);
  const timing = item.timing && typeof item.timing === 'object' ? item.timing : {};
  const usage = item.usage && typeof item.usage === 'object' ? item.usage : {};
  const reasoning = typeof item.reasoning === 'string' ? item.reasoning : '';
  const output = str(item.output?.raw);
  const system = str(item.prompts?.system);
  const user = str(item.prompts?.user);
  const totalMs = num(timing.totalMs);
  return {
    traceId: str(item.traceId),
    taskLabel: str(item.taskLabel) || '五维点评',
    studentId: str(item.studentId),
    studentName: str(item.studentName),
    teacherId: str(item.teacherId),
    teacherName: str(item.teacherName),
    orgId: str(item.orgId),
    lessonId: str(item.lessonId),
    model: str(item.model),
    modelSource: str(item.modelSource),
    status,
    statusLabel: REVIEW_TRACE_STATUS_LABELS[status] || status,
    createdAt: str(item.createdAt),
    createdAtText: reviewTraceTimeText(item.createdAt),
    archivedAt: str(item.archivedAt),
    reasoningChars: reasoning.length,
    outputChars: output.length,
    promptChars: system.length + user.length,
    totalTokens: num(usage.totalTokens) || 0,
    totalMs,
    durationText: totalMs === null ? '' : (totalMs < 1000 ? `${Math.round(totalMs)} 毫秒` : `${(totalMs / 1000).toFixed(1)} 秒`),
    errorMessage: str(item.error?.message),
    errorCode: str(item.error?.code)
  };
}

/** 可见轨迹的列表行（时间倒序；界面与筛选都从这里出发）。 */
export function reviewTraceRows(traces, viewer) {
  const list = Array.isArray(traces) ? traces.filter(Boolean) : [];
  return list
    .filter((trace) => reviewTraceVisibleTo(trace, viewer))
    .map(reviewTraceRow)
    .filter((row) => row.traceId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** 筛选框里那几组选项（学员 / 老师 / 模型从轨迹里现算，状态用固定枚举）。 */
export function reviewTraceFilterOptions(traces, viewer) {
  const rows = reviewTraceRows(traces, viewer);
  const uniq = (list) => {
    const seen = new Map();
    list.forEach((value) => { const key = str(value); if (key && !seen.has(key)) seen.set(key, key); });
    return [...seen.values()];
  };
  return {
    students: uniq(rows.filter((row) => row.studentName || row.studentId).map((row) => row.studentName || row.studentId)).map((name) => ({ value: name, label: name })),
    teachers: uniq(rows.filter((row) => row.teacherName).map((row) => row.teacherName)).map((name) => ({ value: name, label: name })),
    models: uniq(rows.map((row) => row.model)).map((name) => ({ value: name, label: name })),
    statuses: REVIEW_TRACE_STATUS_OPTIONS
  };
}

/** 归一筛选条件（认不出的键丢掉；空串 = 该维度不过滤）。 */
export function normalizeReviewTraceFilters(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const filters = {};
  REVIEW_TRACE_FILTER_FIELDS.forEach((key) => { filters[key] = str(source[key]); });
  return filters;
}

const contains = (value, needle) => str(value).toLowerCase().includes(str(needle).toLowerCase());

/** 一条行是否命中筛选（五个维度之间是「与」）。 */
export function reviewTraceRowMatches(row, filters) {
  const item = normalizeReviewTraceFilters(filters);
  if (item.student && !(contains(row.studentName, item.student) || contains(row.studentId, item.student))) return false;
  if (item.teacher && !(contains(row.teacherName, item.teacher) || contains(row.teacherId, item.teacher))) return false;
  if (item.model && str(row.model).toLowerCase() !== item.model.toLowerCase()) return false;
  if (item.status && str(row.status) !== item.status) return false;
  const day = reviewTraceDateKey(row.createdAt);
  if (item.from && (!day || day < item.from)) return false;
  if (item.to && (!day || day > item.to)) return false;
  return true;
}

/** 生效的筛选条件（界面上显示「已按 X 筛选」时读它）。 */
export function reviewTraceActiveFilters(filters) {
  const item = normalizeReviewTraceFilters(filters);
  const labels = { student: '学员', teacher: '老师', model: '模型', status: '状态', from: '起始日期', to: '截止日期' };
  return REVIEW_TRACE_FILTER_FIELDS
    .filter((key) => item[key])
    .map((key) => ({ key, label: labels[key], value: key === 'status' ? (REVIEW_TRACE_STATUS_LABELS[item[key]] || item[key]) : item[key] }));
}

/**
 * 查询（可见性 + 五个筛选维度一次算完）。
 * 返回 `{ rows, shown, visibleTotal, total, filters, active, emptyText, summaryText }`：
 *  - `visibleTotal` = 当前身份能看到的总条数（老师看不到别人的，因此这个数会小于 `total`）；
 *  - 一条都没有时 `emptyText` 给出「为什么空」（还没归档 vs 筛选没命中）。
 */
export function filterReviewTraces(traces, filters, { viewer = null } = {}) {
  const list = Array.isArray(traces) ? traces.filter(Boolean) : [];
  const rows = reviewTraceRows(list, viewer);
  const normalized = normalizeReviewTraceFilters(filters);
  const matched = rows.filter((row) => reviewTraceRowMatches(row, normalized));
  const active = reviewTraceActiveFilters(normalized);
  const emptyText = !rows.length
    ? (list.length ? '当前身份看不到这些轨迹：老师只看自己经手点评的轨迹，跨机构的轨迹不可见。' : '还没有点评轨迹：老师完成一次点评并归档后，轨迹会在这里出现。')
    : '没有符合筛选条件的轨迹，试试清空筛选或放宽时间范围。';
  const summaryText = active.length
    ? `已按 ${active.map((item) => `${item.label}「${item.value}」`).join('、')} 筛选：命中 ${matched.length} 条（可见 ${rows.length} 条）`
    : `共 ${rows.length} 条可见轨迹`;
  return {
    rows: matched,
    shown: matched.length,
    visibleTotal: rows.length,
    total: list.length,
    filters: normalized,
    active,
    emptyText,
    summaryText
  };
}

// ---------------------------------------------------------------------------
// 审计（复制 / 导出轨迹留痕时的「导出范围」）
// ---------------------------------------------------------------------------

/** 导出范围的三种说法（审计 entry 的 `scope` 与界面回执读同一份）。 */
export const REVIEW_TRACE_AUDIT_SCOPES = {
  copy: '复制全部',
  markdown: '导出 Markdown',
  json: '导出 JSON'
};

/**
 * 审计里的「导出范围」：`导出 Markdown · 6 个分区 · 学员 陈一诺`（提示词受限时点名）。
 * 操作人 / 时间 / 轨迹 id 由 `data/auditLog.js` 的必填清单把关，这里只产出范围那一段。
 */
export function reviewTraceAuditScopeText({ kind = 'markdown', sectionCount = 0, student = '', restricted = false } = {}) {
  const label = REVIEW_TRACE_AUDIT_SCOPES[str(kind)] || REVIEW_TRACE_AUDIT_SCOPES.markdown;
  const parts = [label];
  if (sectionCount) parts.push(`${sectionCount} 个分区`);
  if (student) parts.push(`学员 ${student}`);
  if (restricted) parts.push('提示词受限');
  return parts.join(' · ');
}
