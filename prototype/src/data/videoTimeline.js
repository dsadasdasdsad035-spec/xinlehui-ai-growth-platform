// 成片内容规则与**帧清单（时间线）预览**的唯一真源（[第四步 US-215] / tasks/prd-archive-share.md US-215）。
//
// 渲染服务还没接进来，但「这条视频会是什么样」不能等它：这一份模块把**帧序规则**、
// **字幕口径**与**内容边界**全部定死成零依赖纯函数 + 常量，界面只渲染它的产物，
// 可直接用 Node 直跑断言。四件事：
//
//  ① **帧序规则**（`videoTimelineRuleRows` 是唯一真源）：
//     片头 3 秒（机构 Logo + 对象名 + 周期 + 标题「成长记录」）→ 作品帧 3.5 秒
//     （等比缩放至长边 ≤1920、暖白 #FBF8F2 背景留边）→ 每 4 幅作品后插入 1 张课堂照片 2 秒
//     （没有照片时自动跳过，不算错误）→ 片尾 4 秒（老师寄语 ≤40 字 + 机构名 + 分享二维码）；
//     转场统一 0.5 秒**交叉淡入**（不使用缩放 / 旋转 / 粒子等特效）。
//     相邻帧因此重叠 0.5 秒：后一帧比前一帧**提前 0.5 秒**开始，
//     成片时长 = 各帧时长之和 − (帧数 − 1) × 0.5 秒。
//
//  ② **帧清单（时间线）**：`videoTimelinePlan` 按条 ① 把归档条目串成帧列表
//     （`startSec / endSec / durationSec / transitionSec` 都给全），界面以帧清单展示。
//     **不产出 mp4**：这一份里没有成片地址、封面或下载地址，连字段名都被禁（见条 ③）。
//
//  ③ **字幕**（`videoSubtitleFromReview`）：取点评「美术能力」的**首句**且不超过 24 字；
//     字字来自**老师确认后的点评原文**（归档记录里的原文）—— 超长只在停顿处**截断**，
//     不补字、不改写、不加省略号；截不出就留空并给可读原因，绝不编一句话填上
//     `videoSubtitleIssue` 是「逐字来自原文」的判据（界面与断言读同一份）。
//
//  ④ **内容边界**（`videoTimelineContentIssue`）：成片里不得出现原图、推理轨迹、内部提示词
//     或联系方式。结构上成立（帧由白名单字段现拼，禁字段键名进不来），这一节是配套的复核口径：
//     键名命中即点名、成片正文（片头行 / 作品名 / 字幕 / 片尾寄语）再扫一遍联系方式。
//     联系方式的正则**复用** `data/archiveShare.js` 的那一张表（不抄第二份），文案按视频口径另给。
//
// 与 `data/videoJobs.js` 同一套纪律：视图函数**所有状态返回同形状字段**（US-204 的白屏坑），
// 判据与文案只在数据层写一次，组件不自己拼字符串。

import { ARCHIVE_SHARE_WECHAT_FORBIDDEN } from './archiveShare';
import { isPersistentMediaUrl } from './archiveMedia';
import { REVIEW_DIMENSION_NAMES } from './reviewDetailPanel';
import { isShareTokenActive } from './shareTokens';
import { normalizeVideoJobType, videoJobTypeLabel } from './videoJobs';

const str = value => String(value ?? '').trim();
const num = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const int = value => Math.trunc(num(value));
/** 所有时长都是 0.5 的整数倍：按一位小数收口，避免浮点累加出 20.999999999999996。 */
const round1 = value => Math.round(num(value) * 10) / 10;

// ---------------------------------------------------------------------------
// ⓪ 文案（区块名 / 说明 / 「不产出 mp4」那一句 —— 界面与断言读同一份）
// ---------------------------------------------------------------------------

/** 区块名（界面渲染它，组件不另起名字）。 */
export const VIDEO_TIMELINE_SECTION_TITLE = '成片帧清单（时间线预览）';
export const VIDEO_TIMELINE_SECTION_DESC = '提交之前先看一遍这条视频会怎么走：片头、每一幅作品帧、穿插的课堂照片与片尾，按帧序规则排成一条时间线。这里只出清单，不产出 mp4。';

/** 「不产出 mp4」那一句：帧清单不是成片（与 US-214 的「不是成片时长」是同一条纪律）。 */
export const VIDEO_TIMELINE_NO_OUTPUT_NOTE = '这里是帧清单（时间线预览）：不产出 mp4、不生成封面、也没有下载地址；成片要等渲染服务接进来之后由它给出。';

/** 片头标题（验收原文就是这四个字）。 */
export const VIDEO_INTRO_TITLE = '成长记录';

