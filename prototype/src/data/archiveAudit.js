// 管理端的**转发与授权审计**查询（[第四步 US-211] / F-ARCHIVE-PERM-01）。
//
// 验收原文：「管理端可查询转发与授权审计，支持按学员、老师、时间、状态筛选」。
// 本模块是这一页的查询层（零依赖纯函数 + 常量，可 `node` 直跑断言；界面只渲染它的产物）：
//
//  ① **查什么**：归档创建 / 更新、跨班访问被拒、分享生成、家长打开、撤回、授权撤回、
//     报告生成、到期清理 —— 动作清单只有一份（`data/auditLog.js` 的 `ARCHIVE_AUDIT_ACTIONS`）。
//  ② **状态是推导的，不另存一份**：每条日志按动作映射到一个状态词（归档 / 分享生成 / 家长打开 /
//     撤回 / 授权撤回 / 报告生成 / 被拒绝），被拒的条目一律归到「被拒绝」（`outcome === 'denied'` 优先）。
//  ③ **四个筛选维度**：学员（`studentName` / `objectName`）、老师（`actorName` / `actorId`）、
//     时间（`at` 的日期区间，闭区间）、状态（上面那一份）。筛选只过滤，不改写任何条目。
//  ④ **与审计日志同一份数据**：这一页读的就是 `App` 里那一份 `auditLog`（本机镜像 + 云端合并），
//     不另开一张表 —— 「谁把哪一条档案转给了谁」与「模板写入被拒」在同一条时间轴上。

import { ARCHIVE_AUDIT_ACTIONS, AUDIT_ACTION_LABELS, auditTimeText, auditVersionText, normalizeAuditEntry } from './auditLog';

const str = value => (value === null || value === undefined ? '' : String(value).trim());

/** 时间筛的两个边界：全部 / 有日期的条目才能被区间命中。 */
export const ARCHIVE_AUDIT_TIME_ALL = '全部时间';
export const ARCHIVE_AUDIT_TIME_OPTIONS = [
  { id: 'all', label: '全部时间', days: 0 },
  { id: '7d', label: '最近 7 天', days: 7 },
  { id: '30d', label: '最近 30 天', days: 30 },
  { id: '90d', label: '最近 90 天', days: 90 }
];

/** 状态筛选（推导出的状态词；`all` = 全部，界面第一项）。 */
export const ARCHIVE_AUDIT_STATES = [
  { id: 'all', label: '全部状态' },
  { id: 'archived', label: '归档' },
  { id: 'forwarded', label: '分享生成' },
  { id: 'opened', label: '家长打开' },
  { id: 'revoked', label: '撤回' },
  { id: 'report', label: '报告生成' },
  { id: 'denied', label: '被拒绝' },
  { id: 'retention', label: '到期清理' }
];

/** 状态词 → 动作（推导的唯一一份映射）。 */
const STATE_BY_ACTION = {
  'archive.record.create': 'archived',
  'archive.record.update': 'archived',
  'archive.share.generate': 'forwarded',
  'archive.share.open': 'opened',
  'archive.share.revoke': 'revoked',
  'consent.revoke': 'revoked',
  'archive.report.generate': 'report',
  'archive.access.denied': 'denied',
  'archive.retention.cleanup': 'retention'
};

/** 状态词的可读标签（面板与断言读同一份）。 */
export const ARCHIVE_AUDIT_STATE_LABELS = {
  all: '全部状态',
  archived: '归档',
  forwarded: '分享生成',
  opened: '家长打开',
  revoked: '撤回',
  report: '报告生成',
  denied: '被拒绝',
  retention: '到期清理'
};

