// 成片预览 · 下载与分享（[第四步 US-219]）的唯一真源。
//
// 「渲染服务还没接进来」这件事在**成片这一侧**要落成四件如实的事：
//
//  ① **竖屏 9:16 播放器占位**：有服务的成片才有 `src`，没有就只有一个**不设 src** 的空位 ——
//     原型里不内置任何 mp4，「不显示假 mp4」因此在结构上成立（`videoPlayerView` 的 `src` 是空串，
//     组件据此不渲染任何 `<source>`）。9:16 是口径常量（`VIDEO_PLAYER_RATIO_LABEL` / `VIDEO_PLAYER_ASPECT`）。
//  ② **下载与分享的不可用提示**：没有真成片时，两个动作各自给一句可读的「暂不可用」
//     （`VIDEO_DOWNLOAD_UNAVAILABLE_TEXT` / `VIDEO_SHARE_UNAVAILABLE_TEXT`），而不是静默什么都不做。
//  ③ **成片分享与图文分享同一套规则**：生成前的授权闸门仍是 `shareTokens.js` 的
//     `shareTokenGenerationGate`（它读 `archiveForwardView` → `data/consent.js` 那一份家长授权来源，
//     这里不写第二套授权判断），有效期仍是 `SHARE_TOKEN_DEFAULT_VALID_DAYS`（默认 30 天、可配置），
//     撤回仍走同一条 `revokeShareTokenRecord` —— 令牌只用 `kind:'video'` 区分种类，规则一条不新增。
//     班级成片按**覆盖到的每位学员**逐人过一遍同一道闸门，任一位没过就拦下并点名。
//  ④ **分享页的播放器带 `playsinline`**：家长在微信内置浏览器 / iOS Safari 里点开不跳全屏。
//     属性由 `videoPlayerView().playsInline` 给出（界面照它渲染），断言也读它。
//
// 与 `data/videoTimeline.js` 同一条纪律：**视图函数的所有状态返回同形状字段**
// （US-204 的白屏坑：某一态少给一个字段就会在渲染期炸成白屏，而 `pnpm run build` 全绿）。
// 本模块零依赖以外的 import 只有同样零依赖的数据模块，可直接 `node` 直跑断言。

import { findConsent } from './consent';
import { archiveForwardView } from './archiveSummary';
import {
  SHARE_TOKEN_DEFAULT_VALID_DAYS,
  SHARE_TOKEN_FALLBACK_BLOCK_REASON,
  SHARE_TOKEN_KINDS,
  SHARE_TOKEN_REVOKED_PHRASE,
  SHARE_TOKEN_STATUS,
  SHARE_TOKEN_STATUS_LABELS,
  SHARE_TOKEN_VALID_DAY_OPTIONS,
  createShareTokenRecord,
  formatShareTokenDate,
  isShareTokenActive,
  normalizeShareTokenKind,
  normalizeShareTokenValidDays,
  shareTokenDaysLeft,
  shareTokenGenerationGate,
  shareTokenLink,
  shareTokenPolicyText,
  shareTokenStatus,
  shareTokenValidDaysLabel
} from './shareTokens';
import {
  normalizeVideoJobType,
  videoJobOutputUrlIssue,
  videoJobStatusLabel,
  videoJobTypeLabel,
  VIDEO_JOB_DEMO_DONE_NOTE
} from './videoJobs';

const str = value => String(value === null || value === undefined ? '' : value).trim();
const num = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** 成片分享的令牌种类（写进 `share_tokens` 的 `kind`；图文分享是 `record`）。 */
export const VIDEO_SHARE_KIND = SHARE_TOKEN_KINDS.video;

/** 竖屏 9:16（成片是给手机竖屏看的）—— 播放器尺寸口径只有这一份。 */
export const VIDEO_PLAYER_RATIO_LABEL = '9:16';
export const VIDEO_PLAYER_ASPECT = 9 / 16;

