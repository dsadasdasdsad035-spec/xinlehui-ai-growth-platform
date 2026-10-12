// 海报导出（[海报 US-311a] / FR-341 ~ FR-343、FR-348）的唯一真源。
//
// 这个模块回答六个问题，全部是零依赖纯函数（只 import 其它 data 模块，可直接用 Node 跑断言）：
//   ① 导出什么：PNG（无损）与 JPG（质量 0.9，微信友好）两档的口径写在 `POSTER_EXPORT_FORMATS`
//      一处 —— 界面按钮、编码参数（`renderPoster({ type, quality })`）与断言都读它，改规则只改一处；
//   ② 文件叫什么：`posterExportFilename()` 按 `kind` 分派到各版式自己的命名函数
//      （空格与非法字符在 `sanitizeArtworkExportSegment` 那一支里处理，别再写一份）；
//   ③ 导出几张：`posterExportPages()` —— 班级分批与长图分段都要逐张出，各带页码；
//   ④ 导出前校验什么：`posterExportChecks()` 读**真渲染一次的产物**（渲染层的 `plan` 与
//      `warnings`）→ 素材未缺失 / 二维码不低于可扫阈值 / 文字未溢出（FR-343）；
//   ⑤ 校验没过怎么处置：`POSTER_EXPORT_CHECK_POLICY` 一处声明（三项都是 block：不下载一张
//      缺内容 / 码扫不出来 / 少了几字的图 —— 老师把文案改短或换一套模板就能过）；
//   ⑥ 怎么存下去：`posterExportSaveStrategy()` 按 UA 判据分流「直接下载 / 长按保存」
//      （复用装裱导出那一支），并如实给出「这个浏览器能不能调起系统分享（`navigator.share`）」。

import {
  ARTWORK_EXPORT_LONG_PRESS_HINT,
  artworkExportPlatform,
  artworkExportSaveStrategy,
  artworkExportSizeText
} from './artworkExport';
import { POSTER_QR_MIN_PIXELS } from './posterTemplates';
import { posterSingleFilename } from './posterSingle';
import { posterPeriodFilename } from './posterPeriod';
import { posterClassFilename } from './posterClass';
import { posterVideoCoverFilename } from './posterVideoCover';
import { posterReportFilename } from './posterReportLong';

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value) => String(value === null || value === undefined ? '' : value).trim();
const int = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : 0;
};
const round = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : 0;
};

// ---------------------------------------------------------------------------
// 导出格式（FR-341）：PNG 无损 / JPG 质量 0.9
// ---------------------------------------------------------------------------

/**
 * 渲染引擎认的两个编码 mime（`renderPoster({ type, quality })`）。
 * **全仓只在这里定义**：`services/poster.js` re-export 这两个名字（既有调用方一字不改），
 * 导出格式表也只引用它们 —— 别在界面或服务里再抄一遍 `'image/jpeg'`。
 */
export const POSTER_MIME_PNG = 'image/png';
export const POSTER_MIME_JPEG = 'image/jpeg';
/** JPG 导出的编码质量（FR-341 的「质量 0.9」；PNG 无损，没有质量档）。 */
export const POSTER_JPG_QUALITY = 0.9;

export const POSTER_EXPORT_FORMATS = [
  {
    id: 'png',
    label: 'PNG（无损）',
    shortLabel: 'PNG',
    extension: 'png',
    mimeType: POSTER_MIME_PNG,
    quality: null,
    actionLabel: '导出 PNG',
    summary: '无损：每个像素都与画布一致，适合留档与打印（体积大一些）。'
  },
  {
    id: 'jpg',
    label: 'JPG（质量 0.9）',
    shortLabel: 'JPG',
    extension: 'jpg',
    mimeType: POSTER_MIME_JPEG,
    quality: POSTER_JPG_QUALITY,
    actionLabel: '导出 JPG',
    summary: '质量 0.9：体积小，微信里预览与转发更顺（微信还会再压一次）。'
  }
];

export const POSTER_EXPORT_FORMAT_IDS = POSTER_EXPORT_FORMATS.map((item) => item.id);
/** 默认格式：PNG（FR-341 的「首选」）。 */
export const POSTER_EXPORT_DEFAULT_FORMAT = 'png';

/** 某一档的完整口径。认不出的 id 回落默认档（不抛错、也不返回空值）。 */
export function posterExportFormat(id) {
  const wanted = str(id).toLowerCase();
  return POSTER_EXPORT_FORMATS.find((item) => item.id === wanted)
    || POSTER_EXPORT_FORMATS.find((item) => item.id === POSTER_EXPORT_DEFAULT_FORMAT);
}

