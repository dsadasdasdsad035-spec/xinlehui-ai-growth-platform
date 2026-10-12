// 班级视频集锦**按学员分段编排**的唯一真源（[第四步 US-218] / tasks/prd-archive-share.md 的 US-218）。
//
// 视频服务还没接进来，但「全班串成一条会是什么样」不能等出片：这一份模块把**分段方式**、
// **姓名卡**、**留白卡**、**顺序**与**时长上限**定死成零依赖纯函数 + 常量
// （只 import 同样零依赖的 `videoTimeline.js` / `videoSelection.js` / `videoJobs.js` / `videoPersonal.js`），
// Node 可直跑断言，界面只渲染它的产物。五件事：
//
//  ① **按学员分段，每位学员一段**（`videoClassSegments`）：段首一张 **1.5 秒姓名卡**
//     （`VIDEO_FRAME_KINDS.nameCard`）写着姓名与这一段收录的作品数；段内沿用 `videoTimelinePlan`
//     那一套帧序规则（作品帧按课次日期升序、每 4 幅作品后插 1 张课堂照片），起止一律走
//     **`videoFrameSpan`** —— 这一条时间线不另写一套时长表与重叠量。
//
//  ② **学员顺序默认按班级名单，生成前可调整**（`roster` + `order`）：`roster` 是名单（顺序真源），
//     `order` 是老师调整后的顺序（只对名单上的名字重新排列）；名单之外但本期有记录的学员
//     **接在名单之后**照样各占一段，并如实报数（`extraStudents`）—— 不静默丢掉他们的作品。
//
//  ③ **某位学员本期无作品时保留留白卡而不是跳过**（`VIDEO_FRAME_KINDS.blank`，1.5 秒，文案 ≤16 字）：
//     这一位的一段 = 姓名卡（0 幅作品）+ 留白卡；整段不跳过，也不与其他学员合并。
//
//  ④ **全班串成一条时间线，总时长不超过 5 分钟**：上限读 `videoSelectionDurationSec` 那一份
//     `VIDEO_DURATION_CAP_SEC.class`（300 秒，与 US-216 的班级成片同一个数）。
//     超上限时按「每位学员至少 1 幅（保底）+ 按作品数比例分配」先定名额（`videoSelectionAllocateGroups`），
//     再逐档试出**最大的**放得下的名额（照片槽有台阶，时长对名额不是严格单调，所以逐个试而不是二分）；
//     保底本身超上限时如实标 `overCap`（**不许靠少收某位学员来凑时长**，与 US-216 同一口径）。
//
//  ⑤ **姓名卡与作品不串档**：复核判据 `videoClassCrossTalkIssue(plan)` 逐段读**产物** ——
//     姓名卡上写的幅数与这一段真实的作品帧数对账、每一帧的 `sourceStudent` 与段首姓名卡对账、
//     没有作品的段必须有留白卡（有作品的反之）。判据看帧本身，不去信构建过程（与 US-217 同一纪律）。
//
// 与 `videoTimeline.js` / `videoSelection.js` / `videoPersonal.js` 同一套纪律：视图函数**所有状态
// 返回同形状字段**（US-204 的白屏坑），判据与文案只在数据层写一次，组件不自己拼字符串、也不自己算时长。

import {
  VIDEO_FRAME_DURATION_SEC,
  VIDEO_FRAME_KINDS,
  VIDEO_INTRO_TITLE,
  normalizeVideoFrame,
  videoFrameRow,
  videoFrameSpan,
  videoTimelineContentIssue,
  videoTimelineDurationText,
  videoTimelinePlan,
  videoTimelineTimecode
} from './videoTimeline';
import { VIDEO_JOB_DEMO_LABEL, normalizeVideoJobType, videoJobTypeLabel } from './videoJobs';
import {
  VIDEO_DURATION_CAP_SEC,
  VIDEO_SELECTION_UNNAMED_STUDENT,
  videoDurationCapSec,
  videoSelectionAllocateGroups,
  videoSelectionCapText,
  videoSelectionEntryKey,
  videoSelectionSampleIndices,
  videoSelectionStudentGroups
} from './videoSelection';
// 成片输出口径（分辨率 / 码率区间）与「预估」两个字**复用个人成长视频那一份**（不抄第二遍）：
// 两条时间线的成片参数本来就是同一套（FR-255），另写一份必然漂移。
import {
  VIDEO_PERSONAL_ESTIMATED_WORD,
  VIDEO_PERSONAL_RENDER,
  VIDEO_PERSONAL_RESOLUTION_TEXT,
  videoPersonalSizeEstimate
} from './videoPersonal';

const str = value => String(value ?? '').trim();
const num = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const int = value => Math.trunc(num(value));
const round1 = value => Math.round(num(value) * 10) / 10;
const dedupe = list => Array.from(new Set((Array.isArray(list) ? list : []).map(str).filter(Boolean)));

// ---------------------------------------------------------------------------
// ⓪ 文案（区块名 / 姓名卡 / 留白卡 / 顺序 / 上限 —— 界面与断言读同一份）
// ---------------------------------------------------------------------------

/** 区块名（界面渲染它，组件不另起名字）。 */
export const VIDEO_CLASS_SECTION_TITLE = '班级视频集锦（mock）';
export const VIDEO_CLASS_SECTION_DESC = '全班串成一条时间线：每位学员一段（顺序默认按班级名单，生成前可调整），段首一张 1.5 秒姓名卡写着姓名与作品数，段内按课次时间线排；某位学员本期没有作品时保留一张 1.5 秒留白卡，不跳过整段。总时长不超过 5 分钟。';

/** 「这里只有时间线，不出成片」那一句（与 US-215/217 的 noOutput 同一条纪律）。 */
export const VIDEO_CLASS_NO_OUTPUT_NOTE = '这一块只出时间线：没有成片地址、封面或下载入口；成片的时长、分辨率与文件大小由渲染服务出片之后给出。';

/** 演示标注（与视频任务面板同一句 —— 直接读 `videoJobs.js` 那一份，不抄第二遍）。 */
export const VIDEO_CLASS_DEMO_LABEL = VIDEO_JOB_DEMO_LABEL;