/** 老师端「成片预览」这一块的标题与说明（验收点名的三件事写在这里）。 */
export const VIDEO_PREVIEW_SECTION_TITLE = '成片预览（竖屏 9:16）';
export const VIDEO_PREVIEW_SECTION_DESC = '成片由渲染服务产出：服务接入后这里就是家长看到的那一屏；服务未接入时只占一个 9:16 的位置，不显示任何假的 mp4。';

/** 播放器的三种状态文案（有真成片 / 有任务但还没成片 / 连任务都还没有）。 */
export const VIDEO_PLAYER_TITLE = '竖屏 9:16 · 播放器占位';
export const VIDEO_PLAYER_PLACEHOLDER_TEXT = '视频服务未接入：这里不显示任何假的 mp4 —— 成片只能由渲染服务产出，接入后同一条链接直接播放。';
export const VIDEO_PLAYER_NO_JOB_TEXT = '还没有视频任务：先在下面提交一条，成片产出后这里才会有画面。';
export const VIDEO_PLAYER_READY_TEXT = '成片来自渲染服务（https 持久地址）：这就是家长打开分享链接会看到的那一屏。';
export const VIDEO_MP4_POLICY_NOTE = '播放器不设 src 时不加载任何媒体：没有成片就没有画面，也不编时长、封面或下载地址。';

/** 下载与分享（服务未接入时给验收点名的那句「明确的不可用提示」）。 */
export const VIDEO_DOWNLOAD_LABEL = '下载成片';
export const VIDEO_SHARE_LABEL = '分享成片给家长';
export const VIDEO_DOWNLOAD_UNAVAILABLE_TEXT = '下载成片暂不可用：视频服务未接入，这里没有成片文件 —— 不会伪造一个 mp4 让你下载。';
export const VIDEO_SHARE_UNAVAILABLE_TEXT = '分享成片暂不可用：视频服务未接入，成片还没生成 —— 不会生成一条指向假 mp4 的分享。';
export const VIDEO_OUTPUT_UNAVAILABLE_NOTE = '成片文件（mp4）与转发：视频服务未接入，下载与分享暂不可用；下面那条分享链接的规则（授权 / 有效期 / 撤回）与图文分享一致。';
export const VIDEO_SHARE_READY_NOTE = '成片已就绪：在下面的「成片分享链接」里生成或复用链接（与图文分享同一套规则）；下载会直接取渲染服务的地址。';

/** 成片分享的规则块（与图文分享同一套，界面只渲染这些句子）。 */
export const VIDEO_SHARE_RULES_TITLE = '成片分享链接（与图文分享同一套规则）';
export const VIDEO_SHARE_RULES_NOTE = '生成前过同一道家长授权校验；有效期默认 30 天、可配置；老师可随时撤回 —— 撤回或过期后链接立即失效。';
export const VIDEO_SHARE_PAGE_NOTE = '家长打开这条链接：一个竖屏 9:16 播放器 + 这条成片的信息；视频服务未接入时播放器显示占位，不显示任何假的 mp4。';
export const VIDEO_SHARE_MISSING_JOB_NOTE = '这条成片分享还没有对应的成片（服务未接入或任务已被清掉）：播放器只显示占位。';
export const VIDEO_SHARE_NO_STUDENT_REASON = '这个周期里还没有可分享的学员：先归档一条课次，成片才有出处。';
export const VIDEO_SHARE_GENERATE_LABEL = '生成成片分享链接';
export const VIDEO_SHARE_REGENERATE_LABEL = '重新生成成片分享链接';
export const VIDEO_SHARE_GENERATED_NOTICE = '成片分享链接已生成（与图文分享同一套规则：授权校验 / 有效期 / 撤回）。';
export const VIDEO_SHARE_REVOKED_NOTICE = `成片分享已撤回：这条链接立即失效，家长再打开会看到「${SHARE_TOKEN_REVOKED_PHRASE}」。`;
export const VIDEO_SHARE_LINK_TITLE = '家长分享链接';

/** 令牌标题（这条链接指的是什么成片）。 */
export const VIDEO_SHARE_TITLES = Object.freeze({
  personal: '成长记录视频',
  class: '班级视频集锦'
});