/** 片尾寄语的字数上限与超限原因（写入侧与界面读同一份）。 */
export const VIDEO_ENDING_NOTE_MAX_CHARS = 40;
export function videoEndingNoteIssue(value) {
  const length = String(value ?? '').length;
  if (length <= VIDEO_ENDING_NOTE_MAX_CHARS) return '';
  return `片尾寄语 ${length} 字，超过 ${VIDEO_ENDING_NOTE_MAX_CHARS} 字的限制：请再收一收，成片片尾只有 4 秒。`;
}

/** 帧清单为空（这个周期没有归档作品）时的说明。 */
export const VIDEO_TIMELINE_EMPTY_TEXT = '这个周期还没有归档的作品：帧清单目前只有片头与片尾。先去完成一节课的归档，作品帧会自动接上来。';

/** 作品帧没有作品名时的显示口径（**不是**作品名，只是一句状态；FR-205 不许编假作品名）。 */
export const VIDEO_FRAME_UNTITLED_TEXT = '作品名未记录';

// ---------------------------------------------------------------------------
// ① 帧序规则（FR-215 第 1、2、3、6 条）
// ---------------------------------------------------------------------------

/** 四种帧（片头 / 作品帧 / 课堂照片 / 片尾）。 */
export const VIDEO_FRAME_KINDS = {
  intro: 'intro',
  artwork: 'artwork',
  photo: 'photo',
  ending: 'ending'
};

export const VIDEO_FRAME_KIND_LABELS = {
  [VIDEO_FRAME_KINDS.intro]: '片头',
  [VIDEO_FRAME_KINDS.artwork]: '作品帧',
  [VIDEO_FRAME_KINDS.photo]: '课堂照片',
  [VIDEO_FRAME_KINDS.ending]: '片尾'
};

/** 每种帧的时长（秒）—— 验收点名的四个数字，改这里就是改规则。 */
export const VIDEO_FRAME_DURATION_SEC = {
  [VIDEO_FRAME_KINDS.intro]: 3,
  [VIDEO_FRAME_KINDS.artwork]: 3.5,
  [VIDEO_FRAME_KINDS.photo]: 2,
  [VIDEO_FRAME_KINDS.ending]: 4
};

/** 转场时长（秒）：统一 0.5 秒交叉淡入 —— 相邻帧因此重叠这 0.5 秒。 */
export const VIDEO_TRANSITION_SEC = 0.5;

/** 每几幅作品后插入 1 张课堂照片（验收原文是 4）。 */
export const VIDEO_PHOTO_EVERY_ARTWORKS = 4;

/** 作品帧的画面口径：等比缩放到长边 ≤1920、暖白背景留边（渲染服务的参数由它来）。 */
export const VIDEO_ARTWORK_MAX_EDGE = 1920;
export const VIDEO_ARTWORK_BACKGROUND = '#FBF8F2';

/** 转场那一句「不用什么」（验收第 6 条点名排除的特效）。 */
export const VIDEO_TRANSITION_EFFECT_NOTE = '只做交叉淡入：不使用缩放、旋转或粒子等特效。';

/** 帧序规则的五行读数（界面渲染它、断言读它 —— 数字只在上面那些常量里写一次）。 */
export function videoTimelineRuleRows() {
  return [
    {
      id: 'intro',
      label: '片头',
      value: `固定 ${VIDEO_FRAME_DURATION_SEC.intro} 秒`,
      detail: `机构 Logo + 对象名（学员名或班级名）+ 周期 + 标题「${VIDEO_INTRO_TITLE}」`
    },
    {
      id: 'artwork',
      label: '作品帧',
      value: `每幅 ${VIDEO_FRAME_DURATION_SEC.artwork} 秒`,
      detail: `等比缩放至长边 ≤${VIDEO_ARTWORK_MAX_EDGE}px，暖白（${VIDEO_ARTWORK_BACKGROUND}）背景留边`
    },
    {
      id: 'photo',
      label: '课堂照片',
      value: `每 ${VIDEO_PHOTO_EVERY_ARTWORKS} 幅作品后 1 张 · ${VIDEO_FRAME_DURATION_SEC.photo} 秒`,
      detail: '照片不够或没有照片时自动跳过，不算错误'
    },
    {
      id: 'ending',
      label: '片尾',
      value: `固定 ${VIDEO_FRAME_DURATION_SEC.ending} 秒`,
      detail: `老师寄语（≤${VIDEO_ENDING_NOTE_MAX_CHARS} 字）+ 机构名 + 分享二维码`
    },
    {
      id: 'transition',
      label: '转场',
      value: `统一 ${VIDEO_TRANSITION_SEC} 秒交叉淡入`,
      detail: VIDEO_TRANSITION_EFFECT_NOTE
    }
  ];
}

