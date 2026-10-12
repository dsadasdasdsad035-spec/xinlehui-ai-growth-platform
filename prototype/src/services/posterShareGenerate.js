// 海报二维码的「先生成分享链接」编排（[海报 US-313] / AC2）。
//
// 弹窗里那个按钮做完的四件事（**规则全在 data 层，这里只做编排**）：
//   ① 判据：这条海报的二维码要哪一种分享（图文按档案记录 / 成片按视频任务）——
//      由 `data/posterShareQr.js` 的 `posterShareQrGenerateTarget()` 给出（五类版式的字段位置只有它知道）；
//   ② 闸门：**先过授权**再碰数据（`shareTokenGenerationGate` ← `archiveForwardView` ← `data/consent.js`，
//      成片走 `videoShareGateView`，那是同一支判据的成片入口）——未授权时不生成、不留任何数据；
//   ③ 生成：`createShareTokenRecord` / `createVideoShareTokenRecord`（有效期与到期时刻同一份算法），
//      入参拼装点也是唯一一份（`shareTokenRecordInput` / `videoShareTokenInput`）；
//   ④ 落账：令牌进调用方的令牌账（App 层 state），返回**新的令牌数组**与一条待写的留痕输入
//      （留痕的写入在调用方：第四步走 `auditTeacherEntry`，档案页走 `recordAudit` 四件套）。
//
// 「先落本机镜像再推云端」这一半由调用方完成：本机镜像的写权属于 App 层（`persistShareTokens` 在
// `shareTokens` state 的 effect 里），这里只提供 `pushPosterShareTokenRemote()` 把令牌推到云端
// （表没建时被拒 —— 只影响跨设备可见，本机这条照常成立，与 US-208a 同一口径）。

import { archiveStepView, archiveForwardView } from '../data/archiveSummary';
import { findConsent } from '../data/consent';
import { AUDIT_ACTIONS } from '../data/auditLog';
import { posterShareQrFacts } from '../data/posterShareQr';
import {
  SHARE_TOKEN_DEFAULT_VALID_DAYS,
  appendShareToken,
  createShareTokenRecord,
  normalizeShareTokenValidDays,
  shareTokenGenerationGate,
  shareTokenLink,
  shareTokenRecordInput
} from '../data/shareTokens';
import {
  createVideoShareTokenRecord,
  videoShareGateView,
  videoShareTokenInput
} from '../data/videoShare';
import { saveRemoteShareToken } from './shareTokensApi';

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const str = (value) => String(value === null || value === undefined ? '' : value).trim();

/** 这一张海报的二维码要生成什么（判据 + 闸门 + 可读原因），界面据此决定按钮能不能点。 */
export const POSTER_SHARE_QR_TARGET_MISSING_REASON = '这张海报对应的记录不在当前数据里：回到成长档案，从那条记录重新生成分享链接。';
export const POSTER_SHARE_QR_VIDEO_TARGET_MISSING_REASON = '这张封面对应不上视频任务：先在成长档案里生成这条成片，再回来生成分享链接。';
export const POSTER_SHARE_QR_CREATE_FAILED_REASON = '令牌生成失败，请重试。';

/**
 * 生成前的整份读数：`{ allowed, ready, blocked, reason, entryLabel, targetKind, recordId, jobKey, target }`。
 * `ready: true` = 已经有可用的分享（不必再生成，界面给链接与有效期）。
 */
