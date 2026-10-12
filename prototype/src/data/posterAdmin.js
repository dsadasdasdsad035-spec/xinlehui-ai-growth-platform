/**
 * 管理端「海报模板」的数据层（[海报 US-312a / US-312b] / F-POSTER-ADMIN-01 / FR-350、FR-353 ~ FR-359）。
 *
 * 这一页要解决的事：**没有设计交付也能做出一套海报版式**。所以参数面板把 spec 的每一个可编辑叶子
 * 都摆出来（画布 / 背景 / 边框 / 装饰线 / 每个 slot 的类型与位置尺寸样式 / 字体与字号比例 / 二维码尺寸），
 * 右侧预览用**与老师端同一支渲染分派**（`services/posterDialog.js` 的 `renderPosterDialog`）当场出图。
 *
 * 本模块是**零依赖纯函数 + 常量**（只 import 其它 data 模块与零依赖的 `services/overlayLayout.js`），
 * Node 直跑断言，五条纪律：
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
 *   ④ **库级改动都过留痕**（US-312b / FR-359）：启停 / 排序 / 设为默认 / 保存 / 删除全部走
 *      `stampPosterTemplateUpdate()`（`data/posterTemplates.js`），由它统一写 `updatedBy` / `updatedAt`
 *      与一条变更历史 —— 界面里手改这三个字段必然漂移。
 *   ⑤ **保存前的三项校验在 data 层算**（US-312b / FR-355）：`posterAdminPreSaveChecks()` 一次给出
 *      「占位区越界 / 文字可能溢出 / 二维码可扫性」三行读数与处置（越界与二维码**拦保存**、
 *      文字溢出是**估算警告**，见 PRD 9.4）。几何用短边比例坐标，文字宽度用渲染层同一支估算器。
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
  POSTER_QR_MIN_PIXELS,
  POSTER_SLOT_TYPE_LABELS,
  POSTER_SLOT_TYPES,
  POSTER_TEMPLATE_DESCRIPTION_MAX,
  POSTER_TEMPLATE_HISTORY_EMPTY,
  POSTER_TEMPLATE_NAME_MAX,
  POSTER_TEMPLATE_SORT_FALLBACK,
  POSTER_TEXT_ALIGNS,
  POSTER_VARIABLES,
  POSTER_VARIABLE_KEYS,
  normalizePosterSpec,
  normalizePosterTemplate,
  normalizePosterTemplateName,
  posterShortEdge,
  posterSpecIssues,
  posterTemplateChangeText,
  posterTemplateDeleteIssue,
  POSTER_TEMPLATE_BUILTIN_DELETE_NOTE,
  posterTemplateHistoryRows as posterTemplateHistoryRowsOf,
  posterTemplateIssues,
  posterTemplateKey,
  posterTemplateNameIssue,
  posterUnknownVariables,
  sortPosterTemplates,
  stampPosterTemplateUpdate
} from './posterTemplates';
import { AUDIT_ACTIONS } from './auditLog';
import { DEFAULT_ORG_NAME, DEFAULT_ORG_ID } from './lessons';
import { FRAMING_PRESET_READONLY_NOTE, framingPresetWriteIssue, framingPresetWriteOwnerText } from './framingPermissions';
// 「没有 canvas 时的文字宽度估算」与渲染层是**同一把尺子**（`services/overlayLayout.js` 是零依赖纯函数，
// `data/lessonOverlays.js` 也这么用）—— 后台的溢出估算因此不会比真机乐观。
import { applyOverlayVariables, estimateTextWidth } from '../services/overlayLayout';

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
// 库级动作：启用 / 停用 · 排序 · 设为默认 · 删除前的引用范围（[海报 US-312b] / FR-350、FR-353、FR-358）
//
// 三条纪律：
//   ① **所有库级改动都过 `stampPosterTemplateUpdate()`**（FR-359）：它同时写 `updatedBy` / `updatedAt`
//      并追加一条变更历史 —— 界面里手改这三个字段必然漂移，别这么干。
//   ② **默认模板全局唯一**（老师端 `posterDialogDefaultTemplateId()` 取列表里第一套 `isDefault`）：
//      设为默认时把别人的标记一并清掉，于是「默认是哪一套」在任何时刻都是一个确定的值。
//   ③ **排序只在同一层（scope）内挪动**：三层分组分别由三个写入方维护，平台管理员挪机构层的序号
//      既写不进云端（越权）也没有意义。同层按位次重排 `(位置+1)×10`，只有被挪动的那一套进变更历史。
// ---------------------------------------------------------------------------

export const POSTER_ADMIN_ENABLE_ACTION = '启用模板';
export const POSTER_ADMIN_DISABLE_ACTION = '停用模板';
export const POSTER_ADMIN_SORT_ACTION = '调整排序';
export const POSTER_ADMIN_DEFAULT_ACTION = '设为默认模板';
export const POSTER_ADMIN_UNDEFAULT_ACTION = '取消默认模板';
export const POSTER_ADMIN_SAVE_ACTION = '保存模板';
export const POSTER_ADMIN_DELETE_ACTION = '删除模板';

/** 启用 / 停用的一句话说明（列表与面板读同一份）。 */
export const POSTER_ADMIN_ENABLED_NOTE = '启用后老师端「一键转发」的版式列表里才会出现这套模板；停用只影响以后的可选列表，已经导出或转发过的海报图片不受影响。';
/** 默认模板的说明（与装裱同一口径：同一时间只有一套）。 */
export const POSTER_ADMIN_DEFAULT_NOTE = '默认模板：老师端打开「一键转发」弹窗时默认选中的就是它。同一时间只有一套默认模板。';
/** 排序的说明。 */
export const POSTER_ADMIN_SORT_NOTE = '排序决定老师端版式列表的先后（同层内上下移动；老师个人模板始终排在最前面）。';

