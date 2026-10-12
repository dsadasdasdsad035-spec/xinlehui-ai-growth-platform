import { cloud, unwrap } from '../cloud';
import { VIDEO_RECORD_FIELDS, normalizeVideoRecord } from '../data/videoRecords';

// 成片记录的云端读写（[第四步 US-222] / FR-301）。
// 与阶段报告同一套共享工作区模型：一所机构一份账，按 `video_key` 幂等写入
// （同一个「对象 + 周期 + 类型」永远只有一行 —— 重新生成是**就地改那一行**，不是插新行，
//  历史版本留在 `payload.history` 里）。
//
// 云端 `video_records` 表还没建立时，写入会被 PostgREST 拒掉（DATABASE_PGRST204 的老坑），
// 调用方按「已保存到本机镜像」处理 —— 与审计日志 / 装裱模板 / 阶段报告同一套兜底口径：
// `data/videoRecords.js` 的 `loadVideoRecords` / `persistVideoRecords` 先落本机镜像，
// 这里只负责把它推上云（失败不抛给界面，由调用方如实标注）。
const TABLE = 'video_records';

/** 行 → 应用对象：snake_case 只在这里出现（业务代码永远不碰 snake_case）。 */
export function rowToVideoRecord(row) {
  const source = row && typeof row === 'object' ? row : {};
  const payload = source.payload && typeof source.payload === 'object' ? source.payload : {};
  return normalizeVideoRecord({
    ...payload,
    id: source.record_id || payload.id,
    videoKey: source.video_key || payload.videoKey,
    version: source.version || payload.version,
    generatedBy: source.generated_by || payload.generatedBy,
    generatedAt: source.generated_at || payload.generatedAt
  });
}

/**
 * 应用对象 → 行：检索用的几列独立成列，整条按白名单进 `payload`
 * —— 与 `archiveReportsApi` 同一套写法，新字段只加进白名单、不动云表结构。
 */
export function videoRecordToRow(record) {
  const item = normalizeVideoRecord(record);
  if (!item) throw new Error('成片记录为空，未写入云端。');
  const payload = {};
  VIDEO_RECORD_FIELDS.forEach(key => { payload[key] = item[key]; });
  return {
    video_key: item.videoKey,
    record_id: item.id,
    version: item.version,
    generated_by: item.generatedBy,
    generated_at: item.generatedAt,
    payload
  };
}

export async function loadRemoteVideoRecords() {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  return (rows || []).map(rowToVideoRecord).filter(Boolean);
}

/** 幂等 upsert：同 `video_key` 覆盖那一行（重新生成 = 就地改，云端不会多出孤儿行）。 */
export async function saveRemoteVideoRecord(record) {
  const row = videoRecordToRow(record);
  unwrap(await cloud.database.from(TABLE).upsert(row, { onConflict: 'video_key' }));
  return record;
}

export async function deleteRemoteVideoRecord(videoKey) {
  const key = String(videoKey || '').trim();
  if (!key) throw new Error('缺少 videoKey，未从云端删除。');
  unwrap(await cloud.database.from(TABLE).delete().eq('video_key', key));
  return key;
}
