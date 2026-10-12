import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Clapperboard, Download, FileText, Frame, Gauge, Image, Link2, Loader2, MessageSquareText, Plus, RefreshCw, Sparkles, Trash2, XCircle } from 'lucide-react';
// 档案页的「常驻视图」（[第四步 US-206]）：
//  - 对象 / 周期 / 缺课筛选的**可选项、默认选中、过滤、空态**在 `data/archiveTargets.js` 与
//    `data/archiveResident.js` 两份零依赖模块里，组件只渲染它们的产物（一个名字都不写死）；
//  - 「进页面先看到内容」靠的是**没有生成步骤**：概况 + 时间线在组件 body 里无条件算出来，
//    只有数据源还在读 / 读失败 / 真的一条都没有时才渲染状态面板（US-206 第 1、5 条）。
//  - 「切换只过滤不重置内容」：学员 / 班级 / 周期 / 缺课筛选都只改筛选 state，
//    时间线、概况、空态当场跟着换，周期与已选对象一律保留。
// 阶段报告（[第四步 US-207a]）：键（对象 + 周期 + 类型）、快照、版本与历史、落库状态全在
// `data/archiveReports.js`（零依赖纯函数）里，这一页只渲染它的产物 + 把结果写进 `archiveReports`。
// 报告正文（[第四步 US-207b]）：阶段总结 / 雷达维度 / 点评原文同样是那一份快照聚合出的产物
// （`digest` / `radar` / `review`），组件里没有一句写死的示例文案，数据不足的维度如实显示「本阶段数据不足」。
import { loadStudentManagement } from './data/studentManagement';
import {
  ARCHIVE_PERIOD_DEFAULT,
  ARCHIVE_PERIOD_FILTER_DEFAULT,
  ARCHIVE_PERIOD_FILTERS,
  ARCHIVE_PERIODS,
  ARCHIVE_TARGET_CLASS,
  ARCHIVE_TARGET_PERSONAL,
  archiveTargetLists,
  archiveTargetOptions,
  filterArchiveRecordsByPeriod,
  resolveArchivePeriod,
  resolveArchiveTargetValue
} from './data/archiveTargets';
import {
  ARCHIVE_ABSENCE_ALL,
  ARCHIVE_ABSENCE_FILTERS,
  ARCHIVE_ABSENCE_ONLY,
  ARCHIVE_RESIDENT_LOCAL_NOTE,
  ARCHIVE_RESIDENT_STATES,
  ARCHIVE_TIMELINE_DESC,
  ARCHIVE_TIMELINE_TITLE,
  archiveLessonEntry,
  archiveResidentPhase,
  archiveResidentStateView,
  archiveResidentView
} from './data/archiveResident';
import { archiveVersionLabel } from './data/archiveSummary';
// 移动端与性能（[第四步 US-212]）：分页窗口 / 首屏预算 / 滚动帧率 / 缩略图四项规则在
// `data/archivePerformance.js`（零依赖纯函数），浏览器侧的执行（缩略图、首屏计时、滚动采帧）
// 在 `services/archivePerformance.js`。这一页只渲染它们的产物，不自己写阈值。
import {
  ARCHIVE_LAZY_ROOT_MARGIN,
  ARCHIVE_PERF_HINT,
  ARCHIVE_THUMB_MAX_EDGE,
  archivePerformanceChecks,
  archiveTimelineWindow,
  archiveWindowEntries
} from './data/archivePerformance';
import { archiveThumbnailQueue, createArchiveScrollProbe, nextFrame, nowMs } from './services/archivePerformance';
import {
  ARCHIVE_REPORT_DELETE_CANCEL_LABEL,
  ARCHIVE_REPORT_DELETE_CONFIRM_LABEL,
  ARCHIVE_REPORT_DELETE_LABEL,
  ARCHIVE_REPORT_DELETE_NOTE,
  ARCHIVE_REPORT_DELETE_DONE,
  ARCHIVE_REPORT_EMPTY_TEXT,
  ARCHIVE_REPORT_HISTORY_BACK,
  ARCHIVE_REPORT_HISTORY_EMPTY,
  ARCHIVE_REPORT_HISTORY_NOTE,
  ARCHIVE_REPORT_HISTORY_TITLE,
  ARCHIVE_REPORT_HISTORY_VIEW,
  ARCHIVE_REPORT_LESSON_TITLE,
  ARCHIVE_REPORT_LOCAL_NOTE,
  ARCHIVE_REPORT_SECTION_DESC,
  ARCHIVE_REPORT_SECTION_TITLE,
  ARCHIVE_REPORT_STATUSES,
  ARCHIVE_REPORT_STALE_HINT,
  ARCHIVE_REPORT_TYPE_DEFAULT,
  ARCHIVE_REPORT_TYPE_OPTIONS,
  ARCHIVE_REPORT_TYPES,
  archiveReportAction,
  archiveReportActionLabel,
  archiveReportDefaultSelection,
  archiveReportGenerateIssue,
  archiveReportKey,
  archiveReportStale,
  archiveReportVersionLabel,
  archiveReportView,
  buildArchiveReportSnapshot,
  createArchiveReport,
  findArchiveReport,
  applyArchiveReport,
  removeArchiveReport,
  setArchiveReportStatus,
  updateArchiveReport
} from './data/archiveReports';
import { deleteRemoteArchiveReport, saveRemoteArchiveReport } from './services/archiveReportsApi';
// 审计日志的动作键（[第四步 US-211]）：报告生成 / 更新也要留痕（操作人 / 时间 / 对象 / 版本）。
import { AUDIT_ACTIONS, auditEntryMissingFields, auditTraceText, latestAuditEntry } from './data/auditLog';
// 视频任务（[第四步 US-213a] / US-214）：任务模型 / 状态机 / jobKey 幂等 / 演示推进 / 文案全在
// `data/videoJobs.js`（零依赖纯函数），落地与定时推演在 `services/videoJobQueue.js`。
// 这一页只渲染视图产物 —— 图表、按钮与「演示数据 · 视频服务未接入」那句话都从数据层来。
// US-214 起另有三件事也读数据层：生成入口的文案（`VIDEO_JOB_SUBMIT_LABEL`）、
// 「预估剩余时间」（`videoJobEtaView`，明写「不是成片时长」）、
// 「离开页面后按 jobKey 恢复」的判定（`videoJobQueueView` 的 `resumedAt` / `resumedCount`）。
import {
  VIDEO_JOB_DEMO_LABEL,
  VIDEO_JOB_ETA_LABEL,
  VIDEO_JOB_SECTION_DESC,
  VIDEO_JOB_SECTION_TITLE,
  VIDEO_JOB_SERVICE_UNAVAILABLE_TEXT,
  VIDEO_JOB_SIMULATE_ERROR_DEFAULT,
  VIDEO_JOB_SIMULATE_ERROR_OPTIONS,
  VIDEO_JOB_STATUSES,
  VIDEO_JOB_SUBMIT_LABEL,
  VIDEO_JOB_SUBMIT_NOTE,
  VIDEO_JOB_TYPES,
  loadVideoJobs,
  videoJobErrorText,
  videoJobKey,
  videoJobQueueView,
  videoJobSpecSnapshot,
  videoJobSubmitIssue
} from './data/videoJobs';
// 移动端与弱网（[第四步 US-224]）：四条验收（提交可离开页面 / 占位竖屏可全屏 / 弱网不重复建任务 /
// 390px 不溢出）的规则与文案全在 `data/videoMobile.js`，浏览器侧的执行（全屏 API 包装、
// 播放器盒子与逐块溢出的测量、视口变化监听）在 `services/videoMobile.js`。
// 这一页只渲染它们的产物 —— 组件不自己判「溢出了没有」、也不自己写全屏文案。
import {
  VIDEO_JOB_SUBMIT_LOCK_MS,
  VIDEO_JOB_SUBMIT_LOCK_TEXT,
  VIDEO_MOBILE_SECTION_DESC,
  VIDEO_MOBILE_SECTION_TITLE,
  VIDEO_PLAYER_EXIT_FULLSCREEN_LABEL,
  VIDEO_PLAYER_FULLSCREEN_LABEL,
  VIDEO_PLAYER_FULLSCREEN_NOTE,
  VIDEO_PLAYER_FULLSCREEN_UNSUPPORTED_TEXT,
  VIDEO_PLAYER_RATIO_LABEL,
  videoJobVisibilityResumeNote,
  videoMobileView,
  videoPlayerFit
} from './data/videoMobile';
import {
  cancelVideoJob,
  discardVideoJob,
  listVideoJobs,
  recordVideoJobMusicDisposition,
  resumeVideoJobQueue,
  retryVideoJob,
  submitVideoJob,
  subscribeVideoJobs,
  attachVideoJobVisibilityResume
} from './services/videoJobQueue';
import {
  attachVideoLayoutWatch,
  exitVideoFullscreen,
  measureVideoOverflow,
  measureVideoPlayerBox,
  requestVideoFullscreen,
  subscribeVideoFullscreen,
  videoFullscreenElement,
  videoFullscreenSupported
} from './services/videoMobile';
// 真实渲染服务的契约层（[第四步 US-213b]）：只用来**探测服务在不在**并如实显示。
// 演示队列（上面那份）与真服务是两件事：探测不可用时，这里显示契约层抛出的原文，
// 队列本身仍然明确标注为「演示数据 · 视频服务未接入」。
import { probeVideoService } from './services/videoApi';
// 成片内容规则与帧清单（[第四步 US-215]）：帧序规则 / 字幕口径 / 内容边界全在
// `data/videoTimeline.js`（零依赖纯函数）。这一页只渲染它的产物 —— 帧的起止、时长、
// 字幕说明与「只出清单不出片」那一句都是数据层给的，组件不自己算时长、也不自己拼字幕。
import {
  VIDEO_ENDING_NOTE_MAX_CHARS,
  VIDEO_FRAME_KINDS,
  VIDEO_TIMELINE_SECTION_DESC,
  VIDEO_TIMELINE_SECTION_TITLE,
  videoTimelinePlan,
  videoTimelineShareReady,
  videoTimelineView
} from './data/videoTimeline';
// 时长上限与自动精选（[第四步 US-216]）：两个上限（个人 120 秒 / 班级 300 秒）、超出时的
// 均匀取样（首末两幅必留）、班级的「每人至少 1 幅 + 按作品数比例」配额与手动排除后的重算
// 全在 `data/videoSelection.js`（零依赖纯函数）。这一页只渲染它的产物 ——
// 收录清单、被舍弃的作品与预估时长都从数据层来，组件不自己算时长。
import {
  VIDEO_SELECTION_QUOTA_NOTE,
  VIDEO_SELECTION_SECTION_DESC,
  VIDEO_SELECTION_SECTION_TITLE,
  videoSelectionEntryKey,
  videoSelectionPlan,
  videoSelectionView
} from './data/videoSelection';
// 背景音乐选用与版权闸门（[第四步 US-221] / F-ARCHIVE-MUSIC-02 / FR-294 ~ FR-300）：能选的曲目
// （只有已确认授权且未过期）、静音默认值、成片记录里的授权凭证快照、到期提示与处置、混音参数
// 全在 `data/musicSelection.js`（零依赖纯函数，判据复用管理端的 `musicTrackAvailability`）。
// 这一页只渲染它的产物 —— 组件不自己判 `licenseStatus`、也不自己拼淡入淡出数字。
import {
  MUSIC_LICENSE_EXPIRED_NOTICE,
  MUSIC_MIX_SECTION_TITLE,
  MUSIC_MUTE_TITLE,
  MUSIC_RECORD_TITLE,
  MUSIC_RESUBMIT_KEEPS_RECORD_NOTE,
  MUSIC_SELECTION_SECTION_DESC,
  MUSIC_SELECTION_SECTION_TITLE,
  MUSIC_SELECTION_TITLE,
  applyMusicDisposition,
  musicDispositionRecord,
  musicJobMusicDiffers,
  musicJobMusicFromSelection,
  musicSelectionDefault,
  musicSelectionFromJobMusic,
  musicSelectionMuted,
  musicSelectionPick,
  musicSelectionView
} from './data/musicSelection';
// 个人成长视频时间线（[第四步 US-217] / [第四步到第一步联通] US-087）：按课次日期 + 课时序号升序串联 /
// 缺课 1.5 秒留白卡 / 片头写学员与周期 /
// 成片信息（推算值带「预估」）/ 学员隔离全在 `data/videoPersonal.js`（零依赖纯函数）。
// 这一页只渲染它的产物 —— 卡片文案、留白卡时长、「预估」两个字与收录范围读数都是数据层给的。
import {
  VIDEO_PERSONAL_SECTION_DESC,
  VIDEO_PERSONAL_SECTION_TITLE,
  videoPersonalPlan,
  videoPersonalView
} from './data/videoPersonal';
// 班级视频集锦按学员分段（[第四步 US-218]）：分段（每位学员一段）/ 段首 1.5 秒姓名卡（姓名 + 作品数）/
// 顺序默认按班级名单且生成前可调整 / 本期无作品保留留白卡 / 全班串成一条且总时长不超过 5 分钟全在
// `data/videoClass.js`（零依赖纯函数）。这一页只渲染它的产物 —— 卡片文案、分段读数、
// 「不串档」判据与顺序调整都是数据层给的（组件不自己算时长、也不自己拼字符串）。
import {
  VIDEO_CLASS_MOVE_DOWN_LABEL,
  VIDEO_CLASS_MOVE_UP_LABEL,
  VIDEO_CLASS_ORDER_RESET_LABEL,
  VIDEO_CLASS_SECTION_DESC,
  VIDEO_CLASS_SECTION_TITLE,
  videoClassMoveOrder,
  videoClassPlan,
  videoClassView
} from './data/videoClass';
// 机构名（帧清单的片头与片尾都要写它，与装裱叠加元素的变量同一份来源）；
// `loadLessons` 读本机课次镜像（[第四步到第一步联通] US-087）：老归档记录只有 lessonId 时靠它补
// 课时序号，视频时间线按「课次日期 + 课时序号」才排得出补录的历史课次。
import { DEFAULT_ORG_NAME, loadLessons } from './data/lessons';
// 成片预览 · 下载与分享（[第四步 US-219]）：三件事的规则与文案全在 `data/videoShare.js`
// （零依赖纯函数）—— ① 竖屏 9:16 播放器占位（服务未接入时不显示任何假 mp4）；
// ② 下载与分享的「暂不可用」提示；③ 成片分享链接（**与图文分享同一套规则**：授权闸门 / 有效期 / 撤回）。
// 令牌本体仍是 `data/shareTokens.js` 那一份（只用 `kind:'video'` 区分种类），这里不写第二套判定。
import {
  VIDEO_DOWNLOAD_LABEL,
  VIDEO_PREVIEW_SECTION_DESC,
  VIDEO_PREVIEW_SECTION_TITLE,
  VIDEO_SHARE_LABEL,
  createVideoShareTokenRecord,
  videoPreviewView,
  videoShareGateView,
  videoSharePanelView,
  videoShareTokenInput
} from './data/videoShare';
import {
  SHARE_TOKEN_DEFAULT_VALID_DAYS,
  appendShareToken,
  replaceShareToken,
  revokeShareTokenRecord,
  shareTokenLink
} from './data/shareTokens';
import { revokeRemoteShareToken, saveRemoteShareToken } from './services/shareTokensApi';
// 班级集体海报（[海报 US-305] / FR-315、FR-321、FR-322）：格子 / 顺序 / 分批 / 占位的规则全在
// `data/posterClass.js`（零依赖纯函数，可 node 直跑断言），渲染与下载在 `services/posterClass.js`
// （预览 1×、导出 2×，同一个 `renderPoster`；分批导出逐批重建 plan）。这一页只渲染它们的产物。
import {
  POSTER_CLASS_BATCH_EXPORT_LABEL,
  POSTER_CLASS_CAPTION_TOGGLE_LABEL,
  POSTER_CLASS_DEFAULT_PERIOD,
  POSTER_CLASS_NO_ARTWORK_TEXT,
  POSTER_CLASS_ORDER_MOVE_DOWN_LABEL,
  POSTER_CLASS_ORDER_MOVE_UP_LABEL,
  POSTER_CLASS_ORDER_NOTE,
  POSTER_CLASS_ORDER_RESET_DONE,
  POSTER_CLASS_ORDER_RESET_LABEL,
  POSTER_CLASS_PERIOD_OPTIONS,
  POSTER_CLASS_UNNAMED_TEXT,
  buildPosterClassPlan,
  posterClassExportGate,
  posterClassMoveOrder
} from './data/posterClass';
import {
  POSTER_CLASS_PREVIEW_SCALE,
  POSTER_CLASS_RENDER_FAILED_TEXT,
  createPosterClassUrl,
  exportPosterClassBatches,
  exportPosterClassPng,
  releasePosterClassUrl,
  renderPosterClass
} from './services/posterClass';
import { POSTER_SINGLE_SHARE_PENDING_TEXT } from './data/posterSingle';
// 成长报告长图海报（[海报 US-307] / FR-317、FR-326）：竖向分段、高度按内容自适应、单边上限保护与
// 「先降 DPI、再分段出多张」的降级顺序、预计高度与预计文件大小全在 `data/posterReportLong.js`
// （零依赖纯函数，可 node 直跑断言），渲染与下载在 `services/posterReportLong.js`
// （预览 / 每一张都是同一个 `renderPoster`，倍数读数据层的降级结论）。这一页只渲染它们的产物。
import {
  POSTER_REPORT_DEFAULT_PERIOD,
  POSTER_REPORT_EXPORT_BLOCKED_TITLE,
  POSTER_REPORT_EMPTY_TITLE,
  POSTER_REPORT_PERIOD_OPTIONS,
  buildPosterReportLongPlan,
  posterReportExportGate
} from './data/posterReportLong';
import {
  POSTER_REPORT_PREVIEW_SCALE,
  POSTER_REPORT_RENDER_FAILED_TEXT,
  createPosterReportUrl,
  exportPosterReportPages,
  exportPosterReportPng,
  releasePosterReportUrl,
  renderPosterReport
} from './services/posterReportLong';
// 成长视频封面海报（[海报 US-306] / FR-316、FR-323、FR-345）：画布比例、四条叠加件、时长角标与
// 成片状态的联动、导出门全在 `data/posterVideoCover.js`（零依赖纯函数，可 node 直跑断言），
// 渲染与下载在 `services/posterVideoCover.js`（预览 1×、导出 2×，同一个 `renderPoster`）。
// 这一页只渲染它们的产物 —— 组件不自己判「视频生成了没」，也不自己拼占位文案。
import {
  POSTER_VIDEO_COVER_OPTIONS,
  POSTER_VIDEO_COVER_TITLE_TEXT,
  POSTER_VIDEO_COVER_EXPORT_BLOCKED_TITLE,
  buildPosterVideoCoverPlan,
  posterVideoCoverExportGate
} from './data/posterVideoCover';
import {
  POSTER_VIDEO_COVER_PREVIEW_SCALE,
  POSTER_VIDEO_COVER_RENDER_FAILED_TEXT,
  createPosterVideoCoverUrl,
  exportPosterVideoCoverPng,
  releasePosterVideoCoverUrl,
  renderPosterVideoCover
} from './services/posterVideoCover';
// 机构 Logo 的取值与第四步海报同一支判据：默认装裱模板里配置的那张水印图（没配置就用机构名兜底）。
import { defaultFramingPreset } from './data/framingPresets';
import { frameSpecRenderView } from './services/frameSpec';
import { artworkExportSizeText } from './data/artworkExport';
// 成片版本 · 更新提示 · 历史版本 · 删除与级联（[第四步 US-222] / FR-301 ~ FR-304）：落库字段
// （videoKey / version / generatedAt / specSnapshot）、「有 N 幅作品已更新，建议重新生成」那句提示、
// 版本自增与历史快照、删除只动成片、以及归档记录删除时的级联判据全在 `data/videoRecords.js`
// （零依赖纯函数）。这一页只渲染它的产物 —— 组件不自己数「更新了几幅」、也不自己拼版本读数。
// 写入走同一个动作：提交任务落第一版、点「重新生成」才 `version` 自增；更新提示本身是**只读**计算。
import {
  VIDEO_RECORD_DELETE_CANCEL_LABEL,
  VIDEO_RECORD_DELETE_CONFIRM_LABEL,
  VIDEO_RECORD_DELETE_DONE,
  VIDEO_RECORD_DELETE_LABEL,
  VIDEO_RECORD_DELETE_NOTE,
  VIDEO_RECORD_LOCAL_NOTE,
  VIDEO_RECORD_REGENERATE_DONE,
  VIDEO_RECORD_REGENERATE_LABEL,
  VIDEO_RECORD_SECTION_DESC,
  VIDEO_RECORD_SECTION_TITLE,
  applyVideoRecord,
  createVideoRecord,
  findVideoRecord,
  removeVideoRecord,
  updateVideoRecordVersion,
  videoRecordRegenerateIssue,
  videoRecordSources,
  videoRecordView
} from './data/videoRecords';
import { deleteRemoteVideoRecord, saveRemoteVideoRecord } from './services/videoRecordsApi';
// 视频任务的权限 / 留痕 / 保留期 / 配额 / 签名地址（[第四步 US-223] / FR-311 ~ FR-315）：
// 五件事各有一份零依赖数据模块，这一页只渲染它们的产物、写入侧读同一份判据 ——
// 权限（`videoTaskAccess`：只有本班老师可提交与下载）、留痕（`videoAuditEntryInput` /
// `VIDEO_TASK_AUDIT_SIX`：提交 / 完成 / 下载 / 分享 / 更换音乐 / 删除）、配额
// （`videoQuotaView` + `videoQuotaSubmitIssue`：超限阻止新任务）、签名地址
// （`videoSignedUrlView`：有效期不超过分享有效期）、保留期（老师端只读一行）。
import {
  VIDEO_TASK_ACTIONS,
  videoTaskAccess,
  videoTaskAccessReadout,
  videoTaskViewerFromActor
} from './data/videoPermissions';
import {
  VIDEO_TASK_AUDIT_SECTION_DESC,
  VIDEO_TASK_AUDIT_SECTION_TITLE,
  videoAuditEntryInput,
  videoTaskAuditStats
} from './data/videoTaskAudit';
import { VIDEO_QUOTA_SECTION_TITLE, videoQuotaSubmitIssue, videoQuotaView } from './data/videoQuota';
import { videoRetentionSummary } from './data/videoRetention';
import { videoSignedUrlView } from './data/videoSignedUrl';
// 成片分享的授权闸门读的是第四步那一份归档摘要产物（`archiveStepView` → `archiveForwardView`
// → `data/consent.js`），与图文分享**同一道校验**，这里不另写一套。
import { archiveStepView } from './data/archiveSummary';
// 一键转发海报弹窗（[海报 US-308] / FR-327 ~ FR-334）：「一键转发家长」不再只弹 toast，而是打开这个弹窗
// （左侧模板缩略图列表 + 右侧 1:1 实时预览，缩略图用当前对象的真实数据渲染）。规则（入口匹配 / 适用性 /
// 默认选中 / 空态 / 五类版式的装配）在 `data/posterDialog.js`，落笔在 `services/posterDialog.js`，
// 弹窗本体是 `PosterDialog.jsx` —— 课后反馈第四步的入口（US-309）复用同一个组件；
// 这一页只负责把「当前对象 + 当前周期筛选 + 已归档记录」传进去。
import PosterDialog from './PosterDialog';
import { POSTER_DIALOG_ENTRY_ARCHIVE } from './data/posterDialog';
import { Button } from './ui';

/**
 * 缩略图就绪前的 1×1 占位（列表里的图先挂它，占位样式在 CSS 里 —— `.archive-thumb[data-archive-thumb-state] img`）。
 * 不是为了好看：`<img>` 不能先挂原图，否则浏览器的懒加载会在它自己那段距离内把原图整张解码掉。
 */
const ARCHIVE_THUMB_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * 时间线上的图（[第四步 US-212] 第 3 条）：**懒加载 + 缩略图**。
 *
 *  - `loading="lazy"` + `decoding="async"` 先行：没进视口的图不参与解码，滚动不为它买单；
 *  - 卡片进视口（外扩 `ARCHIVE_LAZY_ROOT_MARGIN`）后才向共用的队列要一张长边 ≤320px 的缩略图，
 *    生成好就换上（`data-archive-thumb-state` 如实报 `lazy → pending → ready` 的轨迹）；
 *  - 跨域 https 素材做不了画布缩略图（会把画布标脏）→ 回退原图懒加载，读数记成 `direct`。
 *
 * DOM 与老口径保持一致：`data-archive-lesson-artwork-img` / `data-archive-lesson-photo`
 * 仍然挂在那个 `<img>` 上（外层 `span` 用 `display:contents` 不占布局），老断言不用改。
 */
function LazyArchiveImage({src,alt,attrs={},onThumb=null,thumbKey=''}){
  const imageRef=useRef(null);
  const [thumbUrl,setThumbUrl]=useState('');
  const [state,setState]=useState('lazy');
  useEffect(()=>{
    // 观察的是 `<img>` 自己：外层 `span.archive-thumb` 是 `display:contents`（不占布局），
    // 没有盒子也就不会被 IntersectionObserver 判定为「进入视口」（本轮真踩）。
    const node=imageRef.current;
    if(!node||!src) return undefined;
    let cancelled=false;
    const request=()=>{
      if(cancelled||!src) return;
      setState(current=>current==='ready'?'ready':'pending');
      if(onThumb) onThumb(thumbKey,'pending');
      archiveThumbnailQueue.request(src,result=>{
        if(cancelled) return;
        if(result&&result.ok&&result.url){setThumbUrl(result.url);setState('ready');if(onThumb)onThumb(thumbKey,'ready');}
        else{setState('direct');if(onThumb)onThumb(thumbKey,'direct');}
      });
    };
    // 没有 IntersectionObserver（老浏览器 / 测试环境）就直接生成，功能不因此消失。
    if(typeof IntersectionObserver!=='function'){request();return ()=>{cancelled=true;};}
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(item=>item.isIntersecting)){observer.disconnect();request();}
    },{rootMargin:ARCHIVE_LAZY_ROOT_MARGIN});
    observer.observe(node);
    return ()=>{cancelled=true;observer.disconnect();};
  },[src,thumbKey,onThumb]);
  // `src` 的两段式：缩略图还没就绪时先挂一张 1×1 占位图 —— 不能先挂原图，
  // 否则浏览器的懒加载会在「这段距离内」把原图整张解码掉（480px 的图就白生成缩略图了）。
  // 缩略图这条路走不通（外链 https 做不了画布缩略图）才退回原图懒加载。
  const displaySrc = state === 'direct' ? src : (thumbUrl || ARCHIVE_THUMB_PLACEHOLDER);
  return <span className="archive-thumb" data-archive-thumb-state={state} data-archive-thumb-max={ARCHIVE_THUMB_MAX_EDGE}>
    <img ref={imageRef} src={displaySrc} alt={alt} loading="lazy" decoding="async" {...attrs}/>
  </span>;
}

/** 一节课在时间线上的卡：日期与作品名 · 成品作品图 · 课堂照片 · 五维点评摘要 · 转发状态（US-209）。 */
function ResidentLesson({entry,onThumb=null}){
  return <article className="archive-lesson" data-archive-lesson="true" data-archive-lesson-id={entry.id} data-archive-lesson-date={entry.date} data-archive-lesson-status={entry.status} data-archive-lesson-plaque={entry.dateDots} data-archive-lesson-dimensions={entry.dimensionCount} data-archive-lesson-photos={entry.photoCount} data-archive-lesson-forward={entry.forward.state} data-archive-lesson-forward-label={entry.forward.stateLabel} data-archive-lesson-forward-opens={String(entry.forward.openCount)} data-archive-lesson-forward-text={entry.forward.line} data-archive-lesson-lesson-no={entry.lessonNo||''}>
    <div className="history-art" data-archive-lesson-artwork={entry.artwork.url?'ok':'empty'} data-archive-media-status={entry.artwork.status||''}>
      {entry.artwork.url?<LazyArchiveImage src={entry.artwork.url} alt={`${entry.title?entry.title+' ':''}成品作品图`} onThumb={onThumb} thumbKey={`${entry.id||entry.recordKey}-artwork`} attrs={{'data-archive-lesson-artwork-img':'true'}}/>:entry.artwork.placeholder?<span className="archive-media-placeholder" data-archive-media-hold="true">{entry.artwork.placeholderText}</span>:<Frame/>}
    </div>
    <div className="history-copy">
      <span>{entry.date}{entry.title?` · 《${entry.title}》`:''}</span>
      {entry.dimensions.length?<dl className="history-dimensions">{entry.dimensions.map(row=><div key={row.name}><dt>{row.name}</dt><dd>{row.text}</dd></div>)}</dl>:<p data-archive-lesson-review="empty">老师已记录这节课里值得被看见的创作尝试。</p>}
      <div className="history-photos">
        {entry.photos.length?entry.photos.map((photo,index)=>(photo.url
          ?<LazyArchiveImage key={`${entry.id}-photo-${index}`} src={photo.url} alt={`${entry.title||entry.date}课堂照片 ${index+1}`} onThumb={onThumb} thumbKey={`${entry.id||entry.recordKey}-photo-${index}`} attrs={{'data-archive-lesson-photo':'true'}}/>
          :<span className="archive-media-placeholder" data-archive-media-hold="true" key={`${entry.id}-photo-${index}`}>{photo.placeholderText}</span>)):<small>这节课没有课堂照片</small>}
      </div>
      <small>已保存：成品作品图 · 课堂照片 · 完整点评{entry.archivedAtText?` · 归档于 ${entry.archivedAtText}`:''} · {entry.versionLabel}</small>
      <small className={`archive-lesson-forward is-${entry.forward.state}`} data-archive-lesson-forward-line="true"><b>{entry.forward.stateLabel}</b>{entry.forward.lineDetail?` · ${entry.forward.lineDetail}`:null}</small>
    </div>
  </article>;
}

