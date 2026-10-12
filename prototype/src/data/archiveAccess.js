// 归档与转发的**访问权限**（[第四步 US-211] / F-ARCHIVE-PERM-01）。
//
// 验收原文：「老师只能归档与转发**自己班级**的学员记录；跨班访问被拒绝」。
// 本模块是这条规则的唯一真源（零依赖纯函数 + 常量，可 `node` 直跑断言）：
//
//  ① **谁是操作人**沿用全站同一份身份口径（`framingActor`：老师 = 本人在会话里的身份串），
//     不在这里另写一套「怎么认人」；班级归属只看 `class.teacher`（`data/studentManagement.js`）。
//  ② **判定顺序**：认不出身份 → 拒绝；家长 → 拒绝（家长只能通过分享链接看自己孩子，不能归档 / 转发）；
//     平台管理员 → 放行（合规审计要能看到全平台）；老师 → 这个班的任课老师必须是本人。
//  ③ **没有 `teacher` 字段的旧班级算老师自己的班**（与 US-403「我带的班」那条口径一致，
//     否则老数据会让所有老师一夜之间不能归档）；班级查不到（记录上的班级名不在名单里）同理放行，
//     但会如实写在 `classFound: false` 上 —— 断言与面板都读得到，不是悄悄放过。
//  ④ **服务端再判一次**：同一份规则在 `server/index.mjs` 的 `POST /api/archive/share-access` 里
//     按真实存储（管理档案的班级 + 监护人手机号会话）重判一遍 —— 前端隐藏不算数，
//     被拒时服务端返回 403 与同一句可读原因（见 `services/archiveAccessApi.js`）。
//
// 「家长只能查看自己孩子的记录」的分层：记录列表由服务端按监护人手机号过滤
// （`/api/parent/feedback-records`），分享链接由这里的 `parentScopeIssue` 在客户端补一道
// —— 已登录的家长打开**别人孩子**的分享链接同样是拒绝。

import { FRAMING_ACTOR_ROLE_LABELS, framingActor } from './framingPermissions';
import { shareTokenConsentIssue } from './shareTokens';

const str = value => String(value === null || value === undefined ? '' : value).trim();

/** 访问判定的结果状态（面板读数与断言读同一份）。 */
export const ARCHIVE_ACCESS_STATES = {
  allowed: 'allowed',
  denied: 'denied'
};

/** 放行时的数据范围（界面写「以什么身份看到哪一批记录」）。 */
export const ARCHIVE_ACCESS_SCOPES = {
  ownClass: 'own-class',
  platform: 'platform',
  parent: 'parent',
  unknown: 'unknown'
};

export const ARCHIVE_ACCESS_SCOPE_LABELS = {
  'own-class': '自己班级',
  platform: '全平台（合规审计）',
  parent: '自己孩子',
  unknown: '未识别范围'
};

/** 被拒的统一前缀（与装裱模板那条 `framingWriteDeniedMessage` 同一口径）。 */
export const ARCHIVE_ACCESS_DENIED_PREFIX = '越权访问已拒绝：';

/** 没有登录角色时的那句（认不出身份一律拒绝，fail-safe）。 */
export const ARCHIVE_ACCESS_ANONYMOUS_REASON = '无法确认操作人身份：归档与转发需要登录角色（老师 / 平台管理员）。';

/** 家长端那句（家长不归档、不转发 —— 只看分享链接）。 */
export const ARCHIVE_ACCESS_PARENT_REASON = '家长端只读：归档与转发由老师完成，家长只能通过老师发来的分享链接查看自己孩子的记录。';

/** 家长打开「别人孩子」的分享链接时的那句（与 US-211 的服务端口径同一句话）。 */
export const ARCHIVE_ACCESS_PARENT_SCOPE_REASON = '家长只能查看自己孩子的记录：这条分享不属于你绑定的孩子。';

