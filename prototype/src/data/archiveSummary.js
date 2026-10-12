// 第四步「归档状态 + 转发」的唯一真源（[第四步 US-204] / F-ARCHIVE-01）。
//
// 第四步只回答两件事 —— **存好了没**、**发出去了没** —— 两件事的判据都收在这一份纯模块里：
//  1. 归档摘要：学员 / 课次日期 / 作品名 / 归档时间 / 版本号 / 素材同步状态 / 点评状态
//     （验收点名的七项；`ARCHIVE_SUMMARY_FIELDS` 是顺序真源）。**没有落库记录时如实给「未完成 + 原因」**
//     （缺作品 / 缺点评 / 还没归档），绝不显示「已完成」。
//  2. 转发准备：授权闸门（家长未完成查看授权就不许转发，沿 F-CONSENT-01 的唯一来源）
//     + 将转发的分享内容清单 + 微信文案。
//
// 口径不在这里另写一套：
//  - 五维维度名读 `data/reviewDetailPanel.js` 的 `REVIEW_DIMENSION_NAMES`（与第三步的
//    `evaluateReviewArchiveGate` 同一份）；
//  - 轨迹状态读 `data/reviewTrace.js` 的枚举与文案；
//  - 授权状态读 `data/consent.js`（US-411 的同一份来源）；
//  - 素材同步状态由 `data/archiveMedia.js` 的 `archiveMediaRecordView()` 传进来，本模块只读它的结论。
//
// 组件只渲染本模块的产物（行 / 属性 / 文案），浏览器断言读同一份 —— 「摘要字段齐全」是结构性的。

import { CONSENT_STATUS_LABELS, isViewAuthorized, normalizeConsent } from './consent';
import { REVIEW_DIMENSION_NAMES } from './reviewDetailPanel';
import { REVIEW_TRACE_STATUS, REVIEW_TRACE_STATUS_LABELS } from './reviewTrace';

const text = value => String(value === null || value === undefined ? '' : value).trim();
const pad2 = value => String(value).padStart(2, '0');

/** 第四步的两种状态：已落库（archived）/ 还没有落库（incomplete）。 */
export const ARCHIVE_STEP_STATES = {
  archived: 'archived',
  incomplete: 'incomplete'
};

/** 第四步的 title（两处入口共用一句，避免各处各写一份）。 */
export const ARCHIVE_STEP_TITLE = '这一次的成长，已经被完整记录。';

/** 文案统一到「已写入成长档案」这一句上（验收第 5 条：不出现本地草稿等矛盾表述）。 */
export const ARCHIVE_STEP_STATE_LABELS = {
  [ARCHIVE_STEP_STATES.archived]: '已写入成长档案',
  [ARCHIVE_STEP_STATES.incomplete]: '还没有写入成长档案'
};

/**
 * 落库后的一句补充（家长看到的与老师这里是同一份内容）。
 * 第四步的正文那一句（统一写「已写入成长档案」，不出现「本地草稿」这类矛盾表述）在 `main.jsx`
 * 的第四步 JSX 里 —— 归档完成与「文案统一」是同一条验收，写在界面这一处最直接。
 */
export const ARCHIVE_STEP_DONE_HINT = '这条记录在成长档案与家长端是同一份内容；回第三步改点评后再次归档，会更新同一条记录而不是新增一条。';

/** 归档摘要的七项字段（顺序真源）：面板渲染、`data-archive-summary` 属性与断言都读它。 */
export const ARCHIVE_SUMMARY_FIELDS = [
  { id: 'student', label: '学员', hint: '这条档案属于哪一位孩子' },
  { id: 'lessonDate', label: '课次日期', hint: '展签与家长端都读课次日期，不取归档当天' },
  { id: 'artworkTitle', label: '作品名', hint: '老师填的作品名 → 展签作品名 → 本次课题' },
  { id: 'archivedAt', label: '归档时间', hint: '写入成长档案的时刻' },
  { id: 'version', label: '版本号', hint: '同一课次 + 同一位学员只留一条，改一次加一版' },
  { id: 'media', label: '素材同步状态', hint: '成品图与修正后的照片的持久化状态' },
  { id: 'review', label: '点评状态', hint: '五维点评与本次推理轨迹的留档情况' }
];

