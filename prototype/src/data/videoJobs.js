// 视频任务（云端表 `video_jobs`）的**本机 mock 队列与状态机** —— 数据层唯一真源
// （[第四步 US-213a] / FR-256 ~ FR-261，tasks/prd-archive-share.md 的 US-213）。
//
// 渲染服务还没接进来，前端不能空等：这一份模块把「任务长什么样、状态怎么流转、进度怎么推、
// 同一件事重复提交怎么办」全部定死成**零依赖纯函数 + 常量**（唯一 import 是同样零依赖的
// `data/archiveSummary.js`，复用时间读数口径，不抄第二份），可直接用 Node 直跑断言；
// 落地（内存 + localStorage）与定时推演在 `services/videoJobQueue.js`；界面只渲染视图产物。
//
//  ① **任务字段**（FR-257）：`jobKey / type / studentId / classId / period / specSnapshot / status /
//     progress / attempts / error` 是必填清单（`videoJobMissingFields(job)` 可当场查缺哪一项）；
//  ② **状态机**（FR-256）：`queued → rendering → done | failed | canceled`，**不可跳变**
//     （`videoJobTransitionIssue` 是唯一判据；`failed / canceled → queued` 是重试，不是跳变）；
//  ③ **幂等**（FR-258）：`jobKey` 由「类型 + 对象 + 周期」派生（`videoJobKey`），同一 jobKey
//     重复提交**不产生第二条任务**（归一化去重 + 服务层按 key upsert）；
//  ④ **模拟推进**：本模块只做「按经过时间算进度」的纯函数（`videoJobAdvance`）—— 演示档
//     个人 8 秒 / 班级 14 秒走完 0 → 100；真实硬超时仍是个人 5 分钟 / 班级 15 分钟，
//     超时判 `failed` 并可重试（`VIDEO_JOB_TIMEOUT_MS`）；单机构并发默认 2（FR-261）；
//  ⑤ **不假装有服务**（本故事第 5 条）：`VIDEO_JOB_DEMO_LABEL` 是界面与任务卡片上唯一那句话，
//     且演示任务**结构上带不了成片**：`outputUrl / durationSec / bytes` 在归一化里被清成
//     空串 / 0 / 0（`videoJobOutputIssue` 是这条口径的判据）—— 进度可以走到 100，
//     但「已完成」不等于「有成片」，卡片上如实写「未产出成片」。
//  ⑥ **老师端任务卡（[第四步 US-214]）**：生成入口的文案（`VIDEO_JOB_SUBMIT_LABEL`）、
//     「预估剩余时间」（`videoJobEtaView`，明写「不是成片时长」）、四类失败原因的可选值
//     （`VIDEO_JOB_SIMULATE_ERROR_OPTIONS`）与「离开页面后按 jobKey 恢复」的判定
//     （`videoJobResumed` / `videoJobResumeSummary`）都在这一份里，界面只渲染它们的产物。
//
// 与 `data/archiveReports.js` / `data/shareForward.js` 同一条纪律：**视图函数的所有状态返回同形状
// 字段**（US-204 的白屏坑：某一态少给一个字段就会在渲染期炸成白屏，而 `pnpm run build` 全绿）。

import { formatArchiveTime } from './archiveSummary';
// 成片记录里的音乐（[第四步 US-221] / FR-295 / FR-300）：`specSnapshot.music` 的形状与归一化
// 只写在 `data/musicSelection.js` 那一份里（曲目 id + 授权凭证快照 + 处置结果），这里只负责
// 把它作为快照的一部分带进任务 —— 白名单之外不做第二次判断。
import { normalizeMusicJobMusic } from './musicSelection';

const str = value => String(value ?? '').trim();
const num = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const int = value => Math.trunc(num(value));

/** 任务队列的本机镜像键（云端表是 `video_jobs`）。 */
export const VIDEO_JOB_STORAGE_KEY = 'xinlehui-video-jobs-v1';

/** 队列的来源标签：本机演示队列（不是服务端队列）。 */
export const VIDEO_JOB_QUEUE_SOURCE = 'local-mock-queue';
export const VIDEO_JOB_QUEUE_SOURCE_LABEL = '本机演示队列';

/**
 * 界面与任务卡片上**唯一那句话**（验收原文）：`data-video-demo-label` 与文案、断言读的都是它，
 * 谁都不许在组件里再写一遍（US-207b 的纪律：验收点名的句子只能有一份）。
 */
export const VIDEO_JOB_DEMO_LABEL = '演示数据 · 视频服务未接入';

/** 演示队列的补充说明（界面渲染它，不各写一份）。 */
export const VIDEO_JOB_DEMO_NOTE = '任务队列跑在本机：进度由本机时钟推演，不发请求、不产出成片、也不产生时长与封面。';

/** 「已完成」的演示任务卡片上那句实话 —— 进度 100 不等于有视频（界面不渲染 markdown，别写 `**`）。 */
export const VIDEO_JOB_DEMO_DONE_NOTE = '演示任务已完成（本机模拟推进到 100%），但未产出成片：视频服务接入前不会有时长、封面或下载地址。';

/** 空队列时的文案。 */
export const VIDEO_JOB_EMPTY_TEXT = '演示队列里还没有任务。选好对象与周期，提交一个演示任务就能看到状态机与进度推进。';

// ---------------------------------------------------------------------------
// ⓪ 入口文案（[第四步 US-214] 第 1 条：成长档案页「成长记录（视频）」类型下的生成入口）
// ---------------------------------------------------------------------------

/** 入口所在的区块名（验收原文就是这七个字，界面与断言读同一份）。 */
export const VIDEO_JOB_SECTION_TITLE = '成长记录（视频）';
/** 入口标题与说明（界面渲染它，不各写一份）。 */
export const VIDEO_JOB_SECTION_DESC = '这里是「成长记录」里的视频类型：选好对象与周期，点一下生成就能去忙别的，进度在下面的任务卡片上接着走。';
export const VIDEO_JOB_SUBMIT_LABEL = '生成成长记录视频';
/** 提交前写在按钮旁那句「提交之后会发生什么」（提交 → 任务卡片 → 可离开页面）。 */
export const VIDEO_JOB_SUBMIT_NOTE = '提交后立即进入任务卡片（状态 / 进度百分比 / 预估剩余时间）；可以离开页面，重新进来会按 jobKey 恢复进度。';

/** 任务类型（FR-257 的 `type`）：个人成长视频 / 班级视频集锦。 */
export const VIDEO_JOB_TYPES = [
  { id: 'personal', label: '个人成长视频', objectLabel: '学员', note: '一位孩子的作品按课次串起来。' },
  { id: 'class', label: '班级视频集锦', objectLabel: '班级', note: '全班按学员分段串成一条。' }
];
export const VIDEO_JOB_TYPE_IDS = VIDEO_JOB_TYPES.map(type => type.id);
export const VIDEO_JOB_TYPE_DEFAULT = 'personal';

