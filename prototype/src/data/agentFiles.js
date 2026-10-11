/**
 * agent 指令与记忆文件库 agentFiles（[第三步 US-105] / F-REVIEW-PROMPT-02）。
 *
 * 「这次点评加载了哪些 agent.md 与记忆文件、为什么、截断在哪」的**唯一真源**。
 * 加载顺序、生效范围匹配、每层上限、8000 字符总预算、变量替换、版本与内容 hash
 * 全部收在这一个零依赖模块里（`services/llmReview.js` 只把它拼出的两段正文放进提示词）。
 *
 * 五条硬约定：
 *  1. **加载顺序固定**（`AGENT_FILE_LOAD_ORDER`）：平台 agent.md → 机构 agent.md → 老师 agent.md
 *     → 技能模块 → 记忆文件（学员 > 班级 > 机构）→ 观察词模板候选 → 写作要求与输出格式。
 *     顺序是**目录**，不要在别处再写一份；`steps` 里每一步都写明它被路由到哪个提示词模块。
 *  2. **记忆文件按 studentId / classId / orgId 匹配生效范围**，同一层级最多加载 `AGENT_FILE_MAX_PER_LEVEL`
 *     （默认 5）个，排序口径是「相关度（精确命中 > 层级通用）→ 最近更新 → 排序号 → id」——
 *     同样的输入永远得到同样的顺序（提示词可复现）。
 *  3. **总量上限 `AGENT_FILE_CHAR_LIMIT`（默认 8000 字符）**：按加载顺序分配预算，
 *     排在后面的文件先被截断（甚至整份丢弃）；被截断的行带 `truncated: true` 与**截断位置**
 *     `truncatedAt`（= 真正进入提示词的字符数），汇总口径在 `truncation` 里。
 *  4. **每个文件带 `version` / `chars` / `hash`**：`hash` 是**原始正文**的 sha256 前 16 位
 *     （文件版本指纹），`renderedHash` 是变量替换后正文的 sha256 前 16 位；
 *     `chars` 是替换后的正文长度，`includedChars` 是真正进入提示词的长度。
 *  5. **停用 / 删除的文件不再进新轨迹，但历史轨迹仍可复现**：只有 `included` 的行带正文
 *     （`body`），停用与超限的文件只留在清单里说明原因；`agentFileTraceReplay(trace)`
 *     只读轨迹里的那份正文，不碰文件库 —— 文件后来被改 / 被删都不影响审计复现。
 *
 * 与 `data/skillLibrary.js` 同一套纪律：**零依赖纯函数 + 常量**（不 import 任何模块、不碰 DOM、
 * 不读 localStorage 之外的浏览器 API），可以直接用 Node 跑断言（见 prototype/AGENTS.md）。
 */

/** 结构版本：行 / 摘要字段变化时抬高它（旧数据按版本读出，不做半成品迁移）。 */
export const AGENT_FILE_VERSION = 1;

/** 本机镜像的键（与技能库 / 人设同口径：主键是裸数组）。 */
export const AGENT_FILE_STORAGE_KEY = 'xinlehui-agent-files-v1';

/** 文件类型：agent.md 指令文件与记忆文件（两类的作用范围不同、进不同的提示词模块）。 */
export const AGENT_FILE_KINDS = {
  agentMd: 'agent-md',
  memory: 'memory'
};

export const AGENT_FILE_KIND_LABELS = {
  'agent-md': 'agent.md',
  memory: '记忆文件'
};

/** 生效范围：平台 / 机构 / 老师（agent.md 三层）与 学员 / 班级 / 机构（记忆三类）。 */
export const AGENT_FILE_SCOPES = {
  platform: 'platform',
  org: 'org',
  teacher: 'teacher',
  student: 'student',
  class: 'class'
};

export const AGENT_FILE_SCOPE_LABELS = {
  platform: '平台',
  org: '机构',
  teacher: '老师',
  student: '学员',
  class: '班级'
};

/**
 * 加载顺序 —— **唯一真源**（PRD US-105 的第一条验收，顺序一字不改）。
 * `kind` 为 `agent-md` / `memory` 的步骤会加载文件；`prompt` 步骤不加载文件，
 * 只登记「这一步由哪个提示词模块提供」，`module` / `modules` 必须能在
 * `data/promptModules.js` 的 `PROMPT_MODULE_DEFS` 里找到（断言盯着这一条）。
 */
