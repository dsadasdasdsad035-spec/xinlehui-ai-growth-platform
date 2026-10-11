import { cloud, unwrap } from '../cloud';
import { REVIEW_TRACE_FIELDS, normalizeReviewTrace, sanitizeReviewTrace } from '../data/reviewTrace';

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
    lessonId: source.lesson_id || payload.lessonId,
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
    lesson_id: item.lessonId,
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
