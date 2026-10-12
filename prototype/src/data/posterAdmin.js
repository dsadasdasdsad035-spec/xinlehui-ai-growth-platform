/**
 * 管理端「海报模板」的数据层（[海报 US-312a] / F-POSTER-ADMIN-01 / FR-355、FR-356、FR-359）。
 *
 * 这一页要解决的事：**没有设计交付也能做出一套海报版式**。所以参数面板把 spec 的每一个可编辑叶子
 * 都摆出来（画布 / 背景 / 边框 / 装饰线 / 每个 slot 的类型与位置尺寸样式 / 字体与字号比例 / 二维码尺寸），
 * 右侧预览用**与老师端同一支渲染分派**（`services/posterDialog.js` 的 `renderPosterDialog`）当场出图。
 *
 * 本模块是**零依赖纯函数 + 常量**（只 import 其它 data 模块），Node 直跑断言，三条纪律：
 *
 *   ① **写权限不发明第二套**：三层归属（platform / org / teacher）的写规则整支复用装裱的
 *      `data/framingPermissions.js`（PRD 9.2 第 7 条）。本模块只做一层薄壳（`posterAdminTemplateWriteIssue`），
 *      把「这套模板能不能被当前会话写」与「它由谁维护」翻译成海报侧的读数 —— 判定逻辑一个字都不抄。
 *      平台管理员只写 platform 层：机构模板与老师的个人模板在这一页**可见但只读**（列表要读全量）。
 *   ② **界面不认识 spec 的字段名**：面板要渲染哪些控件、每个控件写哪个路径，全由这里的描述表给出
 *      （`posterAdminSlotFieldRows` / `POSTER_ADMIN_SECTION_FIELDS`）。界面只做两件事：按描述渲染控件、
 *      把改动交给 `posterAdminSetPath()`。于是「面板覆盖了哪些参数」是可数的（`posterAdminPanelCoverage`），
 *      断言与面板读同一份。
 *   ③ **预览的样例数据是「夹具」，不是第二份真源**：`posterAdminPreviewPlan()` 造的是**与五类版式同形**的
 *      plan（`hasRecord` / `hasStudent` / `hasClass` / `hasObject` / `pages` 五个门都在），
 *      交给 `renderPosterDialog()` 出图 —— 预览与老师端出图是同一次绘制的两个倍数，
 *      **不存在「后台预览一套画法、老师端另一套」**。
 *
 * 与老师端的关系：存下的平台模板在老师端「一键转发」弹窗里按同一套可见性/适用性规则出现
 * （`posterDialogTemplateRows`），所以这一页新增的模板**默认停用**（草稿态）——
 * 参数没确认就漏到老师端是最容易犯的错；参数调好、预览确认后点「启用」。
 */

import {
  DEFAULT_POSTER_BACKGROUND,
  DEFAULT_POSTER_KIND,
  POSTER_BACKGROUND_TYPES,
  POSTER_CANVAS_EDGE_RANGE,
  POSTER_CANVAS_PRESETS,
  POSTER_ENTRY_SCOPES,
  POSTER_ENTRY_SCOPE_LABELS,
  POSTER_FONT_WHITELIST,
  POSTER_FONT_WEIGHTS,
  POSTER_IMAGE_FITS,
  POSTER_KIND_LABELS,
  POSTER_KINDS,
  POSTER_MAX_LINES_RANGE,
  POSTER_SLOT_TYPE_LABELS,
  POSTER_SLOT_TYPES,
  POSTER_TEMPLATE_DESCRIPTION_MAX,
  POSTER_TEMPLATE_NAME_MAX,
  POSTER_TEMPLATE_SORT_FALLBACK,
  POSTER_TEXT_ALIGNS,
  POSTER_VARIABLES,
  normalizePosterSpec,
  normalizePosterTemplate,
  normalizePosterTemplateName,
  posterSpecIssues,
  posterTemplateIssues,
  posterTemplateKey,
  posterTemplateNameIssue,
  posterUnknownVariables,
  sortPosterTemplates
} from './posterTemplates';
import { DEFAULT_ORG_NAME, DEFAULT_ORG_ID } from './lessons';
import { FRAMING_PRESET_READONLY_NOTE, framingPresetWriteIssue, framingPresetWriteOwnerText } from './framingPermissions';

/** 路由 id（`PageRouter` 的 map 键 / 侧边栏 `navByRole.admin` 的键），三处必须同名。 */
export const POSTER_ADMIN_PAGE_ID = 'posterTemplates';

/** 列表入参的兜底（`posterTemplates.js` 的 `list()` 是那个模块的私有函数，这里用自己的一份）。 */
const safeList = (value) => (Array.isArray(value) ? value : []);

export const POSTER_ADMIN_TITLE = '海报模板';
export const POSTER_ADMIN_DESC = '维护海报版式：改参数看实时预览（与老师端出图同一支渲染），新增的模板先停用，确认无误再启用。';

