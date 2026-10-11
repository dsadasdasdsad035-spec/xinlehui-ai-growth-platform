import { cloud, unwrap } from '../cloud';
import { REVIEW_TRACE_FIELDS, normalizeReviewTrace, sanitizeReviewTrace } from '../data/reviewTrace';
import { CHILD_MEDIA_API_BASE } from '../data/mediaStoragePolicy';

// 点评推理轨迹的云端读写（[第三步 US-102]）。
//
// 与审计日志（`services/auditLogApi.js`）同一套共享工作区模型：一所机构一份账，按
// `trace_key` 幂等写入；云端 `review_traces` 表还没建立时，写入会被 PostgREST 拒掉 ——
// 调用方按「已留档到本机」处理（本机镜像在 `data/reviewTrace.js` 的
// `loadReviewTraces` / `persistReviewTrace`）。
//
// **只在归档时调用**：生成期轨迹只驻留内存（US-102 的隐私口径），
// 老师没归档就刷新页面，轨迹随之消失 —— 这是有意为之，不是丢数据。
const TABLE = 'review_traces';

function rowToTrace(row) {
  const source = row && typeof row === 'object' ? row : {};
  const payload = source.payload && typeof source.payload === 'object' ? source.payload : {};
  return normalizeReviewTrace({
    ...payload,
    traceId: source.trace_key || payload.traceId,
    task: source.task || payload.task,
    studentId: source.student_id || payload.studentId,
    studentName: source.student_name || payload.studentName,
    lessonId: source.lesson_id || payload.lessonId,
    teacherId: source.teacher_id || payload.teacherId,
    teacherName: source.teacher_name || payload.teacherName,
    orgId: source.org_id || payload.orgId,
    model: source.model || payload.model,
    status: source.status || payload.status,
    createdAt: source.created_at || payload.createdAt
  });
}

function traceToRow(trace) {
  // 落库前复核一次隐私口径：混进素材正文的字段一律清掉（`sanitizeReviewTrace`），
  // 清不掉（整条认不出）就不写 —— 宁可少一条留档，也不把孩子的画面写进云表。
  const { trace: safe } = sanitizeReviewTrace(trace);
  const item = normalizeReviewTrace(safe);
  if (!item) throw new Error('点评轨迹为空，未写入云端。');
  const payload = {};
  REVIEW_TRACE_FIELDS.forEach(key => { payload[key] = item[key]; });
  return {
    // snake_case 列只放检索用的几个键（US-112 要按学员 / 老师 / 模型 / 时间 / 状态筛），
    // 整条按白名单进 payload。
    trace_key: String(item.traceId),
    task: item.task,
    student_id: item.studentId,
    student_name: item.studentName,
    lesson_id: item.lessonId,
    teacher_id: item.teacherId,
    teacher_name: item.teacherName,
    org_id: item.orgId,
    model: item.model,
    status: item.status,
    created_at: item.createdAt,
    payload
  };
}

export async function loadRemoteReviewTraces() {
  const rows = unwrap(await cloud.database.from(TABLE).select('*').order('created_at', { ascending: false }));
  return (rows || []).map(rowToTrace).filter(Boolean);
}

/** 提交一条轨迹（归档那一刻调用；云端不通时抛错，由调用方按「已留档到本机」处理）。 */
export async function saveRemoteReviewTrace(trace) {
  const row = traceToRow(trace);
  unwrap(await cloud.database.from(TABLE).upsert(row, { onConflict: 'trace_key' }));
  return normalizeReviewTrace(row.payload);
}

// ---------------------------------------------------------------------------
// 开发适配器上的轨迹查询通道（[第三步 US-112] / FR-114）
//
// 「家长会话查询轨迹时**服务端直接拒绝**」这条验收必须落在服务端，而不是界面上的一个 `if`：
// 查询走 `GET /api/review-traces`，服务端按 `X-Actor-Role`（以及随请求带上的家长会话令牌）
// 判定来者身份 —— 家长一律 403。本模块只负责带上身份、把拒绝如实回报：
// 被拒时**不重试、不换成别的通道**，`denied: true` 让界面明说「当前身份不能查询轨迹」。
// 开发适配器没启动时（`pnpm run dev` 默认不起它）如实回报「未连接」，界面回落本机镜像。
// ---------------------------------------------------------------------------

/** 轨迹查询被服务端拒绝（家长会话 / 身份不足）时抛的错（带状态码与原因）。 */
export class ReviewTraceAccessError extends Error {
  constructor(message, { status = 403, code = 'review-trace-forbidden' } = {}) {
    super(message);
    this.name = 'ReviewTraceAccessError';
    this.status = status;
    this.code = code;
  }
}