/** 当前会话能不能改这套模板（不能改的行没有排序 / 默认 / 删除入口）。 */
function assertWritable(action, template, viewer) {
  const item = normalizePosterTemplate(template);
  return { item, issue: posterAdminTemplateWriteIssue(item, viewer) };
}

/** 启用 / 停用（一次写入 + 一条变更历史；状态没变则一个字段都不动）。 */
export function posterAdminSetEnabled(template, enabled, { by = '', at = 0, viewer = {} } = {}) {
  const { item, issue } = assertWritable('启用停用', template, viewer);
  if (issue) return item;
  const next = enabled !== false;
  if (next === (item.enabled !== false)) return item;
  return stampPosterTemplateUpdate({ ...item, enabled: next }, {
    by,
    at,
    action: next ? POSTER_ADMIN_ENABLE_ACTION : POSTER_ADMIN_DISABLE_ACTION,
    detail: next ? '老师端可选' : '老师端不再出现'
  });
}

/**
 * 同层内上下移动（`delta` 为 -1 上移 / +1 下移）。返回**新的列表**（已按新顺序排好）。
 * 只有被挪动的那一套进变更历史 —— 其余只是让位，序号被动重排（与装裱 `moveFramingPreset` 同一口径）。
 */
export function posterAdminMoveTemplate(templates, id, delta, { by = '', at = 0, viewer = {} } = {}) {
  const ordered = sortPosterTemplates(templates);
  const target = ordered.find((template) => template.id === String(id));
  if (!target || posterAdminTemplateWriteIssue(target, viewer)) return ordered;
  const peers = ordered.filter((template) => template.scope === target.scope);
  const index = peers.findIndex((template) => template.id === target.id);
  const step = Number(delta) > 0 ? 1 : Number(delta) < 0 ? -1 : 0;
  const to = index + step;
  if (!step || index < 0 || to < 0 || to >= peers.length) return ordered;
  const moved = peers.slice();
  const [item] = moved.splice(index, 1);
  moved.splice(to, 0, item);
  const positions = new Map(moved.map((entry, position) => [entry.id, (position + 1) * 10]));
  return sortPosterTemplates(ordered.map((entry) => {
    const sortOrder = positions.get(entry.id);
    if (!Number.isFinite(sortOrder) || entry.sortOrder === sortOrder) return entry;
    return entry.id === item.id
      ? stampPosterTemplateUpdate({ ...entry, sortOrder }, { by, at, action: POSTER_ADMIN_SORT_ACTION, detail: `移到第 ${to + 1} 位` })
      : { ...entry, sortOrder };
  }));
}

/** 一套模板在同层里的位次读数（界面据此禁用「上移 / 下移」，不改任何数据）。 */
export function posterAdminSortPosition(templates, id) {
  const ordered = sortPosterTemplates(templates);
  const target = ordered.find((template) => template.id === String(id));
  if (!target) return { position: 0, count: 0, canUp: false, canDown: false };
  const peers = ordered.filter((template) => template.scope === target.scope);
  const index = peers.findIndex((template) => template.id === target.id);
  return {
    position: index + 1,
    count: peers.length,
    canUp: index > 0,
    canDown: index >= 0 && index < peers.length - 1
  };
}