export const AGENT_FILE_LOAD_ORDER = [
  { key: 'platform-agent', label: '平台 agent.md', kind: 'agent-md', scope: 'platform', module: 'agent_md' },
  { key: 'org-agent', label: '机构 agent.md', kind: 'agent-md', scope: 'org', module: 'agent_md' },
  { key: 'teacher-agent', label: '老师 agent.md', kind: 'agent-md', scope: 'teacher', module: 'agent_md' },
  { key: 'skills', label: '技能模块', kind: 'prompt', module: 'skills' },
  { key: 'student-memory', label: '学员记忆', kind: 'memory', scope: 'student', module: 'memory' },
  { key: 'class-memory', label: '班级记忆', kind: 'memory', scope: 'class', module: 'memory' },
  { key: 'org-memory', label: '机构记忆', kind: 'memory', scope: 'org', module: 'memory' },
  { key: 'keyword-template', label: '观察词模板候选', kind: 'prompt', module: 'keyword_candidates' },
  { key: 'writing-output', label: '写作要求与输出格式', kind: 'prompt', module: 'writing_rules', modules: ['writing_rules', 'keyword_rules', 'output_format'] }
];

/** 每一步的 key（顺序即加载顺序）。 */
export const AGENT_FILE_STEP_KEYS = AGENT_FILE_LOAD_ORDER.map((step) => step.key);

/** 同一层级最多加载的记忆文件数（默认 5，PRD 的 N）。 */
export const AGENT_FILE_MAX_PER_LEVEL = 5;

/** agent.md + 记忆文件的正文总量上限（默认 8000 字符，PRD 的总量上限）。 */
export const AGENT_FILE_CHAR_LIMIT = 8000;

/** 进入 system 提示词的两段正文之间的分隔符（与提示词模块之间同一套：空行）。 */
export const AGENT_FILE_BLOCK_SEPARATOR = '\n\n';

/** 四个变量占位符（PRD US-105 点名的四个）与上下文字段名的对应关系。 */
export const AGENT_FILE_VARIABLE_KEYS = {
  学员名: 'studentName',
  班级名: 'className',
  老师姓名: 'teacherName',
  课次日期: 'lessonDate'
};

/** 变量名清单（界面上提示占位符时用它）。 */
export const AGENT_FILE_VARIABLES = Object.keys(AGENT_FILE_VARIABLE_KEYS);

/**
 * 文件状态的稳定代码（断言与 DOM 探针读它）与给人看的中文。
 * 判定优先级：文件停用 > 超出层级上限 > 超出总预算 > 正文为空（库的维护动作更该被看见）。
 */
export const AGENT_FILE_REASON_KEYS = {
  included: 'included',
  truncated: 'truncated',
  disabled: 'disabled',
  perLevelCap: 'per-level-cap',
  overBudget: 'over-budget',
  empty: 'empty'
};

export const AGENT_FILE_REASONS = {
  [AGENT_FILE_REASON_KEYS.included]: '',
  [AGENT_FILE_REASON_KEYS.truncated]: '超出总字符上限，已按优先级截断',
  [AGENT_FILE_REASON_KEYS.disabled]: '文件已停用',
  [AGENT_FILE_REASON_KEYS.perLevelCap]: `超出同层级上限（最多 ${AGENT_FILE_MAX_PER_LEVEL} 个）`,
  [AGENT_FILE_REASON_KEYS.overBudget]: '超出总字符上限，本次未加载',
  [AGENT_FILE_REASON_KEYS.empty]: '文件正文为空'
};

/** 平台级 agent.md 的种子正文（不绑定机构 / 老师，任何机构都加载）。 */
const SEED_PLATFORM_AGENT = [
  '# 平台指令',
  '- 只依据画面与素材中真实可见的证据作答，证据不足的维度写明「本次证据不足」。',
  '- 不作心理或医学诊断，不给儿童贴性格标签。',
  '- 家长建议必须具体、当晚就能执行。'
].join('\n');

const SEED_ORG_AGENT = [
  '# 机构指令（昕乐绘）',
  '- 先描述画面里能指认的细节，再给一个下一节课可以试的方向。',
  '- 提到课程进度时写清课次：{班级名} · {课次日期}。'
].join('\n');

const SEED_TEACHER_AGENT = [
  '# 老师指令（{老师姓名}）',
  '- 用「我看见……」句式：先说一个画面里能指认的细节，再给一个可以试的方向。',
  '- 每次点评至少回访一次上节课给出的练习建议。'
].join('\n');

/**
 * 种子数据：三层 agent.md 各一份，记忆文件覆盖机构 / 班级 / 学员三类。
 * 学员记忆的 `scopeRef` 用 `makeStudentId()` 的同一口径（`student-姓名`），
 * 也接受直接写姓名（`agentFileScopeTargets` 两种都认）。
 */