// ---------------------------------------------------------------------------
// 库列表：三层分组（系统 / 机构 / 老师个人）
//
// 验收原文「模板列表（系统、机构、老师个人只读）」说的是两件事：
//   · 列表要**读全量**（三层都在），因为管理员要知道这套版式在全平台长什么样；
//   · 只有平台层（系统）可写，机构层与老师个人层**只读** —— 那是别人的地盘（`framingPresetWriteIssue`）。
// ---------------------------------------------------------------------------

/** 分组标题（与 `POSTER_TEMPLATE_SCOPE_LABELS` 的徽标用词不同：这里是分组的说法）。 */
export const POSTER_ADMIN_SCOPE_GROUP_LABELS = {
  platform: '系统模板',
  org: '机构模板',
  teacher: '老师个人模板'
};

/** 分组顺序：系统 → 机构 → 老师个人（列表从上往下）。 */
export const POSTER_ADMIN_SCOPE_GROUP_ORDER = ['platform', 'org', 'teacher'];

/** 分组副标题：每组一句话说清「这一层归谁维护、这一页能不能改」。 */
export const POSTER_ADMIN_SCOPE_GROUP_NOTES = {
  platform: '平台统一版式：本会话（平台管理员）可改参数、可增可复制。',
  org: '按机构维护的版式：本页可见但只读，写入由机构管理员的会话完成。',
  teacher: '老师自己另存的版式：管理端只读，参数与归属都不在这里改动。'
};

/** 当前会话对这套模板的写判定（唯一真源是装裱那一支；返回空串表示可写）。 */
export function posterAdminTemplateWriteIssue(template, viewer = {}) {
  return framingPresetWriteIssue(template, viewer);
}

/** 「这套模板由谁维护」（只读行上的说明读它）。 */
export function posterAdminTemplateWriteOwnerText(template) {
  return framingPresetWriteOwnerText(template);
}

/** 不可写时的统一说明（与装裱逐字一致：三层各一句）。 */
export const POSTER_ADMIN_READONLY_NOTE = FRAMING_PRESET_READONLY_NOTE;

/** 只读行的徽标文案。 */
export const POSTER_ADMIN_READONLY_BADGE = '只读';

/**
 * 列表分组（一次给出「界面要画什么」）：
 * 每组带 `writable`（这一层的模板在本会话能不能写）、`rows`（已按库顺序排好的模板）。
 * 空组不返回 —— 界面上不出现「机构模板（0）」这种空标题。
 */
export function posterAdminLibraryGroups(templates, viewer = {}) {
  const ordered = sortPosterTemplates(templates);  return POSTER_ADMIN_SCOPE_GROUP_ORDER
    .map((scope) => {
      const rows = ordered.filter((template) => template.scope === scope);
      return {
        scope,
        label: POSTER_ADMIN_SCOPE_GROUP_LABELS[scope],
        note: POSTER_ADMIN_SCOPE_GROUP_NOTES[scope],
        rows,
        // 「这一层能不能写」= 逐条判定的结果（本会话对 platform 一律可写；机构 / 老师层一律只读）。
        writable: rows.length > 0 && rows.every((template) => posterAdminTemplateWriteIssue(template, viewer) === '')
      };
    })
    .filter((group) => group.rows.length > 0);
}

/**
 * 进页面时默认选中哪一套：**第一套平台模板**（本会话唯一写得动的那一层），
 * 平台层为空时退回列表第一套（此时整页只读，选中的那套会解释「由谁维护」）。
 */
export function posterAdminDefaultTemplateId(templates) {
  const ordered = sortPosterTemplates(templates);
  const platform = ordered.find((template) => template.scope === 'platform');
  return (platform || ordered[0] || { id: '' }).id;
}

/**
 * 「这一行还没保存」的判据（列表上的徽标）：两种情形都算 ——
 *   ① 这份模板压根不在**已保存的那一份**里（本次新增 / 复制的草稿）；
 *   ② 它是当前草稿，而且草稿与已保存的那一份不同（改了参数还没点保存）。
 * 两种分开数（`unsaved` 是①的清单），界面与断言读同一份，别在组件里现算。
 */
export function posterAdminUnsavedTemplateIds(templates, persisted) {
  const saved = new Set(safeList(persisted).map((item) => posterTemplateKey(item)).filter(Boolean));
  return sortPosterTemplates(templates).filter((template) => !saved.has(template.id)).map((template) => template.id);
}

/** 列表行的「未保存」读数（界面逐行渲染）。 */
export function posterAdminDraftState({ templates = [], persisted = [], editingId = '', dirty = false } = {}) {
  const unsaved = posterAdminUnsavedTemplateIds(templates, persisted);
  return {
    unsaved,
    rowUnsaved: (id) => unsaved.includes(id) || (String(id) === String(editingId) && dirty === true)
  };
}