/** 当前默认模板的 id（读的是排序后的第一套 `isDefault`，与老师端的取法一致）。 */
export function posterAdminDefaultId(templates) {
  return (sortPosterTemplates(templates).find((template) => template.isDefault) || { id: '' }).id;
}

/**
 * 设为默认模板（传空 id = 取消默认）。返回**新的列表**：命中的那套打上 `isDefault: true`、
 * 原来的默认取消标记 —— 两边各记一条变更历史（FR-359：「默认模板是谁」也是模板变更）。
 * 不可写的模板一个字段都不动（平台管理员改不动机构 / 老师层的默认标记）。
 */
export function posterAdminApplyDefault(templates, id, { by = '', at = 0, viewer = {} } = {}) {
  const list = sortPosterTemplates(templates);
  const key = String(id || '');
  const target = key ? list.find((template) => template.id === key) : null;
  if (key && (!target || posterAdminTemplateWriteIssue(target, viewer))) return list;
  return list.map((item) => {
    const wanted = Boolean(key) && Boolean(target) && item.id === target.id;
    if (wanted === item.isDefault) return item;
    if (posterAdminTemplateWriteIssue(item, viewer)) return item;
    return stampPosterTemplateUpdate({ ...item, isDefault: wanted }, {
      by,
      at,
      action: wanted ? POSTER_ADMIN_DEFAULT_ACTION : POSTER_ADMIN_UNDEFAULT_ACTION,
      detail: wanted ? item.name : (target ? `改由「${target.name}」当默认` : '取消默认标记')
    });
  });
}

// ---------------------------------------------------------------------------
// 引用范围与删除判据（FR-358）：**被使用过的模板只允许停用**，删除前提示影响范围
//
// 「被使用过」在数据里有两处痕，都读：
//   ① **审计日志**：老师导出（`poster.export`）与转发（`poster.forward`）的留痕里带 `templateId`
//      —— 那是「这套版式真的产出过要发出去的东西」；
//   ② **默认标记**：它现在是默认模板（老师端一开弹窗就选中它）。
// 口径与装裱的 `framingPresetUsage` / `framingPresetDeleteVerdict` 逐条对齐（PRD 9.2 第 7 条）。
// ---------------------------------------------------------------------------

/** 算「被使用过」的两个动作（审计日志里带 `templateId` 的海报留痕）。 */
export const POSTER_ADMIN_USAGE_ACTIONS = [AUDIT_ACTIONS.posterExport, AUDIT_ACTIONS.posterForward];

/** 引用范围的一句话（面板上就显示这句；没有引用时也要明确说「没有」）。 */
export const POSTER_ADMIN_USAGE_EMPTY_TEXT = '引用范围：还不是默认模板、也没有老师用它导出或转发过。';

/**
 * 一套模板的引用范围（删除前的提示与「只允许停用」的判据都读它）：
 *   · `isDefault` —— 是不是当前的默认模板；
 *   · `exportCount` / `forwardCount` —— 审计日志里按它导出 / 转发的次数（`poster.export` / `poster.forward`）；
 *   · `lastUsedAt` / `subjects` —— 最近一次使用的时间与对象（学员 / 班级名，最近 3 个）。
 * `referenced` 为真 = 有老师在用 / 有产出引用，按 PRD 只允许停用、不允许删除。
 */
export function posterAdminTemplateUsage(template, { audit = [] } = {}) {
  const item = normalizePosterTemplate(template);
  const id = item.id;
  const entries = id
    ? (Array.isArray(audit) ? audit : []).filter((entry) => entry
      && String(entry.templateId || '') === id
      && POSTER_ADMIN_USAGE_ACTIONS.includes(String(entry.action || '')))
    : [];
  const countOf = (action) => entries.filter((entry) => String(entry.action || '') === action).length;
  const exportCount = countOf(AUDIT_ACTIONS.posterExport);
  const forwardCount = countOf(AUDIT_ACTIONS.posterForward);
  const ordered = entries.slice().sort((left, right) => String(right.at || '').localeCompare(String(left.at || '')));
  const lastUsedAt = ordered.length ? String(ordered[0].at || '') : '';
  const subjects = [...new Set(ordered.map((entry) => String(entry.objectName || entry.studentName || '').trim()).filter(Boolean))].slice(0, 3);
  const reasons = [];
  if (item.isDefault === true) reasons.push('当前是默认模板');
  if (exportCount || forwardCount) {
    const parts = [];
    if (exportCount) parts.push(`${exportCount} 次导出`);
    if (forwardCount) parts.push(`${forwardCount} 次转发`);
    reasons.push(`有 ${parts.join(' / ')}按它生成`);
  }
  return {
    id,
    name: item.name,
    builtin: item.builtin === true,
    isDefault: item.isDefault === true,
    exportCount,
    forwardCount,
    count: entries.length,
    lastUsedAt,
    subjects,
    referenced: reasons.length > 0,
    reasons
  };
}

