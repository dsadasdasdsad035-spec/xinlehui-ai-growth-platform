// 班级集体海报（[海报 US-305] / FR-310、FR-315、FR-319、FR-321、FR-322、FR-323）的数据装配与规则。
//
// 一张班级作品墙 = **一份模板 spec**（`data/posterTemplates.js` 的参数）+ **一份数据**（这个班级里
// 每位学员在这一个周期里的代表作）。本模块回答「格子从哪儿来、缺了怎么办」，与
// `data/posterSingle.js`（单作品）/ `data/posterPeriod.js`（阶段成长）同一套分工：data 层零依赖之外
// 的纯函数，可 `node` 直跑断言。
//
//   ① 格子 = **学员**，不是作品（US-305 第 2、4 条）：顺序真源是班级名单（`roster`，名单之外但本期
//      有记录的学员接在后面 —— 有记录的孩子一定占一格），每位学员取本周期**最新一幅**成品图；
//      本期没有作品的学员**保留占位格**（`{url:'', placeholderText:'本期暂无作品'}`，FR-321 明写
//      「不得直接跳过」：跳过会让家长以为漏掉了自己的孩子）。
//   ② 「哪张图能显示」不另判一次：成品图走 `archiveRecordMediaView(record,{surface:'teacher'})`
//      —— 与成长档案 / 家长分享页 / 单作品 / 阶段海报同一支判据；一条都读不出来就是占位格，不猜。
//      缺课记录不是一幅作品（它没有成品图），所以它只会让那一位走占位格那一支。
//   ③ 周期口径不另写一套：词表 / 窗口 / 过滤读 `data/archiveTargets.js`
//      （`archivePeriodWindow` / `filterArchiveRecordsByPeriod`），对象过滤读 `archiveTargetView`
//      （班级 = `record.className`，未选班级 = 空列表，不是「全部混在一起」）。
//   ④ 超过上限（默认 30）**不裁剪**：按名单顺序分成多批（`posterClassBatches`），一次出一批，
//      文件名带 `1of2` 页码（FR-322「必须提示并支持分批出图」；打包 zip 是 Non-Goals）。
//      因此班级作品墙永远不会「少一个人」——「已收录 M / 共 N」那套精选口径只属于阶段拼贴。
//   ⑤ 缺件不编：没有有效分享 → 二维码位换成「分享链接待生成」的文字位；机构没有 Logo 图 →
//      Logo 位用机构名代替。两条都复用 `data/posterSingle.js` 的占位补丁（不写第二份）；
//      作品墙**不过**「图位缺件」那一支 —— 墙上的空格子本身就是占位格。
//
// 真正落笔的在 `services/posterClass.js`（预览 `scale=1`、导出 `scale=2`，同一个 `renderPoster`）。

import {
  POSTER_CANVAS_PRESETS,
  POSTER_CLASS_MAX_ITEMS_DEFAULT,
  POSTER_KIND_LABELS,
  normalizePosterSpec,
  normalizePosterTemplate,
  posterImageUrl,
  seedPosterTemplates
} from './posterTemplates';
import {
  POSTER_SINGLE_SHARE_PENDING_TEXT,
  posterSingleLogoFallbackNote,
  posterSingleSpecPatch
} from './posterSingle';
import {
  ARCHIVE_PERIODS,
  ARCHIVE_PERIOD_DEFAULT,
  ARCHIVE_TARGET_CLASS,
  archivePeriodWindow,
  archiveTargetView,
  filterArchiveRecordsByPeriod
} from './archiveTargets';
import { resolveArchiveReportPeriod } from './archiveReports';
import { archiveRecordMediaView } from './archiveMedia';
import { formatLessonDateDots, normalizeLessonDate } from './lessons';
import { shareTokenUrl, shareTokenView } from './shareTokens';
import { sanitizeArtworkExportSegment } from './artworkExport';

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value) => String(value === null || value === undefined ? '' : value).trim();
const int = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0);
/** 带符号的整数（上下移动的 `direction` 要用负值 —— `int()` 会把 -1 夹成 0）。 */
const signedInt = (value) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0);