/** 缺课记录：保留现有的温暖缺课文案（US-206 点名要保留的那一段）。 */
function ResidentAbsence({entry}){
  return <article className="archive-absence" data-archive-lesson="true" data-archive-lesson-id={entry.id} data-archive-lesson-date={entry.date} data-archive-lesson-status={entry.status} data-archive-lesson-absence="true" data-archive-lesson-forward={entry.forward.state} data-archive-lesson-forward-label={entry.forward.stateLabel} data-archive-lesson-forward-opens={String(entry.forward.openCount)}>
    <span>{entry.date}</span>
    <div><b>这节课，我们先为孩子轻轻留下一页。</b><p>{entry.absenceText}</p></div>
  </article>;
}

/** 报告的概况四行（快照产物；历史版本回看时渲染的是**那一版**的四行）。 */
function ReportFacts({facts}){
  return <div className="archive-report-facts">{facts.map(field=><div key={field.id} data-archive-report-fact={field.id} data-archive-report-fact-value={field.value}>
    <span>{field.label}</span><b>{field.value}</b><small>{field.detail}</small>
  </div>)}</div>;
}

/** 报告覆盖的课次（快照里的那一份，不是拿今天的记录重算 —— 历史版本回看时才对得上）。 */
function ReportLessons({rows}){
  return <ul className="archive-report-lessons" data-archive-report-lessons={rows.length}>
    {rows.map(row=><li key={row.id||`${row.date}-${row.title}`} data-archive-report-lesson="true" data-archive-report-lesson-date={row.date} data-archive-report-lesson-status={row.status}>
      <b>{row.date||'未记录日期'}</b>
      {row.title?<span>《{row.title}》</span>:null}
      <small>{row.isAbsence?'缺课 · 温柔留白':`${row.dimensionCount} 维点评${row.hasArtwork?' · 有成品作品图':''}${row.photoCount?` · 课堂照片 ${row.photoCount} 张`:''}`}</small>
    </li>)}
  </ul>;
}

/**
 * 阶段报告面板（[第四步 US-207a]）：周期 / 类型两个选择 + 生成（已有 = 更新）+ 删除 + 历史版本回看。
 * 判据全部读 `data/archiveReports.js` 的产物（键、按钮语义、注解、禁用原因、历史行），组件不自己算。
 * 报告**正文**（[第四步 US-207b]）：阶段总结 / 雷达维度 / 点评原文三块同样只渲染 data 层的产物 ——
 * 课次数、作品数、点评原文与雷达分值都是归档数据聚合出来的，组件里没有一句写死的示例文案。
 */

/**
 * 阶段总结（[第四步 US-207b]）：每一句话都是归档数据聚合的产物（`digest.lines`）。
 */
function ReportDigest({digest}){
  return <section className="archive-report-digest" data-archive-report-digest="true" data-archive-report-digest-insufficient={digest.insufficient?'true':'false'} data-archive-report-digest-covered={digest.coveredDimensions}>
    <b>{digest.title}</b>
    <ul>{digest.lines.map((line,index)=><li key={index} data-archive-report-digest-line={index}>{line}</li>)}</ul>
  </section>;
}

/**
 * 雷达维度（[第四步 US-207b]）：五条轴的分值 = 该维度在本阶段课次里留下点评原文的比例（覆盖度）。
 * 几何（网格 / 辐条 / 多边形 / 圆点）全在 data 层算好，组件只渲染坐标；数据不足的维度如实标注。
 */
function ReportRadar({radar}){
  return <section className="archive-report-radar" data-archive-report-radar="true" data-archive-report-radar-covered={radar.coveredDimensions} data-archive-report-radar-insufficient={radar.insufficientNames.length}>
    <div className="archive-report-block-head"><b>{radar.title}</b><span>{radar.desc}</span></div>
    <div className="archive-report-radar-body">
      <svg className="archive-report-radar-svg" viewBox={`0 0 ${radar.size} ${radar.size}`} role="img" aria-label={`${radar.title}：五维覆盖度`} data-archive-report-radar-svg="true">
        <g className="radar-grid">{radar.grid.map(row=><polygon key={row.level} points={row.points} data-archive-report-radar-grid={row.level}/>)}</g>
        <g className="radar-spokes">{radar.spokes.map((line,index)=><line key={index} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}/>)}</g>
        <polygon className="radar-fill" points={radar.polygon} data-archive-report-radar-polygon="true"/>
        <g className="radar-dots">{radar.dots.map(dot=><circle key={dot.name} cx={dot.x} cy={dot.y} r={3.2}/>)}</g>
      </svg>
      <ul className="archive-report-radar-axes">
        {radar.axes.map(axis=><li key={axis.name} data-archive-report-radar-axis={axis.name} data-archive-report-radar-value={axis.value} data-archive-report-radar-axis-covered={axis.covered} data-archive-report-radar-axis-insufficient={axis.insufficient?'true':'false'} data-archive-report-radar-axis-note={axis.note}>
          <span>{axis.name}</span><b>{axis.value}%</b><small>{axis.note}</small>
        </li>)}
      </ul>
    </div>
    {radar.insufficientNames.length?<p className="archive-report-insufficient" data-archive-report-radar-insufficient-note="true">{radar.insufficientNames.join('、')}：{radar.insufficientText}</p>:null}
  </section>;
}

/**
 * 点评原文（[第四步 US-207b]）：逐维列出本阶段归档记录里**老师确认后的原文**（带课次日期与作品名）。
 * 一段原文都没有的维度显示「本阶段数据不足」—— 不用示例文案把版面填满（FR-240）。
 */
function ReportReviewTexts({review}){
  return <section className="archive-report-review" data-archive-report-review="true" data-archive-report-review-covered={review.coveredDimensions} data-archive-report-review-insufficient={review.insufficientNames.length} data-archive-report-review-texts={review.textCount}>
    <div className="archive-report-block-head"><b>{review.title}</b><span>{review.desc}</span></div>
    <div className="archive-report-review-grid">{review.rows.map(row=><article key={row.name} className={row.insufficient?'is-insufficient':''} data-archive-report-review-dimension={row.name} data-archive-report-review-count={row.count} data-archive-report-review-insufficient={row.insufficient?'true':'false'} data-archive-report-review-note={row.note}>
      <header><b>{row.name}</b><small>{row.note}</small></header>
      {row.insufficient
        ?<p className="archive-report-insufficient" data-archive-report-review-empty="true">{review.insufficientText}</p>
        :<ul>{row.texts.map((text,index)=><li key={`${row.name}-${index}`} data-archive-report-review-text="true" data-archive-report-review-text-date={text.date}>
          <small>{text.date}{text.title?` · 《${text.title}》`:''}</small>
          <p>{text.text}</p>
        </li>)}</ul>}
    </article>)}</div>
  </section>;
}

/** 报告正文三块 + 概况与课次行：当前版本与历史版本读**同一组字段**（历史版本给的是那一版的聚合结果）。 */
function ReportBody({body}){
  return <>
    <ReportDigest digest={body.digest}/>
    <ReportFacts facts={body.facts}/>
    <ReportRadar radar={body.radar}/>
    <ReportReviewTexts review={body.review}/>
  </>;
}