/** 帧序规则的行 id（断言用：五行缺一不可）。 */
export const VIDEO_TIMELINE_RULE_IDS = videoTimelineRuleRows().map(row => row.id);

/** 秒 → `mm:ss.s`（帧清单的起止读数；负值 / 脏值收敛成 0）。 */
export function videoTimelineTimecode(seconds) {
  const total = Math.max(0, round1(seconds));
  const minutes = Math.floor(total / 60);
  const rest = round1(total - minutes * 60);
  const whole = Math.floor(rest);
  const tenth = Math.round((rest - whole) * 10);
  return `${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${tenth}`;
}

/** 秒 → 人话（`20.5 秒` / `1 分 34 秒` / `3 分 5 秒`）。 */
export function videoTimelineDurationText(seconds) {
  const total = Math.max(0, round1(seconds));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const rest = round1(total - minutes * 60);
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

// ---------------------------------------------------------------------------
// ② 字幕：点评「美术能力」首句，≤24 字，逐字来自老师确认后的点评
// ---------------------------------------------------------------------------

/** 字幕的字数上限（验收原文是 24）。 */
export const VIDEO_SUBTITLE_MAX_CHARS = 24;
/**
 * 字幕的取法：只从「美术能力」这一维取。这一维就是五维里的第一位
 * （读 `REVIEW_DIMENSION_NAMES` 的那一份，不另写一个维度名 —— 与第三步、归档摘要同一份）。
 */
export const VIDEO_SUBTITLE_DIMENSION = REVIEW_DIMENSION_NAMES[0];
/** 超长截断时优先落到的停顿标点（在停顿处断句更像人话，仍然是原文字符）。 */
export const VIDEO_SUBTITLE_SOFT_BREAKS = '，、,：:';
/** 软断点至少要留下的字数（太靠前的逗号断出来会太短，不如按字数截）。 */
export const VIDEO_SUBTITLE_MIN_BREAK_CHARS = 6;
/** 字幕句末的句号在视频里不显示（只去这一个标点，一个字都不改）。 */
const VIDEO_SUBTITLE_TRAILING = /[。．.]$/;

/** 没有可用的点评原文时的可读原因（**不编字幕**）。 */
export const VIDEO_SUBTITLE_EMPTY_REASON = `这节课还没有老师确认后的「${VIDEO_SUBTITLE_DIMENSION}」点评原文：字幕留空，不用别的句子顶上。`;

/** 超长截断后的说明（逐字来自原文，不补字、不改写）。 */
export function videoSubtitleTruncatedNote(text) {
  return `点评首句超过 ${VIDEO_SUBTITLE_MAX_CHARS} 字：字幕在停顿处截到 ${String(text ?? '').length} 字，逐字来自点评原文，没有改写。`;
}

/**
 * 点评原文的**首句**（第一个句末标点为止；没有标点就整段）。
 * 只做「取前一段」这一件事：不改写、不补字。
 */
export function videoReviewFirstSentence(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const matched = text.match(/^[^。！？!?;；…\n]*[。！？!?;；…]?/);
  return str(matched ? matched[0] : text);
}

/**
 * 一首作品帧的字幕：点评「美术能力」首句，≤ `maxChars` 字。
 * 返回 `{ text, source, truncated, reason }`：
 *  - `text` 是**原文字符的连续片段**（超长时在停顿标点处断开，仍逐字）；
 *  - `source` 是校验用的原文（老师确认后的那一句点评）；
 *  - 没有原文时 `text` 为空串、`reason` 给可读原因（宁可没有字幕，也不编一句）。
 */
export function videoSubtitleFromReview(value, { maxChars = VIDEO_SUBTITLE_MAX_CHARS } = {}) {
  const source = String(value ?? '').trim();
  const limit = Math.max(1, int(maxChars) || VIDEO_SUBTITLE_MAX_CHARS);
  if (!source) return { text: '', source: '', truncated: false, reason: VIDEO_SUBTITLE_EMPTY_REASON };
  const sentence = videoReviewFirstSentence(source).replace(VIDEO_SUBTITLE_TRAILING, '');
  if (!sentence) return { text: '', source, truncated: false, reason: VIDEO_SUBTITLE_EMPTY_REASON };
  if (sentence.length <= limit) return { text: sentence, source, truncated: false, reason: '' };
  const window = sentence.slice(0, limit);
  let cut = 0;
  for (let index = 0; index < window.length; index += 1) {
    if (VIDEO_SUBTITLE_SOFT_BREAKS.includes(window[index])) cut = index;
  }
  const clipped = str(cut >= VIDEO_SUBTITLE_MIN_BREAK_CHARS ? window.slice(0, cut) : window);
  return { text: clipped, source, truncated: true, reason: '' };
}

/**
 * 「字幕逐字来自老师确认后的点评」的判据（空串 = 合规）。
 * 三层：字幕是原文的**连续片段**（`includes`）+ 不超 24 字 + 没有原文时字幕必须为空。
 */
export function videoSubtitleIssue(subtitle, reviewText) {
  const text = str(subtitle);
  const source = String(reviewText ?? '');
  if (!text) return '';
  if (!str(source)) return '这条字幕没有对应的点评原文：字幕只能从老师确认后的点评里原样截取，不能另写一句。';
  if (!source.includes(text)) {
    return `字幕「${text.slice(0, 18)}」不是点评原文的连续片段：字幕必须逐字来自老师确认后的点评，不得改写。`;
  }
  if (text.length > VIDEO_SUBTITLE_MAX_CHARS) {
    return `字幕 ${text.length} 字，超过 ${VIDEO_SUBTITLE_MAX_CHARS} 字的限制。`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// ③ 内容边界：原图 / 推理轨迹 / 内部提示词 / 联系方式都不进成片
// ---------------------------------------------------------------------------

/**
 * 帧清单里**绝不允许出现**的键：原图（`/original/i`）、推理轨迹（`trace`）、内部提示词
 * （`prompt` / `reasoning` / `memory` / `agentfile` / `skill` / `system`），
 * 再加上成片地址类（`outputUrl` / `downloadUrl` / `mp4`）—— 「不产出 mp4」在字段名这一层就成立。
 * 与 `data/archiveShare.js` 的分享边界的同一套写法：**只看键名，不看值**。
 */
export const VIDEO_TIMELINE_FORBIDDEN_KEY_PATTERN = /(original|trace|prompt|reasoning|memory|agentfile|agent_file|skill|system|outputurl|output_url|downloadurl|download_url|mp4)/i;

/** 不进成片的四类内容（界面逐行列出，老师在看帧清单时就能看见边界）。 */
export const VIDEO_TIMELINE_EXCLUDED_FIELDS = [
  { id: 'original', label: '原图', note: '原图（originalUrl）不进成片：帧里只有归档后的成品素材。' },
  { id: 'trace', label: '推理轨迹', note: '大模型的推理轨迹只留在老师的审计台，不进成片。' },
  { id: 'prompt', label: '内部提示词与记忆文件', note: '系统提示词、技能清单与记忆文件属于内部实现，成片里不会出现。' },
  { id: 'contact', label: '联系方式', note: '手机号 / 邮箱 / 微信号 / 链接都不进成片：字幕只写点评原文。' }
];

/** 边界那一句（面板底部常驻说明）。 */
export const VIDEO_TIMELINE_BOUNDARY_NOTE = '成片内容边界：只有成品素材、老师确认后的点评首句与课次信息；原图、推理轨迹、内部提示词与联系方式都不在其中。';

/** 递归找出不该进成片的键（与 `findOriginalMediaPaths` 同一个写法）。 */
export function findVideoTimelineForbiddenPaths(payload, prefix = '') {
  const paths = [];
  if (!payload || typeof payload !== 'object') return paths;
  Object.entries(payload).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (VIDEO_TIMELINE_FORBIDDEN_KEY_PATTERN.test(key)) paths.push(path);
    if (value && typeof value === 'object' && !Array.isArray(value)) paths.push(...findVideoTimelineForbiddenPaths(value, path));
    else if (Array.isArray(value)) value.forEach((item, index) => paths.push(...findVideoTimelineForbiddenPaths(item, `${path}[${index}]`)));
  });
  return paths;
}

/**
 * 成片文字里有没有联系方式（手机号 / 座机 / 邮箱 / 微信 QQ / 链接）。
 * 正则**复用** `data/archiveShare.js` 的 `ARCHIVE_SHARE_WECHAT_FORBIDDEN`（不抄第二份），
 * 文案按视频口径另给：分享文案那套说法在这里不适用。
 */
export function videoTimelineContactIssues(value) {
  const source = String(value ?? '');
  if (!source) return [];
  return ARCHIVE_SHARE_WECHAT_FORBIDDEN
    .filter(rule => rule.pattern.test(source))
    .map(rule => `成片文字里出现了${rule.label}（「${source.slice(0, 24)}」）：字幕与片尾只写点评原文与寄语，联系方式请当面或私聊另发。`);
}

/** 一条作品帧有没有可用的成品素材（渲染服务只认 https 持久地址，本机副本取不到）。 */
export const VIDEO_FRAME_ASSET_PENDING_TEXT = '图片同步中：渲染服务只取 https 持久地址，本机副本（data:）取不到。素材同步成功后这一帧就有图。';

/** 帧清单的成片内容判据（空串 = 干净）：禁字段键名 → 字幕逐字 → 成片文字的边界。 */
export function videoTimelineContentIssue(timeline) {
  const plan = timeline && typeof timeline === 'object' ? timeline : {};
  const frames = Array.isArray(plan.frames) ? plan.frames : [];
  const paths = findVideoTimelineForbiddenPaths({ frames });
  if (paths.length) {
    return `帧清单里出现了不该进成片的字段（${paths.slice(0, 5).join('、')}）：原图、推理轨迹、内部提示词、成片地址与联系方式都不进成片。`;
  }
  const subtitleIssues = frames
    .map(frame => videoSubtitleIssue(frame && frame.subtitle, frame && frame.subtitleSource))
    .filter(Boolean);
  if (subtitleIssues.length) return subtitleIssues[0];
  const endingIssue = videoEndingNoteIssue(plan.endingNote);
  if (endingIssue) return endingIssue;
  // 只扫**成片里真的会出现的文字**（片头行 / 作品名 / 字幕 / 片尾寄语），规则说明不参与。
  const texts = [];
  frames.forEach(frame => {
    const source = frame && typeof frame === 'object' ? frame : {};
    (Array.isArray(source.lines) ? source.lines : []).forEach(line => texts.push(line));
    texts.push(source.title, source.subtitle, source.endingNote);
  });
  const contact = texts.flatMap(videoTimelineContactIssues);
  if (contact.length) return contact[0];
  return '';
}

// ---------------------------------------------------------------------------
// ④ 帧清单组装（按条 ① 的规则把归档条目串成时间线）
// ---------------------------------------------------------------------------

/** 一帧的字段白名单（现拼 + 归一化：白名单之外的键进不来，禁字段在结构上就放不下）。 */
export const VIDEO_FRAME_FIELDS = [
  'id', 'index', 'kind', 'kindLabel', 'objectName', 'entryId', 'date', 'title', 'titleText',
  'subtitle', 'subtitleSource', 'subtitleTruncated', 'lines', 'endingNote', 'asset', 'assetNote',
  'startSec', 'endSec', 'durationSec', 'transitionSec', 'isFirst'
];

/** 归一化一帧（读旧数据 / 脏数据都不抛错；时长取整数表并做上下限收敛）。 */
export function normalizeVideoFrame(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const kind = Object.values(VIDEO_FRAME_KINDS).includes(str(source.kind)) ? str(source.kind) : VIDEO_FRAME_KINDS.artwork;
  const asset = source.asset && typeof source.asset === 'object' ? source.asset : {};
  return {
    id: str(source.id),
    index: Math.max(1, int(source.index) || 1),
    kind,
    kindLabel: VIDEO_FRAME_KIND_LABELS[kind],
    objectName: str(source.objectName),
    entryId: str(source.entryId),
    date: str(source.date),
    title: str(source.title),
    titleText: str(source.titleText) || str(source.title),
    // 字幕与它的原文：`subtitle` 是成片里显示的那一行，`subtitleSource` 是校验用的点评原文。
    subtitle: str(source.subtitle),
    subtitleSource: String(source.subtitleSource ?? ''),
    subtitleTruncated: source.subtitleTruncated === true,
    lines: (Array.isArray(source.lines) ? source.lines : []).map(str).filter(Boolean),
    endingNote: str(source.endingNote),
    asset: {
      kind: str(asset.kind),
      url: str(asset.url),
      ready: asset.ready === true,
      status: str(asset.status),
      statusText: str(asset.statusText)
    },
    assetNote: str(source.assetNote),
    startSec: Math.max(0, round1(source.startSec)),
    endSec: Math.max(0, round1(source.endSec)),
    durationSec: Math.max(0, round1(source.durationSec) || num(VIDEO_FRAME_DURATION_SEC[kind])),
    transitionSec: Math.max(0, round1(source.transitionSec)),
    isFirst: source.isFirst === true
  };
}

/** 一条归档条目 → 作品帧的素材（只有 https 持久地址渲染服务才取得到）。 */
function frameAssetOf(asset, kind) {
  const source = asset && typeof asset === 'object' ? asset : {};
  const url = str(source.url);
  const ready = Boolean(url) && isPersistentMediaUrl(url);
  return {
    kind: str(kind),
    url: ready ? url : '',
    ready,
    status: ready ? 'ready' : (url ? 'pending' : 'missing'),
    statusText: ready ? '已就绪（https 持久地址）' : VIDEO_FRAME_ASSET_PENDING_TEXT
  };
}

/** 条目里的课堂照片（只算**取得到图**的那几张；占位不算一张照片）。 */
function photosOfEntries(entries) {
  const photos = [];
  let placeholders = 0;
  entries.forEach(entry => {
    const list = Array.isArray(entry && entry.photos) ? entry.photos : [];
    list.forEach(photo => {
      const url = str(photo && photo.url);
      if (!url) { placeholders += 1; return; }
      photos.push({ url, name: str(photo && photo.name) || '课堂照片', lessonDate: str(entry && entry.date) });
    });
  });
  return { photos, placeholders };
}

/**
 * 帧清单（时间线）：按条 ① 的帧序规则把归档条目串成一条时间线。
 *
 * 入参 `entries` 是**当前对象 + 生成周期**下的归档条目（`archiveResidentView().entries` 的口径：
 * 日期升序、带 `artwork` / `photos` / `dimensions` / `isAbsence`）。
 * 缺课记录不进这一版帧序（它的 1.5 秒留白卡属于个人成长视频的编排），
 * 缺课条数如实报在 `counts.absenceLessons` 里。
 *
 * 返回的每一帧都带 `startSec / endSec / durationSec / transitionSec`（相邻帧重叠 0.5 秒）：
 * 界面把它渲染成帧清单，**不产出 mp4**（没有成片地址 / 封面 / 下载地址字段 —— 见条 ③）。
 */
export function videoTimelinePlan({ entries = [], objectName = '', type = 'personal', period = '', orgName = '', endingNote = '', shareReady = false } = {}) {
  const kind = normalizeVideoJobType(type);
  const name = str(objectName);
  const periodText = str(period);
  const org = str(orgName);
  const note = str(endingNote);
  const list = (Array.isArray(entries) ? entries : [])
    .map((entry, order) => ({ entry, order }))
    .sort((left, right) => str(left.entry && left.entry.date).localeCompare(str(right.entry && right.entry.date)) || left.order - right.order)
    .map(item => item.entry);
  const lessons = list.filter(entry => !(entry && entry.isAbsence));
  const absenceLessons = list.length - lessons.length;
  const { photos, placeholders } = photosOfEntries(lessons);

  const frames = [];
  let cursor = 0;
  const push = (frameKind, fields = {}) => {
    const durationSec = round1(VIDEO_FRAME_DURATION_SEC[frameKind]);
    const isFirst = frames.length === 0;
    // 后一帧提前 `transitionSec` 开始 —— 这就是「交叉淡入」在时间线上的样子。
    const startSec = isFirst ? 0 : round1(Math.max(0, cursor - VIDEO_TRANSITION_SEC));
    const endSec = round1(startSec + durationSec);
    cursor = endSec;
    frames.push(normalizeVideoFrame({
      ...fields,
      id: `${frameKind}-${frames.length + 1}`,
      index: frames.length + 1,
      kind: frameKind,
      startSec,
      endSec,
      durationSec,
      transitionSec: isFirst ? 0 : VIDEO_TRANSITION_SEC,
      isFirst
    }));
    return frames[frames.length - 1];
  };

  // 片头：机构 Logo + 对象名 + 周期 + 标题「成长记录」（四项都如实写，缺哪一个就写哪一个没记录）。
  push(VIDEO_FRAME_KINDS.intro, {
    objectName: name,
    title: VIDEO_INTRO_TITLE,
    lines: [
      `机构 Logo：${org || '机构名未记录'}`,
      `对象名：${name || '未记录对象'}`,
      `周期：${periodText || '未选择周期'}`,
      `标题：${VIDEO_INTRO_TITLE}`
    ]
  });

  // 作品帧 + 穿插的课堂照片：每 4 幅作品后插 1 张照片；照片不够 / 没有照片就跳过（不算错误）。
  let photoIndex = 0;
  let skippedPhotoSlots = 0;
  lessons.forEach((entry, position) => {
    const source = entry && typeof entry === 'object' ? entry : {};
    const dimensions = Array.isArray(source.dimensions) ? source.dimensions : [];
    const dimension = dimensions.find(row => str(row && row.name) === VIDEO_SUBTITLE_DIMENSION) || null;
    const reviewText = String(dimension ? dimension.text : '');
    const subtitle = videoSubtitleFromReview(reviewText);
    const artwork = source.artwork && typeof source.artwork === 'object' ? source.artwork : {};
    const asset = frameAssetOf(artwork, 'artwork');
    push(VIDEO_FRAME_KINDS.artwork, {
      objectName: name,
      entryId: str(source.id || source.recordKey),
      date: str(source.date),
      title: str(source.title),
      titleText: str(source.title) || VIDEO_FRAME_UNTITLED_TEXT,
      subtitle: subtitle.text,
      subtitleSource: reviewText,
      subtitleTruncated: subtitle.truncated,
      asset,
      assetNote: asset.ready ? '帧内按长边 ≤1920 等比缩放，暖白背景留边。' : asset.statusText
    });
    if ((position + 1) % VIDEO_PHOTO_EVERY_ARTWORKS !== 0) return;
    const photo = photos[photoIndex];
    if (!photo) { skippedPhotoSlots += 1; return; }
    photoIndex += 1;
    const photoAsset = frameAssetOf({ url: photo.url }, 'photo');
    push(VIDEO_FRAME_KINDS.photo, {
      objectName: name,
      date: photo.lessonDate,
      title: photo.name,
      titleText: photo.name,
      asset: photoAsset,
      assetNote: photoAsset.ready ? '课堂照片帧：停留 2 秒。' : photoAsset.statusText
    });
  });

  // 片尾：老师寄语（≤40 字）+ 机构名 + 分享二维码。
  push(VIDEO_FRAME_KINDS.ending, {
    objectName: name,
    endingNote: note,
    title: '片尾',
    lines: [
      `老师寄语：${note || '未填写（成片片尾不显示寄语）'}`,
      `机构名：${org || '机构名未记录'}`,
      `分享二维码：${shareReady ? '已具备（家长分享链接可用）' : '尚未生成分享链接'}`
    ]
  });

  const totalSec = round1(frames.length ? frames[frames.length - 1].endSec : 0);
  const artworkFrames = frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.artwork);
  const plan = {
    type: kind,
    typeLabel: videoJobTypeLabel(kind),
    objectName: name,
    period: periodText,
    orgName: org,
    endingNote: note,
    shareReady: shareReady === true,
    frames,
    counts: {
      frames: frames.length,
      intro: frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.intro).length,
      artworks: artworkFrames.length,
      photos: frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.photo).length,
      ending: frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.ending).length,
      absenceLessons,
      skippedPhotoSlots,
      unavailablePhotos: placeholders,
      transitions: Math.max(0, frames.length - 1)
    },
    totalSec,
    // 字幕覆盖率：多少条作品帧带着「逐字来自点评」的字幕（缺点评的帧就没字幕，如实报数）。
    subtitleCount: artworkFrames.filter(frame => frame.subtitle).length,
    totalArtworkEntries: lessons.length
  };
  return { ...plan, contentIssue: videoTimelineContentIssue(plan) };
}

