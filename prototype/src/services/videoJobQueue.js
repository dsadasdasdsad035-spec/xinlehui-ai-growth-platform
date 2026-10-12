/**
 * 视频任务的**本机 mock 队列**（[第四步 US-213a]）。
 *
 * 规则（状态机 / 幂等键 / 字段清单 / 进度推演 / 文案）全部在 `data/videoJobs.js`；
 * 这一层只做三件事，**不新增任何业务判据**：
 *
 *   ① **落地**：内存里一份任务列表（同一会话内所有订阅者看同一份）+ localStorage 镜像
 *      （`VIDEO_JOB_STORAGE_KEY`）—— 刷新 / 重开页面还能按 `jobKey` 看到那条任务，
 *      正在渲染的任务按真实经过时间继续推进（进度由 `startedAt` 推出来，不靠定时器攒数）；
 *   ② **推演**：定时器（默认 `VIDEO_JOB_TICK_MS` 400ms）把 `queued → rendering → done`
 *      走一遍，并发上限 `VIDEO_JOB_CONCURRENCY_DEFAULT`（默认 2），超出的留在 `queued`
 *      并逐条记 `queuePosition`；没有进行中的任务时**自动停表**（不在后台空转）；
 *   ③ **订阅**：`subscribeVideoJobs(listener)` 让界面在任务变化时重渲染（返回值取消订阅）。
 *
 * 全部动作（提交 / 取消 / 重试）都过数据层的判据：被拒时返回 `{ ok:false, job, issue }`
 * 且**一个字节都不改**（与装裱模板写权限同一条口径）。
 *
 * 说明：这一层**不发任何网络请求**、也**不产出任何成片** —— 视频渲染服务的契约层是
 * US-213b（`services/videoApi.js`）的事。界面与卡片上那句「演示数据 · 视频服务未接入」来自
 * `data/videoJobs.js`，本文件不另写文案。
 */

import {
  VIDEO_JOB_ACTIVE_STATUSES,
  VIDEO_JOB_CONCURRENCY_DEFAULT,
  VIDEO_JOB_DEMO_LABEL,
  VIDEO_JOB_SIMULATIONS,
  VIDEO_JOB_STATUSES,
  VIDEO_JOB_STORAGE_KEY,
  applyVideoJob,
  dedupeVideoJobs,
  loadVideoJobs,
  normalizeSimulateErrorCode,
  normalizeVideoJob,
  persistVideoJobs,
  videoJobActionIssue,
  videoJobAdvance,
  videoJobKey,
  videoJobMissingFields,
  videoJobQueueView,
  videoJobSignature,
  videoJobSpecSnapshot,
  videoJobStatusLabel,
  videoJobSubmitIssue
} from '../data/videoJobs';
// 成片记录里的音乐（[第四步 US-221]）：形状与归一化只写在 `data/musicSelection.js` 那一份里，
// 这一层只负责把它挂到任务的 `specSnapshot.music` 上（提交时写、处置时改 disposition）。
import { normalizeMusicJobMusic } from '../data/musicSelection';

/** 推演定时器的默认间隔（400ms 足够让进度读数动起来，又不至于把主线程占住）。 */
export const VIDEO_JOB_TICK_MS = 400;

/** 内存里的那一份（模块级 —— 同一会话内所有消费者看到同一个队列）。 */
let memoryJobs = loadVideoJobs();
let listeners = [];
let driverTimer = null;
let driverTick = VIDEO_JOB_TICK_MS;

const stampOf = now => new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now()).toISOString();
const isActive = status => VIDEO_JOB_ACTIVE_STATUSES.includes(status);
const byCreatedAt = (left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || String(left.jobKey).localeCompare(String(right.jobKey));

/** 当前队列（新数组，调用方改不动内存里的那一份）。 */
export function listVideoJobs() {
  return dedupeVideoJobs(memoryJobs);
}

/** 按 jobKey 取一条（没有 → null）。 */
export function getVideoJob(jobKey) {
  const key = String(jobKey ?? '').trim();
  if (!key) return null;
  return listVideoJobs().find(job => job.jobKey === key) || null;
}

function signatureOf(jobs) {
  return jobs.map(videoJobSignature).sort().join('||');
}

/** 内存 + localStorage 一次写入；真的有变化才落盘 / 通知（避免定时器每格都写盘）。 */
function commit(jobs, { persist = true } = {}) {
  const before = signatureOf(listVideoJobs());
  memoryJobs = dedupeVideoJobs(jobs);
  const after = signatureOf(memoryJobs);
  const changed = before !== after;
  if (changed && persist) persistVideoJobs(memoryJobs);
  if (changed) notify();
  return changed;
}

function notify() {
  const rows = listVideoJobs();
  listeners.slice().forEach(listener => {
    try {
      listener(rows);
    } catch {
      /* 订阅者的异常不拖垮队列（界面自己处理）。 */
    }
  });
}

/** 订阅队列变化（返回取消订阅的函数）。 */
export function subscribeVideoJobs(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(item => item !== listener);
  };
}

