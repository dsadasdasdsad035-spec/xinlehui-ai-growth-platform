import { cloud, unwrap } from '../cloud';
import {
  MUSIC_TRACK_FIELDS,
  createNewMusicTrack,
  loadMusicTracks,
  mergeMusicTracks,
  musicTrackTimestamp,
  normalizeMusicTrack,
  persistMusicTracks,
  removeMusicTrack,
  sortMusicTracks
} from '../data/musicTracks';

// 音乐库（`music_tracks`）的云端读写（[第四步 US-220a] / F-ARCHIVE-MUSIC-01）。
//
// 与其它表同一套「一所机构共享一份工作区」模型，`track_key` 做幂等键。
// 本地 localStorage 只是兜底：云端 `music_tracks` 表还没建立时写入会被 PostgREST 拒掉
// （DATABASE_PGRST204 的老坑），但那不代表后台刚入库的曲子可以丢 —— 每一次写入都
// **先落本机镜像再推云端**（`mirrorMusicTrackLocally`），云端失败时调用方按
// 「已保存到本机」提示即可（与课程库 / 装裱模板同一套兜底口径）。
//
// 三条纪律：
//  ① 新建入库只能是 `pending`（`createNewMusicTrack` 是唯一入口，FR-293）；
//  ② 云端行是 snake_case，映射只在本文件的 rowTo / toRow 里做，业务代码不碰 snake_case；
//  ③ 引「被多少成片引用过」是纯读取（data 层的 `musicTrackUsage`），这里不碰成片表。
const TABLE = 'music_tracks';

/** 行 → 应用对象：snake_case 只在这里出现。 */
export function rowToMusicTrack(row) {
  const source = row && typeof row === 'object' ? row : {};
  const payload = source.payload && typeof source.payload === 'object' ? source.payload : {};
  // 整条 payload 优先，检索列兜底（与 auditLogApi / shareTokensApi 同一套写法）。
  return normalizeMusicTrack({
    ...payload,
    trackKey: source.track_key || payload.trackKey,
    orgId: source.org_id || payload.orgId,
    title: source.title || payload.title,
    artist: source.artist || payload.artist,
    sourceUrl: source.source_url || payload.sourceUrl,
    sourceProvider: source.source_provider || payload.sourceProvider,
    licenseStatus: source.license_status || payload.licenseStatus,
    licenseExpiresAt: source.license_expires_at || payload.licenseExpiresAt,
    commercialUse: source.commercial_use ?? payload.commercialUse,
    hash: source.hash || payload.hash,
    enabled: source.enabled === undefined ? payload.enabled : source.enabled,
    timestamps: {
      createdAt: source.created_at || payload?.timestamps?.createdAt,
      updatedAt: source.updated_at || payload?.timestamps?.updatedAt
    }
  });
}

/**
 * 应用对象 → 行：`track_key` / 授权状态几列独立成列（查询与人工核对都要用），
 * 整条按 `MUSIC_TRACK_FIELDS` 白名单进 `payload`（与审计日志同一套写法：新字段只加白名单、不动云表结构）。
 */
export function musicTrackToRow(track) {
  const item = normalizeMusicTrack(track);
  if (!item.trackKey) throw new Error('曲目缺少 trackKey，未写入云端。');
  const payload = {};
  MUSIC_TRACK_FIELDS.forEach(key => { payload[key] = item[key]; });
  return {
    track_key: item.trackKey,
    org_id: item.orgId,
    title: item.title,
    artist: item.artist,
    source_url: item.sourceUrl,
    source_provider: item.sourceProvider,
    license_status: item.licenseStatus,
    license_expires_at: item.licenseExpiresAt,
    commercial_use: item.commercialUse === true,
    hash: item.hash,
    enabled: item.enabled !== false,
    created_at: musicTrackTimestamp(item, 'createdAt') || new Date().toISOString(),
    updated_at: musicTrackTimestamp(item, 'updatedAt') || new Date().toISOString(),
    payload
  };
}

/** 把一条曲目并进本机镜像（同 trackKey 覆盖）；云端写失败时它就是唯一副本。 */
export function mirrorMusicTrackLocally(track) {
  const next = mergeMusicTracks([normalizeMusicTrack(track)], loadMusicTracks());
  persistMusicTracks(next);
  return next;
}

/** 云端读全部（含停用与待确认的 —— 授权状态是管理端要维护的东西，不在这里过滤）。 */
export async function loadRemoteMusicTracks() {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  return sortMusicTracks((rows || []).map(rowToMusicTrack));
}

/**
 * 读取曲库：云端是真源口径的「补齐」，**本机镜像优先**（合并方向见 mergeMusicTracks 的入参顺序）。
 * 与装裱模板 / agent 文件同一处境：云表还没建或写入被拒时，本地改动才是最新的，
 * 云端只负责补进本机没有的 trackKey；云端不可用时回落本机镜像，不把列表清空。
 */