/** 片头的拼装点（唯一一处）：`班级名 · 周期`（例如「周六创意绘画 2 班 · 2026 春季」）。 */
export const VIDEO_CLASS_INTRO_JOIN = ' · ';
export const VIDEO_CLASS_UNNAMED_TEXT = '未记录班级';
export const VIDEO_CLASS_NO_PERIOD_TEXT = '未选择周期';
export function videoClassIntroLine(className, period) {
  return [str(className) || VIDEO_CLASS_UNNAMED_TEXT, str(period) || VIDEO_CLASS_NO_PERIOD_TEXT].join(VIDEO_CLASS_INTRO_JOIN);
}

/** 一段时间线里一位学员都没有（这个班级在这个周期没有记录）时的说明。 */
export const VIDEO_CLASS_EMPTY_TEXT = '这个周期还没有这个班级的归档记录：时间线目前只有片头与片尾。完成一节课的归档后，学员分段与作品帧会自动接上来。';

// ---------------------------------------------------------------------------
// ① 姓名卡（本故事第 1 条验收：段首 1.5 秒姓名卡显示姓名与作品数）
// ---------------------------------------------------------------------------

/** 姓名卡的时长：**只认帧时长表里的那一个数字**（1.5 秒写在 `videoTimeline.js` 一次）。 */
export const VIDEO_CLASS_NAME_CARD_DURATION_SEC = VIDEO_FRAME_DURATION_SEC[VIDEO_FRAME_KINDS.nameCard];

/** 姓名卡上那一行（唯一拼装点）：`陈一诺 · 3 幅作品`。 */
export function videoClassNameCardTitle(name, count) {
  return `${str(name) || VIDEO_SELECTION_UNNAMED_STUDENT}${VIDEO_CLASS_INTRO_JOIN}${Math.max(0, int(count))} 幅作品`;
}

/** 姓名卡那一句口径（界面渲染它，断言读它）。 */
export const VIDEO_CLASS_NAME_CARD_NOTE = `段首 ${VIDEO_CLASS_NAME_CARD_DURATION_SEC} 秒姓名卡：写着这位学员的姓名与这一段收录的作品数。`;

/** 姓名卡的判据（空串 = 合规）：姓名非空 + 作品数是一个非负整数（0 幅也是合法值 —— 那一段会有留白卡）。 */
export function videoClassNameCardIssue(name, count) {
  if (!str(name)) return '姓名卡上没有姓名：段首这张卡就是用来认人的，姓名必须写上去。';
  if (count === null || count === undefined || count === '' || !Number.isFinite(Number(count)) || Number(count) < 0) {
    return '姓名卡上没有写作品数：段首这张卡要写清这位学员这一段收录了几幅作品。';
  }
  return '';
}

// ---------------------------------------------------------------------------
// ② 本期留白卡（本故事第 3 条验收：本期无作品保留留白卡而不是跳过）
// ---------------------------------------------------------------------------

/** 留白卡的时长：同样只认帧时长表里的那一个数字（1.5 秒）。 */
export const VIDEO_CLASS_BLANK_DURATION_SEC = VIDEO_FRAME_DURATION_SEC[VIDEO_FRAME_KINDS.blank];

/** 卡片文案的字数上限（与 US-217 的留白卡同一档：1.5 秒只够一句话）。 */
export const VIDEO_CLASS_BLANK_TEXT_MAX_CHARS = 16;

/** 留白卡的那一句话（**只放这一句**：卡片元素里多一个 span 就会让 DOM 上的字数判据失守）。 */
export const VIDEO_CLASS_BLANK_TEXT = '本期还没有收录作品';

/** 留白卡文案的判据（空串 = 合规）：非空 + ≤16 字。 */
export function videoClassBlankCardIssue(value) {
  const text = str(value);
  if (!text) return '留白卡文案不能为空：卡片上要有一句说明。';
  if (text.length > VIDEO_CLASS_BLANK_TEXT_MAX_CHARS) {
    return `留白卡文案 ${text.length} 字，超过 ${VIDEO_CLASS_BLANK_TEXT_MAX_CHARS} 字：1.5 秒的卡片放不下这么长的句子。`;
  }
  return '';
}

/** 留白卡的旁注（写在卡片**旁边**，不写进卡片）：说清这一位为什么留白。 */
export function videoClassBlankNote(name) {
  return `${str(name) || VIDEO_SELECTION_UNNAMED_STUDENT}：本期一件作品都没有 —— 保留一张 ${VIDEO_CLASS_BLANK_DURATION_SEC} 秒留白卡，整段不跳过。`;
}

/** 「不串档」那一条口径（面板上常驻，界面渲染它、断言读它）。 */
export const VIDEO_CLASS_CROSSTALK_NOTE = '姓名卡与作品不串档：每一段的姓名卡上写的幅数与段内真实的作品帧数对账，段里任何一帧的来源学员都必须等于段首姓名卡上的那一位。';

// ---------------------------------------------------------------------------
// ③ 顺序（本故事第 2 条验收：默认按班级名单，生成前可调整）
// ---------------------------------------------------------------------------

/** 顺序那一句口径（界面渲染它，断言读它）。 */
export function videoClassOrderNote(count) {
  return `学员顺序默认按班级名单（${Math.max(0, int(count))} 位），生成前可以用上移 / 下移调整；调整只影响分段顺序，不影响各自的作品与课次。`;
}

/** 顺序的汇总读数：`3 位学员各一段串成一条时间线`。 */
export function videoClassOrderText(count) {
  return `${Math.max(0, int(count))} 位学员各一段串成一条时间线`;
}

/** 名单之外（但本期有记录）的学员说明 —— 他们照样各占一段。 */
export function videoClassExtraNote(count) {
  const total = Math.max(0, int(count));
  if (!total) return '分段覆盖班级名单上的每一位学员：名单里有谁，时间线上就有谁的一段。';
  return `另有 ${total} 位本期有记录、但不在班级名单里的学员：排在名单之后照样各占一段，不静默丢掉他们的作品。`;
}

