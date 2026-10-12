// 成片**时长上限与自动精选**的唯一真源（[第四步 US-216] / tasks/prd-archive-share.md 的 US-216）。
//
// 视频服务还没接进来，但「这条片子放不下这么多作品、到底哪些会被舍弃」不能等到出片才知道：
// 这一份模块把**时长上限**、**超出上限时的均匀取样**与**班级配额分配**全部定死成零依赖纯函数 +
// 常量（只 import 同样零依赖的 `videoJobs.js` 与 `videoTimeline.js`），可直接用 Node 直跑断言；
// 界面只渲染它的产物。四件事：
//
//  ① **时长上限**（`VIDEO_DURATION_CAP_SEC`）：个人成片 ≤120 秒、班级成片 ≤300 秒。
//     预估时长**不另算一套**：它用 `videoTimelinePlan`（US-215 的帧序规则）对**入选的那一批**推出来
//     （`videoSelectionDurationSec`）—— 于是「精选清单上的预估时长」与「帧清单上的总时长」必然对得上，
//     改帧时长只需要改 `videoTimeline.js` 那一份常量。
//
//  ② **超出上限时按课次时间线均匀取样，首末两幅必留**（`videoSelectionSampleIndices`）：
//     在按课次日期 + 课时序号升序的作品列表上等距取 k 个位置，第一个与最后一个永远在里面 ——
//     「整段课次跨度」因此不会被丢掉，视频里仍然看得见从第一幅到最后一幅的推进。
//
//  ③ **班级先保证每位学员至少 1 幅，再按作品数比例分配剩余配额**
//     （`videoSelectionAllocateGroups`，最大余数法）：名额不够让每位学员都上时，
//     按时间线顺序均匀挑学员（不整段丢掉后面的孩子）；某位学员的作品先分完，余量让给别人。
//
//  ④ **老师手动排除**：被点名的作品进 `excluded`，从候选里去掉后**整条链重算**
//     （收录清单与预估时长实时跟着变），不是「把界面上这一行删掉」。
//
// 与 `data/videoTimeline.js` 同一套纪律：视图函数**所有状态返回同形状字段**（US-204 的白屏坑），
// 判据与文案只在数据层写一次，组件不自己拼字符串、也不自己算时长。

import { normalizeVideoJobType, videoJobTypeLabel } from './videoJobs';
import { orderVideoTimelineEntries, videoTimelineDurationText, videoTimelinePlan } from './videoTimeline';

const str = value => String(value ?? '').trim();
const num = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const int = value => Math.trunc(num(value));

// ---------------------------------------------------------------------------
// ⓪ 文案（区块名 / 规则 / 三种状态的原因 —— 界面与断言读同一份）
// ---------------------------------------------------------------------------

/** 区块名（界面渲染它，组件不另起名字）。 */
export const VIDEO_SELECTION_SECTION_TITLE = '时长上限与自动精选';
export const VIDEO_SELECTION_SECTION_DESC = '成片有目标时长：个人不超过 2 分钟、班级不超过 5 分钟。超出上限时按课次时间线均匀取样（首末两幅必留）；班级先保证每位学员至少 1 幅，再按作品数比例分配剩余名额。老师也可以手动排除某一幅，收录清单与预估时长当场重算。';

/** 三种状态的原因（每一行作品都带一条，界面直接渲染）。 */
export const VIDEO_SELECTION_INCLUDED_NOTE = '收录：按课次时间线留在成片里。';
export const VIDEO_SELECTION_DROPPED_NOTE = '超出时长上限：均匀取样时没有进收录清单（首末两幅必留）。';
export const VIDEO_SELECTION_EXCLUDED_NOTE = '老师手动排除：这一幅不参与本次精选，也不进成片。';

/** 两个动作的按钮文案（收录与排除互为反向）。 */
export const VIDEO_SELECTION_EXCLUDE_LABEL = '排除这一幅';
export const VIDEO_SELECTION_INCLUDE_LABEL = '恢复收录';

