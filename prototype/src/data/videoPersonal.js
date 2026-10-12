// 个人成长视频**时间线编排**的唯一真源（[第四步 US-217] / tasks/prd-archive-share.md US-217）。
//
// 视频服务还没接进来，但「一位孩子这个阶段的作品串起来会是什么样」不能等它：这一份模块把
// **串联顺序**、**缺课留白卡**、**片头**与**成片信息**定死成零依赖纯函数 + 常量
// （只 import 同样零依赖的 `videoTimeline.js` / `videoJobs.js`），Node 可直跑断言，界面只渲染它的产物。
//
//  ① **按课次日期 + 课时序号升序串联**（[第四步到第一步联通] US-087）：把这位学员在当前周期里的作品
//     按课次日期升序排成一条，同一天再按课时序号升序（序号未知的排在之后）；排序只读课次字段，
//     归档先后不参与 —— 补录的历史课次按它自己的课次日期与序号就位。
//     帧序 / 帧时长 / 转场（含「每 4 幅作品插 1 张课堂照片」）沿用 `videoTimelinePlan`（US-215）那一份规则，
//     起止由 **`videoFrameSpan`** 算 —— 这一条时间线不另写一套时长表与重叠量。
//
//  ② **缺课留白卡 1.5 秒**（`VIDEO_FRAME_DURATION_SEC.absence`）：缺课的课次**不跳过**，
//     在它自己的课次位置上留一张 1.5 秒的留白卡；卡片文案 ≤16 字（`videoAbsenceCardIssue` 是判据）。
//     老师的缺课记录原文恰好放得下（≤16 字）就**逐字用它**；放不下就用统一短句
//     （`VIDEO_ABSENCE_CARD_TEXT`，沿用缺课的温和语气）—— **不删改、也不编造老师的句子**，
//     文案来源如实写在卡片旁的说明里（`videoAbsenceCardText().source`）。
//
//  ③ **片头显示学员姓名与周期**：`陈一诺 · 2026 春季`（`videoPersonalIntroLine` 是唯一拼装点）。
//
//  ④ **成片信息**：时长 / 收录幅数 / 分辨率 / 文件大小 —— 成片要等渲染服务出片才有，
//     **推算出来的值一律标注「预估」**（`videoPersonalInfoRows` 的 `estimated` 与文案同源，
//     界面只是把它渲染出来，组件不自己拼「预估」两个字）。
//
//  ⑤ **只收录该学员自己的作品**：学员隔离是**结构性**的（条目先按 `student` 过滤才进帧序），
//     被挡下的其他学员记录如实报数（`foreignEntries`）；`videoPersonalOwnershipIssue` 是复核判据 ——
//     它逐帧读帧上带过来的 `sourceStudent`，对不上就点名，不去信构建过程。
//
// 与 `videoTimeline.js` / `videoSelection.js` 同一套纪律：视图函数**所有状态返回同形状字段**
// （US-204 的白屏坑），判据与文案只在数据层写一次，组件不自己拼字符串、也不自己算时长。

import {
  VIDEO_FRAME_DURATION_SEC,
  VIDEO_FRAME_KINDS,
  VIDEO_INTRO_TITLE,
  VIDEO_TIMELINE_ORDER_NOTE,
  VIDEO_TIMELINE_ORDER_TEXT,
  normalizeVideoFrame,
  orderVideoTimelineEntries,
  videoFrameRow,
  videoFrameSpan,
  videoTimelineContentIssue,
  videoTimelineDurationText,
  videoTimelinePlan,
  videoTimelineTimecode
} from './videoTimeline';
import { VIDEO_JOB_DEMO_LABEL, normalizeVideoJobType, videoJobTypeLabel } from './videoJobs';

const str = value => String(value ?? '').trim();
const num = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const int = value => Math.trunc(num(value));
const round1 = value => Math.round(num(value) * 10) / 10;

// ---------------------------------------------------------------------------
// ⓪ 文案（区块名 / 留白卡 / 成片信息 / 空态 —— 界面与断言读同一份）
// ---------------------------------------------------------------------------

/** 区块名（界面渲染它，组件不另起名字）。 */
export const VIDEO_PERSONAL_SECTION_TITLE = '个人成长视频时间线（mock）';
export const VIDEO_PERSONAL_SECTION_DESC = '一位孩子的作品按课次日期升序串成一条：片头写清学员与周期，每一幅作品一帧（沿用上面的帧序规则），缺课的课次留一张 1.5 秒留白卡。这里只有时间线：成片要等渲染服务接进来之后由它给出。';

