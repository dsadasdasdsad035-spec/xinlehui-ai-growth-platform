/**
 * 极简 Markdown 解析（管理端 Markdown 编辑器的实时预览用，[第三步 US-106a]）。
 *
 * 零依赖纯函数，只解析「编辑器里需要看见的结构」：标题 / 段落 / 无序列表 / 有序列表 /
 * 引用 / 围栏代码 / 分隔线；行内只认 `**加粗**` 与 `` `代码` ``。
 *
 * 两个刻意的取舍：
 *  1. **不引第三方 markdown 库**：进提示词的是**原文**，预览只是编辑器的一个视图，
 *     解析器越小越好；解析结果也不参与任何加载判定。
 *  2. **产出结构化块，不产出 HTML 字符串**：页面用 React 渲染这些块，不需要
 *     `dangerouslySetInnerHTML`，于是「正文里写了 `<script>`」在预览里也只是一段文字。
 *
 * 与 `data/agentFiles.js` 同一套纪律：零依赖（不 import 任何模块、不碰 DOM），可直接 Node 断言。
 */

/** 标题层级上限（`#######` 之后按段落处理，与 CommonMark 一致）。 */
export const MARKDOWN_HEADING_MAX_LEVEL = 6;

/** 一次块级解析里最多接受的行数（防呆：超长正文不该把浏览器卡住）。 */
export const MARKDOWN_MAX_BLOCKS = 2000;

const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

/**
 * 行内解析：把 `**加粗**` 与 `` `代码` `` 切成片段，其余按纯文本。
 * 片段形如 `{ type: 'text' | 'strong' | 'code', text }`，顺序即原文顺序。
 */
export function parseMarkdownInline(text) {
  const source = text === null || text === undefined ? '' : String(text);
  if (!source) return [];
  const parts = [];
  let last = 0;
  INLINE_PATTERN.lastIndex = 0;
  let match = INLINE_PATTERN.exec(source);
  while (match) {
    if (match.index > last) parts.push({ type: 'text', text: source.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith('**')) parts.push({ type: 'strong', text: token.slice(2, -2) });
    else parts.push({ type: 'code', text: token.slice(1, -1) });
    last = match.index + token.length;
    match = INLINE_PATTERN.exec(source);
  }
  if (last < source.length) parts.push({ type: 'text', text: source.slice(last) });
  return parts.length ? parts : [{ type: 'text', text: source }];
}

const headingMatch = (line) => /^(#{1,6})\s+(.*)$/.exec(line);
const orderedMatch = (line) => /^(\d{1,3})[.)、]\s+(.*)$/.exec(line);
const unorderedMatch = (line) => /^[-*+]\s+(.*)$/.exec(line);
const quoteMatch = (line) => /^>\s?(.*)$/.exec(line);
const hrMatch = (line) => /^(\*{3,}|-{3,}|_{3,})$/.test(line);

/**
 * 块级解析。返回值是一串块：
 *  - `{ type: 'heading', level, text, inline }`
 *  - `{ type: 'paragraph', text, inline }`
 *  - `{ type: 'list', ordered: false, items: [{ text, inline }] }`
 *  - `{ type: 'ordered', ordered: true, start: 1, items: [{ text, inline }] }`
 *  - `{ type: 'quote', text, inline }`
 *  - `{ type: 'code', lang, text }`（围栏代码：内容**不做**行内解析）
 *  - `{ type: 'hr' }`
 * 段落内的换行保留（`text` 里带 `\n`），预览按 `white-space: pre-wrap` 渲染 ——
 * 中文正文里的换行是有意义的排版，合并成一行会让老师以为内容被吃掉了。
 */
export function parseMarkdownBlocks(text) {
  const lines = (text === null || text === undefined ? '' : String(text)).split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let list = null;
  let code = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const joined = paragraph.join('\n');
    blocks.push({ type: 'paragraph', text: joined, inline: parseMarkdownInline(joined) });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({
      type: list.ordered ? 'ordered' : 'list',
      ordered: list.ordered,
      start: list.start,
      items: list.items.map((item) => ({ text: item, inline: parseMarkdownInline(item) }))
    });
    list = null;
  };
  const flushAll = () => { flushParagraph(); flushList(); };

  for (let index = 0; index < lines.length; index += 1) {
    if (blocks.length >= MARKDOWN_MAX_BLOCKS) break;
    const raw = lines[index];
    const line = raw.trim();
    if (code) {
      if (/^```/.test(line)) {
        blocks.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
        code = null;
      } else {
        code.lines.push(raw);
      }
      continue;
    }
    if (/^```/.test(line)) {
      flushAll();
      code = { lang: line.replace(/^`+/, '').trim(), lines: [] };
      continue;
    }
    if (!line) { flushAll(); continue; }
    if (hrMatch(line)) { flushAll(); blocks.push({ type: 'hr' }); continue; }
    const heading = headingMatch(line);
    if (heading) {
      flushAll();
      const level = Math.min(MARKDOWN_HEADING_MAX_LEVEL, heading[1].length);
      blocks.push({ type: 'heading', level, text: heading[2].trim(), inline: parseMarkdownInline(heading[2].trim()) });
      continue;
    }
    const ordered = orderedMatch(line);
    if (ordered) {
      flushParagraph();
      const start = Number(ordered[1]) || 1;
      if (!list || !list.ordered || start !== list.start + list.items.length) list = { ordered: true, start, items: [] };
      list.items.push(ordered[2].trim());
      continue;
    }
    const unordered = unorderedMatch(line);
    if (unordered) {
      flushParagraph();
      if (!list || list.ordered) list = { ordered: false, start: 1, items: [] };
      list.items.push(unordered[1].trim());
      continue;
    }
    const quote = quoteMatch(line);
    if (quote) {
      flushAll();
      const body = quote[1].trim();
      blocks.push({ type: 'quote', text: body, inline: parseMarkdownInline(body) });
      continue;
    }
    flushList();
    paragraph.push(raw.replace(/\s+$/, ''));
  }
  if (code) blocks.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
  flushAll();
  return blocks;
}

/**
 * 编辑器的实时读数（字符数是验收原文，行数与块数是给老师的辅助信息）。
 * `chars` 与 `String.length` 同一口径：**含空格与换行**（提示词的预算也是按这个数算的）。
 */
export function markdownStats(text) {
  const source = text === null || text === undefined ? '' : String(text);
  const lines = source ? source.split(/\r?\n/).length : 0;
  const blocks = parseMarkdownBlocks(source);
  return {
    chars: source.length,
    lines,
    blocks: blocks.length,
    headings: blocks.filter((block) => block.type === 'heading').length,
    listItems: blocks.filter((block) => block.type === 'list' || block.type === 'ordered').reduce((sum, block) => sum + block.items.length, 0),
    codeBlocks: blocks.filter((block) => block.type === 'code').length,
    paragraphs: blocks.filter((block) => block.type === 'paragraph').length
  };
}

/** 一行读数文案（面板与断言读同一份，避免各处自己拼）。 */
export function markdownStatsText(text) {
  const stats = markdownStats(text);
  const parts = [`${stats.chars} 字`, `${stats.lines} 行`];
  if (stats.headings) parts.push(`标题 ${stats.headings}`);
  if (stats.listItems) parts.push(`列表项 ${stats.listItems}`);
  if (stats.codeBlocks) parts.push(`代码块 ${stats.codeBlocks}`);
  return parts.join(' · ');
}