/**
 * 「今天」的归一：**必须先落到一个真 Date** 再交给周期函数（与 `data/posterPeriod.js` 同一条注释）。
 * `archivePeriodWindow(period, null)` 会把 `null` 读成 1970-01-01，窗口静默变成一个空区间。
 */
function resolvedToday(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = str(value);
  if (text) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

// ---------------------------------------------------------------------------
// 常量（界面、断言与渲染读同一份 —— 别在任何一侧再抄一遍）
// ---------------------------------------------------------------------------

/** 班级集体海报的画布（FR-315）：1080×1920。 */
export const POSTER_CLASS_KIND = 'class';
export const POSTER_CLASS_CANVAS = { ...POSTER_CANVAS_PRESETS.class };

/** 单张海报的学员上限（FR-322 的「默认 30」；超过就分批）。 */
export const POSTER_CLASS_MAX_STUDENTS = POSTER_CLASS_MAX_ITEMS_DEFAULT;

/** 默认选用的内置班级模板（自适应作品墙那套；固定四行三列那套只适合 12 人以内）。 */
export const POSTER_CLASS_DEFAULT_TEMPLATE_KEY = 'poster-ink-wall-class';

/** 作品墙占位区 id 的约定（与内置模板一致）：`wall` 优先，其次第一个自适应网格的 image 位。 */
export const POSTER_CLASS_WALL_SLOT_ID = 'wall';

/** 本期没有作品的占位格上写的那句话（验收原文「本期暂无作品」；界面、渲染与断言读同一份）。 */
export const POSTER_CLASS_NO_ARTWORK_TEXT = '本期暂无作品';

/** 一格认不出学员姓名时展签写的那句话（验收「姓名缺失时显示占位而不是错位」）。 */
export const POSTER_CLASS_UNNAMED_TEXT = '未记录姓名';

/** 还没有选择班级时的空态（不渲染一张没有班级名的海报）。 */
export const POSTER_CLASS_MISSING_TEXT = '还没有选择班级：先在成长档案里切到「班级成长档案」并选一个班级，再来生成班级作品墙。';

/** 班级里既没有名单也没有本期记录时的空态（格子一个都数不出来）。 */
export const POSTER_CLASS_EMPTY_TEXT = '这个班级还没有学员名单，也没有本期的归档记录：先在学员管理里维护班级名单，或完成一次课后反馈的归档。';

/** 导出被拦下时的可读标题（与单作品 / 阶段两支同口径）。 */
export const POSTER_CLASS_EXPORT_BLOCKED_TITLE = '暂时不能导出这张海报';

/** 顺序调整的文案（与班级视频集锦同一批说法，界面与断言读同一份）。 */
export const POSTER_CLASS_ORDER_NOTE = '学员顺序默认按班级名单，生成前可调整：上移 / 下移只改这一张海报的排布，不动班级名单本身。';
export const POSTER_CLASS_ORDER_MOVE_UP_LABEL = '上移';
export const POSTER_CLASS_ORDER_MOVE_DOWN_LABEL = '下移';
export const POSTER_CLASS_ORDER_RESET_LABEL = '恢复班级名单顺序';
export const POSTER_CLASS_ORDER_RESET_DONE = '已恢复为班级名单顺序。';

/** 超过上限时的分批说明与导出按钮文案（验收「给出提示并支持分批出图」）。 */
export const POSTER_CLASS_BATCH_EXPORT_LABEL = '分批导出全部';
export const POSTER_CLASS_BATCH_NOTE_PREFIX = '超过单张上限';

/** 姓名标注开关的文案（US-305 第 3 条：默认开）。 */
export const POSTER_CLASS_CAPTION_TOGGLE_LABEL = '每格下方标注学员姓名';

/**
 * 作品墙的网格：**按学员数自适应**（US-305 第 2 条）。
 * 渲染层自带的三个档位只覆盖到 12 格（2×2 / 3×3 / 3×4），30 位学员会溢出画布 ——
 * 所以班级作品墙的行列由这里算好、**显式写进 spec**（不是让渲染层再猜一次）。
 * 规则：`columns = ceil(sqrt(n))`、`rows = ceil(n / columns)`（近方形，一行比一列宽一点点）。
 */
export function posterClassGridShape(count) {
  const total = Math.max(0, Math.round(Number(count) || 0));
  if (!total) return { columns: 0, rows: 0, capacity: 0, count: 0 };
  const columns = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / columns);
  return { columns, rows, capacity: columns * rows, count: total };
}

