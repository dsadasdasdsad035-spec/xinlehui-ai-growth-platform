/**
 * 视频渲染服务的**契约层**（[第四步 US-213b] / FR-254 ~ FR-263）。
 *
 * 这一层只做网络动作：拼 URL（路由表在 `data/videoJobs.js`）、发请求、按契约收口、抛可读错误。
 * **一条业务判据都不新增** —— 字段清单 / 状态枚举 / 成片三件套 / HTTP 状态的含义 / 文案
 * 全部读 `data/videoJobs.js`（零依赖纯函数，可 Node 直跑断言）。
 *
 * 四条纪律（本故事的验收原文）：
 *   ① `submitJob` / `getJob` / `cancelJob` / `retryJob` 是仅有的四个入口，**没有任何 mock 分支**
 *      —— 这里不许出现「服务不在就本地编一条」的兜底（那是 US-213a 演示队列的职责，
 *      它的标注是「演示数据 · 视频服务未接入」，与本层泾渭分明）；
 *   ② 服务端未接入（连不上 / 超时 / 404 / 405 / 501 / 502…）→ 抛 `VideoServiceError`，
 *      消息以「视频服务暂不可用」开头；
 *   ③ 响应必须过 `videoJobContractIssue`：缺 jobKey / 非法状态 / `done` 却没有成片地址·时长·体积，
 *      一律抛错。**任何路径都不得返回假成片、假时长、假封面**（封面 / 缩略图类字段整个不在白名单里）；
 *   ④ 本层只发 ids 与 spec（对象 / 周期 / 课次·作品·照片计数），**不发任何儿童素材**（FR-46 同一条口径）。
 *
 * 界面（US-214 起）拿 `isVideoServiceUnavailable(error)` 分流：可用 → 走真服务；
 * 不可用 → 如实告诉老师「视频服务暂不可用」，本机演示队列只作为**明确标注的演示**存在。
 *
 * 与 `services/reviewApi.js`（失败即抛）/ `services/archiveAccessApi.js`（巡检永不抛）的差别：
 * 这里的四个契约函数**必须抛错**——「提交/取消/重试」是老师的真实动作，静默失败会让老师以为在出片。
 * 只有 `probeVideoService` 走「永不抛错」的巡检口径（给界面一个真实读数，不拖垮页面）。
 */

import { CHILD_MEDIA_API_BASE } from './mediaStorage';
import {
  VIDEO_JOB_SERVICE_ROUTES,
  normalizeRemoteVideoJob,
  normalizeVideoJobType,
  videoJobContractIssue,
  videoJobKey,
  videoJobMissingText,
  videoJobServicePath,
  videoJobSpecSnapshot,
  videoJobSubmitIssue,
  videoServiceStatusVerdict,
  videoServiceUnavailableText
} from '../data/videoJobs';

export { CHILD_MEDIA_API_BASE };

/** 请求超时（毫秒）：渲染服务是网络服务，卡住要**尽快如实失败**，不挂着让老师干等。 */
export const VIDEO_API_TIMEOUT_MS = 2500;

/** 能力探测的超时（比契约调用短：探测只回答「在不在」，不该让页面等）。 */
export const VIDEO_API_PROBE_TIMEOUT_MS = 1200;

/**
 * 契约层的错误。`unavailable` 为 true = 「服务端未接入 / 不可达」那一类（消息以验收原文开头）；
 * 其余 code：`video-request-invalid`（请求本身不合法，没发出去）、
 * `video-service-rejected`（服务在，拒绝了这次请求）、`video-service-contract`（响应不符合契约）、
 * `video-job-missing`（服务端明确说没有这条任务）。
 */
export class VideoServiceError extends Error {
  constructor(message, { status = 0, code = 'video-service-unavailable', unavailable = false, cause = null } = {}) {
    super(message);
    this.name = 'VideoServiceError';
    this.status = status;
    this.code = code;
    this.unavailable = unavailable;
    if (cause) this.cause = cause;
  }
}

/** 界面用它分流：`true` → 「视频服务暂不可用」，按演示队列的口径如实标注。 */
export function isVideoServiceUnavailable(error) {
  return Boolean(error) && error.name === 'VideoServiceError' && error.unavailable === true;
}

const textOf = error => String((error && error.message) || error || '').trim();
const trimText = value => String(value ?? '').trim();
const trimBase = value => String(value ?? '').trim().replace(/\/+$/, '');

