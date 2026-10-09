import { cloud, unwrap } from '../cloud';

// 装裱预设：后台新增/编辑，老师端读取并应用。
// 与其它表同一套共享工作区模型，preset_key 做幂等键。
const TABLE = 'framing_presets';

function rowToPreset(row) {
  return {
    id: row.preset_key,
    name: row.name || '未命名装裱',
    description: row.description || '',
    spec: row.spec && typeof row.spec === 'object' ? row.spec : null,
    plaqueStudent: row.plaque_student || '',
    plaqueDate: row.plaque_date || '',
    plaqueTitle: row.plaque_title || '',
    enabled: row.enabled !== false,
    builtin: row.builtin === true,
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 90,
    updatedAt: row.updated_at || ''
  };
}

function presetToRow(preset) {
  return {
    preset_key: String(preset.id),
    name: preset.name || '未命名装裱',
    description: preset.description || '',
    spec: preset.spec || null,
    plaque_student: preset.plaqueStudent || '',
    plaque_date: preset.plaqueDate || '',
    plaque_title: preset.plaqueTitle || '',
    enabled: preset.enabled !== false,
    builtin: preset.builtin === true,
    sort_order: Number.isFinite(preset.sortOrder) ? preset.sortOrder : 90
  };
}

export async function loadRemoteFramingPresets() {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  return rows.map(rowToPreset).sort((a, b) => a.sortOrder - b.sortOrder || String(a.id).localeCompare(String(b.id)));
}

export async function saveRemoteFramingPreset(preset) {
  unwrap(await cloud.database.from(TABLE).upsert(presetToRow(preset), { onConflict: 'preset_key' }));
  return preset;
}

export async function deleteRemoteFramingPreset(id) {
  unwrap(await cloud.database.from(TABLE).delete().eq('preset_key', String(id)));
  return id;
}