/** 查询头：角色 + （家长会话时的）令牌。缺身份 / 家长身份在本地就拦掉（服务端还会再拦一次）。 */
export function reviewTraceQueryHeaders({ role = 'admin', parentToken = '', actorId = '', extra = {} } = {}) {
  const who = String(role || '').trim();
  if (!who) throw new ReviewTraceAccessError('查询点评轨迹需要老师或管理员身份。', { status: 401, code: 'review-trace-identity' });
  if (who === 'parent') throw new ReviewTraceAccessError('家长会话不能查询点评轨迹。', { status: 403, code: 'review-trace-parent' });
  return {
    'X-Actor-Role': who,
    // 老师的身份串：服务端据此只返回本人经手的轨迹（管理员不需要）。
    // HTTP 头只能安全承载 ASCII，中文身份串（原型里的老师身份就是姓名）先百分号编码，
    // 服务端按同一口径解码 —— 否则「林晓老师」会在头里变成乱码，本人也查不到自己的轨迹。
    ...(actorId ? { 'X-Actor-Id': encodeURIComponent(String(actorId)) } : {}),
    ...(parentToken ? { Authorization: `Bearer ${parentToken}` } : {}),
    ...extra
  };
}

/** 查询串：只带非空的筛选维度（服务端与界面读同一组字段名）。 */
export function reviewTraceQueryString(filters = {}) {
  const params = new URLSearchParams();
  ['student', 'teacher', 'model', 'status', 'from', 'to'].forEach((key) => {
    const value = String(filters?.[key] ?? '').trim();
    if (value) params.set(key, value);
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * 向服务端查询轨迹（带身份，服务端把关）。
 * **永不抛错**：返回 `{ ok, denied, status, message, traces }` ——
 * 家长被拒时 `denied: true`（界面据此说明「服务端直接拒绝」），连不上时 `ok: false`（回落本机镜像）。
 */
export async function queryRemoteReviewTraces(filters = {}, { role = 'admin', parentToken = '', actorId = '', baseUrl = CHILD_MEDIA_API_BASE, timeoutMs = 2500 } = {}) {
  let headers = {};
  try {
    headers = reviewTraceQueryHeaders({ role, parentToken, actorId });
  } catch (error) {
    return { ok: false, denied: true, status: error.status || 403, message: error.message, traces: [], headers: {}, audience: '' };
  }
  if (typeof fetch !== 'function') {
    return { ok: false, denied: false, status: 0, message: '当前环境没有 fetch，无法查询服务端轨迹。', traces: [], headers, audience: '' };
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${baseUrl}/api/review-traces${reviewTraceQueryString(filters)}`, { headers, signal: controller ? controller.signal : undefined });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 403 || response.status === 401) {
      return { ok: false, denied: true, status: response.status, message: payload.error || '当前身份不能查询点评轨迹。', traces: [], headers, audience: '' };
    }
    if (!response.ok) {
      return { ok: false, denied: false, status: response.status, message: payload.error || '服务端暂时无法返回轨迹。', traces: [], headers, audience: '' };
    }
    return {
      ok: true,
      denied: false,
      status: response.status,
      message: '',
      traces: (payload.traces || []).map(rowToTrace).filter(Boolean),
      audience: String(payload.audience || ''),
      headers
    };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? '查询超时' : (error?.message || '连接失败');
    return { ok: false, denied: false, status: 0, message: `开发适配器未连接（${reason}）：先用本机镜像展示。`, traces: [], headers, audience: '' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 把一条已归档的轨迹推到开发适配器（best-effort：适配器没起就只落本机镜像与云端表）。
 * 与服务端同一套隐私口径：先过 `sanitizeReviewTrace`，服务端还会再复核一次（含素材正文一律拒收）。
 */
export async function pushRemoteReviewTrace(trace, { role = 'teacher', baseUrl = CHILD_MEDIA_API_BASE, timeoutMs = 2500 } = {}) {
  let headers = {};
  try {
    headers = reviewTraceQueryHeaders({ role, extra: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return { ok: false, denied: true, status: error.status || 403, message: error.message };
  }
  if (typeof fetch !== 'function') return { ok: false, denied: false, status: 0, message: '当前环境没有 fetch，未推送服务端轨迹。' };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${baseUrl}/api/review-traces`, { method: 'POST', headers, body: JSON.stringify(traceToRow(trace)) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, denied: response.status === 403, status: response.status, message: payload.error || '服务端未接受这条轨迹。' };
    return { ok: true, denied: false, status: response.status, message: '', traceKey: String(payload.traceKey || '') };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? '推送超时' : (error?.message || '连接失败');
    return { ok: false, denied: false, status: 0, message: `开发适配器未连接（${reason}）。` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