/** 摘要字段的 id 清单（断言用：七项缺一不可）。 */
export const ARCHIVE_SUMMARY_FIELD_IDS = ARCHIVE_SUMMARY_FIELDS.map(field => field.id);

/** 转发前的内容边界（US-208 / FR-222 的同一句话，第四步与分享弹窗共用）。 */
export const ARCHIVE_SHARE_PRIVACY_NOTE = '分享内容只包含成品素材与老师确认后的点评：不含原图、不含推理轨迹、不含内部提示词。';

/** 分享链接与二维码的口径说明（US-208a 起链接已接入：默认 30 天有效、老师可随时撤回）。 */
export const ARCHIVE_SHARE_LINK_NOTE = '分享链接与二维码由「家长分享」（F-ARCHIVE-SHARE-01）能力生成，默认 30 天有效、可随时撤回。';

/** 「去授权管理」入口文案（未授权时给出可点进去的处理入口）。 */
export const ARCHIVE_SHARE_CONSENT_ENTRY = '去授权管理';

/** 复制微信转发文案的按钮与回执文案（复制失败的兜底提示也在这里，界面不各写一份）。 */
export const ARCHIVE_SHARE_COPY_LABEL = '复制微信转发文案';
export const ARCHIVE_SHARE_COPY_DONE = '微信转发文案已复制，可以直接粘贴给家长。';
export const ARCHIVE_SHARE_COPY_FAILED = '复制没有成功：请手动选中下面的文案复制。';

/** 未授权时的可读原因（点名学生姓名，不用笼统的「无法转发」）。 */
export function archiveShareConsentReason({ student = '', consent = null } = {}) {
  const name = text(student) || '这位学员';
  const normalized = consent ? normalizeConsent(consent) : null;
  if (normalized && normalized.status === 'revoked') {
    return `${name}的家长已撤回查看授权，先恢复授权才能转发给家长。`;
  }
  if (normalized && !normalized.guardianName) {
    return `${name}的家长还没有完成查看授权，先完成授权才能转发给家长。`;
  }
  return `${name}的家长还没有完成查看授权，先完成授权才能转发给家长。`;
}

/** ISO 时间 → 「2026-10-12 09:45」（归档时间读数；缺值给空串，界面自己决定占位）。 */
export function formatArchiveTime(value) {
  const source = text(value);
  if (!source) return '';
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return source;
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())} ${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
}

/** 版本号读数：「第 1 版」（脏数据回落第 1 版，永不抛错）。 */
export function archiveVersionLabel(version) {
  const num = Math.trunc(Number(version));
  return `第 ${Number.isFinite(num) && num > 0 ? num : 1} 版`;
}

/**
 * 点评状态（摘要第 7 项）：五维里写了几维 + 本次推理轨迹的留档情况。
 * 班级反馈的正文来自课程目标模板（与第三步的强校验口径一致：它只要求「已生成」），
 * 因此按「这条记录是否已经落库」判定 —— 落库即代表这一次的班级点评已确认（归档前置校验保证过），
 * 没有落库时如实写「待确认」，不替老师声称已确认。
 */
export function archiveReviewStatus({ mode = '', reviews = null, traceId = '', traceStatus = '', archived = false } = {}) {
  const source = reviews && typeof reviews === 'object' ? reviews : {};
  const written = REVIEW_DIMENSION_NAMES.filter(name => text(source[name])).length;
  const classMode = text(mode) === '班级反馈';
  const hasContent = classMode ? archived === true : written === REVIEW_DIMENSION_NAMES.length;
  const value = classMode
    ? (archived === true
      ? (written > 0 ? `班级课程点评已确认（${written} 段正文）` : '班级课程点评已确认（按课程设计随档案发布）')
      : '班级课程点评待确认')
    : (written === REVIEW_DIMENSION_NAMES.length
      ? `五维点评已确认（${written}/${REVIEW_DIMENSION_NAMES.length} 维）`
      : `五维点评还差 ${REVIEW_DIMENSION_NAMES.length - written} 维（${written}/${REVIEW_DIMENSION_NAMES.length} 维）`);
  const statusKey = text(traceStatus);
  const known = Object.values(REVIEW_TRACE_STATUS).includes(statusKey);
  const detail = text(traceId)
    ? `推理轨迹已留档（${known ? REVIEW_TRACE_STATUS_LABELS[statusKey] : '成功'}）`
    : '推理轨迹未留档';
  return { value, detail, written, hasContent, traceArchived: Boolean(text(traceId)) };
}

