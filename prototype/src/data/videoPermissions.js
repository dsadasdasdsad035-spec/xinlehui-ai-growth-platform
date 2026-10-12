// 视频任务的**访问权限**（[第四步 US-223] 第 1 条 / FR-311）。
//
// 验收原文：「只有本班老师可提交与下载成片；管理员可审计；家长仅可通过有效分享链接播放」。
// 三个角色三种范围，判定收在这一份**零依赖纯模块**里（唯一 import 是同样零依赖的
// `data/archiveAccess.js` 与 `data/framingPermissions.js`，班级归属与身份口径都在那里，
// 这里不抄第二份）：
//
//  ① **本班老师**：提交与下载都限「自己带的班」—— 判定直接委托 `archiveRecordAccess`
//     （US-211 的唯一真源：认不出身份拒绝、家长拒绝、老师必须命中班级任课老师）。
//     跨班老师拿到的就是那句「跨班访问被拒绝：…」（点名两个身份）。
//  ② **管理员（平台 / 机构）**：只开放 `audit`（合规审计要看全平台的任务与留痕），
//     **不代老师提交、也不下载成片文件** —— 「可审计」不等于「可拿孩子的视频」。
//  ③ **家长**：只有一条路 —— 老师发来的**有效分享链接**。判定委托 `archiveShareAccessView`
//     （令牌可用 + 授权未撤回 + 家长范围 + 服务端结论），四道里任何一道不过都不放行；
//     没有链接、链接撤回 / 过期、授权被撤回时给可读原因。
//
// 「谁能做什么」的矩阵（`VIDEO_TASK_ROLE_RULES`）是面板与断言的同一份读数 ——
// 界面上写的话就是这里判出来的结论。

import { framingActor } from './framingPermissions';
import { archiveRecordAccess, archiveShareAccessView } from './archiveAccess';

const str = value => String(value === null || value === undefined ? '' : value).trim();

/** 视频任务上的四个动作（提交 / 下载 / 审计 / 播放）。 */
export const VIDEO_TASK_ACTIONS = {
  submit: 'submit',
  download: 'download',
  audit: 'audit',
  play: 'play'
};
export const VIDEO_TASK_ACTION_IDS = ['submit', 'download', 'audit', 'play'];
export const VIDEO_TASK_ACTION_LABELS = {
  submit: '提交渲染任务',
  download: '下载成片',
  audit: '审计任务与留痕',
  play: '播放分享的成片'
};

/** 被拒时的统一前缀（与 `archiveAccess` 的「越权访问已拒绝」同一口径）。 */
export const VIDEO_TASK_DENIED_PREFIX = '视频任务被拒绝：';

/** 管理员那句（“可审计”不等于“可代理提交 / 下载”）。 */
export const VIDEO_TASK_ADMIN_DENIED_TEXT = '管理员可审计视频任务与留痕，但不代老师提交任务、也不下载成片文件：成片只属于本班老师与家长。';

/** 家长没有有效链接时那句。 */
export const VIDEO_TASK_PARENT_DENIED_TEXT = '家长只能通过老师发来的有效分享链接播放成片：没有链接或链接已失效时不提供任何成片地址与下载入口。';

/** 老师审计那句（审计清单在管理端）。 */
export const VIDEO_TASK_TEACHER_AUDIT_DENIED_TEXT = '任务审计在管理端（平台管理员）：老师端只提交与下载自己班级的成片。';

/** 一句话规则（面板副标题）。 */
export const VIDEO_TASK_PERMISSION_SUMMARY = '只有本班老师可提交与下载成片；管理员可审计（不代提交、不下载成片文件）；家长仅可通过有效分享链接播放。';

/**
 * 角色规则矩阵（面板与断言读同一份）：
 * `actions` 列出该角色**允许**的动作；`allowed:false` 行是「结构上不允许」的角色。
 */