/** 类型归一化：只认两个字面值，其余（含脏值）一律回落 `personal`。 */
export function normalizeVideoJobType(value) {
  const text = str(value);
  return VIDEO_JOB_TYPE_IDS.includes(text) ? text : VIDEO_JOB_TYPE_DEFAULT;
}

/** 某个类型的展示文案。 */
export function videoJobTypeLabel(value) {
  const type = normalizeVideoJobType(value);
  return (VIDEO_JOB_TYPES.find(item => item.id === type) || {}).label || '';
}

// ---------------------------------------------------------------------------
// ① 状态机（FR-256）
// ---------------------------------------------------------------------------

/** 五个状态（PRD 原文的五个词就是 id）。 */
export const VIDEO_JOB_STATUSES = {
  queued: 'queued',
  rendering: 'rendering',
  done: 'done',
  failed: 'failed',
  canceled: 'canceled'
};

export const VIDEO_JOB_STATUS_IDS = ['queued', 'rendering', 'done', 'failed', 'canceled'];

export const VIDEO_JOB_STATUS_LABELS = {
  [VIDEO_JOB_STATUSES.queued]: '排队中',
  [VIDEO_JOB_STATUSES.rendering]: '渲染中',
  [VIDEO_JOB_STATUSES.done]: '已完成（演示）',
  [VIDEO_JOB_STATUSES.failed]: '已失败',
  [VIDEO_JOB_STATUSES.canceled]: '已取消'
};

/** 每个状态一句「现在是什么情况」（界面渲染它，卡片不自己编文案）。 */
export const VIDEO_JOB_STATUS_NOTES = {
  [VIDEO_JOB_STATUSES.queued]: '还在排队：渲染并发已满，轮到它时自动开始。',
  [VIDEO_JOB_STATUSES.rendering]: '正在渲染：进度按本机时钟推演到 100%。',
  [VIDEO_JOB_STATUSES.done]: '演示进度已走完（未产出成片，见卡片上的说明）。',
  [VIDEO_JOB_STATUSES.failed]: '这一次没跑完，可以重试；重试沿用同一个 jobKey。',
  [VIDEO_JOB_STATUSES.canceled]: '已取消：释放了队列位，可以重新排一次队。'
};

/** 进行中的两态（队列在跑、可以取消）。 */
export const VIDEO_JOB_ACTIVE_STATUSES = [VIDEO_JOB_STATUSES.queued, VIDEO_JOB_STATUSES.rendering];
/** 可重试的两态（FR-259：失败可重试；取消同样可以重排）。 */
export const VIDEO_JOB_RETRYABLE_STATUSES = [VIDEO_JOB_STATUSES.failed, VIDEO_JOB_STATUSES.canceled];
/** 终态之一：`done` 不再流转。 */
export const VIDEO_JOB_TERMINAL_STATUSES = [VIDEO_JOB_STATUSES.done];

/**
 * 状态机的允许边（**唯一真源**）：`queued → rendering → done | failed | canceled`。
 * `failed / canceled → queued` 是「重试」，不是新任务（attempts 自增、progress 归零）。
 * `queued → failed` 与 `queued → done` 这类跳变**不在表里** —— 也就永远转不过去。
 */
export const VIDEO_JOB_TRANSITIONS = {
  [VIDEO_JOB_STATUSES.queued]: [VIDEO_JOB_STATUSES.rendering, VIDEO_JOB_STATUSES.canceled],
  [VIDEO_JOB_STATUSES.rendering]: [VIDEO_JOB_STATUSES.done, VIDEO_JOB_STATUSES.failed, VIDEO_JOB_STATUSES.canceled],
  [VIDEO_JOB_STATUSES.failed]: [VIDEO_JOB_STATUSES.queued],
  [VIDEO_JOB_STATUSES.canceled]: [VIDEO_JOB_STATUSES.queued],
  [VIDEO_JOB_STATUSES.done]: []
};

/** 状态归一化：不认识的取值不猜，读成 `queued`（宁可少声称一点）。 */
export function normalizeVideoJobStatus(value) {
  const text = str(value);
  return VIDEO_JOB_STATUS_IDS.includes(text) ? text : VIDEO_JOB_STATUSES.queued;
}

/** 状态标签。 */
export function videoJobStatusLabel(value) {
  return VIDEO_JOB_STATUS_LABELS[normalizeVideoJobStatus(value)] || '';
}

/** 这一条任务现在能不能走到 `to`（能写回空串，不能写回可读原因）—— 界面、服务层与断言读同一份。 */
export function videoJobTransitionIssue(from, to) {
  const source = normalizeVideoJobStatus(from);
  const target = normalizeVideoJobStatus(to);
  const allowed = VIDEO_JOB_TRANSITIONS[source] || [];
  if (allowed.includes(target)) return '';
  return `${VIDEO_JOB_STATUS_LABELS[source]}不能直接变成${VIDEO_JOB_STATUS_LABELS[target]}：状态机是 queued → rendering → done / failed / canceled，中间状态不能跳过。`;
}

// ---------------------------------------------------------------------------
// ② 任务字段与幂等键（FR-257 / FR-258）
// ---------------------------------------------------------------------------

/** 验收点名的必填字段（顺序就是卡片上的顺序）。 */
export const VIDEO_JOB_REQUIRED_FIELDS = ['jobKey', 'type', 'studentId', 'classId', 'period', 'specSnapshot', 'status', 'progress', 'attempts', 'error'];

/** 全部字段白名单（归一化之外的键一律丢掉 —— 与审计日志同一条口径）。 */
export const VIDEO_JOB_FIELDS = [
  ...VIDEO_JOB_REQUIRED_FIELDS,
  'id', 'queuePosition', 'simulate', 'simulateErrorCode', 'demo', 'createdBy', 'createdAt', 'updatedAt', 'startedAt', 'finishedAt',
  'outputUrl', 'durationSec', 'bytes', 'errorCode'
];

/** 成片三件套：**演示任务上只能是空值**（`videoJobOutputIssue` 是判据）。 */
export const VIDEO_JOB_OUTPUT_FIELDS = ['outputUrl', 'durationSec', 'bytes'];

/** 演示任务携带成片信息时的可读原因（空串 = 合规）。 */
export function videoJobOutputIssue(job) {
  const source = job && typeof job === 'object' ? job : {};
  const hasUrl = Boolean(str(source.outputUrl));
  const duration = num(source.durationSec);
  const bytes = num(source.bytes);
  if (!hasUrl && duration <= 0 && bytes <= 0) return '';
  return '演示任务不得携带成片地址、时长或体积：视频服务未接入，这个队列跑不出视频。';
}

/** 位置归一化：对象名去空格（学员用 studentId、班级用 classId，另一个留空串）。 */
function objectFields({ type, studentId, classId }) {
  const kind = normalizeVideoJobType(type);
  const student = str(studentId);
  const klass = str(classId);
  if (kind === 'class') return { studentId: '', classId: klass };
  return { studentId: student, classId: '' };
}