/** 规则矩阵（管理端面板渲染 + 断言读同一份）。 */
export const ARCHIVE_ACCESS_MATRIX = [
  {
    role: 'teacher',
    label: '老师',
    scope: '自己班级的学员记录',
    note: '班级的任课老师命中本人身份串才能归档与转发；跨班访问被拒绝。'
  },
  {
    role: 'platform-admin',
    label: '平台管理员',
    scope: '全平台（只读审计 + 治理）',
    note: '合规审计需要看到全平台的归档、转发与授权记录。'
  },
  {
    role: 'parent',
    label: '家长',
    scope: '自己孩子（按监护人手机号匹配）',
    note: '服务端强制校验；不能归档、不能转发，只能打开老师发来的分享链接。'
  },
  {
    role: 'anonymous',
    label: '未识别身份',
    scope: '无',
    note: '认不出身份一律拒绝（fail-safe），不靠前端隐藏。'
  }
];

export const ARCHIVE_ACCESS_SUMMARY = '老师只能归档与转发自己班级的学员记录；家长只能查看自己孩子的记录（服务端按监护人手机号校验）；其余角色一律拒绝。';

/** 归归档 / 转发的动作词（读数里带上「在做什么」，被拒时的原因更具体）。 */
export const ARCHIVE_ACCESS_ACTIONS = {
  archive: '归档',
  forward: '转发'
};

/** 一个班的任课老师（按班级名在管理档案里找；找不到 / 没有 teacher 字段都如实报出来）。 */
export function archiveClassOwner({ className = '', management = null } = {}) {
  const name = str(className);
  const classes = management && Array.isArray(management.classes) ? management.classes : [];
  const found = name ? classes.find(item => str(item && item.name) === name) || null : null;
  return {
    className: name,
    found: Boolean(found),
    teacher: found ? str(found.teacher) : '',
    // 没有任课老师字段的旧班级：按 US-403 口径算老师自己的班（否则老数据一夜之间不能归档）。
    legacy: Boolean(found) && !str(found.teacher)
  };
}

/** 这个班的任课老师是不是这位老师（身份串命中姓名 / id 即算；空 teacher 视为本人）。 */
export function archiveClassOwnedBy(owner, actor = {}) {
  const record = owner && typeof owner === 'object' ? owner : {};
  if (record.legacy || !record.teacher) return true;
  const keys = [str(actor.teacherName), str(actor.teacherId), str(actor.actorId), str(actor.actorName)].filter(Boolean);
  if (!keys.length) return false;
  return keys.some(key => record.teacher === key || record.teacher.startsWith(key));
}

/** 老师跨班访问时的那句可读原因（点名两个身份，老师一眼知道为什么）。 */
export function archiveClassDeniedText({ className = '', classTeacher = '', actor = {} } = {}) {
  const who = str(actor.actorName) || str(actor.teacherName) || str(actor.actorId) || '当前登录的老师';
  const owner = str(classTeacher) || '（未记录任课老师）';
  return `跨班访问被拒绝：${str(className) || '这个班'}的任课老师是「${owner}」，当前登录的是「${who}」——老师只能归档与转发自己班级的学员记录。`;
}

/**
 * **归档 / 转发的访问判定**（唯一真源）。
 *
 * 入参：
 *  - `student` / `className`（对象，来自记录或当前选择）、可选的 `record`（读它的 student / className / id / version）；
 *  - `viewer`：会话身份（`{role,teacherName,orgId,…}`，与写权限同一个形状）；
 *  - `management`：`loadStudentManagement()` 的产物（班级名单与任课老师）；
 *  - `action`：`'archive' | 'forward'`（只影响文案，规则相同）。
 *
 * 出参**所有分支同形状**（US-204 的纪律）：`{allowed,state,reason,deniedText,scope,scopeLabel,
 * role,roleLabel,actorId,actorName,student,className,classTeacher,classFound,recordId,version,action}`。
 */