/** 两档各是什么（面板上那一行规则文案；与装裱的 `artworkExportRulesText()` 同一条写法）。 */
export function posterExportRulesText() {
  return POSTER_EXPORT_FORMATS.map((item) => `${item.label}：${item.summary}`).join(' ');
}

// ---------------------------------------------------------------------------
// 文件命名（FR-342）：{学员名}_{作品名或周期}_海报.{png|jpg}
// ---------------------------------------------------------------------------

/**
 * 导出文件名：按 `kind` 分派到各版式自己的命名函数（分派只有这一处，组件与服务都不自己拼）。
 * `pageIndex` 只对多张的版式有意义（班级分批 `_1of2`、长图分段 `_长图_1of3`）。
 */
export function posterExportFilename(plan = null, { format = POSTER_EXPORT_DEFAULT_FORMAT, pageIndex = 1 } = {}) {
  const value = isPlainObject(plan) ? plan : {};
  const entry = posterExportFormat(format);
  const kind = str(value.kind);
  const index = Math.max(1, int(pageIndex) || 1);
  if (kind === 'period') {
    return posterPeriodFilename({ student: value.studentName, period: value.period, extension: entry.extension });
  }
  if (kind === 'class') {
    return posterClassFilename({
      className: value.className,
      period: value.period,
      extension: entry.extension,
      batchIndex: index,
      batchTotal: int(value.batch && value.batch.total)
    });
  }
  if (kind === 'video-cover') {
    return posterVideoCoverFilename({ student: value.objectName, period: value.period, extension: entry.extension });
  }
  if (kind === 'report-long') {
    const pages = Array.isArray(value.pages) ? value.pages : [];
    const page = pages[index - 1] || null;
    return posterReportFilename({
      student: value.studentName,
      period: value.period,
      extension: entry.extension,
      pageIndex: index,
      pageTotal: int((page && page.total) || pages.length)
    });
  }
  return posterSingleFilename({
    student: value.studentName,
    artworkTitle: value.artworkTitle,
    date: value.date,
    extension: entry.extension
  });
}

/**
 * 这一张海报要出几张、每张的页码是多少（FR-322 班级分批 / US-307 长图分段）。
 * 单张的版式恒为一条 —— 界面按 `length` 决定按钮文案（「导出全部 N 张」）。
 */
export function posterExportPages(plan = null) {
  const value = isPlainObject(plan) ? plan : {};
  const kind = str(value.kind);
  if (kind === 'class') {
    const total = Math.max(1, int(value.batch && value.batch.total));
    return Array.from({ length: total }, (_, index) => ({ index: index + 1, total, kind, note: '' }));
  }
  if (kind === 'report-long') {
    const pages = Array.isArray(value.pages) ? value.pages : [];
    const total = Math.max(1, pages.length);
    return Array.from({ length: total }, (_, index) => {
      const page = pages[index] || null;
      return { index: (page && int(page.index)) || index + 1, total, kind, note: str(page && page.notes) };
    });
  }
  return [{ index: 1, total: 1, kind: kind || 'single', note: '' }];
}

// ---------------------------------------------------------------------------
// 导出前校验（FR-343）
// ---------------------------------------------------------------------------

/**
 * 二维码最小边长（像素）：可扫阈值。**从 `posterTemplates` 取同一份常量再导出** ——
 * 管理端保存前的校验（US-312b）、这里的读数和断言读的都是它，别在任一侧再抄一遍 120。
 */
export { POSTER_QR_MIN_PIXELS };

export const POSTER_EXPORT_CHECK_IDS = ['assets', 'qrcode', 'text'];
export const POSTER_EXPORT_CHECK_LABELS = { assets: '素材', qrcode: '二维码', text: '文字' };
/** 三项校验各是什么（面板上那一行说明；与 AC 原文同口径）。 */
export const POSTER_EXPORT_CHECKS_RULE = '导出前校验三项：素材未缺失、二维码不低于可扫阈值、文字未溢出（读的是真渲染一次的产物）。';
/**
 * 校验没过的处置：`block` = 不进下载（老师改短文案 / 换模板 / 先出图再发），`warn` = 如实报告但放行。
 * 三项都是 block —— 缺内容、码扫不出来、文字少了几字的图，都不该在老师不知情的情况下发出去。
 */