/** 列表里一行模板的可读读数（界面逐行渲染；断言读同一份，不在组件里现算）。 */
export function posterAdminRowView(template, viewer = {}) {
  const item = normalizePosterTemplate(template);
  const issue = posterAdminTemplateWriteIssue(item, viewer);
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    kindLabel: POSTER_KIND_LABELS[item.kind] || item.kind,
    scope: item.scope,
    scopeLabel: POSTER_ADMIN_SCOPE_GROUP_LABELS[item.scope] || item.scope,
    entryScope: item.entryScope,
    entryLabel: POSTER_ENTRY_SCOPE_LABELS[item.entryScope] || '',
    enabled: item.enabled !== false,
    builtin: item.builtin === true,
    isDefault: item.isDefault === true,
    active: item.enabled !== false,
    writable: issue === '',
    readonlyReason: issue,
    ownerText: posterAdminTemplateWriteOwnerText(item),
    canvas: `${item.spec.canvas.width}×${item.spec.canvas.height}`,
    slotCount: item.spec.slots.length
  };
}

// ---------------------------------------------------------------------------
// 参数面板：控件描述表（界面按它渲染，因此「面板覆盖了哪些参数」是可数的）
//
// 控件种类只有五种，界面里各有一段渲染：`number` / `color` / `text` / `select` / `check`。
// 每个描述项 `path` 都是**相对 spec 的路径**（`posterAdminSetPath()` 认的格式），
// 槽内字段则相对该 slot（`slots[i].` 由界面拼上）。
// ---------------------------------------------------------------------------

export const POSTER_ADMIN_BACKGROUND_TYPE_LABELS = { solid: '纯色', 'linear-gradient': '线性渐变' };

const number = (path, label, range = {}, step = 0.001, hint = '') => ({
  path, label, control: 'number',
  min: Number.isFinite(range.min) ? range.min : undefined,
  max: Number.isFinite(range.max) ? range.max : undefined,
  step, hint
});
const color = (path, label, hint = '') => ({ path, label, control: 'color', hint });
const text = (path, label, hint = '') => ({ path, label, control: 'text', hint });
const check = (path, label, hint = '') => ({ path, label, control: 'check', hint });
const select = (path, label, options, hint = '') => ({ path, label, control: 'select', options, hint });
const option = (list) => list.map((value) => ({ value, label: value }));

/** spec 顶层四组（画布 / 背景 / 边框 / 装饰线）的控件。 */
export const POSTER_ADMIN_SECTION_FIELDS = {
  canvas: [
    number('canvas.width', '画布宽度（px）', POSTER_CANVAS_EDGE_RANGE, 10, '短边是比例坐标的尺子'),
    number('canvas.height', '画布高度（px）', POSTER_CANVAS_EDGE_RANGE, 10, '长图可以比宽度大得多')
  ],
  background: [
    select('background.type', '背景类型', POSTER_BACKGROUND_TYPES.map((value) => ({ value, label: POSTER_ADMIN_BACKGROUND_TYPE_LABELS[value] || value }))),
    number('background.angle', '渐变角度', { min: 0, max: 360 }, 5),
    color('background.stops.0', '起始色'),
    color('background.stops.1', '结束色', '纯色背景只用起始色')
  ],
  frame: [
    check('frame.enabled', '显示边框'),
    color('frame.color', '边框颜色'),
    number('frame.widthRatio', '边框宽度比例', { min: 0.001, max: 0.06 }, 0.001, '相对画布短边'),
    number('frame.cornerRadiusRatio', '圆角半径比例', { min: 0, max: 0.5 }, 0.005)
  ],
  decor: [
    check('decor.hairline.visible', '显示装饰线'),
    color('decor.hairline.color', '装饰线颜色'),
    number('decor.hairline.widthRatio', '装饰线粗细比例', { min: 0.0005, max: 0.01 }, 0.0005),
    number('decor.hairline.x', '装饰线横坐标比例', { min: -0.5, max: 4 }, 0.005),
    number('decor.hairline.y', '装饰线纵坐标比例', { min: -0.5, max: 4 }, 0.005),
    number('decor.hairline.w', '装饰线长度比例', { min: 0.01, max: 4 }, 0.005),
    number('decor.hairline.opacity', '装饰线不透明度', { min: 0, max: 1 }, 0.05)
  ]
};