/** 顺序调整的两个动作（界面用它，断言读它）。 */
export const VIDEO_CLASS_MOVE_UP_LABEL = '上移';
export const VIDEO_CLASS_MOVE_DOWN_LABEL = '下移';
export const VIDEO_CLASS_ORDER_RESET_LABEL = '恢复班级名单顺序';
export const VIDEO_CLASS_ORDER_RESET_DONE = '已恢复为班级名单顺序。';

// ---------------------------------------------------------------------------
// ④ 时长上限（本故事第 4 条验收：全班串成一条，总时长不超过 5 分钟）
// ---------------------------------------------------------------------------

/** 班级集锦的上限 = 班级成片的上限（300 秒 / 5 分钟）—— 与 US-216 读的是同一个数字。 */
export const VIDEO_CLASS_CAP_SEC = VIDEO_DURATION_CAP_SEC.class;

/** 被时长上限挡下的作品说明。 */
export function videoClassDroppedNote(dropped, total) {
  const kept = Math.max(0, int(total) - Math.max(0, int(dropped)));
  return `本周期共 ${Math.max(0, int(total))} 幅不取舍时超过 5 分钟：已按「每位学员至少 1 幅 + 按作品数比例」精选到 ${kept} 幅，被挡下的 ${Math.max(0, int(dropped))} 幅不进这一版。`;
}

/**
 * 保底本身就已经超过上限时的那句实话（与 US-216 的 `VIDEO_SELECTION_OVER_CAP_NOTE` 同一口径）：
 * 不许悄悄丢掉某位学员的作品来凑上限 —— 保底优先，并且如实说清。
 */
export const VIDEO_CLASS_OVER_CAP_NOTE = '每位学员至少 1 幅（保底）加上姓名卡已经超过 5 分钟：保底优先于上限，这一版会如实超出，不靠少收某位学员来凑时长。';

// ---------------------------------------------------------------------------
// ⑤ 分段读数与复核判据（本故事第 5 条验收：姓名卡与作品不串档）
// ---------------------------------------------------------------------------

/** 一段里会带素材的三种帧（要判定「这一帧属于谁」的帧）。 */
const SEGMENT_SOURCED_KINDS = [VIDEO_FRAME_KINDS.artwork, VIDEO_FRAME_KINDS.photo, VIDEO_FRAME_KINDS.blank];

/**
 * 把一条时间线按**段**归拢（纯函数、永不抛错）：读帧上的 `segmentIndex`（`-1` = 不属于任何一段）。
 * 每一段给出姓名卡、声明幅数、真实作品帧数、照片帧数、课次日期、留白卡、起止与判据。
 * 界面渲染的分段清单与 `videoClassCrossTalkIssue` 读的是同一份产物。
 */
export function videoClassSegments(plan) {
  const frames = (Array.isArray(plan) ? plan : (plan && Array.isArray(plan.frames) ? plan.frames : [])).map(normalizeVideoFrame);
  const table = new Map();
  frames.forEach(frame => {
    if (frame.segmentIndex < 0) return;
    if (!table.has(frame.segmentIndex)) {
      table.set(frame.segmentIndex, { index: frame.segmentIndex, student: '', declaredCount: 0, nameCard: null, blank: null, frames: [] });
    }
    const row = table.get(frame.segmentIndex);
    row.frames.push(frame);
    if (frame.kind === VIDEO_FRAME_KINDS.nameCard) {
      row.nameCard = frame;
      row.declaredCount = frame.declaredArtworkCount;
      if (str(frame.sourceStudent)) row.student = str(frame.sourceStudent);
    } else {
      if (!row.student && str(frame.sourceStudent)) row.student = str(frame.sourceStudent);
      if (frame.kind === VIDEO_FRAME_KINDS.blank) row.blank = frame;
    }
  });
  return Array.from(table.values())
    .sort((left, right) => left.index - right.index)
    .map(row => {
      const artworks = row.frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.artwork);
      const photos = row.frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.photo);
      const dates = artworks.map(frame => frame.date).filter(Boolean).sort();
      const first = row.frames[0] || null;
      const last = row.frames[row.frames.length - 1] || null;
      const studentLabel = row.student || VIDEO_SELECTION_UNNAMED_STUDENT;
      const cardIssue = row.nameCard
        ? videoClassNameCardIssue(row.student, row.declaredCount)
        : '姓名卡缺失：每一位学员的一段都要从一张姓名卡开始。';
      const blankIssue = row.blank ? videoClassBlankCardIssue(row.blank.titleText) : '';
      const foreignNames = dedupe(row.frames
        .filter(frame => SEGMENT_SOURCED_KINDS.includes(frame.kind))
        .map(frame => str(frame.sourceStudent))
        .filter(name => name !== row.student));
      return {
        index: row.index,
        orderLabel: `第 ${row.index + 1} 段`,
        student: row.student,
        studentLabel,
        nameCard: row.nameCard,
        nameCardText: row.nameCard ? row.nameCard.titleText : '',
        declaredCount: Math.max(0, int(row.declaredCount)),
        artworkCount: artworks.length,
        photoCount: photos.length,
        isEmpty: artworks.length === 0,
        blank: row.blank,
        blankText: row.blank ? row.blank.titleText : '',
        blankNote: row.blank ? row.blank.assetNote : '',
        blankIssue,
        dates,
        dateText: dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : '',
        frameCount: row.frames.length,
        startSec: first ? first.startSec : 0,
        endSec: last ? last.endSec : 0,
        durationSec: first && last ? round1(last.endSec - first.startSec) : 0,
        cardIssue,
        foreignNames,
        withinCap: cardIssue === '' && blankIssue === ''
      };
    });
}

/**
 * 「姓名卡与作品不串档」的复核判据（空串 = 合规）：逐段读**产物**，四件事各点一次名 ——
 *  ① 姓名卡上必须写着姓名与作品数（`videoClassNameCardIssue`）；
 *  ② 姓名卡上写的幅数 = 这一段里真实的作品帧数（对不上就是串档）；
 *  ③ 本期没有作品的段必须有留白卡；有作品的段不许有留白卡（留白卡只给没有作品的学员）；
 *  ④ 段里任何一帧的 `sourceStudent` 都必须等于段首姓名卡的学员（混进别人的素材就点名）。
 */