/** 「这里只有时间线，不出成片」那一句（与 US-215 的 noOutput 同一条纪律）。 */
export const VIDEO_PERSONAL_NO_OUTPUT_NOTE = '这一块只出时间线：没有成片地址、封面或下载入口；成片的时长、分辨率与文件大小由渲染服务出片之后给出。';

/** 演示标注（与视频任务面板同一句 —— 直接读 `videoJobs.js` 那一份，不抄第二遍）。 */
export const VIDEO_PERSONAL_DEMO_LABEL = VIDEO_JOB_DEMO_LABEL;

/** 片头的拼装点（唯一一处）：`学员姓名 · 周期`（例如「陈一诺 · 2026 春季」）。 */
export const VIDEO_PERSONAL_INTRO_JOIN = ' · ';
export const VIDEO_PERSONAL_UNNAMED_TEXT = '未记录学员';
export const VIDEO_PERSONAL_NO_PERIOD_TEXT = '未选择周期';
export function videoPersonalIntroLine(name, period) {
  return [str(name) || VIDEO_PERSONAL_UNNAMED_TEXT, str(period) || VIDEO_PERSONAL_NO_PERIOD_TEXT].join(VIDEO_PERSONAL_INTRO_JOIN);
}

/** 一个周期里既没有作品也没有缺课记录时的说明。 */
export const VIDEO_PERSONAL_EMPTY_TEXT = '这个周期还没有这位孩子的归档记录：时间线目前只有片头与片尾。完成一节课的归档后，作品帧与留白卡会自动接上来。';

// ---------------------------------------------------------------------------
// ① 串联顺序（本故事第 1 条验收：按课次日期升序串联该学员的归档作品；
//    [第四步到第一步联通] US-087 起同一天再按课时序号升序）
// ---------------------------------------------------------------------------

/** 一条归档条目在时间线里的键（`id` 与 `recordKey` 都认，取先有的那一个 —— 与精选同一口径）。 */
export function videoPersonalEntryKey(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  return str(source.id) || str(source.recordKey);
}

/** 串联顺序那一句（界面渲染它，断言读它）：口径来自 `videoTimeline.js` 那一份，不另写一遍。 */
export function videoPersonalOrderText(count) {
  return `${Math.max(0, int(count))} 节课${VIDEO_TIMELINE_ORDER_TEXT}串联`;
}

// ---------------------------------------------------------------------------
// ② 缺课留白卡（本故事第 2 条验收：1.5 秒留白卡，文案 ≤16 字，温和语气）
// ---------------------------------------------------------------------------

/** 留白卡的时长：**只认帧时长表里的那一个数字**（1.5 秒写在 `videoTimeline.js` 一次）。 */
export const VIDEO_ABSENCE_CARD_DURATION_SEC = VIDEO_FRAME_DURATION_SEC[VIDEO_FRAME_KINDS.absence];

/** 卡片文案的字数上限（验收原文是 16）。 */
export const VIDEO_ABSENCE_CARD_TEXT_MAX_CHARS = 16;

/**
 * 老师原话放不下时用的统一短句（**沿用缺课的温和语气**：缺课不是缺席的过错，只是这一页先空着）。
 * 卡片只有 1.5 秒，所以它必须短 —— 短在这里是产品口径，不是「省略老师的话」。
 */
export const VIDEO_ABSENCE_CARD_TEXT = '这节课先留白，等你回来';

/** 两种文案来源的说明（界面照它写卡片旁的旁注，不自己判断用了哪一句）。 */
export const VIDEO_ABSENCE_CARD_SOURCE_LABELS = {
  record: '老师缺课记录原文',
  standard: '统一短句'
};
export const VIDEO_ABSENCE_CARD_NOTE_RECORD = `留白卡文案逐字取自老师的缺课记录原文（≤${VIDEO_ABSENCE_CARD_TEXT_MAX_CHARS} 字，一个字都没改）。`;
export const VIDEO_ABSENCE_CARD_NOTE_STANDARD = `老师的缺课记录原文超过 ${VIDEO_ABSENCE_CARD_TEXT_MAX_CHARS} 字（1.5 秒的卡片放不下）：卡片用统一短句，原句不删改、只留在档案里。`;

