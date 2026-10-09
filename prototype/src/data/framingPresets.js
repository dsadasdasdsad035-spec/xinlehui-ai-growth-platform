// 装裱预设 —— 本地兜底数据，与云端 framing_presets 表保持同样的字段形状。
// spec 是「可由 canvas 精确绘制」的参数集合，不是位图。
const STORAGE_KEY = 'xinlehui-framing-presets-v1';

const builtinSpec = (outer, mat, plaqueBg, plaqueText, atmosphere, rationale) => ({
  outer, outerWidthRatio: 0.0412, mat, matWidthRatio: 0.0647, innerLine: null,
  plaqueBg, plaqueText, plaqueFontFamily: 'serif', plaqueLetterSpacing: 1,
  artRotateDeg: 0, atmosphere, rationale
});

export const seedFramingPresets = [
  {
    id: 'frame-starlight', name: '星光展',
    description: '暖金外框配米白卡纸，深色展签。适合色彩明亮的作品，展陈感强。',
    spec: builtinSpec('#cfa52e', '#f3ede2', '#2b271f', '#fbf8f2', '暖金收边，米白承托，像一次小小的颁奖。', '金色外框呼应作品的明亮色，米白卡纸避免抢色。'),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, sortOrder: 1
  },
  {
    id: 'frame-oak', name: '自然原木',
    description: '原木棕外框配米白卡纸。温度自然，能托住任意色域的作品。',
    spec: builtinSpec('#8d6439', '#f3ede2', '#3e3022', '#fbf8f2', '原木温度，像把作品放回一张安静的桌子。', '木质棕与米白同属暖调，不与孩子的用色冲突。'),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, sortOrder: 2
  },
  {
    id: 'frame-ink', name: '东方雅境',
    description: '墨色极简外框配纸色卡纸，气息安静克制。',
    spec: builtinSpec('#27241f', '#eee8dd', '#27241f', '#eee8dd', '墨色极简，纸色留白，气息安静。', '深墨外框压住画面，纸色卡纸保留东方留白。'),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, sortOrder: 3
  },
  {
    id: 'frame-ai-shuimo', name: '新中式水墨',
    description: '由大模型依据「新中式水墨风，墨色细外框 + 米色纸纹卡纸，落款用深墨色小字，安静克制，适合水彩作品」生成。',
    spec: {
      outer: '#2B2A28', outerWidthRatio: 0.015, mat: '#F3EEE2', matWidthRatio: 0.09,
      innerLine: '#8C8578', plaqueBg: '#EFE8D8', plaqueText: '#2B2A28',
      plaqueFontFamily: 'Noto Serif SC', plaqueLetterSpacing: 2, artRotateDeg: 0,
      atmosphere: '细墨线轻收四周，米色卡纸如宣纸留白，童趣水彩在一片静气中安然呼吸。',
      rationale: '墨线收束，米色承托童趣，留白透气，静而不冷。'
    },
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: false, sortOrder: 4
  }
];

const safeParse = (value, fallback) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } };

export function loadFramingPresets() {
  if (typeof window === 'undefined') return seedFramingPresets;
  const saved = safeParse(window.localStorage.getItem(STORAGE_KEY), null);
  if (!Array.isArray(saved) || !saved.length) return seedFramingPresets;
  return saved;
}

export function persistFramingPresets(presets) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets)); } catch { /* 配额满时静默降级 */ }
}

export function createEmptyFramingPreset() {
  const now = Date.now();
  return {
    id: `frame-${now}`,
    name: '新装裱',
    description: '',
    spec: null,
    plaqueStudent: '',
    plaqueDate: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    plaqueTitle: '',
    enabled: true,
    builtin: false,
    sortOrder: 90
  };
}