export function videoClassCrossTalkIssue(plan) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const rows = videoClassSegments(source);
  for (const row of rows) {
    if (row.cardIssue) return `${row.orderLabel}（${row.studentLabel}）：${row.cardIssue}`;
    if (row.blankIssue) return `${row.orderLabel}（${row.studentLabel}）：${row.blankIssue}`;
    if (row.declaredCount !== row.artworkCount) {
      return `${row.orderLabel}（${row.studentLabel}）的姓名卡上写着 ${row.declaredCount} 幅，这一段里却有 ${row.artworkCount} 幅作品帧：姓名卡与作品必须对得上账。`;
    }
    if (row.isEmpty && !row.blank) {
      return `${row.orderLabel}（${row.studentLabel}）本期没有作品，却没有留白卡：这一段不能跳过。`;
    }
    if (!row.isEmpty && row.blank) {
      return `${row.orderLabel}（${row.studentLabel}）有作品却还带一张留白卡：留白卡只给本期没有作品的学员。`;
    }
    if (row.foreignNames.length) {
      return `${row.orderLabel}（${row.studentLabel}）里混进了别的学员的素材（${row.foreignNames.slice(0, 3).join('、')}）：姓名卡与作品不串档。`;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// ⑥ 成片信息（时长 / 收录幅数 / 分辨率 / 文件大小；推算值带「预估」）
// ---------------------------------------------------------------------------

/** 成片信息的四项（顺序真源；`estimate: true` 的两项是推算值 —— 与个人视频同一套字段）。 */
export const VIDEO_CLASS_INFO_FIELDS = [
  {
    id: 'duration',
    label: '时长',
    estimate: true,
    hint: '按帧序规则推算：片头 + 每段姓名卡 + 每一幅作品帧 + 留白卡 + 片尾，扣除相邻帧的交叉淡入重叠。'
  },
  {
    id: 'artworks',
    label: '收录幅数',
    estimate: false,
    hint: '这条时间线里全班的作品帧数（不含课堂照片帧、姓名卡与留白卡）。'
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
    hint: `按 1080p 竖屏含 BGM 与字幕的码率区间推算（每分钟 ${4}–${8} MB）。`
  }
];

/** 成片信息的行 id（断言用：四项缺一不可）。 */
export const VIDEO_CLASS_INFO_IDS = VIDEO_CLASS_INFO_FIELDS.map(field => field.id);

/** 成片信息那一句「哪些是推算值」（面板底部常驻说明）。 */
export const VIDEO_CLASS_ESTIMATE_NOTE = '带「预估」的两项是推算值：成片的真实时长与文件大小要等渲染服务出片之后才有，这里不编实际读数。';

/**
 * 成片信息四行：时长（预估）/ 收录幅数 / 分辨率 / 文件大小（预估）。
 * 推算值的文案在这里拼好（带「预估」两个字）—— 界面只渲染，组件不许自己写「预估」。
 */
export function videoClassInfoRows({ durationSec = 0, artworks = 0 } = {}) {
  const duration = Math.max(0, round1(durationSec));
  const size = videoPersonalSizeEstimate(duration);
  const values = {
    duration: `${VIDEO_PERSONAL_ESTIMATED_WORD} ${videoTimelineDurationText(duration)}`,
    artworks: `${Math.max(0, int(artworks))} 幅`,
    resolution: VIDEO_PERSONAL_RESOLUTION_TEXT,
    size: size.text
  };
  return VIDEO_CLASS_INFO_FIELDS.map(field => ({
    id: field.id,
    label: field.label,
    value: values[field.id],
    estimated: field.estimate === true,
    estimateText: field.estimate === true ? VIDEO_PERSONAL_ESTIMATED_WORD : '',
    hint: field.hint
  }));
}

// ---------------------------------------------------------------------------
// ⑦ 编排（纯函数；界面只渲染它的产物）
// ---------------------------------------------------------------------------

/** 按课次时间线排序（日期升序，同日保持原顺序 —— 与 US-215/216/217 同一口径）。 */
function orderByTimeline(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, order) => ({ entry, order }))
    .sort((left, right) => str(left.entry && left.entry.date).localeCompare(str(right.entry && right.entry.date)) || left.order - right.order)
    .map(item => item.entry);
}

/**
 * 一条时间线（分段草稿）：位学员一段 —— 段首姓名卡 + 段内帧（作品 / 照片），没有作品就是留白卡。
 * `size` 是这一版收录的**作品总名额**（按 `videoSelectionAllocateGroups` 分到每位学员头上）。
 */