/** 这一页的标题与说明（界面不各写一份）。 */
export const ARCHIVE_AUDIT_TITLE = '转发与授权审计';
export const ARCHIVE_AUDIT_DESC = '谁把哪一条档案转给了谁、家长有没有打开、有没有撤回授权、跨班访问被拒了几次 —— 一条时间轴，可按学员、老师、时间与状态筛选。';
export const ARCHIVE_AUDIT_EMPTY_TEXT = '还没有转发与授权记录：老师归档并生成分享链接之后，这里会留下操作人 / 时间 / 对象 / 版本。';
export const ARCHIVE_AUDIT_FILTER_ALL = '全部';
export const ARCHIVE_AUDIT_FILTER_STUDENT_LABEL = '学员';
export const ARCHIVE_AUDIT_FILTER_TEACHER_LABEL = '老师';
export const ARCHIVE_AUDIT_FILTER_TIME_LABEL = '时间';
export const ARCHIVE_AUDIT_FILTER_STATE_LABEL = '状态';
export const ARCHIVE_AUDIT_RESET_LABEL = '重置筛选';

/** 日期读数：「2026-10-12」（读不出返回空串）。 */
export function archiveAuditDay(value) {
  const text = str(value);
  if (!text) return '';
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return '';
  const date = new Date(parsed);
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 这条日志是不是这一页要查的（动作白名单）。 */
export function isArchiveAuditEntry(entry) {
  const item = normalizeAuditEntry(entry);
  return Boolean(item && ARCHIVE_AUDIT_ACTIONS.includes(item.action));
}

/** 状态推导：被拒优先（拒绝也可能发生在分享动作上，但「被拒绝」是那一刻的真相）。 */
export function archiveAuditStateOf(entry) {
  const item = normalizeAuditEntry(entry);
  if (!item) return '';
  if (item.outcome === 'denied') return 'denied';
  return STATE_BY_ACTION[item.action] || '';
}

/** 对象的可读说法：学员（+ 记录 id 末几位）或报告 / 授权的对象名。 */
function archiveAuditObjectText(item) {
  const name = str(item.studentName) || str(item.objectName);
  const id = str(item.recordId);
  if (name && id) return `${name}（${id}）`;
  return name || id || '—';
}

/**
 * 一条日志 → 面板上的一行（**所有行同形状**）。
 * 四项在行里都露出来：操作人、时间、对象、版本 —— 验收点名的四件事。
 */
export function archiveAuditRow(entry) {
  const item = normalizeAuditEntry(entry);
  if (!item) return null;
  const state = archiveAuditStateOf(item);
  const versionText = auditVersionText(item);
  return {
    id: item.id,
    action: item.action,
    actionLabel: str(item.actionLabel) || AUDIT_ACTION_LABELS[item.action] || item.action,
    state,
    stateLabel: ARCHIVE_AUDIT_STATE_LABELS[state] || item.actionLabel || item.action,
    actorId: item.actorId,
    actorName: item.actorName || item.actorId || '未知操作人',
    actorRole: item.actorRole,
    actorRoleLabel: item.actorRoleLabel,
    studentId: item.studentId,
    studentName: str(item.studentName) || str(item.objectName),
    objectText: archiveAuditObjectText(item),
    recordId: item.recordId,
    shareToken: item.shareToken,
    version: item.version,
    versionText,
    lessonDate: item.lessonDate,
    at: item.at,
    atText: auditTimeText(item.at),
    day: archiveAuditDay(item.at),
    outcome: item.outcome,
    detail: item.detail,
    // 一行整句（activity 流与断言都读它）。
    line: [
      item.actionLabel || item.action,
      item.actorName || item.actorId || '未知操作人',
      archiveAuditObjectText(item),
      versionText,
      auditTimeText(item.at)
    ].filter(Boolean).join(' · ') + (item.outcome === 'denied' ? '（被拒绝）' : '')
  };
}

/** 一整批日志 → 行（只保留本页要查的动作，按时间倒序）。 */
export function archiveAuditRows(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter(isArchiveAuditEntry)
    .map(archiveAuditRow)
    .filter(Boolean)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** 筛选可选项（从当前这批日志里推出来；不含「全部」的那一项由界面自己加）。 */
export function archiveAuditFilterOptions(entries) {
  const rows = archiveAuditRows(entries);
  const students = [];
  const teachers = [];
  rows.forEach(row => {
    if (row.studentName && !students.includes(row.studentName)) students.push(row.studentName);
    if (row.actorName && !teachers.includes(row.actorName)) teachers.push(row.actorName);
  });
  return {
    students: students.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    teachers: teachers.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    states: ARCHIVE_AUDIT_STATES
  };
}

/**
 * 四个维度筛选（唯一真源）：
 *  - `student`：命中 `studentName` 或 `objectName`（报告 / 授权没有学员 id 时按对象名匹配）；
 *  - `teacher`：命中 `actorName` 或 `actorId`；
 *  - `from` / `to`：日期闭区间（`YYYY-MM-DD`，空串 = 不限）；
 *  - `state`：上面那一份状态词（`all` / 空 = 全部）。
 * 只过滤，不改写：被筛掉的条数在这里如实算出来（`hiddenCount`）。
 */
export function filterArchiveAuditEntries(entries, { student = '', teacher = '', from = '', to = '', state = 'all' } = {}) {
  const rows = archiveAuditRows(entries);
  const wantedStudent = str(student);
  const wantedTeacher = str(teacher);
  const wantedState = str(state) || 'all';
  const fromDay = str(from);
  const toDay = str(to);
  const filtered = rows.filter(row => {
    if (wantedStudent && !(row.studentName === wantedStudent || row.objectText.startsWith(wantedStudent))) return false;
    if (wantedTeacher && !(row.actorName === wantedTeacher || row.actorId === wantedTeacher)) return false;
    if (fromDay && (!row.day || row.day < fromDay)) return false;
    if (toDay && (!row.day || row.day > toDay)) return false;
    if (wantedState !== 'all' && row.state !== wantedState) return false;
    return true;
  });
  return {
    rows: filtered,
    total: rows.length,
    count: filtered.length,
    hiddenCount: rows.length - filtered.length,
    filters: { student: wantedStudent, teacher: wantedTeacher, from: fromDay, to: toDay, state: wantedState }
  };
}

/** 汇总读数（面板顶部）：总条数 / 各自状态的条数 / 涉及几位学员与老师 / 最近一条时间。 */
export function archiveAuditSummary(entries) {
  const rows = archiveAuditRows(entries);
  const byState = {};
  ARCHIVE_AUDIT_STATES.forEach(item => { byState[item.id] = 0; });
  rows.forEach(row => { byState[row.state] = (byState[row.state] || 0) + 1; });
  const students = [...new Set(rows.map(row => row.studentName).filter(Boolean))];
  const teachers = [...new Set(rows.map(row => row.actorName).filter(Boolean))];
  const lastAt = rows.length ? rows.reduce((newest, row) => (String(row.at) > String(newest) ? String(row.at) : newest), String(rows[0].at)) : '';
  return {
    total: rows.length,
    byState,
    denied: byState.denied || 0,
    revoked: byState.revoked || 0,
    opened: byState.opened || 0,
    studentCount: students.length,
    teacherCount: teachers.length,
    students,
    teachers,
    lastAt,
    lastAtText: auditTimeText(lastAt),
    text: rows.length
      ? `共 ${rows.length} 条：归档 ${byState.archived || 0} · 分享生成 ${byState.forwarded || 0} · 家长打开 ${byState.opened || 0} · 撤回 ${byState.revoked || 0} · 报告生成 ${byState.report || 0} · 被拒 ${byState.denied || 0}；涉及 ${students.length} 位学员 · ${teachers.length} 位操作人。`
      : ARCHIVE_AUDIT_EMPTY_TEXT
  };
}

/** 筛选后的空态文案（「库里本来就没有」与「被筛空了」分开说）。 */
export function archiveAuditEmptyText({ total = 0, hiddenCount = 0 } = {}) {
  if (total === 0) return ARCHIVE_AUDIT_EMPTY_TEXT;
  if (hiddenCount > 0) return `当前筛选下没有记录（共 ${total} 条，被筛掉 ${hiddenCount} 条）。放宽学员 / 老师 / 时间 / 状态后即可看到。`;
  return ARCHIVE_AUDIT_EMPTY_TEXT;
}
