// 装裱预设 —— 本地兜底数据，与云端 framing_presets 表保持同样的字段形状。
// spec 是「可由 canvas 精确绘制」的参数集合，不是位图。
//
// [第二步 US-001a] 起 spec 用 **v2 结构**（`services/frameSpec.js` 的 DEFAULT_FRAME_SPEC_V2）。
// 4 套内置预设是从 v1 平面结构逐字段迁移过来的，颜色/框宽/字体一个数都没动，
// 因此 `renderFramedArtwork` 的渲染结果与迁移前逐像素一致（v2 → v1 由 frameSpecView 映射）。
//
// 注意 watermark / signature / date 三个分组**故意省略**：v2 的字段全部可选，缺省即 v1 行为
// （不绘制任何叠加元素）。要加的预设自己补这三组即可，不要在这里塞一份别的默认值。
const STORAGE_KEY = 'xinlehui-framing-presets-v1';

const builtinSpec = ({ outer, mat, plaqueBg, plaqueText, atmosphere, rationale, outerWidthRatio = 0.0412, matWidthRatio = 0.0647, innerLine = null, plaqueFontFamily = 'serif', plaqueLetterSpacing = 1 }) => ({
  version: 2,
  canvas: { width: 1800, height: 1360, background: '#F3EDE2', wallRatio: 0.025 },
  frame: {
    shape: 'square', color: outer, widthRatio: outerWidthRatio, cornerRadiusRatio: 0.06,
    texture: 'solid', lighting: { highlight: '#E8C766', shadow: '#8A6B1C', angle: 135 }
  },
  mat: { visible: true, color: mat, widthRatio: matWidthRatio, innerLine },
  plaque: { visible: true, bg: plaqueBg, text: plaqueText, fontFamily: plaqueFontFamily, letterSpacing: plaqueLetterSpacing, position: 'bottom' },
  art: { rotateDeg: 0 },
  atmosphere,
  rationale
});

export const seedFramingPresets = [
  {
    id: 'frame-starlight', name: '星光展',
    description: '暖金外框配米白卡纸，深色展签。适合色彩明亮的作品，展陈感强。',
    spec: builtinSpec({ outer: '#cfa52e', mat: '#f3ede2', plaqueBg: '#2b271f', plaqueText: '#fbf8f2', atmosphere: '暖金收边，米白承托，像一次小小的颁奖。', rationale: '金色外框呼应作品的明亮色，米白卡纸避免抢色。' }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, sortOrder: 1
  },
  {
    id: 'frame-oak', name: '自然原木',
    description: '原木棕外框配米白卡纸。温度自然，能托住任意色域的作品。',
    spec: builtinSpec({ outer: '#8d6439', mat: '#f3ede2', plaqueBg: '#3e3022', plaqueText: '#fbf8f2', atmosphere: '原木温度，像把作品放回一张安静的桌子。', rationale: '木质棕与米白同属暖调，不与孩子的用色冲突。' }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, sortOrder: 2
  },
  {
    id: 'frame-ink', name: '东方雅境',
    description: '墨色极简外框配纸色卡纸，气息安静克制。',
    spec: builtinSpec({ outer: '#27241f', mat: '#eee8dd', plaqueBg: '#27241f', plaqueText: '#eee8dd', atmosphere: '墨色极简，纸色留白，气息安静。', rationale: '深墨外框压住画面，纸色卡纸保留东方留白。' }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, sortOrder: 3
  },
  {
    id: 'frame-ai-shuimo', name: '新中式水墨',
    description: '由大模型依据「新中式水墨风，墨色细外框 + 米色纸纹卡纸，落款用深墨色小字，安静克制，适合水彩作品」生成。',
    spec: builtinSpec({
      outer: '#2B2A28', outerWidthRatio: 0.015, mat: '#F3EEE2', matWidthRatio: 0.09,
      innerLine: '#8C8578', plaqueBg: '#EFE8D8', plaqueText: '#2B2A28',
      plaqueFontFamily: 'Noto Serif SC', plaqueLetterSpacing: 2,
      atmosphere: '细墨线轻收四周，米色卡纸如宣纸留白，童趣水彩在一片静气中安然呼吸。',
      rationale: '墨线收束，米色承托童趣，留白透气，静而不冷。'
    }),
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
