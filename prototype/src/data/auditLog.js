/**
 * 审计日志（[第二步 US-013] / PRD US-013 第 5 条）。
 *
 * 「另存为我的模板」与「保存图片」两个动作**必须留痕**：谁（操作人）、对谁（学员 id）、
 * 什么时候（时间）、动了哪一套（模板 id）。本模块是这条日志的数据形状与规则：
 *
 *   - 字段白名单构造（`buildAuditEntry`）：结构上就没有别的东西能进来 ——
 *     儿童素材地址、手机号这类东西不会被顺手写进日志；
 *   - 每条进日志的动作有**必填字段清单**（`AUDIT_ACTION_REQUIRED`），
 *     缺失的部分由 `auditEntryMissingFields` 点名（面板上标红，断言直接读它）；
 *   - 追加、上限、按时间倒序、按 id 合并（`appendAuditEntry` / `mergeAuditLog`）；
 *   - 本机镜像读写（`loadAuditLog` / `persistAuditLog`），云端推送在
 *     `services/auditLogApi.js`（表还没建时只落本机镜像，与装裱模板同一套兜底口径）。
 *
 * 与 `data/artworkWriteBack.js` 同一套纪律：**零依赖纯函数 + 常量**，可以直接用 Node 跑断言。
 */

/** 本机镜像的键（主键仍是「裸数组」形状；云端的附属信息另存兄弟键，不改主键形状）。 */
export const AUDIT_LOG_STORAGE_KEY = 'xinlehui-audit-log-v1';

/** 日志上限：本机镜像只留最近 200 条（更早的由云端表负责，本机不无限增长）。 */
export const AUDIT_LOG_LIMIT = 200;

/** 进日志的动作（AC 点名的两个 + 「越权写入被拒」这条合规事件）。 */
export const AUDIT_ACTIONS = {
  templateSave: 'framing.template.save',
  artworkSave: 'framing.artwork.save',
  templateWriteDenied: 'framing.template.write-denied'
};

export const AUDIT_ACTION_LABELS = {
  'framing.template.save': '另存为我的模板',
  'framing.artwork.save': '保存图片（成品图写回档案）',
  'framing.template.write-denied': '模板写入被拒绝'
};

/**
 * 每个动作的**必填字段**：
 *   - 另存为我的模板：操作人 / 时间 / 模板 id（这条路没有学员，学员 id 留空是正常的）；
 *   - 保存图片：操作人 / 时间 / 学员 id（学员是这条成品图的归属，必须有）。
 * `templateId` 在保存图片里是「这次用的是哪套模板」——老师没用模板时（自定义微调）为空，不算缺。
 */
export const AUDIT_ACTION_REQUIRED = {
  'framing.template.save': ['actorId', 'at', 'templateId'],
  'framing.artwork.save': ['actorId', 'at', 'studentId'],
  'framing.template.write-denied': ['actorId', 'at']
};

/** PRD 点名的四项溯源字段（面板上给它们一个明确位置，验证脚本点名核对）。 */
export const AUDIT_TRACE_FIELDS = ['actorId', 'studentId', 'at', 'templateId'];

/** 字段白名单：日志条目只认这些键（构造时按它复制，别的一律丢掉）。 */
export const AUDIT_ENTRY_FIELDS = [
  'id',
  'action',
  'actionLabel',
  'actorId',
  'actorName',
  'actorRole',
  'actorRoleLabel',
  'orgId',
  'studentId',
  'studentName',
  'lessonId',
  'lessonDate',
  'templateId',
  'templateName',
  'scope',
  'outcome',
  'detail',
  'at'
];

const str = (value) => (value === null || value === undefined ? '' : String(value).trim());

