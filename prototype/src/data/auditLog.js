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
 * 观察词 AI 补充（[第三步 US-111]）复用这一份日志：`keyword.candidates.generate` /
 * `.adopt` / `.discard` 三个动作的 detail 里写清「按什么上下文要了多少候选」与「采纳了哪些词」，
 * 动作键与文案的唯一真源都在这里（`data/reviewKeywordAi.js` 只产出 detail 正文）。
 *
 * 与 `data/artworkWriteBack.js` 同一套纪律：**零依赖纯函数 + 常量**，可以直接用 Node 跑断言。
 */

/** 本机镜像的键（主键仍是「裸数组」形状；云端的附属信息另存兄弟键，不改主键形状）。 */
export const AUDIT_LOG_STORAGE_KEY = 'xinlehui-audit-log-v1';

/** 日志上限：本机镜像只留最近 200 条（更早的由云端表负责，本机不无限增长）。 */
export const AUDIT_LOG_LIMIT = 200;

/**
 * 进日志的动作（AC 点名的两个 + 「越权写入被拒」这条合规事件
 * + [第三步 US-111] 观察词 AI 补充的三条：候选 / 采纳 / 丢弃）。
 */
export const AUDIT_ACTIONS = {
  templateSave: 'framing.template.save',
  artworkSave: 'framing.artwork.save',
  templateWriteDenied: 'framing.template.write-denied',
  keywordCandidates: 'keyword.candidates.generate',
  keywordAdopt: 'keyword.candidates.adopt',
  keywordDiscard: 'keyword.candidates.discard',
  // [第三步 US-112] 第 6 条：复制 / 导出点评轨迹必须留痕（操作人、时间、轨迹 id、导出范围）。
  traceCopy: 'trace.copy',
  traceExport: 'trace.export',
  // [第四步 US-211] 归档与转发的六个动作：归档创建 / 更新、分享生成、家长打开、撤回、报告生成
  // 都要留痕（操作人、时间、对象、版本）；另加跨班访问被拒与到期清理两条合规事件。
  archiveCreate: 'archive.record.create',
  archiveUpdate: 'archive.record.update',
  archiveAccessDenied: 'archive.access.denied',
  shareGenerate: 'archive.share.generate',
  shareOpen: 'archive.share.open',
  shareRevoke: 'archive.share.revoke',
  consentRevoke: 'consent.revoke',
  reportGenerate: 'archive.report.generate',
  retentionCleanup: 'archive.retention.cleanup',
  // [第四步 US-223] 视频任务的五条专属留痕（「分享」复用 `archive.share.generate` / `.revoke`，
  // 成片分享与图文分享走同一条令牌账）：提交 / 完成 / 下载 / 更换音乐 / 删除成片。
  videoJobSubmit: 'video.job.submit',
  videoJobDone: 'video.job.done',
  videoDownload: 'video.output.download',
  videoMusicChange: 'video.music.change',
  videoRecordDelete: 'video.record.delete',
  // [海报 US-311b] 海报的两条留痕：**导出图片**与**复制微信文案（转发）**都要留痕
  // （操作人 / 时间 / 对象：学员或班级 + 记录 + 模板）。不并进 `ARCHIVE_AUDIT_ACTIONS`：
  // 那一份是归档与分享九个动作的清单（US-211 的面板与断言逐条读它）。
  posterExport: 'poster.export',
  posterForward: 'poster.forward'
};

export const AUDIT_ACTION_LABELS = {
  'framing.template.save': '另存为我的模板',
  'framing.artwork.save': '保存图片（成品图写回档案）',
  'framing.template.write-denied': '模板写入被拒绝',
  'keyword.candidates.generate': 'AI 生成观察词候选',
  'keyword.candidates.adopt': 'AI 采纳观察词（写入草稿）',
  'keyword.candidates.discard': 'AI 丢弃观察词候选',
  'trace.copy': '复制点评轨迹',
  'trace.export': '导出点评轨迹',
  'archive.record.create': '归档创建',
  'archive.record.update': '归档更新',
  'archive.access.denied': '跨班访问被拒绝',
  'archive.share.generate': '生成家长分享链接',
  'archive.share.open': '家长打开分享',
  'archive.share.revoke': '撤回分享',
  'consent.revoke': '家长撤回查看授权',
  'archive.report.generate': '生成阶段报告',
  'archive.retention.cleanup': '归档到期清理',
  'video.job.submit': '提交视频任务',
  'video.job.done': '视频任务完成（成片就绪）',
  'video.output.download': '下载成片',
  'video.music.change': '更换成片音乐',
  'video.record.delete': '删除成片',
  // [海报 US-311b] 两个动作的标签（面板上那一行读它，界面不各写一份）。
  'poster.export': '导出海报图片',
  'poster.forward': '转发海报文案'
};