/** 分享二维码这一帧能不能画出来（对象名下有没有**可用**的家长分享令牌）。 */
export function videoTimelineShareReady(tokens, entries) {
  const list = Array.isArray(tokens) ? tokens : [];
  const ids = new Set((Array.isArray(entries) ? entries : []).map(entry => str(entry && entry.id)).filter(Boolean));
  if (!ids.size) return false;
  return list.some(token => ids.has(str(token && token.recordId)) && isShareTokenActive(token));
}

// ---------------------------------------------------------------------------
// ⑤ 视图产物（帧清单的行 / 汇总 / 边界 —— 界面只渲染它）
// ---------------------------------------------------------------------------

/** 一帧渲染成的一行（起止 / 时长 / 字幕 / 素材 / 转场都给全，组件不自己拼时间）。 */
export function videoFrameRow(frame) {
  const item = normalizeVideoFrame(frame);
  return {
    id: item.id,
    index: item.index,
    indexLabel: `第 ${item.index} 帧`,
    kind: item.kind,
    kindLabel: item.kindLabel,
    objectName: item.objectName,
    date: item.date,
    title: item.title,
    titleText: item.titleText,
    startSec: item.startSec,
    endSec: item.endSec,
    startText: videoTimelineTimecode(item.startSec),
    endText: videoTimelineTimecode(item.endSec),
    timeText: `${videoTimelineTimecode(item.startSec)} – ${videoTimelineTimecode(item.endSec)}`,
    durationSec: item.durationSec,
    durationText: `${item.durationSec} 秒`,
    transitionSec: item.transitionSec,
    transitionText: item.transitionSec
      ? `与上一帧交叉淡入 ${item.transitionSec} 秒（含在 ${item.durationSec} 秒里）`
      : '开头：没有转场',
    subtitle: item.subtitle,
    subtitleSource: item.subtitleSource,
    subtitleTruncated: item.subtitleTruncated,
    // 字幕的两种说明：有字幕 → 逐字来自点评（超长时点明截断）；没字幕 → 如实说为什么留空。
    subtitleText: item.subtitle
      ? (item.subtitleTruncated ? videoSubtitleTruncatedNote(item.subtitle) : `字幕取自「${VIDEO_SUBTITLE_DIMENSION}」首句，逐字来自老师确认后的点评。`)
      : VIDEO_SUBTITLE_EMPTY_REASON,
    lines: item.lines,
    endingNote: item.endingNote,
    asset: item.asset,
    assetNote: item.assetNote,
    // 「不得包含原图 / 轨迹 / 提示词 / 联系方式」在帧这一层的读数（界面据此显示徽标，断言读同一份）。
    boundaryIssue: videoTimelineContentIssue({ frames: [item], endingNote: item.endingNote })
  };
}