/**
 * 推进队列一步（**推进一次 = 提升排队 + 计算进度 + 重排队列位次**）。
 * `now` / `mockSeconds` / `timeoutMs` / `concurrency` 都可注入（Node 断言不依赖真实定时器）。
 */
export function advanceVideoJobQueue({ now = Date.now(), mockSeconds = null, timeoutMs = null, concurrency = VIDEO_JOB_CONCURRENCY_DEFAULT, persist = true } = {}) {
  const stamp = stampOf(now);
  const limit = Math.max(1, Math.trunc(Number(concurrency)) || VIDEO_JOB_CONCURRENCY_DEFAULT);
  const jobs = listVideoJobs();
  let rendering = jobs.filter(job => job.status === VIDEO_JOB_STATUSES.rendering).length;
  // ① 提升排队任务（先来先做，最多 limit 条在渲染）—— 提升的那一刻才算「第 N 次尝试」，记 startedAt。
  const promoted = jobs
    .slice()
    .sort(byCreatedAt)
    .map(job => {
      if (job.status !== VIDEO_JOB_STATUSES.queued || rendering >= limit) return job;
      rendering += 1;
      return normalizeVideoJob({
        ...job,
        status: VIDEO_JOB_STATUSES.rendering,
        attempts: job.attempts + 1,
        startedAt: stamp,
        finishedAt: '',
        error: '',
        errorCode: '',
        updatedAt: stamp,
        queuePosition: 0
      });
    });
  // ② 推进渲染中的任务（纯函数：进度 = 经过时间 / 模拟耗时；到点 done，超时 / 演示失败 → failed）。
  const advanced = promoted.map(job => (
    job.status === VIDEO_JOB_STATUSES.rendering ? videoJobAdvance(job, { now, mockSeconds, timeoutMs }) : job
  ));
  // ③ 队列位次（只给还排着的任务编号，按先来后到）。
  const queuedKeys = advanced.filter(job => job.status === VIDEO_JOB_STATUSES.queued).sort(byCreatedAt).map(job => job.jobKey);
  const positioned = advanced.map(job => {
    const position = job.status === VIDEO_JOB_STATUSES.queued ? queuedKeys.indexOf(job.jobKey) + 1 : 0;
    if (position === job.queuePosition) return job;
    return normalizeVideoJob({ ...job, queuePosition: position, updatedAt: job.updatedAt || stamp });
  });
  const changed = commit(positioned, { persist });
  const rows = listVideoJobs();
  return { jobs: rows, changed, running: rows.some(job => isActive(job.status)), queueView: videoJobQueueView(rows) };
}

function hasActiveJob() {
  return listVideoJobs().some(job => isActive(job.status));
}

/** 起表（幂等：重复调用只留一个定时器；没有进行中的任务时不起表）。 */
export function startVideoJobQueue({ tickMs = driverTick } = {}) {
  const interval = Math.max(50, Math.trunc(Number(tickMs)) || VIDEO_JOB_TICK_MS);
  driverTick = interval;
  if (typeof setInterval !== 'function') return false;
  if (driverTimer !== null) return true;
  if (!hasActiveJob()) return false;
  driverTimer = setInterval(() => {
    const result = advanceVideoJobQueue();
    if (!result.running) stopVideoJobQueue();
  }, interval);
  return true;
}

/** 停表（幂等）。 */
export function stopVideoJobQueue() {
  if (driverTimer === null) return;
  clearInterval(driverTimer);
  driverTimer = null;
}

export function isVideoJobQueueRunning() {
  return driverTimer !== null;
}

/** 进页面 / 刷新后接上队列：先按真实经过时间推进一次，还有进行中的任务就继续起表。 */
export function resumeVideoJobQueue(options = {}) {
  const result = advanceVideoJobQueue(options);
  if (result.running) startVideoJobQueue();
  return result;
}