/** slot 的公共控件（每种类型都有）+ 分类型的控件（AC 原文的「位置尺寸样式 / 字体字号比例 / 二维码尺寸」）。 */
export const POSTER_ADMIN_SLOT_FIELDS = {
  common: [
    check('visible', '显示这一位'),
    number('x', '横坐标比例', { min: -0.5, max: 4 }, 0.005),
    number('y', '纵坐标比例', { min: -0.5, max: 4 }, 0.005),
    number('opacity', '不透明度', { min: 0, max: 1 }, 0.05)
  ],
  image: [
    number('w', '作品宽度比例', { min: 0.01, max: 4 }, 0.005),
    number('h', '作品高度比例', { min: 0.01, max: 4 }, 0.005),
    select('fit', '适配方式', option(POSTER_IMAGE_FITS), '只支持 contain：不裁切作品'),
    color('bg', '卡片底色'),
    number('radiusRatio', '圆角半径比例', { min: 0, max: 0.5 }, 0.005),
    number('paddingRatio', '内边距比例', { min: 0, max: 0.1 }, 0.002),
    check('shadow', '卡片投影'),
    color('border.color', '卡片描边色'),
    number('border.widthRatio', '描边粗细比例', { min: 0.0005, max: 0.01 }, 0.0005),
    number('grid.columns', '拼贴列数', { min: 0, max: 8 }, 1, '0 = 按幅数自适应'),
    number('grid.rows', '拼贴行数', { min: 0, max: 8 }, 1, '0 = 按幅数自适应'),
    number('grid.gapRatio', '拼贴间距比例', { min: 0, max: 0.1 }, 0.002),
    number('grid.maxItems', '格子上限', { min: 1, max: 60 }, 1),
    check('cellCaption.visible', '格下标注'),
    select('cellCaption.position', '标注位置', [{ value: 'below', label: '格下方' }, { value: 'above', label: '格上方' }]),
    number('cellCaption.sizeRatio', '标注字号比例', { min: 0.008, max: 0.4 }, 0.002),
    color('cellCaption.color', '标注颜色'),
    number('cellCaption.maxLines', '标注最多行数', POSTER_MAX_LINES_RANGE, 1)
  ],
  text: [
    number('w', '文字宽度比例', { min: 0.01, max: 4 }, 0.005),
    select('align', '对齐', [{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }]),
    select('font', '字体', option(POSTER_FONT_WHITELIST)),
    select('weight', '字重', POSTER_FONT_WEIGHTS.map((value) => ({ value, label: value === 'bold' ? '加粗' : '常规' }))),
    number('sizeRatio', '字号比例', { min: 0.008, max: 0.4 }, 0.002, '相对画布短边'),
    color('color', '文字颜色'),
    number('maxLines', '最多行数', POSTER_MAX_LINES_RANGE, 1),
    number('lineHeight', '行高倍数', { min: 0.8, max: 2.5 }, 0.05),
    number('letterSpacingRatio', '字距比例', { min: 0, max: 0.05 }, 0.001),
    text('template', '文案模板', `可用变量：${POSTER_VARIABLES.map((name) => `{${name}}`).join(' ')}`)
  ],
  qrcode: [
    number('sizeRatio', '二维码尺寸比例', { min: 0.05, max: 0.4 }, 0.005, '相对画布短边；太小会扫不出来'),
    text('value', '二维码内容', '支持 {分享链接} 变量'),
    text('caption', '二维码下方说明'),
    number('captionSizeRatio', '说明字号比例', { min: 0.008, max: 0.4 }, 0.002),
    color('captionColor', '说明颜色'),
    color('bg', '二维码底色')
  ],
  logo: [
    number('maxWRatio', 'Logo 宽度比例', { min: 0.04, max: 0.6 }, 0.005),
    text('url', 'Logo 图片地址', '留空用渲染时传进来的机构 Logo')
  ]
};

/** 某个 slot 的控件清单（公共 + 该类型）。 */
export function posterAdminSlotFieldRows(slot = {}) {
  const type = POSTER_SLOT_TYPES.includes(slot.type) ? slot.type : POSTER_SLOT_TYPES[0];
  return [...POSTER_ADMIN_SLOT_FIELDS.common, ...(POSTER_ADMIN_SLOT_FIELDS[type] || [])];
}

/**
 * 面板**故意不覆盖**的 spec 路径（结构位而不是参数）：
 *   · `version` —— spec 版本号，随收敛器走，不给人改；
 *   · `background.image` —— 预留字段位（PRD 9.2 第 1 条：插画 / 手绘底图列第二期，先把字段留好）；
 *   · `slots.N.id` —— 占位区的**身份键**（渲染层按它找素材：`data.images[slot.id]`），改名等于换一套版式，
 *     因此面板只读不改（要新 id 就新建一个占位区）。
 */
export const POSTER_ADMIN_NON_EDITABLE_PATHS = ['version', 'background.image'];
export const POSTER_ADMIN_NON_EDITABLE_SUFFIXES = ['.id'];

/**
 * 面板**覆盖到**的 spec 叶子路径（含每个 slot 自己的控件路径）。
 * 验收原文列的六类参数（画布尺寸与类型 / 背景 / 边框 / 装饰线 / 每个 slot 的类型与位置尺寸样式 /
 * 字体与字号比例 / 二维码尺寸）都落在这张表里 —— 断言逐条比它，不靠肉眼。
 */
export function posterAdminPanelCoverage(spec) {
  const normalized = normalizePosterSpec(spec);
  const paths = [];
  Object.values(POSTER_ADMIN_SECTION_FIELDS).forEach((rows) => rows.forEach((row) => paths.push(row.path)));
  paths.push('kind');
  normalized.slots.forEach((slot, index) => {
    paths.push(`slots.${index}.type`);
    posterAdminSlotFieldRows(slot).forEach((row) => paths.push(`slots.${index}.${row.path}`));
  });
  return paths;
}

/**
 * 面板没有覆盖到的可编辑叶子（正常应为空；有值说明描述表漏了一档 —— 这就是「面板覆盖全参数」的机器判据）。
 * 数组按下标展开（`slots.0.x` / `background.stops.0`），因此「整段没覆盖」也会被点名。
 */