/** 时长的可读读数（「36.5 秒」/「1 分 20 秒」；读不出来给空串）。 */
export function videoDurationText(value) {
  const seconds = num(value);
  if (seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds * 10) / 10} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
}

/** 体积的可读读数（「12.4 MB」；小于 1MB 给 KB；读不出来给空串）。 */
export function videoBytesText(value) {
  const bytes = num(value);
  if (bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * 成片三件套（地址 / 时长 / 体积）的**唯一判据**：只有
 * 「https 地址 + 正时长 + 正体积」才算渲染服务真的给了成片；缺一项就不算。
 * 演示队列的字段白名单把这三项清空（US-213a），因此演示任务永远不会走到 `ready`。
 */
export function videoOutputView(job = null) {
  const source = job && typeof job === 'object' ? job : null;
  const output = source && source.output && typeof source.output === 'object' ? source.output : {};
  const url = str(source && (source.outputUrl || output.url));
  const durationSec = source ? num(source.durationSec !== undefined ? source.durationSec : output.durationSec) : 0;
  const bytes = source ? num(source.bytes !== undefined ? source.bytes : output.bytes) : 0;
  const urlIssue = videoJobOutputUrlIssue(url);
  const ready = Boolean(url) && !urlIssue && durationSec > 0 && bytes > 0;
  return {
    ready,
    url: ready ? url : '',
    durationSec: ready ? durationSec : 0,
    bytes: ready ? bytes : 0,
    durationText: ready ? videoDurationText(durationSec) : '',
    bytesText: ready ? videoBytesText(bytes) : '',
    // 三件套不齐时的可读原因（`ready` 时为空）——界面与断言读同一份，别自己判断。
    issue: ready || !url ? '' : (urlIssue || (durationSec <= 0 ? '没有时长（durationSec）' : '没有文件体积（bytes）')),
    note: ready ? VIDEO_PLAYER_READY_TEXT : VIDEO_PLAYER_PLACEHOLDER_TEXT
  };
}

/**
 * 竖屏 9:16 播放器的整份视图：**所有状态同形状**。
 * `playsInline` 恒为真（与图文分享页一致的 mobile web 口径）；`src` 只在服务给出成片时才有值。
 */
export function videoPlayerView({ job = null } = {}) {
  const source = job && typeof job === 'object' ? job : null;
  const output = videoOutputView(source);
  const status = output.ready ? 'ready' : (source ? 'placeholder' : 'empty');
  return {
    layout: 'portrait',
    ratioLabel: VIDEO_PLAYER_RATIO_LABEL,
    aspect: VIDEO_PLAYER_ASPECT,
    playsInline: true,
    status,
    ready: output.ready,
    src: output.url,
    hasSource: Boolean(output.url),
    placeholderTitle: VIDEO_PLAYER_TITLE,
    placeholderText: output.ready ? '' : (source ? VIDEO_PLAYER_PLACEHOLDER_TEXT : VIDEO_PLAYER_NO_JOB_TEXT),
    note: output.ready ? VIDEO_PLAYER_READY_TEXT : VIDEO_MP4_POLICY_NOTE
  };
}

/** 老师端「成片预览」面板的整份视图（界面只渲染它的产物）。 */
export function videoPreviewView({ jobs = [], jobKey = '' } = {}) {
  const list = (Array.isArray(jobs) ? jobs : []).filter(job => job && typeof job === 'object');
  const key = str(jobKey);
  const job = (key ? list.find(item => str(item.jobKey) === key) : null) || list[0] || null;
  const output = videoOutputView(job);
  const player = videoPlayerView({ job });
  const rows = [
    { id: 'job', label: '成片任务', value: job ? `${videoJobTypeLabel(job.type)} · ${str(job.period) || '未记录周期'}` : '还没有任务' },
    { id: 'status', label: '任务状态', value: job ? videoJobStatusLabel(job.status) : '—' },
    { id: 'duration', label: '成片时长', value: output.durationText || '待渲染服务给出' },
    { id: 'bytes', label: '文件体积', value: output.bytesText || '待渲染服务给出' },
    { id: 'url', label: '成片地址', value: output.url || '（没有）' }
  ];
  return {
    hasJob: Boolean(job),
    jobKey: job ? str(job.jobKey) : key,
    jobType: job ? str(job.type) : '',
    jobStatus: job ? str(job.status) : '',
    output,
    player,
    rows,
    ready: output.ready,
    policyNote: VIDEO_OUTPUT_UNAVAILABLE_NOTE,
    // 两个动作（验收点名：服务未接入时给明确的不可用提示）——`enabled` 与提示文案同源。
    actions: [
      { id: 'download', label: VIDEO_DOWNLOAD_LABEL, enabled: output.ready, unavailableText: output.ready ? '' : VIDEO_DOWNLOAD_UNAVAILABLE_TEXT },
      { id: 'share', label: VIDEO_SHARE_LABEL, enabled: output.ready, unavailableText: output.ready ? '' : VIDEO_SHARE_UNAVAILABLE_TEXT }
    ],
    // 成片就绪时那句「去哪儿分享」（服务接入后的路径，界面照渲染）
    readyNote: output.ready ? VIDEO_SHARE_READY_NOTE : '',
    // 演示队列的既有实话（进度 100 也不等于有成片）——原样带上，不另写一句
    demoDoneNote: job && str(job.status) === 'done' && !output.ready ? VIDEO_JOB_DEMO_DONE_NOTE : ''
  };
}

/**
 * 成片分享的生成闸门：**与图文分享同一道校验**。
 *
 * 逐位学员走 `findConsent` → `archiveForwardView` → `shareTokenGenerationGate`
 * （`shareTokenGenerationGate` 是唯一判据，这里不写第二套授权逻辑）：
 *  - 个人成片 = 这位学员；
 *  - 班级成片 = 这个周期覆盖到的每位学员（任一位没过就拦下，并把没过的名字点名）。
 *
 * 返回 `{ allowed, rows, students, blockedNames, blockedNote, state, stateLabel, reason, entryLabel, note }`
 * —— 所有分支同形状。
 */
export function videoShareGateView({ students = [], consents = null, step = null, lessonDate = '', title = '' } = {}) {
  const names = (Array.isArray(students) ? students : []).map(str).filter(Boolean);
  const rows = names.map(name => {
    const consent = findConsent(consents, { name });
    const forward = archiveForwardView({ step, consent, student: name, lessonDate, title });
    const gate = shareTokenGenerationGate(forward);
    return { name, gate, allowed: gate.allowed, state: gate.state, stateLabel: gate.stateLabel, reason: gate.reason, entryLabel: gate.entryLabel };
  });
  const blocked = rows.filter(row => !row.allowed);
  const first = blocked[0] || rows[0] || null;
  const allowed = rows.length > 0 && blocked.length === 0;
  const blockedNote = blocked.length
    ? `${blocked.map(row => row.name).join('、')} 的家长未完成查看授权`
    : '';
  const state = allowed ? 'ready' : (first ? first.state : 'incomplete');
  const reason = allowed ? '' : (first ? (first.reason || SHARE_TOKEN_FALLBACK_BLOCK_REASON) : VIDEO_SHARE_NO_STUDENT_REASON);
  return {
    allowed,
    students: names,
    rows,
    blockedNames: blocked.map(row => row.name),
    blockedNote,
    state,
    stateLabel: allowed ? '可以生成成片分享链接' : (first ? first.stateLabel : '还不能分享'),
    reason,
    // 处理入口（「去授权管理」）原样带出来 —— 与图文分享同一个来源（`archiveForwardView`）。
    entryLabel: allowed ? '' : (first ? first.entryLabel : ''),
    note: allowed ? '' : `${VIDEO_SHARE_RULES_NOTE}（当前：${reason}）`
  };
}

/**
 * 生成成片分享令牌的**唯一入参拼装点**（身份字段与 `kind` 都在这里写一次）。
 * 图文分享走 `createShareTokenRecord` 的老路径（`kind` 默认 `record`），成片分享在这里补三件事：
 * `kind:'video'` + `jobKey`（指向哪条任务）+ `period`。
 */
export function videoShareTokenInput({ jobKey = '', type = 'personal', objectName = '', className = '', period = '', validDays = null, createdBy = '', version = 1 } = {}) {
  const kind = normalizeVideoJobType(type);
  const isClass = kind === 'class';
  const name = str(objectName);
  return {
    recordId: '',
    recordKey: '',
    kind: VIDEO_SHARE_KIND,
    jobKey: str(jobKey),
    period: str(period),
    student: isClass ? '' : name,
    studentId: '',
    className: isClass ? name : str(className),
    lessonDate: '',
    title: VIDEO_SHARE_TITLES[kind] || VIDEO_SHARE_TITLES.personal,
    version: Math.max(1, Math.trunc(num(version)) || 1),
    validDays,
    createdBy
  };
}

/** 生成一条成片分享令牌（写入侧）：规则全部走 `createShareTokenRecord`（有效期 / 到期时刻同一份算法）。 */
export function createVideoShareTokenRecord(input = {}, options = {}) {
  return createShareTokenRecord({ ...input, kind: VIDEO_SHARE_KIND }, options);
}

/** 指向某条任务（jobKey）的成片分享令牌（按生成时间倒序；`jobKey` 为空返回空列表）。 */
export function videoShareTokensOfJob(tokens, jobKey) {
  const key = str(jobKey);
  const list = Array.isArray(tokens) ? tokens : [];
  if (!key) return [];
  return list
    .map(item => (item && typeof item === 'object' ? item : null))
    .filter(item => Boolean(item) && str(item.token) && normalizeShareTokenKind(item.kind) === VIDEO_SHARE_KIND && str(item.jobKey) === key)
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const a = Date.parse(left.item.createdAt);
      const b = Date.parse(right.item.createdAt);
      if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return b - a;
      return left.index - right.index;
    })
    .map(entry => entry.item);
}