export function archiveRecordAccess({ viewer = {}, management = null, student = '', className = '', record = null, action = ARCHIVE_ACCESS_ACTIONS.archive } = {}) {
  const source = record && typeof record === 'object' ? record : {};
  const actor = framingActor(viewer);
  const targetStudent = str(student) || str(source.student);
  const targetClass = str(className) || str(source.className);
  const base = {
    allowed: false,
    state: ARCHIVE_ACCESS_STATES.denied,
    reason: '',
    deniedText: '',
    scope: ARCHIVE_ACCESS_SCOPES.unknown,
    scopeLabel: ARCHIVE_ACCESS_SCOPE_LABELS[ARCHIVE_ACCESS_SCOPES.unknown],
    role: actor.role,
    roleLabel: actor.roleLabel,
    actorId: actor.actorId,
    actorName: actor.actorName || actor.teacherName,
    student: targetStudent,
    className: targetClass,
    classTeacher: '',
    classFound: false,
    recordId: str(source.id),
    version: str(source.version),
    action: str(action) || ARCHIVE_ACCESS_ACTIONS.archive
  };
  const allow = (scope, extra = {}) => ({
    ...base,
    allowed: true,
    state: ARCHIVE_ACCESS_STATES.allowed,
    scope,
    scopeLabel: ARCHIVE_ACCESS_SCOPE_LABELS[scope],
    ...extra
  });
  const deny = (reason, extra = {}) => ({ ...base, reason, deniedText: `${ARCHIVE_ACCESS_DENIED_PREFIX}${reason}`, ...extra });
  // ① 认不出身份（缺 role）→ 拒绝。
  if (!['teacher', 'platform-admin', 'org-admin', 'parent'].includes(actor.role)) {
    return deny(ARCHIVE_ACCESS_ANONYMOUS_REASON);
  }
  // ② 家长 → 任何一条记录都拒绝（家长只看分享链接，不归档、不转发）。
  if (actor.role === 'parent') {
    return deny(ARCHIVE_ACCESS_PARENT_REASON, { scope: ARCHIVE_ACCESS_SCOPES.parent, scopeLabel: ARCHIVE_ACCESS_SCOPE_LABELS[ARCHIVE_ACCESS_SCOPES.parent] });
  }
  // ③ 管理员（平台 / 机构）→ 全平台（合规审计与治理要能覆盖全平台）。
  if (actor.role === 'platform-admin' || actor.role === 'org-admin') {
    return allow(ARCHIVE_ACCESS_SCOPES.platform);
  }
  // ④ 老师 → 这个班的任课老师必须是本人。
  const owner = archiveClassOwner({ className: targetClass, management });
  if (!archiveClassOwnedBy(owner, actor)) {
    return deny(
      archiveClassDeniedText({ className: owner.className, classTeacher: owner.teacher, actor }),
      { scope: ARCHIVE_ACCESS_SCOPES.ownClass, scopeLabel: ARCHIVE_ACCESS_SCOPE_LABELS[ARCHIVE_ACCESS_SCOPES.ownClass], classTeacher: owner.teacher, classFound: owner.found }
    );
  }
  return allow(ARCHIVE_ACCESS_SCOPES.ownClass, { classTeacher: owner.teacher, classFound: owner.found });
}

/** 判定是否放行（布尔版）。 */
export function canAccessArchiveRecord(input = {}) {
  return archiveRecordAccess(input).allowed;
}

/** 被拒时的界面提示（与审计日志的 detail 读同一句）。 */
export function archiveAccessDeniedText(access = {}) {
  const source = access && typeof access === 'object' ? access : {};
  return str(source.deniedText) || `${ARCHIVE_ACCESS_DENIED_PREFIX}${str(source.reason) || ARCHIVE_ACCESS_ANONYMOUS_REASON}`;
}

/**
 * 「家长只能查看自己孩子的记录」在**分享链接**上的一道（客户端；服务端 `POST /api/archive/share-access`
 * 是权威判定）：已登录的家长（会话里的 `studentNames` 来自监护人手机号匹配）打开别人孩子的链接 → 拒绝。
 * 没有家长会话（普通访客持有链接）时返回放行 —— 链接本身就是这次访问的凭据。
 */
