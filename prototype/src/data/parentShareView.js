// 家长分享页（[第四步 US-210] / F-ARCHIVE-SHARE-01）的唯一真源。
//
// 老师在第四步生成 `/p/<shareToken>` 之后，家长点开链接看到的那一页就是这里描述的：
// **课次日期 · 成品作品图 · 课堂照片 · 五维点评**（老师确认后的那一版），配上机构视觉
// （暖金 / 墨黑 / 暖白，见 `archive-enhancements.css` 的 `.parent-share-*`）。
// 本模块是**零依赖纯函数 + 常量**（只 import 同样零依赖的 data 模块），可直接 `node` 直跑断言；
// `ParentSharePage.jsx` 只渲染本模块的产物，组件里没有一句写死的文案、也没有一处状态判断。
//
// 四条硬口径（每条都有配套断言）：
//
//  ① **只有令牌可用（active）才渲染内容**。过期 / 已撤回 / 令牌不存在时，本模块连学员名都不给
//     （`contentVisible:false`、`student:''`、`artwork.url:''`、`dimensions:[]`）——
//     撤回之后还能从页面上读到孩子的名字与作品，就等于没撤回。判据只有一份：
//     `data/shareTokens.js` 的 `resolveShareToken`（家长端唯一查询入口）。
//
//  ② **正文走分享白名单**（`data/archiveShare.js` 的 `archiveSharePayload`）：
//     点评只取五维白名单维度的正文，原图、推理轨迹 id、提示词、记忆文件在结构上就进不来；
//     `archiveShareLeaks` 是配套的复核口径（本模块把它一并带出来给断言与界面读数用）。
//
//  ③ **图只认分享白名单里的 https 持久地址**。家长页的图不是随便从记录上取的：素材取自
//     `archiveSharePayload().media`（也就是归档素材记录 `record.media` 那一份白名单），
//     再逐条过 `archiveMediaView(entry, { surface:'parent' })` —— 只有 https 持久地址能显示，
//     老师本机的 data: 副本 / 还没同步的素材一律显示「图片同步中」占位，绝不出现破图（US-203 的口径）。
//     归档前的地址（`record.artworkUrl`）与成品图写回副本（`record.framedArtwork.imageUrl`）
//     **都不进分享数据**（US-208b 的口径），因此家长页也不可能把它们显示出来。
//
//  ④ **只读**。本模块不产出任何动作：没有编辑、没有删除、没有「复制链接 / 转发」这类二次复制入口
//     （`readOnly` 恒为 true，界面据此不渲染任何按钮）。家长页只呈现内容与这次打开的温和回执。
//
// 一条边界（如实写出来，不假装服务端已经有了分享接口）：原型里家长页读的是**本机的归档记录**
// （`records` 由 App 传入，来自云端读取 + 本机镜像）。同一台设备 / 同一个浏览器上，老师刚归档的
// 那一条就在里面；换一台设备打开同一条链接时内容区域会显示「内容还在同步」的占位，
// 而不是编一份假内容。

import { archiveMediaView } from './archiveMedia';
import { ARCHIVE_ABSENCE_FALLBACK_TEXT, isAbsenceRecord } from './archiveResident';
import { archiveShareLeaks, archiveSharePayload } from './archiveShare';
import { REVIEW_DIMENSION_NAMES } from './reviewDetailPanel';
import { findConsent } from './consent';
// 访问判定（[第四步 US-211]）：授权撤回 → 链接失效；家长只能看自己孩子；服务端判定优先。
// 规则本身在 `data/archiveAccess.js`（教师端与服务端读同一份口径），这里只把它的产物接进视图。
import { archiveShareAccessView } from './archiveAccess';
import { resolveShareToken, SHARE_TOKEN_PARENT_MESSAGES, SHARE_TOKEN_STATUS } from './shareTokens';

const str = value => String(value === null || value === undefined ? '' : value).trim();

/** 取图口径的 surface 标记（与 `archiveRecordMediaView` 的家长 / 云端口径同一个词）。 */
export const PARENT_SHARE_SURFACE = 'parent';

/** 机构视觉（暖金 / 墨黑 / 暖白）的文案部分：标题与副标题。 */
export const PARENT_SHARE_BRAND = Object.freeze({
  title: '昕乐绘 · 成长档案',
  tagline: '老师把这一次的成长记录分享给你。'
});

/** 页面标记（家长一眼能看出这是老师发来的只读分享，不是登录后的工作台）。 */
export const PARENT_SHARE_BADGE = '家长分享 · 只读';

/** 两种状态的开篇两句（可用 / 打不开）。「打不开」的细则仍由 `SHARE_TOKEN_PARENT_MESSAGES` 给。 */
export const PARENT_SHARE_ACTIVE_HEADLINE = '这份成长档案已经打开';
export const PARENT_SHARE_BLOCKED_HEADLINE = '分享链接暂时打不开';