/**
 * 第四步的整份视图（摘要 + 未完成原因）。
 *
 * 入参：
 *  - `record`：**已经落库的那条档案记录**（`currentRecordId` 命中的那一条）。没有它 = 还没归档；
 *  - `fallback`：本次会话的上下文（未归档时用来给「缺什么」的具体原因）；
 *  - `media`：`archiveMediaRecordView()` 的产物（素材同步状态，可选）；
 *  - `trace`：`{ status }`，本次会话最后一条收束轨迹的状态（可选）。
 *
 * 返回 `{ state, stateLabel, headline, note, hint, rows, missing, warnings, blockers, reasonText }`：
 *  - `rows` 永远按 `ARCHIVE_SUMMARY_FIELDS` 七项给全（`ok` = 这一项正不正常，`blocking` = 缺了它算不算摘要不全）；
 *  - `missing` = 没齐的**必填**字段 id（素材同步状态不在其中：它不阻断归档，只进 `warnings`）；
 *  - `blockers`（只在未归档时有内容）= 「为什么还不能归档」的可读原因 id；`reasonText` 是第一条可读原因。
 */
export function archiveStepView({ record = null, fallback = {}, media = null, trace = null } = {}) {
  const source = record && typeof record === 'object' ? record : null;
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const student = source ? text(source.student) : text(fallbackSource.student);
  const studentId = source ? text(source.studentId) : text(fallbackSource.studentId);
  const lessonDate = source ? (text(source.lessonDate) || text(source.date)) : text(fallbackSource.lessonDate);
  const artworkTitle = source ? text(source.title) : text(fallbackSource.artworkTitle);
  const archivedAt = source ? text(source.archivedAt) : '';
  const mediaStatus = media && typeof media === 'object' ? text(media.status) : '';
  const mediaLabel = media && typeof media === 'object' ? text(media.statusLabel) : '';
  const review = archiveReviewStatus({
    mode: source ? source.mode : fallbackSource.mode,
    reviews: source ? source.reviews : null,
    traceId: source ? source.reviewTraceId : '',
    traceStatus: trace && typeof trace === 'object' ? trace.status : '',
    // 班级反馈的「已确认」判据 = 这条记录已经落库（归档前置校验保证过「本次点评已生成」）。
    archived: Boolean(source)
  });

  if (!source) {
    // 未归档：如实给未完成状态与**具体原因**（缺作品 / 缺点评 / 还没点归档），不显示「已完成」。
    const blockers = [];
    if (!fallbackSource.hasArtwork) blockers.push({ id: 'artwork', reason: '本次还没有可归档的作品：先在第一步上传并等待作品处理完成。' });
    if (!fallbackSource.reviewGenerated) blockers.push({ id: 'review', reason: '点评还没有生成成功：先在第三步生成五维点评。' });
    const blockerIds = blockers.map(item => item.id);
    return {
      state: ARCHIVE_STEP_STATES.incomplete,
      stateLabel: ARCHIVE_STEP_STATE_LABELS[ARCHIVE_STEP_STATES.incomplete],
      headline: '这份课后反馈还没有写入成长档案。',
      note: blockers.length
        ? `还没有写入成长档案：${blockers.map(item => item.reason).join('；')}`
        : '还没有写入成长档案：回到「五维点评」点一次「归档并生成分享」，这里就会显示归档摘要。',
      hint: '',
      rows: ARCHIVE_SUMMARY_FIELDS.map(field => ({
        id: field.id,
        label: field.label,
        hint: field.hint,
        value: field.id === 'student' ? (student || '未选择学员')
          : field.id === 'lessonDate' ? (lessonDate || '未选择课次日期')
            : field.id === 'artworkTitle' ? (artworkTitle || '—')
              : '待补',
        detail: '',
        ok: false,
        blocking: true
      })),
      reasonText: blockers.length
        ? blockers[0].reason
        : '还没有写入成长档案：点「返回修改点评」回到第三步，再点「归档并生成分享」。',
      // `missing` / `blockers` 两种状态同形状（界面与断言读同一组字段，少一个字段会在渲染期炸成白屏 ——
      // 本轮真踩：字段只在一侧给，JSX 里的 `.join` 读到 undefined）。未归档时七项都还没着落，
      // `blockers` 才是「为什么还不能归档」的那几条可读原因。
      missing: ARCHIVE_SUMMARY_FIELD_IDS,
      blockers: blockerIds,
      warnings: [],
      media: { status: mediaStatus, label: mediaLabel, text: text(media?.text) },
      review
    };
  }

  const mediaOk = mediaStatus === 'synced';
  // 每行除了 `ok`（这一项正不正常）还带 `blocking`（缺了它算不算「摘要不全」）：
  // **素材同步状态不阻断归档**（US-203 的口径：对象存储未接入时只是降级为本地留存），
  // 所以它只影响这一行的显示与 `warnings`，不进 `missing` —— 否则「已归档」会被误判成缺项。
  const rows = [
    { id: 'student', label: '学员', hint: ARCHIVE_SUMMARY_FIELDS[0].hint, value: student || '未记录学员', detail: studentId ? `学员编号 ${studentId}` : '', ok: Boolean(student), blocking: true },
    { id: 'lessonDate', label: '课次日期', hint: ARCHIVE_SUMMARY_FIELDS[1].hint, value: lessonDate || '未记录课次日期', detail: text(source.date) && text(source.date) !== lessonDate ? `档案日期 ${text(source.date)}` : '', ok: Boolean(lessonDate), blocking: true },
    { id: 'artworkTitle', label: '作品名', hint: ARCHIVE_SUMMARY_FIELDS[2].hint, value: artworkTitle || '—', detail: '', ok: Boolean(artworkTitle), blocking: true },
    { id: 'archivedAt', label: '归档时间', hint: ARCHIVE_SUMMARY_FIELDS[3].hint, value: formatArchiveTime(archivedAt) || '未记录归档时间', detail: text(source.updatedAt) && text(source.updatedAt) !== archivedAt ? `最近更新 ${formatArchiveTime(source.updatedAt)}` : '', ok: Boolean(archivedAt), blocking: true },
    { id: 'version', label: '版本号', hint: ARCHIVE_SUMMARY_FIELDS[4].hint, value: archiveVersionLabel(source.version), detail: '', ok: true, blocking: false },
    { id: 'media', label: '素材同步状态', hint: ARCHIVE_SUMMARY_FIELDS[5].hint, value: mediaLabel || '暂无素材', detail: text(media?.text), ok: mediaOk, blocking: false },
    { id: 'review', label: '点评状态', hint: ARCHIVE_SUMMARY_FIELDS[6].hint, value: review.value, detail: review.detail, ok: review.hasContent, blocking: true }
  ];
  const missing = rows.filter(row => row.blocking && !row.ok);
  const warnings = rows.filter(row => !row.blocking && !row.ok);
  return {
    state: ARCHIVE_STEP_STATES.archived,
    stateLabel: ARCHIVE_STEP_STATE_LABELS[ARCHIVE_STEP_STATES.archived],
    headline: ARCHIVE_STEP_TITLE,
    // 正文那一句统一写「已写入成长档案」，落在第四步的 JSX 里（`ARCHIVE_STEP_DONE_HINT` 是补充说明）。
    note: '',
    hint: ARCHIVE_STEP_DONE_HINT,
    rows,
    missing: missing.map(row => row.id),
    warnings: warnings.map(row => row.id),
    reasonText: missing.length ? `${missing[0].label}还没齐：${missing[0].value}` : '',
    media: { status: mediaStatus, label: mediaLabel, text: text(media?.text) },
    review
  };
}

