import { cloud, unwrap } from '../cloud';
import { normalizeReviewModel, normalizeReviewModelDefaults } from '../data/reviewModels';

// 点评模型目录与「老师的个人默认模型」的云端读写（[第三步 US-107a]）。
//
// 与审计日志 / 点评轨迹同一套共享工作区模型：一所机构一份配置。
//  - 模型目录走 `provider_models` 表（平台侧维护的模型池）；
//  - 个人默认走 `review_model_preferences` 表，按 `preference_key`（老师 id 或姓名）幂等 upsert。
//
// **两张表都还没有在云端建出来**：写入会被 PostgREST 拒掉（与 `audit_logs` / `review_traces` 一样），
// 因此现状是「本机镜像为准」——`data/reviewModels.js` 的 `loadReviewModels` /
// `loadReviewModelDefaults` 是读路径的兜底，本模块只负责「云端通了就用云端的」。
// 调用方一律 `.catch(()=>{})`：云端不可用时页面必须照常可用（原型阶段的既定口径）。
const MODEL_TABLE = 'provider_models';
const PREFERENCE_TABLE = 'review_model_preferences';

/** 云端行是 snake_case，应用内是 camelCase —— 转换只在这两个函数里做。 */
function rowToReviewModel(row) {
  const source = row && typeof row === 'object' ? row : {};
  return normalizeReviewModel({
    id: source.model_key || source.id,
    name: source.name,
    provider: source.provider,
    version: source.version,
    capabilities: source.capabilities,
    visionEnabled: source.vision_enabled,
    reviewEnabled: source.review_enabled,
    orgId: source.org_id,
    health: source.health,
    healthNote: source.health_note,
    p95Ms: source.p95_ms,
    p95Samples: source.p95_samples,
    quotaRemaining: source.quota_remaining,
    quotaTotal: source.quota_total,
    poolPriority: source.pool_priority,
    sortOrder: source.sort_order
  });
}

function reviewModelToRow(model) {
  const item = normalizeReviewModel(model);
  return {
    model_key: item.id,
    name: item.name,
    provider: item.provider,
    version: item.version,
    capabilities: item.capabilities,
    vision_enabled: item.visionEnabled,
    review_enabled: item.reviewEnabled,
    org_id: item.orgId,
    health: item.health,
    health_note: item.healthNote,
    p95_ms: item.p95Ms,
    p95_samples: item.p95Samples,
    quota_remaining: item.quotaRemaining,
    quota_total: item.quotaTotal,
    pool_priority: item.poolPriority,
    sort_order: item.sortOrder
  };
}

/** 读模型目录（云端）；表没建 / 不通时抛错，由调用方保留本机镜像。 */
export async function loadRemoteReviewModels() {
  const rows = unwrap(await cloud.database.from(MODEL_TABLE).select('*'));
  return (rows || []).map(rowToReviewModel).filter((item) => item.id);
}

/** 写一个模型（管理端维护模型池用；本故事只读也不影响）。 */
export async function saveRemoteReviewModel(model) {
  const row = reviewModelToRow(model);
  unwrap(await cloud.database.from(MODEL_TABLE).upsert(row, { onConflict: 'model_key' }));
  return normalizeReviewModel(row);
}

/** 读全部老师的个人默认模型（一份 map：老师键 → 模型 id，'' = 由模型池自动路由）。 */
export async function loadRemoteReviewModelDefaults() {
  const rows = unwrap(await cloud.database.from(PREFERENCE_TABLE).select('*'));
  const raw = {};
  (rows || []).forEach((row) => {
    const key = String(row?.preference_key || '').trim();
    if (key) raw[key] = row?.model_key || '';
  });
  return normalizeReviewModelDefaults(raw);
}

/** 写一位老师的个人默认模型（`modelId` 传空串 = 由模型池自动路由）。 */
export async function saveRemoteReviewModelDefault({ teacherKey = '', modelId = '' } = {}) {
  const key = String(teacherKey || '').trim();
  if (!key) throw new Error('缺少老师标识，未写入云端。');
  const row = { preference_key: key, model_key: String(modelId || ''), updated_at: new Date().toISOString() };
  unwrap(await cloud.database.from(PREFERENCE_TABLE).upsert(row, { onConflict: 'preference_key' }));
  return row;
}