/** 引用范围的可读文案（审计时间用 `auditTimeText()` 那一套口径展示在界面上）。 */
export function posterAdminUsageText(template, usage) {
  const info = usage || posterAdminTemplateUsage(template);
  if (!info.referenced) return POSTER_ADMIN_USAGE_EMPTY_TEXT;
  const tail = info.lastUsedAt ? `（最近一次 ${info.lastUsedAt}${info.subjects.length ? ` · ${info.subjects.join('、')}` : ''}）` : '';
  return `引用范围：${info.reasons.join('、')}${tail}。`;
}

/**
 * 删除判据（FR-357 + FR-358）：内置模板不可删（只可停用）；**被使用过的模板同样只允许停用**。
 * 返回 `{ allowed, kind, message, usageText, usage }`：
 *   - `message` 就是界面要显示的那句（两种情形都带影响范围）；
 *   - `kind` = `builtin` / `used` / `ok`，界面据此决定按钮（「改为停用」还是「确认删除」）。
 */
export function posterAdminDeleteVerdict(template, usage) {
  const item = normalizePosterTemplate(template);
  const info = usage || posterAdminTemplateUsage(item);
  const usageText = posterAdminUsageText(item, info);
  const builtinIssue = posterTemplateDeleteIssue(item);
  if (builtinIssue) {
    const kind = item.builtin ? 'builtin' : 'invalid';
    return {
      allowed: false,
      kind,
      usage: info,
      usageText,
      message: kind === 'builtin'
        ? `「${item.name}」是内置模板：${POSTER_TEMPLATE_BUILTIN_DELETE_NOTE}${usageText}`
        : `「${item.name}」不可删除：${builtinIssue}${usageText}`,
      reason: builtinIssue
    };
  }
  if (info.referenced) {
    return {
      allowed: false,
      kind: 'used',
      usage: info,
      usageText,
      message: `「${item.name}」${info.reasons.join('、')}，被使用过的模板只能停用、不能删除。停用后老师端不再出现，已经导出或转发过的海报图片不受影响。${usageText}`,
      reason: '被使用过的模板只允许停用'
    };
  }
  return {
    allowed: true,
    kind: 'ok',
    usage: info,
    usageText,
    message: `「${item.name}」${usageText}${POSTER_ADMIN_DELETE_NOTE}`,
    reason: ''
  };
}

/** 删除的二次确认文案（界面上的确认条读它，别自己拼）。 */
export const POSTER_ADMIN_DELETE_CONFIRM_TEXT = '删除会同时从本机镜像与云端模板库摘掉这套模板，且不可撤销。';
/** 删除之后的影响范围（回执与判据读同一句）。 */
export const POSTER_ADMIN_DELETE_NOTE = '删除只影响以后的可选列表：已经导出、转发或下载过的海报图片不会被改动。';
export const POSTER_ADMIN_DELETE_ERROR_TEXT = '删除没有成功：';
export const POSTER_ADMIN_DISABLE_INSTEAD_LABEL = '改为停用';

// ---------------------------------------------------------------------------
// 变更历史（FR-359）：`updated_by / updated_at` + 逐条历史
// ---------------------------------------------------------------------------

export const POSTER_ADMIN_HISTORY_TITLE = '变更历史';
export const POSTER_ADMIN_HISTORY_EMPTY = POSTER_TEMPLATE_HISTORY_EMPTY;
/** 历史行的文案（`2026-10-13 01:20 · 平台管理员 · 保存模板：改动：版式参数`）。 */
export const POSTER_ADMIN_HISTORY_NOTE = '每次保存 / 启停 / 排序 / 设为默认都会写一条（最近 20 条）。';

