// 技能库 —— 独立的基础数据表，与「老师人设」分开维护。
// 人设页只做勾选：profile.skillKeys 存的是这里 skill_key 的引用列表。
const STORAGE_KEY = 'xinlehui-skill-library-v1';

export const seedSkillLibrary = [
  { id: 'skill-color-perception', name: '色彩感知观察', description: '只描述画面中真实可见的颜色关系，不推断孩子对颜色的主观感受。', category: '作品观察', enabled: true, sortOrder: 1 },
  { id: 'skill-composition', name: '构图发展评估', description: '判断主体位置、留白与大小关系，指出一个具体可调整的方向。', category: '作品观察', enabled: true, sortOrder: 2 },
  { id: 'skill-behavior', name: '正向行为描述', description: '用可观察行为替代性格评价，例如「停顿后重新回到画面」。', category: '行为观察', enabled: true, sortOrder: 3 },
  { id: 'skill-parent-talk', name: '家长沟通话术', description: '把专业观察转成家长今晚就能用的一句话提问。', category: '家长沟通', enabled: true, sortOrder: 4 },
  { id: 'skill-evidence-guard', name: '证据边界守卫', description: '证据不足的维度主动写明局限，绝不编造课堂细节。', category: '安全约束', enabled: true, sortOrder: 5 }
];

const safeParse = (value, fallback) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } };

export function loadSkillLibrary() {
  if (typeof window === 'undefined') return seedSkillLibrary;
  const saved = safeParse(window.localStorage.getItem(STORAGE_KEY), null);
  if (!Array.isArray(saved) || !saved.length) return seedSkillLibrary;
  return saved;
}

export function persistSkillLibrary(skills) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(skills)); } catch { /* 配额满时静默降级 */ }
}

export function createEmptySkill() {
  return {
    id: `skill-${Date.now()}`,
    name: '新技能',
    description: '',
    category: '未分类',
    enabled: true,
    sortOrder: 90,
    source: 'manual'
  };
}

const slugify = (value) => String(value || '')
  .trim().toLowerCase()
  .replace(/[^a-z0-9一-龥]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'skill';

/** 上传的技能包 → 技能条目。SKILL.md 的正文会作为技能描述写进提示词。 */
export function skillFromPackage(pkg, existing = []) {
  const base = slugify(pkg.name);
  let id = `up-${base}`;
  let n = 2;
  while (existing.some(item => item.id === id)) id = `up-${base}-${n++}`;
  return {
    id,
    name: pkg.displayName || pkg.name || '未命名技能',
    description: (pkg.description || pkg.body || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    category: '导入技能',
    enabled: true,
    sortOrder: 90,
    source: 'upload',
    originRef: pkg.sourceName || '',
    version: pkg.version || '',
    author: pkg.author || '',
    license: pkg.license || '',
    packageFiles: pkg.files || [],
    auditLevel: pkg.audit?.level || 'safe'
  };
}

/** 本机发现 / 技能市场的条目 → 技能条目。originRef 用于避免重复导入。 */
export function skillFromIndexEntry(entry, kind = 'local') {
  const prefix = kind === 'market' ? 'mkt' : 'idx';
  return {
    id: `${prefix}-${slugify(entry.name)}`,
    name: entry.displayName || entry.name,
    description: (entry.description || entry.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    category: entry.category || '导入技能',
    enabled: true,
    sortOrder: 90,
    source: kind === 'market' ? 'market' : 'local',
    originRef: entry.name,
    version: entry.version || '',
    author: entry.author || '',
    license: entry.license || '',
    installs: Number(entry.installs) || 0,
    packageFiles: entry.fileList || [],
    auditLevel: 'safe'
  };
}

/**
 * 把人设里勾选的 skillKeys 解析成真正的技能条目。
 * 同时要求「技能库里该项是启用的」——库里停用后，人设上的勾选自动失效，
 * 这样基础数据的维护者能一键下掉某项技能，不必逐个改人设。
 */
export function resolveSkills(skillKeys = [], library = [], legacySkills = []) {
  const keys = Array.isArray(skillKeys) ? skillKeys : [];
  const byKey = keys.map(key => library.find(item => item.id === key)).filter(Boolean);
  if (byKey.length) return byKey.filter(item => item.enabled !== false);
  // 兼容旧数据：人设里曾经直接内嵌技能对象，这里按名称回落到技能库。
  const legacy = Array.isArray(legacySkills) ? legacySkills : [];
  const byName = legacy
    .filter(item => item && item.enabled !== false && item.name)
    .map(item => library.find(entry => entry.name === item.name) || {
      id: `legacy-${item.name}`, name: item.name, description: item.description || '', category: '未分类', enabled: true
    });
  return byName.filter(item => item.enabled !== false);
}