function composeClassPlan({ kind, className, period, orgName, endingNote, shareReady, segments, size }) {
  const allocation = new Map(videoSelectionAllocateGroups(
    segments.map((group, order) => ({ key: group.name, name: group.name, count: group.count, order })),
    size
  ).map(row => [row.key, row.quota]));
  const introLine = videoClassIntroLine(className, period);
  const frames = [];
  let cursor = 0;
  const push = (frameKind, fields = {}) => {
    // 起止只在 `videoFrameSpan` 里算一次（帧时长表与重叠量的唯一真源）。
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
  // 片头：机构 Logo + 班级名 + 周期 + 标题「成长记录」。
  push(VIDEO_FRAME_KINDS.intro, {
    objectName: className,
    title: introLine,
    titleText: introLine,
    lines: [
      `机构 Logo：${orgName || '机构名未记录'}`,
      `班级：${str(className) || VIDEO_CLASS_UNNAMED_TEXT}`,
      `周期：${str(period) || VIDEO_CLASS_NO_PERIOD_TEXT}`,
      `标题：${VIDEO_INTRO_TITLE}`
    ]
  });
  segments.forEach((group, segmentIndex) => {
    const quota = Math.min(group.count, Math.max(0, int(allocation.get(group.name))));
    // 段内按课次时间线：先按名额在自己的时间线上均匀取样（首末两幅必留），再走帧序规则。
    const selected = quota >= group.entries.length
      ? group.entries.map(item => item.entry)
      : videoSelectionSampleIndices(group.entries.length, quota).map(index => group.entries[index].entry);
    const base = selected.length
      ? videoTimelinePlan({ entries: selected, objectName: group.name, type: kind, period, orgName, endingNote, shareReady })
      : null;
    // 只取自己这一段的帧（片头与片尾由这一条总时间线自己出，不让每段各带一份）。
    const segmentFrames = base
      ? base.frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.artwork || frame.kind === VIDEO_FRAME_KINDS.photo)
      : [];
    const artworks = segmentFrames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.artwork);
    const dates = artworks.map(frame => frame.date).filter(Boolean).sort();
    const periodCount = Math.max(0, int(group.periodCount));
    const cardLines = [
      `学员：${group.name}`,
      `作品数：${artworks.length} 幅`,
      dates.length ? `课次：${dates[0]} – ${dates[dates.length - 1]}` : '课次：本期没有课次'
    ];
    // 本期比这一段多出来的幅数如实写在卡上（收录清单与时长上限各挡下一部分）。
    if (periodCount > artworks.length) {
      cardLines.push(`本期共 ${periodCount} 幅：收录清单与时长上限之后，这一段排进 ${artworks.length} 幅。`);
    }
    // 段首姓名卡：姓名与作品数（`videoClassNameCardTitle` 是唯一拼装点）。
    push(VIDEO_FRAME_KINDS.nameCard, {
      objectName: className,
      title: videoClassNameCardTitle(group.name, artworks.length),
      titleText: videoClassNameCardTitle(group.name, artworks.length),
      lines: cardLines,
      sourceStudent: group.name,
      segmentIndex,
      declaredArtworkCount: artworks.length
    });
    segmentFrames.forEach(frame => {
      push(frame.kind, {
        objectName: className,
        entryId: frame.entryId,
        date: frame.date,
        title: frame.title,
        titleText: frame.titleText,
        subtitle: frame.subtitle,
        subtitleSource: frame.subtitleSource,
        subtitleTruncated: frame.subtitleTruncated,
        lines: frame.lines,
        endingNote: frame.endingNote,
        asset: frame.asset,
        assetNote: frame.assetNote,
        // 段内每一帧都带来源学员（按判据对账用）与段号。
        sourceStudent: str(frame.sourceStudent) || group.name,
        segmentIndex
      });
    });
    // 本期一件作品都没有：留白卡而不是跳过整段（说明写在卡片**旁边**的旁注里）。
    if (!artworks.length) {
      push(VIDEO_FRAME_KINDS.blank, {
        objectName: className,
        title: VIDEO_CLASS_BLANK_TEXT,
        titleText: VIDEO_CLASS_BLANK_TEXT,
        assetNote: videoClassBlankNote(group.name),
        sourceStudent: group.name,
        segmentIndex
      });
    }
  });
  // 片尾：老师寄语（≤40 字）+ 机构名 + 分享二维码。
  push(VIDEO_FRAME_KINDS.ending, {
    objectName: className,
    endingNote: str(endingNote),
    title: '片尾',
    lines: [
      `老师寄语：${str(endingNote) || '未填写（成片片尾不显示寄语）'}`,
      `机构名：${orgName || '机构名未记录'}`,
      `分享二维码：${shareReady ? '已具备（家长分享链接可用）' : '尚未生成分享链接'}`
    ]
  });
  return { frames, totalSec: round1(frames.length ? frames[frames.length - 1].endSec : 0) };
}

/**
 * 班级视频集锦（纯函数、永不抛错）：全班按学员分段串成一条时间线。
 *
 * 入参：
 *  - `entries`：当前**班级 + 生成周期**下的归档条目（**可以带缺课记录** —— 缺课没有作品帧，
 *    这位学员的段自然走留白卡那一支）；缺课条数如实报在 `counts.absence` 里；
 *  - `className` / `period` / `orgName` / `endingNote` / `shareReady`：片头与片尾的字段（与 US-215 同一口径）；
 *  - `roster`：班级名单（**顺序真源**：默认顺序就是它）；`order`：老师调整后的顺序（只重排名单上的名字）；
 *  - `selectedKeys`：可选的「收录清单」（US-216 的作品键）—— 传了就只排这些作品；
 *  - `capSec`：上限覆盖（只在断言里用，界面不传）。
 *
 * 返回（**所有状态同形状**）：`frames`（片头 → 每位学员一段 → 片尾）、`segments`、`counts`、
 * `totalSec` / `capSec` / `withinCap` / `overCap`、`droppedEntries`、`extraStudents`、`infoRows` 等。
 */