/** 变更历史的行（最新在前；界面与断言读同一份）。 */
export function posterAdminHistoryRows(template) {
  return posterTemplateHistoryRowsOf(template).map((entry) => ({
    ...entry,
    text: [entry.action, entry.detail].filter(Boolean).join('：') || '更新模板'
  }));
}

/** 「最后变更」的读数：`{ by, at, text }`（空的时候给一句可读的话，不显示空白）。 */
export function posterAdminUpdatedFacts(template, { timeText = null } = {}) {
  const item = normalizePosterTemplate(template);
  const at = item.updatedAt;
  const by = item.updatedBy;
  const shown = typeof timeText === 'function' ? timeText(at) : at;
  return {
    by,
    at,
    text: by || at ? `${shown || at}${by ? ` · ${by}` : ''}` : POSTER_ADMIN_HISTORY_EMPTY
  };
}

// ---------------------------------------------------------------------------
// 适用范围读数（AC2：按**海报类型**与**入口**配置）
//
// 类型与入口是两件事：类型决定版式长什么样（谁做这张图），入口决定它出现在哪儿
// （成长档案里的一键转发 / 课后反馈第四步的转发）。配置本身是两个字段（`kind` / `entryScope`），
// 这里只把「配置成了什么」翻译成一句可读的读数，界面与断言读同一份。
// ---------------------------------------------------------------------------

/** 两处入口的 id（与老师端弹窗的 `POSTER_DIALOG_ENTRY_*` 同一套口径）。 */
export const POSTER_ADMIN_ENTRY_IDS = ['archive', 'feedback'];
export const POSTER_ADMIN_ENTRY_LABELS = { archive: '成长档案', feedback: '课后反馈' };

export const POSTER_ADMIN_SCOPE_NOTE = '适用范围 = 海报类型（谁做这张图）＋ 入口（老师从哪儿发出去）：两者都对上，那处入口才会列出这套版式。';

/** 某类型的版式通常出在哪个入口（读数，不是校验：单作品两处都用得上，其余四类在成长档案里才有数据）。 */
export const POSTER_ADMIN_KIND_ENTRY_NOTES = {
  single: '单作品海报两处入口都用得上：课后反馈里就是这一节课的这一幅作品。',
  period: '阶段成长海报要有阶段报告数据：成长档案入口（课后反馈里先做单作品转发）。',
  class: '班级集体海报要有班级名单与归档作品：成长档案入口。',
  'video-cover': '成长视频封面随成片走：成长档案入口。',
  'report-long': '成长报告长图要有整期归档：成长档案入口。'
};

/** 适用范围读数：`{ kind, kindLabel, entryScope, entryLabel, entries, kindNote, text }`。 */
export function posterAdminScopeView(template) {
  const item = normalizePosterTemplate(template);
  const entries = item.entryScope === 'both' ? POSTER_ADMIN_ENTRY_IDS.slice() : (POSTER_ADMIN_ENTRY_IDS.includes(item.entryScope) ? [item.entryScope] : []);
  const labels = entries.map((entry) => POSTER_ADMIN_ENTRY_LABELS[entry] || entry);
  return {
    kind: item.kind,
    kindLabel: POSTER_KIND_LABELS[item.kind] || item.kind,
    entryScope: item.entryScope,
    entryLabel: POSTER_ENTRY_SCOPE_LABELS[item.entryScope] || '',
    entries,
    entryLabels: labels,
    kindNote: POSTER_ADMIN_KIND_ENTRY_NOTES[item.kind] || '',
    text: `${POSTER_KIND_LABELS[item.kind] || item.kind} · 适用入口：${labels.length ? labels.join('、') : '未配置'}`
  };
}

// ---------------------------------------------------------------------------
// 保存前的三项校验（[海报 US-312b] / FR-355）
//
// 三项 = PRD 原文的三条：**slot 是否越界** · **文字是否可能溢出** · **二维码是否小于可扫阈值**。
// 三条都在 data 层算（不碰 canvas）：几何用收敛后的比例坐标 + 画布短边折算，
// 文字宽度用渲染层同一支估算器（`services/overlayLayout.js` 的 `estimateTextWidth`）。
//
// 处置（PRD 9.4 的原文）：越界与二维码不达标**拦保存**（「管理端必须做最小尺寸校验」），
// 文字溢出是**估算警告**（「在管理端保存前给出估算警告」）—— 拦下来的是确定的错，放行的是估出来的险。
// ---------------------------------------------------------------------------