/** 三种状态的短标签（挂在行上，读界面就能看出这一幅的去向）。 */
export const VIDEO_SELECTION_STATE_LABELS = {
  included: '收录',
  dropped: '已舍弃',
  excluded: '已手动排除',
  absence: '缺课记录'
};

/**
 * 缺课记录（`entry.isAbsence`）的行说明：它**不是一幅作品** —— 不进帧序、不占精选名额，
 * 也不参与「本周期共 N 幅」的计数（US-215 的帧序规则本来就跳过它，这里只是把它如实列出来，
 * 免得老师以为这条课次丢了）。
 */
export const VIDEO_SELECTION_ABSENCE_NOTE = '缺课记录：不进帧序，也不参与精选（它没有作品帧）。';

/** 一个周期里一幅作品都没有时的说明。 */
export const VIDEO_SELECTION_EMPTY_TEXT = '这个周期还没有可精选的作品：先完成一节课的归档，精选清单会自动接上来。';

/** 没有学员名时的分组口径（不编名字，如实写「未记录学员」）。 */
export const VIDEO_SELECTION_UNNAMED_STUDENT = '未记录学员';

/**
 * 「每位学员至少 1 幅 + 按作品数比例分配」的那句口径（班级成片专用）。
 * 单独写一份是因为它要同时出现在规则读数与学员分配块的说明里。
 */
export const VIDEO_SELECTION_QUOTA_NOTE = '先保底：每位学员至少 1 幅；剩余名额按作品数比例分（作品多的多分几幅），分完为止。';

/**
 * 保底本身就已经超过上限时的那句实话（个人 120 / 班级 300 的极端情形）：
 * 不许悄悄丢掉某位学员的作品来凑上限 —— 保底优先，并且**如实说清超了多少**。
 */
export const VIDEO_SELECTION_OVER_CAP_NOTE = '每位学员至少 1 幅（保底）已经超过时长上限：保底优先于上限，这一版会如实超出，不靠少收某位学员来凑时长。';

// ---------------------------------------------------------------------------
// ① 时长上限（本故事第 1 条验收）
// ---------------------------------------------------------------------------

/** 两种成片的目标时长上限（秒）—— 验收点名的两个数字，改这里就是改规则。 */
export const VIDEO_DURATION_CAP_SEC = { personal: 120, class: 300 };

/** 某个类型的时长上限（`overrides` 只在断言 / 回归时用，界面不传）。 */
export function videoDurationCapSec(type, overrides = null) {
  const kind = normalizeVideoJobType(type);
  const custom = overrides && typeof overrides === 'object' ? num(overrides[kind]) : 0;
  if (custom > 0) return custom;
  return num(VIDEO_DURATION_CAP_SEC[kind]) || VIDEO_DURATION_CAP_SEC.personal;
}

/** 上限的人话读数（`个人成片上限 120 秒（2 分钟）`）。 */
export function videoSelectionCapText(type) {
  const kind = normalizeVideoJobType(type);
  const cap = videoDurationCapSec(kind);
  return `${videoJobTypeLabel(kind)}上限 ${cap} 秒（${videoTimelineDurationText(cap)}）`;
}

/**
 * 精选规则的读数（界面渲染它、断言读它 —— 数字只在上面那些常量里写一次）。
 * 四条：个人上限 / 班级上限 / 超出上限时的取样 / 班级配额分配。
 */
export function videoSelectionRuleRows() {
  return [
    {
      id: 'personal',
      label: '个人成片',
      value: `不超过 ${VIDEO_DURATION_CAP_SEC.personal} 秒`,
      detail: `一位孩子的作品帧串起来，目标时长不超过 ${videoTimelineDurationText(VIDEO_DURATION_CAP_SEC.personal)}。`
    },
    {
      id: 'class',
      label: '班级成片',
      value: `不超过 ${VIDEO_DURATION_CAP_SEC.class} 秒`,
      detail: `全班按学员分段串成一条，目标时长不超过 ${videoTimelineDurationText(VIDEO_DURATION_CAP_SEC.class)}。`
    },
    {
      id: 'sampling',
      label: '超出上限',
      value: '按课次时间线均匀取样',
      detail: '在按课次日期 + 课时序号升序的作品列表上等距取样：第一幅与最后一幅必留，中间的作品按课次跨度均匀分布。'
    },
    {
      id: 'quota',
      label: '班级配额',
      value: '每人至少 1 幅 + 按作品数比例',
      detail: VIDEO_SELECTION_QUOTA_NOTE
    }
  ];
}