/** 留白卡文案的判据（空串 = 合规）：非空 + ≤16 字。 */
export function videoAbsenceCardIssue(value) {
  const text = str(value);
  if (!text) return '留白卡文案不能为空：卡片上要有一句温和的说明。';
  if (text.length > VIDEO_ABSENCE_CARD_TEXT_MAX_CHARS) {
    return `留白卡文案 ${text.length} 字，超过 ${VIDEO_ABSENCE_CARD_TEXT_MAX_CHARS} 字：1.5 秒的卡片放不下这么长的句子。`;
  }
  return '';
}

/**
 * 缺课条目 → 留白卡文案与它的来源：`{ text, source, sourceLabel, note }`。
 *  - 老师的缺课记录原文（归档条目上的 `absenceText`，或原始记录的 `reviews.summary`）**放得下就逐字用**；
 *  - 放不下（或没记录）→ 统一短句 `VIDEO_ABSENCE_CARD_TEXT`，并说明为什么没用原句。
 */
export function videoAbsenceCardText(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const reviews = source.reviews && typeof source.reviews === 'object' ? source.reviews : {};
  const record = str(source.absenceText) || str(reviews.summary);
  if (record && !videoAbsenceCardIssue(record)) {
    return {
      text: record,
      source: 'record',
      sourceLabel: VIDEO_ABSENCE_CARD_SOURCE_LABELS.record,
      note: VIDEO_ABSENCE_CARD_NOTE_RECORD
    };
  }
  return {
    text: VIDEO_ABSENCE_CARD_TEXT,
    source: 'standard',
    sourceLabel: VIDEO_ABSENCE_CARD_SOURCE_LABELS.standard,
    note: VIDEO_ABSENCE_CARD_NOTE_STANDARD
  };
}

// ---------------------------------------------------------------------------
// ③ 成片信息（本故事第 4 条验收：时长 / 幅数 / 分辨率；推算值必须标注「预估」）
// ---------------------------------------------------------------------------

/** 成片输出口径（FR-255）：竖屏 1080×1920、30fps、H.264（yuv420p、+faststart）。 */
export const VIDEO_PERSONAL_RENDER = {
  width: 1080,
  height: 1920,
  aspect: '9:16',
  fps: 30,
  codec: 'H.264',
  pixelFormat: 'yuv420p',
  faststart: true
};
export const VIDEO_PERSONAL_RESOLUTION_TEXT = `竖屏 ${VIDEO_PERSONAL_RENDER.width} × ${VIDEO_PERSONAL_RENDER.height}（${VIDEO_PERSONAL_RENDER.aspect} · ${VIDEO_PERSONAL_RENDER.fps}fps · ${VIDEO_PERSONAL_RENDER.codec}）`;

/**
 * 文件大小的推算区间（MB/分钟）：PRD 成本提示「一条 5 分钟 1080p 成片约 20–40MB（含 BGM 与字幕）」。
 * 它只是**推算**：真实大小由渲染服务给出，界面必须带着「预估」两个字。
 */
export const VIDEO_PERSONAL_SIZE_MB_PER_MINUTE = { min: 4, max: 8 };

/** 推算值一律带这两个字（唯一拼装点：界面不自己写「预估」）。 */
export const VIDEO_PERSONAL_ESTIMATED_WORD = '预估';

/** 时长 / 文件大小的推算区间（`{ minMb, maxMb, text }`）。 */
export function videoPersonalSizeEstimate(durationSec) {
  const minutes = Math.max(0, num(durationSec)) / 60;
  const minMb = round1(minutes * VIDEO_PERSONAL_SIZE_MB_PER_MINUTE.min);
  const maxMb = round1(minutes * VIDEO_PERSONAL_SIZE_MB_PER_MINUTE.max);
  const format = value => (value >= 10 ? String(Math.round(value)) : String(value));
  return { minMb, maxMb, text: `${VIDEO_PERSONAL_ESTIMATED_WORD}约 ${format(minMb)}–${format(maxMb)} MB` };
}