export const POSTER_ADMIN_CHECK_IDS = ['bounds', 'text', 'qrcode'];
export const POSTER_ADMIN_CHECK_LABELS = { bounds: '占位区越界', text: '文字可能溢出', qrcode: '二维码可扫性' };
export const POSTER_ADMIN_CHECK_POLICY = { bounds: 'block', text: 'warn', qrcode: 'block' };
/** 三项校验的处置说明（界面常驻一行；与 `POSTER_ADMIN_CHECK_POLICY` 同一份口径）。 */
export const POSTER_ADMIN_CHECK_POLICY_NOTE = '处置：占位区越界与二维码不达标会拦下保存；文字溢出是估算警告（把文案改短，或换一套更宽的版式）。';
export const POSTER_ADMIN_CHECK_OK_TEXT = '三项校验都通过：占位区都在画布内、二维码达标、按样例数据估算文字不会溢出。';
export const POSTER_ADMIN_CHECK_BLOCKED_TITLE = '保存前校验没通过，这套模板先不保存：';
/** 越界的容差（相对短边）：比例坐标取整、描边出血这类亚像素差不算越界。 */
export const POSTER_ADMIN_BOUNDS_TOLERANCE = 0.02;
/** 估算的出处说明（界面常驻一句，别让人以为这是真机渲染的结果）。 */
export const POSTER_ADMIN_CHECK_ESTIMATE_NOTE = '文字溢出按样例数据里的最长内容估算（真机以渲染结果为准：超出的字会被截断并加省略号）。';

/** 兜底画布（比例坐标的尺子）：拿不到画布时按默认类型的预设画布算，别让几何读数崩在 undefined 上。 */
const POSTER_ADMIN_FALLBACK_CANVAS = (() => {
  const preset = POSTER_CANVAS_PRESETS[DEFAULT_POSTER_KIND] || POSTER_CANVAS_PRESETS.single;
  return { width: preset.width, height: preset.height };
})();

/**
 * 占位区在「短边比例」坐标系里的外接框（`{ x, y, w, h, heightEstimated }`）。
 * `heightEstimated` 为真表示**高度是按估算给的**，越界判定只用宽度（见下）：
 *   · 文字位没有 `h`（高度由内容决定）→ 按「估算行数 × 字号 × 行高」折算；
 *   · Logo 位的高度由图片自身长宽比决定，**数据层拿不到**（同一条模板配不同 Logo 高度就不同）
 *     → 判「到边没到边」只看宽度，高度不参与，别把一套合法模板按 1:1 的假想高度判成越界
 *     （内置的「暖金留白 · 单作品」就这么被误伤过一次）。
 */
export function posterAdminSlotBox(slot, canvas = null) {
  const source = slot && typeof slot === 'object' ? slot : {};
  const theme = canvas || POSTER_ADMIN_FALLBACK_CANVAS;
  const shortEdge = posterShortEdge(theme);
  const box = { x: Number(source.x) || 0, y: Number(source.y) || 0, w: 0, h: 0, heightEstimated: false };
  if (source.type === 'image') {
    box.w = Number(source.w) || 0;
    box.h = Number(source.h) || 0;
  } else if (source.type === 'qrcode') {
    box.w = Number(source.sizeRatio) || 0;
    // 说明写在码框下方（`plate.y + plate.height + fontSize * 0.4`，行高 1.3）→ 大约 1.7 个字号的额外高度。
    box.h = box.w + (String(source.caption || '').trim() ? (Number(source.captionSizeRatio) || 0) * 1.7 : 0);
  } else if (source.type === 'text') {
    box.w = Number(source.w) || 0;
    // 文字位没有 h：高度按「估算行数 × 字号 × 行高」折算（短边比例）。
    const lines = Number(source.estimatedLines) > 0 ? Number(source.estimatedLines) : (Number(source.maxLines) || 1);
    box.h = (Number(source.sizeRatio) || 0) * (Number(source.lineHeight) || 1.4) * Math.max(1, lines);
    box.heightEstimated = true;
  } else {
    box.w = Number(source.maxWRatio) || 0;
    box.h = box.w; // 仅用于读数展示；越界判定按 `heightEstimated` 只用宽度
    box.heightEstimated = true;
  }
  void shortEdge;
  return box;
}

