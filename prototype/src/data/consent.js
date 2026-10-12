// 家长授权状态（F-CONSENT-01）。
//
// 「查看授权」= 家长允许通过分享链接查看孩子的作品与点评。它是**转发给家长**的前置条件，
// 不是录入 / 装裱 / 点评 / 归档的前置条件 —— 所以第一步的提示（US-411 / F-INTAKE-CONSENT-01）
// 只提示、不拦截，而第四步转发前的硬校验（US-208 / FR-222）读的是同一份来源，
// 两处口径必须一致（这是 US-411 的验收之一），不要在各自的组件里再写一套判断。
//
// 零依赖纯函数（**不 import 任何模块**），可以直接用 Node 跑断言（沿 US-408/409/410 的写法）。
//
// 授权判定的方向是**fail-safe**：没有授权记录的学员（例如临时加入的试听学员）按「未完成授权」处理，
// 宁可多提示一次，也不能把一位没有授权的孩子转发给家长。

const STORAGE_KEY = 'xinlehui-consent-v1';

export const CONSENT_STATUS = {
  AUTHORIZED: 'authorized',
  PENDING: 'pending',
  REVOKED: 'revoked'
};

const CONSENT_STATUSES = [CONSENT_STATUS.AUTHORIZED, CONSENT_STATUS.PENDING, CONSENT_STATUS.REVOKED];

/** 授权状态的中文说法（提示里逐条展示用）。 */
export const CONSENT_STATUS_LABELS = {
  [CONSENT_STATUS.AUTHORIZED]: '已授权',
  [CONSENT_STATUS.PENDING]: '待家长完成查看授权',
  [CONSENT_STATUS.REVOKED]: '已撤回授权'
};

/** 完全没有授权记录的学员（新登记 / 临时加入）在提示里的说法。 */
export const CONSENT_UNKNOWN_LABEL = '未登记授权';

// 种子：名单里只有陈一诺的监护人已绑定并完成查看授权，另外两位还没完成 ——
// 这样第一步默认就能看到提示，也方便验证「只列出没授权的那几位」。
export const seedConsents = [
  { studentName: '陈一诺', guardianName: '陈一诺妈妈', status: CONSENT_STATUS.AUTHORIZED, viewAuthorized: true, authorizedAt: '2026-08-04', expiresAt: '2027-08-04' },
  { studentName: '林小满', guardianName: '', status: CONSENT_STATUS.PENDING, viewAuthorized: false, authorizedAt: '', expiresAt: '' },
  { studentName: '赵禾', guardianName: '', status: CONSENT_STATUS.PENDING, viewAuthorized: false, authorizedAt: '', expiresAt: '' }
];

const cleanText = value => String(value ?? '').trim();

/**
 * 归一化一条授权记录，永不抛错。
 * 非法 / 缺失的 status 一律收敛为 pending（fail-safe）：只有明确写着 authorized 才算已授权，
 * 已撤回的记录也不会因为 viewAuthorized 是 true 就被当成可用。
 */
export function normalizeConsent(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const declared = cleanText(source.status);
  const status = CONSENT_STATUSES.includes(declared)
    ? declared
    : (source.viewAuthorized === true ? CONSENT_STATUS.AUTHORIZED : CONSENT_STATUS.PENDING);
  return {
    studentId: cleanText(source.studentId),
    studentName: cleanText(source.studentName ?? source.name),
    guardianName: cleanText(source.guardianName),
    status,
    viewAuthorized: status === CONSENT_STATUS.AUTHORIZED,
    authorizedAt: cleanText(source.authorizedAt),
    expiresAt: cleanText(source.expiresAt),
    // 撤回留痕（[第四步 US-211]）：撤回后才有的两个字段（同一份记录上，撤回是终态）。
    revokedAt: status === CONSENT_STATUS.REVOKED ? cleanText(source.revokedAt) : '',
    revokedBy: status === CONSENT_STATUS.REVOKED ? cleanText(source.revokedBy) : ''
  };
}