/** 这条成片当前可用的分享令牌（最新的一条 active）；没有就返回 null。 */
export function activeVideoShareToken(tokens, jobKey, now) {
  return videoShareTokensOfJob(tokens, jobKey).find(item => isShareTokenActive(item, now)) || null;
}

/**
 * 老师端「成片分享链接」块的整份视图（界面只渲染它的产物）：
 * 授权闸门（`gate`）+ 有效期（与图文分享同一份常量）+ 现有链接的状态与撤回读数。
 */
export function videoSharePanelView({ tokens = [], jobKey = '', gate = null, validDays = null, now = null } = {}) {
  const history = videoShareTokensOfJob(tokens, jobKey);
  const latest = history[0] || null;
  const active = history.find(item => isShareTokenActive(item, now)) || null;
  const shown = active || latest;
  const status = shown ? shareTokenStatus(shown, now) : SHARE_TOKEN_STATUS.invalid;
  const state = shown ? status : 'none';
  const gateView = gate && typeof gate === 'object' ? gate : {};
  const allowed = Boolean(gateView.allowed);
  const days = normalizeShareTokenValidDays(validDays);
  const expiresText = shown && shown.expiresAt
    ? (status === SHARE_TOKEN_STATUS.expired
      ? `已于 ${formatShareTokenDate(shown.expiresAt)} 过期`
      : `有效期至 ${formatShareTokenDate(shown.expiresAt)}（剩余 ${shareTokenDaysLeft(shown, now)} 天 · ${shown.validDays} 天有效期）`)
    : '';
  return {
    title: VIDEO_SHARE_RULES_TITLE,
    linkTitle: VIDEO_SHARE_LINK_TITLE,
    rulesNote: VIDEO_SHARE_RULES_NOTE,
    policyText: shareTokenPolicyText(),
    pageNote: VIDEO_SHARE_PAGE_NOTE,
    validDays: days,
    validDaysLabel: shareTokenValidDaysLabel(days),
    validDayOptions: SHARE_TOKEN_VALID_DAY_OPTIONS.map(value => ({ days: value, label: shareTokenValidDaysLabel(value) })),
    defaultValidDays: SHARE_TOKEN_DEFAULT_VALID_DAYS,
    gate: {
      allowed,
      state: str(gateView.state),
      stateLabel: str(gateView.stateLabel),
      reason: str(gateView.reason),
      entryLabel: str(gateView.entryLabel),
      blockedNote: str(gateView.blockedNote),
      note: str(gateView.note)
    },
    state,
    stateLabel: state === 'none' ? '还没有生成成片分享链接' : (SHARE_TOKEN_STATUS_LABELS[status] || ''),
    status,
    active: status === SHARE_TOKEN_STATUS.active,
    token: shown,
    tokenText: shown ? str(shown.token) : '',
    link: shown ? shareTokenLink(shown.token) : '',
    expiresText,
    revokedText: shown && shown.revokedAt ? formatShareTokenDate(shown.revokedAt) : '',
    historyCount: history.length,
    canGenerate: status !== SHARE_TOKEN_STATUS.active,
    generateLabel: state === 'none' ? VIDEO_SHARE_GENERATE_LABEL : VIDEO_SHARE_REGENERATE_LABEL,
    revokeLabel: '撤回分享',
    revokeConfirmLabel: `确认撤回（家长再打开会看到「${SHARE_TOKEN_REVOKED_PHRASE}」）`,
    generatedNotice: VIDEO_SHARE_GENERATED_NOTICE,
    revokedNotice: VIDEO_SHARE_REVOKED_NOTICE
  };
}