/** 规则的行 id（断言用：四条缺一不可）。 */
export const VIDEO_SELECTION_RULE_IDS = videoSelectionRuleRows().map(row => row.id);

// ---------------------------------------------------------------------------
// ② 均匀取样（本故事第 2 条验收：按课次时间线均匀取样，首末两幅必留）
// ---------------------------------------------------------------------------

/** 取样时至少要留下的幅数（个人成片：第一幅 + 最后一幅）。 */
export const VIDEO_SELECTION_MIN_KEEP = 2;

/**
 * 在 `count` 个**有序**位置上等距取 `size` 个下标（升序、不重复）：
 *  - `size >= count` → 全取（没超上限就不取样，一幅都不舍弃）；
 *  - `size === 1` → 只留第一幅（`[0]`，说不出「首末都在」时就只留开头那幅）；
 *  - 其余 → `round(i × (count−1) / (size−1))`，`i = 0` 给 `0`、`i = size−1` 给 `count−1`：
 *    **首末两幅必留**在结构上成立（不是一个额外的 if）。
 */
export function videoSelectionSampleIndices(count, size) {
  const total = Math.max(0, int(count));
  const keep = Math.min(total, Math.max(0, int(size)));
  if (!total || !keep) return [];
  if (keep >= total) return Array.from({ length: total }, (unused, index) => index);
  if (keep === 1) return [0];
  const indices = [];
  for (let step = 0; step < keep; step += 1) indices.push(Math.round((step * (total - 1)) / (keep - 1)));
  return indices;
}

// ---------------------------------------------------------------------------
// ③ 班级配额分配（本故事第 3 条验收：先每人至少 1 幅，再按作品数比例分剩余）
// ---------------------------------------------------------------------------

/**
 * 把 `quota` 个名额分给几位学员（**最大余数法**），返回与入参同序、同长度的分配结果：
 *  - ① **保底**：每位学员先 1 幅（名额不够让每人都有时，按时间线顺序**均匀挑学员**，
 *    不整段丢掉排在后面的孩子）；
 *  - ② **剩余名额按作品数比例分**：`剩余 × 该学员作品数 / 在场作品数`，先取整数部分，
 *    再把余下的按小数部分从大到小一位一位给（作品先分完的学员自动把余量让给别人）；
 *  - 只分发得出去的：某位学员只有 1 幅时不会再给他第二幅。
 */