/** 成片信息的四项（顺序真源；`estimate: true` 的两项是推算值）。 */
export const VIDEO_PERSONAL_INFO_FIELDS = [
  {
    id: 'duration',
    label: '时长',
    estimate: true,
    hint: '按帧序规则推算：片头 + 每幅作品帧 + 每张留白卡 + 片尾，扣除相邻帧的交叉淡入重叠。'
  },
  {
    id: 'artworks',
    label: '收录幅数',
    estimate: false,
    hint: '这条时间线里属于该学员的作品帧数（不含课堂照片帧与留白卡）。'
  },
  {
    id: 'resolution',
    label: '分辨率',
    estimate: false,
    hint: `成片输出口径（FR-255）：${VIDEO_PERSONAL_RENDER.pixelFormat}、+faststart，微信可直接播放。`
  },
  {
    id: 'size',
    label: '文件大小',
    estimate: true,
    hint: `按 1080p 竖屏含 BGM 与字幕的码率区间推算（每分钟 ${VIDEO_PERSONAL_SIZE_MB_PER_MINUTE.min}–${VIDEO_PERSONAL_SIZE_MB_PER_MINUTE.max} MB）。`
  }
];

/** 成片信息的行 id（断言用：四项缺一不可）。 */
export const VIDEO_PERSONAL_INFO_IDS = VIDEO_PERSONAL_INFO_FIELDS.map(field => field.id);

/** 成片信息那一句「哪些是推算值」（面板底部常驻说明）。 */
export const VIDEO_PERSONAL_ESTIMATE_NOTE = '带「预估」的两项是推算值：成片的真实时长与文件大小要等渲染服务出片之后才有，这里不编实际读数。';

/**
 * 成片信息四行：时长（预估）/ 收录幅数 / 分辨率 / 文件大小（预估）。
 * 推算值的文案在这里拼好（带「预估」两个字），界面只渲染 —— 组件不许自己写「预估」。
 */
export function videoPersonalInfoRows({ durationSec = 0, artworks = 0 } = {}) {
  const duration = Math.max(0, round1(durationSec));
  const size = videoPersonalSizeEstimate(duration);
  const values = {
    duration: `${VIDEO_PERSONAL_ESTIMATED_WORD} ${videoTimelineDurationText(duration)}`,
    artworks: `${Math.max(0, int(artworks))} 幅`,
    resolution: VIDEO_PERSONAL_RESOLUTION_TEXT,
    size: size.text
  };
  return VIDEO_PERSONAL_INFO_FIELDS.map(field => ({
    id: field.id,
    label: field.label,
    value: values[field.id],
    estimated: field.estimate === true,
    estimateText: field.estimate === true ? VIDEO_PERSONAL_ESTIMATED_WORD : '',
    hint: field.hint
  }));
}

// ---------------------------------------------------------------------------
// ④ 只收录该学员自己的作品（本故事第 5 条验收）
// ---------------------------------------------------------------------------

/** 有素材的三种帧（要判定「这帧的素材属于谁」的帧）。 */
const SOURCED_FRAME_KINDS = [VIDEO_FRAME_KINDS.artwork, VIDEO_FRAME_KINDS.photo, VIDEO_FRAME_KINDS.absence];

/** 其他学员的记录被挡下多少条、都是谁（界面如实报数，不静默丢掉）。 */
export function videoPersonalForeignNote(count) {
  const total = Math.max(0, int(count));
  if (!total) return '这一条时间线上没有其他学员的素材：收录范围就是该学员自己的作品。';
  return `本周期另有 ${total} 条记录不属于这位学员（或读不出学员名）：都不进这条时间线，只收录「学员名 = 该学员」的作品。`;
}

/**
 * 「只收录该学员自己的作品」的复核判据（空串 = 合规）：
 * 逐帧读帧上带过来的 `sourceStudent`（构建时从源条目原样抄来的），对不上就点名 ——
 * 判据看的是**产物**，不是「构建过程应该没错」。
 */
export function videoPersonalOwnershipIssue(plan) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const name = str(source.objectName);
  if (!name) return '';
  const frames = Array.isArray(source.frames) ? source.frames : [];
  const foreign = frames.filter(frame => {
    const item = frame && typeof frame === 'object' ? frame : {};
    if (!SOURCED_FRAME_KINDS.includes(str(item.kind))) return false;
    return str(item.sourceStudent) !== name;
  });
  if (!foreign.length) return '';
  const names = [...new Set(foreign.map(frame => str(frame.sourceStudent) || '读不出学员名'))];
  return `时间线里混进了其他学员的素材（${names.slice(0, 3).join('、')}）：这条片子只收录该学员自己的作品。`;
}

// ---------------------------------------------------------------------------
// ⑤ 编排（纯函数；界面只渲染它的产物）
// ---------------------------------------------------------------------------