/** 微信转发文案：含学员名与课次日期，不含任何联系方式（US-208 的同一口径，第四步先给可复制的文案）。 */
export function archiveWechatCopyText({ student = '', lessonDate = '', title = '' } = {}) {
  const name = text(student) || '孩子';
  const date = text(lessonDate);
  const work = text(title);
  const parts = [`${name}${date ? ` ${date}` : ''} 的课后反馈已写入成长档案。`];
  parts.push(work ? `作品《${work}》与老师这次的点评都在里面，您随时可以回看。` : '作品与老师这次的点评都在里面，您随时可以回看。');
  return parts.join('');
}

/**
 * 转发前的准备视图（第四步「转发给家长」面板）：授权闸门 + 分享内容清单 + 微信文案。
 *
 * 三种状态：
 *  - `incomplete`：还没归档 → 先归档（原因读 `archiveStepView`）；
 *  - `blocked`：家长未完成查看授权 → 阻止转发并给出「去授权管理」入口（照 US-208 第 3 条）；
 *  - `ready`：可以转发（内容清单 + 微信文案）。
 */
export function archiveForwardView({ step = null, consent = null, student = '', lessonDate = '', title = '' } = {}) {
  const view = step && typeof step === 'object' ? step : {};
  const archived = view.state === ARCHIVE_STEP_STATES.archived;
  const name = text(student) || '这位学员';
  const date = text(lessonDate);
  const work = text(title);
  if (!archived) {
    return {
      state: 'incomplete',
      stateLabel: '还不能转发',
      reason: text(view.reasonText) || '这份课后反馈还没有写入成长档案，先归档再转发给家长。',
      entryLabel: '',
      contentRows: [],
      wechatText: '',
      privacyNote: ARCHIVE_SHARE_PRIVACY_NOTE,
      linkNote: ARCHIVE_SHARE_LINK_NOTE
    };
  }
  if (!isViewAuthorized(consent)) {
    return {
      state: 'blocked',
      stateLabel: '家长未完成查看授权',
      reason: archiveShareConsentReason({ student: name, consent }),
      consentLabel: consent ? (CONSENT_STATUS_LABELS[normalizeConsent(consent).status] || '未登记授权') : '未登记授权',
      entryLabel: ARCHIVE_SHARE_CONSENT_ENTRY,
      contentRows: [],
      wechatText: '',
      privacyNote: ARCHIVE_SHARE_PRIVACY_NOTE,
      linkNote: ARCHIVE_SHARE_LINK_NOTE
    };
  }
  const mediaRow = (view.rows || []).find(row => row.id === 'media');
  const reviewRow = (view.rows || []).find(row => row.id === 'review');
  return {
    state: 'ready',
    stateLabel: '可以转发给家长',
    reason: '',
    consentLabel: CONSENT_STATUS_LABELS[normalizeConsent(consent).status],
    entryLabel: '',
    contentRows: [
      { id: 'subject', label: '转发对象', value: `${name} 的家长` },
      { id: 'lesson', label: '本次课次', value: date ? `${date}${work ? ` · 《${work}》` : ''}` : (work || '未记录课次日期') },
      { id: 'media', label: '成品素材', value: mediaRow ? mediaRow.value : '暂无素材', detail: mediaRow ? mediaRow.detail : '' },
      { id: 'review', label: '点评', value: reviewRow ? reviewRow.value : '', detail: reviewRow ? reviewRow.detail : '' }
    ],
    wechatText: archiveWechatCopyText({ student: name, lessonDate: date, title: work }),
    privacyNote: ARCHIVE_SHARE_PRIVACY_NOTE,
    linkNote: ARCHIVE_SHARE_LINK_NOTE
  };
}
