/**
 * 装裱模板的**写权限**（[第二步 US-013] / PRD FR-44 / FR-45）。
 *
 * 三层模板各有各的主人，写权限就按「谁的地盘谁写」判：
 *
 * | 模板层 | 可写角色 | 其余角色 |
 * |---|---|---|
 * | `platform` | 平台管理员 | 只读 |
 * | `org` | **本机构**的机构管理员（`ownerKey === 当前机构`） | 只读 |
 * | `teacher` | 老师**本人**（`ownerKey` 命中自己的身份串） | 只读 |
 * | 家长 | ——（任何一层都不能写） | 只读 |
 *
 * 三条口径都是「仅 X 可写」，**没有上层代写**：平台管理员不代维护机构模板，
 * 任何人也不代写老师的个人模板（个人模板是老师的私有物，管理端只读）。
 * 这与 US-001b 的读模型是两件事：管理端仍然**能看到**三层模板（读全量），
 * 只是写的时候会被这一份规则拒掉 —— 拒掉时给的是可读原因（`framingPresetWriteIssue`），
 * 界面上也据此把编辑入口关掉（`FRAMING_PRESET_READONLY_NOTE`）。
 *
 * 本模块是**零依赖纯函数 + 常量**（唯一 import 是同样零依赖的 `data/framingPresets`，
 * 复用同一份 `normalizeFramingPreset` / `teacherIdentityKeys`，不抄第二份），
 * 所以可以直接用 Node 跑断言，见 prototype/AGENTS.md 的「验证技巧」。
 */

import {
  FRAMING_PRESET_SCOPE_LABELS,
  normalizeFrameScope,
  normalizeFramingPreset,
  teacherIdentityKeys
} from './framingPresets';

/** 写权限里的四种操作人角色（与「权限设置」页的角色组同名）。 */
export const FRAMING_ACTOR_ROLES = ['platform-admin', 'org-admin', 'teacher', 'parent'];

export const FRAMING_ACTOR_ROLE_LABELS = {
  'platform-admin': '平台管理员',
  'org-admin': '机构管理员',
  teacher: '老师',
  parent: '家长'
};

/** 每一层的**唯一**可写角色（矩阵的唯一真源；界面与断言都读它）。 */
export const FRAMING_SCOPE_WRITER = {
  platform: 'platform-admin',
  org: 'org-admin',
  teacher: 'teacher'
};

/**
 * 观察者身份（`viewer`）→ 操作人（actor）。
 *
 * `viewer` 是全站已有的那个形状：`{ role, teacherId, teacherName, orgId }`（见 `presetVisibleTo`）。
 * 这里只做一件事：把「管理端」拆成两层 —— 默认按**平台管理员**（原型里的管理员会话就是平台管理员），
 * 机构管理员由 `adminTier: 'org'` 区分（界面暂时没有机构管理员入口，权限层先立住，
 * 界面的「权限设置」页里已经有这个角色组）。
 *
 * 认不出身份（没有 role）时 `role` 为空串：**不写**（fail-safe，宁可拒绝也不越权）。
 */
export function framingActor(viewer = {}) {
  const source = viewer && typeof viewer === 'object' ? viewer : {};
  const appRole = String(source.role || '');
  let role = '';
  if (appRole === 'admin') role = String(source.adminTier || '') === 'org' ? 'org-admin' : 'platform-admin';
  else if (appRole === 'teacher') role = 'teacher';
  else if (appRole === 'parent') role = 'parent';
  const teacherId = String(source.teacherId || '');
  const teacherName = String(source.teacherName || source.name || '');
  return {
    role,
    roleLabel: FRAMING_ACTOR_ROLE_LABELS[role] || '未识别身份',
    // 操作人 id 的口径与课次 `teacherId` / 写回记录 `operatorId` 一致：会话身份串（老师姓名）。
    actorId: String(source.actorId || source.teacherId || source.teacherName || source.name || ''),
    actorName: String(source.actorName || source.teacherName || source.name || ''),
    orgId: String(source.orgId || ''),
    teacherId,
    teacherName
  };
}

/** 这套模板的可写角色标签（界面写「由……维护」时读它）。 */
export function framingPresetWriteOwnerText(preset) {
  const scope = normalizeFrameScope(normalizeFramingPreset(preset).scope);
  const role = FRAMING_SCOPE_WRITER[scope] || FRAMING_SCOPE_WRITER.platform;
  if (role === 'teacher') return '本人（老师自己）';
  if (role === 'org-admin') return '本机构管理员';
  return FRAMING_ACTOR_ROLE_LABELS[role];
}

/** 不可写时界面上那句「去哪儿改」（每一层一句，界面与断言读同一份）。 */
export const FRAMING_PRESET_READONLY_NOTE = {
  platform: '平台模板仅平台管理员可写；其他角色只读。',
  org: '机构模板仅本机构管理员可写；平台管理员、其他机构与老师只读。',
  teacher: '老师个人模板仅本人可写；其他老师、管理员与家长只读。'
};

/** 当前观察者能不能写这套模板（`framingPresetWriteIssue` 的布尔版）。 */
export function canWriteFramingPreset(preset, viewer = {}) {
  return framingPresetWriteIssue(preset, viewer) === '';
}