/**
 * 归档与转发的九个动作（[第四步 US-211]）。
 * 管理端的「转发与授权审计」面板按它筛选 —— 面板、断言、服务端留痕读的都是这一份。
 */
export const ARCHIVE_AUDIT_ACTIONS = [
  'archive.record.create',
  'archive.record.update',
  'archive.access.denied',
  'archive.share.generate',
  'archive.share.open',
  'archive.share.revoke',
  'consent.revoke',
  'archive.report.generate',
  'archive.retention.cleanup'
];

/** 复制 / 导出轨迹的两个动作（合规面板与断言按它们筛选，导出范围写在 `scope` 里）。 */
export const TRACE_AUDIT_ACTIONS = ['trace.copy', 'trace.export'];

/**
 * 海报的两个动作（[海报 US-311b] 第 3 条「导出与转发行为写入审计日志」）：
 * 导出图片与复制微信文案各留一条 —— 断言与界面回执读这一份，不各写一遍动作键。
 */
export const POSTER_AUDIT_ACTIONS = ['poster.export', 'poster.forward'];

/** 观察词 AI 补充的三个动作（面板上的「AI 补充留痕」按它们筛选，验收原文「候选、采纳与丢弃都留痕」）。 */
export const KEYWORD_AI_AUDIT_ACTIONS = [
  'keyword.candidates.generate',
  'keyword.candidates.adopt',
  'keyword.candidates.discard'
];

/**
 * 每个动作的**必填字段**：
 *   - 另存为我的模板：操作人 / 时间 / 模板 id（这条路没有学员，学员 id 留空是正常的）；
 *   - 保存图片：操作人 / 时间 / 学员 id（学员是这条成品图的归属，必须有）；
 *   - 观察词 AI 三条：操作人 / 时间 / 模板 id（「采纳了哪些词」写在 detail 里，没有学员）。
 * `templateId` 在保存图片里是「这次用的是哪套模板」——老师没用模板时（自定义微调）为空，不算缺。
 */
export const AUDIT_ACTION_REQUIRED = {
  'framing.template.save': ['actorId', 'at', 'templateId'],
  'framing.artwork.save': ['actorId', 'at', 'studentId'],
  'framing.template.write-denied': ['actorId', 'at'],
  'keyword.candidates.generate': ['actorId', 'at', 'templateId'],
  'keyword.candidates.adopt': ['actorId', 'at', 'templateId'],
  'keyword.candidates.discard': ['actorId', 'at', 'templateId'],
  // 复制 / 导出轨迹：操作人 / 时间 / 轨迹 id 必填；导出范围写在 `scope`（可为空 = 整条轨迹）。
  'trace.copy': ['actorId', 'at', 'traceId'],
  'trace.export': ['actorId', 'at', 'traceId'],
  // 归档创建 / 更新：操作人 / 时间 / 对象（学员 + 档案记录 id）/ 版本（第 N 版）—— 验收点名的四项。
  'archive.record.create': ['actorId', 'at', 'studentId', 'recordId', 'version'],
  'archive.record.update': ['actorId', 'at', 'studentId', 'recordId', 'version'],
  // 跨班访问被拒：对象是被访问的学员（写 `objectName`，因为拒绝的时候未必有学员 id）。
  'archive.access.denied': ['actorId', 'at', 'objectName'],
  // 分享三个动作：对象（学员 + 档案记录）/ 版本 / 令牌（哪一条链接）。
  'archive.share.generate': ['actorId', 'at', 'studentId', 'recordId', 'version', 'shareToken'],
  'archive.share.open': ['actorId', 'at', 'studentId', 'recordId', 'version', 'shareToken'],
  'archive.share.revoke': ['actorId', 'at', 'studentId', 'recordId', 'shareToken'],
  // 家长撤回授权：对象是那位学员（撤的是这个孩子的查看授权）。
  'consent.revoke': ['actorId', 'at', 'objectName'],
  // 阶段报告：对象是学员或班级（`objectName`）+ 版本（第 N 版）。
  'archive.report.generate': ['actorId', 'at', 'objectName', 'version'],
  // 到期清理：操作人 / 时间必填，清掉了哪些写在 `detail`（条数 + 截止日）。
  'archive.retention.cleanup': ['actorId', 'at', 'detail'],
  // [第四步 US-223] 视频任务五条：操作人 / 时间 / 任务键（或成片键）必填 —— 下载与更换音乐
  // 都挂在某一条任务上，`bytes`（下载体积）是可选读数，读不出来记 0，不算缺字段。
  'video.job.submit': ['actorId', 'at', 'jobKey'],
  'video.job.done': ['actorId', 'at', 'jobKey'],
  'video.output.download': ['actorId', 'at', 'jobKey'],
  'video.music.change': ['actorId', 'at', 'jobKey'],
  'video.record.delete': ['actorId', 'at', 'videoKey'],
  // [海报 US-311b] 海报的两条：操作人 / 时间 / 对象（学员名或班级名）必填。
  // `recordId` 不是必填 —— 班级海报与长图覆盖多条记录，挑不出「那一条」；
  // 单作品海报会照实带上记录 id（`detail` 里也写清这一次导出 / 转发的是什么）。
  'poster.export': ['actorId', 'at', 'objectName'],
  'poster.forward': ['actorId', 'at', 'objectName']
};

