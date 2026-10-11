/**
 * agent 文件正文的敏感内容校验（[第三步 US-106b] / F-REVIEW-PROMPT-02）。
 *
 * 为什么要拦：agent.md 与记忆文件会**整段**拼进每一次点评的 system 提示词（US-105），
 * 正文里写下的手机号 / 微信号 / QQ 号 / 邮箱会随提示词离开本机，还会被推理轨迹留档
 * （US-102 的 `loaded.files[].body`）。所以「保存」之前必须过一道闸门。
 *
 * 这一份是「什么算联系方式、怎么给可读提示」的**唯一真源**：编辑器里的实时告警与保存闸门
 * 读同一份 —— 页面里不许再写一遍正则（两处正则一定会漂移：一处加了邮箱、另一处忘了）。
 *
 * 三条口径：
 *  1. 只认**明确的联系方式写法**（11 位手机号 / 微信 ID / QQ 号 / 邮箱），不做「凡是数字都拦」
 *     的粗暴匹配：正文里的课次序号、日期、字符数都不该被误报。
 *  2. 命中位置给到**行号**，片段一律**遮蔽**后再进提示（提示里不回显完整号码，与
 *     `用户管理` 页的 `138****2026` 同一习惯）。
 *  3. 同一段文字被多条规则命中时只报一次（按规则表里靠前的规则算）：报告条数 = 真实命中处数。
 *
 * 零依赖纯函数（不 import 任何模块、不碰 DOM），可以直接用 Node 跑断言。
 */

/** 规则代码（进 DOM 探针与断言，不要读中文）。 */
export const AGENT_FILE_SENSITIVE_RULE_KEYS = {
  wechat: 'wechat',
  qq: 'qq',
  mobile: 'mobile',
  email: 'email'
};

/** 手机号的边界判定：前后不能紧邻数字（否则是一串更长的数字，不是手机号）。 */
const isDigit = (value) => /\d/.test(String(value || ''));

/**
 * 联系方式的四条规则（顺序 = 报告顺序 = 同一段文字的归属顺序）。
 * `patterns` 里的正则**每次扫描都新建**（`RegExp` 带 `g` 时有 `lastIndex` 状态，
 * 复用同一个实例会让第二次扫描从上次的位置继续 —— 编辑器每敲一个字都会扫一次）。
 */
export const AGENT_FILE_SENSITIVE_RULES = [
  {
    key: AGENT_FILE_SENSITIVE_RULE_KEYS.wechat,
    label: '微信号',
    hint: 'wxid_ 开头的账号，或「微信号 / 我的微信 / 加微信 / 微信联系」后跟的 ID',
    sources: [
      'wxid_[A-Za-z0-9_-]{3,}',
      '(?:微信号|微信ID|微信id|我的微信|加我微信|加微信|微信联系|weixin|WeChat|wechat)\\s*[:：=]?\\s*([A-Za-z][A-Za-z0-9_-]{4,19}|\\d{5,})',
      '(?:微信|wx|vx|V信|薇信)\\s*[:：=]\\s*([A-Za-z][A-Za-z0-9_-]{4,19}|\\d{5,})'
    ]
  },
  {
    key: AGENT_FILE_SENSITIVE_RULE_KEYS.qq,
    label: 'QQ 号',
    hint: '「QQ」后跟 5-12 位数字',
    sources: ['(?:QQ|qq|扣扣|企鹅号)\\s*(?:号码|号)?\\s*[:：=]?\\s*(\\d{5,12})']
  },
  {
    key: AGENT_FILE_SENSITIVE_RULE_KEYS.mobile,
    label: '手机号',
    hint: '11 位手机号（允许 138-0000-0000 这种分隔与 +86 前缀）',
    sources: ['(?:\\+?86[\\s-]?)?1[3-9](?:[\\s-]?\\d){9}']
  },
  {
    key: AGENT_FILE_SENSITIVE_RULE_KEYS.email,
    label: '邮箱',
    hint: 'xxx@yyy.zz',
    sources: ['[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+']
  }
];

