/**
 * 成品图写回课次作品位 + 溯源记录（[第二步 US-008b] / PRD US-008「保存图片（下载 + 写回课次）」）。
 *
 * 「保存图片」其实是两件事，必须分开看：
 *   ① **下载**：把合成好的那一档（高清 PNG / 微信 JPG）交给浏览器存到本机 —— US-008a 已完成；
 *   ② **写回**：把成品图 + 一份溯源记录写进**本次课后反馈的作品位**，让五维点评页与 3D 画廊
 *      立刻用上这张图 —— 本模块。
 * 两件事互不阻断：**写回失败时下载照常成功**，界面上按 PRD 的口径提示
 * 「已保存到本地，未能同步到档案，可重试」（`artworkWriteBackFailureText`）。
 *
 * ## 写回的是什么
 *
 * 作品位（个人反馈的 `media.artwork`、班级反馈的上传条目）上多一个 `writeBack` 子对象：
 *
 * ```
 * { imageUrl, specSnapshot, specKey, sourceUrl, sourceFingerprint, generatedAt,
 *   operatorId, operatorName, quality, filename, bytes, width, height, ... }
 * ```
 *
 * 其中 `specSnapshot` / `sourceUrl` / `generatedAt` / `operatorId` 是 PRD 点名的四项溯源，
 * 其余字段是为了让消费点（点评页 / 归档 / 画廊）不必回头猜「这张图是什么档、谁存的」。
 *
 * ## 写回的图为什么不是「下载下来的那份字节」
 *
 * 下载文件按所选档位（高清 PNG 可以到 3480×2629 ≈ 1.1MB，data URL 约 1.5MB）；
 * 写回的作品位是**持久副本**（归档 → localStorage → 画廊贴图），所以它用
 * `ARTWORK_WRITE_BACK_IMAGE` 的档案展示口径（长边 ≤1600、JPEG 0.85，与微信档同参数）。
 * 老师手上那份母版照旧在高清档里，档案里保存的是"够家长看"的那一份 —— 界面上如实写明。
 *
 * ## 新鲜度键（本模块最要紧的一条纪律）
 *
 * 写回之后老师还可能改装裱参数（形状 / 卡纸 / 水印 / 落款 / 时间）或改变量（学员名、作品名、
 * 课次日期、老师姓名）。旧写回图**不许冒充新图**：记录里存一个 `renderKey`，消费点用
 * `artworkWriteBackIsFresh(record, 当前键)` 判断 —— 过期就退回实时渲染的成品图，
 * 界面上提示「参数已改动，重新保存即可更新档案」。
 *
 * 键 = 装裱参数（整份渲染视图的键）+ 底图地址指纹 + 图上会印的变量指纹。
 * 前两项管"画面怎么画"，第三项管"画面上印了谁" —— 少一项就会出现"改了学员名，档案里还是旧名字"。
 *
 * 与 `data/artworkEdit.js` / `data/artworkLayers.js` 同一套纪律：**零依赖纯函数 + 常量**，
 * 不 import services、不碰 DOM，可以直接用 Node 跑断言（唯一 import 是同样零依赖的 artworkLayers，
 * 为了复用同一份地址指纹实现，不抄第二份）。
 */

import { artworkUrlFingerprint } from './artworkLayers';
import { artworkExportSizeText } from './artworkExport';

/** 写回记录的结构版本（读旧记录时按它做兼容；不含素材地址的旧记录一律视为无效）。 */
export const ARTWORK_WRITE_BACK_VERSION = 1;

/**
 * 写回的作品位是**持久副本**，所以走档案展示口径（长边 ≤1600、JPEG 0.85 —— 与微信档同参数）。
 * 理由见文件头：高清 PNG 的 data URL 约 1.5MB，进 localStorage 会顶爆配额，而档案/画廊
 * 本来就是给家长看的展示口径；老师本机下载的那份母版不受影响。
 */
export const ARTWORK_WRITE_BACK_IMAGE = Object.freeze({
  mimeType: 'image/jpeg',
  maxLongEdge: 1600,
  jpegQuality: 0.85,
  label: '档案展示口径（长边 ≤1600 · JPEG 0.85）'
});

/** 持久副本目前落在哪儿：本机内嵌（data URL）。对象存储接入是 US-203「归档素材持久化」的范围。 */
export const ARTWORK_WRITE_BACK_STORAGE = Object.freeze({
  id: 'local-persistent-copy',
  label: '本机持久副本',
  note: '对象存储还没接入，成品图先以本机持久副本写回；接上对象存储后换成 https 地址（US-203）。'
});

