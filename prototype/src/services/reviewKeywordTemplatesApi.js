// 观察词模板的云端读写（[第三步 US-109] / F-REVIEW-KW-01）。
//
// 与其它实体同一套共享工作区模型：`template_key` 做幂等 upsert 的冲突键（= 应用内的 `templateKey`）。
// 云端 `review_keyword_templates` 表还没建出来，带新列的写入会被 PostgREST 整条拒掉
// （与 `framing_presets` / `agent_files` / `review_traces` 一样）—— 那**只影响跨设备可见**：
// 本机镜像照样成立（`data/reviewKeywordTemplates.js` 的 `persistReviewKeywordTemplates` 由页面侧统一落盘）。
// 读取的合并方向见 `mergeReviewKeywordTemplates`：**本机镜像优先**。
//
// 首次上线（本机镜像还是空的）：把平台默认模板 v1 推一次云端（幂等 upsert，重复推不会产生新记录），
// 表不存在时抛错，由调用方 `.catch(()=>{})` 吞掉 —— 老师端一个字都不用等它。

import { cloud, unwrap } from '../cloud';
import { normalizeKeywordTemplate } from '../data/reviewKeywordTemplates';

const TABLE = 'review_keyword_templates';

function rowToKeywordTemplate(row) {
  const source = row && typeof row === 'object' ? row : {};
  return normalizeKeywordTemplate({
    templateKey: source.template_key || source.templateKey,
    name: source.name,
    mode: source.mode,
    courseTypes: source.course_types,
    ageRange: source.age_range,
    groups: source.groups,
    enabled: source.enabled !== false,
    isDefault: source.is_default,
    version: source.version,
    sortOrder: source.sort_order,
    orgId: source.org_id,
    updatedBy: source.updated_by,
    updatedAt: source.updated_at,
    versions: source.versions,
    history: source.history
  });
}

function keywordTemplateToRow(template) {
  const item = normalizeKeywordTemplate(template);
  return {
    template_key: item.templateKey,
    name: item.name,
    mode: item.mode,
    course_types: item.courseTypes,
    age_range: item.ageRange,
    // 分组（含词条）整体进 JSON 列：分组与词条的编辑在前端做数组操作后整体 upsert（PRD 9.3 的取舍）。
    groups: item.groups,
    enabled: item.enabled !== false,
    is_default: item.isDefault === true,
    version: item.templateVersion,
    sort_order: item.sortOrder,
    org_id: item.orgId,
    updated_by: item.updatedBy,
    updated_at: item.updatedAt,
    // 版本快照与变更历史（管理端 US-110 写入）：与 agent_files 同一口径 —— 云表还没建、
    // 或缺这两列时整条写入会被 PostgREST 拒掉，那只影响跨设备可见，本机镜像照样成立。
    versions: item.versions,
    history: item.history
  };
}

/**
 * 读模板列表（云端）。`viewer` 可传 `{ orgId }`：平台层（`org_id` 为空）全员可见，
 * 机构层只回本机构的。不传 = 读全量（管理端维护用）。
 * 表没建 / 不通时抛错，由调用方保留本机镜像。
 */
export async function loadRemoteReviewKeywordTemplates(viewer) {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  const list = (rows || []).map(rowToKeywordTemplate).filter((item) => item.templateKey);
  const orgId = viewer && typeof viewer === 'object' ? String(viewer.orgId || '').trim() : null;
  if (orgId === null) return list;
  return list.filter((item) => !item.orgId || item.orgId === orgId);
}

/** 写一套模板（管理端维护用；本故事的「首次上线导入」也走它）。 */
export async function saveRemoteReviewKeywordTemplate(template) {
  unwrap(await cloud.database.from(TABLE).upsert(keywordTemplateToRow(template), { onConflict: 'template_key' }));
  return template;
}

/** 删一套模板（按 templateKey；管理端维护用）。 */
export async function deleteRemoteReviewKeywordTemplate(templateKey) {
  unwrap(await cloud.database.from(TABLE).delete().eq('template_key', String(templateKey)));
  return String(templateKey);
}

/**
 * 首次上线的幂等导入：把平台默认模板 v1 推一次云端。
 * 已存在的记录不会被覆盖（`updated_at` / `updated_by` 由管理端维护），所以这里只推
 * 「本机镜像里没有 `updated_by` 的种子」——重复调用是空转，表不存在时抛错交给调用方吞掉。
 */
export async function importRemotePlatformKeywordTemplates(templates = []) {
  const imported = [];
  for (const template of templates) {
    const item = normalizeKeywordTemplate(template);
    if (!item.templateKey) continue;
    await saveRemoteReviewKeywordTemplate(item);
    imported.push(item.templateKey);
  }
  return imported;
}