export function videoClassPlan({
  entries = [],
  className = '',
  roster = [],
  order = null,
  period = '',
  orgName = '',
  endingNote = '',
  shareReady = false,
  selectedKeys = null,
  capSec = null,
  type = 'class'
} = {}) {
  const kind = normalizeVideoJobType(type);
  const name = str(className);
  const periodText = str(period);
  const org = str(orgName);
  const note = str(endingNote);
  const cap = videoDurationCapSec('class', capSec ? { class: capSec } : null);
  const timeline = orderByTimeline(entries);
  // 缺课记录**不是一幅作品**：不进分段计数（这位学员的段按「本期无作品」走留白卡那一支）。
  const lessons = timeline.filter(entry => !(entry && entry.isAbsence));
  const absenceEntries = timeline.filter(entry => entry && entry.isAbsence);
  const keySet = selectedKeys === null || selectedKeys === undefined
    ? null
    : new Set((Array.isArray(selectedKeys) ? selectedKeys : []).map(value => str(value)).filter(Boolean));
  const candidates = keySet ? lessons.filter(entry => keySet.has(videoSelectionEntryKey(entry))) : lessons;
  const groups = videoSelectionStudentGroups(candidates);
  // 分段顺序：班级名单（`roster`）在前，名单之外但**本期有记录**的学员按时间线首次出现的顺序接在后面。
  // 这里故意用**未经收录清单过滤**的名单：某位学员的作品被精选挡光之后，他仍然占一段（留白卡），
  // 而不是从时间线上凭空消失。
  const periodGroups = videoSelectionStudentGroups(lessons);
  const periodCountByName = new Map(periodGroups.map(group => [group.name, group.count]));
  const rosterNames = dedupe(roster);
  const timelineNames = periodGroups.map(group => group.name);
  const baseNames = [...rosterNames, ...timelineNames.filter(studentName => !rosterNames.includes(studentName))];
  const orderNames = dedupe(order);
  const studentNames = orderNames.length
    ? [...orderNames.filter(studentName => baseNames.includes(studentName)), ...baseNames.filter(studentName => !orderNames.includes(studentName))]
    : baseNames;
  const groupByName = new Map(groups.map(group => [group.name, group]));
  const segments = studentNames.map(studentName => {
    const candidateGroup = groupByName.get(studentName) || { key: studentName, name: studentName, order: 0, count: 0, entries: [] };
    // `count` 是**候选**（收录清单里的）份数 —— 名额按它分配；`periodCount` 是这一位本期一共几幅。
    return {
      ...candidateGroup,
      periodCount: Math.max(candidateGroup.count, Math.max(0, int(periodCountByName.get(studentName))))
    };
  });
  const withArtworks = segments.filter(group => group.count > 0);
  // 保底份数：每位有作品的学员至少 1 幅（名额不够时按时间线均匀挑学员，与 US-216 同一口径）。
  const floorSize = Math.min(candidates.length, withArtworks.length);
  const compose = size => composeClassPlan({ kind, className: name, period: periodText, orgName: org, endingNote: note, shareReady, segments, size });
  let size = candidates.length;
  let composed = compose(size);
  const fullSec = composed.totalSec;
  if (candidates.length && fullSec > cap) {
    size = floorSize;
    composed = compose(size);
    // 从「全收」往下找**最大的**放得下的名额（照片槽有台阶，时长对名额不是严格单调，所以逐个试）。
    for (let probe = candidates.length - 1; probe >= floorSize; probe -= 1) {
      const attempt = compose(probe);
      if (attempt.totalSec <= cap) { size = probe; composed = attempt; break; }
    }
  }
  const keptKeys = new Set(composed.frames.filter(frame => frame.entryId).map(frame => frame.entryId));
  const droppedEntries = candidates.filter(entry => !keptKeys.has(videoSelectionEntryKey(entry)));
  const segmentsView = videoClassSegments(composed.frames);
  const keptByStudent = new Map(segmentsView.map(row => [row.student, row.artworkCount]));
  const extraStudents = timelineNames.filter(studentName => !rosterNames.includes(studentName));
  const plan = {
    type: kind,
    typeLabel: videoJobTypeLabel(kind),
    objectName: name,
    className: name,
    period: periodText,
    orgName: org,
    endingNote: note,
    shareReady: shareReady === true,
    introLine: videoClassIntroLine(name, periodText),
    roster: rosterNames,
    order: segmentsView.map(row => row.student),
    frames: composed.frames,
    segments: segmentsView,
    counts: {
      frames: composed.frames.length,
      segments: segmentsView.length,
      intro: composed.frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.intro).length,
      ending: composed.frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.ending).length,
      nameCards: composed.frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.nameCard).length,
      artworks: composed.frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.artwork).length,
      photos: composed.frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.photo).length,
      blanks: composed.frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.blank).length,
      emptySegments: segmentsView.filter(row => row.isEmpty).length,
      lessons: lessons.length,
      candidates: candidates.length,
      externalLessons: Math.max(0, lessons.length - candidates.length),
      dropped: droppedEntries.length,
      absence: absenceEntries.length,
      extras: extraStudents.length,
      transitions: Math.max(0, composed.frames.length - 1)
    },
    capSec: cap,
    capText: videoSelectionCapText('class'),
    totalSec: composed.totalSec,
    fullSec,
    withinCap: composed.totalSec <= cap,
    overCap: composed.totalSec > cap,
    capExceeded: fullSec > cap,
    sampled: droppedEntries.length > 0,
    // 每位学员的分配读数（本期共几幅 / 这一段收录几幅）—— 界面据此说明「为什么比全量少了几幅」。
    studentRows: segments.map(group => {
      const kept = Math.max(0, int(keptByStudent.get(group.name)));
      const periodCount = Math.max(0, int(group.periodCount));
      return {
        name: group.name,
        count: periodCount,
        kept,
        isEmpty: kept === 0,
        note: periodCount ? `本期共 ${periodCount} 幅 · 这一段收录 ${kept} 幅` : '本期没有作品 · 保留留白卡'
      };
    }),
    extraStudents: extraStudents.map(studentName => ({
      name: studentName,
      count: Math.max(0, int((groupByName.get(studentName) || {}).periodCount)) || Math.max(0, int(periodCountByName.get(studentName))),
      kept: Math.max(0, int(keptByStudent.get(studentName)))
    })),
    droppedEntries: droppedEntries.map(entry => ({
      id: videoSelectionEntryKey(entry),
      date: str(entry && entry.date),
      student: str(entry && entry.student) || VIDEO_SELECTION_UNNAMED_STUDENT,
      title: str(entry && entry.title) || '作品名未记录'
    })),
    absenceEntries: absenceEntries.map(entry => ({
      id: videoSelectionEntryKey(entry),
      date: str(entry && entry.date),
      student: str(entry && entry.student) || VIDEO_SELECTION_UNNAMED_STUDENT,
      title: str(entry && entry.title) || '缺课记录'
    })),
    infoRows: videoClassInfoRows({ durationSec: composed.totalSec, artworks: composed.frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.artwork).length })
  };
  return {
    ...plan,
    crossTalkIssue: videoClassCrossTalkIssue(plan),
    contentIssue: videoTimelineContentIssue(plan)
  };
}

// ---------------------------------------------------------------------------
// ⑧ 规则读数与视图产物（界面只渲染它们）
// ---------------------------------------------------------------------------