export function videoSelectionAllocateGroups(groups = [], quota = 0) {
  const list = (Array.isArray(groups) ? groups : []).map((group, order) => ({
    key: str(group && group.key),
    name: str(group && group.name),
    count: Math.max(0, int(group && group.count)),
    order: Number.isFinite(Number(group && group.order)) ? int(group.order) : order
  })).filter(group => group.count > 0);
  const total = list.reduce((sum, group) => sum + group.count, 0);
  const target = Math.min(Math.max(0, int(quota)), total);
  const rows = list.map(group => ({ ...group, quota: 0 }));
  if (!target) return rows;
  // ① 保底：名额够就每人 1 幅；不够就按时间线顺序均匀挑学员（首末两位必在其中）。
  const floor = Math.min(rows.length, target);
  videoSelectionSampleIndices(rows.length, floor).forEach(index => { rows[index].quota = 1; });
  let remaining = target - floor;
  // ② 剩余名额按作品数比例分，直到分完或没人还能再收。
  while (remaining > 0) {
    const open = rows.filter(row => row.quota < row.count);
    if (!open.length) break;
    const weight = open.reduce((sum, row) => sum + row.count, 0);
    const shares = [];
    let used = 0;
    open.forEach(row => {
      const exact = weight ? (remaining * row.count) / weight : 0;
      const take = Math.min(row.count - row.quota, Math.floor(exact));
      row.quota += take;
      used += take;
      shares.push({ row, fraction: exact - Math.floor(exact) });
    });
    remaining -= used;
    if (remaining <= 0) break;
    // 整数部分一分都分不出去（剩余名额比学员数还少）：按小数部分从大到小给，一位一位来。
    shares.sort((left, right) => right.fraction - left.fraction || left.row.order - right.row.order);
    let progressed = 0;
    shares.forEach(share => {
      if (remaining <= 0 || share.row.quota >= share.row.count) return;
      share.row.quota += 1;
      remaining -= 1;
      progressed += 1;
    });
    if (!progressed) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// ④ 精选方案（纯函数；界面只渲染它的产物）
// ---------------------------------------------------------------------------

/** 一条归档条目在精选里的键（`id` 与 `recordKey` 都认，取先有的那一个）。 */
export function videoSelectionEntryKey(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  return str(source.id) || str(source.recordKey);
}

/**
 * 按课次时间线排序：课次日期 + 课时序号升序（唯一实现在 `videoTimeline.js`；
 * [第四步到第一步联通] US-087 起同日再按课时序号排 —— 四处排时间线不各写一份）。
 */
function orderByTimeline(entries) {
  return orderVideoTimelineEntries(entries);
}

/** 学员分组（班级成片用）：按时间线上第一次出现的顺序排，组内保持时间线顺序。 */
export function videoSelectionStudentGroups(entries = []) {
  const groups = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry, position) => {
    const name = str(entry && entry.student) || VIDEO_SELECTION_UNNAMED_STUDENT;
    if (!groups.has(name)) groups.set(name, { key: name, name, order: groups.size, count: 0, entries: [] });
    const group = groups.get(name);
    group.count += 1;
    group.entries.push({ entry, position });
  });
  return Array.from(groups.values());
}

/** 这批条目里有几位学员（班级成片的保底份数）。 */
function studentCount(entries) {
  return videoSelectionStudentGroups(entries).length;
}

/**
 * 按名额 `size` 选出一批条目（**内部函数**，时间线顺序返回）：
 *  - 个人成片：在整条时间线上均匀取样（首末两幅必留）；
 *  - 班级成片：先按 `videoSelectionAllocateGroups` 分名额（每人至少 1 幅 + 按作品数比例），
 *    每位学员再在**自己的课次时间线**上均匀取样（同样首末必留），最后按整体时间线顺序合并。
 */
function videoSelectionSelect(entries, type, size) {
  const list = Array.isArray(entries) ? entries : [];
  const target = Math.min(list.length, Math.max(0, int(size)));
  if (!target) return [];
  if (target >= list.length) return list.slice();
  if (normalizeVideoJobType(type) !== 'class') {
    return videoSelectionSampleIndices(list.length, target).map(index => list[index]);
  }
  const groups = videoSelectionStudentGroups(list);
  const allocation = videoSelectionAllocateGroups(
    groups.map(group => ({ key: group.key, name: group.name, count: group.count, order: group.order })),
    target
  );
  const quotaByKey = new Map(allocation.map(row => [row.key, row.quota]));
  const keep = new Set();
  groups.forEach(group => {
    const quota = quotaByKey.get(group.key) || 0;
    videoSelectionSampleIndices(group.entries.length, quota).forEach(index => keep.add(group.entries[index].position));
  });
  return list.filter((unused, index) => keep.has(index));
}

/**
 * 「入选的那一批」按 US-215 的帧序规则推出来的成片时长（秒）。
 * 这是预估时长的**唯一算法**：帧时长 / 转场 / 照片槽都读 `videoTimeline.js` 那一份常量，
 * 所以精选清单上的时长与帧清单上的总时长永远是一个数。
 */
export function videoSelectionDurationSec(entries, { type = 'personal' } = {}) {
  return videoTimelinePlan({ entries, type: normalizeVideoJobType(type) }).totalSec;
}