/**
 * 提交一条任务（幂等：同一 `jobKey` 只会有一条任务）。
 * 返回 `{ ok, job, created, issue, notice }` —— 四种结局都给同一组字段：
 *  - `created:true`：新建了这条任务；
 *  - `created:false`：命中了已有的同一条（排队中 / 渲染中 / 已完成 → 原样返回，不重复创建；
 *    失败 / 已取消 → 沿用它重新排队，attempts 保留）；
 *  - `ok:false`：连提交都不该发生（没选对象 / 没选周期），`issue` 给可读原因，队列一个字节不改。
 * `simulate` / `simulateErrorCode` 是演示队列自己的失败开关（四类原因各一套文案），
 * 重复提交时按本次的选择更新 —— 真实的失败原因由渲染服务返回。
 * `music`（[第四步 US-221] / FR-295）是「本片选用」生成的那一份（静音或曲目 id + 授权凭证快照）：
 * 新任务写进 `specSnapshot.music`；重排队时**覆盖**它（老师这次换成了别的曲子 / 静音）；
 * 不传（老调用方）时保持原样。
 */
export function submitVideoJob({
  type,
  studentId = '',
  classId = '',
  period = '',
  objectName = '',
  lessonCount = 0,
  artworkCount = 0,
  photoCount = 0,
  createdBy = '',
  simulate = VIDEO_JOB_SIMULATIONS.success,
  simulateErrorCode = '',
  music = null,
  now = Date.now()
} = {}) {
  const submitIssue = videoJobSubmitIssue({ type, studentId, classId, period });
  if (submitIssue) return { ok: false, job: null, created: false, issue: submitIssue, notice: '' };
  const jobKey = videoJobKey({ type, studentId, classId, period });
  const stamp = stampOf(now);
  const mode = String(simulate) === VIDEO_JOB_SIMULATIONS.fail ? VIDEO_JOB_SIMULATIONS.fail : VIDEO_JOB_SIMULATIONS.success;
  const errorCode = normalizeSimulateErrorCode(simulateErrorCode || undefined);
  const musicRecord = normalizeMusicJobMusic(music);
  const existing = getVideoJob(jobKey);
  if (existing) {
    // ① 正在进行 / 已经完成 → 幂等命中，**不产生第二条任务**。
    if (isActive(existing.status) || existing.status === VIDEO_JOB_STATUSES.done) {
      const notice = existing.status === VIDEO_JOB_STATUSES.done
        ? `这条任务之前已经完成过（演示进度 100%，未产出成片）：沿用同一条任务，没有重复创建。`
        : `已有一条同样的任务（${videoJobStatusLabel(existing.status)}）：沿用同一条任务，没有重复创建。`;
      return { ok: true, job: existing, created: false, issue: '', notice };
    }
    // ② 失败 / 已取消 → 沿用它重新排队（同一个 jobKey，attempts 不清零）；
    //    这次要是换了音乐，快照里的 music 一起更新（版权证据跟着本片选用走）。
    const requeued = normalizeVideoJob({
      ...existing,
      status: VIDEO_JOB_STATUSES.queued,
      progress: 0,
      error: '',
      errorCode: '',
      simulate: mode,
      simulateErrorCode: errorCode,
      specSnapshot: musicRecord ? { ...existing.specSnapshot, music: musicRecord } : existing.specSnapshot,
      startedAt: '',
      finishedAt: '',
      updatedAt: stamp,
      queuePosition: existing.queuePosition || 1
    });
    commit(applyVideoJob(memoryJobs, requeued));
    startVideoJobQueue();
    const promoted = advanceVideoJobQueue({ now });
    const requeuedJob = getVideoJob(jobKey) || requeued;
    const view = videoJobQueueView(promoted.jobs).jobs.find(row => row.jobKey === jobKey);
    return {
      ok: true,
      job: requeuedJob,
      created: false,
      issue: '',
      notice: `之前那一次没跑完，已沿用同一个 jobKey 重新排队（${view ? view.attemptsLabel : '第 1 次尝试'}）。`
    };
  }
  // ③ 新建：字段齐全（`videoJobMissingFields` 是必填清单的唯一判据），成片三件套由归一化清成空值。
  const job = normalizeVideoJob({
    jobKey,
    type,
    studentId,
    classId,
    period,
    specSnapshot: videoJobSpecSnapshot({ type, studentId, classId, period, objectName, lessonCount, artworkCount, photoCount, capturedAt: stamp, music: musicRecord }),
    status: VIDEO_JOB_STATUSES.queued,
    progress: 0,
    attempts: 0,
    error: '',
    simulate: mode,
    simulateErrorCode: errorCode,
    demo: true,
    createdBy,
    createdAt: stamp,
    updatedAt: stamp
  });
  commit(applyVideoJob(memoryJobs, job));
  startVideoJobQueue();
  const promoted = advanceVideoJobQueue({ now });
  const stored = getVideoJob(jobKey) || job;
  const missing = videoJobMissingFields(stored);
  if (missing.length) {
    // 结构上不该发生（提交前已判过一次）：仍然如实回报，而不是假装成功。
    return { ok: false, job: stored, created: true, issue: `这条演示任务还缺必填项：${missing.join('、')}。`, notice: '' };
  }
  return {
    ok: true,
    job: stored,
    created: true,
    issue: '',
    notice: `已提交演示任务（${videoJobStatusLabel(stored.status)}${stored.queuePosition ? ` · 队列第 ${stored.queuePosition} 位` : ''}）：${VIDEO_JOB_DEMO_LABEL}，进度由本机推演。`
  };
}