// ---------------------------------------------------------------------------
// 学员名单与顺序（名单是顺序真源；名单之外的记录接在后面）
// ---------------------------------------------------------------------------

/** 名单的两种形状都认：字符串数组，或 `{name}` 对象数组（学员管理的 `management.students`）。 */
function classNames(roster) {
  return (Array.isArray(roster) ? roster : []).map((item) => (isPlainObject(item) ? str(item.name) : str(item)));
}

/** 去重保序（空名也去重：一格「未记录姓名」就够，不重复占格）。 */
function uniqueNames(names) {
  const seen = new Set();
  const result = [];
  (Array.isArray(names) ? names : []).forEach((value) => {
    const name = str(value);
    if (seen.has(name)) return;
    seen.add(name);
    result.push(name);
  });
  return result;
}

/**
 * 默认顺序（US-305 第 3 条「默认按班级名单」）：
 * 班级名单（含 `{name}` 对象）→ 名单之外但**本期有记录**的学员（按记录顺序接在后面）→
 * 没记录姓名的记录合成的一格（排在最后，展签写「未记录姓名」）。
 */
export function posterClassBaseOrder({ roster = [], className = '', records = [] } = {}) {
  const name = str(className);
  const rosterNames = uniqueNames(classNames(roster)).filter(Boolean);
  const recordNames = uniqueNames(
    (Array.isArray(records) ? records : [])
      .filter((record) => isPlainObject(record) && str(record.className) === name)
      .map((record) => str(record.student))
  );
  const extra = recordNames.filter((value) => value && !rosterNames.includes(value));
  const unnamed = recordNames.some((value) => !value) ? [''] : [];
  return [...rosterNames, ...extra, ...unnamed];
}

/** 生效顺序：传进来的 `order` 里**属于这个班级**的名字优先（按传进来的次序），其余按默认顺序补在后面。 */
export function posterClassOrder(baseOrder = [], order = null) {
  const base = uniqueNames(baseOrder);
  const wanted = uniqueNames(Array.isArray(order) ? order : []);
  const picked = wanted.filter((name) => base.includes(name));
  return [...picked, ...base.filter((name) => !picked.includes(name))];
}

/**
 * 顺序调整（纯函数）：把 `order` 里第 `index` 位与相邻的一位换位（与班级视频集锦同一口径）。
 * `direction` 为 `-1` 上移、`1` 下移；越界原样返回（界面据此把按钮置灰）。
 */