/**
 * 精选方案（纯函数、永不抛错）：哪些作品进成片、哪些被舍弃、预估时长是多少。
 *
 * 入参：
 *  - `entries`：当前对象 + **生成周期**下的归档条目（与 `videoTimelinePlan` 同一份口径，
 *    日期升序、带 `artwork` / `photos` / `dimensions` / `isAbsence`）；
 *  - `type`：`personal`（上限 120 秒）/ `class`（上限 300 秒）；
 *  - `excluded`：老师手动排除的作品键（`entry.id` / `entry.recordKey`）—— **先去掉再精选**；
 *  - `capSec`：上限覆盖（只在断言里用，界面不传）。
 *
 * 返回（**所有状态同形状**）：
 *  - `selectedEntries` / `droppedEntries` / `excludedEntries`：三类**作品**条目（都按时间线顺序）；
 *  - `absenceEntries`：缺课记录（`isAbsence`）—— 不进候选、不占名额、也不计进 `counts.total`；
 *  - `counts`：`{ total, candidates, selected, dropped, excluded, absence, students }`；
 *  - `durationSec`：入选清单的预估时长（见 `videoSelectionDurationSec`）；
 *  - `fullSec` 与 `capExceeded`：一整期不取舍时的时长与它是否超标（界面据此说清「为什么舍弃了这些」）；
 *  - `sampled`：这次真的取样了（舍弃了至少一幅）；`overCap`：保底本身就超上限（如实标记）。
 *  - `studentRows`：班级成片的每位学员分配读数（个人成片是空数组）。
 */
export function videoSelectionPlan({ entries = [], type = 'personal', excluded = [], capSec = null } = {}) {
  const kind = normalizeVideoJobType(type);
  const cap = videoDurationCapSec(kind, capSec ? { [kind]: capSec } : null);
  // 缺课记录**不是一幅作品**：不进候选、不占名额、也不计进「本周期共 N 幅」（与 US-215 的帧序同一口径）。
  const timeline = orderByTimeline(entries);
  const lessons = timeline.filter(entry => !(entry && entry.isAbsence));
  const absenceEntries = timeline.filter(entry => entry && entry.isAbsence);
  const excludedKeys = new Set((Array.isArray(excluded) ? excluded : []).map(value => str(value)).filter(Boolean));
  const excludedEntries = lessons.filter(entry => excludedKeys.has(videoSelectionEntryKey(entry)));
  const candidates = lessons.filter(entry => !excludedKeys.has(videoSelectionEntryKey(entry)));
  const durationOf = list => videoSelectionDurationSec(list, { type: kind });
  const fullSec = durationOf(candidates);
  // 保底份数：班级成片 = 每位学员 1 幅；个人成片 = 首末两幅。
  const floorSize = kind === 'class'
    ? Math.min(candidates.length, studentCount(candidates))
    : Math.min(candidates.length, VIDEO_SELECTION_MIN_KEEP);
  let size = candidates.length;
  if (candidates.length && fullSec > cap) {
    size = floorSize;
    // 从「全收」往下找**最大的**放得下的名额（时长随作品数单调，但照片槽有台阶，所以逐个试）。
    for (let probe = candidates.length - 1; probe >= floorSize; probe -= 1) {
      if (durationOf(videoSelectionSelect(candidates, kind, probe)) <= cap) { size = probe; break; }
    }
  }
  const selected = videoSelectionSelect(candidates, kind, size);
  const selectedKeys = new Set(selected.map(videoSelectionEntryKey));
  const dropped = candidates.filter(entry => !selectedKeys.has(videoSelectionEntryKey(entry)));
  const durationSec = durationOf(selected);
  const groups = videoSelectionStudentGroups(candidates);
  const allocation = kind === 'class'
    ? new Map(videoSelectionAllocateGroups(groups.map(group => ({ key: group.key, name: group.name, count: group.count, order: group.order })), selected.length).map(row => [row.key, row.quota]))
    : new Map();
  const studentRows = kind === 'class'
    ? groups.map(group => {
      const quota = allocation.get(group.key) || 0;
      const kept = selected.filter(entry => (str(entry && entry.student) || VIDEO_SELECTION_UNNAMED_STUDENT) === group.key).length;
      return { name: group.name, count: group.count, quota, kept, floorMet: kept >= Math.min(1, group.count) };
    })
    : [];
  return {
    type: kind,
    typeLabel: videoJobTypeLabel(kind),
    capSec: cap,
    capText: videoSelectionCapText(kind),
    lessons,
    absenceEntries,
    candidates,
    selectedEntries: selected,
    droppedEntries: dropped,
    excludedEntries,
    counts: {
      total: lessons.length,
      candidates: candidates.length,
      selected: selected.length,
      dropped: dropped.length,
      excluded: excludedEntries.length,
      absence: absenceEntries.length,
      students: groups.length
    },
    durationSec,
    fullSec,
    capExceeded: fullSec > cap,
    sampled: dropped.length > 0,
    overCap: durationSec > cap,
    studentRows
  };
}