/** 画布在「短边比例」坐标系里的宽高（1080×1440 的画布 = 1 × 1.333）。 */
export function posterAdminCanvasUnits(canvas) {
  const theme = canvas || POSTER_ADMIN_FALLBACK_CANVAS;
  const shortEdge = posterShortEdge(theme);
  return { width: theme.width / shortEdge, height: theme.height / shortEdge };
}

/** 一段文字在某文字位里要占几行（用渲染层同一支宽度估算；`estimateTextWidth` 是零依赖纯函数）。 */
export function posterAdminEstimatedLines(slot, content = '') {
  const source = slot && typeof slot === 'object' ? slot : {};
  const text = String(content || '').trim();
  if (!text || source.type !== 'text') return 0;
  const shortEdge = posterShortEdge(source.canvas || POSTER_ADMIN_FALLBACK_CANVAS);
  const fontSize = (Number(source.sizeRatio) || 0) * shortEdge;
  const maxWidth = (Number(source.w) || 0) * shortEdge;
  const spacing = (Number(source.letterSpacingRatio) || 0) * shortEdge;
  if (!(fontSize > 0) || !(maxWidth > 0)) return 0;
  const chars = [...text].length;
  const width = estimateTextWidth(text, fontSize) + spacing * Math.max(0, chars - 1);
  return Math.max(1, Math.ceil(width / maxWidth));
}

/**
 * 三项校验（界面逐行渲染 `rows`，保存前拦的是 `blockers`）。
 * `data` 是估算用的样例内容（默认取 `POSTER_ADMIN_PREVIEW_DATA` —— 界面预览放的就是它）。
 */