export const POSTER_EXPORT_CHECK_POLICY = { assets: 'block', qrcode: 'block', text: 'block' };

export function posterExportCheckPolicy(id) {
  return POSTER_EXPORT_CHECK_POLICY[str(id)] === 'block' ? 'block' : 'warn';
}

/** 校验没通过时的回执抬头（回执与面板读同一句）。 */
export const POSTER_EXPORT_BLOCKED_TITLE = '导出前校验没通过，这张图先不下载：';
/** 还没渲染出来时的回执（校验是「真渲染一次」的产物，没有产物就没有读数）。 */
export const POSTER_EXPORT_NO_RENDER_TEXT = '这张图还没渲染出来，没法做导出前校验。';

function renderedSlots(rendered) {
  const plan = isPlainObject(rendered) && isPlainObject(rendered.plan) ? rendered.plan : {};
  return Array.isArray(plan.slots) ? plan.slots : [];
}

function renderedSpecSlots(rendered) {
  const spec = isPlainObject(rendered) && isPlainObject(rendered.spec) ? rendered.spec : {};
  return Array.isArray(spec.slots) ? spec.slots : [];
}

/**
 * ① 素材缺失的明细：**给了地址却没画出来**的那种（解码失败 / 取不到图）。
 * `url:''` 的占位格**不算缺失** —— 班级作品墙的「本期暂无作品」格（FR-321）与长图的
 * 「本期作品待同步」段都是有意留的，把它们算成缺失会把正常出图拦成不能导出。
 *
 * 作品位**逐格判**：一格没画出来也要报（整格 `drawn` 只表示「至少画出来一格」，
 * 拿它当判据会漏掉「九宫格里坏了一幅」——本轮真踩到）。
 */
export function posterExportMissingAssets(rendered = null) {
  const missing = [];
  renderedSlots(rendered).forEach((slot) => {
    if (!isPlainObject(slot) || slot.reason === 'hidden') return;
    if (slot.type === 'image') {
      const cells = Array.isArray(slot.cells) ? slot.cells : [];
      const failed = cells.filter((cell) => str(cell && cell.url) && cell.drawn !== true);
      if (failed.length) {
        missing.push({ id: str(slot.id) || 'image', type: 'image', count: failed.length, urls: failed.map((cell) => str(cell.url)) });
      }
      return;
    }
    if (slot.drawn === true) return;
    if (slot.type === 'logo') {
      const url = str(slot.url);
      if (url) missing.push({ id: str(slot.id) || 'logo', type: 'logo', count: 1, urls: [url] });
    }
  });
  return missing;
}

/**
 * ② 二维码读数：边长（像素）与可扫阈值（`POSTER_QR_MIN_PIXELS`，FR-343 / PRD 9.4）。
 * 口径 = **画布短边上的真实像素**（`slot.box.width`，与渲染层 `posterRatioToPixels` 同源，
 * 也与管理端保存前的可扫性校验读同一份阈值）；`devicePixels` 是导出倍数下的像素，只用于展示。
 */
export function posterExportQrView(rendered = null) {
  const min = POSTER_QR_MIN_PIXELS;
  const slot = renderedSlots(rendered).find((item) => isPlainObject(item) && item.type === 'qrcode') || null;
  if (!slot) {
    return { present: false, drawn: false, hidden: false, pixels: 0, devicePixels: 0, min, ok: true, value: '没有这一项', detail: '这套版式里没有二维码位：不校验可扫性。' };
  }
  if (slot.reason === 'hidden') {
    return { present: true, drawn: false, hidden: true, pixels: 0, devicePixels: 0, min, ok: true, value: '未启用', detail: '二维码位这次没画（模板或老师关掉了）：不校验可扫性。' };
  }
  const pixels = round(slot.box && slot.box.width);
  const scale = Number(rendered && rendered.scale);
  const ratio = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const devicePixels = round(pixels * ratio);
  if (slot.drawn !== true) {
    const reason = str(slot.reason) === 'unencodable'
      ? '链接太长、编码不出来'
      : '这一支没有可用的分享链接';
    return {
      present: true,
      drawn: false,
      hidden: false,
      pixels,
      devicePixels,
      min,
      ok: false,
      value: '没画出来',
      detail: `二维码没有画出来（${reason}）：先生成分享链接，或关掉二维码位再导出。`
    };
  }
  const ok = pixels >= min;
  return {
    present: true,
    drawn: true,
    hidden: false,
    pixels,
    devicePixels,
    min,
    ok,
    value: `${pixels}px / 阈值 ${min}px`,
    detail: ok
      ? `二维码边长 ${pixels}px（导出文件里 ${devicePixels}px）≥ 可扫阈值 ${min}px。`
      : `二维码过小：边长 ${pixels}px < 可扫阈值 ${min}px（导出文件里也只有 ${devicePixels}px）——换一套码更大的模板，或让管理员把码调大。`
  };
}