export function posterAdminPanelMissingFields(spec) {
  const covered = new Set(posterAdminPanelCoverage(spec));
  const leaves = [];
  const walk = (value, prefix) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${prefix}.${index}`));
      return;
    }
    if (value && typeof value === 'object') {
      Object.keys(value).forEach((key) => walk(value[key], prefix ? `${prefix}.${key}` : key));
      return;
    }
    leaves.push(prefix);
  };
  walk(normalizePosterSpec(spec), '');
  return leaves.filter((path) => !covered.has(path)
    && !POSTER_ADMIN_NON_EDITABLE_PATHS.includes(path)
    && !POSTER_ADMIN_NON_EDITABLE_SUFFIXES.some((suffix) => path.endsWith(suffix)));
}

// ---------------------------------------------------------------------------
// 写入：一个通用深写 + 一处类型切换（界面不认识字段名，因此也不写死任何路径）
// ---------------------------------------------------------------------------

/**
 * 输入框文本 → 要写进草稿的值。
 *
 * **空串保持空串**（用户正在清空这一格）；只有「原样能往返」的数字串才转成数字
 * （`String(Number(raw)) === raw`），其余一律**原样保留文本** —— 于是正在输入的 `.` / `0.` / `-`
 * 不会被吞掉（「打 0.5 变成 5」那种毛病），非法值交给 `normalizePosterSpec()` 在渲染 / 保存时收敛。
 */
export function posterAdminInputValue(value) {
  if (typeof value === 'number') return value;
  const raw = value === null || value === undefined ? '' : String(value).trim();
  if (raw === '') return '';
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && String(parsed) === raw) return parsed;
  return raw;
}

/** 深写：返回一份**新对象**（`path` 用点号分段，数组下标也走点号）。 */
export function posterAdminSetPath(value, path, next) {
  const keys = String(path || '').split('.').filter((key) => key !== '');
  if (!keys.length) return value;
  const clone = (node) => (Array.isArray(node) ? node.slice() : { ...(node && typeof node === 'object' ? node : {}) });
  const root = clone(value);
  let cursor = root;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    const child = cursor[key];
    const copy = clone(child && typeof child === 'object' ? child : {});
    cursor[key] = copy;
    cursor = copy;
  }
  cursor[keys[keys.length - 1]] = next;
  return root;
}

/** 读（面板显示值优先用草稿里的**原值**，读不到才回落收敛值）。 */
export function posterAdminReadPath(value, path, fallback = '') {
  const keys = String(path || '').split('.').filter((key) => key !== '');
  let cursor = value;
  for (const key of keys) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return fallback;
    cursor = cursor[key];
  }
  return cursor === undefined || cursor === null ? fallback : cursor;
}

/** 改类型：spec 与模板记录的 `kind` 一起改（两处必须一致，否则画布预设与版式对不上）。 */
export function posterAdminKindPatch(template, kind) {
  const item = normalizePosterTemplate(template);
  const next = POSTER_KINDS.includes(kind) ? kind : DEFAULT_POSTER_KIND;
  const base = template && typeof template.spec === 'object' && template.spec ? template.spec : item.spec;
  return { ...template, kind: next, spec: { ...base, kind: next } };
}

/** 该类型的默认画布（面板上的「用该类型的默认画布」按钮写它）。 */
export function posterAdminKindCanvas(kind) {
  const preset = POSTER_CANVAS_PRESETS[kind] || POSTER_CANVAS_PRESETS[DEFAULT_POSTER_KIND];
  return { width: preset.width, height: preset.height };
}

/**
 * 把画布换成该类型预设（长图高度这类口径随类型走，别让人手抄两个数）。
 * 入参是**spec**（与其他写入同一条路径口径）；类型取 spec 自己的 `kind`。
 */
export function posterAdminCanvasPresetPatch(spec) {
  const kind = normalizePosterSpec(spec).kind;
  const canvas = posterAdminKindCanvas(kind);
  let next = posterAdminSetPath(spec, 'canvas.width', canvas.width);
  next = posterAdminSetPath(next, 'canvas.height', canvas.height);
  return next;
}

/**
 * 换 slot 的类型：保留 id / 位置（`x` / `y`）与显隐，其余字段取该类型的默认值。
 * 为什么不保留其它字段：`text` 的 `sizeRatio` 与 `qrcode` 的 `sizeRatio` 口径不同
 * （字号比例 vs 二维码边长比例），搬过去就是把一个合法数字塞进另一个语义 —— 宁可回到默认值。
 */
export function posterAdminSlotTypePatch(spec, index, type) {
  const normalized = normalizePosterSpec(spec);
  const slot = normalized.slots[index];
  const next = POSTER_SLOT_TYPES.includes(type) ? type : POSTER_SLOT_TYPES[0];
  if (!slot) return spec;
  if (slot.type === next) return spec;
  const base = posterAdminSlotDefault(next);
  const merged = {
    ...base,
    id: slot.id,
    x: slot.x,
    y: slot.y,
    visible: slot.visible !== false,
    opacity: slot.opacity
  };
  return posterAdminSetPath(spec, `slots.${index}`, merged);
}

/** 某类型的默认 slot（与 `normalizePosterSlot()` 的回落是同一套值：借它自己补默认字段）。 */
export function posterAdminSlotDefault(type) {
  const key = POSTER_SLOT_TYPES.includes(type) ? type : POSTER_SLOT_TYPES[0];
  return normalizePosterSpec({ slots: [{ id: 'slot', type: key, x: 0.1, y: 0.1, w: 0.5, h: 0.5 }] }).slots[0];
}

// ---------------------------------------------------------------------------
// 新增 / 复制为副本（AC5）
//
// 两条纪律：
//   ① **新模板一律 `enabled: false`**（草稿态）：参数还没确认就漏到老师端是最容易犯的错，
//      「启用」是一个显式动作（AC 原文也是「新增一套模板并启用」）。
//   ② **id 只能是随机唯一值**：`template_key` 是云端 upsert 的冲突键，不能由名字派生
//      （同名复制会静默覆盖源模板）—— 与 `buildTeacherPosterTemplate` 同一条口径。
// ---------------------------------------------------------------------------

/** 在现有列表里找一个不重名的名字：`base`、`base 2`、`base 3`…（重名由 data 层唯一判定）。 */
export function posterAdminUniqueName(templates, base) {
  const list = Array.isArray(templates) ? templates : [];
  const clean = normalizePosterTemplateName(base, '新海报模板');
  if (!posterTemplateNameIssue(clean, list)) return clean;
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${clean} ${index}`;
    if (!posterTemplateNameIssue(candidate, list)) return candidate;
  }
  return clean;
}

