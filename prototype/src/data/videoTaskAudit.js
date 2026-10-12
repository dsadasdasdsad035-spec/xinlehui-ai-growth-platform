// 视频任务的**六条留痕**（[第四步 US-223] 第 2 条 / FR-312）。
//
// 验收原文：「提交、完成、下载、分享、更换音乐、删除均写入审计日志」。
// 这六件事各自的动作键、必填字段、以及「写入时到底该带哪些字段」收在这一份零依赖模块里：
//
//  ① **动作清单**（`VIDEO_TASK_AUDIT_SIX`）：六行 —— 提交 / 完成 / 下载 / 分享 / 更换音乐 / 删除。
//     分享复用图文分享的 `archive.share.generate`（成片分享与图文分享走同一个令牌账，
//     不另造一套「视频分享」动作），其余五条是本模块新登记的动作键。
//  ② **入参构造**（`videoAuditEntryInput`）：把「任务 / 成片记录 / 分享令牌 / 操作人」摊平成
//     `buildAuditEntry` 的入参 —— 界面只调用它，不各自挑字段（否则某一条路漏掉 jobKey
//     就会变成「留痕缺字段」而没人知道）。
//  ③ **合规复核**（`videoAuditEntryProblem`）：必填字段（`AUDIT_ACTION_REQUIRED`）缺没缺、
//     动作是否在六条之内 —— 面板与断言读同一份。
//
// 与 `data/auditLog.js` 同一套口径：日志条目只认白名单字段；本模块只负责「构造输入」，
// 落盘、上限、合并仍在 `auditLog` / `App.recordAudit`。

import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, VIDEO_TASK_AUDIT_ACTIONS, auditEntryMissingFields } from './auditLog';

const str = value => String(value === null || value === undefined ? '' : value).trim();
const int = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
};

/** 六行读数（管理端面板渲染它，断言按它核对「六个动作都有留痕」）。 */
export const VIDEO_TASK_AUDIT_SIX = [
  { id: 'submit', action: AUDIT_ACTIONS.videoJobSubmit, label: '提交', when: '老师点「生成成长记录视频」或「重新生成」时' },
  { id: 'done', action: AUDIT_ACTIONS.videoJobDone, label: '完成', when: '任务推进到已完成（成片就绪）时' },
  { id: 'download', action: AUDIT_ACTIONS.videoDownload, label: '下载', when: '老师真的下载一份成片（有真成片地址）时' },
  { id: 'share', action: AUDIT_ACTIONS.shareGenerate, label: '分享', when: '生成 / 重新生成成片分享链接时（与图文分享同一条动作）' },
  { id: 'music', action: AUDIT_ACTIONS.videoMusicChange, label: '更换音乐', when: '曲目授权到期或被收回后「更换音乐 / 静音」时' },
  { id: 'delete', action: AUDIT_ACTIONS.videoRecordDelete, label: '删除', when: '删除成片（含历史版本与渲染中间产物记录）时' }
];

export const VIDEO_TASK_AUDIT_SECTION_TITLE = '视频任务留痕（六条）';
export const VIDEO_TASK_AUDIT_SECTION_DESC = '提交、完成、下载、分享、更换音乐、删除六个动作都会写入审计日志：记下操作人、时间、任务键 / 成片键与对象，成年人拿走孩子的视频这件事要查得到。';

/** 动作是否属于视频六条（面板筛选、断言与写入侧读同一份）。 */
export function isVideoTaskAuditAction(action) {
  return VIDEO_TASK_AUDIT_ACTIONS.includes(str(action));
}

/** 这条日志属于视频六条中的哪一行（不属于返回 null）。 */
export function videoTaskAuditRow(action) {
  const id = str(action);
  return VIDEO_TASK_AUDIT_SIX.find(row => row.action === id) || null;
}

/**
 * 构造一条视频留痕的 `buildAuditEntry` 入参。
 *
 *  `job` 是渲染任务（`jobKey` / 类型 / 对象 / 周期 / 状态），`record` 是成片记录
 *  （`videoKey` / 版本 / 体积），`share` 是分享令牌。缺哪一项就少带哪一项的键 ——
 *  必填清单由 `AUDIT_ACTION_REQUIRED` 判，构造层不偷偷补假值。
 */