/** 检测到联系方式之后的一句话说明（编辑器与 SAVE 闸门共用）。 */
export const AGENT_FILE_SENSITIVE_NOTE = 'agent.md 与记忆文件会整段进入每一次点评的 system 提示词：正文里不能写手机号、微信号、QQ 号、邮箱等联系方式。';

export const AGENT_FILE_SENSITIVE_EMPTY_NOTE = '正文里没有手机号、微信号、QQ 号与邮箱：这一份可以保存。';

/** 命中处最多列几条（行数很多时只列前几条，后面用「等」收口）。 */
export const AGENT_FILE_SENSITIVE_MAX_ROWS = 4;

/**
 * 遮蔽一段命中片段：`13800000000` → `138****0000`（与「用户管理」页的 `138****2026` 同一习惯），
 * `abc12345` → `ab****45`，`a1234567@qq.com` → `a1***@qq.com`。
 * 短片段只露头尾各一位 —— 提示里不回显完整号码。
 */
export function maskSensitiveText(value) {
  const text = String(value === null || value === undefined ? '' : value);
  if (!text) return '';
  const at = text.indexOf('@');
  if (at > 0) {
    const local = text.slice(0, at);
    const domain = text.slice(at);
    const head = local.slice(0, Math.min(2, local.length));
    return `${head}***${domain}`;
  }
  if (text.length >= 11) return `${text.slice(0, 3)}****${text.slice(-4)}`;
  if (text.length >= 8) return `${text.slice(0, 2)}****${text.slice(-2)}`;
  if (text.length >= 5) return `${text.slice(0, 1)}***${text.slice(-1)}`;
  return '*'.repeat(text.length);
}

/** 手机号：去掉分隔符后必须是 11 位（或 +86 前缀的 13 位），且前后不紧邻数字。 */
function isMobileHit(text, raw, start) {
  const end = start + raw.length;
  if (isDigit(text[start - 1]) || isDigit(text[end])) return false;
  const digits = raw.replace(/\D/g, '');
  return /^1[3-9]\d{9}$/.test(digits) || /^861[3-9]\d{9}$/.test(digits);
}

const RULE_VALIDATORS = {
  [AGENT_FILE_SENSITIVE_RULE_KEYS.mobile]: isMobileHit
};

/** 命中的一行文案：`第 3 行 微信号（abc****）`。 */
export function agentFileSensitiveHitText(hit) {
  const source = hit && typeof hit === 'object' ? hit : {};
  return `第 ${Number(source.line) || 1} 行 ${String(source.label || '')}（${String(source.masked || '')}）`;
}

/**
 * 扫描一段正文：返回**全部**命中（含规则代码 / 行号 / 遮蔽片段 / 所在行原文）。
 *
 * `hits` 按出现位置升序；`counts` 是每个规则的命中数；`rules` 是命中到的规则代码（去重）。
 * `text` 是命中处的一句话读数（提示与断言读它，不要在 JSX 里拼）。
 */