/** 列表最后的排序号 + 1（新模板排在列表最后；上限 999 与收敛器同一口径）。 */
export function posterAdminNextSortOrder(templates) {
  const list = sortPosterTemplates(templates);
  const last = list.length ? list[list.length - 1].sortOrder : POSTER_TEMPLATE_SORT_FALLBACK - 1;
  return Math.min(999, Math.max(0, Math.trunc(Number(last) || 0) + 1));
}

/** 「新增模板」：一套空白的平台模板（spec 取该类型的默认版式）。 */
export function posterAdminNewTemplate({ kind = DEFAULT_POSTER_KIND, templates = [], actor = '' } = {}) {
  const type = POSTER_KINDS.includes(kind) ? kind : DEFAULT_POSTER_KIND;
  const now = Date.now();
  const canvas = posterAdminKindCanvas(type);
  return normalizePosterTemplate({
    id: `poster-admin-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: posterAdminUniqueName(templates, `新海报模板 · ${POSTER_KIND_LABELS[type] || type}`),
    description: '',
    kind: type,
    spec: { kind: type, canvas },
    scope: 'platform',
    ownerKey: '',
    entryScope: 'both',
    enabled: false,
    builtin: false,
    isDefault: false,
    sortOrder: posterAdminNextSortOrder(templates),
    updatedBy: String(actor || ''),
    updatedAt: new Date(now).toISOString()
  });
}

/**
 * 「复制为副本」：参数逐字段照抄（含 spec 的每一个叶子）、名字换一个不重名的、id 换新。
 * 副本落在**平台层**（本会话是平台管理员，只能写这一层），并同样先停用（草稿态）。
 */
export function posterAdminCopyTemplate(source, { templates = [], actor = '' } = {}) {
  const item = normalizePosterTemplate(source);
  const now = Date.now();
  return normalizePosterTemplate({
    ...item,
    id: `poster-copy-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: posterAdminUniqueName(templates, `${item.name} 副本`),
    scope: 'platform',
    ownerKey: '',
    builtin: false,
    isDefault: false,
    enabled: false,
    sortOrder: posterAdminNextSortOrder(templates),
    updatedBy: String(actor || item.updatedBy),
    updatedAt: new Date(now).toISOString()
  });
}

// ---------------------------------------------------------------------------
// 保存前的读数（与装裱面板同一口径：**收敛不改阻塞**，重名 / 空名才拦）
// ---------------------------------------------------------------------------

export const POSTER_ADMIN_SAVE_NOTE = '保存只写模板本身：老师端已经导出、转发或下载过的海报文件不会被改动。';
export const POSTER_ADMIN_CONVERGE_NOTE = '越界或非法的参数在保存时被收敛成安全值（渲染用的就是收敛后的值）。';
export const POSTER_ADMIN_DRAFT_NOTE = '新增与复制的模板先停用（草稿态）：参数调好、预览确认后点「启用」，老师端才会出现。';

/** 未知变量读数（占位区 → 不在白名单的变量名），面板逐行渲染。 */
export function posterAdminUnknownVariableRows(spec) {
  const normalized = normalizePosterSpec(spec);
  const rows = [];
  normalized.slots.forEach((slot) => {
    const raw = slot.type === 'qrcode' ? slot.value : slot.type === 'text' ? slot.template : '';
    posterUnknownVariables(raw).forEach((name) => {
      rows.push({ slotId: slot.id, slotLabel: POSTER_SLOT_TYPE_LABELS[slot.type] || slot.type, name });
    });
  });
  return rows;
}

