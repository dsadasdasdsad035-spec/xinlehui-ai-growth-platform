import { cloud, unwrap } from '../cloud';

// 老师人设 / 技能库 / 大模型记忆改为云端持久化。
// 与 student_management / feedback_records 保持同一套模型：整个机构共用一份工作区，
// 以 profile_key 做幂等键，而不是按登录用户隔离。
const TABLE = 'teacher_profiles';

function rowToProfile(row) {
  return {
    id: row.profile_key,
    name: row.name || '',
    roleLabel: row.role_label || '',
    campus: row.campus || '',
    years: row.years ?? null,
    beliefs: row.beliefs || '',
    tone: row.tone || '',
    boundaries: row.boundaries || '',
    memory: row.memory || '',
    // 技能不再内嵌：只保存技能库中被勾选的 id 列表。
    skillKeys: Array.isArray(row.skill_keys) ? row.skill_keys : [],
    updatedAt: row.updated_at || ''
  };
}

function profileToRow(profile) {
  return {
    profile_key: String(profile.id),
    name: profile.name || '未命名老师',
    role_label: profile.roleLabel || '',
    campus: profile.campus || '',
    years: profile.years === '' || profile.years === null || profile.years === undefined ? null : Number(profile.years),
    beliefs: profile.beliefs || '',
    tone: profile.tone || '',
    boundaries: profile.boundaries || '',
    memory: profile.memory || '',
    skill_keys: Array.isArray(profile.skillKeys) ? profile.skillKeys : []
  };
}

export async function loadRemoteTeacherProfiles() {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  return rows.map(rowToProfile).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export async function saveRemoteTeacherProfile(profile) {
  unwrap(await cloud.database.from(TABLE).upsert(profileToRow(profile), { onConflict: 'profile_key' }));
  return profile;
}

export async function deleteRemoteTeacherProfile(id) {
  unwrap(await cloud.database.from(TABLE).delete().eq('profile_key', String(id)));
  return id;
}