/**
 * 任务的**业务键**（FR-258 的幂等键）：`video|type|studentId|classId|period`。
 * 「同一件事」= 同一个对象 + 同一个周期 + 同一种类型 —— 重复提交只会命中同一条任务。
 * 键怎么拼只在这里算一次（界面、服务层与断言读同一份）。
 */
export function videoJobKey({ type, studentId = '', classId = '', period = '' } = {}) {
  const kind = normalizeVideoJobType(type);
  const object = objectFields({ type: kind, studentId, classId });
  return ['video', kind, object.studentId || '-', object.classId || '-', str(period) || '-'].join('|');
}

/**
 * 提交前的可读原因（空串 = 可以提交）：**写入侧与界面读同一份**。
 * 缺对象 / 缺周期都不许「先建一条空任务再说」—— 建出来的任务连 jobKey 都指不清是谁的。
 */
export function videoJobSubmitIssue({ type, studentId = '', classId = '', period = '' } = {}) {
  const kind = normalizeVideoJobType(type);
  const object = objectFields({ type: kind, studentId, classId });
  if (!str(period)) return '请先选择生成周期（半学期 / 一学期 / 一年度）。';
  if (kind === 'class' && !object.classId) return '请先选择要生成集锦的班级。';
  if (kind === 'personal' && !object.studentId) return '请先选择要生成成长视频的学员。';
  return '';
}

/**
 * 提交时的快照（FR-257 的 `specSnapshot`）：**只记录这次任务指向什么**（对象 / 周期 / 归档里有多少
 * 节课与作品），不记录任何成片属性 —— 时长、精选清单与封面属于 US-215 / US-216，本故事不编。
 * 音乐是唯一例外（[第四步 US-221] / FR-288）：`music` 记的是**版权证据**（曲目 id + 授权凭证快照 +
 * 处置结果），不是成片属性 —— 事后要能证明「这条片子当时用的是有授权的曲子」。
 */
export function videoJobSpecSnapshot({ type, objectName = '', studentId = '', classId = '', period = '', lessonCount = 0, artworkCount = 0, photoCount = 0, capturedAt = '', music = null } = {}) {
  const kind = normalizeVideoJobType(type);
  const object = objectFields({ type: kind, studentId, classId });
  return {
    source: 'archive-resident',
    type: kind,
    objectName: str(objectName),
    studentId: object.studentId,
    classId: object.classId,
    period: str(period),
    lessonCount: Math.max(0, int(lessonCount)),
    artworkCount: Math.max(0, int(artworkCount)),
    photoCount: Math.max(0, int(photoCount)),
    capturedAt: str(capturedAt),
    // `null` = 这条任务提交时还没有音乐选择（老记录），不是「静音」——两者在界面与断言里能分开。
    music: normalizeMusicJobMusic(music)
  };
}

/** 快照归一化（读旧记录 / 脏数据都不抛错）。 */
export function normalizeVideoJobSnapshot(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return videoJobSpecSnapshot({
    type: source.type,
    objectName: source.objectName,
    studentId: source.studentId,
    classId: source.classId,
    period: source.period,
    lessonCount: source.lessonCount,
    artworkCount: source.artworkCount,
    photoCount: source.photoCount,
    capturedAt: source.capturedAt,
    music: source.music
  });
}

/** 快照渲染成卡片上的几行读数（`value` 都给，界面不自己拼字符串）。 */
export function videoJobSpecRows(snapshot) {
  const spec = normalizeVideoJobSnapshot(snapshot);
  const music = spec.music;
  return [
    { id: 'object', label: '对象', value: spec.objectName || (spec.studentId || spec.classId) || '未记录' },
    { id: 'type', label: '类型', value: videoJobTypeLabel(spec.type) },
    { id: 'period', label: '周期', value: spec.period || '未记录' },
    { id: 'lessons', label: '课次', value: `${spec.lessonCount} 节课` },
    { id: 'artworks', label: '作品', value: `${spec.artworkCount} 幅` },
    { id: 'photos', label: '课堂照片', value: `${spec.photoCount} 张` },
    {
      id: 'music',
      label: '音乐',
      // 音乐这一行读的是成片记录里的版权证据（US-221）：静音 / 曲目名（id）/ 老任务如实写「未记录」。
      value: !music
        ? '未记录（这条任务提交时还没有音乐选择）'
        : (music.muted ? '静音' : `${music.title || '未命名曲目'}（${music.trackId || 'id 未记录'}）`)
    }
  ];
}

/** 任务还缺哪些必填项（空数组 = 齐全）—— 提交前 / 断言都用它。 */
export function videoJobMissingFields(job) {
  const source = job && typeof job === 'object' ? job : {};
  const kind = normalizeVideoJobType(source.type);
  return VIDEO_JOB_REQUIRED_FIELDS.filter(field => {
    if (field === 'specSnapshot') return !(source.specSnapshot && typeof source.specSnapshot === 'object');
    if (field === 'progress' || field === 'attempts') return !Number.isFinite(Number(source[field]));
    if (field === 'status') return !VIDEO_JOB_STATUS_IDS.includes(str(source.status));
    // 对象字段按类型判：个人任务要 `studentId`（`classId` 合法为空），班级任务反过来。
    if (field === 'studentId') return kind === 'personal' && !str(source.studentId);
    if (field === 'classId') return kind === 'class' && !str(source.classId);
    // `error` 允许是空串（没失败就没有原因）；`jobKey / period / type` 必须有内容。
    if (field === 'error') return source.error === null || source.error === undefined;
    return !str(source[field]);
  });
}

/**
 * 归一化一条任务（永不抛错）：字段白名单 + 逐项回落默认值 + **结构上清掉成片三件套**。
 * `demo` 字段如实记着「这是演示队列的任务」，界面的 `演示数据 · 视频服务未接入` 就是读它。
 */
export function normalizeVideoJob(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const type = normalizeVideoJobType(source.type);
  const object = objectFields({ type, studentId: source.studentId, classId: source.classId });
  const status = normalizeVideoJobStatus(source.status);
  const progress = status === VIDEO_JOB_STATUSES.done ? 100 : Math.min(100, Math.max(0, int(source.progress)));
  const job = {
    jobKey: str(source.jobKey),
    id: str(source.id) || str(source.jobKey),
    type,
    studentId: object.studentId,
    classId: object.classId,
    period: str(source.period),
    specSnapshot: normalizeVideoJobSnapshot(source.specSnapshot),
    status,
    progress,
    attempts: Math.max(0, int(source.attempts)),
    error: str(source.error),
    errorCode: str(source.errorCode),
    queuePosition: Math.max(0, int(source.queuePosition)),
    simulate: str(source.simulate) === VIDEO_JOB_SIMULATIONS.fail ? VIDEO_JOB_SIMULATIONS.fail : VIDEO_JOB_SIMULATIONS.success,
    simulateErrorCode: normalizeSimulateErrorCode(source.simulateErrorCode),
    demo: source.demo === false ? false : true,
    createdBy: str(source.createdBy),
    createdAt: str(source.createdAt),
    updatedAt: str(source.updatedAt),
    startedAt: str(source.startedAt),
    finishedAt: str(source.finishedAt),
    // 成片三件套：演示队列里永远是空值（写入口径见 `videoJobOutputIssue`）。
    outputUrl: '',
    durationSec: 0,
    bytes: 0
  };
  return job;
}