/** 班级集锦编排的规则读数（五条；界面渲染它、断言读它 —— 数字只在常量里写一次）。 */
export function videoClassRuleRows() {
  return [
    {
      id: 'segments',
      label: '按学员分段',
      value: `每位学员一段 · 段首 ${VIDEO_CLASS_NAME_CARD_DURATION_SEC} 秒姓名卡`,
      detail: '全班按学员分段串成一条：段首一张姓名卡（姓名 + 作品数），段内按课次时间线排。'
    },
    {
      id: 'order',
      label: '学员顺序',
      value: '默认按班级名单 · 生成前可调整',
      detail: '名单之外但本期有记录的学员接在名单之后，照样各占一段。'
    },
    {
      id: 'blank',
      label: '本期无作品',
      value: `保留 ${VIDEO_CLASS_BLANK_DURATION_SEC} 秒留白卡 · 文案 ≤${VIDEO_CLASS_BLANK_TEXT_MAX_CHARS} 字`,
      detail: '这一位本期一件作品都没有：段首姓名卡（0 幅作品）之后补一张留白卡，不跳过整段。'
    },
    {
      id: 'artwork',
      label: '段内帧序',
      value: `每幅 ${VIDEO_FRAME_DURATION_SEC.artwork} 秒 · 课堂照片 ${VIDEO_FRAME_DURATION_SEC.photo} 秒`,
      detail: '与上面帧清单同一套帧序规则：按课次日期升序、等比缩放留边、每 4 幅作品后插 1 张课堂照片。'
    },
    {
      id: 'cap',
      label: '总时长',
      value: `不超过 ${VIDEO_CLASS_CAP_SEC} 秒（5 分钟）`,
      detail: '超上限时按「每位学员至少 1 幅 + 按作品数比例」精选，保底优先于上限并如实报出。'
    }
  ];
}

/** 规则的行 id（断言用：五条缺一不可）。 */
export const VIDEO_CLASS_RULE_IDS = videoClassRuleRows().map(row => row.id);

/** 一帧渲染成的一行（作品帧沿用 US-215 的行产物，姓名卡与留白卡另给卡片文案与来源说明）。 */
export function videoClassFrameRow(frame) {
  const item = normalizeVideoFrame(frame);
  const row = videoFrameRow(item);
  const isNameCard = item.kind === VIDEO_FRAME_KINDS.nameCard;
  const isBlank = item.kind === VIDEO_FRAME_KINDS.blank;
  return {
    ...row,
    segmentIndex: item.segmentIndex,
    sourceStudent: item.sourceStudent,
    isNameCard,
    isBlank,
    declaredArtworkCount: item.declaredArtworkCount,
    cardText: isNameCard || isBlank ? item.titleText : '',
    cardNote: isBlank ? item.assetNote : (isNameCard ? VIDEO_CLASS_NAME_CARD_NOTE : ''),
    cardDurationText: isNameCard || isBlank ? `${VIDEO_FRAME_DURATION_SEC[item.kind]} 秒卡片` : '',
    cardIssue: isNameCard
      ? videoClassNameCardIssue(item.sourceStudent, item.declaredArtworkCount)
      : (isBlank ? videoClassBlankCardIssue(item.titleText) : '')
  };
}

/**
 * 时间线的视图产物（**所有状态返回同一组字段**）：规则五条 + 分段清单 + 帧行 + 汇总 + 成片信息 +
 * 顺序读数 + 不串档判据。界面渲染的每一行都在这里，组件不自己算时长、也不自己拼「预估」。
 */