/**
 * 视频任务验收点名的六条留痕（[第四步 US-223] 第 2 条）：提交、完成、下载、分享、更换音乐、删除。
 * 管理端「视频任务权限与合规」面板按它筛选，断言也读这一份（分享复用图文分享的两条动作，
 * 因为成片分享与图文分享走同一个令牌账 —— 不另造一套「视频分享」动作）。
 */
export const VIDEO_TASK_AUDIT_ACTIONS = [
  'video.job.submit',
  'video.job.done',
  'video.output.download',
  'archive.share.generate',
  'video.music.change',
  'video.record.delete'
];

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
  // 轨迹 id（[第三步 US-112]）：「复制 / 导出轨迹」这两条动作要能指回被复制的那一条轨迹。
  'traceId',
  'templateId',
  'templateName',
  // 归档与转发（[第四步 US-211]）：对象是「哪一条档案记录」（`recordId`）+ 版本（`version`）
  // + 「哪一条分享链接」（`shareToken`）；报告 / 授权这类没有学员 id 的对象写 `objectName`。
  'recordId',
  'objectName',
  'version',
  'shareToken',
  // 视频任务（[第四步 US-223]）：对象是「哪一条渲染任务」（`jobKey`）与「哪一条成片」（`videoKey`）；
  // `bytes` 是这次动作牵涉的体积读数（下载成片时记下流量，机构配额读它）—— 都是可选读数，不是必填。
  'jobKey',
  'videoKey',
  'bytes',
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
    // 轨迹 id（US-112）：「复制 / 导出轨迹」这两条动作指回被操作的那一条留档。
    traceId: str(source.traceId),
    templateId: str(source.templateId),
    templateName: str(source.templateName),
    // 归档 / 转发（US-211）的对象与版本：档案记录 id、可读对象名、第 N 版、分享令牌。
    recordId: str(source.recordId),
    objectName: str(source.objectName),
    version: str(source.version),
    shareToken: str(source.shareToken),
    // 视频任务（US-223）：任务键 / 成片键 / 体积（下载流量）。体积读不出记 0（不是必填）。
    jobKey: str(source.jobKey),
    videoKey: str(source.videoKey),
    bytes: Math.max(0, Math.trunc(Number.isFinite(Number(source.bytes)) ? Number(source.bytes) : 0)),
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

/** 最近的某类动作（`filter` 可再按 studentId / lessonId / templateId / jobKey / videoKey 收窄）。 */
export function latestAuditEntry(entries, action, filter = {}) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const matched = list.filter(item => {
    if (action && item.action !== action) return false;
    if (filter.studentId && item.studentId !== filter.studentId) return false;
    if (filter.lessonId && item.lessonId !== filter.lessonId) return false;
    if (filter.templateId && item.templateId !== filter.templateId) return false;
    // 视频任务（US-223）：「这条任务 / 这一版成片留痕了吗」按两个业务键收窄。
    if (filter.jobKey && item.jobKey !== filter.jobKey) return false;
    if (filter.videoKey && item.videoKey !== filter.videoKey) return false;
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
    : (item.objectName || item.templateName || item.templateId || item.recordId || item.traceId || item.jobKey || item.videoKey || '');
  const outcome = item.outcome === 'denied' ? '（被拒绝）' : '';
  return [item.actionLabel, actor, target, auditTimeText(item.at)].filter(Boolean).join(' · ') + outcome;
}

/** 版本读数：「第 3 版」（没有版本写空串，界面不编一个）。 */
export function auditVersionText(entry) {
  const item = normalizeAuditEntry(entry);
  const version = Math.trunc(Number(item && item.version));
  return Number.isFinite(version) && version > 0 ? `第 ${version} 版` : '';
}

/** 四项溯源的可读一行：操作人 / 学员 / 模板 / 时间（缺的项跳过；视频留痕另外补任务键与成片键）。 */
export function auditTraceText(entry) {
  const item = normalizeAuditEntry(entry);
  if (!item) return '';
  return [
    item.actorName || item.actorId ? `操作人 ${item.actorName || item.actorId}` : '',
    item.studentId || item.studentName ? `学员 ${item.studentName || item.studentId}${item.studentId && item.studentName ? `（${item.studentId}）` : ''}` : '',
    item.templateId ? `模板 ${item.templateName ? `${item.templateName}（${item.templateId}）` : item.templateId}` : '',
    item.jobKey ? `任务 ${item.jobKey}` : '',
    item.videoKey ? `成片 ${item.videoKey}` : '',
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