export function videoAuditEntryInput({ action, actor = {}, job = null, record = null, at = '', bytes = 0, detail = '', share = null, outcome = 'ok' } = {}) {
  const jobSource = job && typeof job === 'object' ? job : {};
  const recordSource = record && typeof record === 'object' ? record : {};
  const shareSource = share && typeof share === 'object' ? share : {};
  const spec = jobSource.specSnapshot && typeof jobSource.specSnapshot === 'object' ? jobSource.specSnapshot : {};
  const jobKey = str(jobSource.jobKey);
  const videoKey = str(recordSource.videoKey) || jobKey;
  const type = str(jobSource.type) || str(recordSource.type);
  const isClass = type === 'class';
  const objectName = str(spec.objectName) || str(recordSource.objectName);
  // 「分享」复用 US-211 的 `archive.share.generate`，那条动作有自己的必填项 `recordId`
  // （图文分享的对象是一条档案记录）。成片分享的对象是**这条成片**：令牌自己带的 recordId 优先，
  // 没有就用成片键 —— US-082 的老口径就是 `recordId: created.jobKey`，这里延续同一条，不另造字段。
  // 其余五个动作不带它（任务 / 成片的身份已经在 jobKey / videoKey 里，别把两个键混成一个）。
  const shareRecordId = str(shareSource.recordId) || videoKey;
  return {
    ...(actor && typeof actor === 'object' ? actor : {}),
    action: str(action),
    jobKey,
    videoKey,
    objectName,
    // 个人任务把学员记进 studentId / studentName（那正是「这是谁的视频」）；
    // 班级任务的归属在 objectName（班级名）里，不强塞一个假学员。
    studentId: isClass ? '' : objectName,
    studentName: isClass ? '' : objectName,
    version: recordSource.version === undefined || recordSource.version === null ? '' : String(recordSource.version),
    shareToken: str(shareSource.token),
    recordId: share ? shareRecordId : '',
    scope: str(spec.period) || str(recordSource.period),
    bytes: int(bytes || recordSource.bytes),
    outcome: str(outcome) || 'ok',
    detail: str(detail),
    at: str(at) || new Date().toISOString()
  };
}

/**
 * 复核一条视频留痕（空串 = 合规）：动作必须属于六条、必填字段必须齐全。
 * 面板把它渲染成读数，断言直接读它 —— 「写进去了但缺字段」这件事不会隐形。
 */
export function videoAuditEntryProblem(entry) {
  const item = entry && typeof entry === 'object' ? entry : {};
  const action = str(item.action);
  if (!action) return '这条留痕没有动作键。';
  if (!isVideoTaskAuditAction(action)) {
    return `动作「${action}」不在视频六条留痕里（${VIDEO_TASK_AUDIT_SIX.map(row => row.label).join(' / ')}）。`;
  }
  const missing = auditEntryMissingFields(item);
  if (missing.length) {
    return `${AUDIT_ACTION_LABELS[action] || action}的留痕还缺：${missing.join('、')}。`;
  }
  return '';
}

/** 六条的汇总读数（面板顶部一行；六个动作各自几条）。 */
export function videoTaskAuditStats(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter(item => item && typeof item === 'object' && isVideoTaskAuditAction(item.action));
  const rows = VIDEO_TASK_AUDIT_SIX.map(row => ({
    ...row,
    count: list.filter(item => str(item.action) === row.action).length
  }));
  const missing = list.filter(item => videoAuditEntryProblem(item)).length;
  const latestAt = list.length
    ? list.reduce((newest, item) => (String(item.at) > String(newest) ? String(item.at) : newest), String(list[0].at))
    : '';
  return {
    total: list.length,
    rows,
    missing,
    latestAt,
    text: list.length
      ? `六条动作共 ${list.length} 条留痕（${rows.map(row => `${row.label} ${row.count}`).join(' · ')}）${missing ? `；其中 ${missing} 条缺字段` : ''}`
      : '还没有视频任务留痕：提交一条视频任务后，这里会记下操作人 / 时间 / 任务键。'
  };
}

/** 留痕里的对象读数（列表一行用；认不出的对象写「未记录对象」）。 */
export function videoAuditObjectText(entry) {
  const item = entry && typeof entry === 'object' ? entry : {};
  const row = videoTaskAuditRow(item.action);
  const objectName = str(item.objectName) || str(item.studentName) || str(item.jobKey) || str(item.videoKey) || '未记录对象';
  return [objectName, row ? row.label : ''].filter(Boolean).join(' · ');
}