function unavailableError(detail, { status = 0, cause = null } = {}) {
  return new VideoServiceError(videoServiceUnavailableText(detail), { status, code: 'video-service-unavailable', unavailable: true, cause });
}

function invalidError(issue) {
  return new VideoServiceError(issue, { code: 'video-request-invalid' });
}

async function readJson(response) {
  if (!response || typeof response.json !== 'function') return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * 发一次契约请求（**唯一的出网口**）：路由表 → URL → fetch（带超时）→ 按 `videoServiceStatusVerdict`
 * 分流。返回 `{ status, payload, url }`；`payload` 可能是 null（响应体不是 JSON）。
 */
async function callVideoService({ route, jobKey = '', body = null, baseUrl = CHILD_MEDIA_API_BASE, timeoutMs = VIDEO_API_TIMEOUT_MS, fetchImpl = null } = {}) {
  const entry = VIDEO_JOB_SERVICE_ROUTES[trimText(route)];
  if (!entry) throw invalidError(`不认识的路由：${trimText(route) || '(空)'}。`);
  const path = videoJobServicePath(entry.id, jobKey);
  if (!path) throw invalidError(`这条请求缺少 jobKey（${entry.note}）。`);
  const url = `${trimBase(baseUrl)}${path}`;
  const impl = typeof fetchImpl === 'function' ? fetchImpl : (typeof fetch === 'function' ? fetch : null);
  if (!impl) throw unavailableError('当前环境没有 fetch，发不出请求');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller && Number(timeoutMs) > 0 ? setTimeout(() => controller.abort(), Number(timeoutMs)) : null;
  let response = null;
  try {
    response = await impl(url, {
      method: entry.method,
      headers: { 'Content-Type': 'application/json' },
      body: body === null ? undefined : JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    });
  } catch (error) {
    const aborted = Boolean(error) && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
    throw unavailableError(aborted ? `请求超时（${timeoutMs}ms 内没有响应）` : `连不上渲染服务：${textOf(error)}`, { cause: error });
  } finally {
    if (timer) clearTimeout(timer);
  }
  const status = Number(response && response.status) || 0;
  const payload = await readJson(response);
  const verdict = videoServiceStatusVerdict(status);
  if (verdict === 'unavailable') throw unavailableError(`服务端返回 ${status}（路由还没接或服务不可达）`, { status });
  if (verdict === 'rejected') {
    const reason = payload && typeof payload === 'object' ? trimText(payload.error || payload.message) : '';
    throw new VideoServiceError(`视频服务拒绝了这次请求（HTTP ${status}）：${reason || '服务端没有给出原因。'}`, { status, code: 'video-service-rejected' });
  }
  return { status, payload, url };
}

/**
 * 从响应体里取任务（**只有两个位置算数**）：任务对象本身就是响应体，或放在 `job` 键下；
 * `job: null` 是服务端明确回答「没有这条任务」（契约规定 404 只能是路由不存在，
 * 所以「没有这条任务」不能靠 404 表达）。取到的任务必须过 `videoJobContractIssue`，否则抛错。
 */
function readRemoteJob(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const candidate = source.job === undefined ? source : source.job;
  if (candidate === null) return null;
  const issue = videoJobContractIssue(candidate);
  if (issue) throw new VideoServiceError(`视频服务的响应不符合契约：${issue}`, { code: 'video-service-contract' });
  return normalizeRemoteVideoJob(candidate);
}

/**
 * 提交一条渲染任务，返回按契约归一化的任务（`status:'queued'` 起步）。
 *  - 缺对象 / 缺周期**不发请求**（`videoJobSubmitIssue` 是判据，与本地队列同一份）；
 *  - `jobKey` 在客户端由「类型 + 对象 + 周期」派生后随请求发出 → 服务端按它幂等；
 *  - 服务端未接入 → 抛「视频服务暂不可用」（**不会**回落到演示队列）。
 */
export async function submitJob({ type, studentId = '', classId = '', period = '', objectName = '', lessonCount = 0, artworkCount = 0, photoCount = 0, createdBy = '' } = {}, options = {}) {
  const issue = videoJobSubmitIssue({ type, studentId, classId, period });
  if (issue) throw invalidError(issue);
  const kind = normalizeVideoJobType(type);
  const student = trimText(studentId);
  const klass = trimText(classId);
  const jobKey = videoJobKey({ type: kind, studentId: student, classId: klass, period });
  const body = {
    jobKey,
    type: kind,
    studentId: kind === 'personal' ? student : '',
    classId: kind === 'class' ? klass : '',
    period: trimText(period),
    // 只带「这次任务指向什么」的快照（对象 / 周期 / 课次·作品·照片计数）：
    // 不带素材、不带成片属性（时长 / 精选 / 封面是服务端与 US-215 / US-216 的事）。
    specSnapshot: videoJobSpecSnapshot({ type: kind, objectName, studentId: student, classId: klass, period, lessonCount, artworkCount, photoCount, capturedAt: new Date().toISOString() }),
    createdBy: trimText(createdBy)
  };
  const { payload } = await callVideoService({ ...options, route: 'submit', body });
  const job = readRemoteJob(payload);
  if (!job) throw new VideoServiceError('视频服务没有返回任务对象：这次提交的结果无从确认。', { code: 'video-service-contract' });
  if (job.jobKey !== jobKey) {
    throw new VideoServiceError(`视频服务返回了另一条任务（jobKey=${job.jobKey}，提交的是 ${jobKey}）：幂等键对不上，不接受这次结果。`, { code: 'video-service-contract' });
  }
  return job;
}

/**
 * 查一条任务（按 `jobKey`）。返回归一化后的任务，或 **`null`**（服务端明确说没有这条 —— 与
 * `services/videoJobQueue.js` 的 `getVideoJob` 同口径）。任何失败（未接入 / 契约不符）都抛错。
 */
export async function getJob(jobKey, options = {}) {
  const key = trimText(jobKey);
  if (!key) throw invalidError('请给出要查的 jobKey。');
  const { payload } = await callVideoService({ ...options, route: 'job', jobKey: key });
  return readRemoteJob(payload);
}

/**
 * 取消 / 重试共用的一条路径（两个动作只有路由与文案不同）。
 * 服务端说「没有这条任务」时**抛错**而不是返回 null —— 取消一个不存在的任务不是成功。
 */
async function callJobAction(route, action, jobKey, options) {
  const key = trimText(jobKey);
  if (!key) throw invalidError(`请给出要${action}的 jobKey。`);
  const { payload } = await callVideoService({ ...options, route, jobKey: key, body: { jobKey: key } });
  const job = readRemoteJob(payload);
  if (!job) throw new VideoServiceError(videoJobMissingText(key, action), { status: 0, code: 'video-job-missing' });
  return job;
}

/** 取消一条任务（`queued` / `rendering` 才该有；能不能取消由服务端的状态机判）。 */
export async function cancelJob(jobKey, options = {}) {
  return callJobAction('cancel', '取消', jobKey, options);
}

/** 重试一条任务（沿用同一个 jobKey —— 幂等键不变，只是 attempts 自增）。 */
export async function retryJob(jobKey, options = {}) {
  return callJobAction('retry', '重试', jobKey, options);
}

/**
 * 能力探测（`GET /api/video/service`）：**永不抛错**，给界面一个真实读数 —— 渲染服务在不在。
 * 界面据此决定「走真服务」还是「如实标注本机演示队列」，**不许**用「探测不到就假装能提交」这种回退。
 * 返回 `{ ok, status, reachable, service, queue, message, checkedAt, baseUrl }`（各状态同形状）。
 */
export async function probeVideoService({ baseUrl = CHILD_MEDIA_API_BASE, timeoutMs = VIDEO_API_PROBE_TIMEOUT_MS, fetchImpl = null } = {}) {
  const checkedAt = new Date().toISOString();
  try {
    const { status, payload } = await callVideoService({ route: 'capability', baseUrl, timeoutMs, fetchImpl });
    const source = payload && typeof payload === 'object' ? payload : {};
    const queue = source.queue && typeof source.queue === 'object' ? source.queue : null;
    if (source.ok === false) {
      const reason = trimText(source.error || source.message);
      return { ok: false, status, reachable: true, service: trimText(source.service), queue, message: reason || '渲染服务声明自己暂时不可用。', checkedAt, baseUrl };
    }
    return { ok: true, status, reachable: true, service: trimText(source.service), queue, message: '', checkedAt, baseUrl };
  } catch (error) {
    return { ok: false, status: Number(error && error.status) || 0, reachable: false, service: '', queue: null, message: textOf(error), checkedAt, baseUrl };
  }
}