export function posterAdminPreSaveChecks(template, { data = POSTER_ADMIN_PREVIEW_DATA } = {}) {
  const item = normalizePosterTemplate(template);
  const normalized = normalizePosterSpec(item.spec);
  const units = posterAdminCanvasUnits(normalized.canvas);
  const shortEdge = posterShortEdge(normalized.canvas);
  const context = data && typeof data === 'object' ? data : {};
  const slots = normalized.slots.map((slot) => {
    const withCanvas = { ...slot, canvas: normalized.canvas };
    const resolved = slot.type === 'text' ? applyOverlayVariables(slot.template, context, POSTER_VARIABLE_KEYS).text : '';
    const estimatedLines = posterAdminEstimatedLines(withCanvas, resolved);
    return { ...withCanvas, resolvedText: resolved, estimatedLines, box: posterAdminSlotBox(withCanvas, normalized.canvas) };
  });
  const tol = POSTER_ADMIN_BOUNDS_TOLERANCE;

  // ① 占位区越界：右下角超出画布（左上角为负也算：负坐标是「画出画布外」的意图）。
  // 高度是估算值的占位区（文字 / Logo）**只看宽度与左上角**：拿假想高度判越界会误伤合法模板。
  const outside = slots.filter((slot) => slot.visible !== false && (
    slot.box.x < -tol
    || slot.box.y < -tol
    || slot.box.x + slot.box.w > units.width + tol
    || (!slot.box.heightEstimated && slot.box.y + slot.box.h > units.height + tol)
  )).map((slot) => ({
    id: slot.id,
    typeLabel: POSTER_SLOT_TYPE_LABELS[slot.type] || slot.type,
    right: Number((slot.box.x + slot.box.w).toFixed(3)),
    bottom: slot.box.heightEstimated ? Number(slot.box.y.toFixed(3)) : Number((slot.box.y + slot.box.h).toFixed(3)),
    heightEstimated: slot.box.heightEstimated
  }));
  const boundsRow = {
    id: 'bounds',
    label: POSTER_ADMIN_CHECK_LABELS.bounds,
    level: POSTER_ADMIN_CHECK_POLICY.bounds,
    ok: outside.length === 0,
    value: outside.length ? `${outside.length} 个越界` : '全部在画布内',
    detail: outside.length
      ? `有 ${outside.length} 个占位区超出画布（画布在短边比例里是 ${Number(units.width.toFixed(2))} × ${Number(units.height.toFixed(2))}）：${outside.map((row) => `${row.typeLabel}「${row.id}」到 ${row.right}×${row.bottom}${row.heightEstimated ? '（高度按估算）' : ''}`).join('；')}`
      : `所有占位区的右下角都在画布内（画布 ${Number(units.width.toFixed(2))} × ${Number(units.height.toFixed(2))} 短边比例，容差 ${tol}；文字 / Logo 位的高度按估算，只看宽度）。`,
    offenders: outside
  };

  // ② 文字溢出估算：估算行数 > maxLines 的那些文字位。
  const overflowing = slots.filter((slot) => slot.type === 'text' && slot.visible !== false
    && slot.estimatedLines > Math.max(1, Math.round(Number(slot.maxLines) || 1)))
    .map((slot) => ({
      id: slot.id,
      estimatedLines: slot.estimatedLines,
      maxLines: Math.max(1, Math.round(Number(slot.maxLines) || 1)),
      preview: String(slot.resolvedText || '').slice(0, 18)
    }));
  const textRow = {
    id: 'text',
    label: POSTER_ADMIN_CHECK_LABELS.text,
    level: POSTER_ADMIN_CHECK_POLICY.text,
    ok: overflowing.length === 0,
    value: overflowing.length ? `${overflowing.length} 处可能溢出` : '按样例数据不会溢出',
    detail: overflowing.length
      ? `有 ${overflowing.length} 个文字位按样例数据估算会超出 maxLines（超出的字会被截断并加省略号）：${overflowing.map((row) => `「${row.id}」约 ${row.estimatedLines} 行 > ${row.maxLines} 行（${row.preview}…）`).join('；')}`
      : '所有文字位按样例数据估算都在自己的 maxLines 之内。',
    offenders: overflowing
  };

  // ③ 二维码可扫性：边长（短边比例 → 像素）≥ 可扫阈值。
  const qrSlots = slots.filter((slot) => slot.type === 'qrcode' && slot.visible !== false);
  const qrPixels = qrSlots.map((slot) => Math.round((Number(slot.sizeRatio) || 0) * shortEdge));
  const qrOk = qrSlots.every((slot) => Math.round((Number(slot.sizeRatio) || 0) * shortEdge) >= POSTER_QR_MIN_PIXELS);
  const qrRow = {
    id: 'qrcode',
    label: POSTER_ADMIN_CHECK_LABELS.qrcode,
    level: POSTER_ADMIN_CHECK_POLICY.qrcode,
    ok: qrOk,
    value: qrSlots.length ? qrPixels.map((px) => `${px}px`).join(' / ') : '这套版式没有可见的二维码位',
    detail: qrSlots.length
      ? (qrOk
        ? `二维码边长 ${qrPixels.join(' / ')}px ≥ 可扫阈值 ${POSTER_QR_MIN_PIXELS}px（画布短边 ${shortEdge}px）。`
        : `二维码过小：边长 ${qrPixels.join(' / ')}px < 可扫阈值 ${POSTER_QR_MIN_PIXELS}px（画布短边 ${shortEdge}px）——手机上扫不出来，把「二维码尺寸比例」调大或换更大的画布。`)
      : '这套版式里二维码位是关闭的：不校验可扫性。',
    offenders: qrSlots.filter((slot) => Math.round((Number(slot.sizeRatio) || 0) * shortEdge) < POSTER_QR_MIN_PIXELS).map((slot) => ({ id: slot.id }))
  };

  const rows = [boundsRow, textRow, qrRow];
  const blockers = rows.filter((row) => !row.ok && row.level === 'block').map((row) => row.detail);
  const warnings = rows.filter((row) => !row.ok && row.level === 'warn').map((row) => row.detail);
  return {
    rows,
    blockers,
    warnings,
    ok: rows.every((row) => row.ok),
    blocked: blockers.length > 0,
    slots,
    summary: rows.every((row) => row.ok) ? POSTER_ADMIN_CHECK_OK_TEXT : rows.filter((row) => !row.ok).map((row) => row.detail).join(' '),
    note: POSTER_ADMIN_CHECK_ESTIMATE_NOTE
  };
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

/**
 * 保存：把草稿并进记录并**过留痕**（FR-359）—— `updatedBy` / `updatedAt` / 一条变更历史。
 * `previous` 是已保存的那一份（用来算「改动：…」）；没有改动时也记一条（保存本身是一次留痕）。
 */
export function posterAdminStampSave(template, { previous = null, by = '', at = 0 } = {}) {
  const item = normalizePosterTemplate(template);
  const changeText = previous ? posterTemplateChangeText(previous, item) : '';
  return stampPosterTemplateUpdate(item, {
    by,
    at,
    action: POSTER_ADMIN_SAVE_ACTION,
    detail: changeText ? `改动：${changeText}` : '参数与库级设置都没有变化'
  });
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