/**
 * 个人成长视频时间线（纯函数、永不抛错）：按**课次日期 + 课时序号**升序把**这一位学员**的作品串成一条，
 * 缺课课次留 1.5 秒留白卡，片头写学员与周期，并给出成片信息（推算值带「预估」）。
 * 顺序由 `orderVideoTimelineEntries` 排（US-087）：传进来的先后不影响串联顺序，归档先后不参与。
 *
 * 入参：
 *  - `entries`：当前**周期**下的归档条目（**可以带别的学员** —— 学员隔离在这里做），
 *    带 `lessonNo`（课时序号，0 = 历史记录没有记录）
 *  - `objectName`：这位学员的姓名（`entry.student === objectName` 才收录）；
 *  - `period`：生成周期（片头与成片信息读它）；
 *  - `selectedKeys`：可选的「收录清单」（US-216 的作品键）—— 传了就只排这些作品，
 *    缺课留白卡不受它影响（缺课本来就不进精选）；
 *  - `orgName` / `endingNote` / `shareReady`：片头与片尾的字段（与帧清单同一口径）；
 *  - `type`：成片类型（默认 `personal`；班级集锦的编排属于 US-218）。
 *
 * 返回（**所有状态同形状**）：`frames`（片头 → 按日期的作品/照片帧与留白卡 → 片尾）、
 * `counts`、`totalSec`、`infoRows`、`foreignEntries`、`ownershipIssue` 等。
 */