/**
 * 分享页上的**成片块**（家长那一侧，挂在 `parentShareView` 的 `video` 字段上）。
 *
 * 两条硬口径：
 *  - **令牌不可用（撤回 / 过期 / 打不开）时整块不出现**（`present:false`）—— 连播放器都不渲染，
 *    「撤回后链接立即失效」在成片这一侧同样成立（判据仍是 `resolveShareToken` + `archiveShareAccessView`，
 *    由调用方把 `active` 传进来）；
 *  - 只渲染**白名单字段**（类型 / 对象 / 周期 / 任务状态 / 成片三件套），不 `...job`、
 *    不带任务内部字段（specSnapshot / createdBy 之类）与任何 mp4 地址。
 */
export function videoShareBlockView({ tokenRecord = null, jobs = [], active = false } = {}) {
  const record = tokenRecord && typeof tokenRecord === 'object' ? tokenRecord : {};
  const kind = normalizeShareTokenKind(record.kind);
  const isVideo = kind === VIDEO_SHARE_KIND;
  const present = isVideo && Boolean(active);
  const jobKey = str(record.jobKey);
  const list = (Array.isArray(jobs) ? jobs : []).filter(job => job && typeof job === 'object');
  const job = present && jobKey ? (list.find(item => str(item.jobKey) === jobKey) || null) : null;
  const output = videoOutputView(job);
  const player = videoPlayerView({ job });
  const type = job ? normalizeVideoJobType(job.type) : (str(record.className) && !str(record.student) ? 'class' : 'personal');
  const objectName = str(record.student) || str(record.className);
  const title = str(record.title) || VIDEO_SHARE_TITLES[type] || VIDEO_SHARE_TITLES.personal;
  const period = str(record.period);
  const rows = present ? [
    { id: 'object', label: '成片', value: [title, objectName].filter(Boolean).join(' · ') || title },
    { id: 'period', label: '周期', value: period || '未记录周期' },
    { id: 'status', label: '成片状态', value: job ? videoJobStatusLabel(job.status) : '渲染服务未接入' },
    { id: 'duration', label: '时长', value: output.durationText || '由渲染服务给出' },
    { id: 'source', label: '来源', value: output.ready ? '渲染服务（https 持久地址）' : '渲染服务未接入（播放器只有占位）' }
  ] : [];
  return {
    present,
    isVideo,
    kind,
    jobKey,
    jobFound: Boolean(job),
    type,
    title,
    objectName,
    period,
    output,
    player,
    rows,
    missingNote: present && !output.ready ? VIDEO_SHARE_MISSING_JOB_NOTE : '',
    note: present ? VIDEO_SHARE_PAGE_NOTE : '',
    readOnly: true,
    // 家长端在这一块上没有任何动作（分享永远发生在老师那一侧）——与家长分享页的只读口径一致。
    actions: []
  };
}