export const VIDEO_TASK_ROLE_RULES = [
  {
    id: 'teacher-own',
    role: 'teacher',
    label: '本班老师',
    scope: '自己带的班（班级任课老师命中本人）',
    actions: [VIDEO_TASK_ACTIONS.submit, VIDEO_TASK_ACTIONS.download],
    allowed: true,
    note: '提交与下载都限本班；跨班访问被拒绝（班级任课老师必须是本人）。'
  },
  {
    id: 'teacher-other',
    role: 'teacher',
    label: '其他班老师',
    scope: '无',
    actions: [],
    allowed: false,
    note: '跨班访问被拒绝：成片只属于本班老师与家长。'
  },
  {
    id: 'platform-admin',
    role: 'platform-admin',
    label: '管理员',
    scope: '全平台（只读审计）',
    actions: [VIDEO_TASK_ACTIONS.audit],
    allowed: true,
    note: '可审计任务、留痕与配额；不代老师提交任务，也不下载成片文件。'
  },
  {
    id: 'parent',
    role: 'parent',
    label: '家长',
    scope: '自己孩子（且只有有效分享链接）',
    actions: [VIDEO_TASK_ACTIONS.play],
    allowed: true,
    note: '仅可通过老师发来的有效分享链接播放；撤回 / 过期 / 授权被撤回后立即失效。'
  },
  {
    id: 'anonymous',
    role: 'anonymous',
    label: '未识别身份',
    scope: '无',
    actions: [],
    allowed: false,
    note: '认不出身份一律拒绝（fail-safe），不靠前端隐藏。'
  }
];

/** 被拒模板文案。 */
export function videoTaskDeniedText(reason) {
  const text = str(reason);
  if (!text) return '';
  return text.startsWith(VIDEO_TASK_DENIED_PREFIX) ? text : `${VIDEO_TASK_DENIED_PREFIX}${text}`;
}

/** 动作的可读标签（认不出的动作原样带出来，别谎报成已知动作）。 */
export function videoTaskActionLabel(action) {
  const id = str(action);
  return VIDEO_TASK_ACTION_LABELS[id] || (id ? `未知动作（${id}）` : '未指定动作');
}

/** 矩阵行 → 面板读数（动作文案与允许与否都算好，界面不自己拼）。 */
export function videoTaskPermissionRows(viewer = {}) {
  const actor = framingActor(viewer);
  return VIDEO_TASK_ROLE_RULES.map(row => {
    // 本会话命中哪一行：老师默认按「本班老师」（跨班与否由具体对象上的判定决定），
    // 管理员按 admin 行，家长按 parent 行，认不出身份按 anonymous 行。
    const roleMatch = row.role === 'teacher'
      ? actor.role === 'teacher'
      : actor.role === row.role;
    return {
      id: row.id,
      role: row.role,
      label: row.label,
      scope: row.scope,
      allowed: row.allowed,
      actions: row.actions.slice(),
      actionText: row.actions.map(action => VIDEO_TASK_ACTION_LABELS[action]).join(' / ') || '—',
      note: row.note,
      sessionMatch: roleMatch
    };
  });
}

/**
 * **视频任务的访问判定**（唯一真源；所有分支同形状）。
 *
 * 入参：
 *  - `viewer`：会话身份（`{role:'teacher'|'admin'|'parent', teacherName, orgId, adminTier}`，与写权限同一形状）；
 *  - `management`：`loadStudentManagement()` 的产物（班级任课老师）；
 *  - `student` / `className`：这次动作指向的对象（提交 / 下载时必给；审计给班级即可）；
 *  - `action`：`submit | download | audit | play`；
 *  - `share`：`play` 时的链接上下文 `{tokenRecord, active, consent, parentScope, serverAccess}`。
 *
 * 出参：`{allowed, state, reason, deniedText, action, actionLabel, role, roleLabel, actorId, actorName,
 * scope, scopeLabel, student, className, classTeacher, classFound, jobKey, videoKey}`。
 */