export function videoPersonalPlan({
  entries = [],
  objectName = '',
  period = '',
  orgName = '',
  endingNote = '',
  shareReady = false,
  selectedKeys = null,
  type = 'personal'
} = {}) {
  const name = str(objectName);
  const periodText = str(period);
  const org = str(orgName);
  const note = str(endingNote);
  const kind = normalizeVideoJobType(type);
  // 顺序的唯一实现（课次日期 + 课时序号升序，US-087）：传进来的先后不影响串联顺序。
  const ordered = orderVideoTimelineEntries(entries);
  // ① 学员隔离：只留这位学员自己的条目（读不出学员名的记录也算「不属于」—— 没有证据就不收录）。
  const own = name ? ordered.filter(entry => str(entry && entry.student) === name) : ordered;
  const foreignEntries = name ? ordered.filter(entry => str(entry && entry.student) !== name) : [];
  const positions = new Map();
  own.forEach((entry, index) => {
    const key = videoPersonalEntryKey(entry);
    if (key && !positions.has(key)) positions.set(key, index);
  });
  // ② 作品帧：先按精选清单（US-216）收一遍，再走 US-215 的帧序规则（缺课不进那一份）。
  const keySet = selectedKeys === null || selectedKeys === undefined
    ? null
    : new Set((Array.isArray(selectedKeys) ? selectedKeys : []).map(value => str(value)).filter(Boolean));
  const ownLessons = own.filter(entry => !(entry && entry.isAbsence));
  const lessons = keySet ? ownLessons.filter(entry => keySet.has(videoPersonalEntryKey(entry))) : ownLessons;
  const absenceEntries = own.filter(entry => entry && entry.isAbsence);
  const base = videoTimelinePlan({ entries: lessons, objectName: name, type: kind, period: periodText, orgName: org, endingNote: note, shareReady });
  const baseByKind = frameKind => base.frames.filter(frame => frame.kind === frameKind);
  const introLines = [
    `机构 Logo：${org || '机构名未记录'}`,
    `学员：${name || VIDEO_PERSONAL_UNNAMED_TEXT}`,
    `周期：${periodText || VIDEO_PERSONAL_NO_PERIOD_TEXT}`,
    `标题：${VIDEO_INTRO_TITLE}`
  ];
  const introLine = videoPersonalIntroLine(name, periodText);
  // ③ 中间段：作品帧 / 照片帧 / 缺课留白卡，都按课次日期升序排。
  // 照片帧接在**它上面那一幅作品**后面（顺序按帧序一次走完，不能分两趟 —— 分两趟会让照片挪到最后一幅之后）。
  const segments = [];
  let lastOrder = -1;
  base.frames.forEach(frame => {
    if (frame.kind === VIDEO_FRAME_KINDS.artwork) {
      const found = positions.get(str(frame.entryId));
      lastOrder = found === undefined ? lastOrder + 1 : found;
      segments.push({ order: lastOrder, frame });
      return;
    }
    if (frame.kind === VIDEO_FRAME_KINDS.photo) segments.push({ order: lastOrder + 0.5, frame });
  });
  absenceEntries.forEach(entry => {
    const card = videoAbsenceCardText(entry);
    const found = positions.get(videoPersonalEntryKey(entry));
    const order = (found === undefined ? own.length : found) + 0.25;
    segments.push({
      order,
      frame: normalizeVideoFrame({
        kind: VIDEO_FRAME_KINDS.absence,
        objectName: name,
        entryId: videoPersonalEntryKey(entry),
        date: str(entry && entry.date),
        // 留白卡也属于**这一次课**（US-087）：序号从条目带过来，卡片上能写清「第 N 次课」。
        lessonNo: entry && entry.lessonNo,
        title: card.text,
        titleText: card.text,
        // 卡片上的说明（文案来源）在帧上带一份：界面把它渲染成卡片**旁边**的旁注，不写进卡片。
        assetNote: card.note,
        sourceStudent: str(entry && entry.student)
      })
    });
  });
  segments.sort((left, right) => left.order - right.order);
  // ④ 重排时间轴：起止与转场只由 `videoFrameSpan` 算（帧时长表与重叠量的唯一真源）。
  const frames = [];
  let cursor = 0;
  const push = (frameKind, fields = {}) => {
    const span = videoFrameSpan(cursor, VIDEO_FRAME_DURATION_SEC[frameKind], { isFirst: frames.length === 0 });
    cursor = span.endSec;
    frames.push(normalizeVideoFrame({
      ...fields,
      ...span,
      id: `${frameKind}-${frames.length + 1}`,
      index: frames.length + 1,
      kind: frameKind
    }));
    return frames[frames.length - 1];
  };
  push(VIDEO_FRAME_KINDS.intro, { objectName: name, title: introLine, titleText: introLine, lines: introLines, sourceStudent: '' });
  segments.forEach(item => {
    const frame = item.frame;
    push(frame.kind, {
      objectName: name,
      entryId: frame.entryId,
      date: frame.date,
      lessonNo: frame.lessonNo,
      title: frame.title,
      titleText: frame.titleText,
      subtitle: frame.subtitle,
      subtitleSource: frame.subtitleSource,
      subtitleTruncated: frame.subtitleTruncated,
      lines: frame.lines,
      endingNote: frame.endingNote,
      asset: frame.asset,
      assetNote: frame.assetNote,
      sourceStudent: frame.sourceStudent
    });
  });
  const endingFrame = baseByKind(VIDEO_FRAME_KINDS.ending)[0] || null;
  push(VIDEO_FRAME_KINDS.ending, {
    objectName: name,
    endingNote: note,
    title: '片尾',
    lines: endingFrame ? endingFrame.lines : [
      `老师寄语：${note || '未填写（成片片尾不显示寄语）'}`,
      `机构名：${org || '机构名未记录'}`,
      `分享二维码：${shareReady ? '已具备（家长分享链接可用）' : '尚未生成分享链接'}`
    ]
  });
  const totalSec = round1(frames.length ? frames[frames.length - 1].endSec : 0);
  const artworkFrames = frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.artwork);
  const absenceFrames = frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.absence);
  const plan = {
    type: kind,
    typeLabel: videoJobTypeLabel(kind),
    objectName: name,
    period: periodText,
    orgName: org,
    endingNote: note,
    shareReady: shareReady === true,
    introLine,
    frames,
    counts: {
      frames: frames.length,
      intro: frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.intro).length,
      artworks: artworkFrames.length,
      photos: frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.photo).length,
      absence: absenceFrames.length,
      ending: frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.ending).length,
      lessons: ownLessons.length,
      externalLessons: ownLessons.length - lessons.length,
      foreign: foreignEntries.length,
      transitions: Math.max(0, frames.length - 1)
    },
    totalSec,
    // 缺课留白卡：节数、总时长与文案的清白（每一张卡都过一遍 ≤16 字与「温和语气」那一句）。
    absenceSec: round1(absenceFrames.length * VIDEO_ABSENCE_CARD_DURATION_SEC),
    absenceCardIssues: absenceFrames.map(frame => videoAbsenceCardIssue(frame.titleText)).filter(Boolean),
    foreignEntries: foreignEntries.map(entry => ({
      id: videoPersonalEntryKey(entry),
      date: str(entry && entry.date),
      student: str(entry && entry.student) || '未记录学员',
      title: str(entry && entry.title) || '作品名未记录'
    })),
    infoRows: videoPersonalInfoRows({ durationSec: totalSec, artworks: artworkFrames.length })
  };
  return {
    ...plan,
    ownershipIssue: videoPersonalOwnershipIssue(plan),
    contentIssue: videoTimelineContentIssue(plan)
  };
}