/** ③ 文字溢出：被 `maxLines` 截断的那些文字位（渲染层 `truncated` 为真）。 */
export function posterExportTextIssues(rendered = null) {
  const specSlots = renderedSpecSlots(rendered);
  return renderedSlots(rendered)
    .filter((slot) => isPlainObject(slot) && slot.type === 'text' && slot.truncated === true)
    .map((slot) => {
      const id = str(slot.id);
      const specSlot = specSlots.find((item) => isPlainObject(item) && str(item.id) === id) || null;
      return {
        id,
        maxLines: Math.max(1, int(specSlot && specSlot.maxLines) || 1),
        dropped: Math.max(0, int(slot.dropped)),
        lines: Array.isArray(slot.lines) ? slot.lines.length : 0
      };
    });
}

function assetDetail(missing) {
  return `素材缺失：${missing.map((item) => `${item.type === 'logo' ? 'Logo 位' : '作品位'}「${item.id}」有 ${item.count} 处给了地址却画不出来`).join('；')}。请等素材同步完成后重试，或换一套版式。`;
}

function textDetail(issues) {
  return `文字溢出：${issues.map((item) => `文字位「${item.id}」超出 ${item.maxLines} 行，已省略 ${item.dropped} 个字`).join('；')}。把这几个字改短（在「文案与作品微调」里），或换一套更宽的版式再导出。`;
}

/**
 * 三项校验读数：`{ ok, rendered, rows, blocked, summary }`。
 *
 * `rows` 每项 `{ id, label, ok, policy, value, detail }` —— 面板逐行渲染它、断言读同一条；
 * `blocked` 只含没过且 policy 为 block 的项（服务层照它决定「下不下载」）。
 * 入参 `rendered` 是这一次真渲染的产物（渲染层 `plan` + `spec` + `scale`），不是「估算」。
 */
export function posterExportChecks({ rendered = null, gate = null } = {}) {
  const value = isPlainObject(rendered) ? rendered : null;
  const gateView = isPlainObject(gate) ? gate : null;
  if (!value) {
    return { ok: false, rendered: false, rows: [], blocked: [], summary: POSTER_EXPORT_NO_RENDER_TEXT };
  }
  const gateBlocked = Boolean(gateView) && gateView.allowed === false;
  const missing = posterExportMissingAssets(value);
  const qr = posterExportQrView(value);
  const text = posterExportTextIssues(value);

  const assetRow = {
    id: 'assets',
    label: POSTER_EXPORT_CHECK_LABELS.assets,
    policy: posterExportCheckPolicy('assets'),
    ok: !gateBlocked && missing.length === 0,
    value: gateBlocked ? '缺件' : (missing.length ? `缺 ${missing.length} 处` : '完整'),
    detail: gateBlocked
      ? `导出门拦下了这一张：${str(gateView.reason)}`
      : (missing.length ? assetDetail(missing) : '素材都在：作品与 Logo 的地址都画出来了（有意的占位格不算缺失）。')
  };
  const qrRow = {
    id: 'qrcode',
    label: POSTER_EXPORT_CHECK_LABELS.qrcode,
    policy: posterExportCheckPolicy('qrcode'),
    ok: qr.ok,
    value: qr.value,
    detail: qr.detail,
    pixels: qr.pixels,
    min: qr.min
  };
  const textRow = {
    id: 'text',
    label: POSTER_EXPORT_CHECK_LABELS.text,
    policy: posterExportCheckPolicy('text'),
    ok: text.length === 0,
    value: text.length ? `${text.length} 处溢出` : '未溢出',
    detail: text.length ? textDetail(text) : '文字都在 `maxLines` 之内：没有被省略的字。'
  };
  const rows = [assetRow, qrRow, textRow];
  const blocked = rows.filter((row) => !row.ok && row.policy === 'block');
  return {
    ok: blocked.length === 0,
    rendered: true,
    rows,
    blocked,
    missing,
    qr,
    text,
    summary: blocked.length ? `${POSTER_EXPORT_BLOCKED_TITLE}${blocked.map((row) => row.detail).join(' ')}` : '三项校验都通过（素材完整 / 二维码达标 / 文字未溢出）。'
  };
}

