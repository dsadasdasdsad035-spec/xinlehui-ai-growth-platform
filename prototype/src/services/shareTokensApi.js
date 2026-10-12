import { cloud, unwrap } from '../cloud';
import { SHARE_TOKEN_FIELDS, normalizeShareTokenRecord } from '../data/shareTokens';

// 家长分享令牌的云端读写（[第四步 US-208a] / F-ARCHIVE-SHARE-01）。
// 与审计日志 / 阶段报告同一套共享工作区模型：一所机构一份账，按 `token_key`（就是令牌本体，
// 天然唯一且不可猜测）幂等写入 —— 撤回是**就地改那一行**（补 `revoked_at`），不是插新行。
//
// 云端 `share_tokens` 表还没建立时写入会被 PostgREST 拒掉（DATABASE_PGRST204 的老坑），
// 调用方按「已保存到本机镜像」处理：`data/shareTokens.js` 的 `loadShareTokens` / `persistShareTokens`
// 先落本机镜像，这里只负责把它推上云（失败不抛给界面，如实标注即可）。
const TABLE = 'share_tokens';

/** 行 → 应用对象：snake_case 只在这里出现（业务代码永远不碰 snake_case）。 */
export function rowToShareToken(row) {
  const source = row && typeof row === 'object' ? row : {};
  const payload = source.payload && typeof source.payload === 'object' ? source.payload : {};
  return normalizeShareTokenRecord({
    ...payload,
    token: source.token_key || payload.token,
    recordId: source.record_id || payload.recordId,
    student: source.student || payload.student,
    studentId: source.student_id || payload.studentId,
    createdAt: source.created_at || payload.createdAt,
    expiresAt: source.expires_at || payload.expiresAt,
    revokedAt: source.revoked_at || payload.revokedAt
  });
}

/**
 * 应用对象 → 行：检索用的几列独立成列，整条按白名单进 `payload`
 * （与 `auditLogApi` / `archiveReportsApi` 同一套写法，新字段只加进白名单、不动云表结构）。
 */
export function shareTokenToRow(record) {
  const item = normalizeShareTokenRecord(record);
  if (!item) throw new Error('分享令牌为空，未写入云端。');
  const payload = {};
  SHARE_TOKEN_FIELDS.forEach(key => { payload[key] = item[key]; });
  return {
    token_key: item.token,
    record_id: item.recordId,
    student: item.student,
    student_id: item.studentId,
    created_at: item.createdAt,
    expires_at: item.expiresAt,
    revoked_at: item.revokedAt,
    payload
  };
}

export async function loadRemoteShareTokens() {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  return (rows || []).map(rowToShareToken).filter(Boolean);
}

/** 幂等 upsert：同 `token_key` 覆盖那一行（生成与撤回走同一条写入路径）。 */
export async function saveRemoteShareToken(record) {
  const row = shareTokenToRow(record);
  unwrap(await cloud.database.from(TABLE).upsert(row, { onConflict: 'token_key' }));
  return normalizeShareTokenRecord(record);
}

/**
 * 撤回的云端写入：同一行补上 `revoked_at` / `revoked_by`（本机镜像已经改过，这里只负责推上去）。
 * 记录没有 `revokedAt` 时直接返回 null —— 不会把一条「还没撤回」的记录写云端。
 */
export async function revokeRemoteShareToken(record) {
  const item = normalizeShareTokenRecord(record);
  if (!item || !item.revokedAt) return null;
  return saveRemoteShareToken(item);
}