/** 可用状态下的只读说明（页面唯一一句「你能做什么」：什么都不用做，慢慢看）。 */
export const PARENT_SHARE_READONLY_NOTE = '这一页是只读的：作品、课堂照片与老师确认后的点评都在下面，慢慢看就好。';

/** 打开回执（老师端看不到这句话，它是给家长看的）。 */
export const PARENT_SHARE_OPEN_RECORDED_NOTE = '这次打开已经记录下来：老师能看到这份分享有没有被打开过。';

/** 取不到成品图时的三句话：占位（还在同步）、「有照片在同步」与「干脆没有照片」，各说各的。 */
export const PARENT_SHARE_ARTWORK_EMPTY_TEXT = '这节课的作品图还在整理中，老师稍后会补上。';
export const PARENT_SHARE_PHOTO_SYNCING_TEXT = '有课堂照片还在同步，稍后重新打开就能看到。';
export const PARENT_SHARE_PHOTO_EMPTY_TEXT = '这节课没有课堂照片。';
export const PARENT_SHARE_REVIEW_EMPTY_TEXT = '老师这次没有留下点评正文。';

/** 内容不在本机时的说明（令牌可用但本机的归档记录里找不到这一条）。 */
export const PARENT_SHARE_RECORD_MISSING_TEXT = '这节课的作品与点评还没有同步到这台设备，稍后重新打开就能看到。';

/** 缺课记录的那一页：沿用成长档案里的温暖口径（老师写了就用老师写的）。 */
export const PARENT_SHARE_ABSENCE_TITLE = '这节课，我们先为孩子轻轻留下一页。';

/** 页脚（告诉家长内容从哪来、能不能转发 —— 家长页没有转发入口，转发由老师那一侧做）。 */
export const PARENT_SHARE_FOOT_NOTE = '内容由老师归档后的成长档案生成：只有装裱成品图、课堂照片与老师确认后的点评，不含原图与内部记录。';

/** 五个分区的小标题（界面只渲染它们，不自己拼文案）。 */
export const PARENT_SHARE_SECTION_TITLES = Object.freeze({
  artwork: '成品作品',
  photos: '课堂照片',
  reviews: '老师的话'
});

/** 登录 / 只读标记（断言用：家长端绝不产出动作）。 */
export const PARENT_SHARE_ACTIONS = Object.freeze([]);

/**
 * 四个状态各自的整份读数**同形状**（`{state, headline, note}` 一次给全）。
 * US-204 的纪律：界面无条件渲染视图的产物，某个状态少给一个字段就会在渲染期炸成白屏。
 *
 * `blockedReason`（[第四步 US-211]）是**访问被拦**时的那一句：令牌本身可能仍可用（链接没坏），
 * 但这次访问被服务端 / 授权撤回 / 家长范围拦下了 —— 页面照样按「打不开」渲染，只是细则换成真正的原因。
 */
export function parentShareStateView(status, message = '', blockedReason = '') {
  const state = str(status) || SHARE_TOKEN_STATUS.invalid;
  const active = !str(blockedReason) && state === SHARE_TOKEN_STATUS.active;
  return {
    state: active ? SHARE_TOKEN_STATUS.active : state,
    headline: active ? PARENT_SHARE_ACTIVE_HEADLINE : PARENT_SHARE_BLOCKED_HEADLINE,
    // 「打不开」的细则只有一份（`SHARE_TOKEN_PARENT_MESSAGES`）—— 这里不写第二套温和文案。
    note: active
      ? PARENT_SHARE_READONLY_NOTE
      : (str(blockedReason) || str(message) || SHARE_TOKEN_PARENT_MESSAGES[state] || SHARE_TOKEN_PARENT_MESSAGES[SHARE_TOKEN_STATUS.invalid])
  };
}

/**
 * 家长分享页要展示的那一条归档记录：按令牌上的**档案记录 id** 找，找不到再按 `recordKey` 找。
 * 令牌上没有可用的键（脏记录）时返回 null —— 宁可让内容区显示占位，也不猜一条记录给家长看。
 */
export function findSharedRecord(records, tokenRecord) {
  const list = Array.isArray(records) ? records : [];
  const record = tokenRecord && typeof tokenRecord === 'object' ? tokenRecord : {};
  const id = str(record.recordId);
  const key = str(record.recordKey);
  const byId = id ? list.find(item => str(item && item.id) === id) : null;
  if (byId) return byId;
  return key ? (list.find(item => str(item && item.recordKey) === key) || null) : null;
}

/** 课次日期的展签口径（`2026-09-15` / `2026/09/15` → `2026.09.15`；读不出来原样返回）。 */
export function parentShareDateText(value) {
  return str(value).replace(/[-/]/g, '.');
}