/**
 * **写权限判定**（唯一真源）：能写返回空串，不能写返回可读原因。
 *
 * 判定顺序就是「先认人、再看层、最后看归属」：
 *   ① 认不出身份 → 拒绝（缺 role 的一律只读）；
 *   ② 家长 → 任何一层都拒绝；
 *   ③ platform → 仅平台管理员；
 *   ④ org → 仅机构管理员，且 `ownerKey` 必须等于当前机构（**别的机构**也不行）；
 *   ⑤ teacher → 仅老师，且 `ownerKey` 必须命中自己的身份串（老师 id 或姓名）。
 *
 * 「提交 `scope=platform` 的写操作」这条老师端越权路径由 ③ 直接拒掉 —— 不需要额外的分支。
 */
export function framingPresetWriteIssue(preset, viewer = {}) {
  const item = normalizeFramingPreset(preset);
  const scope = normalizeFrameScope(item.scope);
  const actor = framingActor(viewer);
  const scopeLabel = FRAMING_PRESET_SCOPE_LABELS[scope] || scope;
  if (!FRAMING_ACTOR_ROLES.includes(actor.role)) {
    return '无法确认操作人身份：模板写权限需要登录角色（平台管理员 / 机构管理员 / 老师），当前会话未识别身份。';
  }
  if (actor.role === 'parent') {
    return `家长端只读：不能写${scopeLabel}模板。`;
  }
  if (scope === 'platform') {
    if (actor.role !== 'platform-admin') {
      return `平台模板仅平台管理员可写：${actor.roleLabel}不能写${scopeLabel}模板。`;
    }
    return '';
  }
  if (scope === 'org') {
    if (actor.role !== 'org-admin') {
      return `机构模板仅本机构管理员可写：${actor.roleLabel}不能写机构模板。`;
    }
    // 两边的机构标识都要有：模板缺 owner_key（归属不明）与当前会话缺机构标识，都不能放行。
    if (!item.ownerKey) return '机构模板缺少机构标识（owner_key），写入被拒绝。';
    if (!actor.orgId) return '当前会话没有机构标识，无法校验机构模板的归属，写入被拒绝。';
    if (String(item.ownerKey) !== actor.orgId) {
      return `只能写本机构的模板：这套模板属于「${item.ownerKey}」，当前机构是「${actor.orgId}」。`;
    }
    return '';
  }
  // teacher 层
  if (actor.role !== 'teacher') {
    return `老师个人模板仅本人可写：${actor.roleLabel}不能代写老师的个人模板。`;
  }
  const keys = teacherIdentityKeys(actor);
  if (!item.ownerKey || !keys.includes(String(item.ownerKey))) {
    return `只能写自己的个人模板：这套模板属于「${item.ownerKey || '（无归属）'}」。`;
  }
  return '';
}

/** 越权写入被拒时的统一文案（服务层的 403 与界面提示读同一句）。 */
export function framingWriteDeniedMessage(preset, viewer = {}) {
  const issue = framingPresetWriteIssue(preset, viewer);
  return issue ? `越权写入已拒绝：${issue}` : '';
}

/**
 * 写权限矩阵（界面渲染 + 断言读同一份）：
 * 每行 = 一层模板、它的唯一可写角色、以及其余角色的只读说明。
 */
export const FRAMING_PERMISSION_MATRIX = [
  {
    scope: 'platform',
    label: '平台模板',
    writerRole: FRAMING_SCOPE_WRITER.platform,
    writer: FRAMING_ACTOR_ROLE_LABELS[FRAMING_SCOPE_WRITER.platform],
    readers: '机构管理员 / 老师 / 家长',
    note: '内置样式与平台统一模板；写入记 `updated_by` 与审计日志。'
  },
  {
    scope: 'org',
    label: '机构模板',
    writerRole: FRAMING_SCOPE_WRITER.org,
    writer: '本机构的机构管理员',
    readers: '平台管理员 / 其他机构 / 老师 / 家长',
    note: '`owner_key` 必须等于当前机构；跨机构写入一律拒绝。'
  },
  {
    scope: 'teacher',
    label: '老师个人模板',
    writerRole: FRAMING_SCOPE_WRITER.teacher,
    writer: '本人（老师自己）',
    readers: '其他老师 / 管理员 / 家长',
    note: '「另存为我的模板」产生的模板；`owner_key` 命中本人身份串才可写。'
  }
];

/** 矩阵里「当前观察者」对每一层能不能写（界面上给这三行各挂一个判定）。 */
export function framingPermissionRows(viewer = {}) {
  return FRAMING_PERMISSION_MATRIX.map(row => {
    const actor = framingActor(viewer);
    const allowed = actor.role === row.writerRole;
    return { ...row, actorRole: actor.role, actorLabel: actor.roleLabel, allowed };
  });
}

/** 一句话总结三层写权限（面板副标题）。 */
export const FRAMING_PERMISSION_SUMMARY = '平台模板仅平台管理员可写；机构模板仅本机构管理员可写；老师模板仅本人可写；其余角色只读。';
