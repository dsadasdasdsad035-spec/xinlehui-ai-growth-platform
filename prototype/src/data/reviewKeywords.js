// 作品观察词目录。
//
// 这份目录有两个消费方，必须共用同一个来源，否则会出现「AI 选出来的词前端认不出来」：
//  1. 前端 ReviewKeywordDock —— 渲染可选词面板；
//  2. llmReview 的提示词 —— 作为候选清单交给大模型，让它只从清单里挑词。
//
// 约定：AI 只能返回目录里逐字存在的词，前端用 pickSupportedKeywords() 兜一层过滤。

export const PERSONAL_KEYWORD_CATEGORIES = {
  画面主题: ['人物', '风景', '动物', '植物', '想象世界', '建筑', '静物', '抽象'],
  色彩感受: ['暖色调', '冷色调', '色彩丰富', '素雅简洁', '对比鲜明', '渐变柔和'],
  构图特点: ['构图饱满', '留白意境', '居中主体', '散点分布', '层次分明', '自由布局'],
  线条笔触: ['线条流畅', '笔触有力', '细致入微', '自由奔放', '涂色均匀', '大胆粗犷'],
  创作状态: ['专注力强', '耐心细致', '自主规划', '乐于尝试', '需要引导'],
  想象创意: ['想象丰富', '创意独特', '表达自然', '故事性强'],
  情绪感受: ['阳光快乐', '安静内敛', '活泼灵动', '情感细腻', '自信舒展'],
  成长关注点: ['色彩感知待丰富', '构图胆量待提升', '线条控制待练习', '专注时长延长', '完成度待提高', '自信表达待鼓励', '想象力待激发', '耐心细节待培养']
};

export const CLASS_KEYWORD_CATEGORIES = {
  课程目标: ['主题理解', '形态观察', '色彩感知', '构图尝试', '材料体验', '审美欣赏'],
  能力发展: ['专注投入', '观察比较', '自主选择', '精细动作', '表达叙事', '问题解决'],
  课堂流程: ['热身唤醒', '问题引导', '示范拆解', '独立创作', '作品分享', '回顾整理'],
  集体表现: ['勇敢尝试', '互相欣赏', '主动分享', '倾听等待', '同伴协作', '秩序感建立'],
  情感体验: ['好奇探索', '愉悦投入', '自信表达', '感受自然', '尊重差异', '温暖连接'],
  后续关注: ['色彩层次', '画面组织', '专注时长', '完成质量', '表达清晰', '自主创作']
};

/** 按反馈模式取词表。 */
export const keywordCategoriesFor = (mode) => (mode === '班级反馈' ? CLASS_KEYWORD_CATEGORIES : PERSONAL_KEYWORD_CATEGORIES);

/** 平铺成一个大数组，用于校验与合并。 */
export const keywordOptionsFor = (mode) => Object.values(keywordCategoriesFor(mode)).flat();

// 实测：即使提示词写了「逐字复制」，模型有时还是会顺手带上分组名，
// 返回 ["画面主题：人物","色彩感受：暖色调"]（带冒号）而不是 ["人物","暖色调"]。
// 按逐字匹配会把它们全部丢掉，所以先剥掉「分组名：」前缀再比。
const GROUP_PREFIX = /^[^：:]{1,10}[：:]\s*/;

/**
 * 词条归一化 —— **唯一真源**（US-109 起对外开放：观察词模板的「同模板内重复词」判据
 * 也复用这一条规则，不要在管理端另写一份）。
 * 剥掉「分组名：」前缀、去空白、去标点。
 */
export const normalizeKeywordText = (value) => String(value || '')
  .replace(GROUP_PREFIX, '')
  .replace(/\s/g, '')
  .replace(/[，,。.、；;：:（）()【】\[\]"'「」《》/\\|~!！?？·—\-]/g, '');

const normalize = normalizeKeywordText;

// 词表最大 8 个，防止模型把候选表抄一半回来。
const MAX_PICKED = 8;

/**
 * 把模型返回的词过滤成「给定候选词表里真实存在的词」。
 * 两级匹配：
 *  1. 归一化后完全相等（剥掉分组前缀与标点）；
 *  2. 兜底包含匹配 —— 模型可能写成「整体偏暖色调」「风景/人物」这类短语，
 *     用「候选词是否出现在返回值里」逐个找回，一个返回值可以同时命中多个候选词。
 * 候选表之外的词仍然一律丢弃，前端不会出现勾不中的幽灵词。
 *
 * `options` 就是本次生效的候选词表（US-109 起由观察词模板给，见
 * `data/reviewKeywordTemplates.js` 的 `pickTemplateKeywords`）—— 传空数组时一律返回空数组，
 * 「模板之外的词一个都不留」在结构上成立。
 */
export const pickSupportedFromOptions = (list, options = []) => {
  const source = Array.isArray(options) ? options.filter(Boolean) : [];
  const normalizedOptions = source.map((option) => [normalize(option), option]);
  const exact = new Map(normalizedOptions);
  const seen = new Set();
  const picked = [];

  for (const raw of Array.isArray(list) ? list : []) {
    const key = normalize(raw);
    if (!key) continue;
    const hit = exact.get(key);
    if (hit) {
      if (!seen.has(hit)) { seen.add(hit); picked.push(hit); }
      continue;
    }
    for (const [token, option] of normalizedOptions) {
      if (token && key.includes(token) && !seen.has(option)) { seen.add(option); picked.push(option); }
    }
  }
  return picked.slice(0, MAX_PICKED);
};

/** 按内置目录取词（老调用方 / 回归夹具的入口；行为与改造前逐字段一致）。 */
export const pickSupportedKeywords = (list, mode) => pickSupportedFromOptions(list, keywordOptionsFor(mode));

/**
 * 按给定候选词表重排（模板候选清单专用；去重）。
 * 面板上的勾选顺序永远与生效模板的 `sortOrder` 一致。
 */
export const orderFromOptions = (list, options = []) => {
  const chosen = new Set(Array.isArray(list) ? list : []);
  return (Array.isArray(options) ? options : []).filter((keyword) => chosen.has(keyword));
};

/** 按内置目录重排（老调用方入口）。 */
export const orderKeywords = (list, mode) => orderFromOptions(list, keywordOptionsFor(mode));

/**
 * 给提示词用的候选清单（带分组，模型更容易理解语义）。
 * 例如：色彩感受：暖色调 / 冷色调 / 色彩丰富 ……
 */
export const keywordCandidatesPrompt = (mode) =>
  Object.entries(keywordCategoriesFor(mode))
    .map(([group, options]) => `${group}：${options.join(' / ')}`)
    .join('\n');