/**
 * 帧清单的视图产物（**所有状态返回同一组字段**）：规则五行 + 帧行 + 汇总 + 内容边界 + 成片判据。
 * 界面渲染的每一行都在这里，组件不自己算时长、不自己拼字幕说明。
 */
export function videoTimelineView(plan) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const frames = (Array.isArray(source.frames) ? source.frames : []).map(videoFrameRow);
  const counts = source.counts && typeof source.counts === 'object'
    ? source.counts
    : { frames: frames.length, intro: 0, artworks: 0, photos: 0, ending: 0, absenceLessons: 0, skippedPhotoSlots: 0, unavailablePhotos: 0, transitions: 0 };
  const totalSec = Math.max(0, round1(source.totalSec));
  const contentIssue = str(source.contentIssue) || videoTimelineContentIssue(source);
  const empty = !frames.some(frame => frame.kind === VIDEO_FRAME_KINDS.artwork);
  const note = str(source.endingNote);
  // 成片里真的会出现的文字（片头行 / 作品名 / 字幕 / 片尾寄语）—— 边界那一行据此判「有没有联系方式」。
  const videoTexts = frames.flatMap(frame => [...frame.lines, frame.title, frame.subtitle, frame.endingNote]).filter(Boolean);
  const contactIssues = videoTimelineContactIssues(videoTexts.join(' '));
  const summary = frames.length
    ? `帧清单共 ${counts.frames} 帧：片头 ${counts.intro} · 作品 ${counts.artworks} · 课堂照片 ${counts.photos} · 片尾 ${counts.ending}；成片时长按帧序规则推算 ${videoTimelineDurationText(totalSec)}（含 ${counts.transitions} 处 ${VIDEO_TRANSITION_SEC} 秒交叉淡入重叠）。`
    : VIDEO_TIMELINE_EMPTY_TEXT;
  const notes = [];
  if (counts.absenceLessons) notes.push(`缺课 ${counts.absenceLessons} 节不进这一版帧序（留白卡属于个人成长视频的编排）。`);
  if (counts.skippedPhotoSlots) notes.push(`有 ${counts.skippedPhotoSlots} 处「每 4 幅作品插 1 张照片」的位置没有照片，已自动跳过（不算错误）。`);
  if (counts.unavailablePhotos) notes.push(`另有 ${counts.unavailablePhotos} 张课堂照片还在同步中，暂不排进帧清单。`);
  return {
    frames,
    rules: videoTimelineRuleRows(),
    counts,
    totalSec,
    totalText: videoTimelineDurationText(totalSec),
    summary,
    notes,
    empty,
    emptyText: VIDEO_TIMELINE_EMPTY_TEXT,
    subtitleCount: Math.max(0, int(source.subtitleCount)),
    // 内容边界四行（原图 / 轨迹 / 提示词 / 联系方式）：前三行在结构上成立（帧由白名单字段现拼），
    // 联系方式是扫成片文字得出的 —— 有问题的那一行如实不 ok，并把它记进 `contactIssues`。
    boundaryRows: VIDEO_TIMELINE_EXCLUDED_FIELDS.map(field => ({
      id: field.id,
      label: field.label,
      note: field.note,
      ok: field.id === 'contact' ? contactIssues.length === 0 : true
    })),
    contactIssues,
    contentIssue,
    clean: !contentIssue,
    boundaryNote: VIDEO_TIMELINE_BOUNDARY_NOTE,
    noOutputNote: VIDEO_TIMELINE_NO_OUTPUT_NOTE,
    // 「不产出 mp4」是结构性的：这一份产物里没有成片地址 / 封面 / 下载地址键（禁字段键名兜底）。
    hasOutput: false,
    outputLabel: '',
    typeLabel: str(source.typeLabel),
    objectName: str(source.objectName),
    period: str(source.period),
    endingNote: note,
    endingNoteIssue: videoEndingNoteIssue(note),
    endingNoteMaxChars: VIDEO_ENDING_NOTE_MAX_CHARS,
    shareReady: source.shareReady === true
  };
}
