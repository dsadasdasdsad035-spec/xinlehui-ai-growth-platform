/**
 * 班级反馈「批量应用装裱」（[第二步 US-010] / PRD US-010）。
 *
 * 场景：带 18 人班的老师把同一套装裱一次应用到本班已上传的**全部**作品，落款里的
 * `{学员名}` 与展签姓名按**作品所属学员**自动替换（不串名）；单幅作品仍然可以单独保存，
 * 批量覆盖到那些「已单独调整过」的作品之前必须二次确认。
 *
 * 本模块是这条流程的**唯一规则来源**（零依赖纯函数 + 常量，Node 可直接跑断言）：
 *
 * | 关注点 | 函数 |
 * |---|---|
 * | 每幅作品的渲染输入与新鲜度键（与单幅保存同一份口径） | `batchFramingVariablesOf` / `batchFramingTargetOf` |
 * | 「哪些要装裱 / 哪些已是最新 / 哪些被单独调整过」 | `planBatchFraming` |
 * | 进度 / 失败清单 / 耗时与 20 秒预算 | `batchFramingReducer` + `batchFramingSummaryText` / `batchFramingBudgetVerdict` |
 * | 覆盖前二次确认的文案（验收原文） | `batchFramingConfirmText` |
 *
 * ## 三种作品状态（验收点名的两条都在这里）
 *
 * 每幅作品按**作品位上的写回记录**（US-008b 的 `writeBack`）分类：
 *
 * - `pending`：还没装裱过 → 本次要装；
 * - `current`：上一次批量装裱的成品图**仍然新鲜**（参数与变量都没变）→ 跳过，不重复渲染；
 * - `adjusted`：**已单独调整过** → 本次会覆盖它，所以**先二次确认**。判据有两条：
 *     ① 那份成品图是老师用「保存图片」单独存的（记录上没有 `batchId`）；
 *     ② 记录来自批量，但**同一个参数下重算新鲜度键对不上** —— 说明批量之后老师又改过
 *        这一幅（作品名 / 旋转 / 换了底图），那份图是老师单独调整的结果。
 *   反过来，「只是换了一套模板再跑一次批量」不算单独调整（记录在自己的参数下仍然对得上），
 *   否则每次换模板都要确认一遍，确认就变成噪音了。
 * - `missing`：这条素材没有可读的底图地址（不可装裱），单独计数并在界面上说明。
 *
 * ## 与单幅口径的关系（别改）
 *
 * 姓名与作品名取 `entry.studentName / entry.title`（= `main.jsx` 里 US-006/007/008 的
 * `frameThumbStudent` / `frameThumbTitle` 同一份口径），**不加课题回落**：加了会让同一个
 * 作品位算出两个不同的新鲜度键 —— 单幅保存的成品图与批量装裱的成品图互相不认。
 * 未绑定学员的作品照常装裱（姓名是空串，展签上不会凭空多出一个名字），并在提示里单独计数。
 *
 * 批量装裱写回的是**档案展示口径的持久副本**（`ARTWORK_WRITE_BACK_IMAGE`，与单幅保存同一份），
 * 逐张打包下载是第二期的可选项（tasks/prd-smart-framing-v2.md 的开放问题 Q1），本故事不做。
 */

import { artworkWriteBackIsFresh, artworkWriteBackKey, artworkWriteBackOf } from './artworkWriteBack';
import { createUploadEntry, ownersOfUpload } from './uploadBinding';

/** 批量任务的状态机（`cancelling` 是「老师点了取消、正在等当前这一幅画完」）。 */
export const BATCH_FRAMING_STATUSES = ['idle', 'running', 'cancelling', 'done', 'cancelled'];

/** 每幅作品的状态（验收点名的三条：要装 / 已是最新 / 已单独调整过）。 */
export const BATCH_FRAMING_TARGET_STATES = ['pending', 'current', 'adjusted', 'missing'];

/**
 * 耗时预算（验收原文：18 幅作品批量装裱总耗时 ≤ 20 秒）。
 * 作品数超过基准数时按比例放宽（36 幅 = 40 秒），判据只写一处，界面与断言都读它。
 */
export const BATCH_FRAMING_BUDGET = Object.freeze({ artworks: 18, ms: 20000 });

/** 批量装裱写回记录上的档位标记（单幅保存是 hd / wechat，批量是 batch）。 */
export const BATCH_FRAMING_QUALITY = Object.freeze({
  id: 'batch',
  label: '批量装裱（档案展示口径）'
});

/** 批量覆盖前二次确认里那句验收原文（`将覆盖 N 幅已单独调整的作品`）。 */
export const BATCH_FRAMING_CONFIRM_PREFIX = '将覆盖';

