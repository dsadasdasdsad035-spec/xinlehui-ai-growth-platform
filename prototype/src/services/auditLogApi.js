import { cloud, unwrap } from '../cloud';
import { AUDIT_ENTRY_FIELDS, normalizeAuditEntry } from '../data/auditLog';

// 审计日志的云端读写（[第二步 US-013]）。
// 与装裱模板同一套共享工作区模型：一所机构一份账，按 `entry_key` 幂等写入。
// 云端 `audit_logs` 表还没有建立时，写入会被 PostgREST 拒掉 —— 调用方按
// 「已记到本机镜像」处理（`data/auditLog.js` 的 `loadAuditLog` / `persistAuditLog`），
// 与 `mergeRemoteFramingPresets` 那条口径一致：本机镜像优先，云端只补本机没有的条目。
const TABLE = 'audit_logs';

function rowToEntry(row) {
  const source = row && typeof row === 'object' ? row : {};
  const payload = source.payload && typeof source.payload === 'object' ? source.payload : {};
  return normalizeAuditEntry({
    ...payload,
    id: source.entry_key || payload.id,
    action: source.action || payload.action,
    actorId: source.actor_id || payload.actorId,
    studentId: source.student_id || payload.studentId,
    templateId: source.template_id || payload.templateId,
    at: source.at || payload.at
  });
}

function entryToRow(entry) {
  const item = normalizeAuditEntry(entry);
  if (!item) throw new Error('审计条目为空，未写入云端。');
  // snake_case 列只放检索用的几个键，整条按白名单进 payload（`AUDIT_ENTRY_FIELDS`）。
  const payload = {};
  AUDIT_ENTRY_FIELDS.forEach(key => { payload[key] = item[key]; });
  return {
    entry_key: String(item.id),
    action: item.action,
    actor_id: item.actorId,
    student_id: item.studentId,
    template_id: item.templateId,
    at: item.at,
    payload
  };
}

export async function loadRemoteAuditLog() {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  return (rows || []).map(rowToEntry).filter(Boolean);
}

export async function appendRemoteAuditEntry(entry) {
  unwrap(await cloud.database.from(TABLE).upsert(entryToRow(entry), { onConflict: 'entry_key' }));
  return entry;
}