/**
 * 图区的整份视图：**每个状态同形状**。
 * 入参是分享白名单里的那一份素材（`archiveSharePayload().media`）与「记录在不在本机」；
 * 出参 `{artwork, photos, photoCount, photoTotal, photosNote, note}`：
 *  - 每条素材过 `archiveMediaView(entry, {surface:'parent'})`：https 持久地址才出 `url`，
 *    其余（data: 本地副本 / pending）给「图片同步中」占位 —— 家长页不出现破图，也不出现原图；
 *  - `photos` 每一项都带 `alt`（家长放大看 / 读屏时也知道这是哪一张）。
 */
export function parentShareMediaView({ payload = null, student = '', lessonDate = '', recordFound = false } = {}) {
  const scope = str(student) && str(lessonDate) ? `${str(student)} · ${parentShareDateText(lessonDate)}` : (str(student) || '这节课');
  const altSuffix = `${scope} 的`;
  // 记录不在本机（另一台设备打开同一条链接）：内容区给一句「还在同步」的占位，不编内容、不出破图。
  if (!recordFound) {
    return {
      artwork: { url: '', placeholder: true, placeholderText: PARENT_SHARE_RECORD_MISSING_TEXT, alt: `${altSuffix}成品作品图`, note: '' },
      photos: [],
      photoCount: 0,
      photoTotal: 0,
      photosNote: PARENT_SHARE_RECORD_MISSING_TEXT,
      note: PARENT_SHARE_RECORD_MISSING_TEXT
    };
  }
  const source = payload && typeof payload === 'object' ? payload : {};
  const media = source.media && typeof source.media === 'object' ? source.media : {};
  const artworks = Array.isArray(media.artwork) ? media.artwork : [];
  const photoEntries = Array.isArray(media.photos) ? media.photos : [];
  const entry = artworks.map(item => archiveMediaView(item, { surface: PARENT_SHARE_SURFACE }))[0] || null;
  const artwork = {
    url: entry ? entry.url : '',
    placeholder: Boolean(entry && entry.placeholder),
    placeholderText: entry ? entry.placeholderText : '',
    alt: `${altSuffix}成品作品图`,
    // 占位（图片同步中）与「干脆没有成品图」是两件事，别混成一句。
    note: entry ? (entry.url || entry.placeholder ? '' : PARENT_SHARE_ARTWORK_EMPTY_TEXT) : PARENT_SHARE_ARTWORK_EMPTY_TEXT
  };
  const photos = photoEntries.map((item, index) => {
    const view = archiveMediaView(item, { surface: PARENT_SHARE_SURFACE });
    return {
      url: view.url,
      placeholder: view.placeholder,
      placeholderText: view.placeholderText,
      alt: `${altSuffix}课堂照片 ${index + 1}`,
      caption: view.name || ''
    };
  });
  const hasPlaceholderPhoto = photos.some(photo => !photo.url);
  return {
    artwork,
    photos,
    photoCount: photos.filter(photo => photo.url).length,
    photoTotal: photos.length,
    photosNote: photos.length
      ? (hasPlaceholderPhoto ? PARENT_SHARE_PHOTO_SYNCING_TEXT : '')
      : PARENT_SHARE_PHOTO_EMPTY_TEXT,
    note: artwork.note
  };
}

/**
 * 家长分享页的整份视图（界面唯一读的产物）。
 *
 * 入参：`tokens`（App 层的令牌账）+ `token`（地址里的令牌）+ `records`（App 层的归档记录）
 * + `open`（这次打开的回执：`{found, first, recorded}`）+ 可注入的 `now`。
 *
 * 返回的字段**所有状态都给全**（同形状），其中：
 *  - `contentVisible`：只有令牌可用才为 true；为 false 时 `student / lessonDate / artwork / dimensions`
 *    一律是空值 —— 「打不开」的页面上不出现任何属于这个孩子的信息；
 *  - `payload`：`archiveSharePayload` 的产物（家长页读到的正文只从它来），`leaks`：配套的泄漏复核；
 *  - `open`：打开次数 / 首次打开时间 / 这次是不是首次 / 那一句温和的回执（界面不自己拼）。
 */