let batchSeq = 0;

/** 一次批量运行的批次 id：写进每条写回记录（`writeBack.batchId`），用来区分「批量」与「单独保存」。 */
export function makeBatchFramingId() {
  batchSeq += 1;
  return `batch-${Date.now().toString(36)}-${batchSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const str = (value) => (value === null || value === undefined ? '' : String(value).trim());

/** 一次批量运行的耗时上限（毫秒）：按作品数等比放宽，基准是 18 幅 / 20 秒。 */
export function batchFramingTimeLimitMs(count = BATCH_FRAMING_BUDGET.artworks) {
  const total = Math.max(1, Math.trunc(Number(count) || 0));
  return Math.max(BATCH_FRAMING_BUDGET.ms, Math.ceil((BATCH_FRAMING_BUDGET.ms * total) / BATCH_FRAMING_BUDGET.artworks));
}

/** 秒数文案（`8.4 秒`）：界面与验证脚本读同一份，别各自 toFixed。 */
export function batchFramingSecondsText(ms) {
  const value = Math.max(0, Number(ms) || 0);
  return `${(value / 1000).toFixed(1)} 秒`;
}

/** 一幅作品在界面上的名字（进度行与失败清单共用）。 */
export function batchFramingTargetLabel(target = {}) {
  const student = str(target.studentName);
  const title = str(target.title);
  if (student || title) return `${student || '未绑定学员'}${title ? `《${title}》` : ''}`;
  return str(target.name) || '未命名作品';
}

/**
 * 一幅作品的渲染入参与新鲜度键。
 *
 * `studentName` / `studentId` 取**作品所属学员**（先看条目归属，再回到 participants 名单里
 * 找同一位的真实姓名）：落款、展签、文件名读的都是这一份，因此不会串到「当前选中的学员」。
 */
export function batchFramingVariablesOf(entry, options = {}) {
  // 入参一律容忍脏值：`null` / 字符串当成「没给」，与 normalize<X> 同一套纪律（永不抛错）。
  const {
    participants = [],
    lessonDate = '',
    teacherName = '',
    orgName = '',
    fallbackDate = ''
  } = options && typeof options === 'object' ? options : {};
  const item = createUploadEntry(entry);
  const owners = ownersOfUpload(item, participants);
  const primary = owners[0] || null;
  return {
    uploadId: item.uploadId,
    name: item.name,
    source: item.url,
    rotation: Number(item.rotation) || 0,
    studentId: str(primary?.studentId || item.studentId),
    studentName: str(primary?.name || item.studentName),
    title: str(item.title),
    date: str(fallbackDate),
    lessonDate: str(lessonDate),
    teacherName: str(teacherName),
    orgName: str(orgName)
  };
}

/** 用某一套参数（specKey）与一幅作品的变量算新鲜度键 —— 与单幅保存走同一个函数。 */
export function batchFramingKeyOf(variables = {}, specKey = '') {
  return artworkWriteBackKey({
    specKey,
    sourceUrl: variables.source,
    student: variables.studentName,
    title: variables.title,
    lessonDate: variables.lessonDate,
    teacherName: variables.teacherName,
    orgName: variables.orgName,
    rotation: variables.rotation
  });
}

/**
 * 一幅作品的判定结果：变量（渲染输入）、新鲜度键与状态。
 *
 * @returns {{state:string,variables:object,key:string,record:object|null,reason:string}}
 *          `reason` 是给界面看的一句话（为什么跳过 / 为什么需要确认）。
 */
export function batchFramingTargetOf(entry, options = {}) {
  const variables = batchFramingVariablesOf(entry, options);
  const specKey = str(options.specKey);
  const key = batchFramingKeyOf(variables, specKey);
  const record = artworkWriteBackOf(entry);
  if (!variables.source) {
    return { state: 'missing', variables, key, record, reason: '这条素材没有可读的底图地址，无法装裱' };
  }
  if (!record) {
    return { state: 'pending', variables, key, record: null, reason: '还没有装裱过，本次装裱' };
  }
  const freshUnderCurrent = artworkWriteBackIsFresh(record, key);
  const batch = Boolean(str(record.batchId));
  // 同一个参数下重算键：对不上说明「这一幅的变量（作品名 / 旋转 / 底图）被改过」。
  const ownKey = batchFramingKeyOf(variables, str(record.specKey));
  const adjustedAfterBatch = !artworkWriteBackIsFresh(record, ownKey);
  if (!batch) {
    return { state: 'adjusted', variables, key, record, reason: '这幅作品用「保存图片」单独存过成品图' };
  }
  if (adjustedAfterBatch) {
    return { state: 'adjusted', variables, key, record, reason: '上一次批量之后，这一幅又被单独改过（作品名 / 旋转 / 底图变了）' };
  }
  if (freshUnderCurrent) {
    return { state: 'current', variables, key, record, reason: '已经是这套参数下的成品图，跳过' };
  }
  return { state: 'pending', variables, key, record, reason: '装裱参数变了（换了模板或调过参数），需要重画' };
}

/**
 * **展示用**的新鲜度键：按**记录自己的参数**重算。
 *
 * 消费点（第二步装裱墙 / 第三步班级合展）要回答的是「这幅作品上保存的成品图还能不能代表它」，
 * 而不是「它是不是按面板此刻选的那套模板画的」—— 后者是批量面板自己的问题（`planBatchFraming`
 * 会把它算成 pending）。两者的差别在真实场景里很要紧：
 *   - 老师在批量面板上换一套模板**但还没应用**时，作品上的图仍然是上一套参数画出来的，它并没有
 *     「过期」；用面板选项当键会让整面墙立刻标成「待重新装裱」，把老师吓一跳；
 *   - 反过来，老师改了这一幅的作品名 / 旋转 / 换了底图，那份图就真的对不上了 → 过期。
 * 因此键取「这一幅当前的变量 + 记录自己的 specKey」（没有记录时取 `options.specKey`，
 * 那种情况下消费点本来就返回空串，取什么都一样）。
 */
export function batchFramingDisplayKeyOf(entry, options = {}) {
  const variables = batchFramingVariablesOf(entry, options);
  const record = artworkWriteBackOf(entry);
  return batchFramingKeyOf(variables, str(record?.specKey) || str(options?.specKey));
}

/**
 * 把一次批量的目标列出来。
 *
 * @returns {{targets:Array,jobs:Array,total:number,pending:Array,adjusted:Array,current:Array,missing:Array,unbound:number}}
 *          `jobs` = 真正需要渲染的那些（pending + adjusted），顺序与素材列表一致。
 */
export function planBatchFraming({
  entries = [],
  participants = [],
  specKey = '',
  lessonDate = '',
  teacherName = '',
  orgName = '',
  fallbackDate = ''
} = {}) {
  const options = { participants, specKey, lessonDate, teacherName, orgName, fallbackDate };
  const targets = (entries || []).map((entry) => {
    const target = batchFramingTargetOf(entry, options);
    return { ...target, label: batchFramingTargetLabel(target.variables) };
  });
  const pick = (state) => targets.filter((item) => item.state === state);
  return {
    targets,
    jobs: targets.filter((item) => item.state === 'pending' || item.state === 'adjusted'),
    total: targets.length,
    pending: pick('pending'),
    adjusted: pick('adjusted'),
    current: pick('current'),
    missing: pick('missing'),
    unbound: targets.filter((item) => !item.variables.studentName).length
  };
}

/** 覆盖前的二次确认文案（验收原文：「将覆盖 3 幅已单独调整的作品」）。 */
export function batchFramingConfirmText(adjusted = []) {
  const list = (adjusted || []).filter(Boolean);
  const count = list.length;
  const head = `${BATCH_FRAMING_CONFIRM_PREFIX} ${count} 幅已单独调整的作品`;
  const names = batchFramingConfirmNamesText(list);
  return `${head}：这些作品上已有老师单独保存或调整过的成品图，继续批量装裱会用本次选用的模板重画。${names}确认继续？`;
}

/** 二次确认里的名单（最多列 3 个，多的用「等 N 幅」收尾）。 */
export function batchFramingConfirmNamesText(adjusted = []) {
  const labels = (adjusted || []).filter(Boolean).map((item) => batchFramingTargetLabel(item.variables || item));
  if (!labels.length) return '';
  const shown = labels.slice(0, 3).join('、');
  return labels.length > 3 ? `（${shown} 等 ${labels.length} 幅）` : `（${shown}）`;
}

/** 一次批量任务的状态（缺字段补默认值，永不抛错 —— 与 normalize<X> 同一套纪律）。 */
export function createBatchFramingState(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const status = BATCH_FRAMING_STATUSES.includes(source.status) ? source.status : 'idle';
  // 时间戳一律收成「非负数字」：`0` 是合法时间戳（验证脚本固定时间轴），只有没给才算 0。
  const stamp = (value) => (value === null || value === undefined || value === '' ? 0 : Math.max(0, Number(value) || 0));
  const startedAt = stamp(source.startedAt);
  const finishedAt = stamp(source.finishedAt);
  const elapsedMs = stamp(source.elapsedMs) || (finishedAt ? Math.max(0, finishedAt - startedAt) : 0);
  return {
    status,
    batchId: str(source.batchId),
    presetId: str(source.presetId),
    total: Math.max(0, Math.trunc(Number(source.total) || 0)),
    done: Math.max(0, Math.trunc(Number(source.done) || 0)),
    currentUploadId: str(source.currentUploadId),
    currentLabel: str(source.currentLabel),
    succeeded: Math.max(0, Math.trunc(Number(source.succeeded) || 0)),
    failures: (Array.isArray(source.failures) ? source.failures : [])
      .filter((item) => item && (item.uploadId || item.name || item.label))
      .map((item) => ({
        uploadId: str(item.uploadId),
        name: str(item.name),
        studentName: str(item.studentName),
        title: str(item.title),
        label: str(item.label) || batchFramingTargetLabel(item),
        message: str(item.message)
      })),
    startedAt,
    finishedAt,
    elapsedMs
  };
}

/** 正在跑（含「正在取消」）时界面上的按钮与进度读它。 */
export function batchFramingIsRunning(state) {
  return state?.status === 'running' || state?.status === 'cancelling';
}

/**
 * 批量任务的状态迁移（纯函数，Node 可直跑断言）。
 *
 * 动作：
 *   - `start`（total / batchId / presetId / at）
 *   - `progress`（done / target：**开始画这一幅**时调用，界面据此显示「正在装裱 3 / 18」）
 *   - `item-ok`（target 成功：succeeded+1）
 *   - `item-failed`（target + message：进失败清单，**不影响已成功的项**）
 *   - `finish`（status：done / cancelled，记录 finishedAt 与 elapsedMs）
 *   - `reset`
 */
export function batchFramingReducer(state, action = {}) {
  const current = createBatchFramingState(state);
  // `at` 允许显式给 0（验证脚本要固定时间轴），只有「没给」才取当前时刻。
  const at = action.at === undefined || action.at === null ? Date.now() : Math.max(0, Number(action.at) || 0);
  // 「已经跑起来」了的任务才有耗时：idle 的时候 startedAt 是 0，直接减会得到「从 1970 年到现在」。
  const elapsedFromStart = () => (current.status === 'idle' ? current.elapsedMs : Math.max(0, at - current.startedAt));
  switch (action.type) {
    case 'start':
      return createBatchFramingState({
        status: 'running',
        batchId: str(action.batchId) || makeBatchFramingId(),
        presetId: str(action.presetId),
        total: Number(action.total) || 0,
        done: 0,
        succeeded: 0,
        failures: [],
        startedAt: at
      });
    case 'progress': {
      const target = action.target || {};
      return createBatchFramingState({
        ...current,
        done: Number(action.done) >= 0 ? Number(action.done) : current.done,
        currentUploadId: str(target.variables?.uploadId || target.uploadId),
        currentLabel: str(target.label) || batchFramingTargetLabel(target.variables || target),
        elapsedMs: elapsedFromStart()
      });
    }
    case 'item-ok': {
      // 成功时顺手把这一条从失败清单里摘掉：重试成功的那一幅不该继续挂在「失败清单」上，
      // 而「已成功的项」也不受清单里其它失败项影响（两者相互独立）。
      const id = str(action.target?.variables?.uploadId || action.target?.uploadId);
      return createBatchFramingState({
        ...current,
        succeeded: current.succeeded + 1,
        failures: id ? current.failures.filter((item) => item.uploadId !== id) : current.failures,
        currentUploadId: '',
        currentLabel: ''
      });
    }
    case 'cancel-request':
      return createBatchFramingState({ ...current, status: current.status === 'running' ? 'cancelling' : current.status });
    case 'item-failed': {
      const target = action.target || {};
      const entry = {
        uploadId: str(target.variables?.uploadId || target.uploadId),
        name: str(target.variables?.name || target.name),
        studentName: str(target.variables?.studentName || target.studentName),
        title: str(target.variables?.title || target.title),
        label: str(target.label) || batchFramingTargetLabel(target.variables || target),
        message: str(action.message)
      };
      const failures = current.failures.filter((item) => item.uploadId !== entry.uploadId);
      return createBatchFramingState({ ...current, failures: [...failures, entry], currentUploadId: '', currentLabel: '' });
    }
    case 'finish': {
      const status = BATCH_FRAMING_STATUSES.includes(action.status) ? action.status : 'done';
      const finishedAt = at;
      const done = Number(action.done) >= 0 ? Math.max(current.done, Math.trunc(Number(action.done))) : current.done;
      return createBatchFramingState({
        ...current,
        status,
        done,
        currentUploadId: '',
        currentLabel: '',
        finishedAt,
        elapsedMs: elapsedFromStart()
      });
    }
    case 'reset':
      return createBatchFramingState();
    default:
      return current;
  }
}

/** 进度行文案：跑起来是「正在装裱 3 / 18：林小满《雨后的花园》」。 */
export function batchFramingProgressText(state) {
  const view = createBatchFramingState(state);
  if (!batchFramingIsRunning(view)) return '';
  const step = Math.min(view.total, view.done + 1);
  const who = view.currentLabel || view.currentUploadId;
  return `正在装裱 ${step} / ${view.total}${who ? `：${who}` : ''}`;
}

/** 结果/进度的一行摘要（面板与归档摘要读同一句）。 */
export function batchFramingSummaryText(state) {
  const view = createBatchFramingState(state);
  const failed = view.failures.length;
  const elapsed = batchFramingSecondsText(view.elapsedMs);
  switch (view.status) {
    case 'running':
    case 'cancelling':
      return `已装裱 ${view.done} / ${view.total} 幅 · 已用 ${elapsed}${view.status === 'cancelling' ? ' · 正在取消…' : ''}`;
    case 'done':
      return `批量装裱完成：成功 ${view.succeeded} 幅${failed ? `，失败 ${failed} 幅（可在下方单独重试）` : ''}，用时 ${elapsed}。`;
    case 'cancelled':
      return `已取消：本次装裱 ${view.done} / ${view.total} 幅（成功 ${view.succeeded} 幅${failed ? `，失败 ${failed} 幅` : ''}），已完成的不受影响。`;
    default:
      return '还没有运行过批量装裱。';
  }
}

/** 耗时预算判据：在 20 秒（18 幅基准，按数量等比放宽）内算达标。 */
export function batchFramingBudgetVerdict(state) {
  const view = createBatchFramingState(state);
  const count = view.done || view.total || BATCH_FRAMING_BUDGET.artworks;
  const limit = batchFramingTimeLimitMs(count);
  // 只有跑完（或至少跑过）时才有结论：进行中的耗时不算结论。
  if (!view.elapsedMs || (view.status !== 'done' && view.status !== 'cancelled')) {
    return { withinBudget: null, limit, limitText: `${(limit / 1000).toFixed(0)} 秒`, text: '' };
  }
  const withinBudget = view.elapsedMs <= limit;
  return {
    withinBudget,
    limit,
    limitText: `${(limit / 1000).toFixed(0)} 秒`,
    text: `${view.done} 幅用时 ${batchFramingSecondsText(view.elapsedMs)}，${withinBudget ? '在' : '超出'} ${count} 幅 / ${(limit / 1000).toFixed(0)} 秒预算内。`
  };
}

/** 预算规则文案（面板上的那一行小字）。 */
export function batchFramingBudgetText() {
  return `耗时预算：${BATCH_FRAMING_BUDGET.artworks} 幅作品 ${BATCH_FRAMING_BUDGET.ms / 1000} 秒内装裱完成（数量更多时按比例放宽）；过程中页面可滚动、随时可以取消。`;
}

/** 单条失败的说明（失败清单里逐条显示，可读、不暴露技术细节）。 */
export function batchFramingFailureText(message = '') {
  const detail = str(message);
  return detail ? `这一幅没有装裱成功：${detail}。可以只重试这一幅。` : '这一幅没有装裱成功。可以只重试这一幅。';
}

/** 失败清单的一行摘要（「2 幅失败，可单独重试」）。 */
export function batchFramingFailureSummaryText(state) {
  const count = createBatchFramingState(state).failures.length;
  return count ? `${count} 幅失败，可单独重试（已成功的不受影响）` : '';
}

/** 面板顶部的一行「现状」：三类各多少幅、几张没绑定学员、几条没法装裱。 */
export function batchFramingPlanText(plan) {
  const view = plan || {};
  const parts = [
    `本班已上传 ${view.total || 0} 幅作品`,
    `本次要装 ${(view.jobs || []).length} 幅`,
    (view.current || []).length ? `已是最新 ${view.current.length} 幅` : '',
    (view.adjusted || []).length ? `已单独调整 ${view.adjusted.length} 幅（需确认）` : '',
    view.unbound ? `${view.unbound} 幅未绑定学员（展签上不会出现姓名）` : '',
    (view.missing || []).length ? `${view.missing.length} 幅素材不可读（跳过）` : ''
  ];
  return parts.filter(Boolean).join(' · ');
}