function ArchiveReportPanel({reportKey, reportView, period, type, issue, busy, notice, stale, deleteOpen, historyVersion, onPeriod, onType, onGenerate, onDeleteOpen, onDeleteCancel, onDelete, onHistoryView, onHistoryBack, auditEntry = null}){
  const historyEntry=reportView&&historyVersion?reportView.history.find(entry=>entry.version===historyVersion)||null:null;
  const body=historyEntry||reportView;
  const typeHint=(ARCHIVE_REPORT_TYPE_OPTIONS.find(option=>option.name===type)||{}).hint||'';
  return <section className="archive-report" data-archive-report-section="true" data-archive-report-key={reportKey} data-archive-report-period={period} data-archive-report-type={type} data-archive-report-exists={reportView?'true':'false'} data-archive-report-stale={stale?'true':'false'} data-archive-report-busy={busy?'true':'false'}>
    <div className="archive-section-head"><span>阶段报告 · 按「对象 + 周期 + 类型」落库</span><h3>{ARCHIVE_REPORT_SECTION_TITLE}</h3><p>{ARCHIVE_REPORT_SECTION_DESC}</p></div>
    <div className="archive-report-controls">
      <label>报告周期<select value={period} onChange={event=>onPeriod(event.target.value)} data-archive-report-period-field="true" aria-label="报告周期">{ARCHIVE_PERIODS.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
      <label>报告类型<select value={type} onChange={event=>onType(event.target.value)} data-archive-report-type-field="true" aria-label="报告类型">{ARCHIVE_REPORT_TYPES.map(name=><option key={name} value={name}>{name}</option>)}</select><small className="archive-report-hint" data-archive-report-type-hint={type}>{typeHint}</small></label>
      <Button icon={FileText} data-archive-report-generate="true" data-archive-report-action={archiveReportAction(reportView)} disabled={Boolean(issue)||busy} onClick={onGenerate}>{busy?'正在生成报告…':archiveReportActionLabel(reportView)}</Button>
    </div>
    {issue?<p className="archive-report-issue" data-archive-report-issue="true">{issue}</p>:null}
    {notice?<p className="archive-report-notice" data-archive-report-notice="true">{notice}</p>:null}
    {auditEntry?<p className="archive-report-audit" data-archive-report-audit={auditEntry.id}
      data-archive-report-audit-action={auditEntry.action}
      data-archive-report-audit-actor={auditEntry.actorId}
      data-archive-report-audit-object={auditEntry.objectName}
      data-archive-report-audit-version={auditEntry.version}
      data-archive-report-audit-at={auditEntry.at}
      data-archive-report-audit-trace={auditTraceText(auditEntry)}
      data-archive-report-audit-missing={auditEntryMissingFields(auditEntry).join(',')}>
      已写入审计日志：{auditTraceText(auditEntry)} · 第 {auditEntry.version} 版
    </p>:null}
    {reportView?<article className="archive-report-card" data-archive-report-card="true" data-archive-report-version={reportView.version} data-archive-report-status={reportView.status} data-archive-report-generated={reportView.generatedAtText} data-archive-report-generated-by={reportView.generatedBy} data-archive-report-preview-version={historyEntry?historyEntry.version:''}>
      <header>
        <div><span data-archive-report-status-label="true">{reportView.statusLabel}</span><h4>{reportView.title}</h4>
          <b data-archive-report-annotation="true">{historyEntry?historyEntry.annotation:reportView.annotation}</b>
          <small>{historyEntry?`历史版本 ${historyEntry.versionLabel}`:reportView.versionLabel} · {historyEntry?(historyEntry.generatedBy?`由 ${historyEntry.generatedBy} 生成`:'生成人未记录'):reportView.generatedByText}</small>
        </div>
        <div className="archive-report-badges">
          <em data-archive-report-version-label="true">{historyEntry?historyEntry.versionLabel:reportView.versionLabel}</em>
          {historyEntry?<Button variant="secondary" data-archive-report-history-back="true" onClick={onHistoryBack}>{ARCHIVE_REPORT_HISTORY_BACK}</Button>:null}
        </div>
      </header>
      <ReportBody body={body}/>
      <div className="archive-report-lessons-head"><b>{ARCHIVE_REPORT_LESSON_TITLE}</b><span>来自归档数据的聚合结果（生成那一刻的快照）</span></div>
      {reportView.lessonRows.length||historyEntry?<ReportLessons rows={historyEntry?historyEntry.lessonRows:reportView.lessonRows}/>:<p className="archive-report-empty-line">这个周期里还没有可聚合的课次。</p>}
      {stale&&!historyEntry?<p className="archive-report-stale" data-archive-report-stale-hint="true">{ARCHIVE_REPORT_STALE_HINT}</p>:null}
      {reportView.status===ARCHIVE_REPORT_STATUSES.local&&!historyEntry?<small className="archive-report-local" data-archive-report-local-note="true">{ARCHIVE_REPORT_LOCAL_NOTE}</small>:null}
      <div className="archive-report-history">
        <b>{ARCHIVE_REPORT_HISTORY_TITLE}（{reportView.historyCount}）</b>
        {reportView.hasHistory?<ul>{reportView.history.map(entry=><li key={entry.version} data-archive-report-history-entry={entry.version} data-archive-report-history-entry-date={entry.generatedAtText}>
          <span>{entry.versionLabel} · {entry.annotation}</span>
          <button type="button" className="text-link" data-archive-report-history-view={entry.version} onClick={()=>onHistoryView(entry.version)}>{ARCHIVE_REPORT_HISTORY_VIEW}</button>
        </li>)}</ul>:<p>{ARCHIVE_REPORT_HISTORY_EMPTY}</p>}
        <small>{ARCHIVE_REPORT_HISTORY_NOTE}</small>
      </div>
      {deleteOpen?<div className="archive-report-delete-bar" data-archive-report-delete-bar="true">
        <p>{ARCHIVE_REPORT_DELETE_NOTE}</p>
        <Button variant="secondary" icon={Trash2} data-archive-report-delete-confirm="true" onClick={onDelete}>{ARCHIVE_REPORT_DELETE_CONFIRM_LABEL}</Button>
        <button type="button" className="text-link" data-archive-report-delete-cancel="true" onClick={onDeleteCancel}>{ARCHIVE_REPORT_DELETE_CANCEL_LABEL}</button>
      </div>:<div className="archive-report-actions"><Button variant="secondary" icon={Trash2} data-archive-report-delete="true" onClick={onDeleteOpen}>{ARCHIVE_REPORT_DELETE_LABEL}</Button></div>}
    </article>:<p className="archive-report-empty" data-archive-report-empty="true">{ARCHIVE_REPORT_EMPTY_TEXT}</p>}
  </section>;
}

/**
 * 一条视频任务卡（[第四步 US-213a] 第 5 条 / [第四步 US-214]）：卡片上必须**明确标注**
 * 「演示数据 · 视频服务未接入」。卡片渲染的每一行都取自 `data/videoJobs.js` 的 `videoJobView` 产物
 * （状态 / 进度百分比 / 预估剩余时间 / 任务键 / 次数 / 失败原因 / 队列位次 / 演示标注 / 是否按 jobKey 恢复），
 * 组件不自己拼字符串、也不自己判断该给哪个按钮。
 *
 * 三条硬口径（US-214）：
 *  - 「预估剩余时间」旁边永远跟着一句「不是成片时长」（`job.etaNote`）—— 两个时间不许被看成一个；
 *  - `data-video-job-player="none"` / `has-output="false"` / 卡片里没有任何 `<video>` 元素：
 *    未完成时不显示假播放器、假封面、假时长（成片只能来自渲染服务，结构上编不出来）；
 *  - `is-latest`（刚提交的那条）与 `data-video-job-resumed`（离开页面前提交、这次按 jobKey 接回来的）
 *    都是可见状态，不是内部细节 —— 「提交后立即进入任务卡片」与「重新进入恢复进度」都要看得出来。
 */
function VideoJobCard({job,isLatest,onCancel,onRetry}){
  const cancelAction=job.actions.find(action=>action.id==='cancel');
  const retryAction=job.actions.find(action=>action.id==='retry');
  return <article className={`video-job-card${isLatest?' is-latest':''}`} data-video-job-card="true" data-video-job-key={job.jobKey} data-video-job-type={job.type} data-video-job-object={job.objectName} data-video-job-status={job.status} data-video-job-progress={job.progress} data-video-job-attempts={job.attempts} data-video-job-queue={job.queueLabel} data-video-job-error={job.errorText} data-video-job-demo={job.demoLabel} data-video-job-output-url={job.output.url} data-video-job-latest={isLatest?'true':'false'} data-video-job-resumed={job.resumed?'true':'false'} data-video-job-eta={job.etaLabel} data-video-job-eta-known={job.eta.known?'true':'false'} data-video-job-has-output={job.hasOutput?'true':'false'} data-video-job-player="none" data-video-job-duration="">
    <header>
      <div>
        <span data-video-job-type-label="true">{job.typeLabel}</span>
        <b data-video-job-object-label="true">{job.objectName} · {job.period}</b>
      </div>
      <em className={`video-job-status is-${job.status}`} data-video-job-status-label="true">{job.statusLabel}</em>
    </header>
    <p className="video-job-demo" data-video-job-demo={job.demoLabel}>{job.demoLabel}</p>
    {job.resumeNote?<p className="video-job-resume-note" data-video-job-resume-note="true">{job.resumeNote}</p>:null}
    <div className="video-job-progress" data-video-job-progress-row="true">
      <div className="video-job-bar" role="progressbar" aria-label={`${job.objectName} 视频任务进度`} aria-valuenow={job.progress} aria-valuemin="0" aria-valuemax="100"><i style={{width:job.progressLabel}} data-video-job-bar="true"/></div>
      <b data-video-job-progress-label="true">{job.progressLabel}</b>
    </div>
    <ul className="video-job-rows">
      <li><span>状态说明</span><b data-video-job-status-note="true">{job.statusNote}</b></li>
      <li data-video-job-eta-row="true"><span>{VIDEO_JOB_ETA_LABEL}</span><b data-video-job-eta-label="true">{job.etaLabel}</b></li>
      <li><span>尝试次数</span><b data-video-job-attempts-label="true">{job.attemptsLabel}{job.queueLabel?` · ${job.queueLabel}`:''}</b></li>
      <li data-video-job-key-row="true"><span>任务键</span><b data-video-job-key-label="true">{job.jobKey}</b></li>
      {job.errorText?<li data-video-job-error-row="true"><span>失败原因{job.errorCode?`（${job.errorCode}）`:''}</span><b>{job.errorText}</b></li>:null}
    </ul>
    <p className="video-job-eta-note" data-video-job-eta-note="true">{job.etaNote}</p>
    <dl className="video-job-spec" data-video-job-spec="true">{job.specRows.map(row=><div key={row.id} data-video-job-spec-row={row.id}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    {job.outputNote?<p className="video-job-output" data-video-job-output="true">{job.outputNote}</p>:null}
    <div className="video-job-actions">
      {cancelAction&&cancelAction.allowed?<Button variant="secondary" icon={XCircle} data-video-job-action="cancel" onClick={()=>onCancel(job.jobKey)}>{cancelAction.label}</Button>:null}
      {retryAction&&retryAction.allowed?<Button variant="secondary" icon={RefreshCw} data-video-job-action="retry" onClick={()=>onRetry(job.jobKey)}>{retryAction.label}</Button>:null}
    </div>
  </article>;
}

/**
 * 成片预览 · 下载与分享（[第四步 US-219]）。
 *
 * 这一块要对得起「渲染服务还没接进来」这件事（三条验收都在这里）：
 *  - **竖屏 9:16 播放器占位**：只有渲染服务给出成片（https 持久地址 + 正时长 + 正体积，
 *    判据是 `videoOutputView`）时才有 `src`；否则 `<video>` 不设 `src`、也不渲染任何 `<source>`
 *    —— 原型里不内置任何 mp4，也不编时长、封面或下载地址（`data-video-preview-mp4="none"`）；
 *  - **下载与分享的不可用提示**：两个动作各自带一句 `unavailableText`（点击后显示 + toast），
 *    不静默什么都不做；
 *  - **成片分享与图文分享同一套规则**：下面的「成片分享链接」块里，授权闸门（`videoShareGateView`
 *    读 `shareTokenGenerationGate` → `data/consent.js`）、有效期（同一份常量与下拉）、撤回
 *    （同一条 `revokeShareTokenRecord`）与图文分享完全同源，组件不自己判断「能不能生成」。
 */
function VideoPreviewPanel({preview,share,notice,shareNotice,revokeOpen,playerRef=null,fullscreen=false,fullscreenSupported=false,onToggleFullscreen=()=>{},onDownload,onShare,onGenerate,onRevoke,onRevokeOpen,onRevokeCancel,onValidDays,onGoAuthorization}){
  const player=preview.player;
  return <section className="video-preview" data-video-preview="true"
    data-video-preview-ratio={player.ratioLabel} data-video-preview-aspect={String(player.aspect)}
    data-video-preview-ready={player.ready?'true':'false'} data-video-preview-src={player.src}
    data-video-preview-status={player.status} data-video-preview-playsinline={player.playsInline?'true':'false'}
    data-video-preview-job-key={preview.jobKey} data-video-preview-mp4="none"
    data-video-preview-player-portrait="true" data-video-preview-fullscreen-active={fullscreen?'true':'false'}
    data-video-preview-fullscreen-supported={fullscreenSupported?'true':'false'}>
    <div className="archive-section-head"><span>{VIDEO_PLAYER_RATIO_LABEL} · 只占位不放片</span><h4>{VIDEO_PREVIEW_SECTION_TITLE}</h4><p>{VIDEO_PREVIEW_SECTION_DESC}</p></div>
    <div className="video-preview-body">
      <figure ref={playerRef} className={`video-preview-player${fullscreen?' is-fullscreen':''}`} style={{aspectRatio:'9 / 16'}} data-video-preview-player={player.status} data-video-preview-player-ratio={player.ratioLabel} data-video-preview-player-src={player.src} data-video-preview-player-fullscreen={fullscreen?'true':'false'}>
        <video className="video-preview-video" playsInline webkit-playsinline="true" preload="none" controls={player.ready} src={player.src||undefined} data-video-preview-video="true" aria-label={`成片预览（${VIDEO_PLAYER_RATIO_LABEL}）`}/>
        {player.ready?null:<figcaption className="video-preview-hold" data-video-preview-hold="true">
          <b data-video-preview-hold-title="true">{player.placeholderTitle}</b>
          <span data-video-preview-hold-text="true">{player.placeholderText}</span>
        </figcaption>}
        {/* 全屏入口（[第四步 US-224] 第 2 条）：占位阶段也点得动 —— 成片接入后同一个按钮就是全屏播放。
            接口不可用时按钮仍然在（点了给那句实话），不伪造一个静默失效的控件。 */}
        <button type="button" className="video-preview-fullscreen-button" data-video-preview-fullscreen="true"
          data-video-preview-fullscreen-state={fullscreen?'fullscreen':'inline'}
          data-video-preview-fullscreen-supported={fullscreenSupported?'true':'false'}
          aria-label={fullscreen?VIDEO_PLAYER_EXIT_FULLSCREEN_LABEL:VIDEO_PLAYER_FULLSCREEN_LABEL}
          onClick={onToggleFullscreen}>{fullscreen?VIDEO_PLAYER_EXIT_FULLSCREEN_LABEL:VIDEO_PLAYER_FULLSCREEN_LABEL}</button>
      </figure>
      <div className="video-preview-side">
        <ul className="video-preview-rows">{preview.rows.map(row=><li key={row.id} data-video-preview-row={row.id} data-video-preview-row-value={row.value}>
          <span>{row.label}</span><b data-video-preview-row-text="true">{row.value}</b>
        </li>)}</ul>
        <p className="video-preview-policy" data-video-preview-policy="true">{preview.policyNote}</p>
        {preview.demoDoneNote?<p className="video-jobs-note" data-video-preview-demo-done="true">{preview.demoDoneNote}</p>:null}
        <div className="video-preview-actions">
          <Button variant="secondary" icon={Download} data-video-preview-download="true" onClick={onDownload}>{VIDEO_DOWNLOAD_LABEL}</Button>
          <Button variant="secondary" icon={Link2} data-video-preview-share="true" onClick={onShare}>{VIDEO_SHARE_LABEL}</Button>
        </div>
        <p className="video-preview-fullscreen-note" data-video-preview-fullscreen-note="true">{fullscreenSupported?VIDEO_PLAYER_FULLSCREEN_NOTE:VIDEO_PLAYER_FULLSCREEN_UNSUPPORTED_TEXT}</p>
        {preview.readyNote?<p className="video-preview-ready-note" data-video-preview-ready-note="true">{preview.readyNote}</p>:null}
        {notice?<p className="video-preview-unavailable" data-video-preview-unavailable="true">{notice}</p>:null}
      </div>
    </div>
    <div className="video-preview-share" data-video-preview-share-block="true" data-video-preview-share-gate={share.gate.allowed?'allowed':'blocked'} data-video-preview-share-gate-state={share.gate.state} data-video-preview-share-state={share.state} data-video-preview-share-token={share.tokenText} data-video-preview-share-days={String(share.validDays)}>
      <b data-video-preview-share-title="true">{share.title}</b>
      <p data-video-preview-share-rules="true">{share.rulesNote}</p>
      <p data-video-preview-share-gate-text="true">{share.gate.note||share.gate.stateLabel}</p>
      {share.gate.blockedNote?<p className="video-jobs-issue" data-video-preview-share-blocked-note="true">{share.gate.blockedNote}</p>:null}
      {share.gate.entryLabel?<button type="button" className="text-link" data-video-preview-share-entry="true" onClick={onGoAuthorization}>{share.gate.entryLabel}</button>:null}
      <label>分享有效期<select value={String(share.validDays)} onChange={event=>onValidDays(event.target.value)} data-video-preview-share-days-select="true" aria-label="成片分享有效期">{share.validDayOptions.map(option=><option key={option.days} value={String(option.days)}>{option.label}</option>)}</select></label>
      <p data-video-preview-share-policy="true">{share.policyText}</p>
      <em className={`video-preview-share-state is-${share.state}`} data-video-preview-share-state-label="true">{share.stateLabel}</em>
      {share.tokenText?<div className="video-preview-share-link">
        <code data-video-preview-share-link="true">{share.link}</code>
        <small data-video-preview-share-expiry="true">{share.expiresText}</small>
        {share.revokedText?<small data-video-preview-share-revoked="true">撤回于 {share.revokedText}</small>:null}
      </div>:null}
      <p className="video-jobs-note" data-video-preview-share-page-note="true">{share.pageNote}</p>
      <div className="video-preview-share-actions">
        {share.canGenerate?<Button disabled={!share.gate.allowed} data-video-preview-share-generate="true" onClick={onGenerate}>{share.generateLabel}</Button>:null}
        {share.active?(revokeOpen
          ? <span className="video-preview-share-confirm">
            <Button variant="secondary" data-video-preview-share-revoke-confirm="true" onClick={onRevoke}>{share.revokeConfirmLabel}</Button>
            <button type="button" className="text-link" data-video-preview-share-revoke-cancel="true" onClick={onRevokeCancel}>再想想</button>
          </span>
          : <Button variant="secondary" icon={XCircle} data-video-preview-share-revoke="true" onClick={onRevokeOpen}>{share.revokeLabel}</Button>):null}
      </div>
      {shareNotice?<p className="video-jobs-notice" data-video-preview-share-notice="true">{shareNotice}</p>:null}
    </div>
  </section>;
}

/**
 * 成片版本 · 更新提示 · 历史版本 · 删除（[第四步 US-222] / FR-301 ~ FR-304）。
 *
 * 这一块回答「我改了作品之后，视频该不该重做」——每一行都有出处，判据与文案全部来自
 * `data/videoRecords.js`（组件只渲染产物，不自己数「更新了几幅」、也不自己拼版本读数）：
 *  - **落库字段**（验收第 1 条）：videoKey（对象 + 周期 + 类型）/ 版本 / 生成时间 / specSnapshot
 *    逐项显示；`data-video-record-key` 就是那个业务键；
 *  - **不自动重出**（验收第 2 条）：归档作品更新后这里只显示 `update.hint`（验收原文那句
 *    「有 N 幅作品已更新，建议重新生成」）—— 记录本身一个字节都不动，重新生成只能由老师点；
 *  - **重新生成**（验收第 3 条）：`version` 自增，上一版整份进「历史版本」；
 *    「查看这一版」回看历史快照，「回到最新版本」回来；某一版有成片地址才可下载
 *    （渲染服务未接入时按钮禁用并给同一句「不会伪造 mp4」的提示）；
 *  - **删除**（验收第 4 条）：两步确认后只摘掉成片与它的渲染任务记录，归档记录一个字节都不动
 *    （回执里写着这一句；级联删除归档记录那一侧在系统配置的到期清理里，走同一个数据层）。
 */
function VideoRecordPanel({view,notice,deleteOpen,pending=false,onRegenerate,onRegenerateIssue,onDeleteOpen,onDeleteCancel,onDelete,onHistoryView,onHistoryBack}){
  const update=view.update;
  const viewing=view.viewing;
  return <section className="video-record" data-video-record="true"
    data-video-record-present={view.present?'true':'false'}
    data-video-record-key={view.videoKey} data-video-record-version={String(view.version||'')}
    data-video-record-version-label={view.versionLabel} data-video-record-generated-at={view.generatedAt}
    data-video-record-generated-by={view.generatedBy} data-video-record-object={view.objectName}
    data-video-record-period={view.period} data-video-record-source-count={String(view.sourceCount)}
    data-video-record-stale={update.stale?'true':'false'} data-video-record-updated-count={String(update.updatedCount)}
    data-video-record-added-count={String(update.addedCount)} data-video-record-removed-count={String(update.removedCount)}
    data-video-record-history-count={String(view.historyRows.length)}
    data-video-record-viewing-version={String(viewing.active?viewing.version:'')}
    data-video-record-output-ready={view.output.ready?'true':'false'}>
    <div className="archive-section-head"><span>成片按 videoKey 唯一落库 · 不自动重出</span><h4>{VIDEO_RECORD_SECTION_TITLE}</h4><p>{VIDEO_RECORD_SECTION_DESC}</p></div>
    {/* 回执挂在分支外面：删除成片之后记录回到空态，但「归档记录一条都没有动」这句必须还在（否则老师看不见删了什么）。 */}
    {notice?<p className="video-record-notice" data-video-record-notice="true">{notice}</p>:null}
    {!view.present
      ? <p className="video-record-empty" data-video-record-empty="true">{view.emptyText}<small data-video-record-empty-hint="true">{view.emptyActionHint}</small></p>
      : <>
        <article className="video-record-card" data-video-record-card="true">
          <header>
            <div><b data-video-record-object-label="true">{view.objectName} · {view.period}</b><small>{view.typeLabel}</small></div>
            <em data-video-record-version-badge="true">{view.versionLabel}</em>
          </header>
          <dl className="video-record-rows" data-video-record-rows="true">
            <div data-video-record-row="videoKey" data-video-record-row-value={view.videoKey}><dt>业务键 videoKey</dt><dd data-video-record-key-label="true">{view.videoKey}</dd></div>
            {view.rows.map(row=><div key={row.id} data-video-record-row={row.id} data-video-record-row-value={row.value}><dt>{row.label}</dt><dd data-video-record-row-text="true">{row.value}</dd></div>)}
            <div data-video-record-row="sources" data-video-record-row-value={String(view.sourceCount)}><dt>覆盖归档记录</dt><dd data-video-record-sources-label="true">{view.sourceNote}</dd></div>
          </dl>
          <dl className="video-record-spec" data-video-record-spec="true">{view.specRows.map(row=><div key={row.id} data-video-record-spec-row={row.id}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          {view.outputNote?<p className="video-record-output-note" data-video-record-output-note="true">{view.outputNote}</p>:null}
        </article>
        <div className={`video-record-update is-${update.stale?'stale':'sync'}`} data-video-record-update="true" data-video-record-update-state={update.stale?'stale':'sync'}>
          <b data-video-record-hint="true">{update.hint}</b>
          <small data-video-record-update-detail="true">{update.detail}</small>
        </div>
        <div className="video-record-actions">
          <Button data-video-record-regenerate="true" data-video-record-regenerate-pending={pending?'true':'false'} onClick={onRegenerate}>{VIDEO_RECORD_REGENERATE_LABEL}</Button>
          <small data-video-record-regenerate-issue="true">{onRegenerateIssue}</small>
          {deleteOpen
            ? <span className="video-record-delete-confirm">
              <Button variant="danger" data-video-record-delete-confirm="true" onClick={onDelete}>{VIDEO_RECORD_DELETE_CONFIRM_LABEL}</Button>
              <button type="button" className="text-link" data-video-record-delete-cancel="true" onClick={onDeleteCancel}>{VIDEO_RECORD_DELETE_CANCEL_LABEL}</button>
            </span>
            : <Button variant="secondary" icon={Trash2} data-video-record-delete="true" onClick={onDeleteOpen}>{VIDEO_RECORD_DELETE_LABEL}</Button>}
        </div>
        {deleteOpen?<p className="video-record-delete-note" data-video-record-delete-note="true">{VIDEO_RECORD_DELETE_NOTE}</p>:null}
        {viewing.active?<div className="video-record-viewing" data-video-record-viewing="true" data-video-record-viewing-version-label={viewing.versionLabel}>
          <header>
            <div><b data-video-record-viewing-title="true">正在回看 {viewing.versionLabel}</b><small data-video-record-viewing-meta="true">{viewing.generatedAtText} · {viewing.generatedByText}</small></div>
            <Button variant="secondary" data-video-record-history-back="true" onClick={onHistoryBack}>{view.historyBackLabel}</Button>
          </header>
          <ul className="video-record-viewing-rows" data-video-record-viewing-rows="true">{viewing.rows.map(row=><li key={row.id} data-video-record-viewing-row={row.id} data-video-record-viewing-row-value={row.value}><span>{row.label}</span><b>{row.value}</b></li>)}</ul>
          <dl className="video-record-spec" data-video-record-viewing-spec="true">{viewing.specRows.map(row=><div key={row.id} data-video-record-viewing-spec-row={row.id}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          <div className="video-record-viewing-actions">
            <Button variant="secondary" icon={Download} disabled={!viewing.download.enabled} data-video-record-viewing-download="true" onClick={()=>{if(!viewing.download.enabled)return;}}>{viewing.download.label}</Button>
            {viewing.download.unavailableText?<small data-video-record-download-note="true">{viewing.download.unavailableText}</small>:null}
          </div>
        </div>:null}
        <div className="video-record-history" data-video-record-history="true">
          <b>{view.historyTitle}（{view.historyRows.length}）</b>
          {view.hasHistory
            ? <ul data-video-record-history-rows="true">{view.historyRows.map(entry=><li key={entry.version} data-video-record-history-entry={entry.version} data-video-record-history-entry-date={entry.generatedAtText}>
              <span data-video-record-history-annotation="true">{entry.annotation}</span>
              <button type="button" className="text-link" data-video-record-history-view={entry.version} onClick={()=>onHistoryView(entry.version)}>{view.historyViewLabel}</button>
            </li>)}</ul>
            : <p data-video-record-history-empty="true">{view.historyEmptyText}</p>}
          <small data-video-record-history-note="true">{view.historyNote}</small>
          <small data-video-record-local-note="true">{VIDEO_RECORD_LOCAL_NOTE}</small>
        </div>
      </>}
  </section>;
}

/**
 * 背景音乐选用与版权闸门（[第四步 US-221]）。
 *
 * 这一块是**版权举证**的界面：把音乐混进发给家长的视频属于商业使用，所以这里每一行都有出处。
 * 判据与文案全部来自 `data/musicSelection.js`（组件只渲染产物）：
 *  - 可选曲目**只有**「已确认授权且未过期」的（判据就是管理端曲库的 `musicTrackAvailability()`），
 *    `pending` / 已到期 / 已停用的曲目在这里**结构上不出现**（不是渲染时判断）；
 *  - **静音是默认值**（验收第 3 条）：进页面时选中的就是「静音（默认）」这一行；
 *  - **成片记录**（验收第 2 条）：这条任务的 `specSnapshot.music`（曲目 id + 授权凭证快照：
 *    标题 / 来源 / 授权类型 / 到期日）逐项显示；老任务没有这一项时如实写「未记录」；
 *  - **到期提示与处置**（验收第 5 条）：记录里的曲目到期（或管理员把它改回未确认）时显示
 *    `MUSIC_LICENSE_EXPIRED_NOTICE`，两个动作「更换音乐 / 静音」把处置结果写进成片记录
 *    （`recordVideoJobMusicDisposition`，曲目 id 与凭证快照一个字节都不动）；
 *  - **混音配置**（验收第 4 条）：1.5 秒淡入 / 2 秒淡出 / 音量归一化直接渲染数据层的读数与滤镜串。
 */
function MusicSelectionPanel({view,jobKey,notice,onPick,onMute,onDisposition}){
  return <section className="music-selection" data-music-selection="true"
    data-music-selection-muted={view.muted?'true':'false'}
    data-music-selection-track={view.trackId}
    data-music-selection-selectable={view.selectableCount}
    data-music-selection-library={view.libraryCount}
    data-music-selection-empty={view.empty?'true':'false'}
    data-music-selection-expired-notice={view.expiredNotice?'true':'false'}
    data-music-selection-revoked-notice={view.revokedNotice?'true':'false'}
    data-music-selection-job-key={jobKey||''}>
    <div className="archive-section-head"><span>版权闸门 · 只有已确认授权且未过期的曲目可选</span><h4>{MUSIC_SELECTION_SECTION_TITLE}</h4><p>{MUSIC_SELECTION_SECTION_DESC}</p></div>
    <div className="music-selection-current" data-music-selection-current="true" data-music-selection-current-muted={view.muted?'true':'false'} data-music-selection-current-title={view.selectionTitle}>
      <b>{MUSIC_SELECTION_TITLE}</b>
      <em data-music-selection-current-label="true">{view.selectionTitle}</em>
      <small data-music-selection-current-note="true">{view.selectionNote}</small>
      {view.restoreNote?<small className="music-selection-restore" data-music-selection-restore-note="true">{view.restoreNote}</small>:null}
      {view.muted?null:<button type="button" className="text-link" data-music-selection-mute="true" onClick={onMute}>改为静音</button>}
    </div>
    {notice?<p className="video-jobs-notice" data-music-selection-notice="true">{notice}</p>:null}
    <ul className="music-selection-list" data-music-selection-list="true">
      <li className={`music-selection-row is-mute${view.muted?' is-selected':''}`} data-music-selection-row="mute" data-music-selection-row-muted="true" data-music-selection-row-selected={view.muted?'true':'false'} data-music-selection-row-status="默认">
        <label>
          <input type="radio" name={`music-selection-${jobKey||'job'}`} checked={view.muted} data-music-selection-pick="mute" aria-label={MUSIC_MUTE_TITLE} onChange={onMute}/>
          <span><b data-music-selection-row-title="true">{MUSIC_MUTE_TITLE}</b><em data-music-selection-row-meta="true">不选用任何曲目</em></span>
        </label>
        <small data-music-selection-row-note="true">{view.mix.muted?'成片输出无音轨或静音轨（当前就是这一项）。':'选它就把音乐关掉：成片输出无音轨或静音轨。'}</small>
      </li>
      {view.rows.map(row=><li key={row.trackKey} className={`music-selection-row${row.selected?' is-selected':''}`} data-music-selection-row={row.trackKey} data-music-selection-row-selected={row.selected?'true':'false'} data-music-selection-row-status={row.licenseStatusLabel} data-music-selection-row-expires={row.expiresAt}>
        <label>
          <input type="radio" name={`music-selection-${jobKey||'job'}`} checked={row.selected} data-music-selection-pick={row.trackKey} aria-label={row.title} onChange={()=>onPick(row.trackKey)}/>
          <span><b data-music-selection-row-title="true">{row.title}</b><em data-music-selection-row-meta="true">{row.meta}</em></span>
        </label>
        <small data-music-selection-row-license="true">{row.licenseStatusLabel} · {row.licenseType} · {row.expiresText}</small>
        <small data-music-selection-row-source="true">来源：{row.sourceProvider}</small>
      </li>)}
    </ul>
    {view.empty?<p className="video-jobs-empty" data-music-selection-empty="true"><b data-music-selection-empty-title="true">{view.emptyTitle}</b>{view.emptyText}</p>:null}
    <div className="music-selection-record" data-music-selection-record="true" data-music-selection-record-present={view.record.present?'true':'false'} data-music-selection-record-muted={view.record.muted?'true':'false'} data-music-selection-record-expired={view.record.expired?'true':'false'}>
      <b>{MUSIC_RECORD_TITLE}</b>
      <dl data-music-selection-record-rows="true">{view.record.rows.map(row=><div key={row.id} data-music-selection-record-row={row.id} data-music-selection-record-value={row.value}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      <small data-music-selection-record-note="true">{view.record.note}</small>
      {view.dispositionText?<p className="music-selection-disposition-text" data-music-selection-disposition-text="true">{view.dispositionText}</p>:null}
    </div>
    {view.noticeVisible?<div className="music-selection-notice" data-music-selection-expiry="true" data-music-selection-notice-kind={view.expiredNotice?'expired':'revoked'}>
      <p data-music-selection-expiry-line="true">{view.notice}</p>
      <small data-music-selection-disposition-note="true">{view.dispositionNote}</small>
      <div className="music-selection-notice-actions">
        <Button variant="secondary" data-music-selection-disposition="switch" disabled={!view.dispositionActions.find(action=>action.id==='switch').allowed} onClick={()=>onDisposition('switch')}>更换音乐</Button>
        <Button variant="secondary" data-music-selection-disposition="mute" onClick={()=>onDisposition('mute')}>静音</Button>
      </div>
    </div>:null}
    <div className="music-selection-mix" data-music-selection-mix="true" data-music-selection-mix-muted={view.mix.muted?'true':'false'} data-music-selection-mix-filter={view.mix.filter}>
      <b>{MUSIC_MIX_SECTION_TITLE}</b>
      <ul>{view.mixRows.map(row=><li key={row.id} data-music-selection-mix-row={row.id} data-music-selection-mix-value={row.value}><span>{row.label}</span><b>{row.value}</b><small>{row.detail}</small></li>)}</ul>
      <small data-music-selection-mix-note="true">{view.mixNote}</small>
    </div>
  </section>;
}

/**
 * 时长上限与自动精选（[第四步 US-216]）：这条片子放得下多少幅、哪些被舍弃、老师手动排除哪几幅。
 *
 * 判据与文案全部来自 `data/videoSelection.js`（组件只渲染产物，不自己算时长、不自己拼原因）：
 *  - 两个上限（个人 120 秒 / 班级 300 秒）与「超出时按课次时间线均匀取样、首末两幅必留」；
 *  - 「本周期共 N 幅，已精选 M 幅收录」与预估时长（预估时长 = **入选那一批**按帧序规则推出来的，
 *    因此与下面帧清单上的总时长必然是一个数）；
 *  - 每幅作品的去向（收录 / 已舍弃 / 已手动排除）+ 一个「排除这一幅 / 恢复收录」的开关：
 *    点一下就从候选里去重算收录清单与预估时长（实时，不需要点应用）；
 *  - 班级成片另给每位学员的分配读数（先保底每人 1 幅，再按作品数比例分剩余名额）。
 */
function VideoSelectionPanel({view,onToggleExclude}){
  return <section className="video-selection" data-video-selection="true"
    data-video-selection-type={view.type} data-video-selection-total={view.total}
    data-video-selection-selected={view.selectedCount} data-video-selection-dropped={view.droppedCount}
    data-video-selection-excluded={view.excludedCount} data-video-selection-absence={view.absenceCount}
    data-video-selection-students={view.studentCount}
    data-video-selection-duration={view.durationSec} data-video-selection-full-duration={view.fullSec}
    data-video-selection-cap={view.capSec} data-video-selection-sampled={view.sampled?'true':'false'}
    data-video-selection-cap-exceeded={view.capExceeded?'true':'false'} data-video-selection-over-cap={view.overCap?'true':'false'}
    data-video-selection-summary-text={view.summary}>
    <div className="archive-section-head"><span>{view.typeLabel} · 精选在先</span><h4>{VIDEO_SELECTION_SECTION_TITLE}</h4><p>{VIDEO_SELECTION_SECTION_DESC}</p></div>
    <ul className="video-selection-rules" data-video-selection-rules="true">{view.rules.map(rule=><li key={rule.id} data-video-selection-rule={rule.id} data-video-selection-rule-value={rule.value}>
      <b>{rule.label}</b><span data-video-selection-rule-text="true">{rule.value}</span><small>{rule.detail}</small>
    </li>)}</ul>
    <p className="video-selection-summary" data-video-selection-summary="true">{view.summary}</p>
    <p className="video-selection-duration" data-video-selection-duration-text="true">{view.durationSummary}</p>
    {view.notes.map((note,index)=><p className="video-selection-note" key={note} data-video-selection-note={index}>{note}</p>)}
    <p className="video-selection-hint" data-video-selection-hint="true">下面的帧清单只排收录的作品：被舍弃或被手动排除的作品不会出现在帧清单里。</p>
    {view.studentRows.length?<div className="video-selection-students" data-video-selection-students="true">
      <b>每位学员的收录份数</b>
      <small data-video-selection-quota-note="true">{VIDEO_SELECTION_QUOTA_NOTE}</small>
      <ul>{view.studentRows.map(row=><li key={row.name} data-video-selection-student={row.name}
        data-video-selection-student-count={row.count} data-video-selection-student-kept={row.kept}
        data-video-selection-student-quota={row.quota} data-video-selection-student-floor={row.floorMet?'met':'missed'}>
        <span>{row.name}</span><em data-video-selection-student-note="true">{row.note}</em>
      </li>)}</ul>
    </div>:null}
    <ol className="video-selection-list" data-video-selection-list="true">
      {view.rows.map(row=><li key={row.id} className={`video-selection-row is-${row.state}`} data-video-selection-row={row.id}
        data-video-selection-row-state={row.state} data-video-selection-row-date={row.date}
        data-video-selection-row-student={row.student} data-video-selection-row-title={row.title}>
        <div className="video-selection-row-head">
          <b data-video-selection-row-title-label="true">{row.title}</b>
          <span>{row.date}{row.student?` · ${row.student}`:''}</span>
        </div>
        <em className="video-selection-state" data-video-selection-row-label="true">{row.stateLabel}</em>
        {row.action?<button type="button" className="video-selection-toggle" data-video-selection-toggle={row.id} data-video-selection-toggle-action={row.action} onClick={()=>onToggleExclude(row.id)}>{row.actionLabel}</button>:null}
        <small data-video-selection-row-note="true">{row.note}</small>
      </li>)}
    </ol>
    {view.empty?<p className="video-jobs-empty" data-video-selection-empty="true">{view.emptyText}</p>:null}
  </section>;
}

/**
 * 成片帧清单（时间线预览，[第四步 US-215]）：帧序规则五行 + 每一帧的起止与字幕 + 内容边界。
 *
 * 判据与文案全部来自 `data/videoTimeline.js`（组件只渲染产物，不自己算时长、不自己拼字幕说明）：
 *  - 帧序规则（片头 3 秒 / 作品帧 3.5 秒 / 每 4 幅作品插 1 张照片 2 秒 / 片尾 4 秒 /
 *    统一 0.5 秒交叉淡入）与每一帧的 `startSec / endSec` 同源，因此清单上的时间与规则必然对得上；
 *  - 字幕是点评「美术能力」首句（≤24 字，逐字来自老师确认后的点评）—— 缺点评的帧如实写「字幕留空」，
 *    不编一句顶上；超长只在停顿处截断（`subtitleText` 说明这一点）；
 *  - **这里只出清单、不出片**：这一块里没有成片地址、封面或下载入口
 *    （`data-video-timeline-mp4="none"`），「成片内容边界」四行（原图 / 推理轨迹 / 内部提示词 /
 *    联系方式）让老师提交前就能看见边界。
 */
function VideoTimelinePreview({plan,endingNote,onEndingNote}){
  const view=videoTimelineView(plan);
  return <section className="video-timeline" data-video-timeline="true"
    data-video-timeline-frames={view.counts.frames} data-video-timeline-artworks={view.counts.artworks}
    data-video-timeline-photos={view.counts.photos} data-video-timeline-total={view.totalSec}
    data-video-timeline-total-text={view.totalText} data-video-timeline-mp4="none"
    data-video-timeline-clean={view.clean?'true':'false'} data-video-timeline-issue={view.contentIssue}
    data-video-timeline-subtitles={view.subtitleCount}>
    <div className="archive-section-head"><span>按帧序规则推演 · 只出清单不出片</span><h4>{VIDEO_TIMELINE_SECTION_TITLE}</h4><p>{VIDEO_TIMELINE_SECTION_DESC}</p></div>
    <ul className="video-timeline-rules" data-video-timeline-rules="true">{view.rules.map(rule=><li key={rule.id} data-video-timeline-rule={rule.id} data-video-timeline-rule-value={rule.value}>
      <b>{rule.label}</b><span data-video-timeline-rule-text="true">{rule.value}</span><small>{rule.detail}</small>
    </li>)}</ul>
    <p className="video-timeline-summary" data-video-timeline-summary="true">{view.summary}</p>
    <p className="video-timeline-order" data-video-timeline-order-text="true">{view.orderText}</p>
    <small className="video-timeline-order-note" data-video-timeline-order-note="true">{view.orderNote}</small>
    {view.notes.map((note,index)=><p className="video-timeline-note" key={note} data-video-timeline-note={index}>{note}</p>)}
    <p className="video-timeline-no-output" data-video-timeline-no-output="true">{view.noOutputNote}</p>
    <label className="video-timeline-ending">片尾寄语（选填，≤{view.endingNoteMaxChars} 字）
      <textarea value={endingNote} maxLength={view.endingNoteMaxChars} rows={2} data-video-timeline-ending-field="true" aria-label="片尾寄语" onChange={event=>onEndingNote(event.target.value)}/>
    </label>
    {view.endingNoteIssue?<p className="video-jobs-issue" data-video-timeline-ending-issue="true">{view.endingNoteIssue}</p>:null}
    <ol className="video-timeline-list" data-video-timeline-list="true">
      {view.frames.map(frame=><li key={frame.id} className={`video-frame is-${frame.kind}`} data-video-frame={frame.kind}
        data-video-frame-index={frame.index} data-video-frame-start={frame.startSec} data-video-frame-end={frame.endSec}
        data-video-frame-duration={frame.durationSec} data-video-frame-time={frame.timeText} data-video-frame-date={frame.date}
        data-video-frame-lesson-no={frame.lessonNo||''} data-video-frame-date-text={frame.dateText}
        data-video-frame-title={frame.titleText} data-video-frame-subtitle={frame.subtitle}
        data-video-frame-subtitle-truncated={frame.subtitleTruncated?'true':'false'}
        data-video-frame-subtitle-verbatim={frame.subtitle&&!frame.boundaryIssue?'true':'false'}
        data-video-frame-asset={frame.asset.ready?'ready':frame.asset.status}>
        <header><b data-video-frame-index-label="true">{frame.indexLabel} · {frame.kindLabel}</b><span data-video-frame-time-label="true">{frame.timeText}</span><em data-video-frame-duration-label="true">{frame.durationText}</em></header>
        <div className="video-frame-body">
          {frame.asset.ready?<img src={frame.asset.url} alt={`${frame.titleText}帧`} loading="lazy" decoding="async" data-video-frame-image="true"/>:null}
          <div>
            <p className="video-frame-title" data-video-frame-title-label="true">{frame.titleText}{frame.dateText?` · ${frame.dateText}`:''}</p>
            {frame.lines.length?<ul className="video-frame-lines">{frame.lines.map((line,index)=><li key={line} data-video-frame-line={index}>{line}</li>)}</ul>:null}
            {frame.kind===VIDEO_FRAME_KINDS.artwork?<p className={`video-frame-subtitle${frame.subtitle?'':' is-empty'}`} data-video-frame-subtitle-line="true">{frame.subtitle||'（这一帧没有字幕）'}</p>:null}
            {frame.kind===VIDEO_FRAME_KINDS.artwork?<small className="video-frame-subtitle-note" data-video-frame-subtitle-note="true">{frame.subtitleText}</small>:null}
            <small className="video-frame-asset-note" data-video-frame-asset-note="true">{frame.assetNote}</small>
            <small className="video-frame-transition" data-video-frame-transition="true">{frame.transitionText}</small>
          </div>
        </div>
      </li>)}
    </ol>
    {view.empty?<p className="video-jobs-empty" data-video-timeline-empty="true">{view.emptyText}</p>:null}
    <div className={`video-timeline-boundary${view.clean?'':' is-issue'}`} data-video-timeline-boundary="true" data-video-timeline-boundary-ok={view.clean?'true':'false'}>
      <b>成片内容边界</b>
      <ul>{view.boundaryRows.map(row=><li key={row.id} data-video-boundary-row={row.id} data-video-boundary-ok={row.ok?'true':'false'}>
        <em>{row.ok?'不进成片':'有问题'}</em><span>{row.label}</span><small>{row.note}</small>
      </li>)}</ul>
      <small data-video-timeline-boundary-note="true">{view.boundaryNote}</small>
      {view.contentIssue?<p className="video-jobs-issue" data-video-timeline-content-issue="true">{view.contentIssue}</p>:null}
    </div>
  </section>;
}

/**
 * 个人成长视频时间线（[第四步 US-217] / [第四步到第一步联通] US-087）：一位孩子的作品按课次日期 + 课时序号
 * 升序串成一条（排序只读课次字段，归档先后不参与）—— 片头写学员与周期、
 * 每幅作品一帧、缺课课次留一张 1.5 秒留白卡、最后给成片信息（时长 / 收录幅数 / 分辨率 / 文件大小）。
 *
 * 判据与文案全部来自 `data/videoPersonal.js`（组件只渲染产物）：
 *  - 串联顺序、留白卡时长与文案上限、片头的「学员姓名 · 周期」、成片信息里的「预估」两个字
 *    都是数据层拼好的 —— 组件不自己算时长、也不自己写「预估」；
 *  - **只在个人档案下渲染**：班级集锦按学员分段的编排属于 US-218，这里不给班级档案留错配的入口；
 *  - 卡片上的文案 ≤16 字由 `videoAbsenceCardIssue` 判据兜住（`data-personal-absence-issue`），
 *    文案来源（老师的缺课记录原文 / 统一短句）写成卡片**旁边**的旁注，不写进卡片；
 *  - 这一块只出时间线：没有成片地址、封面或下载入口（`data-personal-video-mp4="none"`）。
 */
function VideoPersonalTimeline({plan}){
  const view=videoPersonalView(plan);
  return <section className="video-personal" data-personal-video="true"
    data-personal-video-object={view.objectName} data-personal-video-period={view.period}
    data-personal-video-intro-line={view.introLine} data-personal-video-frames={view.frameCount}
    data-personal-video-artworks={view.artworkCount} data-personal-video-photos={view.photoCount}
    data-personal-video-absence={view.absenceCount} data-personal-video-absence-sec={view.absenceSec}
    data-personal-video-duration={view.totalSec} data-personal-video-duration-text={view.totalText}
    data-personal-video-foreign={view.foreignCount} data-personal-video-ownership={view.ownershipOk?'true':'false'}
    data-personal-video-clean={view.clean?'true':'false'} data-personal-video-mp4="none"
    data-personal-video-demo={view.demoLabel} data-personal-video-has-output="false">
    <div className="archive-section-head"><span>{view.demoLabel} · 时间线 mock</span><h4>{VIDEO_PERSONAL_SECTION_TITLE}</h4><p>{VIDEO_PERSONAL_SECTION_DESC}</p></div>
    <ul className="video-personal-rules" data-personal-rules="true">{view.rules.map(rule=><li key={rule.id} data-personal-rule={rule.id} data-personal-rule-value={rule.value}>
      <b>{rule.label}</b><span data-personal-rule-text="true">{rule.value}</span><small>{rule.detail}</small>
    </li>)}</ul>
    <div className="video-personal-intro" data-personal-intro="true" data-personal-intro-line={view.introLine} data-personal-intro-title={view.introTitle}>
      <b data-personal-intro-label="true">{view.introLine}</b>
      <small>片头：学员姓名 · 周期 · 标题「{view.introTitle}」</small>
    </div>
    <p className="video-personal-summary" data-personal-summary="true">{view.summary}</p>
    <p className="video-personal-order" data-personal-order-text="true">{view.orderText}</p>
    <small className="video-personal-order-note" data-personal-order-note="true">{view.orderNote}</small>
    {view.notes.map((note,index)=><p className="video-personal-note" key={note} data-personal-note={index}>{note}</p>)}
    <p className="video-personal-no-output" data-personal-no-output="true">{view.noOutputNote}</p>
    <ol className="video-personal-list" data-personal-frame-list="true">
      {view.frames.map(frame=><li key={frame.id} className={`video-personal-frame is-${frame.kind}`} data-personal-frame={frame.kind}
        data-personal-frame-index={frame.index} data-personal-frame-date={frame.date}
        data-personal-frame-lesson-no={frame.lessonNo||''} data-personal-frame-date-text={frame.dateText}
        data-personal-frame-start={frame.startSec} data-personal-frame-end={frame.endSec}
        data-personal-frame-duration={frame.durationSec} data-personal-frame-time={frame.timeText}
        data-personal-frame-title={frame.titleText} data-personal-frame-subtitle={frame.subtitle}
        data-personal-frame-source-student={frame.sourceStudent}>
        <header><b data-personal-frame-index-label="true">{frame.indexLabel} · {frame.kindLabel}</b><span data-personal-frame-time-label="true">{frame.timeText}</span><em data-personal-frame-duration-label="true">{frame.cardDurationText||frame.durationText}</em></header>
        <div className="video-personal-frame-body">
          {frame.asset.ready?<img src={frame.asset.url} alt={`${frame.titleText}帧`} loading="lazy" decoding="async" data-personal-frame-image="true"/>:null}
          {frame.isAbsence
            ? <div className="video-personal-absence-card" data-personal-absence-card="true" data-personal-absence-text={frame.cardText} data-personal-absence-issue={frame.cardIssue} data-personal-absence-duration={frame.durationSec} data-personal-absence-date={frame.date}>
              <b data-personal-absence-text-label="true">{frame.cardText}</b>
            </div>
            : <div>
              <p className="video-personal-frame-title" data-personal-frame-title-label="true">{frame.titleText}{frame.dateText?` · ${frame.dateText}`:''}</p>
              {frame.lines.length?<ul className="video-personal-frame-lines">{frame.lines.map((line,index)=><li key={line} data-personal-frame-line={index}>{line}</li>)}</ul>:null}
              {frame.kind===VIDEO_FRAME_KINDS.artwork?<p className={`video-personal-frame-subtitle${frame.subtitle?'':' is-empty'}`} data-personal-frame-subtitle-line="true">{frame.subtitle||'（这一帧没有字幕）'}</p>:null}
            </div>}
        </div>
        {frame.isAbsence?<small className="video-personal-frame-note" data-personal-absence-note="true">{frame.cardNote}</small>:null}
        {!frame.isAbsence&&frame.kind!==VIDEO_FRAME_KINDS.intro&&frame.kind!==VIDEO_FRAME_KINDS.ending?<small className="video-personal-frame-note" data-personal-frame-note="true">{frame.assetNote}</small>:null}
      </li>)}
    </ol>
    {view.empty?<p className="video-jobs-empty" data-personal-empty="true">{view.emptyText}</p>:null}
    <div className="video-personal-info" data-personal-info="true" data-personal-info-estimated={view.infoRows.filter(row=>row.estimated).map(row=>row.id).join(',')}>
      <b>成片信息</b>
      <ul>{view.infoRows.map(row=><li key={row.id} data-personal-info-row={row.id} data-personal-info-estimated={row.estimated?'true':'false'} data-personal-info-value={row.value}>
        <span>{row.label}</span><em data-personal-info-value-label="true">{row.value}</em>{row.estimated?<span className="video-personal-info-badge" data-personal-info-estimate-badge="true">{row.estimateText}</span>:null}<small>{row.hint}</small>
      </li>)}</ul>
      <small data-personal-info-note="true">{view.estimateNote}</small>
    </div>
    <div className={`video-personal-scope${view.clean?'':' is-issue'}`} data-personal-scope="true" data-personal-scope-ok={view.clean?'true':'false'} data-personal-scope-foreign={view.foreignCount}>
      <b>收录范围：只收录该学员自己的作品</b>
      <small data-personal-scope-note="true">{view.foreignNote}</small>
      {view.foreignEntries.length?<ul data-personal-foreign-list="true">{view.foreignEntries.map(entry=><li key={entry.id} data-personal-foreign-row={entry.id} data-personal-foreign-student={entry.student} data-personal-foreign-date={entry.date} data-personal-foreign-title={entry.title}>
        <span>{entry.student}</span><em>{entry.date} · {entry.title}</em>
      </li>)}</ul>:null}
      {view.ownershipIssue?<p className="video-jobs-issue" data-personal-ownership-issue="true">{view.ownershipIssue}</p>:null}
      {view.cardIssue?<p className="video-jobs-issue" data-personal-card-issue="true">{view.cardIssue}</p>:null}
    </div>
  </section>;
}

/**
 * 班级视频集锦（[第四步 US-218]）：全班按学员分段串成一条时间线 —— 每位学员一段，
 * 段首 1.5 秒姓名卡写着姓名与作品数，段内按课次日期 + 课时序号升序排（[第四步到第一步联通] US-087）；
 * 本期没有作品的学员保留一张留白卡。
 *
 * 判据与文案全部来自 `data/videoClass.js`（组件只渲染产物）：
 *  - 分段方式、姓名卡那一行（姓名 + 作品数）、留白卡文案与时长、「不串档」判据都是数据层给的；
 *  - **只在班级档案下渲染**：个人档案下走 `VideoPersonalTimeline`（US-217），这里不给个人档案留错配的入口；
 *  - 顺序默认按班级名单，生成前可调整：上移 / 下移只重排分段顺序（判据与换位算法在数据层），
 *    「恢复班级名单顺序」把调整清掉；
 *  - 卡片元素里**只放那一句话**（姓名卡文案 / 留白卡文案）：时长标签与来源说明都写在卡片**外面**，
 *    这样 DOM 上的「卡片文案 ≤16 字」判据才站得住；
 *  - 这一块只出时间线：没有成片地址、封面或下载入口（`data-class-video-mp4="none"`）。
 */
function VideoClassTimeline({plan,view,onMove,onReset}){
  const framesOfSegment=index=>view.frames.filter(frame=>frame.segmentIndex===index&&!frame.isNameCard&&!frame.isBlank);
  const studentOf=name=>view.studentRows.find(row=>row.name===name)||{count:0,kept:0,note:''};
  return <section className="video-class" data-class-video="true"
    data-class-video-object={view.objectName} data-class-video-period={view.period}
    data-class-video-intro-line={view.introLine} data-class-video-frames={view.frameCount}
    data-class-video-segments={view.segmentCount} data-class-video-artworks={view.artworkCount}
    data-class-video-photos={view.photoCount} data-class-video-name-cards={view.nameCardCount}
    data-class-video-blanks={view.blankCount} data-class-video-empty-segments={view.emptySegmentCount}
    data-class-video-duration={view.totalSec} data-class-video-duration-text={view.totalText}
    data-class-video-cap={view.capSec} data-class-video-within-cap={view.withinCap?'true':'false'}
    data-class-video-over-cap={view.overCap?'true':'false'} data-class-video-dropped={view.droppedEntries.length}
    data-class-video-external={view.externalLessons} data-class-video-order-changed={view.orderChanged?'true':'false'}
    data-class-video-crosstalk={view.crossTalkOk?'true':'false'} data-class-video-clean={view.clean?'true':'false'}
    data-class-video-mp4="none" data-class-video-demo={view.demoLabel} data-class-video-has-output="false">
    <div className="archive-section-head"><span>{view.demoLabel} · 分段集锦 mock</span><h4>{VIDEO_CLASS_SECTION_TITLE}</h4><p>{VIDEO_CLASS_SECTION_DESC}</p></div>
    <ul className="video-class-rules" data-class-rules="true">{view.rules.map(rule=><li key={rule.id} data-class-rule={rule.id} data-class-rule-value={rule.value}>
      <b>{rule.label}</b><span data-class-rule-text="true">{rule.value}</span><small>{rule.detail}</small>
    </li>)}</ul>
    <div className="video-class-intro" data-class-intro="true" data-class-intro-line={view.introLine}>
      <b data-class-intro-label="true">{view.introLine}</b>
      <small>片头：班级名 · 周期 · 标题「{view.introTitle}」</small>
    </div>
    <div className="video-class-order" data-class-order="true" data-class-order-current={view.currentOrder.join(' > ')} data-class-order-default={view.defaultOrder.join(' > ')}>
      <b>学员顺序（{view.orderText}）</b>
      <small data-class-order-note="true">{view.orderNote}</small>
      <small className="video-class-frame-order-note" data-class-frame-order-note="true">{`段内帧序：${view.frameOrderText}（${view.frameOrderNote}）`}</small>
      <ul data-class-order-list="true">{view.segments.map((row,index)=><li key={row.student||index} data-class-order-row={row.student}
        data-class-order-position={row.position} data-class-order-count={studentOf(row.student).count} data-class-order-kept={studentOf(row.student).kept}
        data-class-order-empty={row.isEmpty?'true':'false'}>
        <span data-class-order-name="true">{row.positionLabel} · {row.studentLabel}</span>
        <em data-class-order-note-text="true">{studentOf(row.student).note}</em>
        <button type="button" data-class-order-move="up" data-class-order-move-index={index} disabled={!row.canUp} onClick={()=>onMove(index,-1)}>{VIDEO_CLASS_MOVE_UP_LABEL}</button>
        <button type="button" data-class-order-move="down" data-class-order-move-index={index} disabled={!row.canDown} onClick={()=>onMove(index,1)}>{VIDEO_CLASS_MOVE_DOWN_LABEL}</button>
      </li>)}</ul>
      <button type="button" data-class-order-reset="true" disabled={!view.orderChanged} onClick={onReset}>{VIDEO_CLASS_ORDER_RESET_LABEL}</button>
    </div>
    <p className="video-class-summary" data-class-summary="true">{view.summary}</p>
    <p className="video-class-cap" data-class-cap="true" data-class-cap-within={view.withinCap?'true':'false'}>{`总时长 ${view.totalText} / ${view.capText}`}</p>
    {view.notes.map((note,index)=><p className="video-class-note" key={note} data-class-note={index}>{note}</p>)}
    <p className="video-class-no-output" data-class-no-output="true">{view.noOutputNote}</p>
    <ol className="video-class-list" data-class-segment-list="true">
      {view.segments.map(row=><li key={row.student||row.index} className={`video-class-segment${row.isEmpty?' is-empty':''}`} data-class-segment={row.student}
        data-class-segment-index={row.index} data-class-segment-student={row.studentLabel}
        data-class-segment-declared={row.declaredCount} data-class-segment-artworks={row.artworkCount}
        data-class-segment-photos={row.photoCount} data-class-segment-empty={row.isEmpty?'true':'false'}
        data-class-segment-date={row.dateText} data-class-segment-start={row.startSec} data-class-segment-end={row.endSec}
        data-class-segment-duration={row.durationSec} data-class-segment-time={row.timeText}
        data-class-segment-blank-text={row.blankText}>
        <header><b data-class-segment-position="true">{row.positionLabel} · {row.studentLabel}</b><span data-class-segment-time-label="true">{row.timeText}</span><em data-class-segment-duration-label="true">{row.durationText}</em></header>
        <div className="video-class-name-card" data-class-name-card="true" data-class-name-card-text={row.nameCardText}
          data-class-name-card-declared={row.declaredCount} data-class-name-card-segment={row.index} data-class-name-card-duration={view.nameCardDurationSec}>
          <b data-class-name-card-label="true">{row.nameCardText}</b>
        </div>
        <small className="video-class-name-card-note" data-class-name-card-note="true">段首 1.5 秒姓名卡 · 本段收录 {row.artworkCount} 幅{row.dateText?` · 课次 ${row.dateText}`:''}</small>
        {framesOfSegment(row.index).length?<ol className="video-class-frames" data-class-frame-list="true">{framesOfSegment(row.index).map(frame=><li key={frame.id} className={`video-class-frame is-${frame.kind}`} data-class-frame={frame.kind}
          data-class-frame-index={frame.index} data-class-frame-segment={row.index} data-class-frame-student={frame.sourceStudent}
          data-class-frame-date={frame.date} data-class-frame-lesson-no={frame.lessonNo||''} data-class-frame-date-text={frame.dateText}
          data-class-frame-title={frame.titleText} data-class-frame-subtitle={frame.subtitle}
          data-class-frame-start={frame.startSec} data-class-frame-end={frame.endSec} data-class-frame-duration={frame.durationSec}>
          <header><b data-class-frame-kind-label="true">{frame.kindLabel}</b><span data-class-frame-time-label="true">{frame.timeText}</span><em data-class-frame-duration-label="true">{frame.durationText}</em></header>
          <div className="video-class-frame-body">
            {frame.asset.ready?<img src={frame.asset.url} alt={`${frame.titleText}帧`} loading="lazy" decoding="async" data-class-frame-image="true"/>:null}
            <div>
              <p className="video-class-frame-title" data-class-frame-title-label="true">{frame.titleText}{frame.dateText?` · ${frame.dateText}`:''}</p>
              {frame.kind===VIDEO_FRAME_KINDS.artwork?<p className={`video-class-frame-subtitle${frame.subtitle?'':' is-empty'}`} data-class-frame-subtitle-line="true">{frame.subtitle||'（这一帧没有字幕）'}</p>:null}
            </div>
          </div>
          <small className="video-class-frame-note" data-class-frame-note="true">{frame.assetNote}</small>
        </li>)}</ol>:null}
        {row.isEmpty?<div className="video-class-blank-card" data-class-blank-card="true" data-class-blank-text={row.blankText} data-class-blank-duration={view.blankDurationSec} data-class-blank-segment={row.index}>
          <b data-class-blank-label="true">{row.blankText}</b>
        </div>:null}
        {row.isEmpty?<small className="video-class-frame-note" data-class-blank-note="true">{row.blankNote}</small>:null}
      </li>)}
    </ol>
    {view.empty?<p className="video-jobs-empty" data-class-empty="true">{view.emptyText}</p>:null}
    <div className="video-class-info" data-class-info="true" data-class-info-estimated={view.infoRows.filter(row=>row.estimated).map(row=>row.id).join(',')}>
      <b>成片信息</b>
      <ul>{view.infoRows.map(row=><li key={row.id} data-class-info-row={row.id} data-class-info-estimated={row.estimated?'true':'false'} data-class-info-value={row.value}>
        <span>{row.label}</span><em data-class-info-value-label="true">{row.value}</em>{row.estimated?<span className="video-class-info-badge" data-class-info-estimate-badge="true">{row.estimateText}</span>:null}<small>{row.hint}</small>
      </li>)}</ul>
      <small data-class-info-note="true">{view.estimateNote}</small>
    </div>
    <div className={`video-class-crosstalk${view.clean?'':' is-issue'}`} data-class-crosstalk="true" data-class-crosstalk-ok={view.crossTalkOk?'true':'false'}>
      <b>姓名卡与作品不串档</b>
      <small data-class-crosstalk-note="true">{view.crossTalkNote}</small>
      {view.crossTalkIssue?<p className="video-jobs-issue" data-class-crosstalk-issue="true">{view.crossTalkIssue}</p>:null}
      {view.cardIssue?<p className="video-jobs-issue" data-class-card-issue="true">{view.cardIssue}</p>:null}
    </div>
  </section>;
}

/**
 * 移动端与弱网读数（[第四步 US-224]）。
 *
 * 这一块**不写结论，只显示当场量出来的读数**（判据与文案全部来自 `data/videoMobile.js`，
 * 组件不自己判「溢出了没有」、也不自己拼「几项合格」）：
 *  - 逐块横向溢出测量（页面整体 / 任务面板 / 卡片列表 / 任务卡片 / 音乐选择面板 / 预览 / 成片版本面板）；
 *  - 播放器占位的实测盒子 + 竖屏自适应判定（9:16、高 ≤70vh、不超视口宽）；
 *  - 全屏接口在这台设备上可不可用（不可用时如实说明，不假装能全屏）；
 *  - 弱网那两条：同一条 jobKey 只有一条任务（镜像里的键 vs 界面上的卡片）+ 本次挡下几次重复点击、
 *    回到前台补推进了几次。
 * 「重新测量」按钮给老师（与验证脚本）一个当场复量的入口；视口变化（resize / 转屏）也会自动重量一次。
 */
function VideoMobilePanel({view, notice, onMeasure}){
  return <section className="video-mobile" data-video-mobile="true"
    data-video-mobile-viewport={`${view.viewportWidth}×${view.viewportHeight}`}
    data-video-mobile-mobile-width={view.mobileWidth?'true':'false'}
    data-video-mobile-ok={view.ok?'true':'false'}
    data-video-mobile-failed={view.failedIds.join(',')}
    data-video-mobile-overflow-state={view.overflowState}
    data-video-mobile-overflow={view.offenders.join(',')}
    data-video-mobile-player={view.player?`${Math.round(view.player.width)}×${Math.round(view.player.height)}`:'none'}
    data-video-mobile-player-portrait={view.playerFit&&view.playerFit.portrait?'true':'false'}
    data-video-mobile-player-height-pct={view.playerFit?String(view.playerFit.heightPct):''}
    data-video-mobile-fullscreen-supported={view.fullscreenSupported?'true':'false'}
    data-video-mobile-mirror={String(view.mirrorCount)}
    data-video-mobile-cards={String(view.cardCount)}
    data-video-mobile-duplicates={String(view.duplicateKeys)}
    data-video-mobile-blocked={String(view.blocked)}
    data-video-mobile-visibility-resumes={String(view.visibilityResumes)}
    data-video-mobile-summary-text={view.summary}>
    <div className="archive-section-head"><span>当场量出来的四条读数</span><h4>{VIDEO_MOBILE_SECTION_TITLE}</h4><p>{VIDEO_MOBILE_SECTION_DESC}</p></div>
    <ul className="video-mobile-rows" data-video-mobile-rows="true">
      {view.rows.map(row=><li key={row.id} data-video-mobile-row={row.id} data-video-mobile-row-ok={row.ok?'true':'false'} data-video-mobile-row-value={row.value}>
        <b data-video-mobile-row-label="true">{row.label}</b>
        <span data-video-mobile-row-text="true">{row.value}</span>
        {row.note?<small data-video-mobile-row-note="true">{row.note}</small>:null}
      </li>)}
    </ul>
    <ul className="video-mobile-targets" data-video-mobile-targets="true">
      {view.overflowRows.map(row=><li key={row.id} data-video-mobile-target={row.id}
        data-video-mobile-target-missing={row.missing?'true':'false'} data-video-mobile-target-overflow={row.overflow?'true':'false'}
        data-video-mobile-target-scroll={String(row.scrollWidth)} data-video-mobile-target-client={String(row.clientWidth)}>
        <span>{row.label}</span>
        <b data-video-mobile-target-value="true">{row.missing?'不在页面上':`${row.scrollWidth} / ${row.clientWidth}px`}</b>
      </li>)}
    </ul>
    <p className="video-jobs-note" data-video-mobile-lock-note="true">{VIDEO_JOB_SUBMIT_LOCK_TEXT}</p>
    <p className="video-mobile-summary" data-video-mobile-summary="true">{view.summary}</p>
    <div className="video-mobile-actions">
      <Button variant="secondary" icon={Gauge} data-video-mobile-measure="true" onClick={onMeasure}>重新测量</Button>
    </div>
    {notice?<p className="video-mobile-notice" data-video-mobile-notice="true">{notice}</p>:null}
  </section>;
}

/**
 * 视频任务（演示队列）面板（[第四步 US-213a]，[第四步 US-214] 补入口 / 预估剩余时间 / 恢复读数）。
 *
 * 这一块是「渲染服务还没接进来，但前端不能空等」的落地：
 *  - 「成长记录（视频）」类型下提供**生成入口**（`VIDEO_JOB_SUBMIT_LABEL`）：提交后立即拿到 jobKey
 *    并进入下面的任务卡片，卡片上有状态、进度百分比与预估剩余时间；
 *  - 提交 / 取消 / 重试三个动作全部转给 `services/videoJobQueue.js`（判据在 data 层），
 *    被拒时把 `issue` 原样显示，不自己编文案；
 *  - 进面板先 `resumeVideoJobQueue()`：刷新 / 重新进入后按真实经过时间接上正在跑的任务，
 *    并按 jobKey 把进行中的任务标成「已恢复」（`resumedAt` = 本次挂载时刻）；
 *  - **类型跟着「查看对象」走**（个人档案 = 个人成长视频、班级档案 = 班级视频集锦），
 *    不给「选了班级却提交个人视频」这种错配留入口；
 *  - 「演示失败 + 失败原因」是队列自身的演示能力（走到 45% 时按选中的那类原因失败），
 *    用来验证失败态、四套文案与重试，不是产品规则 —— 真实的渲染失败由服务端返回。
 *
 * 成片内容规则（[第四步 US-215]）：提交区下面多一块**帧清单（时间线预览）** —— 它按当前
 * 「查看对象 + 生成周期」把归档条目串成帧列表（`entries` 由档案页按 `videoPeriod` 过滤后传进来），
 * 片尾寄语是这一块自己的输入（不写进任务、也不落库）。
 *
 * 个人成长视频的编排（[第四步 US-217]）：个人档案下再往下多一块**个人成长视频时间线** ——
 * 它在收录清单（US-216）之上补三件个人成片专属的事：片头写「学员姓名 · 周期」、缺课的课次留
 * 1.5 秒留白卡、成片信息（时长 / 幅数 / 分辨率 / 文件大小，推算值带「预估」）。
 * 它读的是 `scopeEntries`（这个周期**全部学员**的记录）：学员隔离由数据层做 ——
 * 「只收录该学员自己的作品」不是靠这里传对了参数，而是靠 `videoPersonalPlan` 自己按学员名过滤并如实报数。
 *
 * 班级视频集锦的编排（[第四步 US-218]）：班级档案下多一块**班级视频集锦时间线** —— 每位学员一段、
 * 段首 1.5 秒姓名卡（姓名 + 作品数）、本期无作品的学员保留留白卡、全班串成一条且总时长不超过 5 分钟。
 * 它读的是 `classEntries`（这个班级在这个周期的记录）与 `roster`（班级名单 = 顺序真源）；
 * 「顺序默认按班级名单、生成前可调整」用面板自己的 `classOrder` 局部 state 实现。
 *
 * 移动端与弱网（[第四步 US-224]）：四条验收在界面上都是**当场量出来的读数**，不是写死的结论 ——
 *  - **提交后可离开页面 / 锁屏回来**：面板挂载 `resumeVideoJobQueue()`；`visibilitychange` / `pageshow`
 *    回到前台再补推进一次（`attachVideoJobVisibilityResume`），进度按真实经过时间接着算；
 *  - **播放器占位竖屏自适应并支持全屏**：占位盒子的宽度 = `min(容器宽, 70vh × 9/16)`（CSS 与
 *    `data/videoMobile.js` 的 `videoPlayerBox` 同值），全屏按钮挂在占位元素上（标准 / webkit 两条路，
 *    失败给可读原因，不伪造一个静默失效的控件）；
 *  - **弱网重复点击不创建多条任务**：`data/videoMobile.js` 的 `VIDEO_JOB_SUBMIT_LOCK_MS` 是一道
 *    **按 jobKey** 的提交锁窗（窗口内的重复点击直接忽略并计数），结构性保证仍是服务层按 jobKey upsert；
 *  - **390px 不溢出**：`measureVideoOverflow()` 按 `VIDEO_MOBILE_TARGETS` 逐块量 `scrollWidth / clientWidth`。
 *  六行读数与逐块测量都渲染在 `VideoMobilePanel`（`data-video-mobile-*`）。
 */
/**
 * 班级集体海报（[海报 US-305] / FR-315、FR-321、FR-322）：「全班每个孩子一格」的作品墙。
 *
 * 三件事都在数据层，组件只渲染产物 + 三个动作：
 *  - 格子从**学员**来（顺序真源 = 班级名单，名单之外但本期有记录的学员接在后面），每位学员取本周期
 *    **最新一幅**成品图；本期没有作品的学员**保留占位格**（格内写「本期暂无作品」，展签仍是姓名）——
 *    「跳过某位孩子」在所有路径上都不会发生（FR-321）。
 *  - 学员数超过上限（默认 30）**不裁剪**：按顺序分批，一次出一批（`plan.batch`），文件名带 `1of2`
 *    页码；`分批导出全部` 逐批渲染下载（FR-322；打包 zip 不在本期）。
 *  - 顺序默认按名单、生成前可调整：上移 / 下移只改这一张海报的排布（`posterClassMoveOrder`），
 *    不动班级名单本身；恢复班级名单顺序把调整清掉。
 *
 * `data-poster-class-*` 上的读数全部来自 `buildPosterClassPlan()` 的产物（界面不自己重算一遍）。
 */
function ClassPosterPanel({className,roster=[],records=[],tokens=[],teacherName='',orgName='',logo='',setToast=()=>{}}){
  const [period,setPeriod]=useState(POSTER_CLASS_DEFAULT_PERIOD);
  // 顺序调整、姓名标注开关、当前出图批次：都是「这一次生成」的局部 state（不落库、不进班级名单）。
  const [order,setOrder]=useState(null);
  const [nameCaptions,setNameCaptions]=useState(true);
  const [batchIndex,setBatchIndex]=useState(1);
  const [preview,setPreview]=useState({key:'',url:'',phase:'idle',warnings:[],width:0,height:0});
  const [notice,setNotice]=useState({phase:'idle',message:''});
  const [busy,setBusy]=useState(false);
  const shareOrigin=typeof window==='undefined'?'':(window.location?.origin||'');
  const plan=useMemo(()=>buildPosterClassPlan({
    records,className,roster,period,order,batchIndex,tokens,today:null,
    teacherName,orgName,logo,origin:shareOrigin,nameCaptions
  }),[records,className,roster,period,order,batchIndex,tokens,teacherName,orgName,logo,shareOrigin,nameCaptions]);
  const gate=posterClassExportGate(plan);
  // 换班级 / 换周期：顺序调整与批次都绑在「这一次出图」上，一起清掉（回执同理）。
  useEffect(()=>{setOrder(null);setBatchIndex(1);setNotice({phase:'idle',message:''})},[className,period]);
  // 预览重绘键 = 真正会改变这张图的所有输入（班级 / 周期 / 本批的格子与顺序 / 模板 / 链接 / 开关）。
  const renderKey=plan.hasClass&&gate.allowed?[
    plan.templateKey,plan.className,plan.periodLabel,plan.batch.index,plan.wall.grid.label,
    plan.batch.cells.map(cell=>`${cell.student}:${cell.hasArtwork?'art':'none'}:${cell.url.slice(-24)}:${cell.caption}`).join(','),
    plan.data.logo,plan.data.shareUrl,plan.wall.nameCaptions?'captions':'no-captions'
  ].join('|'):'';
  useEffect(()=>{
    if(!renderKey){
      setPreview({key:'',url:'',phase:'idle',warnings:[],width:0,height:0});
      return ()=>{};
    }
    let cancelled=false;
    let createdUrl='';
    setPreview({key:renderKey,url:'',phase:'pending',warnings:[],width:0,height:0});
    renderPosterClass(plan,{scale:POSTER_CLASS_PREVIEW_SCALE}).then(rendered=>{
      if(cancelled) return;
      if(!rendered||!rendered.blob){
        setPreview({key:renderKey,url:'',phase:'failed',warnings:[],width:0,height:0});
        return;
      }
      createdUrl=createPosterClassUrl(rendered);
      setPreview({key:renderKey,url:createdUrl,phase:'ready',warnings:rendered.warnings||[],width:rendered.width,height:rendered.height});
    }).catch(()=>{
      if(!cancelled) setPreview({key:renderKey,url:'',phase:'failed',warnings:[],width:0,height:0});
    });
    return ()=>{ cancelled=true; if(createdUrl) releasePosterClassUrl(createdUrl); };
  // 预览随「重绘键」重跑：键里已经包含了 plan 上所有会影响这张图的输入。
  },[renderKey]);
  // 顺序调整：以**当前生效顺序**（`plan.students.ordered`，未调整时就是名单顺序）为底换位。
  const moveStudent=(index,direction)=>{
    setOrder(posterClassMoveOrder(plan.students.ordered,index,direction));
    setNotice({phase:'idle',message:''});
  };
  const resetOrder=()=>{setOrder(null);setNotice({phase:'done',message:POSTER_CLASS_ORDER_RESET_DONE});};
  const exportCurrent=async()=>{
    if(!gate.allowed){setNotice({phase:'blocked',message:gate.reason});return;}
    setBusy(true);
    const result=await exportPosterClassPng(plan);
    setBusy(false);
    if(!result.ok){setNotice({phase:'failed',message:result.reason});return;}
    const message=`班级海报已导出（第 ${plan.batch.index} / ${plan.batch.total} 批）：${result.filename} · ${result.rendered.width}×${result.rendered.height} · ${artworkExportSizeText(result.bytes)}`;
    setNotice({phase:'done',message});
    setToast(`${result.filename} 已下载`);
  };
  const exportAllBatches=async()=>{
    if(!gate.allowed){setNotice({phase:'blocked',message:gate.reason});return;}
    setBusy(true);
    const result=await exportPosterClassBatches(plan);
    setBusy(false);
    if(!result.count){setNotice({phase:'failed',message:result.reason||POSTER_CLASS_RENDER_FAILED_TEXT});return;}
    const message=`分批导出完成：${result.count} / ${result.total} 批已下载（${result.filenames.join('、')}）`;
    setNotice({phase:result.ok?'done':'failed',message});
    setToast(`已下载 ${result.count} 张班级海报`);
  };
  const state=!plan.hasClass
    ?'empty'
    :(!gate.allowed?'blocked':(preview.phase==='ready'?'ready':preview.phase));
  const cellsView=plan.batch.cells;
  return (
    <section className="poster-class" data-poster-class="true"
      data-poster-class-state={state}
      data-poster-class-template={plan.templateKey}
      data-poster-class-canvas={`${plan.spec.canvas.width}x${plan.spec.canvas.height}`}
      data-poster-class-name={plan.className}
      data-poster-class-period={plan.period}
      data-poster-class-period-label={plan.periodLabel}
      data-poster-class-window-from={plan.window.from}
      data-poster-class-window-to={plan.window.to}
      data-poster-class-students={String(plan.students.total)}
      data-poster-class-roster={String(plan.students.roster)}
      data-poster-class-extra={String(plan.students.extra)}
      data-poster-class-artworks={String(plan.students.artworks)}
      data-poster-class-placeholders={String(plan.students.placeholders)}
      data-poster-class-batch={String(plan.batch.index)}
      data-poster-class-batch-total={String(plan.batch.total)}
      data-poster-class-batch-size={String(plan.batch.size)}
      data-poster-class-batch-range={`${plan.batch.from}-${plan.batch.to}`}
      data-poster-class-batch-note={plan.batch.note}
      data-poster-class-batch-filename={plan.batch.filename}
      data-poster-class-grid={plan.wall.grid.label}
      data-poster-class-grid-columns={String(plan.wall.grid.columns)}
      data-poster-class-grid-rows={String(plan.wall.grid.rows)}
      data-poster-class-captions={plan.wall.nameCaptions?'on':'off'}
      data-poster-class-order-adjusted={plan.order.adjusted?'true':'false'}
      data-poster-class-order={plan.students.ordered.join('、')}
      data-poster-class-cell-list={cellsView.map(cell=>`${cell.caption}>${cell.title||POSTER_CLASS_NO_ARTWORK_TEXT}`).join('|')}
      data-poster-class-cell-bindings={cellsView.map(cell=>`${cell.student||POSTER_CLASS_UNNAMED_TEXT}@${cell.hasArtwork?cell.url:'slot'}`).join('|')}
      data-poster-class-export={gate.allowed?'allowed':'blocked'}
      data-poster-class-export-reason={gate.reason}
      data-poster-class-preview={preview.phase}
      data-poster-class-warnings={preview.warnings.join(' / ')}>
      <div className="poster-class-head">
        <Image size={14}/>
        <b>班级集体海报</b>
        <em className={`is-${state}`} data-poster-class-badge="true">{state==='ready'?'已生成':state==='pending'?'生成中':state==='blocked'?'暂无格子':state==='failed'?'生成失败':state==='empty'?'待选班级':'准备中'}</em>
        {plan.templateName?<small data-poster-class-template-name="true">{plan.templateName}</small>:null}
      </div>
      {plan.hasClass?<div className="poster-class-body">
        <div className="poster-class-controls">
          <label>周期<select value={period} onChange={event=>setPeriod(event.target.value)} data-poster-class-period-select="true">{POSTER_CLASS_PERIOD_OPTIONS.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
          <small data-poster-class-range="true">{plan.periodLabel}</small>
          <label className="poster-class-toggle"><input type="checkbox" checked={nameCaptions} onChange={event=>setNameCaptions(event.target.checked)} data-poster-class-captions-toggle="true"/><span>{POSTER_CLASS_CAPTION_TOGGLE_LABEL}</span></label>
          <small data-poster-class-limit="true">单张上限 {plan.batch.limit} 位学员</small>
        </div>
        <p className="poster-class-order-note" data-poster-class-order-note="true">{POSTER_CLASS_ORDER_NOTE}{plan.order.adjusted?`（已调整：${plan.students.ordered.join('、')}）`:''}</p>
        {plan.batch.note?<p className="poster-class-batch-note" data-poster-class-batch-note-line="true">{plan.batch.note}</p>:null}
        {plan.batch.total>1?<div className="poster-class-batch-row" data-poster-class-batch-row="true">
          <span>出图批次</span>
          {plan.batches.map(item=><button type="button" key={item.index} className={item.index===plan.batch.index?'active':''} data-poster-class-batch-pick={String(item.index)} data-poster-class-batch-pick-size={String(item.size)} onClick={()=>setBatchIndex(item.index)}>第 {item.index} 批（{item.size} 位）</button>)}
        </div>:null}
        <figure className="poster-class-preview" data-poster-class-preview-box="true">
          {preview.url
            ?<img src={preview.url} alt={`${plan.className}的班级作品墙预览（1080×1920，第 ${plan.batch.index} 批）`} data-poster-class-image="true"/>
            :<span className="poster-class-hold" data-poster-class-hold="true">{preview.phase==='failed'?'海报没有渲染成功':gate.allowed?'正在生成海报预览…':gate.reason}</span>}
        </figure>
        <div className="poster-class-meta">
          <ul>
            <li data-poster-class-line="class">班级：{plan.className} · 第 {plan.batch.index} / {plan.batch.total} 批（{plan.batch.from}-{plan.batch.to} 位）</li>
            <li data-poster-class-line="period">周期：{plan.periodLabel}</li>
            <li data-poster-class-line="wall">作品墙：{plan.wall.grid.label} 网格（{plan.wall.grid.columns} 列 × {plan.wall.grid.rows} 行）· 本批 {plan.batch.size} 格（作品 {plan.batch.artworks} · {POSTER_CLASS_NO_ARTWORK_TEXT} {plan.batch.placeholders}）</li>
            <li data-poster-class-line="share">分享：{plan.share.pending?POSTER_SINGLE_SHARE_PENDING_TEXT:`链接可用 · ${plan.share.link}`}</li>
          </ul>
          <ol className="poster-class-order-list" data-poster-class-order-list="true" data-poster-class-order-total={String(plan.students.total)}>
            {plan.students.ordered.map((studentName,index)=><li key={studentName||`unnamed-${index}`} data-poster-class-order-row={String(index)} data-poster-class-order-name={studentName}>
              <span data-poster-class-order-label="true">{index+1}. {studentName||POSTER_CLASS_UNNAMED_TEXT}</span>
              <button type="button" data-poster-class-move-up={String(index)} disabled={index===0} onClick={()=>moveStudent(index,-1)}>{POSTER_CLASS_ORDER_MOVE_UP_LABEL}</button>
              <button type="button" data-poster-class-move-down={String(index)} disabled={index===plan.students.ordered.length-1} onClick={()=>moveStudent(index,1)}>{POSTER_CLASS_ORDER_MOVE_DOWN_LABEL}</button>
            </li>)}
          </ol>
          <div className="poster-class-order-actions">
            <button type="button" data-poster-class-order-reset="true" disabled={!plan.order.adjusted} onClick={resetOrder}>{POSTER_CLASS_ORDER_RESET_LABEL}</button>
          </div>
          {plan.notes.length?<ul className="poster-class-notes">
            {plan.notes.map(note=><li key={note} data-poster-class-note="true">{note}</li>)}
          </ul>:null}
          {preview.warnings.length?<p className="poster-class-warning" data-poster-class-warning="true">{preview.warnings.join('；')}</p>:null}
          <div className="poster-class-actions">
            <Button icon={Download} disabled={!gate.allowed||busy} onClick={exportCurrent} data-poster-class-export-button="true">{busy?'正在导出…':gate.allowed?`导出第 ${plan.batch.index} 批 PNG`:'暂时不能导出'}</Button>
            {plan.batch.total>1?<Button variant="secondary" icon={Download} disabled={!gate.allowed||busy} onClick={exportAllBatches} data-poster-class-export-all="true">{`${POSTER_CLASS_BATCH_EXPORT_LABEL} ${plan.batch.total} 张`}</Button>:null}
            {gate.allowed?null:<small data-poster-class-block-reason="true">{gate.reason}</small>}
            {notice.message?<small data-poster-class-notice="true">{notice.message}</small>:null}
          </div>
        </div>
      </div>:<p className="poster-class-empty" data-poster-class-empty="true">{plan.notes[0]}</p>}
    </section>
  );
}

/**
 * 成长视频封面海报（[海报 US-306] / FR-316、FR-323、FR-345）：给「视频链接」配一张能当封面的图。
 *
 * 三件事都在数据层，组件只渲染产物 + 一个导出动作：
 *  - **画布 1080×1920 与成长视频输出口径同比例**（竖屏 9:16），主视觉只做 `contain` 等比缩放、不裁切
 *    ——「不拉伸」的判据是 `plan.ratio`（画布比例 vs 视频模块口径 + 主视觉 fit），界面不自己比一遍；
 *  - **时长角标与视频模块状态联动**：时长只取成片记录的成片三件套（`videoOutputView` 同一支判据）；
 *    还没有成片时角标写占位且导出被拦下 —— 但**预览照出**，老师看得见那是占位，而不是一个编出来的数字；
 *  - 二维码指向**成片的有效分享令牌**（撤回 / 过期都不算数），没有就显示「分享链接待生成」。
 *
 * 周期沿用视频模块的「生成周期」（同一个 `period` 传进来）：封面是这条成片的封面，两者不许各说一套。
 * `data-poster-video-cover-*` 上的读数全部来自 `buildPosterVideoCoverPlan()` 的产物。
 */
function VideoCoverPosterPanel({isClass=false,objectName='',period='',jobKey='',records=[],videoRecords=[],jobs=[],tokens=[],teacherName='',orgName='',logo='',setToast=()=>{}}){
  const [preview,setPreview]=useState({key:'',url:'',phase:'idle',warnings:[],width:0,height:0});
  const [notice,setNotice]=useState({phase:'idle',message:''});
  const [busy,setBusy]=useState(false);
  const shareOrigin=typeof window==='undefined'?'':(window.location?.origin||'');
  const plan=useMemo(()=>buildPosterVideoCoverPlan({
    records,videoRecords,jobs,objectName,isClass,period,jobKey,tokens,
    teacherName,orgName,logo,origin:shareOrigin
  }),[records,videoRecords,jobs,objectName,isClass,period,jobKey,tokens,teacherName,orgName,logo,shareOrigin]);
  const gate=posterVideoCoverExportGate(plan);
  // 预览重绘键 = 真正会改变这张图的所有输入（对象 / 周期 / 主视觉 / 模板 / 角标 / 链接 / 机构标识）。
  // 注意：**视频没成片时预览照出**（角标就是占位），所以这里不看导出闸门 —— 只看「有没有东西可画」。
  const renderKey=plan.renderable?[
    plan.templateKey,plan.objectName,plan.periodLabel,plan.artwork.url||'no-artwork',plan.artwork.dateDots,
    plan.cover.durationBadgeText,plan.data.logo||'',plan.data.shareUrl||''
  ].join('|'):'';
  useEffect(()=>{
    if(!renderKey){
      setPreview({key:'',url:'',phase:'idle',warnings:[],width:0,height:0});
      return ()=>{};
    }
    let cancelled=false;
    let createdUrl='';
    setPreview({key:renderKey,url:'',phase:'pending',warnings:[],width:0,height:0});
    renderPosterVideoCover(plan,{scale:POSTER_VIDEO_COVER_PREVIEW_SCALE}).then(rendered=>{
      if(cancelled) return;
      if(!rendered||!rendered.blob){
        setPreview({key:renderKey,url:'',phase:'failed',warnings:[],width:0,height:0});
        return;
      }
      createdUrl=createPosterVideoCoverUrl(rendered);
      setPreview({key:renderKey,url:createdUrl,phase:'ready',warnings:rendered.warnings||[],width:rendered.width,height:rendered.height});
    }).catch(()=>{
      if(!cancelled) setPreview({key:renderKey,url:'',phase:'failed',warnings:[],width:0,height:0});
    });
    return ()=>{ cancelled=true; if(createdUrl) releasePosterVideoCoverUrl(createdUrl); };
  // 预览随「重绘键」重跑：键里已经包含了 plan 上所有会影响这张图的输入。
  },[renderKey]);
  useEffect(()=>{setNotice({phase:'idle',message:''})},[objectName,period,isClass]);
  const exportCover=async()=>{
    if(!gate.allowed){setNotice({phase:'blocked',message:gate.reason});return;}
    setBusy(true);
    const result=await exportPosterVideoCoverPng(plan);
    setBusy(false);
    if(!result.ok){setNotice({phase:'failed',message:result.reason});return;}
    const message=`封面已导出：${result.filename} · ${result.rendered.width}×${result.rendered.height} · ${artworkExportSizeText(result.bytes)}`;
    setNotice({phase:'done',message});
    setToast(`${result.filename} 已下载`);
  };
  const videoState=plan.duration.ready?'ready':(plan.duration.jobPresent?'running':'missing');
  // 面板状态把「视频成没成片」算进去：只有成片就绪且预览出图才是「已生成」。
  // 视频还没成片时角标是**占位**、导出被拦下 —— 面板头必须如实写「待成片」，不能显示一个绿色的「已生成」。
  const state=!plan.hasObject
    ?'empty'
    :(!plan.renderable?'blocked'
    :(preview.phase==='failed'?'failed'
    :(!plan.duration.ready?'pending':(preview.phase==='ready'?'ready':preview.phase))));
  const badge=state==='ready'?'已生成':state==='pending'?'待成片':state==='failed'?'生成失败':state==='blocked'?'缺主视觉':state==='empty'?'待选对象':'准备中';
  return (
    <section className="poster-video-cover" data-poster-video-cover="true"
      data-poster-video-cover-state={state}
      data-poster-video-cover-template={plan.templateKey}
      data-poster-video-cover-canvas={`${plan.spec.canvas.width}x${plan.spec.canvas.height}`}
      data-poster-video-cover-video-ratio={plan.ratio.videoLabel}
      data-poster-video-cover-ratio-ok={plan.ratio.ok?'true':'false'}
      data-poster-video-cover-ratio-note={plan.ratio.note}
      data-poster-video-cover-fit={plan.ratio.fit}
      data-poster-video-cover-object={plan.objectName}
      data-poster-video-cover-type={plan.type}
      data-poster-video-cover-period={plan.period}
      data-poster-video-cover-period-label={plan.periodLabel}
      data-poster-video-cover-window-from={plan.window.from}
      data-poster-video-cover-window-to={plan.window.to}
      data-poster-video-cover-cover-slot={plan.cover.slotId}
      data-poster-video-cover-title={plan.cover.titleText}
      data-poster-video-cover-play-icon={plan.cover.playIcon}
      data-poster-video-cover-overlays={plan.cover.overlays.rows.map(row=>`${row.id}:${row.present?'on':'off'}`).join(',')}
      data-poster-video-cover-overlay-missing={plan.cover.overlays.missing.join('、')}
      data-poster-video-cover-artwork={plan.artwork.url}
      data-poster-video-cover-artwork-date={plan.artwork.date}
      data-poster-video-cover-artwork-title={plan.artwork.title}
      data-poster-video-cover-artwork-missing={plan.artwork.missing?'true':'false'}
      data-poster-video-cover-duration={plan.cover.durationBadgeText}
      data-poster-video-cover-duration-ready={plan.duration.ready?'true':'false'}
      data-poster-video-cover-duration-source={plan.duration.from}
      data-poster-video-cover-duration-placeholder={plan.duration.placeholder}
      data-poster-video-cover-video-state={videoState}
      data-poster-video-cover-video-status={plan.duration.status}
      data-poster-video-cover-video-status-label={plan.duration.statusLabel}
      data-poster-video-cover-job-key={plan.video.jobKey}
      data-poster-video-cover-record-id={plan.video.recordId}
      data-poster-video-cover-video-key={plan.video.videoKey}
      data-poster-video-cover-version={String(plan.video.version)}
      data-poster-video-cover-share={plan.share.active?'active':'pending'}
      data-poster-video-cover-share-link={plan.share.link}
      data-poster-video-cover-logo={plan.logo.url||plan.logo.fallbackText}
      data-poster-video-cover-export={gate.allowed?'allowed':'blocked'}
      data-poster-video-cover-export-reason={gate.reason}
      data-poster-video-cover-preview={preview.phase}
      data-poster-video-cover-warnings={preview.warnings.join(' / ')}>
      <div className="poster-video-cover-head">
        <Image size={14}/>
        <b>成长视频封面海报</b>
        <em className={`is-${state}`} data-poster-video-cover-badge="true">{badge}</em>
        {plan.templateName?<small data-poster-video-cover-template-name="true">{plan.templateName}</small>:null}
      </div>
      {plan.hasObject?<div className="poster-video-cover-body">
        <figure className="poster-video-cover-preview" data-poster-video-cover-preview-box="true">
          {preview.url
            ?<img src={preview.url} alt={`${plan.objectName}的成长视频封面预览（${plan.ratio.canvasLabel}，与成长视频同比例）`} data-poster-video-cover-image="true"/>
            :<span className="poster-video-cover-hold" data-poster-video-cover-hold="true">{preview.phase==='failed'?POSTER_VIDEO_COVER_RENDER_FAILED_TEXT:(plan.renderable?'正在生成封面预览…':plan.artwork.placeholderText)}</span>}
        </figure>
        <div className="poster-video-cover-meta">
          <ul>
            <li data-poster-video-cover-line="object">对象：{plan.objectName}（{plan.typeLabel}）· 周期：{plan.periodLabel}</li>
            <li data-poster-video-cover-line="visual">主视觉：{plan.artwork.missing?'待补作品（这个周期还没有成品图）':`${plan.artwork.title||'未命名作品'} · ${plan.artwork.dateDots}`}</li>
            <li data-poster-video-cover-line="overlays">叠加件：{plan.cover.overlays.rows.map(row=>`${row.label}${row.present?'（有）':'（缺）'}`).join(' · ')}</li>
            <li data-poster-video-cover-line="duration">时长角标：{plan.cover.durationBadgeText}（{plan.duration.ready?`取成片记录的第 ${plan.video.version} 版 · ${plan.duration.durationText}`:'占位 —— 视频还没成片'}）</li>
            <li data-poster-video-cover-line="ratio">画布 {plan.ratio.canvasLabel} · 与成长视频 {plan.ratio.videoLabel} 同比例（{plan.ratio.ratioLabel}）· 主视觉 {plan.ratio.fit} 等比缩放</li>
            <li data-poster-video-cover-line="share">分享：{plan.share.pending?POSTER_SINGLE_SHARE_PENDING_TEXT:`链接可用 · ${plan.share.link}`}</li>
          </ul>
          {plan.notes.length?<ul className="poster-video-cover-notes">
            {plan.notes.map(note=><li key={note} data-poster-video-cover-note="true">{note}</li>)}
          </ul>:null}
          {preview.warnings.length?<p className="poster-video-cover-warning" data-poster-video-cover-warning="true">{preview.warnings.join('；')}</p>:null}
          <div className="poster-video-cover-actions">
            <Button icon={Download} disabled={!gate.allowed||busy} onClick={exportCover} data-poster-video-cover-export-button="true">{busy?'正在导出…':gate.allowed?'导出封面 PNG':POSTER_VIDEO_COVER_EXPORT_BLOCKED_TITLE}</Button>
            {gate.allowed?null:<small data-poster-video-cover-block-reason="true">{gate.reason}</small>}
            {notice.message?<small data-poster-video-cover-notice="true">{notice.message}</small>:null}
          </div>
        </div>
      </div>:<p className="poster-video-cover-empty" data-poster-video-cover-empty="true">{plan.notes[0]}</p>}
    </section>
  );
}

function ReportLongPosterPanel({student='',records=[],lessons=[],tokens=[],teacherName='',orgName='',logo='',setToast=()=>{},navigate=null}){
  const [period,setPeriod]=useState(POSTER_REPORT_DEFAULT_PERIOD);
  const [pageIndex,setPageIndex]=useState(1);
  const [preview,setPreview]=useState({key:'',url:'',phase:'idle',warnings:[],width:0,height:0,bytes:0});
  const [notice,setNotice]=useState({phase:'idle',message:''});
  const [busy,setBusy]=useState(false);
  const shareOrigin=typeof window==='undefined'?'':(window.location?.origin||'');
  // 装配（数据层产物）：分段高度、分页、降级档位、预计高度与预计体积都在 plan 里 —— 界面只渲染。
  const plan=useMemo(()=>buildPosterReportLongPlan({
    records,lessons,student,period,tokens,today:null,
    teacherName,orgName,logo,origin:shareOrigin
  }),[records,lessons,student,period,tokens,teacherName,orgName,logo,shareOrigin]);
  const gate=posterReportExportGate(plan);
  const pages=plan.pages||[];
  const page=pages[Math.min(Math.max(1,pageIndex),Math.max(1,pages.length))-1]||null;
  const currentIndex=page?page.index:1;
  // 换学员 / 换周期：回到第一张，清掉回执（张数变了还停在「第 3 张」是没有意义的）。
  useEffect(()=>{setPageIndex(1);setNotice({phase:'idle',message:''})},[student,period]);
  // 预览重绘键 = 真正会改变这一张图的所有输入（学员 / 周期 / 张号 / 逐行内容 / 头图 / 链接 / 落款）。
  const renderKey=plan.hasStudent&&gate.allowed&&page?[
    plan.templateKey,plan.studentName,plan.periodLabel,page.index,page.height,
    plan.rows.map(row=>`${row.recordKey||row.index}:${row.artworkUrl.slice(-24)}:${row.quote.text}`).join(','),
    plan.cover.url,plan.data.shareUrl,plan.data.orgName,plan.data.teacherName
  ].join('|'):'';
  useEffect(()=>{
    if(!renderKey){
      setPreview({key:'',url:'',phase:'idle',warnings:[],width:0,height:0,bytes:0});
      return ()=>{};
    }
    let cancelled=false;
    let createdUrl='';
    setPreview({key:renderKey,url:'',phase:'pending',warnings:[],width:0,height:0,bytes:0});
    renderPosterReport(plan,{pageIndex:currentIndex,scale:POSTER_REPORT_PREVIEW_SCALE}).then(rendered=>{
      if(cancelled) return;
      if(!rendered||!rendered.blob){
        setPreview({key:renderKey,url:'',phase:'failed',warnings:[],width:0,height:0,bytes:0});
        return;
      }
      createdUrl=createPosterReportUrl(rendered);
      setPreview({key:renderKey,url:createdUrl,phase:'ready',warnings:rendered.warnings||[],width:rendered.width,height:rendered.height,bytes:rendered.blob.size});
    }).catch(()=>{
      if(!cancelled) setPreview({key:renderKey,url:'',phase:'failed',warnings:[],width:0,height:0,bytes:0});
    });
    return ()=>{ cancelled=true; if(createdUrl) releasePosterReportUrl(createdUrl); };
  // 预览随「重绘键」重跑：键里已经包含了 plan 上所有会影响这一张的输入。
  },[renderKey]);
  const exportCurrent=async()=>{
    if(!gate.allowed){setNotice({phase:'blocked',message:gate.reason});return;}
    setBusy(true);
    const result=await exportPosterReportPng(plan,{pageIndex:currentIndex});
    setBusy(false);
    if(!result.ok){setNotice({phase:'failed',message:result.reason});return;}
    const message=`长图已导出（第 ${result.page.index} / ${result.page.total} 张）：${result.filename} · ${result.rendered.width}×${result.rendered.height} · ${artworkExportSizeText(result.bytes)}`;
    setNotice({phase:'done',message});
    setToast(`${result.filename} 已下载`);
  };
  const exportAllPages=async()=>{
    if(!gate.allowed){setNotice({phase:'blocked',message:gate.reason});return;}
    setBusy(true);
    const result=await exportPosterReportPages(plan);
    setBusy(false);
    if(!result.count){setNotice({phase:'failed',message:result.reason||POSTER_REPORT_RENDER_FAILED_TEXT});return;}
    const message=`分段导出完成：${result.count} / ${result.total} 张已下载（${result.filenames.join('、')}）`;
    setNotice({phase:result.ok?'done':'failed',message});
    setToast(`已下载 ${result.count} 张长图`);
  };
  const state=!plan.hasStudent
    ?'empty'
    :(!gate.allowed?'blocked':(preview.phase==='failed'?'failed':(preview.phase==='ready'?'ready':preview.phase)));
  const badge=state==='ready'?'已生成':state==='pending'?'生成中':state==='blocked'?'本周期无记录':state==='failed'?'生成失败':state==='empty'?'待选学员':'准备中';
  return (
    <section className="poster-report-long" data-poster-report="true"
      data-poster-report-state={state}
      data-poster-report-template={plan.templateKey}
      data-poster-report-student={plan.studentName}
      data-poster-report-period={plan.period}
      data-poster-report-period-label={plan.periodLabel}
      data-poster-report-width={String(plan.layout.width)}
      data-poster-report-height={String(plan.layout.height)}
      data-poster-report-max-edge={String(plan.layout.maxEdge)}
      data-poster-report-pages={String(pages.length)}
      data-poster-report-page={String(page?page.index:0)}
      data-poster-report-page-height={String(page?page.height:0)}
      data-poster-report-page-canvas={page?`${plan.layout.width}x${page.height}`:''}
      data-poster-report-segments={page?page.segmentIds.join(','):''}
      data-poster-report-segment-list={page?page.segments.map(segment=>`${segment.id}>${segment.label}@${segment.height}`).join('|'):''}
      data-poster-report-degrade={plan.degrade.mode}
      data-poster-report-degrade-label={plan.degrade.modeLabel}
      data-poster-report-degrade-note={plan.degrade.note}
      data-poster-report-export-scale={String(plan.degrade.exportScale)}
      data-poster-report-estimate={plan.estimateText}
      data-poster-report-estimated-height={String(plan.layout.estimate.height)}
      data-poster-report-estimated-bytes={String(plan.layout.estimate.bytes)}
      data-poster-report-page-estimate={page?`第 ${page.index} / ${page.total} 张：预计高度 ${page.estimate.height}px · 预计文件大小 ${artworkExportSizeText(page.estimate.bytes)}（${page.estimate.scale}× 导出 = ${page.estimate.deviceWidth}×${page.estimate.deviceHeight}）`:''}
      data-poster-report-lessons={String(plan.rows.length)}
      data-poster-report-artworks={String(plan.works.count)}
      data-poster-report-cover={plan.cover.url||''}
      data-poster-report-artwork-missing={plan.works.missing?'true':'false'}
      data-poster-report-quotes-truncated={String(plan.quotes.truncated)}
      data-poster-report-share={plan.share.pending?'pending':'active'}
      data-poster-report-share-link={plan.share.link}
      data-poster-report-page-filename={page?page.filename:''}
      data-poster-report-export={gate.allowed?'allowed':'blocked'}
      data-poster-report-export-reason={gate.reason}
      data-poster-report-preview={preview.phase}>
      <div className="poster-report-long-head">
        <FileText size={14}/>
        <b>成长报告长图</b>
        <em className={`is-${state}`} data-poster-report-badge="true">{badge}</em>
        {plan.templateName?<small data-poster-report-template-name="true">{plan.templateName}</small>:null}
      </div>
      {plan.hasStudent?<div className="poster-report-long-body">
        <div className="poster-report-long-controls">
          <label>周期<select value={period} onChange={event=>setPeriod(event.target.value)} data-poster-report-period-select="true">{POSTER_REPORT_PERIOD_OPTIONS.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
          <small data-poster-report-period-line="true">{plan.periodLabel}</small>
          <small data-poster-report-degrade-line="true" data-poster-report-degrade-inline={plan.degrade.mode}>{plan.degrade.modeLabel}：{plan.degrade.note}</small>
        </div>
        <p className="poster-report-long-estimate" data-poster-report-estimate-line="true">{plan.estimateText}</p>
        {page?<p className="poster-report-long-page-estimate" data-poster-report-page-estimate-line="true">{`第 ${page.index} / ${page.total} 张：高度 ${page.estimate.height}px · 预计文件大小 ${artworkExportSizeText(page.estimate.bytes)}（${page.estimate.scale}× 导出 = ${page.estimate.deviceWidth}×${page.estimate.deviceHeight}）`}</p>:null}
        <ol className="poster-report-long-segments" data-poster-report-segment-list-box="true">
          {(page?page.segments:[]).map(segment=><li key={segment.id} data-poster-report-segment={segment.id} data-poster-report-segment-height={String(segment.height)} data-poster-report-segment-blocks={String(segment.blocks)}>{segment.label}（{segment.height}px · {segment.blocks} 块）</li>)}
        </ol>
        {pages.length>1?<div className="poster-report-long-pages" data-poster-report-page-picker="true">
          <span>出图张数</span>
          {pages.map(item=><button type="button" key={item.index} className={item.index===(page?page.index:1)?'active':''} data-poster-report-page-pick={String(item.index)} data-poster-report-page-pick-height={String(item.height)} onClick={()=>setPageIndex(item.index)}>第 {item.index} 张（{item.height}px）</button>)}
        </div>:null}
        <figure className="poster-report-long-preview" data-poster-report-preview-box="true" data-poster-report-preview-canvas={page?`${plan.layout.width}x${page.height}`:''}>
          {preview.url
            ?<img src={preview.url} alt={`${plan.studentName}的成长报告长图预览（${plan.layout.width}×${page?page.height:0}，共 ${pages.length} 张）`} data-poster-report-image="true" data-poster-report-image-size={`${preview.width}x${preview.height}`} data-poster-report-image-bytes={String(preview.bytes)}/>
            :<span className="poster-report-long-hold" data-poster-report-hold="true">{preview.phase==='failed'?POSTER_REPORT_RENDER_FAILED_TEXT:(gate.allowed?'正在生成长图预览…':gate.reason)}</span>}
        </figure>
        <div className="poster-report-long-meta">
          <ul>
            <li data-poster-report-line="student">学员：{plan.studentName} · {plan.periodLabel}</li>
            <li data-poster-report-line="content">内容：{plan.rows.length} 节课次 · {plan.works.count} 幅成品作品 · 点评摘要 {plan.quotes.truncated?`${plan.quotes.truncated} 条按字数截断`:'全部在 40 字内'}</li>
            <li data-poster-report-line="size">整张长图 {plan.layout.width}×{plan.layout.height}（上限 {plan.layout.maxEdge}px）· {plan.degrade.modeLabel}{pages.length>1?` · ${pages.length} 张`:''}</li>
            <li data-poster-report-line="share">分享：{plan.share.pending?POSTER_SINGLE_SHARE_PENDING_TEXT:`链接可用 · ${plan.share.link}`}</li>
            <li data-poster-report-line="file">文件名：{page?page.filename:''}</li>
          </ul>
          {plan.notes.length?<ul className="poster-report-long-notes">
            {plan.notes.map(note=><li key={note} data-poster-report-note="true">{note}</li>)}
          </ul>:null}
          {preview.warnings.length?<p className="poster-report-long-warning" data-poster-report-warning="true">{preview.warnings.join('；')}</p>:null}
          <div className="poster-report-long-actions">
            <Button icon={Download} disabled={!gate.allowed||busy} onClick={exportCurrent} data-poster-report-export-button="true">{busy?'正在导出…':gate.allowed?`导出第 ${page?page.index:1} 张 PNG`:POSTER_REPORT_EXPORT_BLOCKED_TITLE}</Button>
            {pages.length>1?<Button variant="secondary" icon={Download} disabled={!gate.allowed||busy} onClick={exportAllPages} data-poster-report-export-all="true">{`分段导出全部 ${pages.length} 张`}</Button>:null}
            {gate.allowed?null:<small data-poster-report-block-reason="true">{gate.reason}</small>}
            {notice.message?<small data-poster-report-notice="true">{notice.message}</small>:null}
          </div>
        </div>
      </div>:<div className="poster-report-long-empty" data-poster-report-empty="true">
        <p>{plan.notes[0]||POSTER_REPORT_EMPTY_TITLE}</p>
        {navigate?<Button icon={Plus} data-poster-report-create="true" onClick={()=>navigate('create')}>去创建课后反馈</Button>:null}
      </div>}
    </section>
  );
}

function VideoJobsPanel({isClass,objectName,period,onPeriod,lessonCount,artworkCount,photoCount,teacherName,setToast,entries=[],scopeEntries=[],classEntries=[],roster=[],tokens=[],records=[],musicTracks=[],videoRecords=[],consents=null,setShareTokens=()=>{},setVideoRecords=()=>{},recordAudit=()=>{},auditActor=null,auditLog=[],videoQuota=null,videoRetention=null,management=null,navigate=null,logo=''}){
  const [jobs,setJobs]=useState(()=>listVideoJobs());
  const [notice,setNotice]=useState('');
  const [simulateFail,setSimulateFail]=useState(false);
  // 老师手动排除的作品（[第四步 US-216] 第 5 条）：只对这一份精选清单有效，不写进任务、也不落库。
  // 换对象 / 换周期 / 换类型后清空 —— 「排除」是对某个对象某个周期说的，不是一条永久规则。
  const [excludedArtworks,setExcludedArtworks]=useState([]);
  // 片尾寄语（帧清单的输入：≤40 字，超限由数据层给可读原因；空着就不显示寄语，不编一句）。
  // 片尾寄语（帧清单的输入：≤40 字，超限由数据层给可读原因；空着就不显示寄语，不编一句）。
  const [endingNote,setEndingNote]=useState('');
  // 本片选用（[第四步 US-221]）：默认静音（`musicSelectionDefault()`），**不写进草稿也不落库在界面里**
  // —— 它随提交写进那条任务的 `specSnapshot.music`（版权证据），之后按记录回读。
  const [musicSelection,setMusicSelection]=useState(musicSelectionDefault);
  const [musicNotice,setMusicNotice]=useState('');
  // 班级集锦的学员顺序（[第四步 US-218] 第 2 条验收）：默认按班级名单（`null` = 跟着名单走），
  // 老师点过「上移 / 下移」之后才是一份显式顺序 —— 换班级就清空（顺序是对某个班级说的）。
  const [classOrder,setClassOrder]=useState(null);
  // 演示失败原因（四类：模型 / 字体 / 素材 / 存储）—— 可选值与文案都来自数据层。
  const [simulateErrorCode,setSimulateErrorCode]=useState(VIDEO_JOB_SIMULATE_ERROR_DEFAULT);
  // 刚提交的那条（卡片高亮 + 滚动到卡片）：提交后「立即进入任务卡片」是可见的，不只是一个 state。
  const [latestKey,setLatestKey]=useState('');
  // 本次进入页面的时刻（组件挂载）：`videoJobResumed` 用它判断「这条是离开页面前提交的」。
  const sessionStartRef=useRef(Date.now());
  // ---- 移动端与弱网（[第四步 US-224]）-----------------------------------------------------------
  // 四条验收在界面侧的状态：提交锁窗（弱网重复点击）、回到前台补推进的次数、当场量到的布局读数
  // 与全屏状态。判据与文案全在 `data/videoMobile.js`，这里只保管读数。
  const [submitPending,setSubmitPending]=useState(false);
  const [submitBlocked,setSubmitBlocked]=useState(0);
  const [visibilityResumes,setVisibilityResumes]=useState(0);
  const [mobileNotice,setMobileNotice]=useState('');
  const [mobileMeasure,setMobileMeasure]=useState(null);
  const [playerFullscreen,setPlayerFullscreen]=useState(false);
  const [fullscreenSupported]=useState(()=>videoFullscreenSupported());
  const playerRef=useRef(null);
  // 锁窗**按 jobKey 记**：同一个键在窗口内的第二次点击直接忽略并计数；
  // 换成别的周期是别的 jobKey（一次新的生成请求），不受影响（US-072 的并发用例就是这样连提三条的）。
  const submitLockRef=useRef({key:'',until:0});
  const submitLockTimerRef=useRef(null);
  const mobileSignatureRef=useRef('');
  // 真实渲染服务在不在（[第四步 US-213b]）：进面板探测一次并**如实显示** —— 不可用时那句话
  // 就是契约层抛出来的原文（`services/videoApi.js` 的「视频服务暂不可用」），
  // 于是下面这条演示队列是**明确标注的演示**，不是假装成片的来源。
  const [service,setService]=useState(()=>({phase:'checking',ok:false,message:''}));
  const probe=useCallback(()=>{
    let alive=true;
    setService({phase:'checking',ok:false,message:''});
    probeVideoService().then(result=>{
      if(!alive)return;
      setService({phase:result.ok?'online':'unavailable',ok:result.ok,message:result.ok?`渲染服务已接入（${result.service||'video-render'}）`:(result.message||VIDEO_JOB_SERVICE_UNAVAILABLE_TEXT)});
    });
    return ()=>{alive=false};
  },[]);
  const type=isClass?VIDEO_JOB_TYPES[1].id:VIDEO_JOB_TYPES[0].id;
  const typeLabel=isClass?VIDEO_JOB_TYPES[1].label:VIDEO_JOB_TYPES[0].label;
  // 订阅队列（提交 / 推进 / 取消都从这里回到界面）；进面板接上正在跑的任务。
  useEffect(()=>subscribeVideoJobs(rows=>setJobs(rows)),[]);
  useEffect(()=>{setJobs(resumeVideoJobQueue().jobs)},[]);
  // 探测一次渲染服务（挂载时一次；之后由「重新探测」按钮手动触发）。
  useEffect(()=>probe(),[probe]);
  // 当场量一次布局读数（逐块横向溢出 / 播放器占位盒子 / 全屏接口）。**签名没变就不 setState**
  // （不然「每次渲染后量一次」会变成 setState → 渲染 → 量的死循环）。
  const measureMobileLayout=useCallback(()=>{
    if(typeof document==='undefined'||typeof window==='undefined')return;
    const overflowRows=measureVideoOverflow();
    const playerBox=measureVideoPlayerBox(playerRef.current);
    const next={
      viewportWidth:Math.round(window.innerWidth),
      viewportHeight:Math.round(window.innerHeight),
      overflowRows,
      player:playerBox,
      playerFit:playerBox?videoPlayerFit(playerBox,{viewportWidth:playerBox.viewportWidth||window.innerWidth,viewportHeight:playerBox.viewportHeight||window.innerHeight}):null,
      fullscreenSupported:videoFullscreenSupported()
    };
    // 全屏状态在这里对一次账：`fullscreenchange` 在部分环境（headless / 无窗口管理器 / 某些内嵌浏览器）
    // **根本不派发**（本轮实测：进入全屏后页面级监听一个事件都收不到，`document.fullscreenElement` 却是真的）——
    // 所以每次测量（挂载 / resize / 转屏 / 回到前台 / 手动重新测量）都拿 DOM 的真实值校一次界面状态。
    const actual=videoFullscreenElement();
    setPlayerFullscreen(Boolean(actual&&actual===playerRef.current));
    // 签名里**不能有时间戳**：它是「量到的值有没有变」的判据，掺进变化的字段会让
    // 「每次渲染后量一次」变成 setState → 渲染 → 量的死循环（本轮真踩：Maximum update depth exceeded）。
    const signature=JSON.stringify(next);
    if(signature===mobileSignatureRef.current)return;
    mobileSignatureRef.current=signature;
    setMobileMeasure(next);
  },[]);
  // 每次渲染后重量一次（签名相同则不动 state），视口变化（resize / 转屏）时也自动重量一次。
  useEffect(()=>{measureMobileLayout();});
  useEffect(()=>attachVideoLayoutWatch(()=>measureMobileLayout()),[measureMobileLayout]);
  // 全屏状态跟着浏览器的 `fullscreenchange` 走（进入 / 退出 / 按 Esc 退出都同步到按钮与读数）。
  useEffect(()=>subscribeVideoFullscreen(element=>{setPlayerFullscreen(Boolean(element&&element===playerRef.current));}),[]);
  // 锁屏 / 切到后台 → 回到页面：**先按真实经过时间补推进一次**（`services/videoJobQueue` 的实现），
  // 界面记下这一次补推进并按 data 层文案说清「锁屏那段时间也算数、没有重新开始」。
  useEffect(()=>attachVideoJobVisibilityResume({onResume:result=>{
    setJobs(result.jobs);
    setVisibilityResumes(count=>count+1);
    setMobileNotice(videoJobVisibilityResumeNote(result));
    measureMobileLayout();
  }}),[measureMobileLayout]);
  // 卸载时撤掉锁窗的定时器（不留一个到点还在改 state 的定时器）。
  useEffect(()=>()=>{if(submitLockTimerRef.current)clearTimeout(submitLockTimerRef.current)},[]);
  // 提交完把那条卡片滚进视野（`block:'nearest'`：已经看得见就不动滚动位置）。
  useEffect(()=>{
    if(!latestKey||typeof document==='undefined')return;
    const card=document.querySelector(`[data-video-job-card][data-video-job-key="${latestKey}"]`);
    if(card&&typeof card.scrollIntoView==='function')card.scrollIntoView({block:'nearest'});
  },[latestKey]);
  const view=videoJobQueueView(jobs,{resumedAt:sessionStartRef.current});
  const submitIssue=videoJobSubmitIssue({type,studentId:isClass?'':objectName,classId:isClass?objectName:'',period});
  const jobKey=videoJobKey({type,studentId:isClass?'':objectName,classId:isClass?objectName:'',period});
  // ---- 权限 · 配额（[第四步 US-223] 第 1、4 条）-----------------------------------------------
  // 视频任务的操作人身份：与审计那条路同源（`auditActor` 是 App 按当前角色补的操作人四件套，
  // `videoTaskViewerFromActor` 把它映射成权限判定要的 viewer 形状 —— 不另写一套「怎么认人」）。
  const videoViewer=useMemo(()=>videoTaskViewerFromActor(auditActor||{actorId:teacherName,actorName:teacherName,actorRole:'teacher'}),[auditActor,teacherName]);
  // 「只有本班老师可提交与下载成片」：提交与下载各判一次（判据是 `videoTaskAccess`，班级归属委托
  // US-211 那一份）。跨班老师 / 管理员在这两处各拿到一句可读原因，界面上如实显示。
  const videoAccessInput=useMemo(()=>({
    viewer:videoViewer,
    management,
    student:isClass?'':objectName,
    className:isClass?objectName:''
  }),[videoViewer,management,isClass,objectName]);
  const submitAccess=useMemo(()=>videoTaskAccess({...videoAccessInput,action:VIDEO_TASK_ACTIONS.submit}),[videoAccessInput]);
  // 成片下载的访问判定：与提交是不同的动作（下载是「把孩子的视频拿走」，同一道本班闸门）。
  const downloadAccess=useMemo(()=>videoTaskAccess({...videoAccessInput,action:VIDEO_TASK_ACTIONS.download}),[videoAccessInput]);
  // 配额（存储 + 本月流量）：用量读成片记录与审计留痕，超限时 `videoQuotaSubmitIssue` 给可读原因，
  // 提交按钮据此禁用 —— 判定与写入侧读同一份（`videoQuotaView` 是唯一真源）。
  const quotaView=useMemo(()=>videoQuotaView({policy:videoQuota,records:videoRecords,auditLog}),[videoQuota,videoRecords,auditLog]);
  const quotaIssue=videoQuotaSubmitIssue(quotaView);
  // 老师端只读的那行保留期读数（配置与清理在管理端「系统配置」）。
  const retentionNote=useMemo(()=>videoRetentionSummary(videoRetention),[videoRetention]);
  // 这条任务的成片记录与当前任务（六条留痕、下载闸门与版本面板都读它们）：
  // 定义放在这里是因为下面的留痕与下载闸门都要用（JS 的 const 是自上而下的）。
  const recordIdentity=useMemo(()=>({type,studentId:isClass?'':objectName,classId:isClass?objectName:'',period}),[type,isClass,objectName,period]);
  const videoRecord=useMemo(()=>findVideoRecord(videoRecords,jobKey),[videoRecords,jobKey]);
  const currentJob=useMemo(()=>jobs.find(job=>job.jobKey===jobKey)||null,[jobs,jobKey]);
  // ---- 六条留痕（[第四步 US-223] 第 2 条）------------------------------------------------------
  // 提交 / 完成 / 下载 / 分享 / 更换音乐 / 删除各写一条审计：入参构造统一走
  // `videoAuditEntryInput`（动作键、任务键 / 成片键、对象、体积都在那一份里拼），
  // 界面只负责挑时机调用；最近一条挂在面板上（`data-video-audit`），六条的汇总读数据层。
  const [videoAuditEntry,setVideoAuditEntry]=useState(null);
  const videoAudit=useCallback(({action,job=null,record=null,bytes=0,detail='',share=null,outcome='ok'})=>{
    const actor=auditActor||{actorId:teacherName,actorName:teacherName,actorRole:'teacher',actorRoleLabel:'老师'};
    const entry=recordAudit(videoAuditEntryInput({action,actor,job,record,bytes,detail,share,outcome}));
    setVideoAuditEntry(entry);
    return entry;
  },[recordAudit,auditActor,teacherName]);
  // 精选（[第四步 US-216]）：先定「哪些作品进成片」（时长上限 + 均匀取样 + 手动排除），
  // 帧清单再按**收录的那一批**排 —— 于是「已精选 M 幅」与帧清单上的帧数、预估时长三者同源。
  useEffect(()=>{setExcludedArtworks([])},[objectName,period,isClass]);
  const selection=useMemo(()=>videoSelectionPlan({entries,type,excluded:excludedArtworks}),[entries,type,excludedArtworks]);
  const selectionView=useMemo(()=>videoSelectionView(selection),[selection]);
  // ---- 背景音乐选用与版权闸门（[第四步 US-221] / FR-294 ~ FR-300）-------------------------------
  // 这条任务的成片记录（`specSnapshot.music`）：换对象 / 换周期就跟着换（预览面板读的是同一个 jobKey）。
  // 混音读数里的淡出起点用**这条成片的预估时长**（`selection.durationSec`，与精选清单同源）。
  const currentJobMusic=useMemo(()=>{
    const stored=jobs.find(job=>job.jobKey===jobKey)||null;
    return stored?stored.specSnapshot?.music||null:null;
  },[jobs,jobKey]);
  // 进面板 / 换对象 / 换周期：把**记录里的选择**带回界面（老任务没有记录 → 默认静音）。
  // 「静音是默认值」这条口径由 `musicSelectionFromJobMusic(null)` → `musicSelectionDefault()` 保证；
  // 传 `tracks` 是**再验一次可用性**：记录里的曲目已经不可选（授权被改回待确认 / 到期 / 停用 /
  // 被删）时界面回到静音，不让老师点一下就把没授权的曲子又写进新记录。
  useEffect(()=>{setMusicSelection(musicSelectionFromJobMusic(currentJobMusic,{tracks:musicTracks}));setMusicNotice('')},[objectName,period,isClass,musicTracks]);
  const musicView=useMemo(()=>musicSelectionView({
    selection:musicSelection,
    tracks:musicTracks,
    jobMusic:currentJobMusic,
    durationSec:selection.durationSec,
    actorName:teacherName
  }),[musicSelection,musicTracks,currentJobMusic,selection.durationSec,teacherName]);
  const pickMusic=useCallback(trackKey=>{
    const result=musicSelectionPick({selection:musicSelection,tracks:musicTracks,trackKey,capturedAt:new Date().toISOString()});
    if(!result.ok){setMusicNotice(result.issue);setToast(result.issue);return;}
    setMusicSelection(result.selection);
    setMusicNotice(`已选用「${result.row?result.row.title:''}」：提交任务时会把曲目 id 与授权凭证快照一起记进成片记录。`);
  },[musicSelection,musicTracks,setToast]);
  const muteMusic=useCallback(()=>{
    setMusicSelection(current=>musicSelectionMuted(current));
    setMusicNotice('已改为静音：成片输出无音轨或静音轨（这是默认值）。');
  },[]);
  // 处置（FR-300）：把这次处置写进成片记录（曲目 id 与凭证快照不动）；任务还不存在 / 老任务就只记在本次选择上。
  // 处置的 `note` 用当前显示的那句提示（到期 = 验收原文那句；授权被收回 = 另一句，不把两件事说成一件）。
  const disposeMusic=useCallback(action=>{
    const reason=musicView.notice||MUSIC_LICENSE_EXPIRED_NOTICE;
    const record=musicDispositionRecord({
      action,
      trackId:musicSelection.trackId,
      trackTitle:musicView.selectionSnapshot?musicView.selectionSnapshot.title:'',
      at:new Date().toISOString(),
      by:teacherName,
      note:reason
    });
    if(!record){setMusicNotice('处置动作不认识：没有记录任何结果。');return;}
    const next=applyMusicDisposition(musicSelection,record);
    setMusicSelection(action==='mute'?{...musicSelectionMuted(next),disposition:record}:next);
    const recorded=recordVideoJobMusicDisposition(jobKey,record);
    setMusicNotice(recorded.ok
      ? `已记录处置结果：${record.actionLabel}（写进这条成片记录的音乐快照）。`
      : `已记录处置结果：${record.actionLabel}（${recorded.issue}这条选择会用在下一版成片记录里。）`);
    setToast(`${record.actionLabel}：${reason}`);
    // 留痕（六条之五「更换音乐」）：曲目到期或被收回后的处置必须查得到 —— 谁在什么时候把哪首曲子
    // 换掉 / 静音，写进审计日志（成片记录里的曲目 id 与凭证快照不动，这里只记这次处置）。
    videoAudit({action:AUDIT_ACTIONS.videoMusicChange,job:currentJob,record:videoRecord,detail:`${record.actionLabel}：${reason}（原曲目 ${record.trackId||'未记录'}）`});
  },[musicSelection,musicView.selectionSnapshot,musicView.notice,jobKey,teacherName,setToast,videoAudit,currentJob,videoRecord]);
  const pickedEntries=selection.selectedEntries;
  const toggleExclude=useCallback(key=>{
    if(!key)return;
    setExcludedArtworks(current=>current.includes(key)?current.filter(item=>item!==key):[...current,key]);
  },[]);
  // 帧清单（[第四步 US-215]）：当前「查看对象 + 生成周期」下这条视频会怎么走。
  // `shareReady` 读的是这一批归档记录里有没有可用的家长分享令牌（决定片尾二维码那一行怎么写）。
  const shareReady=useMemo(()=>videoTimelineShareReady(tokens,entries),[tokens,entries]);
  const timelinePlan=useMemo(()=>videoTimelinePlan({entries:pickedEntries,objectName,type,period,orgName:DEFAULT_ORG_NAME,endingNote,shareReady}),[pickedEntries,objectName,type,period,endingNote,shareReady]);
  // 个人成长视频时间线（[第四步 US-217]）：只有个人档案下才算（班级集锦的编排属于 US-218）。
  // 收录清单以作品键传进去（`selectedKeys`）—— 被舍弃 / 被手动排除的作品不排进这条时间线；
  // 缺课留白卡不受精选影响（缺课本来就不进精选），所以它一定排得进来。
  const selectedKeys=useMemo(()=>selection.selectedEntries.map(entry=>videoSelectionEntryKey(entry)),[selection]);
  const personalPlan=useMemo(()=>isClass?null:videoPersonalPlan({entries:scopeEntries,objectName,period,orgName:DEFAULT_ORG_NAME,endingNote,shareReady,selectedKeys,type}),[isClass,scopeEntries,objectName,period,endingNote,shareReady,selectedKeys,type]);
  // 班级视频集锦时间线（[第四步 US-218]）：只有班级档案下才算（个人档案走上面那一块）。
  // 顺序默认按班级名单（`classOrder` 为 null 时数据层就按 `roster` 排）；换班级把调整清掉。
  useEffect(()=>{setClassOrder(null)},[objectName]);
  const classPlan=useMemo(()=>isClass?videoClassPlan({entries:classEntries,className:objectName,roster,order:classOrder,period,orgName:DEFAULT_ORG_NAME,endingNote,shareReady,selectedKeys,type}):null,[isClass,classEntries,objectName,roster,classOrder,period,endingNote,shareReady,selectedKeys,type]);
  const classView=useMemo(()=>classPlan?videoClassView(classPlan):null,[classPlan]);
  const moveClassOrder=useCallback((index,direction)=>{
    const current=classView?classView.currentOrder:roster;
    setClassOrder(videoClassMoveOrder(current,index,direction));
  },[classView,roster]);
  const resetClassOrder=useCallback(()=>setClassOrder(null),[]);
  // ---- 成片预览 · 下载与分享（[第四步 US-219]）-------------------------------------------------
  // 预览读的是「这条任务」：当前对象 + 周期的 jobKey 命中的那条（没有就当还没有任务）。
  // 播放器在渲染服务给出成片之前只有一个 9:16 的空位 —— `videoPreviewView` 的 `src` 是空串，
  // 组件因此不渲染任何 `<source>`（「不显示假 mp4」在结构上成立）。
  const [outputNotice,setOutputNotice]=useState('');
  const [shareNotice,setShareNotice]=useState('');
  const [shareRevokeOpen,setShareRevokeOpen]=useState(false);
  const [shareValidDays,setShareValidDays]=useState(SHARE_TOKEN_DEFAULT_VALID_DAYS);
  useEffect(()=>{setOutputNotice('');setShareNotice('');setShareRevokeOpen(false)},[objectName,period,isClass]);
  const preview=useMemo(()=>videoPreviewView({jobs,jobKey}),[jobs,jobKey]);
  // 成片分享的授权闸门（**与图文分享同一道**）：`videoShareGateView` 逐位学员走
  // `findConsent` → `archiveForwardView` → `shareTokenGenerationGate` —— 这里的 `step` 就是
  // 第四步那一份归档摘要产物（`archiveStepView`），所以「先归档再转发」「家长未完成查看授权」
  // 两句判断与第四步逐字一致，组件里没有第二套授权逻辑。
  const gateRecord=useMemo(()=>{
    const picked=(Array.isArray(entries)?entries:[]).find(entry=>entry&&!entry.isAbsence)||null;
    if(!picked) return null;
    const raw=(Array.isArray(records)?records:[]).filter(record=>record&&typeof record==='object');
    return raw.find(record=>(picked.recordKey&&String(record.recordKey||'')===picked.recordKey)||(picked.id&&String(record.id||'')===picked.id))||null;
  },[entries,records]);
  const gateStep=useMemo(()=>archiveStepView({record:gateRecord}),[gateRecord]);
  const gateStudents=useMemo(()=>{
    if(!isClass) return objectName?[objectName]:[];
    const list=(Array.isArray(classEntries)?classEntries:[]).filter(entry=>entry&&!entry.isAbsence);
    const names=[];
    (Array.isArray(roster)?roster:[]).forEach(name=>{if(name&&list.some(entry=>entry.student===name)&&!names.includes(name))names.push(name)});
    list.forEach(entry=>{if(entry.student&&!names.includes(entry.student))names.push(entry.student)});
    return names;
  },[isClass,objectName,classEntries,roster]);
  const shareGate=useMemo(()=>videoShareGateView({
    students:gateStudents,
    consents,
    step:gateStep,
    lessonDate:gateRecord?(String(gateRecord.lessonDate||'')||String(gateRecord.date||'')):'',
    title:gateRecord?String(gateRecord.title||''):''
  }),[gateStudents,consents,gateStep,gateRecord]);
  const sharePanel=videoSharePanelView({tokens,jobKey,gate:shareGate,validDays:shareValidDays});
  const videoShareActor=()=>auditActor||{actorId:teacherName,actorName:teacherName,actorRole:'teacher',actorRoleLabel:'老师'};
  const videoAuditSummary=useMemo(()=>videoTaskAuditStats(
    (Array.isArray(auditLog)?auditLog:[]).filter(entry=>{
      const key=String((entry&&entry.jobKey)||'');
      if(key) return key===jobKey;
      return String((entry&&entry.videoKey)||'')===String((videoRecord&&videoRecord.videoKey)||'');
    })
  ),[auditLog,jobKey,videoRecord]);
  // 成片地址的签名合规（第 5 条）：只有带签名、带有效期且不超过分享有效期的临时 URL 才可用。
  // 分享有效期取这条成片当下可用的分享令牌（没有令牌时按默认 30 天算）。
  const signedUrlView=useMemo(()=>videoSignedUrlView({
    outputUrl:preview.player.src,
    share:sharePanel.token?{validDays:sharePanel.token.validDays,createdAt:sharePanel.token.createdAt,expiresAt:sharePanel.token.expiresAt}:{validDays:shareValidDays}
  }),[preview.player.src,sharePanel.token,shareValidDays]);
  // **完成**（六条之二）：任务推进到「已完成」的那一刻写一条留痕（只写一次，按 jobKey 去重 ——
  // 刷新 / 重新进入页面时重放的 `done` 不再重复记）。
  const doneAuditedRef=useRef('');
  useEffect(()=>{
    if(!currentJob||String(currentJob.status)!==VIDEO_JOB_STATUSES.done) return;
    const key=String(currentJob.jobKey||'');
    if(!key||doneAuditedRef.current===key) return;
    // 「完成」这件事只发生过一次：刷新 / 重新进页面时任务**还是** done，但不能再记一条
    // （跨会话也成立 —— 先看审计日志里这条任务有没有记过，而不是只看本次挂载的 ref）。
    if(latestAuditEntry(Array.isArray(auditLog)?auditLog:[],AUDIT_ACTIONS.videoJobDone,{jobKey:key})){doneAuditedRef.current=key;return;}
    doneAuditedRef.current=key;
    videoAudit({action:AUDIT_ACTIONS.videoJobDone,job:currentJob,record:videoRecord,detail:`任务已完成（成片就绪）：${typeLabel} · ${period}`});
  },[currentJob,videoRecord,videoAudit,typeLabel,period,auditLog]);
  // 下载 / 分享（验收第 2 条）：服务未接入时两句话各不相同、都可读；真成片那条路径直接取服务地址，
  // 原型不做本机副本（地址是渲染服务的 https 持久地址）。
  // **下载的三道闸**（[第四步 US-223] 第 1、5 条）：先过「本班老师」的权限判定，
  // 再过成片地址的签名合规（没有有效期的 https 地址不是临时地址），最后才真的打开 ——
  // 被拒时如实显示原因并留一条 `outcome:'denied'` 的留痕（合规要的是「谁试过」）。
  const runPreviewAction=action=>{
    if(!action) return;
    if(!action.enabled){setOutputNotice(action.unavailableText);setToast(action.unavailableText);return;}
    if(action.id==='download'){
      const url=preview.player.src;
      if(!url) return;
      if(!downloadAccess.allowed){
        setOutputNotice(downloadAccess.deniedText||downloadAccess.reason);
        setToast(downloadAccess.deniedText||downloadAccess.reason);
        videoAudit({action:AUDIT_ACTIONS.videoDownload,job:currentJob,record:videoRecord,bytes:0,detail:`下载被拒绝：${downloadAccess.reason}`});
        return;
      }
      if(signedUrlView.issue){
        setOutputNotice(`${signedUrlView.note}`);
        setToast(signedUrlView.note);
        return;
      }
      if(typeof window!=='undefined') window.open(url,'_blank','noopener');
      // 留痕（六条之三）：下载成片记下体积（流量用量读它）。
      videoAudit({action:AUDIT_ACTIONS.videoDownload,job:currentJob,record:videoRecord,bytes:preview.output.bytes,detail:`下载成片（${preview.output.durationText||'时长待服务给出'} · ${preview.output.bytesText||'体积待服务给出'}）`});
      setOutputNotice('已从渲染服务取成片地址（新窗口打开；原型不落本机副本）。');
      setToast('已从渲染服务取成片地址。');
      return;
    }
    setOutputNotice(preview.readyNote);
    setToast(preview.readyNote);
  };
  const generateVideoShare=()=>{
    if(!sharePanel.gate.allowed){setShareNotice(sharePanel.gate.reason);setToast(sharePanel.gate.reason);return;}
    const created=createVideoShareTokenRecord(videoShareTokenInput({
      jobKey,
      type,
      objectName,
      className:isClass?'':(gateRecord?String(gateRecord.className||''):''),
      period,
      validDays:shareValidDays,
      createdBy:teacherName
    }),{});
    if(!created){setShareNotice('令牌生成失败，请重试。');return;}
    setShareTokens(current=>appendShareToken(current,created));
    setShareRevokeOpen(false);
    setShareNotice(sharePanel.generatedNotice);
    setToast(`${sharePanel.generatedNotice}${shareTokenLink(created.token)}`);
    void saveRemoteShareToken(created).catch(()=>{});
    // 留痕（六条之四「分享」）：与图文分享共用同一张动作表 —— 成片分享与图文分享走同一条令牌账，
    // 只多带一个 jobKey（断言据此把它们筛成「视频任务的分享」）。
    videoAudit({action:AUDIT_ACTIONS.shareGenerate,job:currentJob,record:videoRecord,share:created,detail:`成片分享链接（${typeLabel} · ${period}）· 有效期 ${created.validDays} 天`});
  };
  const revokeVideoShare=()=>{
    const target=sharePanel.active?sharePanel.token:null;
    if(!target) return;
    const revoked=revokeShareTokenRecord(target,{by:teacherName});
    if(!revoked) return;
    setShareTokens(current=>replaceShareToken(current,revoked));
    setShareRevokeOpen(false);
    setShareNotice(sharePanel.revokedNotice);
    setToast(sharePanel.revokedNotice);
    void revokeRemoteShareToken(revoked).catch(()=>{});
    recordAudit({...videoShareActor(),action:AUDIT_ACTIONS.shareRevoke,objectName,studentId:isClass?'':objectName,recordId:revoked.jobKey,jobKey:revoked.jobKey||jobKey,studentName:isClass?'':objectName,version:revoked.version,shareToken:revoked.token,scope:period,detail:`撤回成片分享链接（${typeLabel} · ${period}）`});
  };
  const goAuthorization=()=>{if(typeof navigate==='function')navigate('authorization');};
  // ---- 成片版本 · 更新与删除（[第四步 US-222] / FR-301 ~ FR-304）--------------------------------
  // 这一版覆盖的归档记录在**生成那一刻**冻结进 `sources`（`videoRecordSources` 是唯一取法），
  // 之后归档更新只影响 `videoRecordUpdateView` 的只读对账 —— 记录本身不因归档变化而改写
  // （「不自动重出」在结构上成立：这里没有任何 effect 监听 records 去写记录）。
  const [recordNotice,setRecordNotice]=useState('');
  const [recordDeleteOpen,setRecordDeleteOpen]=useState(false);
  const [recordViewingVersion,setRecordViewingVersion]=useState(0);
  useEffect(()=>{setRecordNotice('');setRecordDeleteOpen(false);setRecordViewingVersion(0)},[objectName,period,isClass]);
  const recordView=useMemo(()=>videoRecordView(videoRecord,{records,viewingVersion:recordViewingVersion}),[videoRecord,records,recordViewingVersion]);
  const regenerateIssue=videoRecordRegenerateIssue({record:videoRecord,jobStatus:currentJob?currentJob.status:''});
  /**
   * 生成 / 重新生成时把这一版落库（FR-301 / FR-303）。规则全在 `data/videoRecords.js`：
   * 没有记录 → `createVideoRecord`（第 1 版）；已有记录 → `updateVideoRecordVersion`（版本自增、上一版进历史）。
   * 先写本机 state（App 的 effect 负责落盘）再推云端；云端表没建时如实说明「先保存在本机」。
   */
  const storeVideoRecord=useCallback(({at,music,regenerate})=>{
    const sources=videoRecordSources(records,recordIdentity);
    const snapshot=videoJobSpecSnapshot({...recordIdentity,objectName,lessonCount,artworkCount,photoCount,capturedAt:at,music});
    const existing=findVideoRecord(videoRecords,jobKey);
    const next=existing&&regenerate
      ?updateVideoRecordVersion(existing,{specSnapshot:snapshot,sources,generatedAt:at,generatedBy:teacherName})
      :(existing||createVideoRecord({...recordIdentity,objectName,specSnapshot:snapshot,sources,generatedAt:at,generatedBy:teacherName}));
    setVideoRecords(list=>applyVideoRecord(list,next));
    void saveRemoteVideoRecord(next).catch(()=>{});
    return next;
  },[records,recordIdentity,objectName,lessonCount,artworkCount,photoCount,videoRecords,jobKey,teacherName,setVideoRecords]);
  const regenerateVideo=()=>{
    // 弱网重复点击（[第四步 US-224] 第 3 条验收）：重新生成也是同一条 jobKey，
    // 锁窗内的第二次点击直接忽略 —— 否则会出现「摘掉任务 → 重排 → 又摘掉 → 又重排」的连击。
    if(blockRepeatSubmit(jobKey)){setRecordNotice(VIDEO_JOB_SUBMIT_LOCK_TEXT);setToast(VIDEO_JOB_SUBMIT_LOCK_TEXT);return;}
    if(regenerateIssue){setRecordNotice(regenerateIssue);setToast(regenerateIssue);return;}
    // 权限与配额两道闸（[第四步 US-223] 第 1、4 条）：重新生成也是「提交一条渲染任务」，
    // 同一份判据 —— 跨班老师 / 管理员 / 配额满都在这里被拦下并给出可读原因。
    if(!submitAccess.allowed){setRecordNotice(submitAccess.deniedText||submitAccess.reason);setToast(submitAccess.deniedText||submitAccess.reason);return;}
    if(quotaIssue){setRecordNotice(quotaIssue);setToast(quotaIssue);return;}
    beginSubmitLock(jobKey);
    const at=new Date().toISOString();
    const submittedMusic=musicJobMusicFromSelection(musicSelection,{capturedAt:at});
    // 重新生成 = 把上一轮的渲染任务记录摘掉、用同一个 jobKey 重新排一轮（不是新键、不是新对象）。
    discardVideoJob(jobKey);
    const result=submitVideoJob({...recordIdentity,objectName,lessonCount,artworkCount,photoCount,createdBy:teacherName,simulate:simulateFail?'fail':'success',simulateErrorCode,music:submittedMusic});
    if(!result.ok){setRecordNotice(result.issue);setToast(result.issue);return;}
    if(result.job)setLatestKey(result.job.jobKey);
    const next=storeVideoRecord({at,music:submittedMusic,regenerate:true});
    setRecordViewingVersion(0);
    // 留痕（六条之一「提交」）：重新生成同样是一次提交（attempts 自增、沿用同一个 jobKey）。
    videoAudit({action:AUDIT_ACTIONS.videoJobSubmit,job:result.job||currentJob,record:next,detail:`重新生成${typeLabel}（${period}）· ${archiveVersionLabel(next.version)}`});
    const text=VIDEO_RECORD_REGENERATE_DONE(next.version);
    report(result);
    setRecordNotice(text);
    setToast(text);
  };
  /** 删除成片（FR-304）：只摘掉成片记录与它的渲染任务记录，归档记录一个字节都不动。 */
  const deleteVideoRecord=()=>{
    if(!videoRecord) return;
    const removing=videoRecord;
    setRecordDeleteOpen(false);
    setRecordViewingVersion(0);
    setVideoRecords(list=>removeVideoRecord(list,videoRecord.videoKey));
    discardVideoJob(videoRecord.videoKey);
    void deleteRemoteVideoRecord(videoRecord.videoKey).catch(()=>{});
    // 留痕（六条之六「删除」）：删的是哪一版成片、体积多大都记下来（归档记录不动这句也写进 detail）。
    videoAudit({action:AUDIT_ACTIONS.videoRecordDelete,job:currentJob,record:removing,detail:`删除成片 ${removing.videoKey} · ${archiveVersionLabel(removing.version)}（归档记录一条都没有动）`});
    setRecordNotice(VIDEO_RECORD_DELETE_DONE);
    setToast(VIDEO_RECORD_DELETE_DONE);
  };
  const report=result=>{setJobs(listVideoJobs());setNotice(result.ok?result.notice:result.issue);setToast(result.ok?result.notice:result.issue)};
  /**
   * 提交锁窗（[第四步 US-224] 第 3 条验收）：
   *  - `beginSubmitLock(jobKey)`：这一次提交开始，锁窗到 `VIDEO_JOB_SUBMIT_LOCK_MS`；
   *  - `blockRepeatSubmit(jobKey)`：同一个键在窗口内的下一次点击**直接忽略并计数**（返回 `true`）。
   *
   * 为什么锁窗按 jobKey 记：验收要的是「重复点击生成不创建多条任务」——换一个周期就是另一次生成
   * （另一个 jobKey），不该被上一次的窗口挡住。为什么按钮不在这段窗口里禁用：被禁用的按钮收不到
   * 点击，就**数不出**「挡下了几次重复点击」（弱网那条验收的证据正是这个数）。
   * 结构性保证仍是幂等键：服务层每次提交都按 jobKey upsert，重复提交命中同一条（`没有重复创建`）。
   */
  const beginSubmitLock=useCallback(key=>{
    const until=Date.now()+VIDEO_JOB_SUBMIT_LOCK_MS;
    submitLockRef.current={key:String(key||''),until};
    setSubmitPending(true);
    if(submitLockTimerRef.current)clearTimeout(submitLockTimerRef.current);
    submitLockTimerRef.current=setTimeout(()=>{
      submitLockTimerRef.current=null;
      if(Date.now()>=submitLockRef.current.until){submitLockRef.current={key:'',until:0};setSubmitPending(false);}
    },VIDEO_JOB_SUBMIT_LOCK_MS);
  },[]);
  const blockRepeatSubmit=useCallback(key=>{
    const lock=submitLockRef.current;
    if(!lock.until||lock.key!==String(key||'')||Date.now()>=lock.until)return false;
    setSubmitBlocked(count=>count+1);
    return true;
  },[]);
  const submit=()=>{
    // 弱网重复点击：同一条 jobKey 在锁窗内的第二次点击直接忽略（连队列都不进），并计数。
    if(blockRepeatSubmit(jobKey)){setNotice(VIDEO_JOB_SUBMIT_LOCK_TEXT);setToast(VIDEO_JOB_SUBMIT_LOCK_TEXT);measureMobileLayout();return;}
    // 权限与配额两道闸（[第四步 US-223] 第 1、4 条）：
    //  ① 只有本班老师可提交（`videoTaskAccess` 的唯一判据，跨班 / 管理员各给一句可读原因）；
    //  ② 存储或本月流量超限时阻止新任务并给出提示（`videoQuotaSubmitIssue`）。
    if(!submitAccess.allowed){setNotice(submitAccess.deniedText||submitAccess.reason);setToast(submitAccess.deniedText||submitAccess.reason);return;}
    if(quotaIssue){setNotice(quotaIssue);setToast(quotaIssue);return;}
    beginSubmitLock(jobKey);
    // 版权证据随任务一起写进 `specSnapshot.music`（FR-295）：静音也是一个明确结论，老任务没有这一项。
    const submittedMusic=musicJobMusicFromSelection(musicSelection,{capturedAt:new Date().toISOString()});
    const result=submitVideoJob({type,studentId:isClass?'':objectName,classId:isClass?objectName:'',period,objectName,lessonCount,artworkCount,photoCount,createdBy:teacherName,simulate:simulateFail?'fail':'success',simulateErrorCode,music:submittedMusic});
    if(result.ok&&result.job)setLatestKey(result.job.jobKey);
    if(result.ok){
      // 留痕（六条之一「提交」）：提交成功才记（被判据拦下的提交不是一次提交）。
      videoAudit({action:AUDIT_ACTIONS.videoJobSubmit,job:result.job,record:videoRecord,detail:`提交${typeLabel}（${period}）· 对象 ${objectName}`});
    }
    report(result);
    // 第一版成片记录随生成一起落库（FR-301）：已有记录**不因为再点一次生成而变化**
    // （版本只在「重新生成」时自增 —— 这正是「不自动重出」的另一面，US-222）。
    if(result.ok&&!findVideoRecord(videoRecords,jobKey)){
      const next=storeVideoRecord({at:new Date().toISOString(),music:submittedMusic,regenerate:false});
      setRecordViewingVersion(0);
      setRecordNotice(`成片已落库：${next.videoKey} · ${next.version===1?'第 1 版':`第 ${next.version} 版`}（videoKey / 版本 / 生成时间 / specSnapshot 四项齐全）。`);
    }
    // 已有成片记录、而这次选择与记录不同（换了曲子 / 改成静音）：**记录不改写**（举证材料要稳定），
    // 但必须当场说一句实话 —— 否则老师以为换上新曲子了，实际那条记录还是老的（本轮真踩）。
    const stored=result.job?result.job:(jobs.find(job=>job.jobKey===jobKey)||null);
    if(result.ok&&musicJobMusicDiffers(stored?stored.specSnapshot?.music:null,submittedMusic)){
      setMusicNotice(MUSIC_RESUBMIT_KEEPS_RECORD_NOTE);
      setToast(MUSIC_RESUBMIT_KEEPS_RECORD_NOTE);
    }
  };
  const cancel=key=>report(cancelVideoJob(key));
  const retry=key=>report(retryVideoJob(key));
  // ---- 移动端与弱网的面板读数（[第四步 US-224]）--------------------------------------------------
  // 全屏入口（第 2 条验收）：占位阶段也点得动（成片接入后同一个按钮就是全屏播放）。
  // 失败 / 不支持时把那句话照原样显示（data 层的 `requestVideoFullscreen` 的 `issue`），不静默。
  const togglePlayerFullscreen=useCallback(async()=>{
    if(playerFullscreen){
      const result=await exitVideoFullscreen();
      // 乐观同步：`exitFullscreen()` 的承诺在**已经退出全屏**之后才兑现，界面按结果改就是了 ——
      // 不能把界面状态绑死在 `fullscreenchange` 上（headless / 内嵌浏览器可能永远不派发它）。
      if(result.ok)setPlayerFullscreen(false);
      else{setOutputNotice(result.issue);setToast(result.issue);}
      return;
    }
    const result=await requestVideoFullscreen(playerRef.current);
    if(!result.ok){setOutputNotice(result.issue);setToast(result.issue);return;}
    setPlayerFullscreen(true);
    setOutputNotice('');
    measureMobileLayout();
  },[playerFullscreen,measureMobileLayout]);
  // 当前这条 jobKey 是否还在锁窗里（换周期 = 换 jobKey，不受上一次的窗口影响）。
  const submitPendingForCurrent=submitPending&&submitLockRef.current.key===jobKey;
  // 面板读数：镜像（本机持久的那一份）与界面上的卡片各数一遍 —— 「按 jobKey 恢复」与
  // 「同一条 jobKey 只有一条任务」都由这两个真实读数判定（判据在 data 层，组件不自己判）。
  const mobileView=useMemo(()=>videoMobileView({
    viewportWidth:mobileMeasure?mobileMeasure.viewportWidth:0,
    viewportHeight:mobileMeasure?mobileMeasure.viewportHeight:0,
    overflowRows:mobileMeasure?mobileMeasure.overflowRows:[],
    player:mobileMeasure?mobileMeasure.player:null,
    playerFit:mobileMeasure?mobileMeasure.playerFit:null,
    fullscreenSupported:mobileMeasure?mobileMeasure.fullscreenSupported:fullscreenSupported,
    mirrorJobs:loadVideoJobs(),
    cardKeys:view.jobs.map(job=>job.jobKey),
    duplicatesBlocked:submitBlocked,
    visibilityResumes,
    resumeNote:mobileNotice
  }),[mobileMeasure,fullscreenSupported,jobs,view.jobs,submitBlocked,visibilityResumes,mobileNotice]);
  return <section className="video-jobs" data-video-jobs-panel="true" data-video-jobs-count={view.total} data-video-jobs-active={view.active} data-video-jobs-empty={view.empty?'true':'false'} data-video-jobs-demo={VIDEO_JOB_DEMO_LABEL} data-video-jobs-source={view.sourceLabel} data-video-jobs-latest-key={latestKey} data-video-jobs-resumed-count={view.resumedCount}>
    <div className="archive-section-head"><span>{VIDEO_JOB_SECTION_TITLE} · {view.sourceLabel}</span><h3>视频任务（演示队列）</h3><p>{VIDEO_JOB_SECTION_DESC}</p></div>
    <p className="video-jobs-demo" data-video-demo-label={VIDEO_JOB_DEMO_LABEL}>{VIDEO_JOB_DEMO_LABEL}</p>
    <p className="video-jobs-note" data-video-demo-note="true">{view.demoNote}</p>
    <p className="video-jobs-service" data-video-service-state={service.phase} data-video-service-message={service.message}>
      <span data-video-service-text="true">{service.phase==='checking'?'正在探测真实渲染服务…':service.message}</span>
      <button type="button" className="video-jobs-service-probe" data-video-service-probe="true" onClick={probe} disabled={service.phase==='checking'}>{service.phase==='checking'?'探测中':'重新探测'}</button>
    </p>
    <div className="video-jobs-controls">
      <label>任务类型<input value={typeLabel} readOnly data-video-submit-type={type} aria-label="任务类型"/><small>跟着上面的「查看对象」走</small></label>
      <label>生成周期<select value={period} onChange={event=>onPeriod(event.target.value)} data-video-submit-period="true" aria-label="生成周期">{ARCHIVE_PERIODS.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
      <label className="video-jobs-simulate"><input type="checkbox" checked={simulateFail} onChange={event=>setSimulateFail(event.target.checked)} data-video-simulate-fail="true"/>演示失败（跑到 45% 时失败，用于验证失败态与重试）</label>
      {simulateFail?<label>演示失败原因<select value={simulateErrorCode} onChange={event=>setSimulateErrorCode(event.target.value)} data-video-simulate-error="true" aria-label="演示失败原因">{VIDEO_JOB_SIMULATE_ERROR_OPTIONS.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select><small data-video-simulate-error-text="true">{videoJobErrorText(simulateErrorCode)}</small></label>:null}
      <Button icon={Clapperboard} data-video-submit="true" data-video-submit-key={jobKey} data-video-submit-pending={submitPendingForCurrent?'true':'false'} disabled={Boolean(submitIssue)||!submitAccess.allowed||Boolean(quotaIssue)} onClick={submit}>{VIDEO_JOB_SUBMIT_LABEL}</Button>
    </div>
    <p className="video-jobs-note" data-video-submit-note="true">{VIDEO_JOB_SUBMIT_NOTE}</p>
    {submitIssue?<p className="video-jobs-issue" data-video-submit-issue="true">{submitIssue}</p>:null}
    {/* 权限与配额两道闸（[第四步 US-223] 第 1、4 条）：判定与禁用读同一份产物 ——
        提交按钮的 `disabled` 就是 `submitAccess.allowed` 与 `quotaIssue` 的组合，
        这里把可读原因照原样显示（跨班 / 管理员 / 配额满各是一句不同的话）。 */}
    <p className="video-jobs-permission" data-video-access="true" data-video-access-state={submitAccess.allowed?'allowed':'denied'} data-video-access-scope={submitAccess.scope} data-video-access-reason={submitAccess.reason} data-video-access-download={downloadAccess.allowed?'allowed':'denied'}>
      <b data-video-access-readout="true">{videoTaskAccessReadout(submitAccess)}</b>
      <small data-video-access-download-readout="true">{videoTaskAccessReadout(downloadAccess)}</small>
      <small data-video-access-retention="true">{retentionNote}</small>
    </p>
    <p className="video-jobs-quota" data-video-quota="true" data-video-quota-exceeded={quotaView.exceeded?'true':'false'} data-video-quota-storage={quotaView.storage.text} data-video-quota-traffic={quotaView.traffic.text}>
      <b data-video-quota-text="true">{quotaView.text}</b>
      <small data-video-quota-note="true">{quotaView.note}</small>
      {quotaIssue?<em className="video-jobs-issue" data-video-quota-issue="true">{quotaIssue}</em>:null}
    </p>
    {/* 成片地址的签名合规（第 5 条）：有效期不超过分享有效期，缺签名 / 缺有效期 / 过期都点名。 */}
    <p className="video-jobs-signed-url" data-video-signed-url="true" data-video-signed-url-present={signedUrlView.present?'true':'false'} data-video-signed-url-signed={signedUrlView.signed?'true':'false'} data-video-signed-url-issue={signedUrlView.issue}>
      <b data-video-signed-url-text="true">{signedUrlView.policy.text}</b>
      <small data-video-signed-url-note="true">{signedUrlView.note}</small>
    </p>
    {/* 六条留痕的汇总 + 最近一条（[第四步 US-223] 第 2 条）：提交 / 完成 / 下载 / 分享 / 更换音乐 / 删除。 */}
    <p className="video-jobs-audit" data-video-audit-summary="true" data-video-audit-total={String(videoAuditSummary.total)} data-video-audit-missing={String(videoAuditSummary.missing)}>
      <b>{VIDEO_TASK_AUDIT_SECTION_TITLE}</b>
      <small>{videoAuditSummary.text}</small>
      {videoAuditEntry?<small data-video-audit="true" data-video-audit-action={videoAuditEntry.action} data-video-audit-actor={videoAuditEntry.actorId} data-video-audit-job={videoAuditEntry.jobKey} data-video-audit-video={videoAuditEntry.videoKey} data-video-audit-at={videoAuditEntry.at} data-video-audit-missing-fields={auditEntryMissingFields(videoAuditEntry).join(',')}>{auditTraceText(videoAuditEntry)}</small>:null}
      <small data-video-audit-note="true">{VIDEO_TASK_AUDIT_SECTION_DESC}</small>
    </p>
    <MusicSelectionPanel view={musicView} trackRows={musicView.rows} selectedTrackId={musicSelection.trackId} jobKey={jobKey} notice={musicNotice} onPick={pickMusic} onMute={muteMusic} onDisposition={disposeMusic}/>
    <VideoSelectionPanel view={selectionView} onToggleExclude={toggleExclude}/>
    <VideoTimelinePreview plan={timelinePlan} endingNote={endingNote} onEndingNote={setEndingNote}/>
    {personalPlan?<VideoPersonalTimeline plan={personalPlan}/>:null}
    {classPlan&&classView?<VideoClassTimeline plan={classPlan} view={classView} onMove={moveClassOrder} onReset={resetClassOrder}/>:null}
    <VideoPreviewPanel
      preview={preview}
      share={sharePanel}
      notice={outputNotice}
      shareNotice={shareNotice}
      revokeOpen={shareRevokeOpen}
      playerRef={playerRef}
      fullscreen={playerFullscreen}
      fullscreenSupported={fullscreenSupported}
      onToggleFullscreen={togglePlayerFullscreen}
      onDownload={()=>runPreviewAction(preview.actions.find(action=>action.id==='download'))}
      onShare={()=>runPreviewAction(preview.actions.find(action=>action.id==='share'))}
      onGenerate={generateVideoShare}
      onRevoke={revokeVideoShare}
      onRevokeOpen={()=>setShareRevokeOpen(true)}
      onRevokeCancel={()=>setShareRevokeOpen(false)}
      onValidDays={value=>setShareValidDays(value)}
      onGoAuthorization={goAuthorization}
    />
    {/* 封面是给「发到微信的那条视频链接」配的图（[海报 US-306]）：贴着成片预览放，
        周期沿用这一屏的「生成周期」，时长角标读这条成片的记录。 */}
    <VideoCoverPosterPanel
      isClass={isClass}
      objectName={objectName}
      period={period}
      jobKey={jobKey}
      records={records}
      videoRecords={videoRecords}
      jobs={jobs}
      tokens={tokens}
      teacherName={teacherName}
      orgName={DEFAULT_ORG_NAME}
      logo={logo}
      setToast={setToast}
    />
    <VideoRecordPanel
      view={recordView}
      notice={recordNotice}
      deleteOpen={recordDeleteOpen}
      pending={submitPendingForCurrent}
      onRegenerate={regenerateVideo}
      onRegenerateIssue={regenerateIssue}
      onDeleteOpen={()=>setRecordDeleteOpen(true)}
      onDeleteCancel={()=>setRecordDeleteOpen(false)}
      onDelete={deleteVideoRecord}
      onHistoryView={version=>setRecordViewingVersion(version)}
      onHistoryBack={()=>setRecordViewingVersion(0)}
    />
    <VideoMobilePanel view={mobileView} notice={mobileNotice} onMeasure={measureMobileLayout}/>
    {notice?<p className="video-jobs-notice" data-video-notice="true">{notice}</p>:null}
    {view.resumeSummary?<p className="video-jobs-resumed" data-video-jobs-resumed="true">{view.resumeSummary}</p>:null}
    <p className="video-jobs-summary" data-video-jobs-summary="true">{view.summary}</p>
    {view.empty
      ? <p className="video-jobs-empty" data-video-jobs-empty-text="true">{view.emptyText}</p>
      : <div className="video-jobs-list">{view.jobs.map(job=><VideoJobCard key={job.jobKey} job={job} isLatest={job.jobKey===latestKey} onCancel={cancel} onRetry={retry}/>)}</div>}
  </section>;
}

export default function GrowthArchiveData({records=[],setToast=()=>{},navigate,pageParams,recordsSource=null,reloadRecords=null,archiveReports=[],setArchiveReports=()=>{},teacherName='',shareTokens=[],setShareTokens=()=>{},musicTracks=[],videoRecords=[],setVideoRecords=()=>{},consents=null,recordAudit=()=>{},auditActor=null,auditLog=[],videoQuota=null,videoRetention=null,framingPresets=[]}){
  // 报告生成 / 更新要留痕（[第四步 US-211] 第 4 条：操作人 / 时间 / 对象 / 版本）——
  // 留痕入口与报告写入在同一次动作里（`generateReport`），界面只多显示一行回执。
  const [reportAuditEntry,setReportAuditEntry]=useState(null);
  const [target,setTarget]=useState(ARCHIVE_TARGET_PERSONAL); const [period,setPeriod]=useState(ARCHIVE_PERIOD_FILTER_DEFAULT); const [absenceFilter,setAbsenceFilter]=useState(ARCHIVE_ABSENCE_ALL);
  // 阶段报告（[第四步 US-207a]）的界面 state：两个选择器 + 生成中 / 回执 / 待确认的删除 / 正在回看的历史版本。
  const [reportPeriod,setReportPeriod]=useState(ARCHIVE_PERIOD_DEFAULT); const [reportType,setReportType]=useState(ARCHIVE_REPORT_TYPE_DEFAULT);
  // 视频任务的周期（[第四步 US-213a]）与上面那个「周期筛选」**分开**：筛选是「看什么」，
  // 任务是「生成什么」—— 共用一份 state 会让「只是筛一下」变成「悄悄改了要生成的东西」。
  const [videoPeriod,setVideoPeriod]=useState(ARCHIVE_PERIOD_DEFAULT);
  const [reportBusy,setReportBusy]=useState(false); const [reportNotice,setReportNotice]=useState('');
  const [reportDeleteOpen,setReportDeleteOpen]=useState(false); const [reportHistoryVersion,setReportHistoryVersion]=useState(0);
  // 一键转发海报弹窗（[海报 US-308]）的开合：**弹窗自己的状态（选中模板 / 周期 / 预览 / 缩略图队列）在
  // `PosterDialog` 内部**，这一页只管开合 —— 关掉再打开就是一次干净的「重新进入」（不用手写重置）。
  const [posterDialogOpen,setPosterDialogOpen]=useState(false);
  // 可选项来自学员管理名单（与「学员管理」页同一份本地兜底），并上记录里出现过的名字 ——
  // 记录不会因为名单被改过就再也选不到（[US-205] 第 2、3 条：学员与班级都不写死）。
  const [management]=useState(loadStudentManagement);
  const preferred=pageParams&&typeof pageParams==='object'?pageParams:null;
  const targetLists=useMemo(()=>archiveTargetLists({students:management.students,classes:management.classes,records}),[management,records]);
  const [student,setStudent]=useState(()=>resolveArchiveTargetValue(targetLists.students,preferred&&preferred.student));
  const [className,setClassName]=useState(()=>resolveArchiveTargetValue(targetLists.classes,preferred&&preferred.className));
  // 选中值的两件事：① 带入的偏好（第四步「进入成长档案 / 查看档案」点名的对象）**只在新偏好到来时**
  // 生效一次 —— 否则云端记录晚一步合并、可选项一变，老师刚切走的选中值会被拽回去；
  // ② 其余时候只做「还在可选项里吗」的守卫，不在列表里就回落到第一位（界面不会停在选不中的空名字上）。
  const appliedPreferenceRef=useRef('');
  useEffect(()=>{
    const key=preferred?`${preferred.student||''}|${preferred.className||''}`:'';
    const fresh=Boolean(key)&&key!==appliedPreferenceRef.current;
    if(fresh) appliedPreferenceRef.current=key;
    setStudent(current=>resolveArchiveTargetValue(targetLists.students,fresh?(preferred.student||''):current));
    setClassName(current=>resolveArchiveTargetValue(targetLists.classes,fresh?(preferred.className||''):current));
  },[preferred,targetLists]);
  // 课次实体列表（[第四步到第一步联通] US-087）：本机镜像读一次 —— 给只有 `lessonId` 的老归档记录
  // 补课时序号。记录自己带 `lessonNo` 的（US-087 之后归档的）不用查，查不到的就是 0（未知，不猜）。
  const lessonList=useMemo(()=>loadLessons(),[]);
  // 常驻视图的唯一产物：概况 + 时间线 + 被筛掉的条数（界面只读它，不自己过滤一遍）。
  // 时间线每一行还带**转发状态**（US-209）：按档案记录 id 在令牌账里查，三态与打开次数都从 data 层推出来。
  const view=useMemo(()=>archiveResidentView({records,target,student,className,period,absenceOnly:absenceFilter===ARCHIVE_ABSENCE_ONLY,tokens:shareTokens,lessons:lessonList}),[records,target,student,className,period,absenceFilter,shareTokens,lessonList]);
  // 帧清单（[第四步 US-215]）读的是**生成周期**（`videoPeriod`）而不是上面那个「周期筛选」：
  // 筛选是「看什么」，视频是「生成什么」—— 两件事各用各的窗口，与提交时的任务口径一致。
  const videoEntries=useMemo(()=>archiveResidentView({records,target,student,className,period:videoPeriod,absenceOnly:false,tokens:shareTokens,lessons:lessonList}).entries,[records,target,student,className,videoPeriod,shareTokens,lessonList]);
  // 个人成长视频时间线（[第四步 US-217]）读的是这个周期的**全部记录**（不带对象筛选）：
  // 「只收录该学员自己的作品」交给数据层保证（它自己按 `entry.student` 过滤，并把其他学员的记录如实报数），
  // 不靠这里传对了参数 —— 传错了也串不进去。
  const videoScopeEntries=useMemo(()=>filterArchiveRecordsByPeriod(records,resolveArchivePeriod(videoPeriod)).map(record=>archiveLessonEntry(record,{tokens:shareTokens,lessons:lessonList})),[records,videoPeriod,shareTokens,lessonList]);
  // 班级视频集锦（[第四步 US-218]）读的是**这个班级**在这个周期的记录 + 班级名单（顺序真源）：
  // 分段顺序默认就是名单的顺序，名单之外但本期有记录的学员由数据层接在后面（并如实报数）。
  const videoClassEntries=useMemo(()=>{
    if(!view.isClass) return [];
    const className=view.name;
    return filterArchiveRecordsByPeriod(records,resolveArchivePeriod(videoPeriod))
      .filter(record=>String((record&&record.className)||'').trim()===className)
      .map(record=>archiveLessonEntry(record,{tokens:shareTokens,lessons:lessonList}));
  },[records,videoPeriod,view.isClass,view.name,shareTokens,lessonList]);
  const classRoster=useMemo(()=>{
    if(!view.isClass) return [];
    const className=view.name;
    return management.students
      .filter(item=>String((item&&item.className)||'').trim()===className)
      .map(item=>String((item&&item.name)||'').trim())
      .filter(Boolean);
  },[management,view.isClass,view.name]);
  // 海报上的机构 Logo（[海报 US-305] 班级墙 / [海报 US-306] 视频封面 / FR-323）：取**默认装裱模板**
  // 里配置的那张水印图 —— 与第四步海报同一支判据（`frameSpecRenderView().overlays.watermark.logo.url`）；
  // 没配置时数据层会把 Logo 位换成机构名（占位补丁），这里不编一个假地址。
  const archivePosterLogo=useMemo(()=>{
    const preset=defaultFramingPreset(framingPresets);
    if(!preset) return '';
    const renderView=frameSpecRenderView(preset.spec);
    return String((renderView&&renderView.overlays&&renderView.overlays.watermark&&renderView.overlays.watermark.logo&&renderView.overlays.watermark.logo.url)||'').trim();
  },[framingPresets]);
  // 四种状态（加载 / 就绪 / 空 / 错误）读的是同一个产物，四份读数同形状。
  const sourceStatus=recordsSource&&recordsSource.phase?recordsSource.phase:'ready';
  const phase=archiveResidentPhase({source:sourceStatus,count:view.count});
  const state=archiveResidentStateView({phase,view});
  const targetName=view.displayName;
  // 读取失败时本机镜像里还有记录：明示来源后照常展示（不静默丢内容，也不假装云端成功）。
  const localMirror=phase===ARCHIVE_RESIDENT_STATES.error&&view.count>0;
  const showTimeline=phase===ARCHIVE_RESIDENT_STATES.ready||localMirror;
  const showEmptyPanel=phase===ARCHIVE_RESIDENT_STATES.empty;
  const showStatePanel=phase===ARCHIVE_RESIDENT_STATES.loading||phase===ARCHIVE_RESIDENT_STATES.error||showEmptyPanel;
  const pickerOptions=archiveTargetOptions(targetLists,target);
  const pickerValue=view.isClass?className:student;
  // ---- 移动端与性能（[第四步 US-212]）---------------------------------------------------------
  // 首屏：数据就绪（时间线真的有内容可渲染）→ 提交后的第一帧；滚动：真实滚动期间按 rAF 采帧。
  // 规则（预算 / 分页窗口 / 四项结论）全在 `data/archivePerformance.js`，这里只提供原始测量值。
  const [timelinePage,setTimelinePage]=useState(1);
  const [firstPaint,setFirstPaint]=useState(null);
  const [scrollStats,setScrollStats]=useState(null);
  const [thumbStates,setThumbStates]=useState({});
  const perfProbeRef=useRef({mountAt:nowMs(),dataAt:0,paintAt:0});
  // 换对象 / 换筛选 → 分页窗口回到第一页（否则会停在「第 3 页」这种与筛选对不上的位置）。
  useEffect(()=>{setTimelinePage(1)},[target,student,className,period,absenceFilter]);
  // 分页窗口（超过 20 条只把当前窗口放进 DOM）与这一次真正渲染的条目。
  const timelineWindow=useMemo(()=>archiveTimelineWindow({count:view.entries.length,page:timelinePage}),[view.entries.length,timelinePage]);
  const visibleEntries=useMemo(()=>archiveWindowEntries(view.entries,timelineWindow),[view.entries,timelineWindow]);
  // 这一次渲染的图张数（缩略图读数的分母）：没进视口、还没被请求的图记成「懒加载」。
  const expectedImages=useMemo(()=>visibleEntries.reduce((total,entry)=>total+(entry.artwork.url?1:0)+entry.photos.filter(photo=>photo.url).length,0),[visibleEntries]);
  const thumbCounts=useMemo(()=>{
    const values=Object.values(thumbStates);
    const ready=values.filter(value=>value==='ready').length;
    const pending=values.filter(value=>value==='pending').length;
    const failed=values.filter(value=>value==='direct').length;
    return {ready,pending,failed,lazy:Math.max(0,expectedImages-ready-pending-failed)};
  },[thumbStates,expectedImages]);
  // 缩略图状态回填（`useCallback` 是为了让卡片的 IntersectionObserver 不因每次渲染换回调而重建）。
  const noteThumb=useCallback((key,state)=>setThumbStates(current=>current[key]===state?current:{...current,[key]:state}),[]);
  // 海报弹窗的对象（学员 / 班级）：**memo 住引用** —— 弹窗每收到一个新对象都会重建「模板清单 + 五类版式的
  // 装配」，普通的重渲染（比如时间线缩略图回填）不该让那 8 份 plan 白算一遍。
  const posterDialogObjectProp=useMemo(()=>({target:view.target,name:view.name,students:management.students}),[view.target,view.name,management]);
  // 数据就绪时刻：时间线第一次真的有内容可渲染的那一刻（首屏计时的起点）。
  useEffect(()=>{
    if(showTimeline&&view.count>0&&!perfProbeRef.current.dataAt) perfProbeRef.current.dataAt=nowMs();
  },[showTimeline,view.count]);
  // 首屏渲染完成：提交后的第一帧（≈ 浏览器画出这一帧的时刻），整页只记第一次。
  useEffect(()=>{
    const probe=perfProbeRef.current;
    if(!showTimeline||!view.count||!probe.dataAt||probe.paintAt) return undefined;
    let cancelled=false;
    nextFrame().then(stamp=>{
      if(cancelled||perfProbeRef.current.paintAt) return;
      perfProbeRef.current.paintAt=stamp;
      const reading={ms:Math.max(0,stamp-perfProbeRef.current.dataAt),count:view.count,sinceMountMs:Math.max(0,stamp-perfProbeRef.current.mountAt)};
      setFirstPaint(reading);
      if(typeof window!=='undefined') window.__xinlehuiArchivePerf={...perfProbeRef.current,firstPaint:reading};
    });
    return ()=>{cancelled=true;};
  },[showTimeline,view.count]);
  // 滚动帧率：滚动期间按 rAF 采帧，滚动停下 400ms 收束一次（不足 30fps 时读数如实报未达标）。
  useEffect(()=>{
    const probe=createArchiveScrollProbe({onSample:stats=>{
      setScrollStats(stats);
      if(typeof window!=='undefined') window.__xinlehuiArchivePerf={...(window.__xinlehuiArchivePerf||{}),scroll:stats};
    }});
    const handler=()=>probe.scroll();
    if(typeof window!=='undefined') window.addEventListener('scroll',handler,{passive:true});
    return ()=>{if(typeof window!=='undefined')window.removeEventListener('scroll',handler);probe.cancel();};
  },[]);
  // 四项性能读数（首屏 / 分页 / 滚动帧率 / 缩略图）—— 结论只在 data 层算，界面只渲染。
  const perfChecks=archivePerformanceChecks({
    firstPaint:firstPaint?{ms:firstPaint.ms,count:firstPaint.count}:null,
    paging:{count:view.count,mode:timelineWindow.mode,pageSize:timelineWindow.pageSize,visible:timelineWindow.visible},
    scrollFps:scrollStats?{fps:scrollStats.fps,frames:scrollStats.frames}:null,
    thumbnails:{ready:thumbCounts.ready,pending:thumbCounts.pending,lazy:thumbCounts.lazy,failed:thumbCounts.failed,total:expectedImages}
  });
  // 切换筛选只改筛选条件：周期 / 缺课筛选 / 已选对象都**不重置**，时间线与概况当场跟着换（US-206 第 3 条）。
  const switchTarget=next=>{if(next!==target)setTarget(next)};
  const pickTarget=value=>{if(view.isClass)setClassName(value);else setStudent(value)};
  const resetFilters=()=>{setPeriod(ARCHIVE_PERIOD_FILTER_DEFAULT);setAbsenceFilter(ARCHIVE_ABSENCE_ALL)};
  const runStateAction=()=>{
    if(state.reset){resetFilters();return}
    if(state.create){navigate&&navigate('create');return}
    if(state.retry&&typeof reloadRecords==='function')reloadRecords();
  };
  const downloadAssets=()=>{
    const assets=view.entries.flatMap((entry,index)=>[
      entry.artwork.url&&{url:entry.artwork.url,name:`${entry.date}-${entry.title||'作品'}-成品作品-${index+1}.png`},
      ...entry.photos.filter(photo=>photo.url).map((photo,photoIndex)=>({url:photo.url,name:`${entry.date}-${entry.title||'课堂'}-课堂照片-${index+1}-${photoIndex+1}.jpg`}))
    ].filter(Boolean));
    assets.forEach(({url,name})=>{const link=document.createElement('a');link.href=url;link.download=name;link.click()});
    setToast(assets.length?`已开始下载 ${assets.length} 份处理后的成品素材。`:'当前档案里暂没有可下载的成品素材。');
  };

  // ---- 阶段报告（[第四步 US-207a]）------------------------------------------------------------
  // 报告键 = 当前对象 + 当前选的周期与类型（键怎么拼只由 `archiveReportKey` 决定）。
  const reportKey=view.name?archiveReportKey({target:view.target,name:view.name,period:reportPeriod,type:reportType}):'';
  const existingReport=useMemo(()=>findArchiveReport(archiveReports,reportKey),[archiveReports,reportKey]);
  // 界面读的是「报告视图」这一份产物：注解（生成于 X 月 X 日 · 共 N 节课）、版本、历史版本都在里面。
  const reportView=useMemo(()=>archiveReportView(existingReport),[existingReport]);
  // 这个周期窗口里有多少节课：决定生成按钮能不能点（点不了时给具体原因，不用笼统的「请完善信息」）。
  const reportLessonCount=useMemo(()=>filterArchiveRecordsByPeriod(view.targetView.lessons,reportPeriod).length,[view.targetView.lessons,reportPeriod]);
  const reportIssue=archiveReportGenerateIssue({name:view.name,total:view.total,count:reportLessonCount,period:reportPeriod});
  // 生成之后归档里又有新内容 → 给出「为什么值得点一次更新」的具体理由。
  const reportStale=useMemo(()=>archiveReportStale(existingReport,view.targetView.lessons),[existingReport,view.targetView.lessons]);
  // 再次进入这一页：把这位对象**最近生成的那一份**报告的周期与类型回填给下拉 —— 已有同 reportKey 的报告
  // 就被直接展示出来，而不是让老师重新做一遍生成选择题（验收第 3 条）。只在换了对象时回填一次：
  // 老师自己切过周期 / 类型之后，别的 state 变化不许把他拽回去（US-205 的 appliedPreferenceRef 同款纪律）。
  const appliedReportTargetRef=useRef('');
  useEffect(()=>{
    const key=`${view.target}|${view.name}`;
    if(!view.name||key===appliedReportTargetRef.current) return;
    appliedReportTargetRef.current=key;
    const seeded=archiveReportDefaultSelection({reports:archiveReports,target:view.target,name:view.name});
    setReportPeriod(seeded.period);
    setReportType(seeded.type);
    setReportHistoryVersion(0);
    setReportDeleteOpen(false);
    setReportNotice('');
  },[view.target,view.name,archiveReports]);
  const pickReportPeriod=value=>{setReportPeriod(value);setReportHistoryVersion(0);setReportDeleteOpen(false)};
  const pickReportType=value=>{setReportType(value);setReportHistoryVersion(0);setReportDeleteOpen(false)};
  /**
   * 生成 / 更新一份报告（同一个动作，两种语义 —— 词都在 data 层）：
   *  ① 纯聚合出快照 → `createArchiveReport` / `updateArchiveReport`（后者 version 自增、上一版进历史）；
   *  ② **先落本机镜像**（`setArchiveReports`，App 的 effect 负责写 localStorage）—— 云端不通也不丢；
   *  ③ 再推云端；推成功把状态翻成「已同步」，失败就如实标注「仅本机镜像」（不假装成功）。
   *  `generatedBy` 用会话里的老师姓名（与课次 `teacherId` / 写回 `operatorId` 同一口径）。
   */
  const generateReport=async()=>{
    if(reportBusy||reportIssue||!reportKey) return;
    setReportBusy(true);
    setReportNotice('');
    const generatedBy=teacherName||'';
    const snapshot=buildArchiveReportSnapshot({records,target:view.target,name:view.name,period:reportPeriod,type:reportType});
    const next=existingReport
      ?updateArchiveReport(existingReport,{snapshot,generatedBy,status:ARCHIVE_REPORT_STATUSES.local})
      :createArchiveReport({snapshot,generatedBy,status:ARCHIVE_REPORT_STATUSES.local});
    const verb=existingReport?'更新':'生成';
    setArchiveReports(list=>applyArchiveReport(list,next));
    setReportHistoryVersion(0);
    // 留痕（[第四步 US-211]）：对象是这位学员 / 班级 + 周期与类型，版本是报告的第 N 版。
    const auditActorValue=auditActor||{actorId:teacherName,actorName:teacherName,actorRole:'teacher',actorRoleLabel:'老师'};
    const auditEntry=recordAudit({
      ...auditActorValue,
      action:AUDIT_ACTIONS.reportGenerate,
      objectName:next.displayName||view.name,
      studentName:view.isClass?'':view.name,
      version:next.version,
      scope:next.period||reportPeriod,
      detail:`${next.displayName||view.name} 的${next.period||reportPeriod}${next.type||reportType}已${verb}（第 ${next.version} 版）· 共 ${reportLessonCount} 节课`
    });
    if(auditEntry) setReportAuditEntry(auditEntry);
    try{
      await saveRemoteArchiveReport(next);
      setArchiveReports(list=>applyArchiveReport(list,setArchiveReportStatus(next,ARCHIVE_REPORT_STATUSES.synced)));
      setReportNotice(`${next.displayName}的${next.period}${next.type}已${verb}（${archiveReportVersionLabel(next.version)}），并已同步到云端。`);
      setToast(`${next.displayName}的${next.period}${next.type}已${verb}（${archiveReportVersionLabel(next.version)}）`);
    }catch{
      // 云端表还没建 / 这次没接到：报告已经在本机镜像里，如实说明同步状态（不静默降级）。
      setReportNotice(`${next.displayName}的${next.period}${next.type}已${verb}（${archiveReportVersionLabel(next.version)}）：${ARCHIVE_REPORT_LOCAL_NOTE}`);
      setToast(`${next.displayName}的${next.period}${next.type}已${verb}（${archiveReportVersionLabel(next.version)}），先保存在本机`);
    }finally{
      setReportBusy(false);
    }
  };
  /** 删除报告：只摘掉这一份（`removeArchiveReport` 只动报告列表），归档记录一条都不碰（FR-241）。 */
  const deleteReport=async()=>{
    if(!reportKey) return;
    const removed=findArchiveReport(archiveReports,reportKey);
    setReportDeleteOpen(false);
    setReportHistoryVersion(0);
    setArchiveReports(list=>removeArchiveReport(list,reportKey));
    try{ await deleteRemoteArchiveReport(reportKey); }
    catch{ /* 云端表还没建 / 这次没接到：本机镜像里已经摘掉了，云端下次写入时自然不会再带上它 */ }
    setReportNotice(`${removed?`${removed.displayName}的${removed.period}${removed.type}`:''}${ARCHIVE_REPORT_DELETE_DONE}`);
    setToast(ARCHIVE_REPORT_DELETE_DONE);
  };
  const reportPanel=showTimeline?<ArchiveReportPanel
    reportKey={reportKey} reportView={reportView} period={reportPeriod} type={reportType} issue={reportIssue} busy={reportBusy}
    notice={reportNotice} stale={reportStale} deleteOpen={reportDeleteOpen} historyVersion={reportHistoryVersion}
    onPeriod={pickReportPeriod} onType={pickReportType} onGenerate={generateReport}
    onDeleteOpen={()=>setReportDeleteOpen(true)} onDeleteCancel={()=>setReportDeleteOpen(false)} onDelete={deleteReport}
    onHistoryView={version=>setReportHistoryVersion(version)} onHistoryBack={()=>setReportHistoryVersion(0)}
    auditEntry={reportAuditEntry}
  />:null;
  return <>
    <div className="page-head"><div><div className="title-line"><h1>成长档案</h1><span className="prd-tag">PRD-12 / F-ARCHIVE-01</span></div><p>把处理后的作品、照片和点评，连成孩子自己的成长轨迹。</p></div></div>
    <section className="growth-builder archive-data-report archive-resident" data-archive-filter={view.target} data-archive-filter-name={view.name} data-archive-record-count={view.total} data-archive-visible-count={view.count} data-archive-period-value={view.period} data-archive-absence={view.absenceFilter} data-archive-state={phase} data-archive-hidden-by-period={view.hiddenByPeriod} data-archive-hidden-by-absence={view.hiddenByAbsence}>
      <div className="growth-builder-top"><div><h2>让每一次认真，都有可以回看的位置。</h2><p>成长档案直接展示已归档的内容：成品作品、修正照片与老师确认后的点评；原始拍摄图不作为家长版素材展示。</p></div><span className="report-panda"><Sparkles/></span></div>
      <div className="growth-controls archive-target-controls">
        <label>查看对象<div className="mode-switch"><button className={target===ARCHIVE_TARGET_PERSONAL?'active':''} onClick={()=>switchTarget(ARCHIVE_TARGET_PERSONAL)} data-archive-target={ARCHIVE_TARGET_PERSONAL}>个人成长档案</button><button className={target===ARCHIVE_TARGET_CLASS?'active':''} onClick={()=>switchTarget(ARCHIVE_TARGET_CLASS)} data-archive-target={ARCHIVE_TARGET_CLASS}>班级成长档案</button></div></label>
        <label>{view.isClass?'选择班级':'选择学员'}<select value={pickerValue} onChange={event=>pickTarget(event.target.value)} data-archive-picker={view.isClass?'class':'student'} data-archive-picker-value={pickerValue} aria-label={view.isClass?'选择班级':'选择学员'}>{pickerOptions.length?pickerOptions.map(name=><option key={name} value={name}>{name}</option>):<option value="">暂无可选{view.isClass?'班级':'学员'}</option>}</select></label>
        <label>周期筛选<select value={period} onChange={event=>setPeriod(event.target.value)} data-archive-period="true" aria-label="周期筛选">{ARCHIVE_PERIOD_FILTERS.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
        <label>缺课筛选<select value={absenceFilter} onChange={event=>setAbsenceFilter(event.target.value)} data-archive-absence-filter="true" aria-label="缺课筛选">{ARCHIVE_ABSENCE_FILTERS.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
      </div>
      {showStatePanel?<section className={`archive-resident-state ${phase==='error'?'is-error':''}`} data-archive-state-panel={phase} data-archive-state-title={state.title} {...(phase==='empty'&&!view.total?{'data-archive-empty':'true','data-archive-empty-target':view.target,'data-archive-empty-name':view.name}:{})}>
        {phase==='error'?<RefreshCw size={26}/>:phase==='loading'?<Sparkles size={26}/>:<Archive size={26}/>}
        <b>{state.title}</b>
        {state.desc?<p>{state.desc}</p>:null}
        {state.hint?<small>{state.hint}</small>:null}
        {state.action?<Button icon={state.retry?RefreshCw:Plus} data-archive-state-action="true" data-archive-state-action-kind={state.retry?'retry':state.reset?'reset':'create'} onClick={runStateAction}>{state.action}</Button>:null}
      </section>:null}
      {localMirror?<p className="archive-resident-local-note" data-archive-local-note="true">{ARCHIVE_RESIDENT_LOCAL_NOTE}</p>:null}
      {showTimeline?<>
        <section className="archive-overview" data-archive-overview="true" data-archive-overview-lessons={view.summary.lessons} data-archive-overview-artworks={view.summary.artworks} data-archive-overview-photos={view.summary.photos} data-archive-overview-last={view.summary.lastArchivedText}>
          <div className="archive-overview-head"><span>档案概况</span><h3>{targetName} · 按当前筛选</h3></div>
          <div className="archive-overview-grid">{view.overview.map(field=><div key={field.id} data-archive-overview-field={field.id} data-archive-overview-ok={field.ok?'true':'false'}><span>{field.label}</span><b>{field.value}</b><small>{field.detail}</small></div>)}</div>
        </section>
        {reportPanel}
        <section className="archive-lesson-history" data-archive-timeline="true" data-archive-timeline-count={view.count} data-archive-rendered-count={timelineWindow.visible} data-archive-timeline-mode={timelineWindow.mode}>
          <div className="archive-section-head"><span>课次时间线 · 按日期升序</span><h3>{ARCHIVE_TIMELINE_TITLE}</h3><p>{ARCHIVE_TIMELINE_DESC}</p><p className="archive-timeline-window-note" data-archive-window-note="true">{timelineWindow.hint}</p></div>
          <div className="history-list">{visibleEntries.map(entry=>entry.isAbsence?<ResidentAbsence key={entry.id||entry.recordKey} entry={entry}/>:<ResidentLesson key={entry.id||entry.recordKey} entry={entry} onThumb={noteThumb}/>)}</div>
          {timelineWindow.paged?<nav className="archive-page-controls" data-archive-page-controls="true" data-archive-page={String(timelineWindow.page)} data-archive-page-count={String(timelineWindow.pageCount)} data-archive-page-visible={String(timelineWindow.visible)} data-archive-page-hidden={String(timelineWindow.hidden)} aria-label="时间线分页">
            {timelineWindow.hasPrev?<button type="button" data-archive-page-prev="true" onClick={()=>setTimelinePage(page=>Math.max(1,page-1))}>{timelineWindow.prevLabel}</button>:null}
            <span data-archive-page-label="true">{timelineWindow.rangeLabel}</span>
            {timelineWindow.hasMore?<button type="button" className="primary" data-archive-page-more="true" onClick={()=>setTimelinePage(page=>Math.min(timelineWindow.pageCount,page+1))}>{timelineWindow.moreLabel}</button>:null}
          </nav>:null}
        </section>
        {view.isClass?<ClassPosterPanel className={view.name} roster={classRoster} records={records} tokens={shareTokens} teacherName={teacherName} orgName={DEFAULT_ORG_NAME} logo={archivePosterLogo} setToast={setToast}/>:<ReportLongPosterPanel student={view.name} records={records} lessons={lessonList} tokens={shareTokens} teacherName={teacherName} orgName={DEFAULT_ORG_NAME} logo={archivePosterLogo} setToast={setToast} navigate={navigate}/>}
        <VideoJobsPanel logo={archivePosterLogo} isClass={view.isClass} objectName={view.name} period={videoPeriod} onPeriod={setVideoPeriod} lessonCount={view.summary.lessons} artworkCount={view.summary.artworks} photoCount={view.summary.photos} teacherName={teacherName} setToast={setToast} entries={videoEntries} scopeEntries={videoScopeEntries} classEntries={videoClassEntries} roster={classRoster} tokens={shareTokens} records={records} consents={consents} musicTracks={musicTracks} videoRecords={videoRecords} auditLog={auditLog} videoQuota={videoQuota} videoRetention={videoRetention} management={management} setShareTokens={setShareTokens} setVideoRecords={setVideoRecords} recordAudit={recordAudit} auditActor={auditActor} navigate={navigate}/>
        <section className="archive-perf-panel" data-archive-perf="true" data-archive-perf-measured={String(perfChecks.measured)} data-archive-perf-total={String(perfChecks.total)} data-archive-perf-all-ok={perfChecks.allOk?'true':'false'} data-archive-perf-summary-text={perfChecks.summary}>
          <div className="archive-perf-head"><Gauge size={15}/><b>档案性能</b><em data-archive-perf-summary="true">{perfChecks.summary}</em><small>{ARCHIVE_PERF_HINT}</small></div>
          <ul className="archive-perf-list">{perfChecks.rows.map(row=><li key={row.id} data-archive-perf-row={row.id} data-archive-perf-state={row.ok===null?'pending':row.ok?'ok':'over'} data-archive-perf-value={row.value} data-archive-perf-budget={row.budget} data-archive-perf-text={row.text}>
            <b>{row.label}</b><span data-archive-perf-row-value="true">{row.value||'待测'}{row.budget?` / ${row.budget}`:''}</span><em>{row.text}</em>
          </li>)}</ul>
        </section>
        <div className="report-footer"><span>家长看到的与这里同一份内容：只含成品素材与老师确认后的点评。</span><div><button onClick={downloadAssets} data-archive-download="true"><Download size={17}/>下载成品</button><button className="primary" onClick={()=>setPosterDialogOpen(true)} data-archive-forward-poster="true"><MessageSquareText size={17}/>一键转发家长</button></div></div>
        {/* 「一键转发家长」打开的是**海报弹窗**（[海报 US-308]）：数据来源 = 当前对象 + 当前周期筛选。
            空态（没有归档记录）在弹窗里给「去创建课后反馈」，这里不预判。 */}
        {posterDialogOpen?<PosterDialog
          entry={POSTER_DIALOG_ENTRY_ARCHIVE}
          object={posterDialogObjectProp}
          periodFilter={period}
          records={records}
          lessons={lessonList}
          tokens={shareTokens}
          videoRecords={videoRecords}
          teacherName={teacherName}
          orgName={DEFAULT_ORG_NAME}
          logo={archivePosterLogo}
          navigate={navigate}
          setShareTokens={setShareTokens}
          recordAudit={recordAudit}
          auditActor={auditActor}
          onClose={()=>setPosterDialogOpen(false)}
        />:null}
      </>:null}
    </section>
  </>;
}
