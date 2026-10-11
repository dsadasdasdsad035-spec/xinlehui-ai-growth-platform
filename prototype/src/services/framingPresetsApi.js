import { cloud, unwrap } from '../cloud';
import { filterFramingPresetsForViewer, normalizeFramingPreset, sortFramingPresets } from '../data/framingPresets';

// 装裱模板：平台 / 机构 / 老师个人**三层共用一张表**，靠 `scope` + `owner_key` 区分归属
// （平台模板 owner_key 为空），与其它表同一套共享工作区模型。
// `preset_key` 仍是幂等 upsert 的冲突键：三层的模板 id 各自唯一，所以 upsert 不会跨层互相覆盖。
const TABLE = 'framing_presets';

function rowToPreset(row) {
  const source = row && typeof row === 'object' ? row : {};
  // 老记录没有 scope 列 → normalizeFramingPreset 按 platform 读取（US-001b 的兼容要求）。
  return normalizeFramingPreset({
    id: source.preset_key,
    name: source.name || '未命名装裱',
    description: source.description || '',
    spec: source.spec && typeof source.spec === 'object' ? source.spec : null,
    plaqueStudent: source.plaque_student || '',
    plaqueDate: source.plaque_date || '',
    plaqueTitle: source.plaque_title || '',
    enabled: source.enabled !== false,
    builtin: source.builtin === true,
    scope: source.scope,
    ownerKey: source.owner_key,
    sortOrder: Number.isFinite(source.sort_order) ? source.sort_order : 90,
    updatedAt: source.updated_at || ''
  });
}

function presetToRow(preset) {
  const item = normalizeFramingPreset(preset);
  return {
    preset_key: String(item.id),
    name: item.name || '未命名装裱',
    description: item.description || '',
    spec: item.spec || null,
    plaque_student: item.plaqueStudent || '',
    plaque_date: item.plaqueDate || '',
    plaque_title: item.plaqueTitle || '',
    enabled: item.enabled !== false,
    builtin: item.builtin === true,
    scope: item.scope,
    owner_key: item.ownerKey || '',
    sort_order: Number.isFinite(item.sortOrder) ? item.sortOrder : 90
  };
}

/**
 * 读取模板。
 * - 不传 viewer：返回**全部三层**，供管理端维护（后台「装裱设置」要能看到并编辑每一层）。
 * - 传 viewer（`{ role, teacherId, teacherName, orgId }`）：按 `scope + owner_key` 过滤 ——
 *   平台模板所有人可见、机构模板限本机构、老师个人模板仅 ownerKey 命中自己的可见，
 *   老师看不到别人的个人模板。过滤与可见性规则都在 `data/framingPresets.js` 里（零依赖纯函数）。
 */
export async function loadRemoteFramingPresets(viewer = null) {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  const presets = sortFramingPresets((rows || []).map(rowToPreset));
  return viewer ? filterFramingPresetsForViewer(presets, viewer) : presets;
}

export async function saveRemoteFramingPreset(preset) {
  unwrap(await cloud.database.from(TABLE).upsert(presetToRow(preset), { onConflict: 'preset_key' }));
  return preset;
}

export async function deleteRemoteFramingPreset(id) {
  unwrap(await cloud.database.from(TABLE).delete().eq('preset_key', String(id)));
  return id;
}