// ---------------------------------------------------------------------------
// ⑥ 规则读数与视图产物（界面只渲染它们）
// ---------------------------------------------------------------------------

/** 个人成长视频编排的规则读数（五条；界面渲染它、断言读它 —— 数字只在常量里写一次）。 */
export function videoPersonalRuleRows() {
  return [
    {
      id: 'order',
      label: '串联顺序',
      value: VIDEO_TIMELINE_ORDER_TEXT,
      detail: '这一位孩子在这个周期里的作品按课次日期 + 课时序号升序排成一条，最后接片尾；补录的历史课次按它自己的课次日期与序号就位，归档先后不参与排序。'
    },
    {
      id: 'intro',
      label: '片头',
      value: `固定 ${VIDEO_FRAME_DURATION_SEC.intro} 秒 · 学员姓名 + 周期`,
      detail: `片头写清「学员姓名${VIDEO_PERSONAL_INTRO_JOIN}周期」（例如「陈一诺 · 2026 春季」）。`
    },
    {
      id: 'absence',
      label: '缺课留白卡',
      value: `每节 ${VIDEO_ABSENCE_CARD_DURATION_SEC} 秒 · 文案 ≤${VIDEO_ABSENCE_CARD_TEXT_MAX_CHARS} 字`,
      detail: '缺课的课次不跳过：留一张留白卡，文案沿用缺课的温和语气（放不下原句就用统一短句，不删改老师的句子）。'
    },
    {
      id: 'artwork',
      label: '作品帧',
      value: `每幅 ${VIDEO_FRAME_DURATION_SEC.artwork} 秒 · 课堂照片 ${VIDEO_FRAME_DURATION_SEC.photo} 秒`,
      detail: '与上面帧清单同一套帧序规则：等比缩放留边、每 4 幅作品后插 1 张课堂照片，转场统一交叉淡入。'
    },
    {
      id: 'scope',
      label: '收录范围',
      value: '只收录该学员自己的作品',
      detail: '其他学员的记录不进这条时间线，界面如实报出被挡下的条数。'
    }
  ];
}

/** 规则的行 id（断言用：五条缺一不可）。 */
export const VIDEO_PERSONAL_RULE_IDS = videoPersonalRuleRows().map(row => row.id);

/** 一帧渲染成的一行（作品帧沿用 US-215 的行产物，留白卡另给卡片文案与来源说明）。 */
export function videoPersonalFrameRow(frame) {
  const item = normalizeVideoFrame(frame);
  const row = videoFrameRow(item);
  const isAbsence = item.kind === VIDEO_FRAME_KINDS.absence;
  return {
    ...row,
    sourceStudent: item.sourceStudent,
    isAbsence,
    cardText: isAbsence ? item.titleText : '',
    cardNote: isAbsence ? item.assetNote : '',
    cardDurationText: isAbsence ? `${VIDEO_ABSENCE_CARD_DURATION_SEC} 秒留白卡` : '',
    cardIssue: isAbsence ? videoAbsenceCardIssue(item.titleText) : ''
  };
}

/**
 * 时间线的视图产物（**所有状态返回同一组字段**）：片头行 + 帧行 + 汇总 + 成片信息 + 收录范围。
 * 界面渲染的每一行都在这里，组件不自己算时长、不自己拼「预估」。
 */