/** 日志 id：随机唯一值（不做自然键派生 —— 同一秒内的两次动作也要各留一条）。 */
export function makeAuditEntryId() {
  return `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 时间文案（`2026-10-11 20:15`）；认不出的值原样返回 `at` 本身。 */
export function auditTimeText(value) {
  const text = str(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  const pad = (input) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 白名单构造一条日志。**永不抛错**：缺字段补空值。
 * `outcome` 只有 `ok` / `denied` 两种（被拒的写入同样留痕 —— 合规要的是「谁试过」）。
 */
export function buildAuditEntry(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const action = str(source.action);
  return {
    id: str(source.id) || makeAuditEntryId(),
    action,
    actionLabel: str(source.actionLabel) || AUDIT_ACTION_LABELS[action] || action,
    actorId: str(source.actorId),
    actorName: str(source.actorName),
    actorRole: str(source.actorRole),
    actorRoleLabel: str(source.actorRoleLabel),
    orgId: str(source.orgId),
    studentId: str(source.studentId),
    studentName: str(source.studentName),
    lessonId: str(source.lessonId),
    lessonDate: str(source.lessonDate),
    templateId: str(source.templateId),
    templateName: str(source.templateName),
    scope: str(source.scope),
    outcome: str(source.outcome) === 'denied' ? 'denied' : 'ok',
    detail: str(source.detail).slice(0, 240),
    at: str(source.at) || new Date().toISOString()
  };
}

/** 读旧记录用的容错收敛：认不出的输入返回 `null`（不编造时间、不补 id）。 */
export function normalizeAuditEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entry = buildAuditEntry(raw);
  if (!entry.action || !entry.at) return null;
  return entry;
}

/** 这条日志按动作的必填清单还差什么（空数组 = 齐全）。 */
export function auditEntryMissingFields(entry) {
  const item = normalizeAuditEntry(entry) || buildAuditEntry(entry);
  const required = AUDIT_ACTION_REQUIRED[item.action] || ['actorId', 'at'];
  return required.filter(key => !str(item[key]));
}

/** 这条日志的必填字段齐不齐（`auditEntryMissingFields` 的布尔版）。 */
export function auditEntryComplete(entry) {
  return auditEntryMissingFields(entry).length === 0;
}

/** 四项溯源字段的取值（面板与断言读同一份，缺的写空串）。 */
export function auditTraceValues(entry) {
  const item = normalizeAuditEntry(entry) || buildAuditEntry(entry);
  return AUDIT_TRACE_FIELDS.map(key => ({ key, value: str(item[key]) }));
}

/** 追加一条日志：新的在前，按 id 去重（同一条重复提交只留一条），上限 `AUDIT_LOG_LIMIT`。 */
export function appendAuditEntry(entries, entry) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const next = normalizeAuditEntry(entry);
  if (!next) return list;
  const rest = list.filter(item => str(item.id) !== next.id);
  return [next, ...rest].slice(0, AUDIT_LOG_LIMIT);
}

/** 合并两份日志（云端 + 本机镜像）：按 id 去重、按时间倒序、同一分钟内的顺序保持稳定。 */
export function mergeAuditLog(remote, local) {
  const byId = new Map();
  (Array.isArray(remote) ? remote : []).forEach(item => {
    const entry = normalizeAuditEntry(item);
    if (entry) byId.set(entry.id, entry);
  });
  (Array.isArray(local) ? local : []).forEach(item => {
    const entry = normalizeAuditEntry(item);
    if (entry) byId.set(entry.id, entry);
  });
  return [...byId.values()].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, AUDIT_LOG_LIMIT);
}

/** 读本机镜像：坏数据安全降级成空列表（不抛错、不编造记录）。 */
export function loadAuditLog() {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  let parsed = null;
  try { parsed = JSON.parse(window.localStorage.getItem(AUDIT_LOG_STORAGE_KEY)); } catch { parsed = null; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeAuditEntry).filter(Boolean).slice(0, AUDIT_LOG_LIMIT);
}

/** 写本机镜像（结构上是白名单条目，别的东西进不来）。 */
export function persistAuditLog(entries) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const list = (Array.isArray(entries) ? entries : []).map(normalizeAuditEntry).filter(Boolean).slice(0, AUDIT_LOG_LIMIT);
  try { window.localStorage.setItem(AUDIT_LOG_STORAGE_KEY, JSON.stringify(list)); } catch { /* 配额满时不动本机镜像 */ }
}

/** 最近的某类动作（`filter` 可再按 studentId / lessonId / templateId 收窄）。 */
export function latestAuditEntry(entries, action, filter = {}) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const matched = list.filter(item => {
    if (action && item.action !== action) return false;
    if (filter.studentId && item.studentId !== filter.studentId) return false;
    if (filter.lessonId && item.lessonId !== filter.lessonId) return false;
    if (filter.templateId && item.templateId !== filter.templateId) return false;
    return true;
  });
  if (!matched.length) return null;
  return matched.reduce((newest, item) => (String(item.at) > String(newest.at) ? item : newest), matched[0]);
}

/** 一条日志的可读摘要（面板一行）。 */
export function auditEntryText(entry) {
  const item = normalizeAuditEntry(entry);
  if (!item) return '';
  const actor = item.actorName || item.actorId || '未知操作人';
  const target = item.studentName
    ? `${item.studentName}${item.templateName ? ` · ${item.templateName}` : ''}`
    : (item.templateName || item.templateId || '');
  const outcome = item.outcome === 'denied' ? '（被拒绝）' : '';
  return [item.actionLabel, actor, target, auditTimeText(item.at)].filter(Boolean).join(' · ') + outcome;
}

/** 四项溯源的可读一行：操作人 / 学员 / 模板 / 时间（缺的项跳过）。 */
export function auditTraceText(entry) {
  const item = normalizeAuditEntry(entry);
  if (!item) return '';
  return [
    item.actorName || item.actorId ? `操作人 ${item.actorName || item.actorId}` : '',
    item.studentId || item.studentName ? `学员 ${item.studentName || item.studentId}${item.studentId && item.studentName ? `（${item.studentId}）` : ''}` : '',
    item.templateId ? `模板 ${item.templateName ? `${item.templateName}（${item.templateId}）` : item.templateId}` : '',
    item.at ? `时间 ${auditTimeText(item.at)}` : ''
  ].filter(Boolean).join(' · ');
}

/** 活跃度汇总（面板读数）：总条数 / 被拒条数 / 最近一条时间 / 覆盖的动作。 */
export function auditLogStats(entries) {
  const list = (Array.isArray(entries) ? entries : []).map(normalizeAuditEntry).filter(Boolean);
  const actions = [...new Set(list.map(item => item.action))];
  return {
    total: list.length,
    denied: list.filter(item => item.outcome === 'denied').length,
    lastAt: list.length ? list.reduce((newest, item) => (String(item.at) > String(newest) ? String(item.at) : newest), String(list[0].at)) : '',
    actions,
    actionLabels: actions.map(action => AUDIT_ACTION_LABELS[action] || action)
  };
}

export const AUDIT_LOG_EMPTY_TEXT = '还没有审计记录：老师「另存为我的模板」或「保存图片」之后，这里会留下操作人 / 学员 / 模板 / 时间。';