export function posterClassMoveOrder(order, index, direction) {
  const list = uniqueNames(order);
  const from = int(index);
  const step = signedInt(direction) < 0 ? -1 : 1;
  const to = from + step;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** 顺序有没有被调过（界面据此显示「已调整」与恢复入口）。 */
export function posterClassOrderAdjusted(baseOrder = [], order = []) {
  const base = uniqueNames(baseOrder);
  const list = uniqueNames(order);
  return base.length !== list.length || base.some((name, index) => name !== list[index]);
}

// ---------------------------------------------------------------------------
// 代表作（每位学员本周期最新一幅）与格子
// ---------------------------------------------------------------------------

/** 展签文字：学员姓名；认不出姓名时写「未记录姓名」，而不是空着错位。 */
export function posterClassCaption(name) {
  return str(name) || POSTER_CLASS_UNNAMED_TEXT;
}

/**
 * 「每位学员本周期最新一幅」：只收**有成品图**的记录，按课次顺序升序覆盖写入 →
 * 留下的就是最后（最新）那一条。返回 `{ inPeriod, byStudent, artworks, lessons }`。
 */
export function posterClassPicks(records = [], { className = '', period = '', today = null } = {}) {
  const name = str(className);
  // 对象过滤与周期过滤都走档案页那一支（未选班级 = 空列表，不是全部记录）。
  const targetView = name
    ? archiveTargetView(records, { target: ARCHIVE_TARGET_CLASS, className: name })
    : { lessons: [] };
  const inPeriod = name
    ? filterArchiveRecordsByPeriod(targetView.lessons, resolveArchiveReportPeriod(period), resolvedToday(today))
    : [];
  const byStudent = new Map();
  let artworks = 0;
  inPeriod.forEach((record) => {
    const media = archiveRecordMediaView(record, { surface: 'teacher' });
    const url = str(media.artwork && media.artwork.url);
    if (!url) return;
    const date = normalizeLessonDate(record.lessonDate || record.date);
    byStudent.set(str(record.student), {
      url,
      date,
      dateText: date ? formatLessonDateDots(date) : '',
      title: str(record.title),
      recordId: str(record.id),
      recordKey: str(record.recordKey)
    });
    artworks += 1;
  });
  return { inPeriod, byStudent, artworks, lessons: inPeriod.length };
}

/**
 * 格子（本批）：按顺序一人一格。有代表作的一格带 `url`；没有的一格是**占位格** ——
 * 保留格子、不画图，格内写 `placeholderText`（「本期暂无作品」），展签仍是学员姓名。
 */
export function posterClassCells({ names = [], picks = new Map() } = {}) {
  const store = picks instanceof Map ? picks : new Map();
  return uniqueNames(names).map((name) => {
    const pick = store.get(name) || null;
    return {
      student: name,
      caption: posterClassCaption(name),
      url: pick ? pick.url : '',
      placeholderText: pick ? '' : POSTER_CLASS_NO_ARTWORK_TEXT,
      hasArtwork: Boolean(pick),
      date: pick ? pick.date : '',
      dateText: pick ? pick.dateText : '',
      title: pick ? pick.title : '',
      recordId: pick ? pick.recordId : ''
    };
  });
}

/**
 * 分批（FR-322）：按顺序每 `maxStudents` 位一批 —— **不裁剪**，每一位学员都会出现在某一批里。
 * 空名单也返回一批（批内 0 位），这样界面永远有一批可渲染 / 可判空态。
 */
export function posterClassBatches(names = [], maxStudents = POSTER_CLASS_MAX_STUDENTS) {
  const list = uniqueNames(names);
  const limit = Math.max(1, int(maxStudents) || POSTER_CLASS_MAX_STUDENTS);
  const total = Math.max(1, Math.ceil(list.length / limit));
  const batches = Array.from({ length: total }, (unused, offset) => {
    const slice = list.slice(offset * limit, (offset + 1) * limit);
    return {
      index: offset + 1,
      total,
      limit,
      size: slice.length,
      names: slice,
      from: offset * limit + 1,
      to: offset * limit + slice.length
    };
  });
  return { total, limit, count: list.length, batches };
}

/** 超过上限时的那句提示（验收「给出提示并支持分批出图」）；没超时是空串。 */
export function posterClassBatchNote(total, maxStudents = POSTER_CLASS_MAX_STUDENTS) {
  const all = int(total);
  const limit = Math.max(1, int(maxStudents) || POSTER_CLASS_MAX_STUDENTS);
  if (all <= limit) return '';
  const count = Math.ceil(all / limit);
  return `全班共 ${all} 位学员，${POSTER_CLASS_BATCH_NOTE_PREFIX} ${limit}：分成 ${count} 批出图（每批最多 ${limit} 位），文件名带 1of${count} 页码。`;
}

/** 本批里还有几位没有作品（界面提示，不阻断出图 —— 占位格就是给这件事的）。 */
export function posterClassPlaceholderNote(count) {
  const value = int(count);
  return value ? `本批有 ${value} 位学员本期暂无作品：仍保留「${POSTER_CLASS_NO_ARTWORK_TEXT}」占位格，不跳过。` : '';
}

// ---------------------------------------------------------------------------
// 模板与作品墙网格
// ---------------------------------------------------------------------------

/** 作品墙的占位区（`wall` 优先，其次第一个自适应网格的 image 位，最后第一个 image 位）。 */
export function posterClassWallSlot(spec) {
  const normalized = normalizePosterSpec(spec);
  const images = normalized.slots.filter((slot) => slot.type === 'image');
  return images.find((slot) => slot.id === POSTER_CLASS_WALL_SLOT_ID)
    || images.find((slot) => Number(slot.grid.columns) <= 0 && Number(slot.grid.rows) <= 0)
    || images[0]
    || null;
}

/**
 * 选一张班级模板：优先内置的作品墙那套 → 任意默认模板 → 第一套启用的班级模板。
 * 传入的列表（云端 / 本机镜像）先过 `normalizePosterTemplate`，脏记录不进结果。
 */
export function findPosterClassTemplate(templates = seedPosterTemplates) {
  const list = (Array.isArray(templates) ? templates : []).map(normalizePosterTemplate).filter((item) => item.id);
  const classes = list.filter((item) => item.kind === POSTER_CLASS_KIND && item.enabled !== false);
  return classes.find((item) => item.id === POSTER_CLASS_DEFAULT_TEMPLATE_KEY)
    || classes.find((item) => item.isDefault)
    || classes[0]
    || null;
}

/**
 * 作品墙的行列：模板写死了行列且**放得下**就用模板的（尊重版式），否则按学员数自适应
 * （`posterClassGridShape`）—— 「墙上少一个人」在任何情况下都不允许发生。
 */
export function posterClassWallGrid(slot, count) {
  const total = Math.max(0, Math.round(Number(count) || 0));
  const shape = posterClassGridShape(total);
  const fixedColumns = int(slot && slot.grid ? slot.grid.columns : 0);
  const fixedRows = int(slot && slot.grid ? slot.grid.rows : 0);
  const fixedCapacity = fixedColumns * fixedRows;
  if (fixedColumns > 0 && fixedRows > 0 && total <= fixedCapacity) {
    return { columns: fixedColumns, rows: fixedRows, capacity: fixedCapacity, count: total, adaptive: false, source: 'template', label: `${fixedColumns}×${fixedRows}` };
  }
  return { ...shape, adaptive: true, source: 'students', label: `${shape.columns}×${shape.rows}` };
}

/** 把网格与姓名标注开关写进作品墙那一格（**只动这两处**，坐标与样式一个字不改）。 */
function posterClassWallPatch(spec, { grid, nameCaptions }) {
  const wall = posterClassWallSlot(spec);
  const slots = spec.slots.map((slot) => {
    if (!wall || slot.id !== wall.id || slot.type !== 'image') return slot;
    return {
      ...slot,
      grid: {
        ...slot.grid,
        columns: grid.columns,
        rows: grid.rows,
        // 本批的每一位都必须进格子：上限放到「网格容量」与「本批人数」里的大者。
        maxItems: Math.max(grid.columns * grid.rows, grid.count, 1)
      },
      cellCaption: { ...slot.cellCaption, visible: nameCaptions !== false }
    };
  });
  return { ...spec, slots };
}

// ---------------------------------------------------------------------------
// 数据装配（这一步之后，界面只要 `spec` + `data` 就能渲染）
// ---------------------------------------------------------------------------

/** 共享上下文：只算一次的部分（名单 / 顺序 / 代表作 / 批次 / 分享 / Logo / 模板块）。 */
function posterClassContext({
  records = [],
  className = '',
  roster = [],
  period = '',
  order = null,
  today = null,
  record = null,
  tokens = [],
  now = null,
  teacherName = '',
  orgName = '',
  logo = '',
  origin = '',
  spec = null,
  template = null,
  maxStudents = POSTER_CLASS_MAX_STUDENTS,
  nameCaptions = true
} = {}) {
  const name = str(className);
  const periodName = resolveArchiveReportPeriod(period);
  const todayValue = resolvedToday(today);
  const window = archivePeriodWindow(periodName, todayValue);
  const templateRecord = template ? normalizePosterTemplate(template) : findPosterClassTemplate();
  const baseSpec = normalizePosterSpec(spec || (templateRecord && templateRecord.spec) || undefined);
  const limit = Math.max(1, int(maxStudents) || POSTER_CLASS_MAX_STUDENTS);

  const baseOrder = posterClassBaseOrder({ roster, className: name, records });
  const ordered = posterClassOrder(baseOrder, order);
  const picks = posterClassPicks(records, { className: name, period: periodName, today: todayValue });
  const cells = posterClassCells({ names: ordered, picks: picks.byStudent });
  const batches = posterClassBatches(ordered, limit);
  // 名单人数（只数名单里的名字）与「名单之外、本期有记录」的人数 —— 界面读数与断言读同一份。
  const rosterNames = uniqueNames(classNames(roster)).filter(Boolean);
  const extraNames = ordered.filter((item) => item && !rosterNames.includes(item));
  // 周期内最新的**课次日期**（这一张海报的「日期」）：读不出来留空，不填今天。
  const latestDate = picks.inPeriod.reduce((found, item) => {
    const date = normalizeLessonDate(item.lessonDate || item.date);
    return date && date > found ? date : found;
  }, '');

  // 二维码指向的那条记录：显式传入的那条（属于本班时）优先，否则周期内最新的一条。
  const shareRecord = isPlainObject(record) && str(record.className) === name
    ? record
    : [...picks.inPeriod].reverse().find((item) => str(item.className) === name) || null;
  const share = shareRecord
    ? shareTokenView({ tokens, recordId: shareRecord.id, now })
    : { state: 'none', stateLabel: '', active: false, tokenText: '', link: '' };
  const shareUrl = share.active && share.tokenText ? shareTokenUrl(share.tokenText, { origin }) : '';

  const logoUrl = posterImageUrl(logo);
  const logoFallback = !logoUrl ? str(orgName) : '';

  return {
    className: name,
    periodName,
    window: { period: window.period, days: window.days, from: window.from, to: window.to },
    rosterCount: rosterNames.length,
    extraCount: extraNames.length,
    periodLabel: (() => {
      const from = formatLessonDateDots(window.from);
      const to = formatLessonDateDots(window.to);
      return from && to ? `${periodName}（${from} – ${to}）` : periodName;
    })(),
    templateRecord,
    baseSpec,
    limit,
    baseOrder,
    ordered,
    cells,
    batches,
    picks,
    latestDate,
    teacherName: str(teacherName),
    orgName: str(orgName),
    share: {
      state: share.state,
      stateLabel: share.stateLabel,
      active: Boolean(share.active),
      tokenText: str(share.tokenText),
      link: shareUrl,
      pending: !shareUrl,
      recordId: shareRecord ? str(shareRecord.id) : ''
    },
    logo: { url: logoUrl, fallbackText: logoFallback },
    nameCaptions: nameCaptions !== false
  };
}

/** 合成某一批：本批的格子 + 同一份上下文 → 可直接交给渲染层的 `{spec, data, ...读数}`。 */
function composeClassPoster(context, batchIndex) {
  const index = Math.min(Math.max(1, int(batchIndex) || 1), context.batches.total);
  const batch = context.batches.batches[index - 1];
  const cellByName = new Map(context.cells.map((cell) => [cell.student, cell]));
  const batchCells = batch.names.map((name) => cellByName.get(name)).filter(Boolean);
  const wallSlot = posterClassWallSlot(context.baseSpec);
  const grid = posterClassWallGrid(wallSlot, batchCells.length);
  const artworks = batchCells.filter((cell) => cell.hasArtwork).length;
  const placeholders = batchCells.length - artworks;
  const batchNote = posterClassBatchNote(context.ordered.length, context.limit);

  // 缺件补丁：二维码位（没有有效分享）/ Logo 位（没有标识图）两种空位换成文字位 —— 与 US-303/304
  // 共用同一支实现，位置尺寸一字不动。**作品墙不过这一支**：墙上的空格子是占位格（FR-321），
  // 把它换成一句文案反而会把 30 个格子塌成一个。
  const patched = posterSingleSpecPatch(context.baseSpec, {
    sharePending: context.share.pending,
    logoFallback: context.logo.fallbackText
  });
  const spec = posterClassWallPatch(patched, { grid, nameCaptions: context.nameCaptions });

  const filename = posterClassFilename({
    className: context.className,
    period: context.periodName,
    batchIndex: index,
    batchTotal: context.batches.total
  });

  const data = {
    className: context.className,
    period: context.periodLabel,
    artworkCount: String(artworks),
    teacherName: context.teacherName,
    orgName: context.orgName,
    date: context.latestDate,
    // 作品墙素材（keyed 形状：只喂命中的占位区）；一格一条，`url:''` 是占位格。
    images: {
      [wallSlot ? wallSlot.id : POSTER_CLASS_WALL_SLOT_ID]: batchCells.map((cell) => ({
        url: cell.url,
        caption: cell.caption,
        placeholderText: cell.placeholderText
      }))
    },
    logo: context.logo.url,
    shareUrl: context.share.link
  };

  const notes = [];
  if (!context.className) notes.push(POSTER_CLASS_MISSING_TEXT);
  if (context.className && !context.ordered.length) notes.push(POSTER_CLASS_EMPTY_TEXT);
  if (batchNote) notes.push(batchNote);
  if (context.className && placeholders) notes.push(posterClassPlaceholderNote(placeholders));
  if (context.className && !context.latestDate) notes.push('这一期还没有可读的课次日期：海报上的日期位留空，不填今天。');
  if (context.className && context.share.pending) {
    notes.push(`没有有效的分享链接：二维码位显示「${POSTER_SINGLE_SHARE_PENDING_TEXT}」而不是空白方块。`);
  }
  if (context.className && !context.logo.url) {
    const reason = str(context.logo.fallbackText)
      ? posterSingleLogoFallbackNote(context.logo.fallbackText)
      : posterSingleLogoFallbackNote('');
    notes.push(reason);
  }

  const plan = {
    hasClass: Boolean(context.className),
    kind: POSTER_CLASS_KIND,
    kindLabel: POSTER_KIND_LABELS[POSTER_CLASS_KIND],
    templateKey: context.templateRecord ? context.templateRecord.id : '',
    templateName: context.templateRecord ? context.templateRecord.name : '',
    baseSpec: context.baseSpec,
    spec,
    data,
    className: context.className,
    period: context.periodName,
    periodLabel: context.periodLabel,
    window: context.window,
    teacherName: context.teacherName,
    orgName: context.orgName,
    students: {
      total: context.ordered.length,
      roster: context.rosterCount,
      extra: context.extraCount,
      artworks: context.cells.filter((cell) => cell.hasArtwork).length,
      placeholders: context.cells.filter((cell) => !cell.hasArtwork).length,
      lessons: context.picks.lessons,
      periodArtworks: context.picks.artworks,
      ordered: context.ordered,
      cells: context.cells
    },
    batch: {
      index,
      total: context.batches.total,
      limit: context.batches.limit,
      size: batchCells.length,
      from: batch.from,
      to: batch.to,
      names: batch.names.slice(),
      cells: batchCells,
      artworks,
      placeholders,
      note: batchNote,
      filename
    },
    batches: context.batches.batches.map((item) => ({
      index: item.index,
      total: item.total,
      size: item.size,
      from: item.from,
      to: item.to,
      names: item.names.slice()
    })),
    wall: {
      slotId: wallSlot ? wallSlot.id : '',
      grid,
      nameCaptions: context.nameCaptions
    },
    order: {
      base: context.baseOrder.slice(),
      value: context.ordered.slice(),
      adjusted: posterClassOrderAdjusted(context.baseOrder, context.ordered)
    },
    share: { ...context.share },
    logo: { ...context.logo },
    notes,
    exportGate: posterClassExportGate({
      hasClass: Boolean(context.className),
      batch: { size: batchCells.length }
    })
  };
  // 分批导出要按同一份上下文重建另外几批：批次上下文挂在这里，`posterClassBatchPlan()` 是唯一读入口。
  plan.batchContext = context;
  return plan;
}

/**
 * 装配一张班级作品墙海报（默认第 1 批）：`{ spec, data, ...读数 }`。
 *
 * 入参：
 *  - `records` = 归档记录（全量；按「班级 + 周期」过滤在本模块里做）；
 *  - `className` = 这一张海报属于哪个班（读不出来给空态，不渲染没有班级名的海报）；
 *  - `roster` = 班级名单（字符串数组或 `{name}` 对象数组）—— 顺序真源；
 *  - `period` = `半学期 | 一学期 | 一年度`（脏值回落默认「一学期」）；
 *  - `order` = 老师调过的顺序（缺省 / 空 = 按名单顺序；脏值不丢人，只丢出界的名字）；
 *  - `batchIndex` = 出第几批（1 起；超过批数会被夹到最后一轮）；
 *  - `record` = 二维码指向的那条记录（缺省时取周期内**最新**的一条）；
 *  - `nameCaptions` = 每格下方标注学员姓名（默认开）。
 */
export function buildPosterClassPlan(inputs = {}) {
  const context = posterClassContext(inputs);
  return composeClassPoster(context, inputs && inputs.batchIndex);
}

/**
 * 同一张海报的**另一批**（分批出图 / 导出全部批次）：纯函数，读的是同一份上下文 ——
 * 复算不会与预览那一批出现两种版式（网格 / 占位 / 二维码 / Logo 都走同一条 compose）。
 */
export function posterClassBatchPlan(plan, batchIndex = 1) {
  const context = plan && plan.batchContext;
  if (!context) return plan || null;
  return composeClassPoster(context, batchIndex);
}

/**
 * 导出门：没有班级 / 一个格子都数不出来时不允许导出，原因就是那句可读文案
 * （与单作品 / 阶段两支同一条纪律：不下载一张没有内容的图）。
 * 学员本期没有作品**不拦**：占位格本身就是给这件事的（FR-321）。
 */
export function posterClassExportGate(plan) {
  const value = isPlainObject(plan) ? plan : {};
  if (!value.hasClass) return { allowed: false, reason: POSTER_CLASS_MISSING_TEXT };
  if (!int(value.batch && value.batch.size)) {
    return { allowed: false, reason: `${POSTER_CLASS_EMPTY_TEXT}` };
  }
  return { allowed: true, reason: '' };
}

/**
 * 导出文件名（FR-342 的班级版）：`{班级名}_{周期}_班级海报.{png|jpg}`；
 * 分批时带页码 `_1of2`（与报告长图的分页命名同一口径）。空片段不参与拼接，
 * 非法字符走**装裱导出那一支**（`sanitizeArtworkExportSegment`，别再写一份）。
 */
export function posterClassFilename({ className = '', period = '', extension = 'png', batchIndex = 0, batchTotal = 0 } = {}) {
  const ext = str(extension).toLowerCase() === 'jpg' || str(extension).toLowerCase() === 'jpeg' ? 'jpg' : 'png';
  const segments = [className, resolveArchiveReportPeriod(period)]
    .map(sanitizeArtworkExportSegment)
    .filter(Boolean);
  const pages = int(batchTotal);
  const page = pages > 1 && int(batchIndex) > 0 ? `${int(batchIndex)}of${pages}` : '';
  return [...segments, '班级海报', page].filter(Boolean).join('_') + `.${ext}`;
}

/** 周期可选项（界面渲染这一份；与档案页 / 阶段海报同源）。 */
export const POSTER_CLASS_PERIOD_OPTIONS = ARCHIVE_PERIODS.slice();
export { ARCHIVE_PERIOD_DEFAULT as POSTER_CLASS_DEFAULT_PERIOD };