export function parentShareView({ tokens = [], token = '', records = [], open = null, now = null, origin = '', consents = null, parentScope = null, serverAccess = null } = {}) {
  const resolved = resolveShareToken(tokens, token, now);
  const tokenRecord = resolved.record;
  // 访问判定（[第四步 US-211]）：令牌可用之后还要过「服务端判定 → 授权撤回 → 家长范围」三关，
  // 任何一关拦下都不展示内容（`contentVisible` 结构性为假）。
  const consent = Array.isArray(consents)
    ? findConsent(consents, { name: str(tokenRecord && tokenRecord.student), studentId: str(tokenRecord && tokenRecord.studentId) })
    : null;
  const access = archiveShareAccessView({ tokenRecord, active: resolved.active, consent, parentScope, serverAccess });
  // 被拦下时（服务端 / 授权撤回 / 家长范围）按「打不开」渲染，细则换成真正的原因；
  // 令牌本身不可用时维持原来的四种状态文案。
  const stateView = parentShareStateView(resolved.status, resolved.message, access.allowed ? '' : access.reason);
  // 内容**只在令牌可用且访问放行时**才去取：撤回 / 过期 / 被拦下之后连记录都不查，分享数据里就只剩令牌字段。
  const contentVisible = resolved.active && access.allowed;
  const record = contentVisible ? findSharedRecord(records, tokenRecord) : null;
  const payload = archiveSharePayload({ record, token: contentVisible ? resolved.token : '', origin });
  const leaks = archiveShareLeaks({ payload, record });
  // 课次信息只在内容可见时给：不可用时连学员名 / 日期都不取（牌子上写着「打不开」，就不该再露出这个孩子）。
  // 可用但没有本机记录时仍能看到令牌上的学员与课次（那是老师转发时写过的那份），内容区给同步占位。
  const visible = contentVisible;
  const student = visible ? (payload.student || str(tokenRecord && tokenRecord.student)) : '';
  const lessonDate = visible ? (payload.lessonDate || str(tokenRecord && tokenRecord.lessonDate)) : '';
  const lessonDateText = parentShareDateText(lessonDate);
  const className = visible ? (payload.className || str(tokenRecord && tokenRecord.className)) : '';
  const title = visible ? (payload.title || str(tokenRecord && tokenRecord.title)) : '';
  const media = parentShareMediaView({ payload, student, lessonDate, recordFound: Boolean(record) });
  const dimensions = REVIEW_DIMENSION_NAMES
    .map(name => ({ name, text: str(payload.reviews[name]) }))
    .filter(row => row.text);
  const absence = Boolean(record) && isAbsenceRecord(record);
  const archivedText = record ? str(record.archivedAt) : '';
  const openCount = tokenRecord ? Number(tokenRecord.openCount) || 0 : 0;
  return {
    // 状态（四种同形状；`contentVisible` 只在令牌可用**且访问放行**时为真）
    state: stateView.state,
    status: resolved.status,
    statusLabel: resolved.statusLabel,
    found: resolved.found,
    active: resolved.active,
    contentVisible,
    // 访问判定（US-211）：被拦下时给出 `blockedBy` 与那一句原因（界面只渲染，不自己判断）
    access,
    accessAllowed: access.allowed,
    accessBlockedBy: access.blockedBy,
    accessBlockedLabel: access.blockedByLabel,
    accessReason: access.reason,
    headline: stateView.headline,
    note: stateView.note,
    // 机构视觉与标记
    brandTitle: PARENT_SHARE_BRAND.title,
    brandTagline: PARENT_SHARE_BRAND.tagline,
    badge: PARENT_SHARE_BADGE,
    sectionTitles: PARENT_SHARE_SECTION_TITLES,
    // 课次信息（不可用时全为空串 —— 「打不开」的页面上不出现孩子的任何信息）
    token: contentVisible ? resolved.token : '',
    student,
    studentLine: student ? `${student} 的成长档案` : '',
    className,
    lessonDate,
    lessonDateText,
    title,
    lessonLine: [lessonDateText, className].filter(Boolean).join(' · '),
    archivedText,
    recordFound: Boolean(record),
    recordMissingNote: contentVisible && !record ? PARENT_SHARE_RECORD_MISSING_TEXT : '',
    // 内容
    artwork: media.artwork,
    photos: media.photos,
    photoCount: media.photoCount,
    photoTotal: media.photoTotal,
    photosNote: media.photosNote,
    dimensions,
    dimensionCount: dimensions.length,
    dimensionTotal: REVIEW_DIMENSION_NAMES.length,
    reviewsNote: dimensions.length ? '' : PARENT_SHARE_REVIEW_EMPTY_TEXT,
    absence,
    absenceTitle: absence ? PARENT_SHARE_ABSENCE_TITLE : '',
    absenceText: absence ? (str(record.reviews && record.reviews.summary) || ARCHIVE_ABSENCE_FALLBACK_TEXT) : '',
    // 打开回执（这次访问）
    open: {
      count: openCount,
      first: Boolean(open && open.first),
      recorded: Boolean(open && open.recorded),
      firstOpenedAt: tokenRecord ? str(tokenRecord.firstOpenedAt) : '',
      note: PARENT_SHARE_OPEN_RECORDED_NOTE
    },
    // 只读与页脚
    readOnly: true,
    actions: PARENT_SHARE_ACTIONS,
    footNote: PARENT_SHARE_FOOT_NOTE,
    // 分享数据与复核（断言 / 界面读数用；界面只渲染上面的字段）
    payload,
    leaks
  };
}