export function scanAgentFileSensitive(content) {
  const text = content === null || content === undefined ? '' : String(content);
  const hits = [];
  const covered = [];
  const overlaps = (start, end) => covered.some(([from, to]) => start < to && end > from);
  AGENT_FILE_SENSITIVE_RULES.forEach((rule) => {
    rule.sources.forEach((source) => {
      const pattern = new RegExp(source, 'g');
      let matched = pattern.exec(text);
      while (matched) {
        const raw = matched[0];
        const start = matched.index;
        const end = start + raw.length;
        // 空匹配（正则写坏时）也要前进，否则死循环。
        if (!raw) { pattern.lastIndex += 1; matched = pattern.exec(text); continue; }
        if (!overlaps(start, end)) {
          const validate = RULE_VALIDATORS[rule.key];
          if (!validate || validate(text, raw, start)) {
            // 带捕获组的规则（微信号 / QQ）只把**账号本身**当片段：命中 `微信：abc12345` 时
            // 遮蔽与展示都针对 `abc12345`，而不是把「微信：」也当成号码的一部分。
            const captured = matched.length > 1 && matched[1] ? String(matched[1]) : raw;
            covered.push([start, end]);
            hits.push({
              ruleKey: rule.key,
              label: rule.label,
              hint: rule.hint,
              match: raw,
              value: captured,
              masked: maskSensitiveText(captured),
              index: start,
              end,
              line: text.slice(0, start).split('\n').length,
              lineText: ''
            });
          }
        }
        matched = pattern.exec(text);
      }
    });
  });
  hits.sort((left, right) => left.index - right.index || left.line - right.line);
  // 所在行的展示文案：把**这一行上的全部命中**一起遮蔽（从后往前替换，前面的下标不受影响）——
  // 一行里既有微信号又有邮箱时，微信号那一行也不能把邮箱原样带出来。
  let maskedText = text;
  hits.slice().reverse().forEach((hit) => {
    maskedText = `${maskedText.slice(0, hit.index)}${hit.masked}${maskedText.slice(hit.end)}`;
  });
  const maskedLines = maskedText.split('\n');
  hits.forEach((hit) => {
    hit.lineText = String(maskedLines[hit.line - 1] || '').trim();
    delete hit.end;
  });
  const counts = {};
  hits.forEach((hit) => { counts[hit.ruleKey] = (counts[hit.ruleKey] || 0) + 1; });
  const rules = Object.keys(counts);
  const lineTexts = hits.map(agentFileSensitiveHitText);
  return {
    hits,
    counts,
    rules,
    count: hits.length,
    blocked: hits.length > 0,
    lines: hits.map((hit) => hit.line),
    rowTexts: lineTexts,
    maskedText,
    text: lineTexts.slice(0, AGENT_FILE_SENSITIVE_MAX_ROWS).join('、') + (lineTexts.length > AGENT_FILE_SENSITIVE_MAX_ROWS ? ' 等' : '')
  };
}

/** 界面上的读数：`检测到 2 处联系方式（微信号 1 处、手机号 1 处）`。 */
export function agentFileSensitiveText(scan) {
  const source = scan && typeof scan === 'object' ? scan : { count: 0, counts: {} };
  if (!source.count) return '未检测到联系方式';
  const detail = AGENT_FILE_SENSITIVE_RULES
    .filter((rule) => source.counts && source.counts[rule.key])
    .map((rule) => `${rule.label} ${source.counts[rule.key]} 处`)
    .join('、');
  return `检测到 ${source.count} 处联系方式（${detail}）`;
}

/**
 * 保存闸门：正文干净返回空串，命中联系方式返回**可读的阻断文案**（页面拿它当提示原文）。
 * `action` 是这次要做的动作（保存 / 复制为副本 / 回滚），读起来才不是一句套话。
 */
export function agentFileSensitiveIssue(content, { action = '保存' } = {}) {
  const scan = scanAgentFileSensitive(content);
  if (!scan.count) return '';
  return `正文里检测到联系方式：${scan.text}。${AGENT_FILE_SENSITIVE_NOTE}请改掉之后再做「${action}」。`;
}

/** 命中的逐行读数（编辑器里的实时告警读它，不要在 JSX 里现场拼）。 */
export function agentFileSensitiveRows(content) {
  const scan = scanAgentFileSensitive(content);
  return scan.hits.map((hit) => ({
    key: `${hit.ruleKey}-${hit.index}`,
    ruleKey: hit.ruleKey,
    label: hit.label,
    line: hit.line,
    masked: hit.masked,
    lineText: hit.lineText,
    text: agentFileSensitiveHitText(hit)
  }));
}