/** 逐条归一化 + 按 `jobKey` 去重（同一键只留**最近更新**的那一条 —— 幂等在数据结构上成立）。 */
export function dedupeVideoJobs(list) {
  const rows = (Array.isArray(list) ? list : []).map(normalizeVideoJob);
  const byKey = new Map();
  rows.forEach(job => {
    if (!job.jobKey) return;
    const existing = byKey.get(job.jobKey);
    if (!existing) { byKey.set(job.jobKey, job); return; }
    const existingAt = str(existing.updatedAt) || str(existing.createdAt);
    const nextAt = str(job.updatedAt) || str(job.createdAt);
    if (nextAt >= existingAt) byKey.set(job.jobKey, job);
  });
  return Array.from(byKey.values());
}

/** 按 jobKey upsert（同一键替换，不追加）—— 服务层的写入口径。 */
export function applyVideoJob(list, job) {
  const next = normalizeVideoJob(job);
  const rows = dedupeVideoJobs(list).filter(item => item.jobKey !== next.jobKey);
  rows.push(next);
  return rows;
}

// ---------------------------------------------------------------------------
// ③ 演示推进：模拟耗时 + 硬超时 + 并发（FR-256 / FR-261）
// ---------------------------------------------------------------------------

/** 演示推进的模拟耗时：个人 8 秒 / 班级 14 秒走完 0 → 100（真实渲染时长以服务端为准）。 */
export const VIDEO_JOB_MOCK_SECONDS = { personal: 8, class: 14 };
export const VIDEO_JOB_MOCK_SECONDS_DEFAULT = VIDEO_JOB_MOCK_SECONDS.personal;

/** 真实硬超时（FR：个人 5 分钟 / 班级 15 分钟）——演示推进远快于它，但判据是真的。 */
export const VIDEO_JOB_TIMEOUT_MS = { personal: 5 * 60 * 1000, class: 15 * 60 * 1000 };

/** 单机构并发渲染数（FR-261 默认 2）：超出的留在 `queued` 并记 `queuePosition`。 */
export const VIDEO_JOB_CONCURRENCY_DEFAULT = 2;

/** 演示任务的两种走向（`simulate`）：成功走到 100，或在中途失败以便验证失败态与重试。 */
export const VIDEO_JOB_SIMULATIONS = { success: 'success', fail: 'fail' };
/** 演示失败发生在进度到这个数之后（固定值，便于断言与浏览器脚本复核）。 */
export const VIDEO_JOB_SIMULATE_FAIL_AT = 45;

/** 模拟耗时读数：个人 8 秒 / 班级 14 秒。 */
export function videoJobMockSeconds(type, overrides = null) {
  const kind = normalizeVideoJobType(type);
  const custom = overrides && typeof overrides === 'object' ? num(overrides[kind]) : 0;
  if (custom > 0) return custom;
  return num(VIDEO_JOB_MOCK_SECONDS[kind]) || VIDEO_JOB_MOCK_SECONDS_DEFAULT;
}

/** 硬超时读数。 */
export function videoJobTimeoutMs(type, overrides = null) {
  const kind = normalizeVideoJobType(type);
  const custom = overrides && typeof overrides === 'object' ? num(overrides[kind]) : 0;
  if (custom > 0) return custom;
  return num(VIDEO_JOB_TIMEOUT_MS[kind]) || VIDEO_JOB_TIMEOUT_MS.personal;
}

/** 进度读数：`0%` ~ `100%`（整数）。 */
export function videoJobProgressLabel(progress) {
  return `${Math.min(100, Math.max(0, int(progress)))}%`;
}

/** 按经过时间算进度（纯函数；到点就是 100，不会超过）。 */
export function videoJobProgressFromElapsed(elapsedMs, durationMs) {
  const duration = Math.max(1, num(durationMs));
  const elapsed = Math.max(0, num(elapsedMs));
  return Math.min(100, Math.max(0, Math.floor((elapsed / duration) * 100)));
}