export async function loadAllMusicTracks() {
  try {
    const remote = await loadRemoteMusicTracks();
    if (remote.length) return mergeMusicTracks(loadMusicTracks(), remote);
  } catch { /* 断网 / 云表未建立，走本机镜像 */ }
  return loadMusicTracks();
}

/**
 * 保存一条曲目：先落本机镜像，再推云端。
 * 云端失败时**抛出**（调用方据此提示「已保存到本机」）—— 本机镜像此时已经写过了，数据不丢。
 */
export async function saveMusicTrack(track) {
  const normalized = normalizeMusicTrack(track);
  if (!normalized.trackKey) throw new Error('曲目缺少 trackKey，未保存。');
  // 同一份（含新 updatedAt）既进镜像也进云端：两边的 updatedAt 必须是同一个值。
  const stamped = normalizeMusicTrack({
    ...normalized,
    timestamps: { ...normalized.timestamps, updatedAt: new Date().toISOString() }
  });
  mirrorMusicTrackLocally(stamped);
  unwrap(await cloud.database.from(TABLE).upsert(musicTrackToRow(stamped), { onConflict: 'track_key' }));
  return stamped;
}

/** 新建入库（唯一入口）：授权状态由 data 层强制成 `pending`，调用方传不进来别的值。 */
export async function createMusicTrack(input) {
  // saveMusicTrack 已经先写过本机镜像，失败时把错误原样抛给界面（由它提示「已保存到本机」）。
  return saveMusicTrack(createNewMusicTrack(input));
}

/** 更新元数据 / 授权状态 / 启停：`patch` 覆盖在现有曲目上（trackKey 与 createdAt 不变）。 */
export async function updateMusicTrack(trackKey, patch, { existingTracks } = {}) {
  const key = String(trackKey || '').trim();
  const list = sortMusicTracks(existingTracks || loadMusicTracks());
  const current = list.find(item => item.trackKey === key);
  if (!current) throw new Error('曲目不存在或已被删除，请刷新后重试。');
  const next = normalizeMusicTrack({
    ...current,
    ...patch,
    trackKey: key,
    timestamps: {
      createdAt: musicTrackTimestamp(current, 'createdAt'),
      updatedAt: new Date().toISOString()
    }
  });
  await saveMusicTrack(next);
  return next;
}

/** 启停：停用只是从老师端可选列表里消失，成片里的历史引用不受影响。 */
export async function setMusicTrackEnabled(trackKey, enabled, { existingTracks } = {}) {
  return updateMusicTrack(trackKey, { enabled: enabled !== false }, { existingTracks });
}

/** 删除的云端写入：尽力而为（云端失败时本地已删，调用方提示同步失败即可）。 */
export async function deleteRemoteMusicTrack(trackKey) {
  unwrap(await cloud.database.from(TABLE).delete().eq('track_key', String(trackKey)));
  return trackKey;
}

/** 删除曲目：先清本机镜像（断网也要真的删掉），再尽力推云端。引用范围提示由调用方负责。 */
export async function deleteMusicTrack(trackKey) {
  const key = String(trackKey || '').trim();
  if (!key) throw new Error('缺少要删除的曲目标识。');
  persistMusicTracks(removeMusicTrack(loadMusicTracks(), key));
  try {
    await deleteRemoteMusicTrack(key);
  } catch { /* 云端不可用时本地已删除，调用方提示同步失败即可 */ }
  return key;
}

/**
 * 引用统计的数据源：**原始记录行**（成片任务 / 成片落库的记录），而不是归一化后的任务对象。
 *
 * 为什么不能只读队列：`normalizeVideoJob` 会把不在白名单里的键丢掉 —— 成片选了哪首曲子
 * （`music.trackId` / `specSnapshot.music`）是 US-221 才补进白名单的字段，在那之前它会被
 * 归一化清掉，于是「有多少成片引用过它」永远是 0。这里直接读镜像里的原始 JSON，
 * 与 data 层 `musicTrackUsage` 认的几种历史写法（当前版 / versions / specSnapshot / 平铺）对齐。
 *
 * 去重口径与队列一致（同 jobKey 取更新的一条），免得镜像里同一任务的两行被数成两条成片。
 */
export function loadMusicReferenceRecords() {
  if (typeof window === 'undefined') return [];
  let raw = [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem('xinlehui-video-jobs-v1') || '[]');
    raw = Array.isArray(parsed) ? parsed.filter(row => row && typeof row === 'object') : [];
  } catch { return []; }
  const byKey = new Map();
  raw.forEach(row => {
    const key = String(row.jobKey || row.id || '').trim();
    if (!key) return;
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, row); return; }
    const existingAt = String(existing.updatedAt || existing.createdAt || '');
    const nextAt = String(row.updatedAt || row.createdAt || '');
    if (nextAt >= existingAt) byKey.set(key, row);
  });
  return [...byKey.values()];
}