/** 取消（`queued` / `rendering` 才允许；被拒时什么都不改）。 */
export function cancelVideoJob(jobKey, { now = Date.now() } = {}) {
  const job = getVideoJob(jobKey);
  if (!job) return { ok: false, job: null, issue: '没有这条任务。', notice: '' };
  const issue = videoJobActionIssue(job, 'cancel');
  if (issue) return { ok: false, job, issue, notice: '' };
  const stamp = stampOf(now);
  const next = normalizeVideoJob({
    ...job,
    status: VIDEO_JOB_STATUSES.canceled,
    error: '',
    errorCode: '',
    finishedAt: stamp,
    updatedAt: stamp,
    queuePosition: 0
  });
  commit(applyVideoJob(memoryJobs, next));
  // 取消释放了一个渲染位：立刻推进一次（排队的下一条补位），还有活就继续起表。
  advanceVideoJobQueue({ now });
  startVideoJobQueue();
  return { ok: true, job: getVideoJob(jobKey) || next, issue: '', notice: '已取消这条演示任务：队列位次已释放，随时可以重试。' };
}

/** 重试（`failed` / `canceled` 才允许；沿用同一个 jobKey，attempts 不清零）。 */
export function retryVideoJob(jobKey, { now = Date.now() } = {}) {
  const job = getVideoJob(jobKey);
  if (!job) return { ok: false, job: null, issue: '没有这条任务。', notice: '' };
  const issue = videoJobActionIssue(job, 'retry');
  if (issue) return { ok: false, job, issue, notice: '' };
  const stamp = stampOf(now);
  const next = normalizeVideoJob({
    ...job,
    status: VIDEO_JOB_STATUSES.queued,
    progress: 0,
    error: '',
    errorCode: '',
    startedAt: '',
    finishedAt: '',
    updatedAt: stamp,
    queuePosition: job.queuePosition || 1
  });
  commit(applyVideoJob(memoryJobs, next));
  startVideoJobQueue();
  advanceVideoJobQueue({ now });
  const stored = getVideoJob(jobKey) || next;
  const view = videoJobQueueView([stored]).jobs[0];
  return { ok: true, job: stored, issue: '', notice: `已重新排队：沿用同一个 jobKey，${view ? view.attemptsLabel : ''}${stored.queuePosition ? ` · 队列第 ${stored.queuePosition} 位` : ''}。` };
}

/**
 * 记录一条**处置结果**（[第四步 US-221] / FR-300）：成片记录里的曲目授权到期后，老师选择
 * 「更换音乐」或「静音」时把这次处置写在 `specSnapshot.music.disposition` 上。
 * 曲目 id 与授权凭证快照**一个字节都不动** —— 处置是「之后怎么办」，不是改写历史证据。
 * 任务还不存在（没提交过）时如实返回 `ok:false`，不假装记下了。
 */
export function recordVideoJobMusicDisposition(jobKey, disposition, { now = Date.now() } = {}) {
  const key = String(jobKey ?? '').trim();
  const job = getVideoJob(key);
  if (!job) return { ok: false, job: null, issue: '这条任务还不存在：提交过任务之后才有成片记录可记处置。', notice: '' };
  const current = normalizeMusicJobMusic(job.specSnapshot?.music);
  if (!current) return { ok: false, job, issue: '这条任务还没有音乐记录（老任务）：没有到期的曲目需要处置。', notice: '' };
  const stamp = stampOf(now);
  const next = normalizeVideoJob({
    ...job,
    specSnapshot: { ...job.specSnapshot, music: normalizeMusicJobMusic({ ...current, disposition }) },
    updatedAt: stamp
  });
  commit(applyVideoJob(memoryJobs, next));
  const record = normalizeMusicJobMusic(next.specSnapshot?.music);
  return {
    ok: true,
    job: getVideoJob(key) || next,
    issue: '',
    notice: `已记录处置结果：${record?.disposition?.actionLabel || '处置'}（写入成片记录的音乐快照）。`
  };
}

/** 清空演示队列（本机镜像一起清）—— 验证脚本与「想重新开始」时用。 */
export function clearVideoJobs() {
  stopVideoJobQueue();
  commit([], { persist: true });
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(VIDEO_JOB_STORAGE_KEY);
    } catch {
      /* 配额 / 隐私模式：内存里已经清了。 */
    }
  }
  return listVideoJobs();
}