/** 写回对象与溯源记录都只认这些字段（白名单构造：结构上就没有别的东西能进来）。 */
export const ARTWORK_WRITE_BACK_FIELDS = [
  'version',
  'imageUrl',
  'imageStorage',
  'imageStorageLabel',
  'imageWidth',
  'imageHeight',
  'specSnapshot',
  'specKey',
  'specSummary',
  'sourceUrl',
  'sourceFingerprint',
  'generatedAt',
  'operatorId',
  'operatorName',
  'quality',
  'qualityLabel',
  'filename',
  'bytes',
  'width',
  'height',
  'lessonId',
  'lessonDate',
  'studentId',
  'studentName',
  'title',
  // 这一次写回是「哪次批量装裱」产生的（US-010）：单独「保存图片」产生的记录是空串。
  // 班级反馈的批量装裱据此判定「这幅作品有没有被单独调整过」——
  // 有 batchId 的记录只可能来自批量，没有的只可能来自老师对单幅作品的保存。
  'batchId',
  // 这张成品图是用哪一套装裱模板生成的（US-011b）：后台删除模板前的「历史成品引用」判据。
  // 成品图本身是独立副本，模板删了也不影响它 —— 这里只用于统计引用范围。
  'presetId',
  'renderKey'
];

/** PRD 点名的四项溯源字段（面板上要给它们一个明确的位置，也供验证脚本点名核对）。 */
export const ARTWORK_WRITE_BACK_PROVENANCE_KEYS = ['specSnapshot', 'sourceUrl', 'generatedAt', 'operatorId'];

/** 失败文案的开头（PRD 原文口径）：下载成功、只是没写进档案。 */
export const ARTWORK_WRITE_BACK_FAILURE_PREFIX = '已保存到本地，未能同步到档案';

const str = (value) => (value === null || value === undefined ? '' : String(value).trim());
const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** 写回失败时给老师看的那句话：下载照常成功，只是档案没同步，可以重试。 */
export function artworkWriteBackFailureText(reason = '') {
  const detail = str(reason);
  return detail ? `${ARTWORK_WRITE_BACK_FAILURE_PREFIX}：${detail}。可重试。` : `${ARTWORK_WRITE_BACK_FAILURE_PREFIX}。可重试。`;
}

/**
 * 地址的持久性判据（写回能不能在刷新后活下来，以及 US-203 的「https 才入库」都会读它）。
 *   - `data-url`：内容就在地址里，刷新、重启都在；
 *   - `remote`：https/http，远端持久地址；
 *   - `session`：`blob:` / `file:` 这类只在本次会话有效的地址；
 *   - `''`：空。
 */