/** 校验没通过时的可读原因（服务层回执与界面提示读同一句）。 */
export function posterExportBlockedText(checks = null) {
  const value = isPlainObject(checks) ? checks : null;
  if (!value || !Array.isArray(value.blocked) || !value.blocked.length) return '';
  return `${POSTER_EXPORT_BLOCKED_TITLE}${value.blocked.map((row) => row.detail).join(' ')}`;
}

// ---------------------------------------------------------------------------
// 交付路径（FR-348）：常规浏览器直接下载 / iOS 与微信长按保存 / 能分享就分享
// ---------------------------------------------------------------------------

/** 长按保存的那句提示（装裱导出已经写过一次，这里只做别名，别抄第二份）。 */
export const POSTER_EXPORT_LONG_PRESS_HINT = ARTWORK_EXPORT_LONG_PRESS_HINT;
/** 能调起系统分享时的说明（iOS Safari 支持 `navigator.share({ files })`）。 */
export const POSTER_EXPORT_SHARE_NOTE = '这个浏览器能直接调起系统分享：存到相册、发微信、发给同事都在系统面板里选。';
/** 调不起系统分享时的说明（微信内置浏览器没有 `navigator.share`）。 */
export const POSTER_EXPORT_SHARE_UNSUPPORTED_NOTE = '这个浏览器不支持直接分享（没有 navigator.share）：长按图片保存到相册，或换 Safari 打开。';
/** 还没导出过就点「直接分享」时的回执。 */
export const POSTER_EXPORT_SHARE_EMPTY_TEXT = '还没有导出的图片：先点「导出」，再点「直接分享」。';

/**
 * 交付路径：`{ mode, reason, hint, platform, canShare, shareNote }`。
 * `mode = 'download'`（`<a download>` 真下载）还是 `'longpress'`（把图显示出来长按保存）
 * 由**装裱导出的同一支 UA 判据**给出（iOS 全系与微信内置浏览器都不执行 blob 下载）；
 * `canShare` 由调用方把 `navigator.canShare({ files })` 的真结果传进来 —— 这个模块不碰浏览器 API。
 */
export function posterExportSaveStrategy({ userAgent = '', canShareFiles = false } = {}) {
  const base = artworkExportSaveStrategy({ userAgent });
  const canShare = Boolean(canShareFiles);
  return {
    mode: base.mode,
    reason: base.reason,
    hint: base.hint,
    platform: artworkExportPlatform(userAgent),
    canShare,
    shareNote: canShare ? POSTER_EXPORT_SHARE_NOTE : POSTER_EXPORT_SHARE_UNSUPPORTED_NOTE
  };
}

/** 导出成功的回执（文件名 / 尺寸 / 体积 / 页码都来自这一句的唯一产出）。 */
export function posterExportDoneText({ filename = '', width = 0, height = 0, bytes = 0, format = POSTER_EXPORT_DEFAULT_FORMAT, pageIndex = 1, pageTotal = 1 } = {}) {
  const entry = posterExportFormat(format);
  const page = int(pageTotal) > 1 ? `（第 ${Math.max(1, int(pageIndex))}/${int(pageTotal)} 张）` : '';
  return `已导出 ${entry.shortLabel}：${filename}（${round(width)}×${round(height)} · ${artworkExportSizeText(bytes)}）${page}`;
}

/** 多张一起导出时的汇总回执（逐张的明细由面板列出来）。 */
export function posterExportBatchText({ count = 0, total = 0, format = POSTER_EXPORT_DEFAULT_FORMAT } = {}) {
  const entry = posterExportFormat(format);
  return `已导出 ${int(count)}/${int(total)} 张 ${entry.shortLabel}（文件名带页码，按顺序发即可）。`;
}

/** 长按保存那一档的回执（下载被浏览器忽略，如实说明去哪儿长按）。 */
export function posterExportLongPressText({ filename = '', pageTotal = 1 } = {}) {
  const pages = int(pageTotal) > 1 ? `共 ${int(pageTotal)} 张图，逐张长按保存；` : '';
  return `${pages}${POSTER_EXPORT_LONG_PRESS_HINT}（文件名 ${filename || '见上方图片'}）`;
}