export function videoPersonalView(plan) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const frames = (Array.isArray(source.frames) ? source.frames : []).map(videoPersonalFrameRow);
  const counts = source.counts && typeof source.counts === 'object'
    ? source.counts
    : { frames: frames.length, intro: 0, artworks: 0, photos: 0, absence: 0, ending: 0, lessons: 0, externalLessons: 0, foreign: 0, transitions: 0 };
  const totalSec = Math.max(0, round1(source.totalSec));
  const narrationFrames = frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.artwork || frame.kind === VIDEO_FRAME_KINDS.absence);
  const artworkCount = frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.artwork).length;
  const absenceFrames = frames.filter(frame => frame.isAbsence);
  const infoRows = Array.isArray(source.infoRows) && source.infoRows.length
    ? source.infoRows
    : videoPersonalInfoRows({ durationSec: totalSec, artworks: artworkCount });
  const foreignEntries = (Array.isArray(source.foreignEntries) ? source.foreignEntries : []).map(entry => ({
    id: str(entry && entry.id),
    date: str(entry && entry.date),
    student: str(entry && entry.student) || VIDEO_PERSONAL_UNNAMED_TEXT,
    title: str(entry && entry.title) || '作品名未记录'
  }));
  const ownershipIssue = str(source.ownershipIssue) || videoPersonalOwnershipIssue(source);
  const contentIssue = str(source.contentIssue) || videoTimelineContentIssue(source);
  // 留白卡文案的判据：方案层已经逐张算过一遍（`absenceCardIssues`），没有就按帧行现算 —— 两处同源。
  const planIssues = (Array.isArray(source.absenceCardIssues) ? source.absenceCardIssues : []).filter(Boolean);
  const rowIssues = absenceFrames.map(frame => frame.cardIssue).filter(Boolean);
  const cardIssues = planIssues.length ? planIssues : rowIssues;
  const empty = artworkCount === 0 && absenceFrames.length === 0;
  const summary = `这条时间线共 ${counts.frames} 帧：片头 ${counts.intro} · 作品 ${artworkCount} · 课堂照片 ${counts.photos} · 缺课留白卡 ${absenceFrames.length}（每张 ${VIDEO_ABSENCE_CARD_DURATION_SEC} 秒）· 片尾 ${counts.ending}；时长按帧序规则推算 ${videoTimelineDurationText(totalSec)}。`;
  const notes = [];
  notes.push(videoPersonalForeignNote(counts.foreign));
  if (counts.externalLessons) notes.push(`其中 ${counts.externalLessons} 幅作品在精选时没有进收录清单（时长上限或老师手动排除）：它们不排进这条时间线。`);
  if (absenceFrames.length) notes.push(`缺课 ${absenceFrames.length} 节各留 ${VIDEO_ABSENCE_CARD_DURATION_SEC} 秒留白卡：不跳过，也不占作品帧的名额。`);
  return {
    type: str(source.type),
    typeLabel: str(source.typeLabel),
    objectName: str(source.objectName),
    period: str(source.period),
    introLine: str(source.introLine) || videoPersonalIntroLine(source.objectName, source.period),
    introTitle: VIDEO_INTRO_TITLE,
    frames,
    narrationFrames,
    rules: videoPersonalRuleRows(),
    infoRows,
    counts,
    frameCount: frames.length,
    artworkCount,
    photoCount: frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.photo).length,
    absenceCount: absenceFrames.length,
    absenceSec: round1(absenceFrames.length * VIDEO_ABSENCE_CARD_DURATION_SEC),
    absenceTexts: absenceFrames.map(frame => frame.cardText),
    absenceNote: absenceFrames.length ? absenceFrames[0].cardNote : '',
    totalSec,
    totalText: videoTimelineDurationText(totalSec),
    orderText: videoPersonalOrderText(counts.lessons),
    // 顺序口径的补充说明（US-087）：「不看归档时间」这句话写在老师看得到的地方，组件不自己拼。
    orderNote: VIDEO_TIMELINE_ORDER_NOTE,
    summary,
    notes,
    dates: frames.map(frame => frame.date).filter(Boolean),
    empty,
    emptyText: VIDEO_PERSONAL_EMPTY_TEXT,
    foreignCount: Math.max(0, int(counts.foreign)) || foreignEntries.length,
    foreignEntries,
    foreignNote: videoPersonalForeignNote(Math.max(0, int(counts.foreign)) || foreignEntries.length),
    ownershipIssue,
    ownershipOk: !ownershipIssue,
    contentIssue,
    clean: !contentIssue && !ownershipIssue && !cardIssues.length,
    cardIssue: cardIssues[0] || '',
    cardTextMaxChars: VIDEO_ABSENCE_CARD_TEXT_MAX_CHARS,
    cardDurationSec: VIDEO_ABSENCE_CARD_DURATION_SEC,
    estimateNote: VIDEO_PERSONAL_ESTIMATE_NOTE,
    noOutputNote: VIDEO_PERSONAL_NO_OUTPUT_NOTE,
    demoLabel: VIDEO_PERSONAL_DEMO_LABEL,
    // 「不产出 mp4」是结构性的：这一份产物里没有成片地址 / 封面 / 下载地址键（禁字段键名兜底）。
    hasOutput: false,
    outputLabel: '',
    endingNote: str(source.endingNote),
    shareReady: source.shareReady === true,
    timecode: videoTimelineTimecode(totalSec)
  };
}