const timeValue = value => {
  const parsed = new Date(str(value));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

/** 任务的变化指纹（服务层用它判断「要不要落盘 / 通知界面」）。 */
export function videoJobSignature(job) {
  const source = normalizeVideoJob(job);
  const music = source.specSnapshot?.music;
  // 音乐（曲目 id + 处置动作）必须在指纹里：换一首曲子而指纹不变时，服务层会判成「没变化」——
  // 不落盘、也不通知界面，记录看着像写进去了，刷新就没了（US-221 真踩）。
  const musicKey = music
    ? [music.muted ? 'mute' : music.trackId, music.disposition?.action || '', music.disposition?.at || ''].join('/')
    : 'legacy';
  return [source.jobKey, source.status, source.progress, source.attempts, source.error, source.queuePosition, source.updatedAt, musicKey].join('~');
}

/**
 * 推进一条任务一步（**纯函数**，不改入参，返回下一条任务）：
 *  - `queued`：不动（排队由服务层按并发上限提升）；
 *  - `rendering`：进度 = 经过时间 / 模拟耗时；到点 → `done`（progress 100）；超过硬超时 → `failed`；
 *    `simulate === 'fail'` 且进度过 `VIDEO_JOB_SIMULATE_FAIL_AT` → `failed`（演示失败，用于验证失败态与重试）；
 *  - 其余状态原样返回。
 * `now` 在测试里注入；`mockSeconds` / `timeoutMs` 可覆盖（Node 断言用）。
 */
export function videoJobAdvance(job, { now = Date.now(), mockSeconds = null, timeoutMs = null } = {}) {
  const current = normalizeVideoJob(job);
  if (current.status !== VIDEO_JOB_STATUSES.rendering) return current;
  const startedAt = timeValue(current.startedAt) || timeValue(current.createdAt) || num(now);
  const elapsed = Math.max(0, num(now) - startedAt);
  const durationMs = videoJobMockSeconds(current.type, mockSeconds) * 1000;
  const limitMs = videoJobTimeoutMs(current.type, timeoutMs);
  const stamp = new Date(num(now)).toISOString();
  // 硬超时优先于「跑完了」：真实渲染超时也要判失败（FR：超时判 failed 且可重试）。
  if (limitMs > 0 && elapsed >= limitMs) {
    return { ...current, status: VIDEO_JOB_STATUSES.failed, errorCode: VIDEO_JOB_ERROR_CODES.timeout.id, error: videoJobErrorText(VIDEO_JOB_ERROR_CODES.timeout.id), finishedAt: stamp, updatedAt: stamp };
  }
  const progress = videoJobProgressFromElapsed(elapsed, durationMs);
  if (current.simulate === VIDEO_JOB_SIMULATIONS.fail && progress >= VIDEO_JOB_SIMULATE_FAIL_AT) {
    // 演示失败也会**如实报是哪一类原因**（`simulateErrorCode`，默认素材）：四套文案都验得到（US-214 第 4 条）。
    const code = normalizeSimulateErrorCode(current.simulateErrorCode);
    return { ...current, progress: Math.max(current.progress, progress), status: VIDEO_JOB_STATUSES.failed, errorCode: code, error: videoJobErrorText(code), finishedAt: stamp, updatedAt: stamp };
  }
  if (progress >= 100) {
    return { ...current, status: VIDEO_JOB_STATUSES.done, progress: 100, finishedAt: stamp, updatedAt: stamp };
  }
  if (progress === current.progress) return { ...current, updatedAt: current.updatedAt || current.createdAt };
  return { ...current, progress, updatedAt: stamp };
}

// ---------------------------------------------------------------------------
// ④ 失败原因（US-214 点名的四类 + 超时）
// ---------------------------------------------------------------------------

/**
 * 可读的失败原因（模型 / 字体 / 素材 / 存储 + 超时）。
 * 界面只渲染 `text`，不自己按 code 写文案（US-214 的四套文案就从这里取）。
 */
export const VIDEO_JOB_ERROR_CODES = {
  model: { id: 'model', label: '模型', text: '渲染模型这一次没有完成（模型侧错误）。可以直接重试。' },
  font: { id: 'font', label: '字体', text: '渲染环境缺少中文字体，字幕可能缺字，已停止出片。补齐字体后可重试。' },
  asset: { id: 'asset', label: '素材', text: '有素材没能读取（图已失效或格式不支持），任务已停止。处理素材后可重试。' },
  storage: { id: 'storage', label: '存储', text: '成片写入存储失败（配额或网络），任务已停止。稍后可重试。' },
  timeout: { id: 'timeout', label: '超时', text: '任务超过硬超时（个人 5 分钟 / 班级 15 分钟），已判为失败，可重试。' }
};
export const VIDEO_JOB_ERROR_CODE_IDS = Object.keys(VIDEO_JOB_ERROR_CODES);

/** 原因码 → 可读文案（未知码回落一句通用文案，永不抛错）。 */
export function videoJobErrorText(code) {
  const id = str(code);
  if (!id) return '';
  const entry = VIDEO_JOB_ERROR_CODES[id];
  return entry ? entry.text : '任务这一次没有跑完，可以直接重试。';
}

// ---------------------------------------------------------------------------
// ④b 预估剩余时间与「离开页面 → 按 jobKey 恢复」（[第四步 US-214]）
// ---------------------------------------------------------------------------

/** 验收点名的那一行读数就叫「预估剩余时间」（界面渲染它，不另起名字）。 */
export const VIDEO_JOB_ETA_LABEL = '预估剩余时间';

/**
 * 这一行说的是**渲染还要多久**，不是成片时长 —— 视频服务接入前成片三件套一律为空，
 * 所以这句话必须写在读数旁边，免得两个「时间」被看成一个（US-214 第 5 条：不得显示假时长）。
 */
export const VIDEO_JOB_ETA_NOTE = '按本机时钟推演，是渲染还要等多久，不是成片时长。';
/** 排队中：还没轮到它，给的是「轮到之后」大约要渲染多久（不编一个「马上就好」）。 */
export const VIDEO_JOB_ETA_QUEUED_NOTE = '队列还没轮到它：这个数是轮到它之后大约要渲染多久，不是成片时长。';
/** 终态：没有剩余时间可说。 */
export const VIDEO_JOB_ETA_ENDED_NOTE = '任务已结束，没有剩余时间；成片时长由渲染服务给出，接入前这里不会显示任何时长。';

/** 毫秒 → 人话（约 N 秒 / 约 N 分 M 秒 / 约 N 小时 M 分）。 */
export function videoJobRemainingText(ms) {
  const total = Math.max(0, Math.round(num(ms) / 1000));
  if (total < 60) return `约 ${total} 秒`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds ? `约 ${minutes} 分 ${seconds} 秒` : `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `约 ${hours} 小时 ${rest} 分` : `约 ${hours} 小时`;
}

/**
 * 还要等多久（毫秒）：
 *  - `rendering`：模拟耗时 − 已经过去的那段（离开页面那段真实时间也算数，由 `startedAt` 推出来）；
 *  - `queued`：整段渲染量（还没开始，但「轮到之后要多久」是个真实读数）；
 *  - 终态：0。
 */
export function videoJobRemainingMs(job, { now = Date.now(), mockSeconds = null } = {}) {
  const current = normalizeVideoJob(job);
  const durationMs = videoJobMockSeconds(current.type, mockSeconds) * 1000;
  if (current.status === VIDEO_JOB_STATUSES.rendering) {
    const startedAt = timeValue(current.startedAt) || timeValue(current.createdAt) || num(now);
    const elapsed = Math.max(0, num(now) - startedAt);
    return Math.max(0, durationMs - elapsed);
  }
  if (current.status === VIDEO_JOB_STATUSES.queued) return durationMs;
  return 0;
}

/**
 * 「预估剩余时间」的视图产物（**五种状态同形状**：`status / known / ms / label / note`）：
 *  - `rendering` → `约 N 秒`，`known:true`；
 *  - `queued` → `轮到后约 N 秒`，`known:false`（那不是「还要等 N 秒」，别假装它是）；
 *  - 终态 → `已结束`，`known:false`。
 */
export function videoJobEtaView(job, { now = Date.now(), mockSeconds = null } = {}) {
  const current = normalizeVideoJob(job);
  const status = current.status;
  if (status === VIDEO_JOB_STATUSES.rendering) {
    const ms = videoJobRemainingMs(current, { now, mockSeconds });
    return { status, known: true, ms, label: videoJobRemainingText(ms), note: VIDEO_JOB_ETA_NOTE };
  }
  if (status === VIDEO_JOB_STATUSES.queued) {
    const ms = videoJobRemainingMs(current, { now, mockSeconds });
    return { status, known: false, ms, label: `轮到后${videoJobRemainingText(ms)}`, note: VIDEO_JOB_ETA_QUEUED_NOTE };
  }
  return { status, known: false, ms: 0, label: '已结束', note: VIDEO_JOB_ETA_ENDED_NOTE };
}

/**
 * 演示失败可选的原因（四类：模型 / 字体 / 素材 / 存储 —— 验收第 4 条点名的那四套文案）。
 * 超时不在里面：它由硬超时判出来，不是「挑一个原因让它失败」。
 */
export const VIDEO_JOB_SIMULATE_ERROR_IDS = ['model', 'font', 'asset', 'storage'];
export const VIDEO_JOB_SIMULATE_ERROR_OPTIONS = VIDEO_JOB_SIMULATE_ERROR_IDS.map(id => ({ id, label: VIDEO_JOB_ERROR_CODES[id].label, text: VIDEO_JOB_ERROR_CODES[id].text }));
export const VIDEO_JOB_SIMULATE_ERROR_DEFAULT = 'asset';

/** 演示失败原因归一化：只认那四类，其余（含脏值 / 超时）一律回落 `asset`。 */
export function normalizeSimulateErrorCode(value) {
  const id = str(value);
  return VIDEO_JOB_SIMULATE_ERROR_IDS.includes(id) ? id : VIDEO_JOB_SIMULATE_ERROR_DEFAULT;
}

/** 「离开页面 → 重新进来按 jobKey 恢复」的判定余量：刚提交完切走再切回来不算「恢复」。 */
export const VIDEO_JOB_RESUME_TOLERANCE_MS = 1000;
/** 恢复回来的任务卡片上那句实话（界面渲染它，组件不自己写）。 */
export const VIDEO_JOB_RESUME_NOTE = '已按 jobKey 恢复这条任务：它是离开页面前提交的，进度按真实经过时间接着算，没有重新开始。';

/**
 * 这条任务是不是**这次进入之前**提交、且现在还在进行中（US-214 第 3 条）：
 * `resumedAt` 是本次进入页面的时刻（组件挂载）。判定只用三个真实读数 ——
 * 状态在 `queued / rendering` 里、`createdAt` 早于本次进入、且差了容差以上的时间。
 */
export function videoJobResumed(job, resumedAt = 0) {
  const current = normalizeVideoJob(job);
  const at = num(resumedAt);
  if (!at) return false;
  if (!VIDEO_JOB_ACTIVE_STATUSES.includes(current.status)) return false;
  const created = timeValue(current.createdAt);
  return created > 0 && created <= at - VIDEO_JOB_RESUME_TOLERANCE_MS;
}

/** 面板级的恢复读数（`count` 条进行中的任务按 jobKey 接了回来；0 条时不出声）。 */
export function videoJobResumeSummary(count) {
  const total = Math.max(0, int(count));
  if (!total) return '';
  return `本次进入按 jobKey 恢复了 ${total} 条进行中的任务：进度按真实经过时间接上，没有重新开始。`;
}

// ---------------------------------------------------------------------------
// ⑤ 视图产物（所有状态同形状；界面只渲染它）
// ---------------------------------------------------------------------------

/** 两个动作的文案（卡片上的按钮读它）。 */
export const VIDEO_JOB_ACTIONS = {
  cancel: { id: 'cancel', label: '取消任务' },
  retry: { id: 'retry', label: '重试' }
};

/** 动作是否可以点（`allowed:false` 时 `issue` 给可读原因）—— 界面与写入侧读同一份。 */
export function videoJobActions(job) {
  const current = normalizeVideoJob(job);
  const active = VIDEO_JOB_ACTIVE_STATUSES.includes(current.status);
  const retryable = VIDEO_JOB_RETRYABLE_STATUSES.includes(current.status);
  return [
    {
      id: VIDEO_JOB_ACTIONS.cancel.id,
      label: VIDEO_JOB_ACTIONS.cancel.label,
      allowed: active,
      issue: active ? '' : `${videoJobStatusLabel(current.status)}的任务不用取消：它已经不在队列里了。`
    },
    {
      id: VIDEO_JOB_ACTIONS.retry.id,
      label: VIDEO_JOB_ACTIONS.retry.label,
      allowed: retryable,
      issue: retryable ? '' : `${videoJobStatusLabel(current.status)}的任务不用重试。`
    }
  ];
}

/** 单个动作的判据（服务层用；空串 = 可以执行）。 */
export function videoJobActionIssue(job, action) {
  const row = videoJobActions(job).find(item => item.id === str(action));
  return row ? row.issue : '不认识的动作。';
}

/**
 * 一条任务的视图产物（**所有状态返回同一组字段**）。
 * 界面渲染的每一行（对象 / 状态 / 进度 / 预估剩余时间 / 任务键 / 次数 / 失败原因 / 队列位次 /
 * 演示标注 / 是否按 jobKey 恢复）都在这里，组件不自己拼字符串、也不自己判断该给哪个按钮。
 * `now` / `resumedAt` 由界面注入（`resumedAt` = 本次进入页面的时刻），缺省不影响老调用方。
 */
export function videoJobView(job, { now = Date.now(), mockSeconds = null, resumedAt = 0 } = {}) {
  const current = normalizeVideoJob(job);
  const spec = current.specSnapshot;
  const objectName = spec.objectName || current.studentId || current.classId || '未记录对象';
  const active = VIDEO_JOB_ACTIVE_STATUSES.includes(current.status);
  const failed = current.status === VIDEO_JOB_STATUSES.failed;
  const eta = videoJobEtaView(current, { now, mockSeconds });
  const resumed = videoJobResumed(current, resumedAt);
  const hasOutput = Boolean(current.outputUrl);
  return {
    jobKey: current.jobKey,
    id: current.id,
    type: current.type,
    typeLabel: videoJobTypeLabel(current.type),
    objectName,
    studentId: current.studentId,
    classId: current.classId,
    period: current.period,
    status: current.status,
    statusLabel: videoJobStatusLabel(current.status),
    statusNote: VIDEO_JOB_STATUS_NOTES[current.status] || '',
    progress: current.progress,
    progressLabel: videoJobProgressLabel(current.progress),
    eta,
    etaLabel: eta.label,
    etaNote: eta.note,
    resumed,
    resumeNote: resumed ? VIDEO_JOB_RESUME_NOTE : '',
    attempts: current.attempts,
    attemptsLabel: `第 ${Math.max(1, current.attempts)} 次尝试`,
    error: current.error,
    errorText: failed ? (current.error || videoJobErrorText(current.errorCode)) : '',
    errorCode: failed ? (current.errorCode || '') : '',
    queueLabel: active && current.status === VIDEO_JOB_STATUSES.queued && current.queuePosition > 0 ? `队列第 ${current.queuePosition} 位` : '',
    specRows: videoJobSpecRows(spec),
    active,
    actions: videoJobActions(current),
    demo: current.demo,
    demoLabel: VIDEO_JOB_DEMO_LABEL,
    demoNote: VIDEO_JOB_DEMO_NOTE,
    outputNote: current.status === VIDEO_JOB_STATUSES.done ? VIDEO_JOB_DEMO_DONE_NOTE : '',
    // 成片三件套（演示队列里永远是空值）+ 一个判据：界面据此不渲染播放器、不显示任何时长。
    output: { url: '', durationSec: 0, bytes: 0 },
    hasOutput,
    playerLabel: hasOutput ? '渲染服务已给出成片' : '',
    createdAtText: formatArchiveTime(current.createdAt),
    updatedAtText: formatArchiveTime(current.updatedAt),
    startedAtText: formatArchiveTime(current.startedAt),
    finishedAtText: formatArchiveTime(current.finishedAt)
  };
}

/** 队列的视图产物（空队列也返回同形状字段；`resumedAt` 见 `videoJobResumed`）。 */
export function videoJobQueueView(list, { now = Date.now(), mockSeconds = null, resumedAt = 0 } = {}) {
  const jobs = dedupeVideoJobs(list)
    .map(job => videoJobView(job, { now, mockSeconds, resumedAt }))
    .sort((left, right) => String(right.createdAtText || '').localeCompare(String(left.createdAtText || '')) || String(right.jobKey).localeCompare(String(left.jobKey)));
  const counts = { queued: 0, rendering: 0, done: 0, failed: 0, canceled: 0 };
  jobs.forEach(job => { counts[job.status] = (counts[job.status] || 0) + 1; });
  const active = counts.queued + counts.rendering;
  const source = VIDEO_JOB_QUEUE_SOURCE_LABEL;
  const summary = jobs.length
    ? `${source}：共 ${jobs.length} 条任务（排队 ${counts.queued} · 渲染中 ${counts.rendering} · 已完成 ${counts.done} · 失败 ${counts.failed} · 已取消 ${counts.canceled}）`
    : `${source}：${VIDEO_JOB_EMPTY_TEXT}`;
  // 本次进入按 jobKey 接回来的进行中任务数（0 条时 `resumeSummary` 是空串 —— 界面不渲染空话）。
  const resumedCount = jobs.filter(job => job.resumed).length;
  return {
    jobs,
    counts,
    total: jobs.length,
    active,
    running: active > 0,
    summary,
    empty: jobs.length === 0,
    emptyText: VIDEO_JOB_EMPTY_TEXT,
    resumedCount,
    resumeSummary: videoJobResumeSummary(resumedCount),
    demoLabel: VIDEO_JOB_DEMO_LABEL,
    demoNote: VIDEO_JOB_DEMO_NOTE,
    sourceLabel: source,
    storageKey: VIDEO_JOB_STORAGE_KEY
  };
}

/**
 * 本机镜像的读取（读坏 / 空 / 非数组 → 空列表，永不抛错）—— 服务层与断言读同一份。
 */
export function loadVideoJobs() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(VIDEO_JOB_STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    return dedupeVideoJobs(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

/** 落本机镜像（配额不够时静默跳过：任务还在内存里，下一次写入再试）。 */
export function persistVideoJobs(list) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIDEO_JOB_STORAGE_KEY, JSON.stringify(dedupeVideoJobs(list)));
  } catch {
    /* 配额不够：不阻断队列推进。 */
  }
}

// ---------------------------------------------------------------------------
// ⑥ 渲染服务的接口契约（[第四步 US-213b] / FR-254 ~ FR-263）
// ---------------------------------------------------------------------------
//
// 视频渲染服务还没接进来（服务端那一半是 US-213 的事）。这一节把**前端与服务之间的契约**定死：
// 路由表、响应里的字段清单、成片三件套的判定、HTTP 状态的含义、以及「连不上时说什么」。
// `services/videoApi.js` 只做网络动作（拼 URL / fetch / 抛错），**一条业务判据都不新增**；
// 界面（US-214 起）读这里的判据与文案，分流「真服务 / 本机演示队列」，不自己写 if。

/**
 * 「服务端未接入」时**唯一**那句话（验收原文）：`services/videoApi.js` 的四个契约函数
 * （submitJob / getJob / cancelJob / retryJob）在连不上 / 路由不存在时**抛错**，消息以这句开头 ——
 * 绝不回落到本机演示队列假装这次提交成功了（那样老师会以为真在出片）。
 */
export const VIDEO_JOB_SERVICE_UNAVAILABLE_TEXT = '视频服务暂不可用：渲染服务还没接入，这里不会伪造进度、时长或成片。';

/** 统一的可读错误文案：`detail` 说清「为什么」（连不上 / 404 / 超时），消息仍以验收原文开头。 */
export function videoServiceUnavailableText(detail = '') {
  const extra = str(detail);
  return extra ? `${VIDEO_JOB_SERVICE_UNAVAILABLE_TEXT}（${extra}）` : VIDEO_JOB_SERVICE_UNAVAILABLE_TEXT;
}

/**
 * 契约点名的字段：返回的任务对象必须带全这些键 ——
 * 验收原文的 `jobKey / status / progress / outputUrl / durationSec / bytes / specSnapshot`
 * 加上 PRD 任务模型里的其余必填项（对象 / 周期 / 次数 / 失败原因）。
 */
export const VIDEO_JOB_CONTRACT_FIELDS = [
  'jobKey', 'type', 'studentId', 'classId', 'period', 'specSnapshot',
  'status', 'progress', 'attempts', 'error', 'outputUrl', 'durationSec', 'bytes'
];

/**
 * 契约里**没有**的字段（封面 / 缩略图 / 海报图）：字段白名单整个丢掉它 ——
 * 「不得返回假封面」因此在结构上成立（界面拿不到这个键，就不可能显示一张来路不明的封面）。
 */
export const VIDEO_JOB_CONTRACT_IGNORED_FIELDS = ['cover', 'coverUrl', 'coverImageUrl', 'poster', 'posterUrl', 'thumbnail', 'thumbnailUrl'];

/** 成片地址的判定（空串 = 可用）：只认 http(s) —— 本机临时地址与相对路径都不是渲染服务的成片。 */
export function videoJobOutputUrlIssue(value) {
  const url = str(value);
  if (!url) return '成片地址是空的';
  if (/^blob:/i.test(url) || /^data:/i.test(url)) return '成片地址不能是本机临时地址（blob: / data:）：那只是这个浏览器里的一个副本，不是渲染服务的成片';
  if (!/^https?:\/\//i.test(url)) return `成片地址必须是 http(s) 地址（收到「${url.slice(0, 24)}」）`;
  return '';
}

/**
 * 成片三件套**按状态分叉**的判据（空串 = 合规）——「不得返回假成片、假时长」那一句的落地：
 *  - `done`：必须有成片地址（http(s)）+ 时长（> 0）+ 体积（> 0），缺一项就判契约不成立；
 *  - 其余状态：三件套必须全空 —— 没渲染完就没有成片，客户端也不会把空壳当成品。
 */
export function videoJobRemoteOutputIssue({ status, outputUrl, durationSec, bytes } = {}) {
  const reached = normalizeVideoJobStatus(status) === VIDEO_JOB_STATUSES.done;
  const url = str(outputUrl);
  const duration = num(durationSec);
  const size = num(bytes);
  if (!reached) {
    if (!url && duration <= 0 && size <= 0) return '';
    return `${videoJobStatusLabel(status)}的任务不得携带成片地址 / 时长 / 体积：还没渲染完就没有成片，这三项只能是空值。`;
  }
  const urlIssue = videoJobOutputUrlIssue(url);
  if (urlIssue) return `任务标了已完成，但${urlIssue}。`;
  if (duration <= 0) return '任务标了已完成，但没有时长（durationSec）：不接受没有时长的「完成」。';
  if (size <= 0) return '任务标了已完成，但没有文件体积（bytes）：不接受没有体积的「完成」。';
  return '';
}

/**
 * 一条**服务端响应**是否满足契约（空串 = 成立；否则给可读原因）。
 * 判据全部对着 PRD 的任务模型：必填字段 / 状态枚举 / 进度是 0~100 的整数 / 成片三件套按状态分叉。
 * 服务层拿它当收口的闸门：不成立就抛错，**不把半条任务交给界面**（那正是「假装」的来源）。
 */
export function videoJobContractIssue(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '响应不是一个任务对象。';
  const status = str(raw.status);
  if (!VIDEO_JOB_STATUS_IDS.includes(status)) return `响应里的 status「${status || '(空)'}」不在状态机里（queued / rendering / done / failed / canceled）。`;
  const kind = normalizeVideoJobType(raw.type);
  if (!VIDEO_JOB_TYPE_IDS.includes(str(raw.type))) return `响应里的 type「${str(raw.type) || '(空)'}」不是 personal / class。`;
  if (!str(raw.jobKey)) return '响应里没有 jobKey：这条任务与哪一次提交对应，无从确认。';
  if (!raw.specSnapshot || typeof raw.specSnapshot !== 'object' || Array.isArray(raw.specSnapshot)) return '响应里没有 specSnapshot：任务指向什么必须随任务一起回来。';
  const progress = Number(raw.progress);
  if (!Number.isFinite(progress) || Math.trunc(progress) !== progress || progress < 0 || progress > 100) {
    return `响应里的 progress「${str(raw.progress) || '(空)'}」不是 0~100 的整数。`;
  }
  if (status === VIDEO_JOB_STATUSES.done && progress !== 100) return `任务标了已完成，但进度是 ${progress}%：完成即 100%，不接受对不上的读数。`;
  if (!str(raw.period)) return '响应里没有 period：没有周期就说不出这是哪一段成长记录。';
  // 对象字段按类型判（个人任务要 studentId，班级任务要 classId —— 与 `videoJobMissingFields` 同一口径）。
  const object = objectFields({ type: kind, studentId: raw.studentId, classId: raw.classId });
  if (kind === 'personal' && !object.studentId) return '个人任务必须带回 studentId。';
  if (kind === 'class' && !object.classId) return '班级任务必须带回 classId。';
  const attemptValue = str(raw.attempts);
  if (attemptValue && (!Number.isFinite(Number(raw.attempts)) || Number(raw.attempts) < 0 || Math.trunc(Number(raw.attempts)) !== Number(raw.attempts))) {
    return `响应里的 attempts「${attemptValue}」不是非负整数。`;
  }
  if (raw.error !== undefined && raw.error !== null && typeof raw.error !== 'string') return '响应里的 error 必须是字符串（没有失败原因就给空串）。';
  return videoJobRemoteOutputIssue({ status, outputUrl: raw.outputUrl, durationSec: raw.durationSec, bytes: raw.bytes });
}

/**
 * 按契约归一化一条**服务端任务**（永不抛错）：字段白名单 + 类型 / 状态归一化 + **真实的成片三件套**。
 * 与 `normalizeVideoJob` 只差一处：这里**保留**服务端给的成片三件套（`done` 时原样带回），
 * 其余状态一律清空 —— 「有成片」这件事只能来自服务端，客户端一个字节都编不出来。
 */
export function normalizeRemoteVideoJob(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const status = normalizeVideoJobStatus(source.status);
  const job = normalizeVideoJob({ ...source, demo: false });
  if (status !== VIDEO_JOB_STATUSES.done) return { ...job, outputUrl: '', durationSec: 0, bytes: 0 };
  return { ...job, outputUrl: str(source.outputUrl), durationSec: Math.max(0, num(source.durationSec)), bytes: Math.max(0, int(source.bytes)) };
}

/**
 * 渲染服务的**路由表**（契约的一部分，唯一真源）：`services/videoApi.js` 按它发请求。
 * 接口语义（服务端实现时照这份写）：
 *  - 提交 / 查询 / 取消 / 重试都返回**任务对象**（或放在 `job` 键下）；
 *  - 「没有这条任务」用 **200 + `{job: null}`** 表达，于是 404 只有一个含义：**路由不存在**；
 *  - 提交按 `jobKey` 幂等（同一键重复提交命中同一条）。
 */
export const VIDEO_JOB_SERVICE_ROUTES = {
  capability: { id: 'capability', method: 'GET', path: '/api/video/service', note: '能力探测：渲染服务在不在、队列口径是什么' },
  submit: { id: 'submit', method: 'POST', path: '/api/video/jobs', note: '提交任务（按 jobKey 幂等）' },
  job: { id: 'job', method: 'GET', path: '/api/video/jobs/:jobKey', note: '查一条任务（没有 → job: null）' },
  cancel: { id: 'cancel', method: 'POST', path: '/api/video/jobs/:jobKey/cancel', note: '取消一条任务' },
  retry: { id: 'retry', method: 'POST', path: '/api/video/jobs/:jobKey/retry', note: '重试一条任务（沿用同一个 jobKey）' }
};
export const VIDEO_JOB_SERVICE_ROUTE_IDS = Object.keys(VIDEO_JOB_SERVICE_ROUTES);

/** 路由 → 具体路径（`:jobKey` 段按百分号编码；不认识的 route / 缺 jobKey 返回空串）。 */
export function videoJobServicePath(route, jobKey = '') {
  const entry = VIDEO_JOB_SERVICE_ROUTES[str(route)];
  if (!entry) return '';
  if (!entry.path.includes(':jobKey')) return entry.path;
  const key = str(jobKey);
  return key ? entry.path.replace(':jobKey', encodeURIComponent(key)) : '';
}

/**
 * HTTP 状态 → 契约层的结论（**唯一真源**）：
 *  - `ok`：200 / 201 / 202 —— 响应体是任务对象（或 `job: null`）；
 *  - `unavailable`：404 / 405 / 501（路由没接）与 502 / 503 / 504（服务不可达）与 0（连不上）
 *    —— 一律「视频服务暂不可用」。**404 只能是路由不存在**（「没有这条任务」由 200 + job:null 表达），
 *    所以一个状态只有一个含义，不需要猜；
 *  - `rejected`：其余（400 / 403 / 409 / 500…）—— 服务在，但拒绝了这次请求，用它的可读原因。
 */
export function videoServiceStatusVerdict(status) {
  const code = int(status);
  if (code === 200 || code === 201 || code === 202) return 'ok';
  if (code === 0 || code === 404 || code === 405 || code === 501 || code === 502 || code === 503 || code === 504) return 'unavailable';
  return 'rejected';
}

/** 服务端明确回答「没有这条任务」（200 + `job: null`）时的话（`action` 是这次想做的事）。 */
export function videoJobMissingText(jobKey, action = '查看') {
  return `服务端没有 jobKey 为「${str(jobKey)}」的任务，没法${str(action) || '查看'}：这条任务可能已经被清掉，不能假装它还在。`;
}