export function persistentAddressKind(url) {
  const text = str(url);
  if (!text) return '';
  if (text.startsWith('data:')) return 'data-url';
  if (/^https?:\/\//i.test(text)) return 'remote';
  if (/^(blob:|filesystem:)/i.test(text)) return 'session';
  return 'other';
}

/** 持久性判据的可读文案（面板与断言共用一份）。 */
export function persistentAddressLabel(url) {
  switch (persistentAddressKind(url)) {
    case 'data-url': return '本机持久副本';
    case 'remote': return '远端持久地址';
    case 'session': return '会话内地址（刷新即失效）';
    case 'other': return '未知地址';
    default: return '未写回';
  }
}

/** 时间文案（`2026-10-11 15:20`）；认不出的值原样返回空串 —— 不编造日期。 */
export function artworkWriteBackTimeText(value) {
  const text = str(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (input) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 白名单构造一条写回记录。**永不抛错**：缺字段补空值，写回的**有效性**由
 * `artworkWriteBackProblem` 单独判定（服务层据此决定走成功还是「未能同步」那条路）。
 */
export function buildArtworkWriteBack(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const imageUrl = str(source.imageUrl);
  const sourceUrl = str(source.sourceUrl);
  const snapshot = source.specSnapshot && typeof source.specSnapshot === 'object' ? source.specSnapshot : null;
  const record = {
    version: ARTWORK_WRITE_BACK_VERSION,
    imageUrl,
    imageStorage: str(source.imageStorage) || ARTWORK_WRITE_BACK_STORAGE.id,
    imageStorageLabel: str(source.imageStorageLabel) || ARTWORK_WRITE_BACK_STORAGE.label,
    imageWidth: num(source.imageWidth),
    imageHeight: num(source.imageHeight),
    // 参数快照：当时的装裱渲染视图（v1/v2 都收），只读留档 —— 将来要复现这一张图靠它。
    specSnapshot: snapshot,
    specKey: str(source.specKey),
    specSummary: str(source.specSummary),
    sourceUrl,
    sourceFingerprint: str(source.sourceFingerprint) || artworkUrlFingerprint(sourceUrl),
    generatedAt: str(source.generatedAt),
    operatorId: str(source.operatorId),
    operatorName: str(source.operatorName),
    quality: str(source.quality),
    qualityLabel: str(source.qualityLabel),
    filename: str(source.filename),
    bytes: num(source.bytes),
    width: num(source.width),
    height: num(source.height),
    lessonId: str(source.lessonId),
    lessonDate: str(source.lessonDate),
    studentId: str(source.studentId),
    studentName: str(source.studentName),
    title: str(source.title),
    // 批量装裱的批次 id（US-010）：空串 = 老师单独保存的这一幅。
    batchId: str(source.batchId),
    // 生成这张图用的模板 id（US-011b）：空串 = 老师当时没用模板（或旧记录没记）。
    presetId: str(source.presetId),
    renderKey: str(source.renderKey)
  };
  return record;
}

/** 读旧记录 / 脏数据用的容错收敛：认不出的输入返回 `null`，不抛错。 */
export function normalizeArtworkWriteBack(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = buildArtworkWriteBack(raw);
  // 没有成品图地址的"写回"在领域里不成立（旧数据、半截写入都可能这样）。
  if (!record.imageUrl) return null;
  return record;
}

/** 从作品位（`media.artwork` 或上传条目）取写回记录：统一入口，别在别处自己读 `.writeBack`。 */
export function artworkWriteBackOf(slot) {
  const source = slot && typeof slot === 'object' ? slot : {};
  return normalizeArtworkWriteBack(source.writeBack);
}

/** 一条写回记录「能不能被消费」：没问题返回空串，有问题返回可读原因。 */
export function artworkWriteBackProblem(record) {
  const source = record && typeof record === 'object' ? record : null;
  if (!source) return '写回记录为空';
  if (!str(source.imageUrl)) return '成品图地址为空';
  if (persistentAddressKind(source.imageUrl) === 'session') return '成品图地址是会话内地址（刷新即失效）';
  if (!str(source.sourceUrl)) return '原图地址为空';
  if (!str(source.operatorId)) return '操作人为空';
  if (!str(source.generatedAt)) return '生成时间为空';
  return '';
}

/** 一条写回记录是否可用（`artworkWriteBackProblem` 的布尔版）。 */
export function artworkWriteBackReady(record) {
  return !artworkWriteBackProblem(record);
}

/**
 * 新鲜度键：装裱参数（整份渲染视图的键）+ 底图地址 + 图上会印的变量。
 * 三个都进键，才能同时挡住「改了框却用旧图」与「换了学员名却还是旧名字」。
 */
export function artworkWriteBackKey({ specKey = '', sourceUrl = '', student = '', title = '', lessonDate = '', teacherName = '', orgName = '', rotation = 0 } = {}) {
  // `rotation` 只对班级反馈有意义：那条路径的合成底图是上传原图（`entry.url`），
  // 老师随后点「顺时针旋转」改的是条目上的展示角（raw 地址不变）—— 不把它算进键里，
  // 旋转之后旧成品图会被当成"还新鲜"继续展示，与条目当前的样子对不上。
  const variables = [student, title, lessonDate, teacherName, orgName, Number(rotation) || 0].map(str).join('|');
  return [
    artworkUrlFingerprint(str(specKey)) || 'nospec',
    artworkUrlFingerprint(str(sourceUrl)) || 'nosource',
    artworkUrlFingerprint(variables)
  ].join('|');
}

/** 记录是不是按**当前**参数生成的。过期（参数改过）时消费点必须退回实时渲染的成品图。 */
export function artworkWriteBackIsFresh(record, renderKey) {
  const normalized = record && typeof record === 'object' ? record : null;
  const key = str(renderKey);
  if (!normalized || !key) return false;
  return str(normalized.renderKey) === key;
}

/**
 * 消费点唯一入口：作品位里「可以直接展示的成品图地址」。
 * 只有写回**新鲜**时才返回写回图；过期或没有写回时返回空串，调用方自己回落到实时渲染的成品图。
 */
export function writtenBackImageUrl(slot, renderKey) {
  const record = artworkWriteBackOf(slot);
  if (!record || !artworkWriteBackIsFresh(record, renderKey)) return '';
  return record.imageUrl;
}

/** 把写回记录挂进作品位（返回新对象，不改输入）。个人反馈写 `media.artwork`，班级反馈写上传条目。 */
export function applyWriteBackToSlot(slot, record) {
  const base = slot && typeof slot === 'object' ? slot : {};
  const normalized = normalizeArtworkWriteBack(record);
  if (!normalized) return { ...base };
  return { ...base, writeBack: normalized };
}

/** 摘要一行：面板、归档摘要与画廊都读它（同一句话，别各写一遍）。 */
export function artworkWriteBackSummaryText(record) {
  const normalized = normalizeArtworkWriteBack(record);
  if (!normalized) return '尚未写回';
  const parts = [
    '已写回档案',
    normalized.qualityLabel || normalized.quality || '',
    normalized.imageWidth && normalized.imageHeight ? `档案副本 ${normalized.imageWidth}×${normalized.imageHeight}` : '',
    artworkWriteBackTimeText(normalized.generatedAt),
    normalized.operatorName || normalized.operatorId
  ];
  return parts.filter(Boolean).join(' · ');
}

/** 溯源清单（面板渲染它，验证脚本点名核对 PRD 的四项）。 */
export function artworkWriteBackProvenanceEntries(record) {
  const normalized = normalizeArtworkWriteBack(record);
  if (!normalized) return [];
  const snapshotFingerprint = artworkUrlFingerprint(JSON.stringify(normalized.specSnapshot || {}));
  const entries = [
    {
      key: 'specSnapshot',
      label: '参数快照',
      value: `${normalized.specSummary || '已记录渲染参数'}（指纹 ${normalized.specKey ? artworkUrlFingerprint(normalized.specKey) : snapshotFingerprint}）`,
      // 整份快照是可复现这一张图的依据，留档展示（太长不塞进一行）。
      detail: JSON.stringify(normalized.specSnapshot || {}, null, 2)
    },
    {
      key: 'sourceUrl',
      label: '原图地址',
      value: `${normalized.sourceFingerprint} · ${persistentAddressLabel(normalized.sourceUrl)}`,
      detail: normalized.sourceUrl
    },
    {
      key: 'generatedAt',
      label: '生成时间',
      value: artworkWriteBackTimeText(normalized.generatedAt) || normalized.generatedAt,
      detail: normalized.generatedAt
    },
    {
      key: 'operatorId',
      label: '操作人',
      value: `${normalized.operatorName || '—'}（${normalized.operatorId || '—'}）`,
      detail: normalized.operatorId
    },
    {
      key: 'file',
      label: '保存的档位',
      value: [normalized.qualityLabel || normalized.quality, normalized.filename, normalized.bytes ? artworkExportSizeText(normalized.bytes) : '', normalized.width && normalized.height ? `${normalized.width}×${normalized.height}` : ''].filter(Boolean).join(' · '),
      detail: normalized.filename
    },
    {
      key: 'imageUrl',
      label: '档案成品图',
      value: `${ARTWORK_WRITE_BACK_IMAGE.label} · ${normalized.imageWidth}×${normalized.imageHeight} · ${persistentAddressLabel(normalized.imageUrl)}`,
      detail: persistentAddressKind(normalized.imageUrl) === 'data-url' ? '' : normalized.imageUrl
    }
  ];
  return entries.filter((entry) => Boolean(entry.value));
}

/** 课次 + 学员上下文的可读说明（写回面板与归档摘要共用）。 */
export function artworkWriteBackContextText(record) {
  const normalized = normalizeArtworkWriteBack(record);
  if (!normalized) return '';
  const who = [normalized.studentName, normalized.title ? `《${normalized.title}》` : ''].filter(Boolean).join(' ');
  const when = normalized.lessonDate ? `课次 ${normalized.lessonDate}` : '';
  const lesson = normalized.lessonId ? `课次号 ${normalized.lessonId.slice(0, 8)}` : '';
  return [who, when, lesson].filter(Boolean).join(' · ');
}
