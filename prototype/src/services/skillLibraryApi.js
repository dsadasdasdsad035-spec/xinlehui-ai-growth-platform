import { cloud, unwrap } from '../cloud';

// 技能库：与老师人设分开维护的基础数据。
// 与其它表同一套共享工作区模型，skill_key 做幂等键。
const TABLE = 'teacher_skill_library';

function rowToSkill(row) {
  return {
    id: row.skill_key,
    name: row.name || '未命名技能',
    description: row.description || '',
    category: row.category || '未分类',
    enabled: row.enabled !== false,
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 90,
    updatedAt: row.updated_at || '',
    source: row.source || 'manual',
    originRef: row.origin_ref || '',
    packagePath: row.package_path || '',
    packageBlob: row.package_blob || '',
    packageFiles: Array.isArray(row.package_files) ? row.package_files : [],
    version: row.version || '',
    author: row.author || '',
    license: row.license || '',
    installs: Number(row.installs) || 0,
    auditLevel: row.audit_level || 'safe'
  };
}

function skillToRow(skill) {
  return {
    skill_key: String(skill.id),
    name: skill.name || '未命名技能',
    description: skill.description || '',
    category: skill.category || '未分类',
    enabled: skill.enabled !== false,
    sort_order: Number.isFinite(skill.sortOrder) ? skill.sortOrder : 90,
    source: skill.source || 'manual',
    origin_ref: skill.originRef || '',
    package_path: skill.packagePath || '',
    package_blob: skill.packageBlob || '',
    package_files: Array.isArray(skill.packageFiles) ? skill.packageFiles : [],
    version: skill.version || '',
    author: skill.author || '',
    license: skill.license || '',
    installs: Number(skill.installs) || 0,
    audit_level: skill.auditLevel || 'safe'
  };
}

export async function loadRemoteSkillLibrary() {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  return rows.map(rowToSkill).sort((a, b) => a.sortOrder - b.sortOrder || String(a.id).localeCompare(String(b.id)));
}

export async function saveRemoteSkill(skill) {
  unwrap(await cloud.database.from(TABLE).upsert(skillToRow(skill), { onConflict: 'skill_key' }));
  return skill;
}

export async function deleteRemoteSkill(id) {
  unwrap(await cloud.database.from(TABLE).delete().eq('skill_key', String(id)));
  return id;
}