export function posterShareQrGeneratePlan({ plan = null, records = [], consents = null, students = [], jobs = [] } = {}) {
  const facts = posterShareQrFacts(plan);
  const target = isPlainObject(plan) ? plan : {};
  const list = Array.isArray(records) ? records : [];
  const base = {
    allowed: false,
    ready: facts.active,
    blocked: false,
    reason: '',
    entryLabel: '',
    targetKind: facts.targetKind,
    recordId: facts.recordId,
    jobKey: facts.jobKey,
    state: facts.state,
    stateLabel: facts.stateLabel
  };
  if (facts.active) return { ...base, ready: true, reason: '这条分享链接还在使用中：有效期内的二维码已经画在海报上了。' };
  if (!facts.plan) return { ...base, reason: POSTER_SHARE_QR_TARGET_MISSING_REASON };

  if (facts.targetKind === 'video') {
    const jobKey = str(facts.jobKey);
    if (!jobKey) return { ...base, reason: POSTER_SHARE_QR_VIDEO_TARGET_MISSING_REASON };
    const job = (Array.isArray(jobs) ? jobs : []).find((item) => isPlainObject(item) && str(item.jobKey) === jobKey) || null;
    const video = isPlainObject(target.video) ? target.video : {};
    const isClass = str(target.type) === 'class' || target.isClass === true;
    const objectName = str(target.objectName);
    // 闸门读的 `step` 与成长档案里那一支同一来源：这位学员 / 这个班**最近一条**归档记录
    // （archiveStepView 的产物）—— 不是另写一套授权判断（`videoShareGateView` 内部逐位学员走
    // `findConsent` → `archiveForwardView` → `shareTokenGenerationGate`）。
    const stepRecord = list
      .filter((item) => isPlainObject(item) && String(item.student || '').trim()
        && (isClass ? str(item.className) === objectName : str(item.student) === objectName))
      .sort((left, right) => String(right.lessonDate || right.date || '').localeCompare(String(left.lessonDate || left.date || '')))[0] || null;
    const gate = videoShareGateView({
      students: isClass ? (Array.isArray(students) ? students : []) : (objectName ? [objectName] : []),
      consents,
      step: stepRecord ? archiveStepView({ record: stepRecord }) : null,
      lessonDate: stepRecord ? str(stepRecord.lessonDate || stepRecord.date) : '',
      title: stepRecord ? str(stepRecord.title) : ''
    });
    const blockedGate = gate.allowed
      ? gate
      : {
        ...gate,
        reason: gate.reason || '先完成成片生成并取得家长查看授权，才能生成成片分享链接。'
      };
    return {
      ...base,
      allowed: Boolean(blockedGate.allowed),
      blocked: !blockedGate.allowed,
      reason: blockedGate.allowed ? '' : str(blockedGate.reason),
      entryLabel: str(blockedGate.entryLabel),
      target: {
        targetKind: 'video',
        jobKey,
        jobPresent: Boolean(job),
        type: isClass ? 'class' : 'personal',
        objectName,
        className: isClass ? objectName : str(video.className),
        period: str(video.period || target.period)
      }
    };
  }

  const record = list.find((item) => isPlainObject(item) && str(item.id) && str(item.id) === facts.recordId) || null;
  if (!record) return { ...base, reason: POSTER_SHARE_QR_TARGET_MISSING_REASON };
  const step = archiveStepView({ record });
  const consent = findConsent(consents, { name: record.student, studentId: record.studentId });
  const forward = archiveForwardView({
    step,
    consent,
    student: record.student,
    lessonDate: record.lessonDate || record.date,
    title: record.title
  });
  const gate = shareTokenGenerationGate(forward);
  return {
    ...base,
    allowed: Boolean(gate.allowed),
    blocked: !gate.allowed,
    reason: gate.allowed ? '' : gate.reason,
    entryLabel: gate.allowed ? '' : gate.entryLabel,
    state: gate.state,
    stateLabel: gate.stateLabel || facts.stateLabel,
    target: { targetKind: 'record', recordId: str(record.id), record }
  };
}

/**
 * 生成一条分享令牌（AC2 的动作本体）：返回
 * `{ ok, created, tokens, audit, reason, entryLabel, blocked, plan }` —— `tokens` 是**新的令牌数组**
 * （调用方把它写进 App 层 state，本机镜像由那一层落盘）。
 * 生成失败 / 被闸门拦下都**不改动任何数据**，只回可读原因。
 */
export function generatePosterShareToken({
  plan = null,
  records = [],
  consents = null,
  students = [],
  jobs = [],
  tokens = [],
  validDays = SHARE_TOKEN_DEFAULT_VALID_DAYS,
  by = '',
  orgId = ''
} = {}) {
  const request = posterShareQrGeneratePlan({ plan, records, consents, students, jobs });
  if (!request.allowed) return { ok: false, ...request };
  const days = normalizeShareTokenValidDays(validDays);
  const list = Array.isArray(tokens) ? tokens : [];

  if (request.targetKind === 'video') {
    const target = request.target;
    const created = createVideoShareTokenRecord(videoShareTokenInput({
      jobKey: target.jobKey,
      type: target.type,
      objectName: target.objectName,
      className: target.className,
      period: target.period,
      validDays: days,
      createdBy: by
    }), {});
    if (!created) return { ok: false, reason: POSTER_SHARE_QR_CREATE_FAILED_REASON, plan: request };
    return {
      ok: true,
      created,
      tokens: appendShareToken(list, created),
      request,
      audit: {
        action: AUDIT_ACTIONS.shareGenerate,
        jobKey: created.jobKey,
        studentName: created.student,
        version: created.version,
        shareToken: created.token,
        scope: created.period,
        detail: `成片分享链接（海报二维码）· 有效期 ${created.validDays} 天`
      }
    };
  }

  const record = request.target.record;
  const created = createShareTokenRecord(shareTokenRecordInput(record, { validDays: days, createdBy: by, orgId }), {});
  if (!created) return { ok: false, reason: POSTER_SHARE_QR_CREATE_FAILED_REASON, plan: request };
  return {
    ok: true,
    created,
    tokens: appendShareToken(list, created),
    request,
    audit: {
      action: AUDIT_ACTIONS.shareGenerate,
      studentId: created.studentId,
      studentName: created.student,
      lessonDate: created.lessonDate,
      recordId: created.recordId,
      version: created.version,
      shareToken: created.token,
      scope: created.className,
      detail: `${created.student} · ${created.lessonDate || ''} · 第 ${created.version} 版 · 有效期 ${created.validDays} 天`
    }
  };
}

/** 生成回执里那条链接（面板上显示的是完整地址，弹窗里也给一次 `/p/<令牌>`）。 */
export function posterShareQrCreatedText(created) {
  const token = str(created && created.token);
  if (!token) return '';
  return shareTokenLink(token);
}

/** 把这条令牌推到云端（表没建时被拒：只落本机镜像，跨设备可见性另说 —— 与 US-208a 同一口径）。 */
export function pushPosterShareTokenRemote(record) {
  if (!record) return Promise.resolve(null);
  return saveRemoteShareToken(record).catch(() => null);
}