/**
 * 保存前的完整读数：`{ nameIssue, templateIssues, specIssues, unknownRows, ready, blockers, note }`。
 * 只有**没名字 / 重名 / 缺 id** 拦保存；收敛与未知变量是如实读数（提示但放行）。
 */
export function posterAdminSaveFacts(template, { templates = [] } = {}) {
  const item = normalizePosterTemplate(template);
  // 空名要按**原值**判：收敛器会把空名兜底成「未命名海报」，用收敛后的名字判就永远判不出来。
  const rawName = normalizePosterTemplateName(template && template.name);
  const nameIssue = posterTemplateNameIssue(rawName, templates, { exceptId: item.id });
  const templateIssues = posterTemplateIssues(template);
  const specIssues = posterSpecIssues(template && template.spec);
  const unknownRows = posterAdminUnknownVariableRows(template && template.spec);
  const blockers = [];
  if (nameIssue) blockers.push(nameIssue);
  const idIssue = templateIssues.find((issue) => issue.path === 'id');
  if (idIssue) blockers.push(idIssue.message);
  return {
    name: rawName,
    nameIssue,
    templateIssues,
    specIssues,
    unknownRows,
    blockers,
    ready: blockers.length === 0,
    note: POSTER_ADMIN_SAVE_NOTE
  };
}

// ---------------------------------------------------------------------------
// 实时预览（AC4）：与老师端同一支渲染分派
//
// 这一步只造**plan**（形状与五类版式一致：门字段 + spec + data），出图交给
// `services/posterDialog.js` 的 `renderPosterDialog()` —— 于是「后台预览」与「老师端那张图」
// 走的是同一组 `renderPosterX()` → 同一个 `renderPoster()`，只差倍数。
// ---------------------------------------------------------------------------

/** 预览的样例变量（15 个变量全部有值：每个文字位都能画出来，才能看出排版好不好）。 */
export const POSTER_ADMIN_PREVIEW_DATA = {
  studentName: '陈一诺',
  artworkTitle: '向着光的花',
  period: '2026 春季学期',
  date: '2026-08-04',
  teacherName: '林晓老师',
  orgName: DEFAULT_ORG_NAME,
  quote: '冷暖对比很果断，花心那几笔敢用纯色，画面很有呼吸感。',
  className: '周六创意绘画 2 班',
  courseName: '创意水彩',
  summary: '一学期下来，从不敢下笔到主动叠色，画面从单薄变得有层次。',
  title: '向着光的花',
  artworkCount: 12,
  lessonCount: 12,
  duration: '01:36',
  shareUrl: 'https://xinlehui.example.com/p/preview'
};

/** 样例里每格标注的课次日期（与 `{日期}` 同一格式）。 */
export const POSTER_ADMIN_PREVIEW_DATES = [
  '2026.03.01', '2026.03.15', '2026.03.29', '2026.04.12',
  '2026.04.26', '2026.05.10', '2026.05.24', '2026.06.07', '2026.06.21'
];

/**
 * 单幅代表作位的 id 约定：`artwork`（单作品）/ `cover`（视频封面、长图头图）= **一幅**。
 * 与开发自检 `services/posterSelfCheck.js` 的 `SELF_CHECK_SINGLE_IMAGE_SLOTS` 是同一份约定
 * （那边只对内置模板跑，这边对正在编辑的模板跑，因此各留一份常量 + 断言比对两份一致）；
 * 给单图位塞 9 张会让「单作品」模板被画成九宫格 —— 那是样例的错，不是模板的错。
 */
export const POSTER_ADMIN_SINGLE_IMAGE_SLOT_IDS = ['artwork', 'cover'];

/** 预览里某个 image 位要喂几幅：写死行列 → 行列乘积；单图位 → 1；自适应 → `maxItems`（封顶 9）。 */
export function posterAdminPreviewArtworkCount(slot = {}) {
  const grid = slot && typeof slot.grid === 'object' && slot.grid ? slot.grid : {};
  const columns = Math.max(0, Math.trunc(Number(grid.columns) || 0));
  const rows = Math.max(0, Math.trunc(Number(grid.rows) || 0));
  if (columns > 0 && rows > 0) return Math.min(60, columns * rows);
  if (POSTER_ADMIN_SINGLE_IMAGE_SLOT_IDS.includes(String(slot.id || ''))) return 1;
  const maxItems = Math.max(1, Math.trunc(Number(grid.maxItems) || 1));
  return Math.min(POSTER_ADMIN_PREVIEW_DATES.length, maxItems);
}

/**
 * 预览的 plan：按**模板记录的类型**分派门字段（五类版式各自要的那一个），data 用样例变量 + 按槽分好的素材。
 * `artworks` 是服务层合成的示例作品图（data 层不碰 canvas，只负责怎么分配）。
 *
 * 为什么类型取「模板记录的 `kind`」而不是 spec 里的：老师端弹窗是按 `template.kind` 分派装配的
 * （`buildPosterDialogPlan`），所以后台预览要跟它一致 —— 老数据里两者不一致时（记录说长图、
 * spec 说单作品），预览显示的仍然是老师端会得到的那一支，不会出现「后台看着是单作品、老师端出长图」。
 */