export function videoClassView(plan) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const frames = (Array.isArray(source.frames) ? source.frames : []).map(videoClassFrameRow);
  const segmentsRaw = videoClassSegments(source);
  const counts = source.counts && typeof source.counts === 'object'
    ? source.counts
    : { frames: frames.length, segments: segmentsRaw.length, intro: 0, ending: 0, nameCards: 0, artworks: 0, photos: 0, blanks: 0, emptySegments: 0, lessons: 0, candidates: 0, externalLessons: 0, dropped: 0, absence: 0, extras: 0, transitions: 0 };
  const totalSec = Math.max(0, round1(source.totalSec));
  const capSec = num(source.capSec) || VIDEO_CLASS_CAP_SEC;
  const withinCap = totalSec <= capSec;
  const artworkCount = frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.artwork).length;
  const photoCount = frames.filter(frame => frame.kind === VIDEO_FRAME_KINDS.photo).length;
  const nameCards = frames.filter(frame => frame.isNameCard);
  const blanks = frames.filter(frame => frame.isBlank);
  const segmentRows = (segmentsRaw.length ? segmentsRaw : []).map((row, position) => ({
    index: row.index,
    position: position + 1,
    positionLabel: `第 ${position + 1} 段`,
    student: row.student,
    studentLabel: row.studentLabel,
    nameCardText: row.nameCardText,
    declaredCount: row.declaredCount,
    artworkCount: row.artworkCount,
    photoCount: row.photoCount,
    isEmpty: row.isEmpty,
    blankText: row.blankText,
    blankNote: row.blankNote,
    dates: row.dates,
    dateText: row.dateText,
    startSec: row.startSec,
    endSec: row.endSec,
    startText: videoTimelineTimecode(row.startSec),
    endText: videoTimelineTimecode(row.endSec),
    timeText: `${videoTimelineTimecode(row.startSec)} – ${videoTimelineTimecode(row.endSec)}`,
    durationSec: row.durationSec,
    durationText: `${row.durationSec} 秒`,
    cardIssue: row.cardIssue,
    foreignNames: row.foreignNames,
    canUp: position > 0,
    canDown: position < segmentsRaw.length - 1
  }));
  const defaultOrder = [
    ...(Array.isArray(source.roster) ? source.roster.map(str) : []),
    ...(Array.isArray(source.extraStudents) ? source.extraStudents.map(entry => str(entry && entry.name)) : [])
  ].filter(Boolean);
  const currentOrder = segmentsRaw.map(row => row.student).filter(Boolean);
  const infoRows = Array.isArray(source.infoRows) && source.infoRows.length
    ? source.infoRows
    : videoClassInfoRows({ durationSec: totalSec, artworks: artworkCount });
  const studentRows = (Array.isArray(source.studentRows) ? source.studentRows : []).map(row => ({
    name: str(row && row.name) || VIDEO_SELECTION_UNNAMED_STUDENT,
    count: Math.max(0, int(row && row.count)),
    kept: Math.max(0, int(row && row.kept)),
    isEmpty: row && row.isEmpty === true,
    note: str(row && row.note)
  }));
  const extraStudents = (Array.isArray(source.extraStudents) ? source.extraStudents : []).map(entry => ({
    name: str(entry && entry.name) || VIDEO_SELECTION_UNNAMED_STUDENT,
    count: Math.max(0, int(entry && entry.count)),
    kept: Math.max(0, int(entry && entry.kept))
  }));
  const droppedEntries = (Array.isArray(source.droppedEntries) ? source.droppedEntries : []).map(entry => ({
    id: str(entry && entry.id),
    date: str(entry && entry.date),
    student: str(entry && entry.student) || VIDEO_SELECTION_UNNAMED_STUDENT,
    title: str(entry && entry.title) || '作品名未记录'
  }));
  const crossTalkIssue = str(source.crossTalkIssue) || videoClassCrossTalkIssue(source);
  const contentIssue = str(source.contentIssue) || videoTimelineContentIssue(source);
  const unknownIssues = [
    ...segmentRows.map(row => row.cardIssue).filter(Boolean),
    ...blanks.map(frame => frame.cardIssue).filter(Boolean)
  ];
  const empty = segmentsRaw.length === 0;
  const summary = empty
    ? VIDEO_CLASS_EMPTY_TEXT
    : `全班 ${segmentsRaw.length} 位学员各一段串成一条：姓名卡 ${nameCards.length} 张（每张 ${VIDEO_CLASS_NAME_CARD_DURATION_SEC} 秒）· 作品 ${artworkCount} 帧 · 课堂照片 ${photoCount} 帧 · 留白卡 ${blanks.length} 张（每张 ${VIDEO_CLASS_BLANK_DURATION_SEC} 秒）· 片尾 ${counts.ending} 帧；总时长按帧序规则推算 ${videoTimelineDurationText(totalSec)}（${videoSelectionCapText('class')}）。`;
  const notes = [];
  notes.push(videoClassExtraNote(extraStudents.length));
  if (droppedEntries.length) notes.push(videoClassDroppedNote(droppedEntries.length, Math.max(0, int(counts.candidates))));
  if (Math.max(0, int(counts.externalLessons))) notes.push(`其中 ${Math.max(0, int(counts.externalLessons))} 幅在精选（时长上限或老师手动排除）时没有进收录清单：它们不排进这条时间线。`);
  if (blanks.length) notes.push(`${blanks.length} 位学员本期没有作品：段首姓名卡之后保留 ${VIDEO_CLASS_BLANK_DURATION_SEC} 秒留白卡，整段不跳过。`);
  if (Math.max(0, int(counts.absence))) notes.push(`另有 ${Math.max(0, int(counts.absence))} 条缺课记录：它们本来就没有作品帧，这一位按「本期没有作品」处理。`);
  if (!withinCap) notes.push(VIDEO_CLASS_OVER_CAP_NOTE);
  return {
    type: str(source.type),
    typeLabel: str(source.typeLabel),
    objectName: str(source.objectName),
    className: str(source.className) || str(source.objectName),
    period: str(source.period),
    introLine: str(source.introLine) || videoClassIntroLine(source.objectName, source.period),
    introTitle: VIDEO_INTRO_TITLE,
    frames,
    segments: segmentRows,
    rules: videoClassRuleRows(),
    infoRows,
    counts,
    frameCount: frames.length,
    segmentCount: segmentsRaw.length,
    artworkCount,
    photoCount,
    nameCardCount: nameCards.length,
    blankCount: blanks.length,
    emptySegmentCount: segmentsRaw.filter(row => row.isEmpty).length,
    totalSec,
    totalText: videoTimelineDurationText(totalSec),
    capSec,
    capText: videoSelectionCapText('class'),
    withinCap,
    overCap: !withinCap,
    capExceeded: source.capExceeded === true,
    sampled: source.sampled === true,
    orderText: videoClassOrderText(segmentsRaw.length),
    orderNote: videoClassOrderNote(defaultOrder.length || segmentsRaw.length),
    externalLessons: Math.max(0, int(counts.externalLessons)),
    externalNote: Math.max(0, int(counts.externalLessons))
      ? `其中 ${Math.max(0, int(counts.externalLessons))} 幅在精选（时长上限或老师手动排除）时没有进收录清单：它们不排进这条时间线。`
      : '',
    defaultOrder,
    currentOrder,
    orderChanged: currentOrder.join('|') !== defaultOrder.join('|'),
    studentRows,
    extraStudents,
    extraNote: videoClassExtraNote(extraStudents.length),
    droppedEntries,
    droppedNote: droppedEntries.length ? videoClassDroppedNote(droppedEntries.length, Math.max(0, int(counts.candidates)) + droppedEntries.length) : '',
    blankNote: blanks.length ? blanks[0].cardNote : '',
    summary,
    notes,
    empty,
    emptyText: VIDEO_CLASS_EMPTY_TEXT,
    crossTalkIssue,
    crossTalkOk: !crossTalkIssue,
    crossTalkNote: VIDEO_CLASS_CROSSTALK_NOTE,
    contentIssue,
    clean: !contentIssue && !crossTalkIssue && !unknownIssues.length,
    cardIssue: unknownIssues[0] || '',
    nameCardDurationSec: VIDEO_CLASS_NAME_CARD_DURATION_SEC,
    blankDurationSec: VIDEO_CLASS_BLANK_DURATION_SEC,
    blankTextMaxChars: VIDEO_CLASS_BLANK_TEXT_MAX_CHARS,
    estimateNote: VIDEO_CLASS_ESTIMATE_NOTE,
    noOutputNote: VIDEO_CLASS_NO_OUTPUT_NOTE,
    demoLabel: VIDEO_CLASS_DEMO_LABEL,
    // 「不产出 mp4」是结构性的：这一份产物里没有成片地址 / 封面 / 下载地址键（禁字段键名兜底）。
    hasOutput: false,
    outputLabel: '',
    endingNote: str(source.endingNote),
    shareReady: source.shareReady === true,
    timecode: videoTimelineTimecode(totalSec)
  };
}

/** 分段数（空态判据：一段都没有 = 这个班级在这个周期没有记录）。 */
function frameCountOf(rows) {
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * 顺序调整（纯函数）：把 `order` 里第 `index` 位与相邻的一位换位。
 * `direction` 为 `-1` 上移、`1` 下移；越界原样返回（界面据此把按钮置灰）。
 */
export function videoClassMoveOrder(order, index, direction) {
  const list = dedupe(order);
  const from = int(index);
  const step = int(direction) < 0 ? -1 : 1;
  const to = from + step;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