export const seedAgentFiles = [
  {
    id: 'agent-md-platform',
    kind: 'agent-md',
    scope: 'platform',
    scopeRef: '',
    name: '平台 agent.md',
    version: 'v1',
    enabled: true,
    sortOrder: 10,
    updatedAt: '2026-08-20T02:00:00.000Z',
    content: SEED_PLATFORM_AGENT
  },
  {
    id: 'agent-md-org-xinlehui',
    kind: 'agent-md',
    scope: 'org',
    scopeRef: 'org-xinlehui',
    name: '机构 agent.md（昕乐绘）',
    version: 'v2',
    enabled: true,
    sortOrder: 20,
    updatedAt: '2026-09-01T02:00:00.000Z',
    content: SEED_ORG_AGENT
  },
  {
    id: 'agent-md-teacher-linxiao',
    kind: 'agent-md',
    scope: 'teacher',
    scopeRef: 'teacher-linxiao',
    name: '老师 agent.md（林晓老师）',
    version: 'v3',
    enabled: true,
    sortOrder: 30,
    updatedAt: '2026-09-20T02:00:00.000Z',
    content: SEED_TEACHER_AGENT
  },
  {
    id: 'memory-org-xinlehui',
    kind: 'memory',
    scope: 'org',
    scopeRef: 'org-xinlehui',
    name: '机构记忆（点评口径）',
    version: 'v2',
    enabled: true,
    sortOrder: 10,
    updatedAt: '2026-08-28T02:00:00.000Z',
    content: [
      '【机构记忆】',
      '- 本机构点评统一用简体中文，语气温和、具体。',
      '- 家长建议最多三条，每条不超过 60 字。'
    ].join('\n')
  },
  {
    id: 'memory-class-sat-2',
    kind: 'memory',
    scope: 'class',
    scopeRef: 'class-sat-2',
    name: '班级记忆（学期主题）',
    version: 'v4',
    enabled: true,
    sortOrder: 10,
    updatedAt: '2026-09-12T02:00:00.000Z',
    content: [
      '【班级记忆 · {班级名}】',
      '- 本班本学期主题是「色彩与光」，点评时可以与本课主题呼应。',
      '- 班上多数孩子 7-8 岁，动手快，收尾环节需要留出整理时间。'
    ].join('\n')
  },
  {
    id: 'memory-student-chenyinuo',
    kind: 'memory',
    scope: 'student',
    scopeRef: 'student-陈一诺',
    name: '学员记忆（陈一诺）',
    version: 'v5',
    enabled: true,
    sortOrder: 10,
    updatedAt: '2026-10-05T02:00:00.000Z',
    content: [
      '【学员记忆 · {学员名}】',
      '- 近三次课持续使用明亮暖色，色域偏窄；本次可观察是否出现冷色与暖色并置。',
      '- 上节课给出的练习建议是「给花瓣加一层深浅变化」，本次需要回访是否落实。',
      '- 家长最关心的是孩子能不能把画里的故事讲出来。'
    ].join('\n')
  },
  {
    id: 'memory-student-linxiaoman',
    kind: 'memory',
    scope: 'student',
    scopeRef: 'student-林小满',
    name: '学员记忆（林小满）',
    version: 'v3',
    enabled: true,
    sortOrder: 20,
    updatedAt: '2026-09-28T02:00:00.000Z',
    content: [
      '【学员记忆 · {学员名}】',
      '- 进入状态较慢，找到颜色后能持续安静完成细节；不要用催促式语言。',
      '- 喜欢细节密集的画面，点评时可以具体指出她补的哪一处。'
    ].join('\n')
  }
];

const safeParse = (value, fallback) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } };

const str = (value) => (value === null || value === undefined ? '' : String(value).trim());

/** 本机兜底：本地为空时返回种子（与技能库 / 课程库同一条读取口径）。 */
export function loadAgentFiles() {
  if (typeof window === 'undefined') return seedAgentFiles;
  const saved = safeParse(window.localStorage.getItem(AGENT_FILE_STORAGE_KEY), null);
  if (!Array.isArray(saved) || !saved.length) return seedAgentFiles;
  return saved.map(normalizeAgentFile).filter((file) => file.id);
}

export function persistAgentFiles(files) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(AGENT_FILE_STORAGE_KEY, JSON.stringify(files)); } catch { /* 配额满时静默降级 */ }
}