export function posterAdminPreviewPlan({ kind = '', spec, artworks = [], logo = '' } = {}) {
  const normalized = normalizePosterSpec(spec);
  const resolved = POSTER_KINDS.includes(kind) ? kind : normalized.kind;
  const pool = (Array.isArray(artworks) ? artworks : []).filter(Boolean);
  const images = {};
  normalized.slots.forEach((slot) => {
    if (slot.type !== 'image' || slot.visible === false) return;
    const count = posterAdminPreviewArtworkCount(slot);
    images[slot.id] = Array.from({ length: count }, (_, index) => ({
      url: pool.length ? pool[index % pool.length] : '',
      caption: POSTER_ADMIN_PREVIEW_DATES[index % POSTER_ADMIN_PREVIEW_DATES.length]
    }));
  });
  const data = { ...POSTER_ADMIN_PREVIEW_DATA, images, logo };
  const base = { kind: resolved, spec: normalized, data, templateKey: 'admin-preview', sample: true };
  if (resolved === 'period') return { ...base, hasStudent: true };
  if (resolved === 'class') return { ...base, hasClass: true };
  if (resolved === 'video-cover') return { ...base, hasObject: true };
  // 长图：预览看第一张（分段出多张是导出的事，US-311a 的口径）。
  if (resolved === 'report-long') return { ...base, hasStudent: true, pages: [{ index: 1, spec: normalized }] };
  return { ...base, hasRecord: true };
}

/** 预览的重绘键：收敛后的整份 spec + 类型（真正会改变这张图的所有输入都在里面）。 */
export function posterAdminPreviewKey(spec, kind = '') {
  return `${POSTER_KINDS.includes(kind) ? kind : ''}|${JSON.stringify(normalizePosterSpec(spec))}`;
}

/**
 * 预览的节流（毫秒）：数字框是「一边打字一边重画」的重灾区（一个 0.001 的步进能连发三次渲染），
 * 所以预览排在输入之后这么久再跑 —— 与弹窗「先预览后缩略图」是同一类取舍（US-004c 的低分辨率预览节流）。
 */
export const POSTER_ADMIN_PREVIEW_THROTTLE_MS = 140;

/** 预览用的机构名 / 机构标识（样例数据的出处，界面不自己写死）。 */
export const POSTER_ADMIN_PREVIEW_ORG = { id: DEFAULT_ORG_ID, name: DEFAULT_ORG_NAME };

/** 预览区的说明（验收原文「实时预览」旁边那句：预览与老师端出图是同一支渲染）。 */
export const POSTER_ADMIN_PREVIEW_NOTE = '预览用与老师端出图同一支渲染（只差倍数）：改一个参数这里就重画一次。';
export const POSTER_ADMIN_PREVIEW_SAMPLE_NOTE = '预览用的是样例数据（学员名 / 作品名 / 点评金句都是示例），不是某一位孩子的真实档案。';
export const POSTER_ADMIN_PREVIEW_PENDING_TEXT = '正在重画预览…';
export const POSTER_ADMIN_PREVIEW_FAILED_TEXT = '这张版式没有渲染出图：检查参数（画布 / 素材）后重试。';

/** 参数面板里那两个「重来」的动作名（界面文案与断言读同一份）。 */
export const POSTER_ADMIN_RESET_CANVAS_LABEL = '用该类型的默认画布';
export const POSTER_ADMIN_RELOAD_SAVED_LABEL = '放弃改动，回到已保存的参数';

/** 面板顶部的一行读数（AC3「参数面板支持……每一类」的机器判据就是它：覆盖数 / 缺口数）。 */
export function posterAdminCoverageLine(spec) {
  const covered = posterAdminPanelCoverage(spec).length;
  const missing = posterAdminPanelMissingFields(spec);
  return {
    covered,
    missing,
    text: missing.length
      ? `面板覆盖 ${covered} 项参数；还有 ${missing.length} 项没摆出来：${missing.slice(0, 4).join('、')}`
      : `面板覆盖 ${covered} 项参数（spec 的每一个可编辑叶子都摆出来了）`
  };
}

/** 模板名 placeholder 与两个上限（与 data 层的收敛器同一份常量）。 */
export const POSTER_ADMIN_NAME_PLACEHOLDER = '例如：暖金留白 · 单作品';
export const POSTER_ADMIN_NAME_MAX = POSTER_TEMPLATE_NAME_MAX;
export const POSTER_ADMIN_DESCRIPTION_MAX = POSTER_TEMPLATE_DESCRIPTION_MAX;
export const POSTER_ADMIN_TEMPLATE_DESCRIPTION_NOTE = '一句话说明这套版式适合什么场景（老师选版式时看得到）。';

/** 默认背景的出处（面板上「背景类型 = 纯色」时仍用起始色画，别让 solid 丢掉颜色）。 */
export const POSTER_ADMIN_SOLID_FALLBACK_STOP = DEFAULT_POSTER_BACKGROUND.stops[0];