export function parentScopeIssue({ student = '', parentSession = '', parentStudentNames = [] } = {}) {
  const name = str(student);
  const session = str(parentSession);
  if (!session) return '';
  const names = (Array.isArray(parentStudentNames) ? parentStudentNames : []).map(str).filter(Boolean);
  if (!name || !names.length) return ARCHIVE_ACCESS_PARENT_SCOPE_REASON;
  return names.includes(name) ? '' : ARCHIVE_ACCESS_PARENT_SCOPE_REASON;
}

/** 分享链接访问被拦时的三种来源（家长页读数与断言读同一份）。 */
export const ARCHIVE_SHARE_ACCESS_BLOCKERS = {
  token: 'token',
  consent: 'consent',
  parentScope: 'parent-scope',
  server: 'server'
};

export const ARCHIVE_SHARE_ACCESS_BLOCKER_LABELS = {
  token: '链接本身不可用',
  consent: '家长已撤回查看授权',
  'parent-scope': '不属于这位家长绑定的孩子',
  server: '服务端强制校验拒绝'
};

/**
 * 分享页的**访问视图**（[第四步 US-211] 在家长那一侧的落点；所有分支同形状）：
 *   `{allowed, blockedBy, blockedByLabel, reason, consentStatus, server:{checked,allowed,reason}}`
 *
 * 判定顺序（在令牌可用之后）：**服务端判定 > 授权撤回 > 家长范围**。
 *  - 服务端（`serverAccess.checked && allowed === false`）说的是权威结论 —— 前端隐藏不算数；
 *  - 授权撤回读的是授权记录（`status === 'revoked'`）—— 撤回后即使令牌记录还没被重写，链接也打不开；
 *  - 家长范围读的是登录会话绑定的孩子（监护人手机号匹配）。
 */
export function archiveShareAccessView({ tokenRecord = null, active = false, consent = null, parentScope = null, serverAccess = null } = {}) {
  const server = serverAccess && typeof serverAccess === 'object' ? serverAccess : null;
  const serverChecked = Boolean(server && server.checked);
  const serverAllowed = serverChecked ? server.allowed !== false : true;
  const base = {
    allowed: false,
    blockedBy: '',
    blockedByLabel: '',
    reason: '',
    consentStatus: str(consent && consent.status),
    server: { checked: serverChecked, allowed: serverChecked ? server.allowed !== false : null, reason: str(server && server.reason) }
  };
  const block = (blockedBy, reason) => ({ ...base, blockedBy, blockedByLabel: ARCHIVE_SHARE_ACCESS_BLOCKER_LABELS[blockedBy] || blockedBy, reason });
  if (!active) return block(ARCHIVE_SHARE_ACCESS_BLOCKERS.token, '');
  if (serverChecked && !serverAllowed) return block(ARCHIVE_SHARE_ACCESS_BLOCKERS.server, str(server.reason) || ARCHIVE_ACCESS_PARENT_SCOPE_REASON);
  const consentIssue = shareTokenConsentIssue(tokenRecord, consent);
  if (consentIssue) return block(ARCHIVE_SHARE_ACCESS_BLOCKERS.consent, consentIssue);
  const scope = parentScope && typeof parentScope === 'object' ? parentScope : null;
  if (scope) {
    const scopeIssue = parentScopeIssue({
      student: str(scope.student) || str(tokenRecord && tokenRecord.student),
      parentSession: scope.parentSession,
      parentStudentNames: scope.parentStudentNames
    });
    if (scopeIssue) return block(ARCHIVE_SHARE_ACCESS_BLOCKERS.parentScope, scopeIssue);
  }
  return { ...base, allowed: true };
}

/** 面板副标题那一句（账号与范围的组合读数）。 */
export function archiveAccessReadout(access = {}) {
  const source = access && typeof access === 'object' ? access : {};
  const role = FRAMING_ACTOR_ROLE_LABELS[source.role] || source.roleLabel || '未识别身份';
  const scope = str(source.scopeLabel) || ARCHIVE_ACCESS_SCOPE_LABELS[ARCHIVE_ACCESS_SCOPES.unknown];
  if (source.allowed) return `${role} · 可访问范围：${scope}`;
  return `${role} · ${str(source.reason) || ARCHIVE_ACCESS_ANONYMOUS_REASON}`;
}
