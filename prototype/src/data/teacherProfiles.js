// 老师人设 / 技能库 / 大模型记忆 —— 本地兜底数据。
// 云端表 teacher_profiles 是权威来源；这里只在云端不可达时保证页面可演示。
const STORAGE_KEY = 'xinlehui-teacher-profiles-v1';

export const seedTeacherProfiles = [
  {
    id: 'teacher-linxiao',
    name: '林晓老师',
    roleLabel: '创意绘画主教',
    campus: '星河校区',
    years: 8,
    beliefs: '先看见孩子的表达，再谈技法。不评价「像不像」，不用结论式的标签定义孩子；每一句点评都从画面里真实可见的证据出发，证据不足的维度要主动写明局限。',
    tone: '温暖、具体、有画面感。多用「我看见……」句式：先说一个画面里能指认的细节，再给一个下一步可以试的方向。不用「很棒」「有天赋」这类空泛表扬。',
    boundaries: '不作心理或医学诊断；不给孩子贴性格标签；把情绪类线索一律表述为「本次课堂中的可观察表达」。家长建议必须具体、当晚就能做。',
    memory: '陈一诺（7岁，周六创意绘画 2 班）：近三次课持续使用明亮暖色，色域偏窄，可引导她尝试冷色与暖色并置。上次点评已建议「给花瓣加一层深浅变化」，本次需回访是否落实。\n林小满（8岁，同班）：进入状态较慢，但找到颜色后能持续安静完成细节，需尊重她的节奏，不用催促式语言。',
    // 技能不再内嵌在人设里：这里只保存技能库里被勾选的 id，人设页负责勾选。
    skillKeys: ['skill-color-perception', 'skill-composition', 'skill-behavior', 'skill-parent-talk', 'skill-evidence-guard'],
    updatedAt: ''
  }
];

const safeParse = (value, fallback) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } };

export function loadTeacherProfiles() {
  if (typeof window === 'undefined') return seedTeacherProfiles;
  const saved = safeParse(window.localStorage.getItem(STORAGE_KEY), null);
  if (!Array.isArray(saved) || !saved.length) return seedTeacherProfiles;
  return saved;
}

export function persistTeacherProfiles(profiles) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles)); } catch { /* 配额满时静默降级 */ }
}

export function createEmptyTeacherProfile() {
  const now = Date.now();
  return {
    id: `teacher-${now}`,
    name: '新老师',
    roleLabel: '',
    campus: '',
    years: null,
    beliefs: '',
    tone: '',
    boundaries: '',
    memory: '',
    skillKeys: [],
    updatedAt: ''
  };
}
