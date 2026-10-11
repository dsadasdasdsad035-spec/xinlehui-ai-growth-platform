// agent.md 与记忆文件的云端读写（[第三步 US-106a] / F-REVIEW-PROMPT-02）。
//
// 与其它实体同一套共享工作区模型：`file_key` 做幂等 upsert 的冲突键（= 应用内的 `id`）。
// 云端 `agent_files` 表还没建立、或表里缺 `versions` / `history` / `updated_by` 列时，
// 写入会被 PostgREST 拒掉 —— 那**只影响跨设备可见**：本机镜像照样成立
// （`persistAgentFiles` 由页面侧统一落盘），所以写接口的失败交给调用方提示即可。
// 读取的合并方向见 `data/agentFileAdmin.js` 的 `mergeAgentFiles`：**本机镜像优先**。

import { cloud, unwrap } from '../cloud';
import { normalizeAgentFile } from '../data/agentFiles';

const TABLE = 'agent_files';

function rowToAgentFile(row) {
  return normalizeAgentFile({
    id: row.file_key,
    kind: row.kind,
    scope: row.scope,
    scopeRef: row.scope_ref,
    name: row.name,
    version: row.version,
    enabled: row.enabled !== false,
    sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 90,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    content: row.content,
    versions: row.versions,
    history: row.history
  });
}

function agentFileToRow(file) {
  const record = normalizeAgentFile(file);
  return {
    file_key: String(record.id),
    kind: record.kind,
    scope: record.scope,
    scope_ref: record.scopeRef || '',
    name: record.name,
    version: record.version || '',
    enabled: record.enabled !== false,
    sort_order: Number.isFinite(record.sortOrder) ? record.sortOrder : 90,
    updated_at: record.updatedAt || '',
    updated_by: record.updatedBy || '',
    content: record.content || '',
    versions: record.versions,
    history: record.history
  };
}

export async function loadRemoteAgentFiles() {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  return rows.map(rowToAgentFile).filter((file) => file.id);
}

export async function saveRemoteAgentFile(file) {
  unwrap(await cloud.database.from(TABLE).upsert(agentFileToRow(file), { onConflict: 'file_key' }));
  return file;
}

export async function deleteRemoteAgentFile(id) {
  unwrap(await cloud.database.from(TABLE).delete().eq('file_key', String(id)));
  return id;
}