// ---------------------------------------------------------------------------
// ⑤ 视图产物（界面只渲染它：那一句读数 / 每一行的去向 / 学员分配）
// ---------------------------------------------------------------------------

/**
 * 「本周期共 N 幅，已精选 M 幅收录」（验收点名的原句，界面不另写一份）。
 */
export function videoSelectionSummary(total, selected) {
  return `本周期共 ${Math.max(0, int(total))} 幅，已精选 ${Math.max(0, int(selected))} 幅收录`;
}

/** 预估时长那一行：`预估时长 1 分 57 秒（个人成片上限 120 秒（2 分钟））`。 */
export function videoSelectionDurationSummary(durationSec, capSec, type) {
  return `预估时长 ${videoTimelineDurationText(durationSec)}（${videoSelectionCapText(type)}）`;
}

/**
 * 精选方案的视图产物（**所有状态返回同一组字段**）：汇总 / 预估时长 / 每一行的去向 / 学员分配。
 * 界面渲染的每一行都在这里，组件不自己算时长、不自己拼「为什么舍弃」的说明。
 */
export function videoSelectionView(plan) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const type = normalizeVideoJobType(source.type);
  const capSec = num(source.capSec) || videoDurationCapSec(type);
  const lessons = Array.isArray(source.lessons) ? source.lessons : [];
  const absenceRows = Array.isArray(source.absenceEntries) ? source.absenceEntries : [];
  const selected = Array.isArray(source.selectedEntries) ? source.selectedEntries : [];
  const dropped = Array.isArray(source.droppedEntries) ? source.droppedEntries : [];
  const excludedRows = Array.isArray(source.excludedEntries) ? source.excludedEntries : [];
  const selectedKeys = new Set(selected.map(videoSelectionEntryKey));
  const excludedKeys = new Set(excludedRows.map(videoSelectionEntryKey));
  const durationSec = Math.max(0, num(source.durationSec));
  const fullSec = Math.max(0, num(source.fullSec) || durationSec);
  const stateOf = entry => {
    const key = videoSelectionEntryKey(entry);
    if (excludedKeys.has(key)) return 'excluded';
    return selectedKeys.has(key) ? 'included' : 'dropped';
  };
  const rowOf = entry => {
    const status = stateOf(entry);
    return {
      id: videoSelectionEntryKey(entry),
      entryId: videoSelectionEntryKey(entry),
      student: str(entry && entry.student),
      date: str(entry && entry.date),
      title: str(entry && entry.title) || '作品名未记录',
      state: status,
      stateLabel: VIDEO_SELECTION_STATE_LABELS[status] || '',
      note: status === 'excluded' ? VIDEO_SELECTION_EXCLUDED_NOTE : (status === 'dropped' ? VIDEO_SELECTION_DROPPED_NOTE : VIDEO_SELECTION_INCLUDED_NOTE),
      action: status === 'excluded' ? 'include' : 'exclude',
      actionLabel: status === 'excluded' ? VIDEO_SELECTION_INCLUDE_LABEL : VIDEO_SELECTION_EXCLUDE_LABEL
    };
  };
  // 缺课记录排在它自己的课次位置上（如实列出来，但没有作品帧、也没有可点的排除开关）。
  const absenceRowOf = entry => ({
    id: videoSelectionEntryKey(entry),
    entryId: videoSelectionEntryKey(entry),
    student: str(entry && entry.student),
    date: str(entry && entry.date),
    title: str(entry && entry.title) || '缺课记录',
    state: 'absence',
    stateLabel: VIDEO_SELECTION_STATE_LABELS.absence,
    note: VIDEO_SELECTION_ABSENCE_NOTE,
    action: '',
    actionLabel: ''
  });
  const rows = [...lessons.concat(absenceRows)]
    .map(entry => ({ entry, key: str(entry && entry.date) }))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(item => (item.entry && item.entry.isAbsence ? absenceRowOf(item.entry) : rowOf(item.entry)));
  const counts = { total: lessons.length, selected: selected.length, dropped: dropped.length, excluded: excludedRows.length, absence: absenceRows.length, students: 0 };
  counts.students = Array.isArray(source.studentRows) ? source.studentRows.length : Math.max(0, int(source.counts && source.counts.students));
  const notes = [];
  if (dropped.length) {
    notes.push(`本周期 ${counts.total} 幅不取舍时有 ${videoTimelineDurationText(fullSec)}，超过${videoSelectionCapText(type)}：已按课次时间线均匀取样到 ${counts.selected} 幅（第一幅与最后一幅必留）。`);
  }
  if (counts.excluded) notes.push(`老师手动排除了 ${counts.excluded} 幅：它们不参与精选，也不进成片。`);
  if (counts.absence) notes.push(`另有 ${counts.absence} 条缺课记录：不进帧序，也不参与精选。`);
  if (source.overCap === true) notes.push(VIDEO_SELECTION_OVER_CAP_NOTE);
  const studentRows = (Array.isArray(source.studentRows) ? source.studentRows : []).map(row => ({
    name: str(row && row.name) || VIDEO_SELECTION_UNNAMED_STUDENT,
    count: Math.max(0, int(row && row.count)),
    quota: Math.max(0, int(row && row.quota)),
    kept: Math.max(0, int(row && row.kept)),
    floorMet: row && row.floorMet === true,
    note: `共 ${Math.max(0, int(row && row.count))} 幅 · 收录 ${Math.max(0, int(row && row.kept))} 幅`
  }));
  return {
    type,
    typeLabel: videoJobTypeLabel(type),
    capSec,
    capText: videoSelectionCapText(type),
    total: counts.total,
    selectedCount: counts.selected,
    droppedCount: counts.dropped,
    excludedCount: counts.excluded,
    absenceCount: counts.absence,
    studentCount: counts.students,
    durationSec,
    durationText: videoTimelineDurationText(durationSec),
    capTextValue: videoTimelineDurationText(capSec),
    fullSec,
    fullText: videoTimelineDurationText(fullSec),
    summary: videoSelectionSummary(counts.total, counts.selected),
    durationSummary: videoSelectionDurationSummary(durationSec, capSec, type),
    durationCapSummary: `上限 ${capSec} 秒（${videoTimelineDurationText(capSec)}）`,
    capExceeded: source.capExceeded === true,
    sampled: source.sampled === true,
    overCap: source.overCap === true,
    overCapNote: source.overCap === true ? VIDEO_SELECTION_OVER_CAP_NOTE : '',
    notes,
    rows,
    studentRows,
    rules: videoSelectionRuleRows(),
    quotaNote: VIDEO_SELECTION_QUOTA_NOTE,
    empty: counts.total === 0,
    emptyText: VIDEO_SELECTION_EMPTY_TEXT,
    labels: { exclude: VIDEO_SELECTION_EXCLUDE_LABEL, include: VIDEO_SELECTION_INCLUDE_LABEL }
  };
}