export function videoTaskAccess({ viewer = {}, management = null, student = '', className = '', action = VIDEO_TASK_ACTIONS.submit, job = null, share = null } = {}) {
  const actor = framingActor(viewer);
  const actionId = str(action) || VIDEO_TASK_ACTIONS.submit;
  const source = job && typeof job === 'object' ? job : {};
  const targetStudent = str(student) || str(source.studentId) || str(source.student);
  const targetClass = str(className) || str(source.classId) || str(source.className);
  const base = {
    allowed: false,
    state: 'denied',
    reason: '',
    deniedText: '',
    action: actionId,
    actionLabel: videoTaskActionLabel(actionId),
    role: actor.role,
    roleLabel: actor.roleLabel,
    actorId: actor.actorId,
    actorName: actor.actorName || actor.teacherName,
    scope: 'unknown',
    scopeLabel: '未识别范围',
    student: targetStudent,
    className: targetClass,
    classTeacher: '',
    classFound: false,
    jobKey: str(source.jobKey),
    videoKey: str(source.videoKey)
  };
  const allow = (scope, scopeLabel, extra = {}) => ({ ...base, allowed: true, state: 'allowed', scope, scopeLabel, ...extra });
  const deny = (reason, extra = {}) => ({ ...base, reason: str(reason), deniedText: videoTaskDeniedText(reason), ...extra });

  // ① 认不出身份 → 拒绝（fail-safe）。
  if (!['teacher', 'platform-admin', 'org-admin', 'parent'].includes(actor.role)) {
    return deny('无法确认操作人身份：视频任务的提交与下载需要登录角色（老师 / 管理员 / 家长）。');
  }
  // ② 家长：只有「有效分享链接」这一条路，且只能播放。
  if (actor.role === 'parent') {
    if (actionId !== VIDEO_TASK_ACTIONS.play) return deny(VIDEO_TASK_PARENT_DENIED_TEXT);
    const context = share && typeof share === 'object' ? share : {};
    const access = archiveShareAccessView({
      tokenRecord: context.tokenRecord || null,
      active: Boolean(context.active),
      consent: context.consent || null,
      parentScope: context.parentScope || null,
      serverAccess: context.serverAccess || null
    });
    if (!access.allowed) {
      return deny(access.reason || VIDEO_TASK_PARENT_DENIED_TEXT, { scope: 'parent', scopeLabel: '自己孩子（仅有效分享链接）' });
    }
    return allow('parent', '自己孩子（仅有效分享链接）');
  }
  // ③ 管理员：只开放审计；提交 / 下载一律拒绝（可审计 ≠ 可拿孩子的视频）。
  if (actor.role === 'platform-admin' || actor.role === 'org-admin') {
    if (actionId !== VIDEO_TASK_ACTIONS.audit) {
      return deny(VIDEO_TASK_ADMIN_DENIED_TEXT, { scope: 'platform', scopeLabel: '全平台（只读审计）' });
    }
    return allow('platform', '全平台（只读审计）');
  }
  // ④ 老师：审计不在老师端；提交 / 下载要过「本班」这道闸（委托 US-211 的唯一判据）。
  if (actionId === VIDEO_TASK_ACTIONS.audit) {
    return deny(VIDEO_TASK_TEACHER_AUDIT_DENIED_TEXT, { scope: 'own-class', scopeLabel: '自己班级' });
  }
  const recordAccess = archiveRecordAccess({ viewer, management, student: targetStudent, className: targetClass, action: 'forward' });
  if (!recordAccess.allowed) {
    return deny(recordAccess.reason, {
      scope: recordAccess.scope,
      scopeLabel: recordAccess.scopeLabel,
      classTeacher: recordAccess.classTeacher,
      classFound: recordAccess.classFound
    });
  }
  return allow('own-class', '自己班级的学员 / 班级', { classTeacher: recordAccess.classTeacher, classFound: recordAccess.classFound });
}

/** 判定是否放行（布尔版）。 */
export function canUseVideoTask(input = {}) {
  return videoTaskAccess(input).allowed;
}

/** 面板 / 卡片上那句读数（放行给范围，拒绝给原因）。 */
export function videoTaskAccessReadout(access = {}) {
  const source = access && typeof access === 'object' ? access : {};
  const action = videoTaskActionLabel(source.action);
  if (source.allowed) return `${action}：可以（范围：${str(source.scopeLabel) || '未识别范围'}）`;
  return `${action}：${str(source.reason) || '被拒绝'}`;
}

/**
 * 从审计操作人（`auditActor`，App 里按当前角色补的那一份）反推 `viewer`。
 * 老师端与管理端各有一份操作人四件套，这里只做映射 —— 不另写一套「怎么认人」。
 */
export function videoTaskViewerFromActor(actor = {}) {
  const source = actor && typeof actor === 'object' ? actor : {};
  const role = str(source.actorRole);
  if (role === 'platform-admin' || role === 'org-admin') {
    return { role: 'admin', adminTier: role === 'org-admin' ? 'org' : 'platform', actorId: str(source.actorId), actorName: str(source.actorName), orgId: str(source.orgId) };
  }
  if (role === 'parent') return { role: 'parent', actorId: str(source.actorId), actorName: str(source.actorName), orgId: str(source.orgId) };
  return { role: 'teacher', actorId: str(source.actorId), actorName: str(source.actorName), teacherName: str(source.actorName) || str(source.actorId), orgId: str(source.orgId) };
}