/** 管理端（US-106）新建用的空文件；本故事只提供构造器，页面在 US-106。 */
export function createEmptyAgentFile(input = {}) {
  return normalizeAgentFile({
    id: `agent-file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    kind: AGENT_FILE_KINDS.agentMd,
    scope: AGENT_FILE_SCOPES.platform,
    name: '新的 agent.md',
    version: 'v1',
    enabled: true,
    sortOrder: 90,
    updatedAt: new Date().toISOString(),
    ...input
  });
}

/**
 * 容错读入：**永不抛错**。认不出 `kind` / `scope` 的文件按「平台 agent.md」读出（不会静默消失，
 * 也不会被当成记忆文件加载进别的层级）；`content` 一律转成字符串。
 */
export function normalizeAgentFile(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const kind = Object.values(AGENT_FILE_KINDS).includes(str(source.kind)) ? str(source.kind) : AGENT_FILE_KINDS.agentMd;
  const scope = Object.values(AGENT_FILE_SCOPES).includes(str(source.scope)) ? str(source.scope) : AGENT_FILE_SCOPES.platform;
  return {
    id: str(source.id),
    kind,
    scope,
    scopeRef: str(source.scopeRef),
    name: str(source.name) || AGENT_FILE_KIND_LABELS[kind],
    version: str(source.version),
    enabled: source.enabled !== false,
    sortOrder: Number.isFinite(Number(source.sortOrder)) ? Number(source.sortOrder) : 90,
    updatedAt: str(source.updatedAt),
    content: source.content === null || source.content === undefined ? '' : String(source.content),
    // 认不出的原始字段原样留着（US-106 的编辑器与回滚要用），不进任何加载判定。
    legacy: source.legacy && typeof source.legacy === 'object' ? source.legacy : undefined
  };
}

/** 上下文归一：字符串化 + 去空格（缺哪个字段就取不到那个层级的文件，绝不猜）。 */
export function normalizeAgentFileContext(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const context = {};
  ['orgId', 'orgName', 'teacherId', 'teacherName', 'classId', 'className', 'studentId', 'studentName', 'lessonDate', 'lessonNo', 'topic'].forEach((key) => {
    context[key] = str(source[key]);
  });
  return context;
}

/**
 * 某个层级在本次上下文里「能匹配的值」：id 与姓名两种都认（原型阶段数据里存的是姓名）。
 * 学员层级额外认「姓名派生的 id」形态（`student-<姓名>`，与 `data/lessons.js` 的
 * `makeStudentId()` 同一口径）：学员记忆的 `scopeRef` 写哪一种都能命中。
 */
export function agentFileScopeTargets(file, context = {}) {
  const ctx = normalizeAgentFileContext(context);
  switch (str(file?.scope)) {
    case AGENT_FILE_SCOPES.org: return [ctx.orgId, ctx.orgName].filter(Boolean);
    case AGENT_FILE_SCOPES.teacher: return [ctx.teacherId, ctx.teacherName].filter(Boolean);
    case AGENT_FILE_SCOPES.student: return [ctx.studentId, ctx.studentName, ctx.studentName ? `student-${ctx.studentName}` : ''].filter(Boolean);
    case AGENT_FILE_SCOPES.class: return [ctx.classId, ctx.className].filter(Boolean);
    default: return []; // 平台级：`scopeRef` 为空即命中所有机构
  }
}

/**
 * 生效范围是否命中本次上下文：
 *  - `scopeRef` 为空 = **层级通用**（该层级下任何课次都加载）；
 *  - 否则必须精确命中该层级对应的上下文值（id 或姓名）。
 * 认不出范围的（脏数据）**一律不命中**：宁可少加载，也不能把别的机构的记忆塞进提示词。
 */
export function agentFileMatchesScope(file, context = {}) {
  const scope = str(file?.scope);
  const ref = str(file?.scopeRef);
  if (!Object.values(AGENT_FILE_SCOPES).includes(scope)) return false; // 认不出范围的脏数据：不加载
  if (scope === AGENT_FILE_SCOPES.platform) return true; // 平台级对所有机构生效（scopeRef 不参与判定）
  if (!ref) return true; // 层级通用：该层级下任何课次都加载
  return agentFileScopeTargets(file, context).includes(ref);
}

/**
 * 相关度：精确命中（文件就是为这位学员 / 这个班 / 这家机构写的）> 层级通用。
 * 同层级排序的第二判据是「最近更新」（`updatedAt` 倒序），第三、第四判据是排序号与 id
 * （保证同样的输入永远得到同样的顺序）。
 */
export function agentFileRelevance(file, context = {}) {
  const ref = str(file?.scopeRef);
  if (!ref) return 0;
  return agentFileScopeTargets(file, context).includes(ref) ? 1 : -1;
}

/** 同层级排序（导出给断言用）：相关度倒序 → 最近更新倒序 → 排序号正序 → id 正序。 */
export function compareAgentFiles(context) {
  return (left, right) => {
    const byRelevance = agentFileRelevance(right, context) - agentFileRelevance(left, context);
    if (byRelevance) return byRelevance;
    const byUpdated = str(right?.updatedAt).localeCompare(str(left?.updatedAt));
    if (byUpdated) return byUpdated;
    const byOrder = (Number(left?.sortOrder) || 90) - (Number(right?.sortOrder) || 90);
    if (byOrder) return byOrder;
    return str(left?.id).localeCompare(str(right?.id));
  };
}

/**
 * 变量占位符替换：`{学员名}` `{班级名}` `{老师姓名}` `{课次日期}`。
 * 与「水印落款」的变量替换同一套口径（`services/overlayLayout.js` 的 `applyOverlayVariables`）：
 * **未命中的变量保留原文**（不静默吞掉），命中但没有值替换成空串，两种情况都回报出去。
 */
export function renderAgentFileContent(content, context = {}) {
  const ctx = normalizeAgentFileContext(context);
  const template = content === null || content === undefined ? '' : String(content);
  const replaced = [];
  const missing = [];
  const empty = [];
  const names = template.match(/\{([^{}]{1,16})\}/g) || [];
  [...new Set(names.map((item) => item.slice(1, -1)))].forEach((name) => {
    const key = AGENT_FILE_VARIABLE_KEYS[name];
    if (!key) { missing.push(name); return; }
    if (ctx[key]) replaced.push(name); else empty.push(name);
  });
  const text = template.replace(/\{([^{}]{1,16})\}/g, (whole, name) => {
    const key = AGENT_FILE_VARIABLE_KEYS[name];
    if (!key) return whole; // 未命中：保留原文，绝不静默吞掉
    return ctx[key];
  });
  return { text, replaced, missing, empty };
}

// ---------------------------------------------------------------------------
// 内容 hash：sha256 前 16 位（零依赖实现，浏览器 / Node 都是同一份字节结果）
// ---------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const rotr = (value, bits) => ((value >>> bits) | (value << (32 - bits))) >>> 0;

/** UTF-8 字节（代理对按 4 字节编码，孤立代理位按替换字符处理，与浏览器同口径）。 */
function utf8Bytes(text) {
  const bytes = [];
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code < 0x80) { bytes.push(code); continue; }
    if (code < 0x800) { bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f)); continue; }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
        bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        bytes.push(0xef, 0xbf, 0xbd);
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) { bytes.push(0xef, 0xbf, 0xbd); continue; }
    bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}

/** 纯 JS SHA-256（十六进制小写）。同字符串在浏览器与 Node 下逐字符相同。 */
export function sha256Hex(value) {
  const bytes = utf8Bytes(value === null || value === undefined ? '' : String(value));
  const bitLength = bytes.length * 8;
  const withOne = bytes.length + 1;
  const total = withOne + ((56 - (withOne % 64)) + 64) % 64 + 8;
  const data = new Uint8Array(total);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  [high, low].forEach((word, index) => {
    const at = total - 8 + index * 4;
    data[at] = (word >>> 24) & 0xff;
    data[at + 1] = (word >>> 16) & 0xff;
    data[at + 2] = (word >>> 8) & 0xff;
    data[at + 3] = word & 0xff;
  });
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < total; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      w[index] = ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = (rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10)) >>> 0;
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3; let e = h4; let f = h5; let g = h6; let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[index] + w[index]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, '0')).join('');
}

/** 内容 hash = sha256 前 16 位（文件版本指纹；同样的正文永远得到同样的值）。 */
export function agentFileHash(content) {
  return sha256Hex(content).slice(0, 16);
}

/** 版本显示口径：有版本写版本，没有写更新时间，都没有如实写「未标注」。 */
export function agentFileVersionText(file) {
  const version = str(file?.version);
  if (version) return `v${version.replace(/^v/i, '')}`;
  const updatedAt = str(file?.updatedAt);
  if (updatedAt) return `更新于 ${updatedAt.slice(0, 10)}`;
  return '未标注';
}

/** 一行文件（供清单 / 面板 / 导出共用）：`学员记忆（陈一诺） · 学员 · v5 · 300 字 · sha256 1a2b3c4d5e6f7081`。 */
export function agentFileRowText(row) {
  const source = row && typeof row === 'object' ? row : {};
  const head = `${source.included ? '[已加载]' : '[未加载]'} ${str(source.name) || str(source.fileId) || '未命名文件'}`;
  const detail = str(source.detail);
  const reason = str(source.reason);
  return `${head}${detail ? ` · ${detail}` : ''}${!source.included && reason ? ` —— ${reason}` : ''}`;
}

/** 一条候选文件的清单行：只有**已加载**的行写版本 / 字符数 / hash（没加载的数字与「没进去」矛盾）。 */
function buildAgentFileRow(file, { context, rendered, kept, reasonKey, included }) {
  const fullChars = rendered.text.length;
  const truncated = included && kept < fullChars;
  const kindLabel = AGENT_FILE_KIND_LABELS[file.kind] || file.kind;
  const scopeLabel = AGENT_FILE_SCOPE_LABELS[file.scope] || file.scope;
  const row = {
    fileId: file.id,
    id: file.id,
    kind: file.kind,
    kindLabel,
    scope: file.scope,
    scopeLabel,
    scopeRef: file.scopeRef,
    name: file.name,
    version: included ? file.version : '',
    updatedAt: file.updatedAt,
    sortOrder: file.sortOrder,
    enabled: file.enabled,
    relevance: agentFileRelevance(file, context),
    rawChars: file.content.length,
    chars: fullChars,
    includedChars: included ? kept : 0,
    hash: included ? agentFileHash(file.content) : '',
    renderedHash: included ? agentFileHash(rendered.text) : '',
    included,
    truncated,
    truncatedAt: truncated ? kept : 0,
    droppedChars: included ? fullChars - kept : fullChars,
    reasonKey,
    reason: AGENT_FILE_REASONS[reasonKey] || '',
    replaced: rendered.replaced,
    missing: rendered.missing,
    emptyVars: rendered.empty,
    // 只有**真正进入提示词**的行带正文（停用 / 超限的文件不进新轨迹）。
    body: included ? rendered.text.slice(0, kept) : ''
  };
  row.versionText = agentFileVersionText(row);
  if (!included) {
    row.version = '';
    row.detail = kindLabel;
  } else {
    const charsText = truncated ? `${row.includedChars}/${row.chars} 字（截断）` : `${row.chars} 字`;
    row.detail = [kindLabel, scopeLabel, row.versionText, charsText, `sha256 ${row.hash}`].filter(Boolean).join(' · ');
  }
  row.text = agentFileRowText(row);
  return row;
}

/** 步骤骨架（每一步都写明：谁提供内容、加载了哪些文件）。 */
function buildStep(step) {
  return {
    key: step.key,
    label: step.label,
    kind: step.kind,
    scope: step.scope || '',
    module: step.module || '',
    modules: step.modules ? [...step.modules] : (step.module ? [step.module] : []),
    fileIds: [],
    included: step.kind === 'prompt' ? null : false, // null = 这一步不由本模块判定（内容来自提示词模块）
    chars: 0
  };
}

/**
 * 本次点评的 agent 文件加载结果 —— **唯一真源**。
 *
 * 输入：文件库（`loadAgentFiles()` 或管理端草稿）+ 本次上下文（学员 / 班级 / 机构 / 老师 / 课次日期）
 * + 可选的上限覆盖（`limit` / `perLevel`，管理端将来可配；缺省用两个常量）。
 *
 * 返回：
 *  - `steps`：按 `AGENT_FILE_LOAD_ORDER` 的九步顺序，逐步写明加载了什么
 *    （`agent-md` / `memory` 步带 `fileIds`；`prompt` 步的 `included` 是 `null`，只登记顺序与归属模块）；
 *  - `rows`：**全部候选文件**一条一行（含未加载原因：停用 / 超层级上限 / 超总预算 / 正文为空）；
 *  - `files`：真正进入提示词的文件行（带 `body`，供面板与轨迹用）；
 *  - `agentMdContent` / `memoryContent`：两段正文（分别进 `agent_md` 与 `memory` 模块）；
 *  - `chars` / `fullChars` / `truncated` / `truncation`：预算与截断读数；
 *  - `versionSet` / `loadoutHash`：本次加载的文件版本指纹（同样的版本集合 → 同样的提示词）；
 *  - `summary`：轨迹留档用的精简读数（不带正文）。
 */
export function agentFileLoadout({ files = [], context = {}, limit = AGENT_FILE_CHAR_LIMIT, perLevel = AGENT_FILE_MAX_PER_LEVEL } = {}) {
  const ctx = normalizeAgentFileContext(context);
  const library = (Array.isArray(files) ? files : []).map(normalizeAgentFile).filter((file) => file.id);
  const maxPerLevel = Number.isFinite(Number(perLevel)) && Number(perLevel) >= 0 ? Number(perLevel) : AGENT_FILE_MAX_PER_LEVEL;
  const budget = Number.isFinite(Number(limit)) && Number(limit) >= 0 ? Number(limit) : AGENT_FILE_CHAR_LIMIT;
  let remaining = budget;
  const rows = [];
  const includedRows = [];
  const steps = AGENT_FILE_LOAD_ORDER.map(buildStep);
  const stepByKey = new Map(steps.map((step) => [step.key, step]));

  AGENT_FILE_LOAD_ORDER.filter((step) => step.kind !== 'prompt').forEach((step) => {
    const matched = library.filter((file) => file.kind === step.kind && file.scope === step.scope && agentFileMatchesScope(file, ctx));
    const disabled = matched.filter((file) => file.enabled === false);
    const sorted = matched.filter((file) => file.enabled !== false).sort(compareAgentFiles(ctx));
    const kept = sorted.slice(0, maxPerLevel);
    const overCap = sorted.slice(maxPerLevel);
    // 停用与超层级上限的文件只进清单说明原因（不进提示词、不带正文）。
    disabled.forEach((file) => {
      rows.push(buildAgentFileRow(file, { context: ctx, rendered: renderAgentFileContent(file.content, ctx), kept: 0, reasonKey: AGENT_FILE_REASON_KEYS.disabled, included: false }));
    });
    overCap.forEach((file) => {
      rows.push(buildAgentFileRow(file, { context: ctx, rendered: renderAgentFileContent(file.content, ctx), kept: 0, reasonKey: AGENT_FILE_REASON_KEYS.perLevelCap, included: false }));
    });
    // 本层被加载的文件：按顺序吃预算 —— 排在后面的层级 / 文件先被截断。
    kept.forEach((file) => {
      const rendered = renderAgentFileContent(file.content, ctx);
      const fullChars = rendered.text.length;
      if (!fullChars) {
        rows.push(buildAgentFileRow(file, { context: ctx, rendered, kept: 0, reasonKey: AGENT_FILE_REASON_KEYS.empty, included: false }));
        return;
      }
      const allowed = Math.min(fullChars, Math.max(0, remaining));
      if (allowed <= 0) {
        rows.push(buildAgentFileRow(file, { context: ctx, rendered, kept: 0, reasonKey: AGENT_FILE_REASON_KEYS.overBudget, included: false }));
        return;
      }
      remaining -= allowed;
      const truncated = allowed < fullChars;
      const row = buildAgentFileRow(file, {
        context: ctx,
        rendered,
        kept: allowed,
        reasonKey: truncated ? AGENT_FILE_REASON_KEYS.truncated : AGENT_FILE_REASON_KEYS.included,
        included: true
      });
      rows.push(row);
      includedRows.push(row);
      stepByKey.get(step.key).fileIds.push(row.fileId);
      stepByKey.get(step.key).included = true;
      stepByKey.get(step.key).chars += row.includedChars;
    });
  });

  rows.sort((left, right) => {
    const leftStep = AGENT_FILE_LOAD_ORDER.findIndex((step) => step.kind === left.kind && step.scope === left.scope);
    const rightStep = AGENT_FILE_LOAD_ORDER.findIndex((step) => step.kind === right.kind && step.scope === right.scope);
    return leftStep - rightStep || str(left.id).localeCompare(str(right.id));
  });

  const agentMdRows = includedRows.filter((row) => row.kind === AGENT_FILE_KINDS.agentMd);
  const memoryRows = includedRows.filter((row) => row.kind === AGENT_FILE_KINDS.memory);
  const agentMdContent = agentMdRows.map((row) => row.body).join(AGENT_FILE_BLOCK_SEPARATOR);
  const memoryContent = memoryRows.map((row) => row.body).join(AGENT_FILE_BLOCK_SEPARATOR);
  const chars = includedRows.reduce((sum, row) => sum + row.includedChars, 0);
  const fullChars = includedRows.reduce((sum, row) => sum + row.chars, 0) + rows.filter((row) => row.reasonKey === AGENT_FILE_REASON_KEYS.overBudget).reduce((sum, row) => sum + row.chars, 0);
  const truncatedRows = includedRows.filter((row) => row.truncated);
  const droppedRows = rows.filter((row) => row.reasonKey === AGENT_FILE_REASON_KEYS.overBudget);
  const truncated = truncatedRows.length > 0 || droppedRows.length > 0;
  const versionSet = includedRows.map((row) => `${row.fileId}@${row.version || 'unknown'}:${row.hash}`);
  // 截断读数（`at` = 截断位置：真正进入提示词的字符数，在这之后的正文都没进提示词）。
  const truncation = {
    limit: budget,
    at: truncated ? chars : 0,
    fullChars,
    droppedChars: Math.max(0, fullChars - chars),
    files: [
      ...truncatedRows.map((row) => ({ fileId: row.fileId, kind: row.kind, truncatedAt: row.truncatedAt, chars: row.chars, includedChars: row.includedChars })),
      ...droppedRows.map((row) => ({ fileId: row.fileId, kind: row.kind, truncatedAt: 0, chars: row.chars, includedChars: 0 }))
    ]
  };
  const summary = {
    version: AGENT_FILE_VERSION,
    loadOrder: [...AGENT_FILE_STEP_KEYS],
    loadOrderLabels: AGENT_FILE_LOAD_ORDER.map((step) => step.label),
    limit: budget,
    perLevel: maxPerLevel,
    chars,
    fullChars,
    includedFiles: includedRows.length,
    candidateFiles: rows.filter((row) => row.reasonKey !== AGENT_FILE_REASON_KEYS.disabled).length,
    disabledFiles: rows.filter((row) => row.reasonKey === AGENT_FILE_REASON_KEYS.disabled).length,
    truncated,
    truncatedAt: truncated ? chars : 0,
    droppedChars: Math.max(0, fullChars - chars),
    context: ctx,
    versionSet,
    loadoutHash: agentFileHash(versionSet.join('|')),
    // 轨迹里靠它说明「截断在哪」（不带正文）。
    truncation
  };
  return {
    version: AGENT_FILE_VERSION,
    context: ctx,
    limit: budget,
    perLevel: maxPerLevel,
    order: AGENT_FILE_LOAD_ORDER.map((step) => ({ ...step, modules: step.modules ? [...step.modules] : [...(step.module ? [step.module] : [])] })),
    steps,
    rows,
    files: includedRows,
    agentMdContent,
    memoryContent,
    chars,
    fullChars,
    truncated,
    truncation,
    counts: {
      rows: rows.length,
      included: includedRows.length,
      agentMdFiles: agentMdRows.length,
      memoryFiles: memoryRows.length,
      disabled: summary.disabledFiles,
      perLevelCap: rows.filter((row) => row.reasonKey === AGENT_FILE_REASON_KEYS.perLevelCap).length,
      overBudget: droppedRows.length,
      truncated: truncatedRows.length,
      chars,
      limit: budget
    },
    versionSet,
    loadoutHash: summary.loadoutHash,
    summary
  };
}

/** 面板 / 审计用的一行读数：`agent.md 3 个 · 记忆文件 2 个 · 620 字（上限 8000）`。 */
export function agentFileSummaryText(loadoutOrSummary) {
  const source = loadoutOrSummary && typeof loadoutOrSummary === 'object' ? loadoutOrSummary : {};
  const counts = source.counts && typeof source.counts === 'object' ? source.counts : null;
  const summary = source.summary && typeof source.summary === 'object' ? source.summary : source;
  const parts = [];
  if (counts) {
    parts.push(`agent.md ${counts.agentMdFiles} 个`);
    parts.push(`记忆文件 ${counts.memoryFiles} 个`);
    if (counts.disabled) parts.push(`停用 ${counts.disabled} 个`);
  }
  parts.push(`${summary.chars || 0} 字（上限 ${summary.limit || AGENT_FILE_CHAR_LIMIT}）`);
  if (summary.truncated) parts.push(`已按优先级截断在 ${summary.truncatedAt || 0} 字处`);
  return parts.join(' · ');
}

/**
 * 历史复现（PRD US-105 的最后一条验收）：**只读轨迹里的那份正文**，
 * 不碰文件库 —— 文件后来被停用、被删、被改，都不影响「当时加载了什么」的复现。
 * 轨迹里只有真正进入提示词的行（带 `body`），所以复现出来的正文与当时发出去的一致。
 */
export function agentFileTraceReplay(trace) {
  const loaded = trace && typeof trace === 'object' ? (trace.loaded || {}) : {};
  const list = Array.isArray(loaded.files) ? loaded.files : [];
  const files = list.filter((row) => row && row.included !== false).map((row) => ({
    fileId: str(row.fileId || row.id),
    kind: str(row.kind),
    scope: str(row.scope),
    name: str(row.name),
    version: str(row.version),
    chars: Number(row.chars) || 0,
    includedChars: Number(row.includedChars) || 0,
    hash: str(row.hash),
    truncated: Boolean(row.truncated),
    truncatedAt: Number(row.truncatedAt) || 0,
    body: typeof row.body === 'string' ? row.body : ''
  }));
  const summary = loaded.agentFiles && typeof loaded.agentFiles === 'object' ? loaded.agentFiles : {};
  const agentMdContent = files.filter((row) => row.kind === AGENT_FILE_KINDS.agentMd).map((row) => row.body).join(AGENT_FILE_BLOCK_SEPARATOR);
  const memoryContent = files.filter((row) => row.kind === AGENT_FILE_KINDS.memory).map((row) => row.body).join(AGENT_FILE_BLOCK_SEPARATOR);
  return {
    files,
    summary,
    agentMdContent,
    memoryContent,
    chars: files.reduce((sum, row) => sum + row.includedChars, 0),
    truncated: Boolean(summary.truncated) || files.some((row) => row.truncated)
  };
}

/** 未命中变量的告警文案（管理端 US-106 的编辑器与校验共用；本故事先把口径定下来）。 */
export function agentFileVariableWarnings(content, context = {}) {
  const result = renderAgentFileContent(content, context);
  const warnings = result.missing.map((name) => `未知变量 {${name}}：加载时保留原文，可选变量为 ${AGENT_FILE_VARIABLES.map((item) => `{${item}}`).join(' ')}`);
  if (result.empty.length) warnings.push(`变量 ${result.empty.map((name) => `{${name}}`).join(' ')} 当前没有值，加载时替换为空。`);
  return warnings;
}