/** 读取授权状态：本地兜底为空 / 读坏时回落种子数据，永不抛错（沿 studentManagement 的写法）。 */
export function loadConsents() {
  const seed = seedConsents.map(normalizeConsent);
  if (typeof window === 'undefined') return seed;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) {
      const list = saved.map(normalizeConsent).filter(item => item.studentName);
      if (list.length) return list;
    }
  } catch {
    // 读坏了就当没有，回落种子数据。
  }
  return seed;
}

/** 落盘（授权管理页 / 后续转发故事会写它；本次只读也不影响）。 */
export function persistConsents(consents) {
  if (typeof window === 'undefined') return;
  const list = (Array.isArray(consents) ? consents : []).map(normalizeConsent).filter(item => item.studentName);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/** 一条记录是否代表「已获得查看授权」。 */
export function isViewAuthorized(record) {
  return normalizeConsent(record).status === CONSENT_STATUS.AUTHORIZED;
}

/**
 * 找某位参与学员对应的授权记录。
 * 学员在原型阶段没有独立 id（见 lessons.js 的 makeStudentId），所以按**姓名**匹配；
 * 记录上如果带了 studentId 也一起认，方便接云端后按 id 对齐。
 */
export function findConsent(consents, participant) {
  const list = Array.isArray(consents) ? consents : [];
  const name = cleanText(participant?.name ?? participant?.studentName);
  const studentId = cleanText(participant?.studentId);
  if (!name && !studentId) return null;
  const matched = list.map(normalizeConsent).find(item => {
    if (name && item.studentName === name) return true;
    return Boolean(studentId && item.studentId && item.studentId === studentId);
  });
  return matched || null;
}

/**
 * 列出「未完成查看授权」的学员：待家长完成 / 已撤回 / 没有记录（临时加入的试听学员）都算。
 * 返回项带 statusLabel 与 guardians 信息，界面只负责渲染。
 */
export function unauthorizedParticipants(participants, consents) {
  const list = Array.isArray(participants) ? participants : [];
  return list.filter(item => item && cleanText(item.name)).map(participant => {
    const record = findConsent(consents, participant);
    const status = record ? record.status : CONSENT_STATUS.PENDING;
    if (status === CONSENT_STATUS.AUTHORIZED) return null;
    return {
      studentId: cleanText(participant.studentId),
      name: cleanText(participant.name),
      status,
      statusLabel: record ? (CONSENT_STATUS_LABELS[status] || CONSENT_UNKNOWN_LABEL) : CONSENT_UNKNOWN_LABEL,
      guardianName: record?.guardianName || '',
      temporary: participant.temporary === true,
      registered: Boolean(record)
    };
  }).filter(Boolean);
}

/**
 * 汇总本次所选学员的授权状态，供第一步的提示使用。
 * message 是验收原文里的那句话（「N 位学员的家长尚未完成查看授权，发布后可能无法转发」）；
 * 有已撤回的记录时改口径（撤回不等于「尚未完成」），不能糊成同一句。
 */
export function consentSummaryOf(participants, consents) {
  const selected = (Array.isArray(participants) ? participants : []).filter(item => item && cleanText(item.name));
  const items = unauthorizedParticipants(selected, consents);
  const unauthorizedCount = items.length;
  const pendingCount = items.filter(item => item.status === CONSENT_STATUS.PENDING).length;
  const revokedCount = items.filter(item => item.status === CONSENT_STATUS.REVOKED).length;
  const unregisteredCount = items.filter(item => !item.registered).length;
  const message = unauthorizedCount === 0 ? ''
    : revokedCount > 0
      ? `${unauthorizedCount} 位学员的家长尚未完成查看授权或已撤回授权，发布后可能无法转发`
      : `${unauthorizedCount} 位学员的家长尚未完成查看授权，发布后可能无法转发`;
  return {
    total: selected.length,
    authorizedCount: selected.length - unauthorizedCount,
    unauthorizedCount,
    pendingCount,
    revokedCount,
    unregisteredCount,
    hasUnauthorized: unauthorizedCount > 0,
    names: items.map(item => item.name),
    namesText: items.map(item => item.name).join('、'),
    detailText: items.map(item => `${item.name}（${item.statusLabel}）`).join('、'),
    items,
    message
  };
}

// ---------------------------------------------------------------------------
// 授权撤回（[第四步 US-211] / F-ARCHIVE-PERM-01）
// ---------------------------------------------------------------------------
//
// 验收原文：「转发受家长授权状态约束；授权撤回后，已有分享链接一并失效」。
// 撤回是**终态**（`revokedAt` 一写就不会被 `viewAuthorized` 顶回已授权，见 `normalizeConsent`），
// 落一条撤回来的记录；「已有的分享链接一并失效」由 `data/shareTokens.js` 的
// `revokeShareTokensForStudent` 把这位学员名下所有**仍可用**的令牌一起撤掉 ——
// 两件事在同一次动作里做完（`AuthorizationPage` 的撤回按钮读的也是这两份产物）。

/** 撤回按钮的文案（界面不各写一份）。 */
export const CONSENT_REVOKE_LABEL = '申请撤回授权';
export const CONSENT_REVOKE_CONFIRM_LABEL = '确认撤回授权';
export const CONSENT_REVOKE_CANCEL_LABEL = '再想想';
export const CONSENT_REVOKE_TITLE = '撤回查看授权';
export const CONSENT_REVOKE_DESC = '撤回后：老师无法再把新的成长记录转发给你；已经发出去的分享链接会「一并失效」（家长再打开会看到「该分享已撤回」）。';
export const CONSENT_REVOKE_NOTE = '撤回是终态：要重新开通需要监护人再次确认（授权记录里会留下撤回时间与操作人）。';
export const CONSENT_REVOKED_BADGE = '已撤回授权';

/** 撤回后的回执（0 条链接时也要说清「没有链接需要失效」）。 */
export function consentRevocationNotice({ studentName = '', linkCount = 0 } = {}) {
  const name = cleanText(studentName) || '这位学员';
  const count = Math.trunc(Number(linkCount)) || 0;
  const linkText = count ? `已连带撤回 ${count} 条分享链接（家长再打开会看到「该分享已撤回」）。` : '当前没有可用的分享链接需要失效。';
  return `${name}的家长查看授权已撤回：${linkText}`;
}

/**
 * 撤回一位学员的查看授权（写入侧，幂等）：已经撤过的保持**第一次**的撤回时间（不改写历史）。
 * 返回 `{consents, record, changed, studentName}` —— `record` 是撤回来的那份授权记录
 * （界面用它渲染「已撤回授权」与撤回时间），`changed: false` 时不写盘。
 */
export function revokeConsent(consents, student, { at = '', by = '' } = {}) {
  const list = (Array.isArray(consents) ? consents : []).map(normalizeConsent);
  const name = cleanText(student && typeof student === 'object' ? (student.name ?? student.studentName) : student);
  const studentId = cleanText(student && typeof student === 'object' ? student.studentId : '');
  let changed = false;
  let record = null;
  const next = list.map(item => {
    const matched = (name && item.studentName === name) || (studentId && item.studentId === studentId);
    if (!matched) return item;
    if (item.status === CONSENT_STATUS.REVOKED) { record = item; return item; }
    changed = true;
    record = { ...item, status: CONSENT_STATUS.REVOKED, viewAuthorized: false, revokedAt: cleanText(at) || new Date().toISOString(), revokedBy: cleanText(by) };
    return record;
  });
  // 名单里还没有这位学员的授权记录（临时加入的学员）：撤回动作也要留下一条（fail-safe 口径）。
  if (!record && name) {
    changed = true;
    record = normalizeConsent({ studentId, studentName: name, status: CONSENT_STATUS.REVOKED, revokedAt: cleanText(at) || new Date().toISOString(), revokedBy: cleanText(by) });
    next.push(record);
  }
  return { consents: next, record, changed, studentName: name || record?.studentName || '' };
}
