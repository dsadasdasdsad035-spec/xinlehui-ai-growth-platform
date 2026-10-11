import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, BookOpen, Boxes, Check, ChevronDown,
  CircleAlert, CircleCheck, Clock3, Download, FileText, Film, FolderOpen, Frame,
  GraduationCap, Image, Landmark, LayoutDashboard, LogOut, Menu, MessageSquareText, MoreHorizontal,
  ListChecks, Package, PanelLeftClose, Plus, RefreshCw, RotateCcw, RotateCw, Save, Search, Settings, ShieldAlert, ShieldCheck, Sparkles,
  Store, Trash2, UploadCloud, UserRound, Users, Video, WandSparkles, X, Zap
} from 'lucide-react';
import './styles.css';
import './brand-yellow.css';
import './focus-workspace.css';
import './upload-flow.css';
import './teacher-flow.css';
import './review-gallery.css';
import './archive-studio.css';
import './archive-enhancements.css';
import './review-vertical.css';
import './teacher-welcome.css';
import './welcome-simple.css';
import './welcome-art-direction.css';
import './welcome-finish.css';
import './welcome-responsive-import.css';
import './teacher-typography.css';
import './growth-report.css';
import './flow-v2.css';
import './premium-framing.css';
import './p0-local-draft.css';
import './review-compact.css';
import './persona-framing.css';
import './gallery/gallery.css';
import pandaMascot from './assets/panda-gold-hero.png';
import pandaObserve from './assets/panda-gold-observe.png';
import pandaWave from './assets/panda-poses/01-wave-paintbrush.png';
import { createFeedbackRecord, loadFeedbackRecords, persistFeedbackRecords } from './data/feedbackRecords';
import { createParentSession, loadParentFeedbackRecords, loadRemoteFeedbackRecords, saveRemoteFeedbackRecords } from './services/feedbackRecordsApi';
import { REVIEW_TRACE_TASKS, loadReviewTraces, makeReviewTraceId, mergeReviewTraces, persistReviewTrace, persistReviewTraces, reviewTraceSummary } from './data/reviewTrace';
// 两次生成的对比（US-107b）：`parentTraceId` 关联的上一次 vs 本次的模型 / 耗时 / 推理，
// 以及「已收束轨迹只驻留内存」的小账本，全在 data 层纯函数里（界面只渲染它的产物）。
import { archiveReviewTraces, findArchivedTrace, reviewTraceCompare } from './data/reviewTraceCompare';
// 轨迹的留存 / 披露 / 可见性与筛选（[第三步 US-112]）：保留期默认 90 天、到期清理先预览影响范围、
// 平台开关 `allowPromptDisclosure` 决定老师端能不能看提示词正文、老师只看自己经手的轨迹。
// 判据全部在 data 层（零依赖、可 Node 断言），界面只渲染它的产物。
import { REVIEW_TRACE_DISCLOSURE_NOTE, REVIEW_TRACE_RETENTION_OPTIONS, REVIEW_TRACE_SURFACES, applyReviewTraceCleanup, loadReviewTracePolicy, normalizeReviewTracePolicy, persistReviewTracePolicy, reviewPromptDisclosureAllowed, reviewTraceCleanupPreview, reviewTracePolicyPatch, reviewTracePolicySummary, reviewTraceRetentionText, reviewTraceSurfaceAllowed, reviewTraceViewer } from './data/reviewTracePolicy';
import { loadRemoteReviewTraces, pushRemoteReviewTrace, queryRemoteReviewTraces, saveRemoteReviewTrace } from './services/reviewTraceApi';
// 平台开关关闭时的提示词遮罩（US-112 第 5 条）：老师端面板与两种导出读同一份产物。
import { reviewPromptDisclosureMask } from './data/reviewDetailPanel';
import ReviewTraceLogsPanel from './admin/ReviewTraceLogsPanel';
import { loadStudentManagement } from './data/studentManagement';
import StudentArchiveData from './StudentArchiveData';
import GrowthArchiveData from './GrowthArchiveData';
import { requestAiReview, uploadControlledMedia } from './services/reviewApi';
import { ARTWORK_CLEAN_ALGORITHM, createExhibitionFrame, createPortraitPrint, extractArtworkSurfaceDetails, measureFramingCoverage, renderFramedArtwork } from './services/framing';
// 作品编辑器（US-004a 旋转与撤销重做 / US-004b 裁剪框与比例预设）：单幅作品的编辑状态 `artworkEdit`、
// 撤销栈与裁剪框几何的唯一真源都在 data 层（零依赖、可 Node 断言），
// 「原图 → 旋转稿 → 裁剪稿」的画布渲染在 services/artworkEditor.js。原图 originalUrl 全程只读，编辑结果单独一份。
import { ARTWORK_EDIT_PROTECTIONS, ARTWORK_PREVIEW_SETTLE_MS, ARTWORK_ZOOM_BUTTON_FACTOR, ARTWORK_ZOOM_RANGE, EDIT_PREVIEW_HD_MAX_EDGE, EDIT_PREVIEW_MAX_EDGE, FINE_ROTATION_STEP, artworkEditHistoryState, artworkEditIsDefault, artworkEditSnapshotKey, artworkImageTransform, artworkViewKey, artworkViewSummary, canNudgeArtworkEditRotation, canResetArtworkEdit, canRestoreArtworkFullFrame, canZoomArtworkEdit, createArtworkEdit, createArtworkEditHistory, currentArtworkEdit, fineRotationOf, formatRotationDeg, normalizeArtworkEdit, nudgeArtworkEditRotation, panArtworkEdit, pushArtworkEditHistory, redoArtworkEditHistory, resetArtworkEdit, restoreArtworkFullFrame, rotateArtworkEdit, rotationSummary, undoArtworkEditHistory, wheelZoomFactor, zoomArtworkEdit, zoomLabel } from './data/artworkEdit';
// 四层地址（原图 / 旋转稿 / 裁剪稿 / 成品图，US-005）：只读层与派生层的清单、地址指纹与写入侧的
// 「原图只读」守卫都在这里，界面把这份清单显示给老师看（原图不会被任何编辑覆盖）。
import { ARTWORK_LAYER_KEYS, applyArtworkLayerPatch, artworkLayerEntries, artworkLayerReadyCount, artworkLayerSummary, artworkUrlFingerprint } from './data/artworkLayers';
import { CROP_ASPECT_PRESETS, CROP_BODY_HANDLE, CROP_FREE_ASPECT_ID, CROP_HANDLES, CROP_MIN_RATIO, CROP_SNAP_RATIO, applyCropPreset, cropBoxStyle, cropHandleLabel, cropIsFull, cropRatioText, cropRectOf, cropSizeText, cropSummary, describeCropRules, matchCropPreset, moveCrop, resizeCrop, resolveCropAspect } from './data/artworkCrop';
import { renderArtworkCrop, renderArtworkRotation, ARTWORK_MANUAL_CROP_ALGORITHM } from './services/artworkEditor';
import { createEmptyTeacherProfile, loadTeacherProfiles, persistTeacherProfiles } from './data/teacherProfiles';
import { deleteRemoteTeacherProfile, loadRemoteTeacherProfiles, saveRemoteTeacherProfile } from './services/teacherProfileApi';
import { createEmptySkill, loadSkillLibrary, persistSkillLibrary, resolveSkills, skillFromIndexEntry, skillFromPackage, skillLoadout } from './data/skillLibrary';
// agent.md 与记忆文件库（US-105）：加载顺序 / 生效范围 / 每层上限 / 8000 字符预算 / 变量替换 /
// 版本与内容 hash 的唯一真源（零依赖、可 Node 断言）；提示词、面板清单与轨迹留档读同一份产物。
import { agentFileLoadout, loadAgentFiles, persistAgentFiles } from './data/agentFiles';
// 管理端「Agent 指令与记忆」（US-106a）：版本自增 / 版本快照 / 变更历史 / 分组 / 复制 / 回滚 / 对比
// 的唯一真源（零依赖、可 Node 断言）；页面只渲染与调用，不许自己动 version / versions / history。
import { mergeAgentFiles } from './data/agentFileAdmin';
import { loadRemoteAgentFiles } from './services/agentFilesApi';
import { deleteRemoteSkill, loadRemoteSkillLibrary, saveRemoteSkill } from './services/skillLibraryApi';
import { archiveSkillPackage, readSkillPackage } from './services/skillPackage';
import { MARKETPLACE_SYNCED_AT, indexStats, marketCategories, searchMarket, searchSkillIndex } from './data/skillMarketplace';
// 装裱模板分三层（platform / org / teacher，US-001b）：scope + ownerKey 决定归属，
// 老师端只显示自己可见的模板（filterFramingPresetsForViewer），管理端读全量。
// US-011b 的默认模板 / 按课程绑定 / 引用范围 / 变更历史也都在这份零依赖模块里 ——
// 老师端的「默认选哪一套」与管理端的「删除只允许停用」读的是同一批纯函数。
import { FRAMING_PRESET_COURSE_BINDING_NOTE, FRAMING_PRESET_DEFAULT_NOTE, FRAMING_PRESET_DELETE_NOTE, FRAMING_PRESET_HISTORY_EMPTY, bindFramingPresetCourse, buildTeacherFramingPreset, createEmptyFramingPreset, defaultFramingPreset, editableFramingPresets, filterFramingPresetsForViewer, framePresetEditableBy, framingPresetChangeSummary, framingPresetCourseConflicts, framingPresetDeleteVerdict, framingPresetHistory, framingPresetHistoryText, framingPresetNameIssue, framingPresetResolveText, framePresetScopeLabel, framePresetSpecFromRenderView, framePresetSpecGroupLabels, framingPresetUpdateText, framingPresetUsage, framingPresetUsageText, loadFramingPresets, mergeRemoteFramingPresets, missingBuiltinFramingPresets, moveFramingPreset, restoreMissingBuiltinFramingPresets, normalizeFramingPreset, persistFramingPresets, renameFramingPreset, resolveFramingPresetForCourse, selectableFramingPresets, setDefaultFramingPreset, sortFramingPresets, stampFramingPresetUpdate } from './data/framingPresets';
import { deleteRemoteFramingPreset, loadRemoteFramingPresets, saveRemoteFramingPreset } from './services/framingPresetsApi';
// 模板写权限（[第二步 US-013] / FR-44 / FR-45）：三层模板「谁的地盘谁写」的判定与文案都在这里，
// 界面「关掉写入入口」与服务层 403 读的是同一份纯函数。
import { FRAMING_PERMISSION_SUMMARY, FRAMING_PRESET_READONLY_NOTE, framingActor, framingPermissionRows, framingPresetWriteIssue, framingPresetWriteOwnerText, framingWriteDeniedMessage } from './data/framingPermissions';
// 审计日志（[第二步 US-013] 第 5 条）：「另存为我的模板」与「保存图片」两个动作留痕
// （操作人 / 学员 id / 时间 / 模板 id）；本机镜像 + 云端 audit_logs（表未建时只落本机镜像）。
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, AUDIT_LOG_EMPTY_TEXT, appendAuditEntry, auditEntryMissingFields, auditEntryText, auditLogStats, auditTraceText, buildAuditEntry, loadAuditLog, mergeAuditLog, persistAuditLog } from './data/auditLog';
import { appendRemoteAuditEntry, loadRemoteAuditLog } from './services/auditLogApi';
// 儿童素材的存储策略（[第二步 US-013] 第 4 条 / FR-46）：上传必须带鉴权、落点不许是服务端本地磁盘。
import { CHILD_MEDIA_UPLOAD_AUTH, MEDIA_STORAGE_CREDENTIAL_NOTE, MEDIA_STORAGE_POLICY_SUMMARY, mediaStoragePolicyRows } from './data/mediaStoragePolicy';
import { CHILD_MEDIA_API_BASE, probeChildMediaSink } from './services/mediaStorage';
// 装裱 spec 与「自然语言 → v2 参数」的大模型入口（US-011c）：提示词要形状建议 + 水印位置建议，
// 输出一律过 normalizeFrameSpecV2 收敛（非法值回落默认、永不抛错），生成失败也只是 ok:false 的信封。
import { DEFAULT_FRAME_SPEC, DATE_FORMATS, DATE_SOURCES, FRAMING_FONT_WHITELIST, SEAL_SHAPES, frameSpecRenderKey, frameSpecRenderView, frameSpecView, generateFrameSpecV2, mergeGeneratedFrameSpec, normalizeFrameSpecV2 } from './services/frameSpec';
import { FRAME_STYLE_COLORS, FRAME_STYLE_DEFAULT_CORNER_RADIUS, FRAME_STYLE_MAT_COLORS, FRAME_STYLE_MIN_VISIBLE_CORNER_RADIUS, FRAME_STYLE_SHAPES, FRAME_STYLE_WIDTHS, applyFrameStyleTweaks, describeFrameStyleSpec, frameStyleTweakCount, frameStyleTweakSummary, normalizeFrameStyleTweaks } from './data/frameStyles';
// 后台装裱参数面板的领域规则（[第二步 US-011a]）：覆盖矩阵（v2 的每个叶子参数 → 控件）、
// 覆盖率判据与「只写一组 + version」的写入口径。零依赖，Node 与浏览器跑同一份。
import { FRAMING_PANEL_GROUPS, FRAMING_PANEL_LIGHTING_DEFAULT, framingPanelCoverage, framingPanelFrameGroup, framingPanelGroupSpec, framingPanelLightingOn, framingPanelMissingFields } from './data/framingPanel';
// 后台装裱预览：占位作品 + **成品图那一支渲染函数**（预览与老师端不可能是两种画法）。
import { FRAME_PREVIEW_ARTWORK_SIZE, FRAME_PREVIEW_LESSON_DATE, renderFramePreview } from './services/framePreview';
import { FRAME_PREVIEW_LONG_EDGE, FRAME_THUMB_CACHE_LIMIT, frameThumbnailKey, renderFrameStyleThumbnail } from './services/frameThumbnails';
// 叠加元素的定位与遮挡规则（US-003a/003b/003c）：九宫格枚举、字体白名单、位置中文名、
// 时间来源与格式、印章形状与「水印遮挡作品主体 15%」的判定全在 overlayLayout.js —— 后台面板只负责渲染控件。
// US-007 的老师端面板还从同一份取变量清单（变量替换的唯一真源）与时间元素的解析函数。
import { CUSTOM_ELEMENT_POSITION, DATE_SOURCE_LABELS, ELEMENT_POSITIONS, OVERLAY_VARIABLES, applyOverlayVariables, formatOverlayDate, overlayPositionLabel, resolveOverlayDateText, resolveElementAnchor } from './services/overlayLayout';
// 水印 · 落款 · 时间面板（US-007）：老师端「本次选用」的一层补丁、课次上下文默认值、
// 九宫格拖动微调的换算与面板选项表全在 data/lessonOverlays.js（规则一处定义，界面只渲染控件）。
import {
  OVERLAY_ELEMENT_SIZE_OPTIONS, OVERLAY_FONT_SIZE_OPTIONS, OVERLAY_OFFSET_RESET, OVERLAY_OFFSET_RANGE_TEXT,
  OVERLAY_OPACITY_OPTIONS, OVERLAY_SECTIONS, OVERLAY_SEAL_SHAPE_OPTIONS, OVERLAY_SIGNATURE_MODE_OPTIONS,
  OVERLAY_TEXT_COLORS, WATERMARK_KINDS, applyOverlayOverrides, buildOverlayOverrides, normalizeOverlayTweaks,
  overlayDefaultSignatureName, overlayDragIsActive, overlayDragOffsets, overlayElementBlockerText,
  overlayElementCanDraw, overlayElementDragDirection, overlayEnabledCount, overlayEnabledSummary, overlayInstanceKey,
  overlayLessonDateValue, overlayOffsetIsZero, overlayOffsetSummary, overlayPercentText, overlayPositionText,
  overlayTweakCount, overlayTweakSummary
} from './data/lessonOverlays';
// 二维码内容由后台配置（US-003c / FR-23）：目标白名单在 data 层，编码器在 services/qrCode.js
// （byte 模式、版本 1–10、纠错等级 L/M/Q/H，能力已在成品图上按「能被识别器读回」验证过）。
import { QR_TARGETS, QR_TARGET_DEFAULT, qrTargetRulesText, qrTargetSummary, resolveQrTargetUrl } from './data/qrTargets';
import { QR_DEFAULT_ECC, QR_MAX_VERSION, qrByteLength, qrVersionFor } from './services/qrCode';
// 保存图片（[第二步 US-008a]）：两档导出（高清 PNG / 微信 JPG）的口径、文件名规则、导出画布计划
// 与「下载还是长按保存」的判据全在 data 层（零依赖，可直接 Node 断言）；渲染与编码在 services 层。
import { ARTWORK_EXPORT_QUALITIES, artworkExportFilename, artworkExportSizeText } from './data/artworkExport';
import { composeArtworkExport, createArtworkExportUrl, downloadArtworkExport, releaseArtworkExportUrl, artworkExportStrategy } from './services/artworkExport';
// 成品图写回课次作品位 + 溯源记录（[第二步 US-008b]）：写回的字段白名单、新鲜度键、失败文案在 data 层
// （零依赖，可 Node 断言）；把成品图画布编成持久副本（data URL）在 services 层；编排在本文件。
import { ARTWORK_WRITE_BACK_IMAGE, applyWriteBackToSlot, artworkWriteBackContextText, artworkWriteBackFailureText, artworkWriteBackIsFresh, artworkWriteBackKey, artworkWriteBackOf, artworkWriteBackProblem, artworkWriteBackProvenanceEntries, artworkWriteBackSummaryText, artworkWriteBackTraceText, artworkWriteBackTraceability, buildArtworkWriteBack, writtenBackImageUrl } from './data/artworkWriteBack';
import { artworkWriteBackImageRulesText, encodeArtworkWriteBackImage } from './services/artworkWriteBack';
// 班级批量应用装裱（[第二步 US-010]）：目标分类（要装 / 已是最新 / 已单独调整）、状态机、
// 进度与失败清单、耗时预算与「覆盖前二次确认」文案全在 data 层（零依赖，可 Node 断言）；
// 「渲染一幅作品 → 档案持久副本」在 services 层（与单幅保存同一条渲染路径）；循环与写回编排在本文件。
import {
  BATCH_FRAMING_QUALITY, batchFramingBudgetText, batchFramingBudgetVerdict, batchFramingConfirmText,
  batchFramingDisplayKeyOf, batchFramingFailureSummaryText, batchFramingFailureText, batchFramingIsRunning, batchFramingPlanText,
  batchFramingProgressText, batchFramingReducer, batchFramingSummaryText, createBatchFramingState,
  makeBatchFramingId, planBatchFraming
} from './data/batchFraming';
import { renderBatchFramedArtwork } from './services/batchFraming';
// 装裱素材（机构 Logo）的上传准入（US-003b / FR-22）：PNG/JPG、≤512×512、≤200KB，
// 规则在 data 层（可 Node 断言），解码与读文件在 services 层。
import { framingAssetRulesText, framingAssetSummary, MAX_FRAMING_ASSET_BYTES } from './data/framingAssets';
import { readFramingAsset, inspectFramingAssetUrl } from './services/framingAssets';
import { REVIEW_MODEL_PARAMS, buildPersonaPrompt, buildReviewPromptBundle, describeReviewError, readableFromRawJson, streamArtworkReview } from './services/llmReview';
// 第三步的归档强校验与失败恢复（[第三步 US-108b] / F-REVIEW-TRACE-07）：五维非空 + 轨迹成功的
// 校验清单、失败态的固定三动作、连续失败读数与「推荐健康状态最好的可用模型」——
// 全部是 data 层纯函数的产物，界面只渲染，不在组件里另写一份判断。
import { REVIEW_FAILURE_KEEP_NOTE, REVIEW_FAILURE_TITLE_FALLBACK, REVIEW_RECOVERY_ACTIONS, evaluateReviewArchiveGate, reviewFailureStreakView, reviewSwitchModelTarget } from './data/reviewRecovery';
// 点评模型选择器（[第三步 US-107a]）：选项行、不可选原因、池路由命中与「老师个人默认」的唯一真源。
// 界面只渲染 `reviewModelResolve()` 的产物（`options` / `poolRow` / `modelId` / `source`），不再自己过滤或排序。
import { REVIEW_MODEL_EMPTY_TEXT, REVIEW_MODEL_POOL_ROUTE_ID, REVIEW_MODEL_RUNNING_NOTE, REVIEW_MODEL_SWITCH_CANCEL_ACTION, REVIEW_MODEL_SWITCH_CONFIRM_ACTION, loadReviewModelDefaults, loadReviewModels, persistReviewModelDefaults, reviewModelDefaultId, reviewModelHealthiest, reviewModelResolve, reviewModelSwitchConfirmText, withReviewModelDefault } from './data/reviewModels';
import { loadRemoteReviewModelDefaults, loadRemoteReviewModels, saveRemoteReviewModelDefault } from './services/reviewModelsApi';
// 作品观察词模板（[第三步 US-109] / F-REVIEW-KW-01）：面板、提示词候选清单与「模型返回值校验」
// 三处读同一份 `keywordTemplateLoadout()` 产物 —— 不要在界面里再按内置词表过滤一遍。
import { PLATFORM_DEFAULT_KEYWORD_TEMPLATES, keywordTemplateLoadout, loadReviewKeywordTemplates, mergeReviewKeywordTemplates, orderTemplateKeywords, persistReviewKeywordTemplates, pickTemplateKeywords, reviewKeywordTemplateMirrorStored } from './data/reviewKeywordTemplates';
import { importRemotePlatformKeywordTemplates, loadRemoteReviewKeywordTemplates } from './services/reviewKeywordTemplatesApi';
// 本次点评详情面板（US-103a 折叠态 / US-103b 六分区与导出）：折叠态那一行摘要、生成中的实时状态、
// 正文进度、六个分区与「复制全部 / 导出 JSON / Markdown」的文本口径都读这一份，
// 界面不自己拼字符串（口径要与验证脚本完全一致）。
import {
  REVIEW_DETAIL_PHASES,
  REVIEW_DETAIL_SURFACES,
  REVIEW_DIMENSION_NAMES,
  reviewContentProgress,
  reviewDetailExportFormat,
  reviewDetailLoaded,
  reviewDetailPayload,
  reviewDetailPhaseLabel,
  reviewDetailReasoningPlaceholder,
  reviewDetailSummary,
  reviewDetailSurfaceAllowed,
  reviewDetailToggleLabel
} from './data/reviewDetailPanel';
// 「复制全部 / 导出」是面板上唯一需要 DOM 能力的动作（Blob、剪贴板、<a download>）。
import { buildReviewDetailExport, copyReviewDetailText, downloadReviewDetailExport } from './services/reviewDetailExport';
// 三个基础展示原语抽到 ui.jsx，3D 画廊页与主文件共用同一份
import { Button, PageHeader, Status } from './ui';
import { hydrateGalleryExhibitions, hydrateGalleryVenues, loadGalleryExhibitions, loadGalleryVenues, persistGalleryExhibitions, persistGalleryVenues } from './data/galleryVenues';
import { loadRemoteGalleryExhibitions, loadRemoteGalleryVenues } from './services/galleryVenuesApi';
// 课次（lesson）是后续四步流程的唯一上下文实体：本地兜底 + 云端 lessons 表为真源。
// 课次日期与课时序号的唯一性校验（US-404）走 data 层的 findLessonConflict，读写走 services/lessonApi。
import { ATTENDANCE_LABELS, ATTENDANCE_STATES, createParticipant, DEFAULT_ORG_ID, DEFAULT_ORG_NAME, findLessonConflict, formatLessonDateDots, loadLessons, mergeLessons, normalizeLessonDate, persistLessons } from './data/lessons';
// 上传素材与学员的绑定（US-406a / US-406b / US-009）：展签只读这份绑定，不做任何顺序取模推断。
// US-406b 起班级反馈的作品走「学员乘上传位」（bindFilesToStudent：在谁的格子里选的就是谁的作品）；
// US-009 起课堂照片也有自己的「学员课堂照片上传位」（0–10 张/人、选填），并支持一张合影分给多人。
import {
  applyDefaultTitles, attendedParticipants, bindFilesToParticipants,
  bindFilesToStudent, bindSharedFiles, detachUploadBinding, participantPhotoGroups,
  participantSlotUsage, participantsMissingUpload, removeUploadEntry, setUploadOwners,
  syncUploadBindings, updateUploadEntry, uploadSlotParticipants, uploadsOfParticipant, withUploadPlaques,
  UPLOAD_SLOTS_PER_STUDENT
} from './data/uploadBinding';
// 上传准入规则与素材隐私（US-408）：格式白名单 / 10MB / 长边 3000px 降采样 /
// 素材只走会话内 object URL。规则是纯函数（可直接 Node 断言），浏览器侧的执行在 mediaIntake。
import { buildSessionMediaDraft, mediaRulesText, screenMediaFiles, validateMediaFile } from './data/mediaValidation';
// 课后反馈草稿（US-409）：只落元数据（课次信息 + 学员选择 + 作品名），
// 图片本体 / object URL / base64 一律不进 localStorage；恢复时安全降级、永不抛错。
import {
  applySavedTitles, buildFeedbackDraft, clearFeedbackDraft, clearSessionMediaSnapshot,
  draftMode, draftSelectedStudent, persistFeedbackDraft, persistSessionMediaSnapshot,
  readFeedbackDraft, readSessionMediaSnapshot, resolveRestoredStep, restoredArtworkTitles
} from './data/feedbackDraft';
// 第一步进入下一步的前置校验（US-410）：必填项清单与「具体原因」文案的唯一真源，
// 界面的校验清单与 go() 的拦截都读同一份结果（零依赖纯函数，可直接 Node 断言）。
import { evaluateIntake } from './data/lessonReadiness';
// 家长授权状态（US-411）：第一步的「未完成查看授权」提示与后续转发前置校验共用的唯一来源。
import { consentSummaryOf, loadConsents } from './data/consent';
// 录入页移动端与性能（US-413）：缩略图长边上限 / 44px 可点区域 / 20 人以上按出席折叠分组 / 录入用时。
// 规则与文案是零依赖纯函数（可直接 Node 断言），浏览器侧的执行在 services/mediaIntake。
import {
  groupSlotRows, intakePaceSummary, shouldGroupSlotRows, thumbnailPendingLabel
} from './data/intakePerformance';
import { createThumbnail, downsampleImageFile, resolveMediaTypes, revokeMediaEntries, revokeMediaUrl, scheduleMediaTask } from './services/mediaIntake';
// 第二步的移动端与性能（US-012）：手机口径与四项预算（合成 800ms/1.5s、编辑底图 2400px/2s、
// 拖动 30fps、内存 300MB）的唯一真源是 data 层（零依赖纯函数，可直接 Node 断言）；
// 浏览器侧的执行（合成计时、编辑底图降采样、rAF 采帧、内存峰值采样）在 services/framingPerformance。
import {
  EDIT_BASE_LOAD_BUDGET_MS, EDIT_BASE_MAX_EDGE, EDIT_DRAG_MIN_FPS, FRAMING_MEMORY_BUDGET_MB, STUDIO_DRAWER_MAX_WIDTH,
  STUDIO_DRAWERS, evaluateEditBase, formatPerfMs, framingComposeBudgetMs, framingDeviceProfile,
  framingPerformanceChecks
} from './data/framingPerformance';
import { createFrameSampler, createMemorySampler, prepareEditBase } from './services/framingPerformance';
import { createLesson, loadRemoteLessons, updateLesson } from './services/lessonApi';
// 课程库（course）是课题的来源：课次上的 courseId 指向一门课程，课题按课时序号从 syllabus 取。
import { findCourseById, loadCourses, persistCourses, resolveCourseId, resolveSyllabusTopic, selectableCourses } from './data/courses';
import { loadRemoteCourses } from './services/courseApi';
import GalleryPage from './gallery/GalleryPage';
import GalleryAdminPage from './gallery/GalleryAdminPage';
// 课程库（US-402b）：管理员维护课程与分课时课题，是老师端选课与课次推荐课题的来源。
import CourseLibraryPage from './admin/CourseLibraryPage';
// Agent 指令与记忆（US-106a）：管理员维护 agent.md 与记忆文件的正文、生效范围与版本历史。
import AgentFilesPage from './admin/AgentFilesPage';
// 作品观察词模板（US-110a）：管理员维护多套模板的属性、分组与词条，是老师端观察词面板与提示词候选的来源。
import KeywordTemplatesPage from './admin/KeywordTemplatesPage';

// 五个维度各自的留空提示语 —— 只说明「这一维该看什么」，不预填任何成句的点评。
const REVIEW_DIMENSION_HINTS = {
  美术能力: '等待大模型读取作品后生成：画面里能指认的色彩、构图、造型或材料使用。',
  上课状态: '等待大模型依据课堂素材生成：投入、停顿后是否回到画面、是否主动补充细节。',
  行为能力: '等待大模型依据课堂素材生成：任务理解、表达、协作或整理等可观察行为。',
  内在状态: '等待大模型生成：本次课堂中可观察到的表达与变化，不作心理诊断。',
  家长建议: '等待大模型生成：1—3 条与本次观察有关、家长今晚就能尝试的具体行动。'
};

// 画心（cleanUrl）可以由两条路径产出：系统识别纸边自动裁剪，或老师手动裁剪（US-004b）。
// 两条路径共用同一条下游流水线（装裱 / 点评 / 展陈），所以「画心可用」的判据要一起认这两个算法标识。
const ARTWORK_CLEAN_ALGORITHMS = [ARTWORK_CLEAN_ALGORITHM, ARTWORK_MANUAL_CROP_ALGORITHM];
const isCleanArtworkReady = (artwork) => Boolean(artwork?.cleanUrl) && ARTWORK_CLEAN_ALGORITHMS.includes(artwork?.cleanAlgorithm);

const PRD = {
  auth: 'PRD-7.1 / F-ID-01', dashboard: 'PRD-5 / F-PORTAL-01', lessons: 'PRD-7 / F-FEEDBACK-01',
  create: 'PRD-7 / F-FEEDBACK-02', ai: 'PRD-4 / F-AI-01', tasks: 'PRD-10 / F-AI-02',
  classes: 'PRD-2 / F-ORG-01', archives: 'PRD-12 / F-ARCHIVE-01', parent: 'PRD-5 / F-PARENT-01',
  apps: 'PRD-11 / F-APP-01', providers: 'PRD-9 / F-MODEL-01', users: 'PRD-2 / F-RBAC-01',
  logs: 'PRD-6 / F-LOG-01', archiveAdmin: 'PRD-14 / F-ARCHIVE-ADM-01', permissions: 'PRD-2.1 / F-RBAC-02',
  guide: 'PRD-4~17 / PROTOTYPE-MAP'
};
const roleMeta = {
  teacher: { label: '老师', name: '林晓老师', campus: '星河校区' },
  parent: { label: '家长', name: '陈一诺妈妈', campus: '家长端' },
  admin: { label: '管理员', name: '平台管理员', campus: '平台总部' }
};

// 缩略图还没生成好时列表里的占位（US-413）：一个 8x8 的透明 SVG，只有几十字节。
// **不能**用原图当占位 —— 22 位学员的 3000px 原图一起进列表，解码内存与滚动帧率都会塌。
const INTAKE_THUMB_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3C/svg%3E";

const navByRole = {
  // 老师人设与技能库是机构级基础数据，只有管理员能维护；
  // 老师只能在「课后反馈」里只读选用人设来生成点评，看不到这两个维护入口。
  teacher: [
    ['dashboard','课后反馈工作台',LayoutDashboard], ['teacherFlow','课后反馈',WandSparkles], ['ai','AI助手',WandSparkles],
    ['classes','学员管理',Users], ['growthCenter','个人成长中心',BookOpen], ['progress','进度看板',Clock3],
    ['gallery','3D 画廊',Landmark]
  ],
  parent: [['parent','首页',LayoutDashboard],['parentInsight','作品观察',Sparkles],['parentArchive','成长档案',Archive],['gallery','3D 画廊',Landmark],['growthCenter','个人成长中心',BookOpen],['authorization','授权管理',ShieldCheck],['profile','个人中心',UserRound]],
  admin: [['adminDash','运营总览',LayoutDashboard],['apps','应用中心',Boxes],['providers','模型供应商',Zap],['teacherPersona','老师人设',GraduationCap],['skillLibrary','技能库',Boxes],['courseLibrary','课程库',BookOpen],['keywordTemplates','观察词模板',ListChecks],['agentFiles','指令与记忆',FileText],['framingSettings','装裱设置',Frame],['galleryAdmin','3D 画廊',Landmark],['users','用户管理',Users],['logs','生成日志',FileText],['archiveAdmin','档案管理',Archive],['permissions','权限设置',ShieldCheck],['settings','系统配置',Settings]]
};

const aiAppsSeed = [
  {id:'frame',name:'作品智能装裱',desc:'自动校正、去背景并匹配画框场景',icon:Frame,color:'blue',status:'enabled',version:'2.4.1'},
  {id:'photo',name:'照片美化',desc:'自然优化课堂人像、光线与构图',icon:Image,color:'coral',status:'enabled',version:'1.8.0'},
  {id:'review',name:'AI 智能点评',desc:'生成个人与班级长短版点评',icon:MessageSquareText,color:'green',status:'enabled',version:'3.1.2'},
  {id:'video',name:'AI 生视频',desc:'课堂剪辑、字幕、配乐与图生视频',icon:Film,color:'yellow',status:'enabled',version:'1.5.0'}
];

const taskSeed = [
  {id:'T-0824',title:'向日葵主题课 · 作品装裱',student:'陈一诺等 18 人',app:'作品智能装裱',model:'VisionArt Pro',status:'成功',time:'3 分 24 秒'},
  {id:'T-0823',title:'色彩启蒙班 · 个人点评',student:'林小满等 12 人',app:'AI 智能点评',model:'Qwen Text Max',status:'成功',time:'48 秒'},
  {id:'T-0822',title:'水彩风景课 · 课堂视频',student:'周六 2 班',app:'AI 生视频',model:'Seedance 2',status:'生成中',time:'68%'},
  {id:'T-0821',title:'创意线描 · 照片美化',student:'小艺术家班',app:'照片美化',model:'VisionArt Edit',status:'部分成功',time:'29/30'}
];

const mergeFeedbackRecords = (localRecords, remoteRecords) => {
  const byId = new Map(remoteRecords.map(record => [record.id, record]));
  localRecords.forEach(record => {
    const remote = byId.get(record.id);
    byId.set(record.id, remote ? { ...remote, ...record, reviews: { ...remote.reviews, ...record.reviews } } : record);
  });
  return [...byId.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
};

function App(){
  const [auth,setAuth]=useState(false), [authMode,setAuthMode]=useState('login'), [role,setRole]=useState('teacher');
  const [parentStudent,setParentStudent]=useState(''),[parentStudents,setParentStudents]=useState([]),[parentPhone,setParentPhone]=useState(''),[parentSession,setParentSession]=useState('');
  const [page,setPage]=useState('dashboard'), [mobileNav,setMobileNav]=useState(false), [toast,setToast]=useState('');
  const [modal,setModal]=useState(null), [apps,setApps]=useState(aiAppsSeed), [tasks,setTasks]=useState(taskSeed), [records,setRecords]=useState(loadFeedbackRecords);
  const [recordsRemoteReady,setRecordsRemoteReady]=useState(false);
  // 老师人设（含技能库与大模型记忆）和装裱预设都以云端表为准，本地只做兜底。
  const [teacherProfiles,setTeacherProfiles]=useState(loadTeacherProfiles);
  const [framingPresets,setFramingPresets]=useState(loadFramingPresets);
  // 技能库是与人设分开维护的基础数据，人设只持有被勾选的 id。
  const [skillLibrary,setSkillLibrary]=useState(loadSkillLibrary);
  // agent.md 与记忆文件库（US-105/US-106a）：管理端维护、老师端生成时加载；
  // 云端 agent_files 表为真源，本机镜像兜底（合并方向本机优先，见 mergeAgentFiles）。
  const [agentFiles,setAgentFiles]=useState(loadAgentFiles);
  // 3D 画廊：展厅地点（实景图 + 重建参数）与画展（作品清单），同样以云端表为准。
  const [galleryVenues,setGalleryVenues]=useState(loadGalleryVenues);
  const [galleryExhibitions,setGalleryExhibitions]=useState(loadGalleryExhibitions);
  // 课次列表：云端 lessons 表为真源，本地只做兜底；下游四步流程都从这里取上下文。
  const [lessons,setLessons]=useState(loadLessons);
  // 课程库：云端 courses 表为真源，本地只做兜底；课次课题与班级选课都从这里取。
  const [courses,setCourses]=useState(loadCourses);
  // 审计日志（[第二步 US-013] 第 5 条）：本机镜像先渲染，云端 audit_logs 表回来就并进去
  // （表还没建 → 写入被拒，日志只在本机镜像里，与装裱模板同一套兜底口径）。
  const [auditLog,setAuditLog]=useState(loadAuditLog);
  // 点评模型目录（[第三步 US-107a]）：云端 provider_models 表为真源、本机镜像兜底；
  // 表还没建出来时（现状）只落本机镜像 —— 与审计日志 / 评测轨迹同一套兜底口径。
  const [reviewModels,setReviewModels]=useState(loadReviewModels);
  // 老师的个人默认点评模型（老师键 → 模型 id；'' = 由模型池自动路由）：
  // 「下次进入默认选中」就是靠它，写本机镜像 + 推云端（云端不通只影响跨设备可见）。
  const [reviewModelDefaults,setReviewModelDefaults]=useState(loadReviewModelDefaults);
  // 作品观察词模板（[第三步 US-109]）：本机镜像先渲染（首次上线是平台默认模板 v1），
  // 云端 review_keyword_templates 表回来就补进来（合并方向本机优先，见 mergeReviewKeywordTemplates）。
  const [keywordTemplates,setKeywordTemplates]=useState(loadReviewKeywordTemplates);
  // 云端模板的读取状态：`failed` 是老师端那条「当前用本机模板镜像」明示的唯一依据
  // （FR-142：读取失败必须明示，不得静默降级）。
  const [keywordTemplateRemote,setKeywordTemplateRemote]=useState({failed:false,loaded:false});
  // 「首次上线」（本机镜像里从来没存过模板）要在第一次渲染就算出来：落盘 effect 一跑镜像就非空了。
  const keywordTemplateSeedRef=useRef(undefined);
  if(keywordTemplateSeedRef.current===undefined) keywordTemplateSeedRef.current=!reviewKeywordTemplateMirrorStored();
  // 点评轨迹的留存与披露策略（[第三步 US-112]）：系统配置里可改，缺省「保留 90 天 + 允许老师看提示词正文」。
  const [tracePolicy,setTracePolicy]=useState(loadReviewTracePolicy);
  // 管理端「生成日志 → 点评轨迹」读的轨迹账：本机镜像先渲染，云端表 / 开发适配器回来后并进去
  // （合并方向：`mergeReviewTraces` 按 traceId 去重、时间倒序）。清理（到期）也写回这一份。
  const [traceLog,setTraceLog]=useState(loadReviewTraces);
  const [traceSource,setTraceSource]=useState({note:'本机镜像',loading:false,at:''});
  const [demoState,setDemoState]=useState('normal');
  useEffect(()=>{ if(toast){const t=setTimeout(()=>setToast(''),2600); return()=>clearTimeout(t)}},[toast]);
  useEffect(()=>{let active=true;loadRemoteFeedbackRecords().then(remote=>{if(!active)return;setRecords(current=>mergeFeedbackRecords(current,remote));setRecordsRemoteReady(true);}).catch(()=>{});return()=>{active=false}},[]);
  useEffect(()=>{persistFeedbackRecords(records);if(recordsRemoteReady)void saveRemoteFeedbackRecords(records).catch(()=>{});},[records,recordsRemoteReady]);
  useEffect(()=>{persistTeacherProfiles(teacherProfiles)},[teacherProfiles]);
  useEffect(()=>{persistFramingPresets(framingPresets)},[framingPresets]);
  useEffect(()=>{persistSkillLibrary(skillLibrary)},[skillLibrary]);
  // 老师的个人默认模型只在本机镜像里落盘（云端 review_model_preferences 表还没建，
  // 写入会被拒）；模型目录同理 —— 本故事对目录只读，不写、不把它清回种子。
  useEffect(()=>{persistReviewModelDefaults(reviewModelDefaults)},[reviewModelDefaults]);
  useEffect(()=>{persistReviewKeywordTemplates(keywordTemplates)},[keywordTemplates]);
  useEffect(()=>{persistAgentFiles(agentFiles)},[agentFiles]);
  useEffect(()=>{persistGalleryVenues(galleryVenues)},[galleryVenues]);
  useEffect(()=>{persistGalleryExhibitions(galleryExhibitions)},[galleryExhibitions]);
  useEffect(()=>{persistLessons(lessons)},[lessons]);
  useEffect(()=>{persistCourses(courses)},[courses]);
  useEffect(()=>{persistAuditLog(auditLog)},[auditLog]);
  // 策略落盘（保留期 + 披露开关）：本机镜像是唯一真源（云端没有这张配置表的口径）。
  useEffect(()=>{persistReviewTracePolicy(tracePolicy)},[tracePolicy]);
  useEffect(()=>{let active=true;loadRemoteAuditLog().then(remote=>{if(active&&remote.length)setAuditLog(current=>mergeAuditLog(remote,current))}).catch(()=>{});return()=>{active=false}},[]);
  useEffect(()=>{let active=true;
    loadRemoteTeacherProfiles().then(remote=>{if(active&&remote.length)setTeacherProfiles(remote)}).catch(()=>{});
    loadRemoteSkillLibrary().then(remote=>{if(active&&remote.length)setSkillLibrary(remote)}).catch(()=>{});
    // agent.md 与记忆文件：合并方向是**本机镜像优先**（agent_files 表缺 versions / history / updated_by 列时
    // 带新列的写入会被整条拒掉，改动只在本机落地；让云端顶掉本机会把刚存的版本历史弄丢）。云端只补本机没有的 id。
    loadRemoteAgentFiles().then(remote=>{if(active&&remote.length)setAgentFiles(current=>mergeAgentFiles(remote,current))}).catch(()=>{});
    // 画廊这两个必须过 hydrate：内置展厅的实景图不进库，云端那条回来是没图的，
    // 直接 setState 顶掉会让内置展厅变成"没有实景图"。
    loadRemoteGalleryVenues().then(remote=>{if(active&&remote.length)setGalleryVenues(hydrateGalleryVenues(remote))}).catch(()=>{});
    loadRemoteGalleryExhibitions().then(remote=>{if(active&&remote.length)setGalleryExhibitions(hydrateGalleryExhibitions(remote))}).catch(()=>{});
    // 点评模型目录与个人默认（US-107a）：云端表还没建 → 这两条会抛错并被吞掉，本机镜像照常可用。
    // 个人默认的合并方向是**本机镜像优先**（写入只在本机落地，让云端顶掉会把刚选的模型弄丢）。
    loadRemoteReviewModels().then(remote=>{if(active&&remote.length)setReviewModels(remote)}).catch(()=>{});
    loadRemoteReviewModelDefaults().then(remote=>{if(active&&Object.keys(remote).length)setReviewModelDefaults(current=>({...remote,...current}))}).catch(()=>{});
    // 课次：云端不可用时保留本地兜底数据，不把列表清空。
    loadRemoteLessons().then(remote=>{if(active&&remote.length)setLessons(remote)}).catch(()=>{});
    // 课程库：同上；云端返回全部课程（含停用），可选性由 selectableCourses 判断。
    loadRemoteCourses().then(remote=>{if(active&&remote.length)setCourses(remote)}).catch(()=>{});
    // 观察词模板（US-109）：云端 review_keyword_templates 表还没建 → 读取会抛错，
    // 本机镜像（首次上线导入了平台默认模板 v1）照常可用；读取失败会落在 `keywordTemplateRemote.failed`，
    // 老师端据此明示「当前用本机模板镜像」（FR-142，不得静默降级）。
    // 合并方向是**本机镜像优先**：云端只补本机没有的 templateKey。
    loadRemoteReviewKeywordTemplates({orgId:DEFAULT_ORG_ID})
      .then(remote=>{if(!active)return;if(remote.length)setKeywordTemplates(current=>mergeReviewKeywordTemplates(remote,current));setKeywordTemplateRemote({failed:false,loaded:true})})
      .catch(()=>{if(active)setKeywordTemplateRemote({failed:true,loaded:false})});
    // 首次上线（本机镜像里还没有任何模板）：把平台默认模板 v1 幂等导入云端一次；
    // 表不存在时这一步抛错并被吞掉 —— 只影响跨设备可见，老师端一个字都不用等它。
    if(keywordTemplateSeedRef.current) void importRemotePlatformKeywordTemplates(PLATFORM_DEFAULT_KEYWORD_TEMPLATES).catch(()=>{});
    return()=>{active=false};
  },[]);
  // 装裱模板单独一条 effect（US-001b）：模板分三层，读取要按 scope + owner_key 过滤，
  // 而过滤依赖登录后的角色（管理端读全量、老师端只读自己可见的），
  // 所以不能并进上面那组「登录前就跑、只跑一次」的 effect。
  useEffect(()=>{let active=true;
    const viewer=role==='admin'?null:{role:'teacher',teacherName:roleMeta.teacher.name,orgId:DEFAULT_ORG_ID};
    // 合并方向见 `mergeRemoteFramingPresets` 的注释（US-011b 起**本机镜像优先**）：
    // 云端 framing_presets 表还缺 scope / owner_key / is_default / bound_course_types 这些列，
    // 带新列的写入会被整条拒掉，所以模板的改动目前只在本机镜像里真正落地；
    // 云端仍负责补进「本机没有的 id」（多设备 / 后台直接写库）。
    loadRemoteFramingPresets(viewer).then(remote=>{if(active&&remote.length)setFramingPresets(current=>mergeRemoteFramingPresets(remote,current.length?current:loadFramingPresets()))}).catch(()=>{});
    return()=>{active=false};
  },[auth,role]);
  const navigate=(p)=>{setPage(p);setMobileNav(false);window.scrollTo(0,0)};
  /**
   * 记一条审计日志（[US-013] 第 5 条）：先落本机镜像（立刻能在管理端读到），再推云端
   * （`audit_logs` 表还没建时会被拒 —— 只影响「跨设备可见」，本机这条照样成立）。
   * 返回值就是这条日志（调用方拿它渲染「已写入审计日志」的回执）。
   */
  const recordAudit=(input)=>{
    const entry=buildAuditEntry(input);
    setAuditLog(current=>appendAuditEntry(current,entry));
    void appendRemoteAuditEntry(entry).catch(()=>{});
    return entry;
  };
  // ---- 点评轨迹：身份、查询、清理（[第三步 US-112]）----------------------------------
  // 可见性判据的入参（`reviewTraceViewer`）：老师端「老师只看自己经手的、跨机构不可见」，
  // 管理端是平台审计（全部机构）。界面筛选与断言读同一份口径。
  const adminTraceViewer=reviewTraceViewer({role:'admin',adminTier:'platform',orgId:DEFAULT_ORG_ID,actorId:'platform-admin',actorName:roleMeta.admin.name});
  const teacherTraceViewer=reviewTraceViewer({role:'teacher',actorId:roleMeta.teacher.name,teacherName:roleMeta.teacher.name,orgId:DEFAULT_ORG_ID});
  // 轨迹操作（复制 / 导出）的审计操作人四件套：按当前身份补，界面只管传「哪一条轨迹、什么范围」。
  const traceAuditActor=role==='admin'
    ?{actorId:'platform-admin',actorName:roleMeta.admin.name,actorRole:'platform-admin',actorRoleLabel:'平台超级管理员'}
    :{actorId:roleMeta.teacher.name,actorName:roleMeta.teacher.name,actorRole:'teacher',actorRoleLabel:'老师'};
  const auditTraceEntry=(input)=>recordAudit({...input,...traceAuditActor,orgId:DEFAULT_ORG_ID});
  /**
   * 刷新轨迹账：本机镜像（归档时写入）**先渲染**，云端 `review_traces` 表与开发适配器回来后并进去。
   * 开发适配器那条通道带身份（`X-Actor-Role`）：家长身份会被**服务端直接拒绝**，
   * 被拒时如实写进来源读数（不静默换一条通道，也不冒领数据）。
   */
  const refreshReviewTraces=async()=>{
    setTraceSource(current=>({...current,loading:true}));
    const notes=['本机镜像'];
    let merged=loadReviewTraces();
    try{
      const cloudTraces=await loadRemoteReviewTraces();
      if(cloudTraces.length){merged=mergeReviewTraces(cloudTraces,merged);notes.push(`云端 review_traces（${cloudTraces.length} 条）`);}
    }catch{/* 云表还没建立：本机镜像照常（与审计日志同一套兜底口径） */}
    // 查询身份按当前会话走：家长身份会被服务端直接拒绝（界面照实写进来源读数）；
    // 老师只拿到自己经手的（身份串随查询带上），管理员看全部。
    const adapterRole=role==='parent'?'parent':(role==='admin'?'admin':'teacher');
    const adapterActor=role==='admin'?'platform-admin':(role==='teacher'?roleMeta.teacher.name:'');
    const adapter=await queryRemoteReviewTraces({},{role:adapterRole,parentToken:parentSession||'',actorId:adapterActor});
    if(adapter.ok){merged=mergeReviewTraces(adapter.traces,merged);notes.push(`开发适配器（${adapter.traces.length} 条）`);}
    else if(adapter.denied)notes.push(`服务端拒绝：${adapter.message}`);
    else if(adapter.status===0)notes.push('开发适配器未连接');
    setTraceLog(merged);
    setTraceSource({note:notes.join(' · '),loading:false,at:new Date().toISOString()});
    return merged;
  };
  /** 到期清理（PRD：先预览影响范围，再执行）：判据与预览都读 data 层的纯函数。 */
  const cleanupReviewTraces=()=>{
    const {kept,removed,preview}=applyReviewTraceCleanup(traceLog,tracePolicy);
    setTraceLog(persistReviewTraces(kept));
    setToast(removed.length?`已按「${reviewTraceRetentionText(tracePolicy.retentionDays)}」清理 ${removed.length} 条到期轨迹`:'没有到期轨迹需要清理');
    return {removed:removed.length,preview};
  };
  const login=async(nextRole, phone='', code='')=>{
    if(nextRole==='parent'&&phone!=='demo'){
      try{const session=await createParentSession(phone,code);setParentStudents(session.studentNames);setParentStudent(session.studentNames[0]);setParentPhone(phone);setParentSession(session.token);}catch(error){setToast(error.message||'家长登录失败，请稍后重试。');return false;}
    }
    if(nextRole==='parent'&&phone==='demo'){const demoStudents=loadStudentManagement().students.filter(item=>item.guardianName);setParentStudents(demoStudents.map(item=>item.name));setParentStudent(demoStudents[0]?.name||'');setParentPhone('');setParentSession('');}
    setRole(nextRole);setAuth(true);setPage(nextRole==='teacher'?'dashboard':nextRole==='parent'?'parent':'adminDash');setToast(`已进入${roleMeta[nextRole].label}体验`);return true;
  };
  if(!auth) return <AuthScreen mode={authMode} setMode={setAuthMode} onLogin={login}/>;
  return <div className="app">
    <Sidebar role={role} page={page} nav={navByRole[role]} onNav={navigate} open={mobileNav} close={()=>setMobileNav(false)}/>
    <main className="main">
      <Topbar role={role} onMenu={()=>setMobileNav(true)} onSwitch={(r)=>login(r,'demo')} onGuide={()=>navigate('guide')} onLogout={()=>setAuth(false)}/>
      <div className="content">
        <PageRouter {...{page,role,navigate,setToast,setModal,apps,setApps,tasks,setTasks,demoState,setDemoState,records,setRecords,parentStudent,parentStudents,parentPhone,parentSession,setParentStudent,teacherProfiles,setTeacherProfiles,framingPresets,setFramingPresets,skillLibrary,setSkillLibrary,agentFiles,setAgentFiles,adminName:roleMeta.admin.name,galleryVenues,setGalleryVenues,galleryExhibitions,setGalleryExhibitions,lessons,setLessons,courses,setCourses,auditLog,recordAudit,reviewModels,reviewModelDefaults,setReviewModelDefaults,keywordTemplates,setKeywordTemplates,keywordTemplateRemote,traceLog,setTraceLog,tracePolicy,setTracePolicy,traceSource,refreshReviewTraces,cleanupReviewTraces,auditTraceEntry,adminTraceViewer,teacherTraceViewer}}/>
      </div>
    </main>
    {toast?<div className="toast panda-toast"><img src={pandaWave} alt="熊猫鼓励"/><span><CircleCheck size={18}/>{toast}</span></div>:null}
    {modal?<Modal type={modal} close={()=>setModal(null)} {...{setToast,apps,setApps}}/>:null}
  </div>
}

function AuthScreen({mode,setMode,onLogin}){
  const [mobile,setMobile]=useState(''),[code,setCode]=useState(''),[agree,setAgree]=useState(false),[err,setErr]=useState(''),[loginRole,setLoginRole]=useState('teacher');
  const submit=async(e)=>{e.preventDefault();if(!/^1\d{10}$/.test(mobile))return setErr('请输入正确的 11 位手机号');if(code.length<4)return setErr('请输入验证码');if(!agree)return setErr('请先同意服务协议与隐私政策');setErr('');const accepted=await onLogin(mode==='register'?'teacher':loginRole,mobile,code);if(!accepted)setErr('该手机号尚未绑定孩子档案，请联系老师完成家长端绑定。');};
  return <div className="auth-shell">
    <section className="auth-story">
      <div className="brand brand-light"><span className="brand-mark"><Sparkles/></span><b>昕乐绘</b></div>
      <div className="auth-art">
        <div className="paper paper-a"><span>今天的作品</span><div className="sunflower">✦</div></div>
        <div className="paper paper-b"><span>成长，从每一次表达开始</span><div className="scribble">◌ ◒ ◍</div></div>
        <img className="auth-panda" src={pandaMascot} alt="昕乐绘熊猫艺术导师"/>
      </div>
      <div><h1>让每一份童画<br/>都有专业的回应</h1><p>作品装裱、照片美化、视频剪辑、智能点评和成长档案，在一个工作流里完成。</p></div>
    </section>
    <section className="auth-panel">
      <div className="auth-card">
        <div className="mobile-brand"><span className="brand-mark"><Sparkles/></span><b>昕乐绘</b></div>
        <h2>{mode==='login'?'欢迎回来':'创建老师账号'}</h2><p className="muted">{mode==='login'?(loginRole==='teacher'?'登录后继续完成今天的课后反馈':'登录后查看孩子专属的成长档案'):'首版通过管理员邀请加入机构'}</p>
        {mode==='login'?<div className="auth-role-choice" aria-label="选择登录身份"><button type="button" className={loginRole==='teacher'?'active':''} onClick={()=>setLoginRole('teacher')}>我是老师</button><button type="button" className={loginRole==='parent'?'active':''} onClick={()=>setLoginRole('parent')}>我是家长</button></div>:null}
        <form onSubmit={submit}>
          <label>手机号<input value={mobile} onChange={e=>setMobile(e.target.value)} placeholder="请输入手机号" maxLength={11}/></label>
          <label>验证码<div className="inline-input"><input value={code} onChange={e=>setCode(e.target.value)} placeholder="请输入验证码"/><button type="button" className="text-btn" onClick={()=>setErr('验证码已发送（原型模拟）')}>获取验证码</button></div></label>
          {mode==='register'?<label>机构邀请码<input placeholder="例如：XLH-2026"/></label>:null}
          <label className="check"><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)}/><span>我已阅读并同意《服务协议》《隐私政策》及未成年人信息处理说明</span></label>
          {err?<div className="form-error"><CircleAlert size={16}/>{err}</div>:null}
          <button className="primary wide" type="submit">{mode==='login'?'登录':'注册并加入机构'}<ArrowRight size={18}/></button>
        </form>
        <button className="auth-toggle" onClick={()=>{setMode(mode==='login'?'register':'login');setErr('')}}>{mode==='login'?'没有账号？申请注册':'已有账号？返回登录'}</button>
        <div className="demo-logins"><span>快速体验</span><div><button onClick={()=>onLogin('teacher','demo')}>老师</button><button onClick={()=>onLogin('parent','demo')}>家长</button><button onClick={()=>onLogin('admin','demo')}>管理员</button></div></div>
        <small className="prd-tag">{PRD.auth}</small>
      </div>
    </section>
  </div>
}

function Sidebar({role,page,nav,onNav,open,close}){
 return <><aside className={`sidebar ${open?'open':''}`}>
  <div className="brand"><span className="brand-mark"><Sparkles/></span><b>昕乐绘</b><button className="sidebar-close" onClick={close}><X/></button></div>
  <div className="workspace"><span>{roleMeta[role].campus}</span><ChevronDown size={15}/></div>
  <nav>{nav.map(([id,label,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>onNav(id)}><Icon size={19}/><span>{label}</span></button>)}</nav>
  <div className="sidebar-foot"><div className="quota"><div><span>本月 AI 用量</span><b>68%</b></div><div className="progress"><i style={{width:'68%'}}/></div><small>6,820 / 10,000 点</small></div><button onClick={()=>onNav('guide')}><BookOpen size={18}/>原型导览</button></div>
 </aside>{open?<div className="scrim" onClick={close}/>:null}</>
}

function Topbar({role,onMenu,onSwitch,onGuide,onLogout}){
 const [open,setOpen]=useState(false);
 return <header className="topbar"><button className="mobile-menu" onClick={onMenu}><Menu/></button><div className="top-search"><Search size={17}/><input placeholder="搜索班级、学员、任务或档案"/></div><div className="top-actions"><button className="icon-btn" title="通知"><Bell size={19}/><i/></button><div className="role-switch"><button onClick={()=>setOpen(!open)}><span className="avatar">{roleMeta[role].name[0]}</span><span><b>{roleMeta[role].name}</b><small>{roleMeta[role].label}</small></span><ChevronDown size={15}/></button>{open?<div className="role-menu"><span>切换体验身份</span>{Object.entries(roleMeta).map(([k,v])=><button key={k} onClick={()=>{onSwitch(k);setOpen(false)}} className={k===role?'selected':''}>{v.label}<small>{v.name}</small></button>)}<hr/><button onClick={onGuide}>查看页面导览</button><button onClick={onLogout}><LogOut size={15}/>退出登录</button></div>:null}</div></div></header>
}

function Stat({label,value,delta,icon:Icon,tone='blue'}){return <div className="stat"><span className={`stat-icon ${tone}`}><Icon size={20}/></span><div><span>{label}</span><b>{value}</b><small>{delta}</small></div></div>}

function ArchiveStudio({setToast}){const [kind,setKind]=useState('个人');const [view,setView]=useState('阶段报告');return <><PageHeader title="成长档案" desc="选择一位孩子或一个班级，生成可回看的成长成果。" prd={PRD.archives}/><section className="archive-studio"><div className="archive-filter"><div className="mode-switch"><button className={kind==='个人'?'active':''} onClick={()=>setKind('个人')}>个人档案</button><button className={kind==='班级'?'active':''} onClick={()=>setKind('班级')}>班级档案</button></div><select><option>{kind==='个人'?'陈一诺 · 7岁':'周六创意绘画 2 班'}</option><option>{kind==='个人'?'林小满 · 8岁':'素描基础班'}</option></select><small>{kind==='个人'?'已记录 18 次课程 · 42 幅作品':'AI 将从前、中、后三个阶段精选作品，并生成班级与个人总结'}</small></div><div className="archive-types">{[['阶段报告',FileText,'作品、照片、点评与阶段总结'],['视频集锦',Film,'一个学期的温馨视频记录'],['作品展览',Frame,'AI 美术馆展厅效果']].map(([name,Icon,desc])=><button key={name} className={view===name?'active':''} onClick={()=>setView(name)}><Icon/><b>{name}</b><small>{desc}</small></button>)}</div>{view==='阶段报告'?<div className="report-view"><div className="report-cover"><div className="report-art">✺</div><b>{kind==='个人'?'陈一诺':'周六创意绘画 2 班'} · 阶段成长报告</b></div><div className="report-copy"><h2>把一次次表达，连成清晰的成长。</h2><div className="report-grid">{[['美术能力','能稳定使用冷暖对比，画面层次更丰富。'],['行为表现','主动表达想法，也更能倾听和协作。'],['本学期进步点','从“完成作品”走向“讲述自己的作品”。'],['下学期学习规划','继续色彩训练，增加构图与观察练习。'],['老师寄语','愿你一直保留这份敢于表达、愿意探索的光。']].map(([a,b])=><article key={a}><b>{a}</b><p>{b}</p></article>)}</div><Button icon={FileText} onClick={()=>setToast('阶段报告已生成')}>生成阶段报告</Button></div></div>:view==='视频集锦'?<div className="video-album"><div className="semester-video"><Film/><span>2026 春季 · 成长影像</span><i>00:58</i></div><div><h2>一学期的认真，值得被温柔回看。</h2><p>AI 从课堂视频中选取专注创作、分享表达、与同伴互动的片段，串联为一支温馨视频，结尾附上老师寄语。</p><blockquote>“愿你在每一次落笔里，都更靠近真实的自己。”</blockquote><Button icon={Film} onClick={()=>setToast('视频集锦开始生成')}>生成视频集锦</Button></div></div>:<div className="museum-exhibit"><div className="museum-wall"><div className="exhibit-frame">✺</div><div className="exhibit-frame small">✹</div><div className="exhibit-frame small">●</div></div><div><h2>走进属于孩子的美术馆。</h2><p>{kind==='个人'?'AI 将孩子的作品转为个人线上展览。':'精选班级前、中、后三个阶段作品，生成一场班级艺术展，并附每位孩子的成长总结。'}</p><Button icon={Frame} onClick={()=>setToast('美术馆展览开始生成')}>生成美术馆展览</Button></div></div>}</section></>}
function ProgressBoard({tasks}){return <><PageHeader title="进度看板" desc="上方查阅个人与班级课后反馈；下方追踪所有 AI 生成任务。" prd={PRD.tasks}/><section className="progress-summary"><div><span>课后反馈</span><h2>今天已完成 6 份</h2><p>个人反馈 4 份 · 班级反馈 2 份</p><button>查看反馈记录 <ArrowRight size={14}/></button></div><div className="today-inline"><b>今日待办</b><span>3 项</span><p>14:30 周六创意绘画 2 班 · 待完成班级反馈</p><button>展开待办</button></div></section><TaskTable tasks={tasks} title="生成任务进度" onView={()=>{}}/></>}
function TeacherWelcome({navigate}){return <section className="teacher-welcome"><div className="welcome-copy"><span>今天，孩子们因为你拥有了一段表达自己的时光。</span><h1>你认真守护的每一次创作，<br/>都在悄悄成为孩子的底气。</h1><p>我们知道，一堂好课的背后，是你观察到的细节、给出的耐心和不轻易放过的每一点闪光。现在，让这些温柔的看见继续陪孩子向前生长。</p><div className="welcome-notes"><article><b>回看今天</b><small>整理课堂里值得被记住的瞬间</small></article><article><b>看见孩子</b><small>把作品、表达与进步好好留下来</small></article></div><Button icon={ArrowRight} onClick={()=>navigate('teacherFlow')}>开始今天的课后反馈</Button></div><div className="welcome-art"><div className="welcome-card card-back">今日的光</div><div className="welcome-card card-front"><img src={pandaWave} alt="熊猫艺术导师"/><b>辛苦了，林晓老师</b><small>让每一次用心，都有温暖的回响</small></div></div></section>}
/**
 * 班级名单 → 本次课次的参与学员（US-405）。
 * 默认全部出席；已经在名单里标记过的学员保留原出席状态，避免「全选 / 反选 / 换班回来」时
 * 把老师刚标记的缺课又抹成出席。**只产出内存里的 participants，不回写班级名单。**
 */
function rosterParticipants(students,previous=[]){
  return (students||[]).map(item=>{
    const existed=(previous||[]).find(entry=>entry.name===item.name);
    return createParticipant({name:item.name,attendance:existed?.attendance||'present'});
  });
}

/**
 * 参与学员的稳定指纹（US-409）：草稿要不要落盘的判据之一 ——
 * 与班级初始名单完全一致时说明老师还没动过学员选择，这份草稿没有恢复价值。
 */
function participantSignature(list){
  return (list||[]).map(item=>`${item?.name||''}:${item?.attendance||''}:${item?.temporary?'1':'0'}`).join('|');
}

/**
 * 学员在「照片分配」界面里的稳定 key：优先 studentId，临时学员（没有 id）退回姓名。
 * 不能用行号 —— 勾选过程中名单顺序一变（切班/标缺课）就会选错人。
 */
function participantKey(item){
  const id=String(item?.studentId||'').trim();
  return id||`name:${String(item?.name||'').trim()}`;
}

/**
 * 学员乘上传位列表的渲染容器（US-413）。
 *
 * 学员数**不超过** ROSTER_GROUP_THRESHOLD（20）时就是一条平铺列表（US-406b 的既有行为）；
 * 超过时按出席状态折叠分组 —— 组头写明本组人数与「还有 N 位未上传」，老师不用展开就能定位到
 * 还没录完的那一组，20+ 人的班在手机上也能单手完成录入。
 * 分组的顺序、每组人数、每组待办数全部来自 `data/intakePerformance.js` 的 `groupSlotRows`（纯函数）。
 */
function IntakeSlotGroups({listKey,rows,collapsedKeys,onToggle,renderRow,className=''}){
  if(!shouldGroupSlotRows(rows.length)) return <div className={`intake-upload-slot-list ${className}`.trim()}>{rows.map(renderRow)}</div>;
  return <div className={`intake-upload-slot-list grouped ${className}`.trim()} data-slot-groups={listKey}>
    {groupSlotRows(rows).map(group=>{
      const key=`${listKey}:${group.key}`;
      const collapsed=collapsedKeys.includes(key);
      return <section key={key} className={`intake-slot-group${collapsed?' collapsed':''}`} data-group={group.key}>
        <button type="button" className="intake-slot-group-head" aria-expanded={!collapsed} onClick={()=>onToggle(key)}>
          <ChevronDown size={14} className={collapsed?'closed':''}/>
          <b>{group.label}</b>
          <span>{group.total} 人</span>
          {group.pending?<em>还有 {group.pending} 位未上传</em>:<em className="done">已全部上传</em>}
        </button>
        {collapsed?null:<div className="intake-slot-group-body">{group.rows.map(renderRow)}</div>}
      </section>;
    })}
  </div>;
}

function TeacherFlowV2({navigate,setToast,setRecords,framingPresets=[],setFramingPresets=()=>{},teacherProfiles=[],skillLibrary=[],courses=[],lessons=[],setLessons=()=>{},role='teacher',auditLog=[],recordAudit=()=>{},reviewModels=[],reviewModelDefaults={},setReviewModelDefaults=()=>{},keywordTemplates=[],keywordTemplateRemote=null,tracePolicy=null}){
  const management=loadStudentManagement();
  const availableClasses=management.classes||[];
  // 当前登录老师：原型阶段只有一个老师身份（见 roleMeta.teacher），班级数据里存的是老师姓名。
  const currentTeacherName=roleMeta.teacher.name;
  // ---- 草稿恢复（US-409）----------------------------------------------------------
  // 草稿快照**只在首次渲染读一次**：本组件挂载后立刻会跑「写草稿」effect，
  // 用当前（初始）状态覆盖那条记录，读晚了就永远看不到上次的草稿。
  // 它只含元数据（课次信息 + 学员选择 + 作品名），没有任何素材地址。
  const [initialDraft]=useState(()=>readFeedbackDraft());
  // 历史班级可能没有 teacher 字段（旧数据/本机遗留），算作自己的班，否则页面会看起来是空的。
  const myClasses=availableClasses.filter(item=>!item.teacher||item.teacher===currentTeacherName);
  // 「新建草稿」与无草稿进入时的初始班级：我带的第一个班。
  const defaultClassId=myClasses[0]?.id||'';
  // 默认只显示当前老师带的班；「全部班级」开关服务于代课、教研听课与新老师接手（PRD Q8）。
  // 草稿里的班级若是别人名下的班，先把范围切到「全部班级」，否则 selectedClass 找不到、看起来像没恢复。
  const [showAllClasses,setShowAllClasses]=useState(()=>Boolean(initialDraft?.classId)
    &&availableClasses.some(item=>item.id===initialDraft.classId)
    &&!myClasses.some(item=>item.id===initialDraft.classId));
  const visibleClasses=showAllClasses?availableClasses:myClasses;
  const [selectedClassId,setSelectedClassId]=useState(()=>{
    const restored=String(initialDraft?.classId||'');
    return restored&&availableClasses.some(item=>item.id===restored)?restored:defaultClassId;
  });
  // selectedClass 只认当前可见列表里的班级：切回「我带的班」时不会残留别的老师的班。
  const selectedClass=visibleClasses.find(item=>item.id===selectedClassId)||null;
  const classStudents=management.students.filter(item=>item.className===selectedClass?.name);
  // 恢复草稿时把上次选中的学员带回：个人反馈的参与学员只有一位，那一位就是所选学员。
  const [selectedStudentName,setSelectedStudentName]=useState(()=>{
    const restored=draftSelectedStudent(initialDraft);
    if(restored&&classStudents.some(item=>item.name===restored)) return restored;
    return classStudents[0]?.name||'';
  });
  // 不再回落到「第一个学员」：切换班级后必须是显式的空选择，否则会跨班串档。
  const selectedStudent=classStudents.find(item=>item.name===selectedStudentName)||null;
  const selectedStudentLabel=selectedStudent?.name||'未选择学员';
  const selectedClassLabel=selectedClass?.name||'未选择班级';
  // 草稿恢复提示的细节（US-409）：上次进行到第几步、恢复了哪次课。用草稿里存的值渲染，
  // 这样「课题」等字段即便后来课程库改了，也能如实说明上次存的是什么。
  const draftRestoreDetail=initialDraft
    ? `${initialDraft.step>1?`上次进行到第 ${initialDraft.step} 步（素材已随刷新失效，已回到第一步）。`:''}已恢复：${selectedClassLabel}${initialDraft.lessonDate?` · ${initialDraft.lessonDate}`:''}${initialDraft.lessonNo?` · 第 ${initialDraft.lessonNo} 次课`:''}${initialDraft.topic?`《${initialDraft.topic}》`:''}。作品与课堂照片只在当次会话内有效，请重新选择原始素材。`
    : '';
  // 「上次进入流程时有没有选过素材」同样只在**首次渲染**读一次（与草稿分开两条键：
  // 草稿里不允许出现素材相关的字段，这条痕迹只服务于「刷新后提示重新选择原始素材」）。
  const [lastSessionMedia]=useState(()=>readSessionMediaSnapshot());
  // 恢复草稿的提示条（可关闭）与「上次保存的作品名」待填队列（详见 feedbackDraft.js）。
  const [draftRestored,setDraftRestored]=useState(()=>Boolean(initialDraft));
  const [pendingTitles,setPendingTitles]=useState(()=>restoredArtworkTitles(initialDraft));
  // 素材随刷新失效：草稿里 step>1 的会话回到第一步（那里没有作品可装裱/点评），
  // 提示条会说明上次进行到第几步，避免老师以为「流程跳回去了」。
  const [step,setStep]=useState(()=>resolveRestoredStep(initialDraft));
  // 上次是个人还是班级反馈不额外持久化，由 participants 的不变量推导（多于一位 = 班级反馈）。
  // 课程下拉的数据源是课程库（停用课程不进可选列表）。班级上的 course 存的是课程名，要经 resolveCourseId 换算。
  // 这一段（课程选择）刻意放在「选用哪套装裱模板」之前：装裱模板的默认选中要按**本次课程**解析
  // （US-011b 的按课程绑定），所以 activeCourseId 必须先算出来。
  const courseOptions=selectableCourses(courses);
  const classCourseId=resolveCourseId(courses,selectedClass?.course);
  const classCourseName=String(selectedClass?.course||'').trim();
  const [selectedCourseId,setSelectedCourseId]=useState(()=>String(initialDraft?.courseId||''));
  // 选中的课程被停用或不在课程库里时，回落到本班课程，再回落到第一门可选课程。
  const activeCourseId=courseOptions.some(item=>item.courseId===selectedCourseId)
    ? selectedCourseId
    : (courseOptions.some(item=>item.courseId===classCourseId)?classCourseId:courseOptions[0]?.courseId||'');
  const [mode,setMode]=useState(()=>draftMode(initialDraft));
  // frame 存的是云端装裱预设的 id（老师手动选用过的那一套），空串 = 跟随解析出来的默认模板。
  const [frame,setFrame]=useState('');
  // 老师有没有**手动**选过样式（US-011b）：手动选过就以老师的选择为准，
  // 「默认选中说明」条只在跟随默认时出现；换课程时回到跟随默认（解析按课程重新算）。
  const [framePickedManually,setFramePickedManually]=useState(false);
  // 老师端只显示自己可见的模板（US-001b）：平台模板 + 本机构模板 + 自己的个人模板，
  // 别人的个人模板看不到。本机兜底数据（云端不通时 state 就是 localStorage 镜像）也必须过这道过滤，
  // 否则换一个老师登录会看到上一位老师的个人模板。
  // 顺序也用 `sortFramingPresets`（管理员在后台调过的排序就是老师看到的顺序）。
  const teacherFrameViewer={role:'teacher',teacherName:currentTeacherName,orgId:DEFAULT_ORG_ID};
  // ---- 写权限与审计（[US-013]）------------------------------------------------------
  // 老师端的写权限判定与会话身份都从这一份来：`teacherWriteActor` 是审计日志里的「操作人」，
  // `teacherFrameViewer` 同时是写权限的入参（个人模板的 ownerKey 命中本人身份串才可写）。
  const teacherWriteActor=framingActor(teacherFrameViewer);
  // 最近一次「另存为我的模板」/「保存图片」写下的审计条目（面板上的回执读它，而不是去猜）。
  const [templateAuditEntry,setTemplateAuditEntry]=useState(null);
  const [artworkAuditEntry,setArtworkAuditEntry]=useState(null);
  /** 记一条老师端审计（操作人四件套由这里补齐：身份串 / 姓名 / 角色 / 机构）。 */
  const auditTeacherEntry=(input)=>{
    const entry=recordAudit({...input,actorId:teacherWriteActor.actorId,actorName:teacherWriteActor.actorName,actorRole:teacherWriteActor.role,actorRoleLabel:teacherWriteActor.roleLabel,orgId:DEFAULT_ORG_ID});
    if(entry.action===AUDIT_ACTIONS.templateSave) setTemplateAuditEntry(entry);
    if(entry.action===AUDIT_ACTIONS.artworkSave) setArtworkAuditEntry(entry);
    return entry;
  };
  /**
   * 老师端写模板的唯一通道（另存为 / 重命名 / 删除都走它）：
   *   ① 先用同一份规则判权限（不合格：记一条「被拒绝」的审计 + 可读提示，且**不做任何乐观更新**）；
   *   ② 再把写入推到云端（服务层会再判一次，越权在那里抛 403）。
   * 先判后写是刻意的：乐观更新一旦落下，界面就已经把越权结果画出来了。
   */
  const writeTeacherPreset=async(preset,{action='保存模板'}={})=>{
    const issue=framingPresetWriteIssue(preset,teacherFrameViewer);
    if(issue){
      auditTeacherEntry({
        action:AUDIT_ACTIONS.templateWriteDenied,
        templateId:preset?.id||'',
        templateName:preset?.name||'',
        scope:normalizeFramingPreset(preset).scope,
        outcome:'denied',
        detail:`${action}被拒绝：${issue}`
      });
      setToast(framingWriteDeniedMessage(preset,teacherFrameViewer));
      throw new Error(issue);
    }
    return saveRemoteFramingPreset(preset,teacherFrameViewer);
  };
  const visibleFrames=filterFramingPresetsForViewer(framingPresets,teacherFrameViewer);
  const enabledFrames=selectableFramingPresets(visibleFrames);
  // 默认选谁（US-011b）：按课程绑定 → 默认模板 → 第一套；老师手动点过卡片就以老师的选择为准
  // （`frame` 为空串时才是「跟随默认」，换课程会把跟随重置，见下面的 effect）。
  // 入参用**可见全量**（`visibleFrames`）而不是筛过的 `enabledFrames`：解析要能看到
  // 「按课程绑定的那套已被停用」，才能把原因说清楚（停用的模板不算命中，回落默认模板）。
  const frameResolution=resolveFramingPresetForCourse(visibleFrames,{
    courseId:activeCourseId,
    courseName:courseOptions.find(item=>item.courseId===activeCourseId)?.name||''
  });
  const resolvedFrame=frameResolution.preset;
  const frameResolveText=framingPresetResolveText(frameResolution);
  const activeFrame=enabledFrames.find(item=>item.id===frame)||resolvedFrame||null;
  const activeFrameId=activeFrame?.id||'';
  // ---- 我的模板（US-009）-----------------------------------------------------------
  // 老师端「另存为我的模板」的重命名 / 删除只对自己的个人模板开放：系统（平台）与机构模板
  // 由管理员在「装裱设置」里维护，老师端**不显示编辑入口**，写入侧也由 `framePresetEditableBy` 再拦一道。
  const myTemplateFrames=editableFramingPresets(framingPresets,teacherFrameViewer);
  const [myTemplateForm,setMyTemplateForm]=useState({name:'',description:''});
  // 保存 / 重命名 / 删除的回执与拒绝原因（内联文案，不只在 2.6 秒的 toast 里）。
  const [myTemplateNotice,setMyTemplateNotice]=useState('');
  const [renamingPresetId,setRenamingPresetId]=useState('');
  const [renamePresetValue,setRenamePresetValue]=useState('');
  const [myTemplateSaving,setMyTemplateSaving]=useState(false);
  // ---- 相框样式微调（US-006）-------------------------------------------------------
  // 老师对所选样式的调整（形状 / 材质色 / 框宽 / 卡纸）是**本次选用的一层补丁**：
  // 不写回模板（模板的写权限是 US-031「另存为我的模板」的事），也不进草稿（草稿字段清单是 US-409 定的）。
  // 没有微调时 applyFrameStyleTweaks 原样返回模板 spec —— 老模板的渲染一个像素都不变。
  const [frameTweaks,setFrameTweaks]=useState(()=>normalizeFrameStyleTweaks(null));
  const frameTweaksKey=JSON.stringify(normalizeFrameStyleTweaks(frameTweaks));
  const frameStyleSpec=applyFrameStyleTweaks(activeFrame?.spec||DEFAULT_FRAME_SPEC,frameTweaks);
  // ---- 水印 · 落款 · 时间面板（US-007）---------------------------------------------
  // 三区（水印 / 落款 / 时间）的输入都写进 `overlayTweaks` 这一层补丁，再叠到模板 spec 上：
  //   `overlayGroups`（模板收敛后的分组）→ `buildOverlayOverrides`（把改动合并成完整分组）
  //   → `applyOverlayOverrides`（叠到 spec）→ `effectiveFrameSpec` → 装裱那一段 effect 重画成品图。
  // 于是**没有「应用」按钮**：改一下参数，右侧成品预览（`media.artwork.framedUrl`）就跟着重画。
  // 与 US-006 的相框微调同一个口径：不写回模板、不进草稿（US-409 的字段清单是硬约束），
  // 没有改动时 `applyOverlayOverrides` 原样返回输入 —— 老 v1 模板的渲染逐像素不变。
  const [overlayTweaks,setOverlayTweaks]=useState(()=>normalizeOverlayTweaks(null));
  const [overlayDrawerOpen,setOverlayDrawerOpen]=useState(false);
  const [overlayAssetBusy,setOverlayAssetBusy]=useState('');
  // 素材上传的错误文案按**哪一支**记（Logo 与签名图共用一套准入规则，但提示要落在出问题的那张卡上）。
  const [overlayAssetError,setOverlayAssetError]=useState({kind:'',message:''});
  // 班级反馈没有单幅「当前作品」，面板的成品预览退化为第一幅已上传作品的实时渲染（与 US-006 缩略图同一口径）。
  const [overlayPreview,setOverlayPreview]=useState('');
  const [overlayPreviewError,setOverlayPreviewError]=useState('');
  const overlayLogoInput=useRef(null);
  const overlaySignatureInput=useRef(null);
  const frameGroups=normalizeFrameSpecV2(frameStyleSpec);
  const overlayOverrides=buildOverlayOverrides(frameGroups,overlayTweaks);
  const effectiveFrameSpec=applyOverlayOverrides(frameStyleSpec,overlayOverrides);
  // 面板上的每个控件读的都是「模板 + 本次改动」收敛后的分组（与渲染层同一条路径，不另算一份）。
  const overlayGroups=overlayOverrides?normalizeFrameSpecV2(effectiveFrameSpec):frameGroups;
  const overlayTweakSummaryText=overlayTweakSummary(overlayTweaks);
  const overlayTweakCountValue=overlayTweakCount(overlayTweaks);
  const overlayEnabledText=overlayEnabledSummary(overlayGroups);
  const overlayEnabledCountValue=overlayEnabledCount(overlayGroups);
  const overlayPatchKey=overlayInstanceKey(overlayOverrides);
  const frameTweakSummary=frameStyleTweakSummary(frameTweaks);
  const frameTweakCount=frameStyleTweakCount(frameTweaks);
  // 形状 / 材质色 / 框宽 / 卡纸的「现在是什么」：微调控件的高亮与卡片副标题都读它。
  const frameStyleNow=describeFrameStyleSpec(effectiveFrameSpec);
  // 样式缩略图（US-006）：串行渲染「用当前作品实时渲染」的小图，按渲染视图 + 作品地址指纹缓存。
  const [frameThumbs,setFrameThumbs]=useState({});
  const frameThumbCacheRef=useRef(new Map());
  const [subject,setSubject]=useState('通用美术');
  const [media,setMedia]=useState({artwork:null,photo:null});
  const [batchUploads,setBatchUploads]=useState({artwork:[],photo:[]});
  const [uploadState,setUploadState]=useState({artwork:'idle',photo:'idle'});
  // 上传准入的持久提示（被拒的文件、降采样说明）—— 用内联文案而不是只弹 toast：
  // toast 2.6 秒就消失，老师来不及看清「哪一份被跳过、为什么」。
  const [mediaIntakeNotice,setMediaIntakeNotice]=useState('');
  // 刷新后素材失效的提示可以被手动关掉（关掉只影响本次会话，刷新后重来）。
  const [mediaLostDismissed,setMediaLostDismissed]=useState(false);
  // 上次会话选过素材、这次会话里没有：说明素材已经随刷新失效（object URL 只活在当次会话）。
  const lostSessionMedia=Boolean((lastSessionMedia?.artwork&&!media.artwork)||(lastSessionMedia?.photo&&!media.photo));
  const [archived,setArchived]=useState(false);
  // 本次会话归档出来的记录 id（US-008b）：成品图写回之后要**就地更新**这一条，
  // 3D 画廊读的正是它（records 是画展的记录来源）。换班 / 换学员 / 新建草稿时一并清掉 ——
  // 留着上一个上下文的 id 会把成品图写到别人家的档案里去。
  const [currentRecordId,setCurrentRecordId]=useState('');
  // 写回档案（US-008b）最近一次尝试的状态。**持久的写回状态以作品位上的记录为准**，
  // 这个 state 只承载「正在写 / 刚失败（可重试）」这类一次性提示。
  const [writeBackAttempt,setWriteBackAttempt]=useState({status:'idle',quality:'',message:''});
  // 班级批量应用装裱（US-010）：一次运行的进度 / 失败清单 / 耗时，面板上选中的那一套模板，
  // 以及「覆盖已单独调整的作品」之前的二次确认条（验收原文「将覆盖 N 幅已单独调整的作品」）。
  const [batchFramingPresetId,setBatchFramingPresetId]=useState('');
  const [batchFraming,setBatchFraming]=useState(()=>createBatchFramingState());
  const [batchFramingConfirm,setBatchFramingConfirm]=useState('');
  // 取消是「老师点了取消、当前这一幅画完就停」：循环在每一幅开始前读这个标记（不打断正在渲染的一张）。
  const batchFramingCancelRef=useRef(false);
  // 上下文切换（换班 / 换模式 / 新建草稿）时把批量装裱的进度与失败清单一起作废：
  // 失败项是按 uploadId 记的，换了上下文之后那些 id 已经不存在，留着只会误导。
  const resetBatchFraming=()=>{
    batchFramingCancelRef.current=true;
    setBatchFraming(current=>batchFramingReducer(current,{type:'reset'}));
    setBatchFramingConfirm('');
  };
  // 五维点评的正文默认留空：内容只能来自大模型（人设 + 专业技能 + 记忆）。
  // 留空状态下的提示语只说明这一维要看什么，不预填任何「像点评的句子」。
  // 键名与顺序来自 data/reviewDetailPanel.js 的 REVIEW_DIMENSION_NAMES —— 与提示词、正文进度同一份。
  const reviewDefaults=Object.fromEntries(REVIEW_DIMENSION_NAMES.map(name=>[name,'']));
  const [reviews,setReviews]=useState(reviewDefaults);
  const [keywords,setKeywords]=useState([]);
  // 大模型识别出的观察词（用于在面板上打「AI」标记）；keywords 是最终生效的集合。
  const [aiKeywords,setAiKeywords]=useState([]);
  const [keywordSuggesting,setKeywordSuggesting]=useState(false);
  const [keywordDirty,setKeywordDirty]=useState(false);
  // ---- 作品观察词模板（[第三步 US-109] / F-REVIEW-KW-01）--------------------------------
  // 「这次用哪一套词表」只算一次，面板、提示词候选清单与模型返回值校验三处都读这一份产物：
  //  - 匹配输入：本次反馈模式 + 本次课程（课程库里的课程名 / 年龄段）+ 第三步选中的课程类型；
  //  - 都没命中时用该模式的默认模板；一套可用模板都没有（或云端不通且本机镜像被清空）时
  //    回落到内置兜底词表，并带上一句明示（`noteText`，FR-142 不得静默降级）。
  const activeKeywordCourse=courses.find(item=>item.courseId===activeCourseId)||null;
  const keywordTemplateView=keywordTemplateLoadout({
    templates:keywordTemplates,
    mode,
    courseTypes:[activeKeywordCourse?.name||classCourseName,subject],
    ageRange:activeKeywordCourse?.ageRange||'',
    remoteFailed:keywordTemplateRemote?.failed===true
  });
  const [framingState,setFramingState]=useState('idle');
  // ---- 作品编辑器（US-004a 旋转 / US-004b 裁剪）-----------------------------------
  // `open` 是编辑态开关；`draft` 是「正在编辑但还没确认」的那一版 artworkEdit（确认前不进 media，
  // 所以错误操作不会污染已装裱的成品）；`history` 是撤销栈（至少 20 步，快照式，裁剪/旋转天然一起撤销）；
  // `cropAspect` 是当前锁定的比例预设（纯界面态 —— 裁剪框本身就存在 artworkEdit.crop 里，不进这个字段）。
  const [artworkEditor,setArtworkEditor]=useState(()=>({open:false,draft:createArtworkEdit(),history:createArtworkEditHistory(createArtworkEdit()),cropAspect:''}));
  // 编辑态的预览地址：编辑时预览的是「旋转稿」，确认之后才让第二步的重活（自动裁剪 + 装裱）跑一次。
  // 两档（US-004c 的节流）：操作过程中是低分辨率稿（长边 ≤ EDIT_PREVIEW_MAX_EDGE = 900，跟手），
  // 停手 ARTWORK_PREVIEW_SETTLE_MS（300ms）后合成高清预览（长边 ≤ EDIT_PREVIEW_HD_MAX_EDGE = 2400）。
  const [editorPreview,setEditorPreview]=useState('');
  const [editorPreviewPending,setEditorPreviewPending]=useState(false);
  const [editorPreviewMode,setEditorPreviewMode]=useState('low');
  // 已经合过高清预览的那个旋转角（同一个角不重复编码；换角度/重开编辑器都作废）。
  const editorPreviewHdRef=useRef('');
  // ---- 装裱移动端与性能（US-012）------------------------------------------------------
  // 编辑底图：手机原图**先降采样到长边 2400 再编辑**（编辑期间的预览与舞台都用它，
  // 原图 originalUrl 仍是只读的四层地址之一）。准备过程中的耗时落进 editBasePerf 给界面读数。
  const [editBase,setEditBase]=useState(null);
  const [editBaseBusy,setEditBaseBusy]=useState(false);
  const [editBasePerf,setEditBasePerf]=useState(null);
  // 拖动帧率与内存峰值：都是「测量 → 数据层判定」，界面只显示结论（不在这里写阈值）。
  const [dragPerf,setDragPerf]=useState(null);
  const [memoryBytes,setMemoryBytes]=useState(0);
  // 1800px 合成的实测耗时（每一次合成都会刷新；budgetMs 由设备口径决定）。
  const [composePerf,setComposePerf]=useState(null);
  // 第二步的底部抽屉（390px 验收：选框 / 保存各自一个抽屉；编辑器开着自己就是抽屉；水印沿用 US-007 的抽屉）。
  const [studioDrawer,setStudioDrawer]=useState('');
  const frameSamplerRef=useRef(null);
  const memorySamplerRef=useRef(null);
  // 编辑底图按「作品 + 原图地址」缓存：换作品 / 重新上传会作废（换班、新建草稿也一起清）。
  const editBaseRef=useRef({key:'',base:null});
  const editBaseRequestRef=useRef(0);
  // 裁剪舞台（US-004b）：预览图的原生尺寸（= 摆正后那张图的像素比例）。尺寸未知时禁用比例预设。
  const [cropStage,setCropStage]=useState({naturalWidth:0,naturalHeight:0});
  const cropStageRef=useRef(null);
  const cropDragRef=useRef(null);
  // 缩放 / 平移的手势（US-004c）：舞台上的活动指针 + 当前手势（单指平移 / 双指缩放）。
  // 指针按 pointerId 记账而不是按「第一根/第二根」：双指抬起一根后剩下的那根继续平移。
  const viewPointersRef=useRef(new Map());
  const viewGestureRef=useRef(null);
  const viewLabelRef=useRef('缩放 / 平移画面');
  // 滚轮监听是**非 passive** 的（React 的 onWheel 挂在 root 上且 passive，preventDefault 会被忽略、
  // 页面会跟着一起滚），所以用 ref 读最新草稿、在 effect 里手动 addEventListener。
  const editorDraftRef=useRef(createArtworkEdit());
  const artworkEditKey=artworkEditSnapshotKey(media.artwork?.artworkEdit);
  // 两份编辑在「值」上是否相同：顶到 0.5×/5×、平移到边界时缩放/平移函数返回的是**值不变**的编辑
  // （对象不是同一个，所以按快照键比），据此跳过没变化的那一下。
  const artworkEditSameValue=(a,b)=>artworkEditSnapshotKey(a)===artworkEditSnapshotKey(b);
  // 缩放/平移过程中的草稿更新（US-004c）：与裁剪拖拽同一条纪律 —— 手势进行中只改草稿、不进撤销栈，
  // 停手（滚轮/双指）或松手（拖动）之后才压一步；没有实际变化时原样返回，避免无意义的重渲染。
  const setArtworkViewDraft=(next,label)=>setArtworkEditor(current=>{
    if(!current.open) return current;
    const draft=normalizeArtworkEdit(next);
    if(artworkEditSnapshotKey(draft)===artworkEditSnapshotKey(current.draft)) return current;
    if(label) viewLabelRef.current=label;
    return {...current,draft};
  });
  const [reviewState,setReviewState]=useState('idle');
  // 本次点评使用哪个老师人设（人设 + 技能库 + 大模型记忆一起进 system 提示词）。
  const [activeProfileId,setActiveProfileId]=useState('');
  // 本次点评用哪个视觉模型（[第三步 US-107a]）：'' / 'pool-route' = 由模型池自动路由，
  // 其余是老师指定的模型 id。初始值取**个人默认**（下次进入默认选中）；
  // `reviewModelPicked` 标记老师本次是否手动选过 —— 选过就不再被默认值顶掉。
  const [reviewModelChoice,setReviewModelChoice]=useState(()=>reviewModelDefaultId(loadReviewModelDefaults(),roleMeta.teacher.name));
  const [reviewModelPicked,setReviewModelPicked]=useState(false);
  const [reviewStream,setReviewStream]=useState({phase:'idle',reasoning:'',content:'',message:'',startedAt:0,elapsedMs:0});
  // 本次点评详情面板（US-103a）：默认**折叠**（open=false），点摘要行才展开。
  // 折叠只影响渲染 —— 推理增量一直存在 reviewStream 里，所以折叠后再展开内容一字不丢、也不会重新请求模型。
  const [reviewDetailOpen,setReviewDetailOpen]=useState(false);
  // 本次生成「加载了什么」（人设 / 技能 / 记忆 / 观察词模板 / 提示词模块）：在开始生成时按提示词的
  // 同一份输入算一次，折叠态摘要与展开后的加载清单都读它（不重新推导，避免面板与提示词对不上）。
  const [reviewLoaded,setReviewLoaded]=useState(null);
  // 本次请求的提示词与附件清单（US-103b 的「提示词」分区）：与真正发出去的那一份同源
  //（`buildReviewPromptBundle`，面板与 `streamArtworkReview` 读同一个纯函数）。
  // 只含 system / user 文本与附件引用 + hash，**不含图片正文**。
  const [reviewPrompt,setReviewPrompt]=useState(null);
  // 收束后的推理轨迹（US-102）：展开态的「用量与耗时 / 输出原文」以它为准（真正发出去的与模型返回的）。
  // 生成中它是 null，面板回落读流式增量；换上下文（换班 / 换学员 / 换模式 / 新建草稿）一起清掉。
  // 注意它只是 `reviewTraceRef` 的一份**渲染副本** —— 留档仍只由 ref 在归档那一刻提交。
  const [reviewTracePanel,setReviewTracePanel]=useState(null);
  // 「本次点评已生成」的唯一置真位（US-108a）：只有云端成功返回五维正文才会点亮。
  // 声明位置必须早于归档强校验的派生值（US-108b 的 `reviewArchiveGate` 读它）。
  const [reviewGenerated,setReviewGenerated]=useState(false);
  // 连续失败了几次（US-108b）：成功一次就归零，换上下文（换班 / 换学员 / 换模式 / 新建草稿）也清零。
  // 到 `REVIEW_FAILURE_STREAK_LIMIT` 次时面板上提示「可能是模型服务波动」并推荐最健康的可用模型。
  const [reviewFailureStreak,setReviewFailureStreak]=useState(0);
  // 两次对比的「上一次」（US-107b）：本次生成的 `parentTraceId` 命中的那一条已收束轨迹
  // （可能是**被中止**的那一次 —— 生成中换模型就是这么来的）。没有它时面板不渲染对比区。
  const [reviewCompareParent,setReviewCompareParent]=useState(null);
  // 生成中换模型的二次确认（US-107b）：`{ value, message }`。非空时选择器出确认条，
  // 确认前**一个选择都不改**（当前正文本就还在生成，误触不该把它打断）。
  const [reviewModelSwitch,setReviewModelSwitch]=useState(null);
  // 本次会话里真正发起过几次模型请求（只读探针，与 data-detail-requests 一起给验证脚本用：
  // 折叠 / 展开不能让它变化 —— 那正是「不重新请求模型」的判据）。
  const [reviewRequests,setReviewRequests]=useState(0);
  const reviewAbort=useRef(null);
  // 本次点评的推理轨迹（[第三步 US-102]）。**生成期只驻留内存**：老师没归档就刷新页面，
  // 轨迹随之消失（与「草稿只存元数据」同一条隐私口径）；归档那一刻才由 `commitReviewTrace`
  // 写本机镜像 + 提交云端。换班 / 换学员 / 换模式 / 新建草稿都要清掉它 ——
  // 留着上一位学员的轨迹会让下一次归档把别人家的点评详情一起交上去。
  const reviewTraceRef=useRef(null);
  // 正在跑的这一代的账（US-107b）：`{ controller, traceId, parentTraceId }`。
  // **traceId 在开始生成时就定下来** —— 收束后的轨迹只在 `onTrace` 才拿得到，生成中换模型时
  // 新轨迹要关联的「上一次」正是还没有收束的这一条，只有这里能给出它的 id。
  const reviewRunRef=useRef(null);
  // 已收束轨迹的小账本（US-107b，内存、最多 8 条）：对比区要读「上一次」的模型 / 耗时 / 推理，
  // 而它可能已经被新一次生成顶掉（生成中换模型时，上一次是**被中止**的那一条）。
  // 与 `reviewTraceRef` 同一条纪律：不写 localStorage，换上下文整体清空。
  const reviewTraceArchiveRef=useRef([]);
  // 把「解析出来的默认模板」固化进 frame：面板与后续所有消费点读的都是 activeFrameId 一个来源。
  // `frame` 为空串时才是「跟随默认」——老师手动点过卡片就不会被默认值顶掉。
  useEffect(()=>{if(!frame&&activeFrameId)setFrame(activeFrameId)},[frame,activeFrameId]);
  // 换课程（或换班导致课程变）以后，重新按**这门课**解析默认模板（US-011b 的按课程绑定）：
  // 老师上一次手动选的那一套不再适用，清掉 frame 让它回落到新课程的绑定 / 默认模板。
  useEffect(()=>{setFrame('');setFramePickedManually(false)},[activeCourseId,selectedClassId]);
  useEffect(()=>{if(!activeProfileId&&teacherProfiles[0])setActiveProfileId(teacherProfiles[0].id)},[activeProfileId,teacherProfiles]);
  // 个人默认模型回到选择器（US-107a）：老师本次**没手动选过**才同步 ——
  // 挂载时取出上次记住的那个（「下次进入默认选中」），云端默认到达 / 换身份也走这一条。
  useEffect(()=>{if(reviewModelPicked)return;setReviewModelChoice(reviewModelDefaultId(reviewModelDefaults,currentTeacherName))},[reviewModelDefaults,currentTeacherName,reviewModelPicked]);
  // 本次点评的模型事实（老师指定 / 池路由命中的 id + 来源 + 回落原因）：请求、轨迹与面板读同一份。
  const reviewModelPlan=reviewModelResolve(reviewModels,{selection:reviewModelChoice,orgId:DEFAULT_ORG_ID});
  // 归档强校验（[第三步 US-108b]）：**五个维度全部非空 + 本次生成轨迹成功**，缺哪项就把哪项写清楚
  // （不是笼统的「请完善信息」）。归档按钮的禁用、清单渲染、`go(4)` 与 `archiveRecord` 的拦截
  // 全部读这一份 —— 判据的唯一真源在 `data/reviewRecovery.js`。
  const reviewArchiveGate=evaluateReviewArchiveGate({mode,reviews,generated:reviewGenerated,traceStatus:reviewTracePanel?.status||''});
  // 连续失败 3 次时的推荐（US-108b）：只从**可用**模型里挑健康状态最好的那个（近期 P95 最短）。
  const reviewRecommendation=reviewModelHealthiest(reviewModels,{orgId:DEFAULT_ORG_ID});
  const reviewFailureView=reviewFailureStreakView({failures:reviewFailureStreak,recommendation:reviewRecommendation,currentModelId:reviewModelPlan.modelId});
  /**
   * 真正把选择落到 state 上（US-107a）：立即生效（下一次生成就用它），并**记住为个人默认**。
   * 本机镜像由 main.jsx 的 persistReviewModelDefaults effect 落盘；云端推一次
   * （`review_model_preferences` 表还没建 → 失败即忽略，只影响跨设备可见）。
   * 「由模型池自动路由」也是一次选择：默认存空串，下次进入照样默认选中它。
   */
  const applyReviewModelChoice=(value)=>{
    const next=value===REVIEW_MODEL_POOL_ROUTE_ID?'':value;
    setReviewModelPicked(true);
    setReviewModelChoice(next);
    setReviewModelDefaults(current=>withReviewModelDefault(current,currentTeacherName,next));
    void saveRemoteReviewModelDefault({teacherKey:currentTeacherName,modelId:next}).catch(()=>{});
  };
  /**
   * 老师选定点评模型（US-107a 的选择 + US-107b 的「生成中换模型」）：
   *  - 不在生成中：立即生效（与改造前逐字符相同的行为）；
   *  - **生成中**：先出二次确认条（验收原文「将重新生成，当前正文会被替换」），
   *    **确认前一个 state 都不改**（当前生成继续跑，误触不会把正文打断）；
   *    确认后换模型并立即重启生成，新轨迹用 `parentTraceId` 关联正在跑的这一条。
   *  - 点当前已选中的那一行 = 什么都没发生（不出确认条，也不重启生成）。
   */
  const selectReviewModel=(value)=>{
    const next=value===REVIEW_MODEL_POOL_ROUTE_ID?'':value;
    if(next===reviewModelChoice){setReviewModelSwitch(null);return;}
    if(reviewStream.phase===REVIEW_DETAIL_PHASES.running){
      const toName=next
        ?(reviewModelPlan.options.rows.find(row=>row.id===next)?.name||next)
        :(reviewModelPlan.poolRow?.name||'由模型池自动路由');
      // 确认条的文案（含验收原话）与目标名都来自 data 层，组件只渲染。
      setReviewModelSwitch({value:next,targetName:toName,message:reviewModelSwitchConfirmText({fromName:reviewModelPlan.row?.name||reviewModelPlan.modelId,toName})});
      return;
    }
    setReviewModelSwitch(null);
    applyReviewModelChoice(next);
  };
  /** 取消换模型：只收起确认条，当前生成与选择都不动。 */
  const cancelReviewModelSwitch=()=>setReviewModelSwitch(null);
  /** 二次确认后：换模型 + **立即重启生成**（本次正文被替换，新轨迹关联上一次）。 */
  const confirmReviewModelSwitch=()=>{
    const pending=reviewModelSwitch;
    setReviewModelSwitch(null);
    if(!pending) return;
    applyReviewModelChoice(pending.value);
    // 把新选择直接传给这一次生成：state 是异步的，等它生效再生成会用到旧模型。
    void startCloudReview(pending.value);
  };
  // ---- 生成失败后的三个动作（[第三步 US-108b]）--------------------------------------
  // 验收原文：失败态提供**重试、换模型重试、稍后再来**三个动作，并且**不丢失已填写的老师补充
  // 观察**。因此三个动作都只碰「生成」这一层：素材、观察词、逐维改过的正文 / 老师补充观察与
  // 模型选择原样保留，谁也不去 `setReviews` / `setKeywords` / `setMedia`。
  /** 重试：同一个模型原地再来一次（模型选择也不动）。 */
  const retryReviewWithSameModel=()=>{
    if(reviewStream.phase===REVIEW_DETAIL_PHASES.running) return;
    void startCloudReview();
  };
  /** 换模型重试：自动改用**健康状态最好的可用模型**并立即重启生成（落点由 data 层定）。 */
  const retryReviewWithAnotherModel=()=>{
    if(reviewStream.phase===REVIEW_DETAIL_PHASES.running) return;
    const target=reviewSwitchModelTarget(reviewModels,{orgId:DEFAULT_ORG_ID,currentModelId:reviewModelPlan.modelId,currentChoice:reviewModelPlan.choice});
    if(!target){setToast('当前没有其它可用的点评模型，请稍后再来，或联系机构管理员检查模型服务。');return;}
    const changed=target.choice!==reviewModelPlan.choice;
    if(changed) applyReviewModelChoice(target.choice);
    setToast(target.note);
    // 新选择直接传参（与生成中换模型同一条理由：state 是异步的）。
    void startCloudReview(target.choice);
  };
  /** 稍后再来：只收起失败提示，其它一个字都不动（想继续时再点「开始生成点评」）。 */
  const dismissReviewFailure=()=>{
    setReviewStream({phase:REVIEW_DETAIL_PHASES.idle,reasoning:'',content:'',message:'',startedAt:0,elapsedMs:0});
    setToast(`已收起失败提示。${REVIEW_FAILURE_KEEP_NOTE}`);
  };
  /** 失败恢复动作的统一入口（界面按 `data-recovery-action` 派发，不在 JSX 里写三个 onClick）。 */
  const runReviewRecovery=(actionId)=>{
    if(actionId==='retry') return retryReviewWithSameModel();
    if(actionId==='switch-model') return retryReviewWithAnotherModel();
    if(actionId==='later') return dismissReviewFailure();
    return undefined;
  };
  // 生成中的秒表（折叠态摘要的「已用时」）：只按 startedAt 推算，不做累加 ——
  // 折叠 / 展开、切步骤回来都不会把已用时算丢或算重。
  useEffect(()=>{if(reviewStream.phase!=='running')return undefined;const timer=setInterval(()=>setReviewStream(current=>current.phase==='running'?{...current,elapsedMs:Math.max(0,Date.now()-current.startedAt)}:current),1000);return()=>clearInterval(timer)},[reviewStream.phase]);
  const artworkInput=useRef(null), photoInput=useRef(null);
  // 乘上传位：每位学员一个隐藏的 <input type=file>，按 studentId 存 ref（不能用行号，删行/换班后会错位）。
  const artworkSlotInputs=useRef({});
  // 课堂照片上传位（US-009）：同样一人一个 input，另外单独一个 input 给「全班合影」。
  const photoSlotInputs=useRef({});
  const sharedPhotoInput=useRef(null);
  // 正在「分给多位学员」的那张照片（uploadId）与勾选到的学员 key 集合。
  const [photoAssignId,setPhotoAssignId]=useState('');
  const [photoAssignSelection,setPhotoAssignSelection]=useState([]);
  // ---- 录入页移动端与性能（US-413）-----------------------------------------------
  // 上传位列表的折叠分组：学员数 > 20 时按出席状态分组，key 形如「artwork:absent」。
  const [collapsedSlotGroups,setCollapsedSlotGroups]=useState([]);
  // 还在空闲时段生成缩略图的张数（列表先生成小图，生成过程不阻塞输入）。
  const [thumbPendingCount,setThumbPendingCount]=useState(0);
  // 本次录入的开始时刻：进入流程那一刻。用时不靠定时器刷整页（全页每秒重渲染是性能反模式），
  // 只在素材发生变化的那些操作里重算一次。
  const intakeStartedAtRef=useRef(Date.now());
  const [intakeElapsedSeconds,setIntakeElapsedSeconds]=useState(0);
  const steps=[['创建信息','选择对象并上传素材'],['智能装裱','完成作品与照片的裁剪装裱'],['五维点评','依据素材完成温暖点评'],['归档转发','形成一次完整课后反馈']];
  // 课程下拉与本次课程的解析在组件顶部（装裱模板的默认选中要按课程解析，见 frameResolution）。
  // 推荐课时序号 = 该班该课程已归档课次数 + 1（见 prd-lesson-intake US-403/US-404）；课题取分课时课题，取不到回落默认课题。
  const archivedLessonCount=selectedClass&&activeCourseId
    ? lessons.filter(item=>item.classId===selectedClass.id&&item.courseId===activeCourseId&&item.status==='archived').length
    : 0;
  const recommendedLessonNo=archivedLessonCount+1;
  const recommendedTopic=resolveSyllabusTopic(findCourseById(courses,activeCourseId),recommendedLessonNo);
  // ---- 课次日期与课时序号（US-404）------------------------------------------------
  // 这两项是第一步的必填项，也是下游唯一的日期来源：展签、成长档案、阶段报告都取 lessonDate。
  const todayDate=normalizeLessonDate(new Date());
  // 草稿恢复的日期照用（补录过的过去日期不能被打回今天）；没有草稿时才默认今天。
  const [lessonDate,setLessonDate]=useState(()=>String(initialDraft?.lessonDate||'')||normalizeLessonDate(new Date()));
  // 序号可以手改；手改过之后不再被推荐值顶掉（lessonNoDirty 置真），换班/换课时归零重新跟随推荐值。
  // 草稿里的序号算「老师显式定过的值」（lessonNoDirty 置真），否则会被推荐值顶掉。
  const [lessonNoInput,setLessonNoInput]=useState(()=>initialDraft?.lessonNo?String(initialDraft.lessonNo):'');
  const [lessonNoDirty,setLessonNoDirty]=useState(()=>Boolean(initialDraft?.lessonNo));
  // 未来日期（预排课）与「同日已有课次」都要二次确认；换日期或换序号后必须重新确认一次。
  const [futureDateConfirmed,setFutureDateConfirmed]=useState(false);
  const [sameDayConfirmed,setSameDayConfirmed]=useState(false);
  // 保存前的确认条（未来日期 / 同日已有课次 / 重复创建）与保存结果提示。
  const [lessonConfirm,setLessonConfirm]=useState(null);
  const [lessonSaveState,setLessonSaveState]=useState({status:'idle',message:''});
  // 已保存课次的 id：同一份草稿再次保存走更新，不会重复创建同一次课。
  // 恢复草稿时按「班级 + 日期 + 序号」从本地课次里找回它 —— 否则刷新后同一个自然键
  // 会被自己的上一条记录判成冲突（「该班该日期已有第 N 次课」），而老师其实是在改同一次课。
  const [currentLessonId,setCurrentLessonId]=useState(()=>{
    const draft=initialDraft;
    if(!draft?.classId||!draft.lessonDate||!draft.lessonNo) return '';
    const hit=lessons.find(item=>item.classId===draft.classId&&item.lessonDate===draft.lessonDate&&item.lessonNo===draft.lessonNo);
    return hit?.lessonId||'';
  });
  const lessonNoValue=Number(lessonNoInput);
  const lessonNoValid=Number.isInteger(lessonNoValue)&&lessonNoValue>0;
  const isFutureLessonDate=Boolean(lessonDate)&&lessonDate>todayDate;
  const canUpdateLesson=Boolean(currentLessonId&&lessons.some(item=>item.lessonId===currentLessonId));
  // 唯一键是 classId + lessonDate + lessonNo：同一天已有哪些序号、哪个序号被占用，都在这里现算。
  // 冲突检查要排除「正在编辑的这一条」（它自己不算撞车），但「已有第 N 次课」的提示要把该日期全部课次算进去。
  const classDateLessons=selectedClass&&lessonDate
    ? lessons.filter(item=>item.classId===selectedClass.id&&item.lessonDate===lessonDate)
    : [];
  const sameDayLessons=classDateLessons.filter(item=>item.lessonId!==currentLessonId);
  const sameDayNos=sameDayLessons.map(item=>item.lessonNo).filter(no=>no>0).sort((a,b)=>a-b);
  const sameDayAllNos=classDateLessons.map(item=>item.lessonNo).filter(no=>no>0).sort((a,b)=>a-b);
  const sameDayMaxNo=sameDayAllNos.length?Math.max(...sameDayAllNos):0;
  const sameDayNextNo=sameDayMaxNo+1;
  const lessonNoConflict=lessonNoValid
    ? sameDayLessons.find(item=>item.lessonNo===lessonNoValue)||null
    : null;
  // 课题跟随「实际填写的课时序号」取分课时课题，取不到回落到课程默认课题。
  const lessonTopic=resolveSyllabusTopic(findCourseById(courses,activeCourseId),lessonNoValue||0);
  // 展签、海报与成长档案上的日期都取课次日期（补录上节课时不能显示成今天）。
  const lessonDateDots=formatLessonDateDots(lessonDate);
  // ---- 叠加元素面板的课次上下文（US-007）-------------------------------------------
  // 「时间默认值 = 本次课次日期」（第一步的课次信息）与「落款默认值 = 当前登录老师姓名」。
  // 时间元素的 lesson 来源与 {课次日期} 变量读的就是 lessonDateDots（渲染时经 `lessonDate` 入参传入，
  // 与展签日期 `date` 现在是**同一个来源**：US-014 起展签日期也取课次日期，
  // 差别只在展签那份会被模板的 `plaque.dateFormat` 格式化）。
  const overlayLessonDate=overlayLessonDateValue(lessonDate);
  const overlaySignatureDefaultName=overlayDefaultSignatureName(currentTeacherName);
  // 面板上「渲染为 …」这一行的变量上下文（与渲染层同一份替换规则，只是提前给老师看）。
  const overlayVariableContext={orgName:DEFAULT_ORG_NAME,studentName:selectedStudentLabel==='未选择学员'?'':selectedStudentLabel,workTitle:activeFrame?.plaqueTitle||'',teacherName:currentTeacherName,lessonDate:lessonDateDots};
  // 二维码目标的占位符取值：归档流程才拿得到 shareToken，面板里没有真值时由 qrTargets.js
  // 填示例值并标「示例链接」（FR-23 的口径，面板必须显式说明）。
  const overlayQrContext={orgId:DEFAULT_ORG_ID,courseId:activeCourseId||''};
  const overlayRenderDateText=resolveOverlayDateText({element:overlayGroups.date,context:{lessonDate:lessonDateDots}});
  // 推荐值 = 该班该课程已归档课次数 + 1（US-403/US-404 的规则）；没手改过就一直跟随。
  useEffect(()=>{
    if(lessonNoDirty) return;
    setLessonNoInput(recommendedLessonNo>0?String(recommendedLessonNo):'');
  },[recommendedLessonNo,lessonNoDirty]);
  // ---- 参与学员与出席状态（US-405）------------------------------------------------
  // participants 只描述「本次课次」，缺课学员也要留在里面（成长档案需要缺课留白）。
  // 保存课次时才写进 lesson.participants，**不回写班级名单**：临时加入的插班/试听因此不污染名单。
  // 草稿恢复时直接带回上次的学员选择与出席标记（素材 id 已在草稿里清空，不会留下悬空引用）。
  const [participants,setParticipants]=useState(()=>{
    const restored=(initialDraft?.participants||[]).map(createParticipant).filter(item=>item.name);
    return restored.length?restored:rosterParticipants(classStudents);
  });
  const [temporaryName,setTemporaryName]=useState('');
  const [participantNotice,setParticipantNotice]=useState('');
  // 个人反馈只记录选中的那一位；班级反馈记录整份名单里被勾选的孩子。
  const effectiveParticipants=mode==='个人反馈'
    ? (selectedStudentName?[participants.find(item=>item.name===selectedStudentName)||createParticipant({name:selectedStudentName})]:[])
    : participants;
  const selectedParticipant=effectiveParticipants.find(item=>item.name===selectedStudentName)||null;
  const participantStats={
    roster:classStudents.length,
    present:effectiveParticipants.filter(item=>item.attendance==='present').length,
    absent:effectiveParticipants.filter(item=>item.attendance==='absent').length,
    makeup:effectiveParticipants.filter(item=>item.attendance==='makeup').length,
    temporary:effectiveParticipants.filter(item=>item.temporary).length
  };
  // ---- 家长授权状态提示（US-411）---------------------------------------------------
  // 「查看授权」是**转发给家长**的前置条件，不是录入 / 归档的前置条件：这里只提示、不拦截，
  // 也不进入 US-410 的六项前置校验。授权状态只有一份来源（data/consent.js，F-CONSENT-01），
  // 第四步转发前的硬校验（US-208 / FR-222）读的也是它。
  const [consents]=useState(()=>loadConsents());
  const [consentExpanded,setConsentExpanded]=useState(false);
  // 所选学员 = 当前模式的参与学员（个人反馈只有选中的那一位，班级反馈是勾选名单）。
  // 没有记录的学员（临时加入的试听学员）按「未完成授权」算，界面会写明「未登记授权」。
  const consentSummary=consentSummaryOf(effectiveParticipants,consents);
  // 第三步班级素材墙的展签数据：姓名/作品名/日期都来自真实绑定与课次日期（US-406a）。
  const classMosaicArtworks=withUploadPlaques(batchUploads.artwork,effectiveParticipants,{fallbackTitle:lessonTopic,fallbackDate:lessonDateDots});
  const classMosaicPhotos=withUploadPlaques(batchUploads.photo,effectiveParticipants,{fallbackTitle:lessonTopic,fallbackDate:lessonDateDots});
  // ---- 学员乘上传位（US-406b）------------------------------------------------------
  // 班级反馈：按到场学员一人一行渲染上传位，每行 1–5 幅作品。上传绑定发生在**行内**——
  // 老师在谁的格子里选的文件就是谁的作品，所以这条路不需要轮转，也不会串档（US-406a 的教训）。
  // 个人反馈沿用单一上传位（media.artwork），绑定是隐式的（等于选中的那位学员），不渲染这个列表。
  const classArtworkItems=batchUploads.artwork;
  // 渲染哪些行：到场学员都要有；另外保留「已上传过素材但被标成缺课」的学员，
  // 否则那份素材在界面上再也改不了作品名、删不掉（见 uploadSlotParticipants 的说明）。
  const artworkSlotRows=mode==='班级反馈'
    ? uploadSlotParticipants(effectiveParticipants,classArtworkItems,'artwork').map(participant=>({
      participant,
      attended:participant.attendance==='present'||participant.attendance==='makeup',
      usage:participantSlotUsage(classArtworkItems,participant,'artwork'),
      uploads:uploadsOfParticipant(classArtworkItems,participant,'artwork')
    }))
    : [];
  // 顶部「还有 N 位学员未上传作品」：只数到场学员（缺课的孩子本来就不该有作品）。
  const missingArtworkCount=participantsMissingUpload(effectiveParticipants,classArtworkItems,'artwork').length;
  // 录入节奏（US-413）：只算**到场**学员（缺课的孩子不该有作品），完成 = 这位学员已有 ≥1 幅。
  // 界面上的「已录入 N/M · 用时」就是验收里「18 位学员各 1 幅在 3 分钟内」的那个数字。
  const artworkPaceTotal=artworkSlotRows.filter(row=>row.attended).length;
  const artworkPaceDone=artworkSlotRows.filter(row=>row.attended&&row.usage.used>0).length;
  const artworkPaceText=intakePaceSummary({total:artworkPaceTotal,done:artworkPaceDone,elapsedSeconds:intakeElapsedSeconds});
  const thumbPendingText=thumbnailPendingLabel(thumbPendingCount);
  // ---- 学员课堂照片上传位（US-009）-------------------------------------------------
  // 照片与作品**分开管理**：作品必选（1–5 幅/人），照片选填（0–10 张/人）。
  // 照片额外支持「一张合影分给多位学员」：条目上带 owners 多人归属（见 data/uploadBinding 的 normalizeOwners）。
  const classPhotoItems=batchUploads.photo;
  const photoSlotRows=mode==='班级反馈'
    ? uploadSlotParticipants(effectiveParticipants,classPhotoItems,'photo').map(participant=>({
      participant,
      attended:participant.attendance==='present'||participant.attendance==='makeup',
      usage:participantSlotUsage(classPhotoItems,participant,'photo'),
      uploads:uploadsOfParticipant(classPhotoItems,participant,'photo')
    }))
    : [];
  // 「还有 N 位学员未上传课堂照片」只用于提示，照片是选填项，不参与进入下一步的校验。
  const missingPhotoCount=participantsMissingUpload(effectiveParticipants,classPhotoItems,'photo').length;
  // 没有出现在任何学员行里的照片（取消全部分配、或归属的学员已被移出名单）。
  // 这类照片不会进展签，但**必须仍然可见可处理** —— 否则它就成了界面上删不掉的幽灵素材。
  const renderedPhotoIds=new Set(photoSlotRows.flatMap(row=>row.uploads.map(item=>item.uploadId)));
  const unassignedPhotos=classPhotoItems.filter(item=>!renderedPhotoIds.has(item.uploadId));
  // 第二步/第三步按学员分组渲染照片：**没有照片的学员也在分组里**（占位），照片不会整体前移错位。
  // 分组用的是**带展签的条目**（classMosaicPhotos），而不是 batchUploads.photo 的原始条目 ——
  // 否则第三步的展签读不到 plaque，共用照片会退化成只显示第一位学员的姓名。
  const photoGroups=participantPhotoGroups(effectiveParticipants,classMosaicPhotos);
  const assigningPhoto=photoAssignId?classPhotoItems.find(item=>item.uploadId===photoAssignId)||null:null;
  // 可被分配照片的学员 = 到场学员（缺课的孩子本次不在课堂上，合影里也不该算他）。
  const photoAssignTargets=attendedParticipants(effectiveParticipants);
  // 「到场」= 出席 + 补课；只有一位到场的都没有（全部缺课/未勾选任何人）才拦住进入下一步。
  const attendedCount=participantStats.present+participantStats.makeup;
  // 换班：清空已选学员、把课程刷新回本班课程、课次上下文重置（避免跨班串档）。
  const selectClass=(classId)=>{
    const next=availableClasses.find(item=>item.id===classId)||null;
    const nextStudents=management.students.filter(item=>item.className===next?.name);
    // 换班同时换素材上下文（US-406b）：已上传的作品绑定的是上一个班的孩子，
    // 带到新班只会让展签显示别人班的孩子，所以整批清掉并明确提示老师重新上传。
    if(batchUploads.artwork.length||batchUploads.photo.length||media.artwork||media.photo){
      // 会话素材地址一并回收：换班后这些 object URL 不再有任何用途（US-408）。
      revokeMediaEntries(batchUploads.artwork);
      revokeMediaEntries(batchUploads.photo);
      revokeMediaUrl(media.artwork?.url);
      revokeMediaUrl(media.photo?.url);
      setBatchUploads({artwork:[],photo:[]});
      setMedia({artwork:null,photo:null});
      setMediaIntakeNotice('');
      // 上一幅作品的编辑状态与撤销栈跟着素材一起清掉（US-004a）：换班后是另一批孩子的新素材。
      // 未确认的编辑在这一刻被丢弃（US-005），所以提示里要说明，别让老师以为它已经生效。
      const discardedEdit=hasUnconfirmedArtworkEdit();
      closeArtworkEditor();
      setToast(`已切换班级：上一个班级的素材已清空（素材只在当次会话内有效），请在新班级重新选择原始素材。${discardedEdit?'未确认的作品编辑已一并放弃。':''}`);
    }
    setSelectedClassId(next?.id||'');
    setSelectedStudentName('');
    // 换班等于换名单：参与学员按新班级重建（默认全部出席），临时学员不跨班保留。
    setParticipants(rosterParticipants(nextStudents));
    setTemporaryName('');
    setParticipantNotice('');
    // 换班同时关掉「分给多人」面板：勾的是上一个班的学员，带过来会分配错人（US-009）。
    setPhotoAssignId('');
    setPhotoAssignSelection([]);
    setSelectedCourseId(resolveCourseId(courses,next?.course));
    setArchived(false);
    // 换班 = 换了档案上下文：上一次归档的记录 id 与写回提示都不能带过来（US-008b）。
    setCurrentRecordId('');
    // 推理轨迹同样属于上一位孩子的那次生成（US-102）：换班后归档不能把它一起交上去。
    clearReviewTrace();
    setWriteBackAttempt({status:'idle',quality:'',message:''});
    // 换班 = 换了一批孩子：批量装裱的进度 / 失败清单 / 二次确认条都作废（US-010），
    // 失败项是按上一个班的 uploadId 记的，留着只会指向不存在的素材。
    resetBatchFraming();
    setCurrentLessonId('');
    setLessonNoDirty(false);
    setFutureDateConfirmed(false);
    setSameDayConfirmed(false);
    setLessonConfirm(null);
    setLessonSaveState({status:'idle',message:''});
  };
  // 换课：课程变了课次也变了，序号回到「该班该课程」的推荐值。
  const selectCourse=(courseId)=>{
    setSelectedCourseId(courseId);
    setCurrentLessonId('');
    setLessonNoDirty(false);
    setSameDayConfirmed(false);
    setLessonConfirm(null);
    setLessonSaveState({status:'idle',message:''});
  };
  const selectClassScope=(next)=>{
    if(next===showAllClasses) return;
    setShowAllClasses(next);
    const list=next?availableClasses:myClasses;
    // 切回「我带的班」时，若当前班级不属于自己，自动落到列表里的第一个班。
    if(!list.some(item=>item.id===selectedClassId)) selectClass(list[0]?.id||'');
  };
  // 切换反馈模式：两种模式的「谁是本次参与者」来源不同（个人=选中学员，班级=勾选名单），
  // 所以临时学员输入与拦截提示都要清掉，避免把上一个模式的名单带过来。
  const selectMode=(next)=>{
    if(next===mode) return;
    setMode(next);
    setTemporaryName('');
    setParticipantNotice('');
    setPhotoAssignId('');
    setPhotoAssignSelection([]);
    // 个人 / 班级两种模式的作品位不是同一个（media.artwork ↔ 上传条目），
    // 档案上下文（记录 id 与写回提示）一并清掉，别把上一个模式的写回状态留在界面上（US-008b）。
    setCurrentRecordId('');
    // 上一次生成的轨迹属于上一个模式的那次点评（US-102），换模式即作废。
    clearReviewTrace();
    setWriteBackAttempt({status:'idle',quality:'',message:''});
    // 批量装裱是班级反馈专属的动作：切到个人反馈就把进度与失败清单清掉（US-010）。
    resetBatchFraming();
  };
  // ---- 出席名单的维护（US-405）----------------------------------------------------
  const toggleParticipant=(name)=>{
    setParticipants(current=>current.some(item=>item.name===name)
      ? current.filter(item=>item.name!==name)
      : [...current,createParticipant({name})]);
    setParticipantNotice('');
  };
  // 标记状态即视为「参与本次课次」：缺课/补课不需要先勾选再选状态。
  const setParticipantAttendance=(name,attendance)=>{
    setParticipants(current=>current.some(item=>item.name===name)
      ? current.map(item=>item.name===name?{...item,attendance}:item)
      : [...current,createParticipant({name,attendance})]);
    setParticipantNotice('');
  };
  const removeParticipant=(name)=>setParticipants(current=>current.filter(item=>item.name!==name));
  // 全选 / 反选只作用于本班名单：临时加入的学员是老师显式加的，不能被这两个按钮顺手清掉（只有「清空」会）。
  const selectAllParticipants=()=>{
    setParticipants(current=>[...rosterParticipants(classStudents,current),...current.filter(item=>item.temporary)]);
    setParticipantNotice('');
  };
  const invertParticipants=()=>{
    setParticipants(current=>{
      const kept=current.filter(item=>item.temporary);
      const inverted=rosterParticipants(classStudents,current).filter(item=>!current.some(entry=>entry.name===item.name));
      return [...inverted,...kept];
    });
    setParticipantNotice('');
  };
  const clearParticipants=()=>{setParticipants([]);setParticipantNotice('')};
  const addTemporaryParticipant=()=>{
    const name=String(temporaryName||'').trim();
    if(!name) return;
    if(participants.some(item=>item.name===name)){setToast(`「${name}」已经在本次课次的名单里了。`);return;}
    // 只进本次课次的 participants，不调用 persistStudentManagement —— 班级名单保持不变。
    setParticipants(current=>[...current,createParticipant({name,temporary:true})]);
    setTemporaryName('');
    setParticipantNotice('');
    setToast(`已把「${name}」临时加入本次课次（只写入本次课次，不回写班级名单）。`);
  };
  // 「至少一位到场学员」及其他五项前置校验统一走 data/lessonReadiness.js（US-410）：
  // go() 拦截时会把 attendance 那一条的具体原因写进 participantNotice（就地贴在这块面板上方），
  // 不再单独维护一份文案。
  const clearLessonSaveState=()=>setLessonSaveState(previous=>previous.status==='saving'?previous:{status:'idle',message:''});
  const selectLessonDate=(value)=>{
    setLessonDate(normalizeLessonDate(value));
    // 换日期等于换课次上下文：未来日期与同日课次的确认都要重来一次。
    setFutureDateConfirmed(false);
    setSameDayConfirmed(false);
    setLessonConfirm(null);
    clearLessonSaveState();
  };
  const selectLessonNo=(value)=>{
    setLessonNoInput(String(value??'').replace(/[^\d]/g,''));
    setLessonNoDirty(true);
    setSameDayConfirmed(false);
    setLessonConfirm(null);
    clearLessonSaveState();
  };
  const useRecommendedLessonNo=()=>{
    setLessonNoInput(recommendedLessonNo>0?String(recommendedLessonNo):'');
    setLessonNoDirty(false);
    setSameDayConfirmed(false);
    setLessonConfirm(null);
    clearLessonSaveState();
  };
  const useSameDayNextLessonNo=()=>selectLessonNo(String(sameDayNextNo));
  // 唯一键撞车时给出的修复动作：改成同一天的下一个序号。
  const applyConflictNextLessonNo=()=>selectLessonNo(String((lessonNoConflict?.lessonNo||0)+1));
  /**
   * 保存课次：日期与序号必填，唯一键 classId + lessonDate + lessonNo 班内唯一。
   * 未来日期与「同日已有课次」都要二次确认（futureOk / sameOk），重复创建直接拒绝并给出可读提示。
   */
  const performLessonSave=async({futureOk=false,sameOk=false}={})=>{
    if(!selectedClass){setToast('请先选择班级，再保存课次。');return;}
    if(!activeCourseId){setToast('请先选择课程，再保存课次。');return;}
    if(!lessonDate){setToast('课次日期为必填项，请先选择日期。');return;}
    if(!lessonNoValid){setToast('课时序号为必填正整数，请填写后再保存。');return;}
    if(lessonNoConflict){
      const message=`该班 ${lessonDate} 已有第 ${lessonNoConflict.lessonNo} 次课，请修改课时序号后再保存。`;
      setLessonConfirm({kind:'conflict',message,action:`改为第 ${lessonNoConflict.lessonNo+1} 次课`});
      setLessonSaveState({status:'error',message});
      return;
    }
    if(!futureOk&&isFutureLessonDate){
      setLessonConfirm({kind:'future',message:`课次日期 ${lessonDate} 在今天（${todayDate}）之后，确认按未来日期创建课次？`,action:'确认使用未来日期'});
      return;
    }
    if(!sameOk&&sameDayNos.length){
      setLessonConfirm({kind:'same-day',message:`该班该日期已有第 ${sameDayNos.join('、')} 次课，是否创建第 ${lessonNoValue} 次课？`,action:`确认创建第 ${lessonNoValue} 次课`});
      return;
    }
    setLessonConfirm(null);
    setLessonSaveState({status:'saving',message:'正在保存课次…'});
    const patch={classId:selectedClass.id,courseId:activeCourseId,lessonDate,lessonNo:lessonNoValue,topic:lessonTopic||'',teacherId:selectedClass.teacher||currentTeacherName,participants:effectiveParticipants};
    const settleSaved=(lesson)=>{
      setLessons(list=>mergeLessons([lesson],list));
      setCurrentLessonId(lesson.lessonId);
      setLessonNoInput(String(lesson.lessonNo));
      // 显式保存过的序号必须留住，不能再被推荐值顶掉；同一天已有课次的确认也不再重复问。
      setLessonNoDirty(true);
      setSameDayConfirmed(true);
    };
    try{
      // 注意：createLesson / updateLesson 是「先写本地镜像再推云端」，云端不通时**会抛错**，
      // 所以收尾逻辑不能只写在 await 之后，catch 里必须按唯一键把本地镜像找回来。
      const saved=canUpdateLesson
        ? await updateLesson(currentLessonId,patch,{existingLessons:lessons})
        : await createLesson(patch,{existingLessons:lessons});
      settleSaved(saved);
      setLessonSaveState({status:'saved',message:`已保存：第 ${saved.lessonNo} 次课 · ${saved.lessonDate}`});
      setToast(`课次已保存：第 ${saved.lessonNo} 次课 · ${saved.lessonDate}`);
    }catch{
      // 云端失败时本地镜像里已经有这条课次（saveLesson 先落本地再推云端）：
      // 按唯一键读回来并进 state，否则下一次 persistLessons 会用旧列表覆盖镜像（US-003 的教训），
      // 而且下次保存会因为拿不到 lessonId 而重复创建同一次课。
      const mirrored=loadLessons();
      setLessons(list=>mergeLessons(mirrored,list));
      const persisted=mirrored.find(item=>item.classId===patch.classId&&item.lessonDate===patch.lessonDate&&item.lessonNo===patch.lessonNo);
      if(persisted) settleSaved(persisted);
      // 提示只讲老师能做的事，不暴露云端原始报错（沿用 US-003 的文案口径）。
      setLessonSaveState({status:'error',message:'课次已保存在本机，云端未同步；稍后可再次点击「保存课次」重试。'});
      setToast('课次已保存在本机，云端未同步，稍后可重试。');
    }
  };
  const requestLessonSave=()=>performLessonSave({futureOk:futureDateConfirmed,sameOk:sameDayConfirmed});
  const confirmLessonAction=()=>{
    if(!lessonConfirm) return;
    if(lessonConfirm.kind==='conflict'){applyConflictNextLessonNo();return;}
    if(lessonConfirm.kind==='future') setFutureDateConfirmed(true);
    if(lessonConfirm.kind==='same-day') setSameDayConfirmed(true);
    // 未来日期与同日课次可能同时挂着：确认一个之后继续检查另一个。
    performLessonSave({
      futureOk:lessonConfirm.kind==='future'?true:futureDateConfirmed,
      sameOk:lessonConfirm.kind==='same-day'?true:sameDayConfirmed
    });
  };
  // ---- 草稿持久化（US-409）--------------------------------------------------------
  // 只落元数据：课次信息（班级 / 课程 / 日期 / 序号 / 课题）+ 学员选择 + 学员作品名 + 步骤。
  // 图片本体 / object URL / base64 没有任何入口：`buildFeedbackDraft` 只复制已知的标量字段，
  // `persistFeedbackDraft` 再用 containsMediaPayload 兜底。会话素材痕迹另存一条键（见下）。
  const draftSnapshot=buildFeedbackDraft({
    step,
    classId:selectedClass?.id||'',
    courseId:activeCourseId,
    lessonDate,
    lessonNo:lessonNoValue,
    topic:lessonTopic,
    participants:effectiveParticipants,
    artworkTitles:classArtworkItems.map(item=>({studentId:item.studentId,studentName:item.studentName,title:item.title}))
  });
  // 快照是确定性的（savedAt 由落盘时打），所以可以序列化成依赖键，避免每次渲染都写 localStorage。
  const draftSnapshotKey=JSON.stringify(draftSnapshot);
  // 只有「确实有值得恢复的内容」才写草稿：什么都还没动的初始态不落盘，
  // 于是「新建草稿」之后 localStorage 里是真的干净（而不是又存了一份初始值）。
  const draftHasContent=step>1
    ||Boolean(currentLessonId)
    ||lessonNoDirty
    ||lessonDate!==todayDate
    ||selectedClassId!==defaultClassId
    ||participantSignature(participants)!==participantSignature(rosterParticipants(classStudents))
    ||classArtworkItems.length>0
    ||classPhotoItems.length>0
    ||Boolean(media.artwork||media.photo);
  useEffect(()=>{
    if(draftHasContent){persistFeedbackDraft(draftSnapshot);return}
    // 恢复出来的内容与初始态一模一样（例如只上传过素材）→ 没有可恢复的东西，顺手清掉草稿。
    if(initialDraft) clearFeedbackDraft();
  },[draftSnapshotKey,draftHasContent]);
  // 会话素材痕迹与草稿分开存：草稿里不允许出现任何素材字段，这条记录只用来判断
  // 「上次选过素材、这次会话里没有 → 刷新后失效了」。瘦身收敛点仍是 buildSessionMediaDraft 一处。
  useEffect(()=>{persistSessionMediaSnapshot(buildSessionMediaDraft(media))},[media]);
  useEffect(()=>{window.dispatchEvent(new CustomEvent('xinlehui-feedback-step',{detail:step}))},[step]);
  useEffect(()=>{window.__xinlehuiFeedbackMode=mode;window.dispatchEvent(new CustomEvent('xinlehui-feedback-mode',{detail:mode}))},[mode]);
  // 观察词变化不改写 reviewGenerated：正文是老师自己的判断结果，
  // 改词只提示「建议重新生成」，是否重新生成由老师决定（归档不被硬挡）。
  useEffect(()=>{
    const handleKeywords=(event)=>{setKeywords(event.detail);setKeywordDirty(true)};
    window.addEventListener('xinlehui-review-keywords',handleKeywords);
    return()=>window.removeEventListener('xinlehui-review-keywords',handleKeywords);
  },[]);
  // 点评不再自动触发：云端视觉点评单次约 20 秒且会消耗额度，改由老师点击「开始生成点评」。
  // 生成入口是下面的 startCloudReview，过程与结果通过 reviewStream 流式呈现。
  // 画心提取与装裱拆成两段，原因是它们的触发条件不同：
  //   - 提取很贵（几百毫秒的逐像素扫描），只在作品或方向变化时重跑一次；
  //   - 装裱很便宜（一次 canvas 合成），换一个装裱方案、换一个学员就要立刻重画。
  // 旧实现把两件事捆在一个 effect 里，导致「切换装裱方案」既不重画、也没人渲染结果。
  // 展签日期（[第二步到第一步联通] US-014）：**值**只来自第一步的课次日期 `lesson.lessonDate`
  // （派生值 `lessonDateDots`），模板只提供「格式」（`plaque.dateFormat`）与「位置」（`plaque.position`）。
  // 这里不再有 `new Date()` 兜底 —— 课次日期为空时干脆不印日期行，而不是编一个归档当天。
  const plaqueDateFormat=frameSpecRenderView(effectiveFrameSpec).plaqueDateFormat;
  const plaqueDateText=formatOverlayDate(lessonDateDots,plaqueDateFormat);
  const framePlaque=()=>({
    // 渲染用的 spec = 模板 spec + 本次微调（US-006）。没有微调时它原样等于模板 spec。
    spec:effectiveFrameSpec,
    student:activeFrame?.plaqueStudent||selectedStudentLabel||'',
    title:activeFrame?.plaqueTitle||'',
    // 展签日期 = 本次课次日期（`lesson.lessonDate`）—— 唯一来源，**没有系统当天兜底**
    // （FR-448）。模板只决定「怎么写」：格式 `plaque.dateFormat`、位置 `plaque.position`。
    // 补录上周的课次时，展签上写的就是那一天，而不是归档当天。
    date:plaqueDateText
  });
  // 第一段：按 artworkEdit 的旋转角先生成「旋转稿」，再得到只有作品本身的「画心」（cleanUrl）。
  // 旋转放在裁剪**之前**：老师把作品摆正之后，裁出来的才是一张正着的画心；原图始终单独保留、只读。
  // 画心分两条路径（US-004b）：老师手动裁剪过（artworkEdit.crop 非空）就用他画的框直接裁；
  // 没裁剪过才跑系统识别（纸边自动裁剪）。识别到的框会记在 cleanCropRect 上 —— 老师打开编辑器时
  // 裁剪框以它为初始位置，否则「系统已经裁过」这件事在界面上看不见，第一次拖动画面就会跳。
  // 缩放/平移（US-004c）作用在**裁剪窗口**里：手动裁剪时窗口就是他画的框；系统识别那条路径上，
  // 窗口就是识别出来的框（所以先把识别结果裁出来，再在它上面按同一份几何做缩放平移 —— 编辑器里
  // 舞台显示的正是「整幅画面 + 识别框作为裁剪框」，两边看到的是同一件事）。
  // 缓存判据带上 artworkEdit 的快照键（cleanEditKey）：旋转角 / 裁剪框 / 缩放平移变了就必须重算。
  useEffect(()=>{
    if(step!==2||!media.artwork?.id||!media.artwork?.processingRequested) return;
    if(isCleanArtworkReady(media.artwork)&&media.artwork?.cleanEditKey===artworkEditKey) return;
    let cancelled=false;
    setFramingState('processing');
    const edit=normalizeArtworkEdit(media.artwork.artworkEdit);
    const viewEdit={zoom:edit.zoom,offsetX:edit.offsetX,offsetY:edit.offsetY};
    const viewIsIdentity=edit.zoom===1&&edit.offsetX===0&&edit.offsetY===0;
    (async()=>{
      // 旋转角为 0 且不限尺寸时 renderArtworkRotation 原样返回原图地址（不重新编码），所以老流程逐字节不变。
      const orientedUrl=await renderArtworkRotation({source:media.artwork.originalUrl,rotation:edit.rotateDeg});
      if(edit.crop){
        const manual=await renderArtworkCrop({source:orientedUrl,crop:edit.crop,...viewEdit});
        return {orientedUrl,cleanUrl:manual.url,cleanAlgorithm:ARTWORK_MANUAL_CROP_ALGORITHM,cleanCropRect:manual.crop};
      }
      const auto=await extractArtworkSurfaceDetails({source:orientedUrl,rotation:0});
      if(!viewIsIdentity){
        // 识别结果就是「裁剪窗口」：在它上面套同一份缩放/平移几何（窗口 = 整幅，偏移口径一致）。
        const zoomed=await renderArtworkCrop({source:auto.url,crop:{x:0,y:0,w:1,h:1},...viewEdit});
        return {orientedUrl,cleanUrl:zoomed.url,cleanAlgorithm:ARTWORK_MANUAL_CROP_ALGORITHM,cleanCropRect:auto.crop};
      }
      return {orientedUrl,cleanUrl:auto.url,cleanAlgorithm:ARTWORK_CLEAN_ALGORITHM,cleanCropRect:auto.crop};
    })().then(({orientedUrl,cleanUrl,cleanAlgorithm,cleanCropRect})=>{
      if(cancelled||!cleanUrl) return;
      // 原图、旋转稿和画心永远分开保存，任何结果都不能覆盖原图地址（US-005 的四层地址保护：
      // applyArtworkLayerPatch 只接受派生层字段，originalUrl 的写入会被拒绝并回报 blocked）。
      setMedia(current=>({...current,artwork:applyArtworkLayerPatch(current.artwork,{orientedUrl,cleanUrl,cleanAlgorithm,cleanCropRect,cleanEditKey:artworkEditKey,framedUrl:null,framedStyle:''}).artwork}));
    }).catch(()=>{if(!cancelled) setFramingState('error')});
    return()=>{cancelled=true};
  },[step,media.artwork?.id,media.artwork?.processingRequested,artworkEditKey,media.artwork?.cleanUrl,media.artwork?.cleanAlgorithm,media.artwork?.cleanEditKey]);
  // 第二段：把画心按当前装裱方案（云端预设 / 大模型生成的参数）合成成完整的装裱图。
  // 结果存进 framedUrl，step 2 的预览与 step 3 的展陈都直接读它 —— 这就是「框实时渲染到作品上」。
  // 缓存键里的 spec 部分取 `frameSpecRenderKey`（= JSON.stringify(frameSpecRenderView)）而不是模板 id：
  // 「样式微调」（US-006）改的是 spec、不改 id，用 id 当键会让微调之后不再重渲染（画面永远慢一拍）。
  const activeFrameSpecKey=frameSpecRenderKey(effectiveFrameSpec);
  useEffect(()=>{
    if(step!==2||!media.artwork?.cleanUrl||!ARTWORK_CLEAN_ALGORITHMS.includes(media.artwork?.cleanAlgorithm)) return;
    const plaque=framePlaque();
    // 叠加元素的变量上下文（US-003a）：机构名与老师姓名是会话常量，学员名/作品名/课次日期来自展签。
    // 它们会影响renderFramedArtwork的输出，所以必须一起进framedStyle缓存键，否则换学员不会重渲染。
    // US-007 起 `lessonDate`（本次课次日期）是时间元素 lesson 来源的正身，同样进键 ——
    // 少一项的后果是「改了课次日期，成品图上的时间还是旧的那一天」。
    const styleKey=JSON.stringify([activeFrameSpecKey,plaque.student,plaque.title,plaque.date,lessonDateDots,currentTeacherName,DEFAULT_ORG_NAME]);
    if(media.artwork?.framedStyle===styleKey&&media.artwork?.framedUrl) return;
    let cancelled=false;
    // 1800px 合成耗时（US-012 的「桌面不超过 800ms、手机不超过 1.5 秒」）：量的是这一段
    // `renderFramedArtwork` 的实耗时（含底图解码 + 1800×1360 合成 + JPEG 编码），结论由数据层按设备口径判。
    const composeStarted=typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():Date.now();
    renderFramedArtwork({
      source:media.artwork.cleanUrl,
      spec:plaque.spec,
      student:plaque.student,
      title:plaque.title,
      date:plaque.date,
      lessonDate:lessonDateDots,
      rotation:0,
      orgName:DEFAULT_ORG_NAME,
      teacherName:currentTeacherName
    }).then(framedUrl=>{
      if(cancelled) return;
      const composeMs=(typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():Date.now())-composeStarted;
      setComposePerf({ms:composeMs,at:Date.now()});
      setMedia(current=>({...current,artwork:applyArtworkLayerPatch(current.artwork,{framedUrl,framedStyle:styleKey}).artwork}));
      setFramingState('ready');
    }).catch(()=>{if(!cancelled) setFramingState('error')});
    return()=>{cancelled=true};
  },[step,media.artwork?.cleanUrl,media.artwork?.cleanAlgorithm,media.artwork?.framedStyle,media.artwork?.framedUrl,activeFrameSpecKey,selectedStudentLabel,currentTeacherName,lessonDateDots]);
  // ---- 相框样式缩略图（US-006）-----------------------------------------------------
  // 「缩略图用当前作品实时渲染」：个人反馈用画心（裁剪稿）当作品底图；班级反馈没有单幅「当前作品」，
  // 退化为**本班第一幅已上传作品**。
  // US-010 修掉一个隐蔽的口径错误：班级反馈的上传路径也会写 `media.artwork`（`readFile` 的本地预览），
  // 于是原来那句 `frameThumbRefMedia = media.artwork?null:…` 在班级反馈下**永远拿到 null**，
  // 缩略图 / 水印预览 / 保存图片的姓名与作品名会退化成模板上的展签占位（而不是这一幅的学员）。
  // 判据改成**按反馈模式**取，而不是按 `media.artwork` 存不存在：
  //   班级反馈 = 第一幅已上传条目（底图 / 学员 / 作品名 / 旋转都取它）；
  //   个人反馈 = 当前画心。
  const classFramedEntry=batchUploads.artwork[0]||null;
  const frameThumbRefMedia=mode==='班级反馈'?classFramedEntry:null;
  const frameThumbSource=mode==='班级反馈'
    ?(classFramedEntry?.url||'')
    :(media.artwork?.cleanUrl||media.artwork?.orientedUrl||media.artwork?.originalUrl||'');
  const thumbPlaque=framePlaque();
  const frameThumbStudent=frameThumbRefMedia?(frameThumbRefMedia.studentName||frameThumbRefMedia.owners?.[0]?.studentName||''):thumbPlaque.student;
  const frameThumbTitle=frameThumbRefMedia?(frameThumbRefMedia.title||''):thumbPlaque.title;
  const frameThumbDate=thumbPlaque.date;
  // 计划键：哪些样式、各自的 spec 是什么（模板或模板+微调）。它一变就要重算缩略图。
  const frameThumbPlanKey=JSON.stringify(enabledFrames.map(item=>[item.id,frameSpecRenderKey(item.spec||DEFAULT_FRAME_SPEC)]));
  useEffect(()=>{
    if(step!==2||!frameThumbSource||artworkEditor.open) return undefined;
    let cancelled=false;
    const ref={student:frameThumbStudent,title:frameThumbTitle,date:frameThumbDate};
    const jobs=enabledFrames.map(preset=>{
      // 当前选中的那一套用「模板 + 本次微调」，其余用模板本身 —— 老师调完立刻能在卡片上看到结果。
      const spec=applyFrameStyleTweaks(preset.spec||DEFAULT_FRAME_SPEC,preset.id===activeFrameId?frameTweaks:{});
      return {id:preset.id,spec,key:frameThumbnailKey({spec,source:frameThumbSource,...ref,orgName:DEFAULT_ORG_NAME,teacherName:currentTeacherName})};
    });
    // 串行渲染：一次只合成一张（单张就是一次 1800×1360 的合成），渲染完一张就把这一张换成小图，
    // 其余卡片保持「实时渲染中」。渲染失败的那张不写缓存、退回 CSS 预览，不影响其它样式与主装裱流程。
    (async()=>{
      for(const job of jobs){
        if(cancelled) return;
        const cached=frameThumbCacheRef.current.get(job.key);
        if(cached){setFrameThumbs(current=>current[job.id]===cached?current:{...current,[job.id]:cached});continue}
        try{
          const url=await renderFrameStyleThumbnail({source:frameThumbSource,spec:job.spec,...ref,orgName:DEFAULT_ORG_NAME,teacherName:currentTeacherName});
          if(cancelled) return;
          if(frameThumbCacheRef.current.size<FRAME_THUMB_CACHE_LIMIT) frameThumbCacheRef.current.set(job.key,url);
          setFrameThumbs(current=>current[job.id]===url?current:{...current,[job.id]:url});
        }catch{/* 这一张渲染失败：保持 CSS 预览 */ }
      }
    })();
    return ()=>{cancelled=true};
  },[step,frameThumbSource,frameThumbPlanKey,frameTweaksKey,activeFrameId,frameThumbStudent,frameThumbTitle,frameThumbDate,currentTeacherName,artworkEditor.open]);
  // 切换款式：换 id 并把本次微调清掉（微调属于「那一套」的调整，带到下一套只会让人以为模板坏了）。
  // 这是老师**手动**的选择：记下来，不再被「按课程绑定的默认模板」顶掉。
  const selectFrameStyle=(id)=>{
    if(id===activeFrameId) return;
    if(frameTweakCount){setFrameTweaks(normalizeFrameStyleTweaks(null));setToast('已切换款式，本次微调已重置')}
    setFrame(id);
    setFramePickedManually(true);
  };
  const setFrameTweak=(patch)=>setFrameTweaks(current=>normalizeFrameStyleTweaks({...normalizeFrameStyleTweaks(current),...patch}));
  const resetFrameTweaks=()=>{
    if(!frameTweakCount) return;
    setFrameTweaks(normalizeFrameStyleTweaks(null));
    setToast('已重置相框微调，回到模板本身的样式');
  };
  // ---- 我的模板：另存为 / 重命名 / 删除（US-009）------------------------------------
  // 保存的是**老师此刻看到的那份样式**：spec 从 `frameSpecRenderView(effectiveFrameSpec)` 构造，
  // 因而相框 / 卡纸 / 水印 / 落款 / 时间规则全在里面，而单幅作品的 artworkEdit（旋转 / 裁剪 / 缩放）
  // 结构上不可能进去（渲染视图里没有 art 分组）。
  const saveAsMyTemplate=async()=>{
    if(myTemplateSaving) return;
    const problem=framingPresetNameIssue(myTemplateForm.name,framingPresets);
    if(problem){setMyTemplateNotice(problem);setToast(problem);return}
    const spec=framePresetSpecFromRenderView(frameSpecRenderView(effectiveFrameSpec));
    const preset=buildTeacherFramingPreset({name:myTemplateForm.name,description:myTemplateForm.description,spec,viewer:teacherFrameViewer});
    // [US-013] 写权限先判：个人模板只允许本人写（buildTeacherFramingPreset 落的就是本人 ownerKey，
    // 所以这条路正常都能过；判定留在前面是为了「老师端不会把越权 payload 发出去」这条不变量）。
    const writeIssue=framingPresetWriteIssue(preset,teacherFrameViewer);
    if(writeIssue){
      auditTeacherEntry({action:AUDIT_ACTIONS.templateWriteDenied,templateId:preset.id,templateName:preset.name,scope:preset.scope,outcome:'denied',detail:`另存为我的模板被拒绝：${writeIssue}`});
      setMyTemplateNotice(framingWriteDeniedMessage(preset,teacherFrameViewer));
      setToast(framingWriteDeniedMessage(preset,teacherFrameViewer));
      return;
    }
    // 先落进受控列表（本地镜像由 main.jsx 的 persistFramingPresets effect 负责），云端不通时 catch 里保留。
    setFramingPresets([...framingPresets,preset]);
    // 保存后直接选用这一套，并把「本次微调」清掉：微调已经并进模板 spec，留着只会让面板显示「已微调」
    // （像素不变 —— 新模板的 spec 就是从当前渲染视图构造的，两条路径渲染结果一致）。
    setFrameTweaks(normalizeFrameStyleTweaks(null));
    setOverlayTweaks(normalizeOverlayTweaks(null));
    setFrame(preset.id);
    setFramePickedManually(true);
    setMyTemplateForm({name:'',description:''});
    setMyTemplateNotice(`已保存我的模板「${preset.name}」：含 ${framePresetSpecGroupLabels(spec).join(' · ')}，不含对单幅作品的旋转与裁剪。`);
    // [US-013] 审计日志（第 5 条）：另存为我的模板 → 操作人 / 时间 / 模板 id（这条路没有学员）。
    const audit=auditTeacherEntry({
      action:AUDIT_ACTIONS.templateSave,
      templateId:preset.id,
      templateName:preset.name,
      scope:preset.scope,
      detail:`另存为我的模板（含 ${framePresetSpecGroupLabels(spec).join(' · ')}）`
    });
    setMyTemplateSaving(true);
    try{ await writeTeacherPreset(preset,{action:'另存为我的模板'}); setToast(`我的模板「${preset.name}」已保存，下次进入可直接选用`); }
    catch{ setToast(`已保存到本机；云端暂未连通，稍后可重试（审计已记录 ${audit.id}）。`); }
    finally{ setMyTemplateSaving(false); }
  };
  const startRenamePreset=(preset)=>{
    if(!framePresetEditableBy(preset,teacherFrameViewer)){setToast('系统与机构模板由管理员维护，老师端不能重命名');return}
    setMyTemplateNotice('');
    setRenamingPresetId(preset.id);
    setRenamePresetValue(preset.name||'');
  };
  const commitRenamePreset=async(preset)=>{
    if(!framePresetEditableBy(preset,teacherFrameViewer)){setToast('系统与机构模板由管理员维护，老师端不能重命名');return}
    const problem=framingPresetNameIssue(renamePresetValue,framingPresets,{exceptId:preset.id});
    if(problem){setMyTemplateNotice(problem);setToast(problem);return}
    const next=renameFramingPreset(preset,renamePresetValue);
    setFramingPresets(framingPresets.map(item=>item.id===next.id?next:item));
    setRenamingPresetId('');
    setMyTemplateNotice(`已把我的模板重命名为「${next.name}」；模板 id 与参数都没变，已产出的成品图不受影响。`);
    try{ await writeTeacherPreset(next,{action:'重命名我的模板'}); setToast(`我的模板已重命名为「${next.name}」`); }
    catch{ setToast('已在本机重命名；云端暂未同步。'); }
  };
  const removeMyPreset=async(preset)=>{
    if(!framePresetEditableBy(preset,teacherFrameViewer)){setToast('系统与机构模板由管理员维护，老师端不能删除');return}
    // 删除只从可选列表里移除：成品图是保存 / 归档时写下的独立副本，模板没了也不会改动它。
    setFramingPresets(framingPresets.filter(item=>item.id!==preset.id));
    if(renamingPresetId===preset.id) setRenamingPresetId('');
    if(activeFrameId===preset.id){setFrame('');setFramePickedManually(false)}
    setMyTemplateNotice(`已删除我的模板「${preset.name}」。${FRAMING_PRESET_DELETE_NOTE}`);
    try{ await deleteRemoteFramingPreset(preset,teacherFrameViewer); setToast(`已删除我的模板「${preset.name}」`); }
    catch{ setToast('已从本机删除；云端删除未成功。'); }
  };
  // ---- 水印 · 落款 · 时间面板（US-007）的写入与素材上传 -----------------------------
  // 三区各自的写入都走同一条路：先把「当前分组」（模板 + 本次改动收敛后的值）复制一份，
  // 再把这次改的字段并进去 —— 于是「只改位置」不会把同组其它字段掉回默认值。
  const applyWatermarkTweak=(kind,patch)=>setOverlayTweaks(current=>{
    const next=normalizeOverlayTweaks(current);
    next.watermark[kind]={...next.watermark[kind],...patch};
    return next;
  });
  const applySignatureTweak=(patch,sealPatch)=>setOverlayTweaks(current=>{
    const next=normalizeOverlayTweaks(current);
    const merged={...next.signature,...patch};
    if(sealPatch) merged.seal={...(next.signature.seal||{}),...sealPatch};
    next.signature=merged;
    return next;
  });
  const applyDateTweak=(patch)=>setOverlayTweaks(current=>{
    const next=normalizeOverlayTweaks(current);
    next.date={...next.date,...patch};
    return next;
  });
  const resetOverlayTweaks=()=>{
    if(!overlayTweakCountValue) return;
    setOverlayTweaks(normalizeOverlayTweaks(null));
    setOverlayAssetError({kind:'',message:''});
    setToast('已恢复模板本身的叠加元素设置');
  };
  // 五支叠加元素的描述表：控件只认它（label / 收敛后的现值 / 本次改过的原值 / 写入函数）。
  // 「本次改过的原值优先于收敛值」是**受控输入框的硬要求**：只显示收敛值会让数字框没法正常输入
  // （沿 US-003b 后台面板的口径）；这里多数控件是「档」按钮与下拉，取原值只是为了让读文案与断言一致。
  const overlayRawValue=(tweak,field,fallback)=>tweak&&tweak[field]!==undefined?tweak[field]:fallback;
  const overlayElementCards=[
    {section:'watermark',kind:'logo',label:'机构 Logo',group:overlayGroups.watermark.logo,
      patch:patch=>applyWatermarkTweak('logo',patch),tweak:overlayTweaks.watermark.logo},
    {section:'watermark',kind:'text',label:'文字水印',group:overlayGroups.watermark.text,
      patch:patch=>applyWatermarkTweak('text',patch),tweak:overlayTweaks.watermark.text},
    {section:'watermark',kind:'qr',label:'二维码',group:overlayGroups.watermark.qr,
      patch:patch=>applyWatermarkTweak('qr',patch),tweak:overlayTweaks.watermark.qr},
    {section:'signature',kind:'signature',label:'落款',group:overlayGroups.signature,
      patch:patch=>applySignatureTweak(patch),tweak:overlayTweaks.signature},
    {section:'date',kind:'date',label:'时间',group:overlayGroups.date,
      patch:patch=>applyDateTweak(patch),tweak:overlayTweaks.date}
  ];
  const overlayCardOf=(kind)=>overlayElementCards.find(item=>item.kind===kind);
  // 点击格子即定位：元素当前关着、但开启后确实画得出来（有 Logo / 有内容）时，顺手把它打开 ——
  // 「点完格子什么都没变」比「多开了一盏灯」更像是坏掉了（画不出来的情况仍只定位不开启，并给出原因）。
  const selectOverlayPosition=(card,position)=>{
    const next={...card.group,position};
    card.patch(card.group.visible!==true&&overlayElementCanDraw(card.kind,next)?{position,visible:true}:{position});
  };
  // 上传准入与后台完全同一套（PNG/JPG、≤512×512、≤200KB，超限给出可读文案）：规则在 data 层，
  // 这里只做「读文件 → 校验 → 写进 spec」的编排。机构 Logo / 手写签名图是机构与老师自己的资产，
  // 不受「儿童素材不进浏览器存储」那条限制（那条只管课上拍的儿童作品与照片）。
  const uploadOverlayAsset=async(kind,file)=>{
    if(!file) return;
    setOverlayAssetBusy(kind);
    setOverlayAssetError({kind:'',message:''});
    try{
      const result=await readFramingAsset(file);
      if(!result.ok){setOverlayAssetError({kind,message:result.message});setToast(result.message);return}
      if(kind==='logo') applyWatermarkTweak('logo',{url:result.asset.url,visible:true});
      else applySignatureTweak({mode:'image',imageUrl:result.asset.url,visible:true});
      setToast(`已上传${kind==='logo'?'机构 Logo':'手写签名图'}（${framingAssetSummary(result.asset)}），右侧成品预览已更新`);
    }finally{setOverlayAssetBusy('')}
  };
  const removeOverlayAsset=(kind)=>{
    setOverlayAssetError({kind:'',message:''});
    if(kind==='logo') applyWatermarkTweak('logo',{url:'',visible:false});
    else applySignatureTweak({mode:'text',imageUrl:''});
    setToast(kind==='logo'?'已移除机构 Logo':'已移除手写签名图，落款回到文字模式');
  };
  // 时间来源切到「手动填写」时，手填值默认就是本次课次日期（换来源不丢上下文）；清空则交回老师。
  const changeDateSource=(source)=>applyDateTweak(source==='manual'
    ?{source,manualValue:overlayRawValue(overlayTweaks.date,'manualValue',overlayGroups.date.manualValue)||overlayLessonDate}
    :{source});
  // 手填日期的输入框是 <input type=date>（只认 YYYY-MM-DD）；spec 里允许写 2026.08.04 这种口径，
  // 也允许「上周三」这类人类说法（渲染层原样输出）。认不出的值这里显示为空 —— 但「渲染为 …」那一行
  // 会如实显示真正画上去的文字，老师不会以为它丢了。
  const manualDateInputValue=(value)=>{
    const normalized=String(value??'').trim().replace(/[/.]/g,'-');
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized)?normalized:'';
  };
  // 「渲染为 …」：文字类元素用**与绘制层同一个**变量替换 / 时间解析函数，二维码用目标解析（FR-23）。
  const overlayRenderTextOf=(template)=>applyOverlayVariables(template||'',overlayVariableContext).text;
  const overlayDateRenderText=overlayRenderDateText?overlayRenderDateText.text:'';
  // 成品预览跟着**当前模式的对象**走：
  //   - 个人反馈：`media.artwork.framedUrl` —— 就是右侧作品区那张成品图（同一条渲染流水线，零额外开销）；
  //   - 班级反馈：没有单幅「当前作品」，退化为第一幅已上传作品的实时渲染（与 US-006 的缩略图同一口径、
  //     同一个缓存键函数 / 同一个缓存）。个人模式留下的 media 不会串到班级模式 —— 预览看的是本模式的对象。
  const overlayUsesClassPreview=mode!=='个人反馈';
  const overlayPreviewSource=overlayUsesClassPreview?(batchUploads.artwork[0]?.url||''):(media.artwork?.cleanUrl||'');
  const overlayPreviewRef={student:frameThumbStudent,title:frameThumbTitle,date:frameThumbDate,lessonDate:lessonDateDots};
  const overlayPreviewKey=overlayPreviewSource
    ?frameThumbnailKey({spec:effectiveFrameSpec,source:overlayPreviewSource,...overlayPreviewRef,orgName:DEFAULT_ORG_NAME,teacherName:currentTeacherName})
    :'';
  useEffect(()=>{
    if(step!==2||!overlayUsesClassPreview||!overlayPreviewSource||artworkEditor.open||!overlayPreviewKey) return undefined;
    let cancelled=false;
    const cached=frameThumbCacheRef.current.get(overlayPreviewKey);
    if(cached){setOverlayPreview(cached);setOverlayPreviewError('');return undefined}
    (async()=>{
      try{
        const url=await renderFrameStyleThumbnail({source:overlayPreviewSource,spec:effectiveFrameSpec,...overlayPreviewRef,orgName:DEFAULT_ORG_NAME,teacherName:currentTeacherName,maxEdge:FRAME_PREVIEW_LONG_EDGE});
        if(cancelled) return;
        if(frameThumbCacheRef.current.size<FRAME_THUMB_CACHE_LIMIT) frameThumbCacheRef.current.set(overlayPreviewKey,url);
        setOverlayPreview(url);
        setOverlayPreviewError('');
      }catch(error){if(!cancelled) setOverlayPreviewError(String(error?.message||'预览暂时渲染不出来'))}
    })();
    return ()=>{cancelled=true};
  },[step,overlayUsesClassPreview,overlayPreviewSource,overlayPreviewKey,artworkEditor.open]);
  // 预览状态：个人模式看成品图（framedUrl → 已就绪，只有画心 → 正在装裱），班级模式看上面那张实时渲染的进展。
  // 失败要显式（沿 US-006 缩略图的教训）：面板上要说一句，老师才知道是预览坏了而不是自己没设置。
  const overlayPreviewState=overlayUsesClassPreview
    ?(overlayPreview?'ready':(overlayPreviewError?'error':(overlayPreviewKey?'pending':'idle')))
    :(media.artwork?.framedUrl?'ready':(media.artwork?.cleanUrl?'pending':'idle'));
  // 编辑态的实时预览（US-004a）：只画「旋转稿」，低分辨率画布（长边 ≤ EDIT_PREVIEW_MAX_EDGE）才跟手；
  // 编辑期间**不跑**上面那两段重活（裁剪 + 装裱），确认后再跑一次 —— 于是每按一下微调不会重扫一遍像素。
  // 120ms 的合并窗口是为了连点：同一帧内的多次点击只画最后一张。
  // 依赖只有**旋转角**（不是整份草稿）：US-004b 拖动裁剪框时草稿一直在变，但旋转稿没有变化，
  // 若跟着整份快照键重画，每移动一格都会重编码一张 900px 的图（裁剪框会拖得一顿一顿）。
  const editorRotationKey=normalizeArtworkEdit(artworkEditor.draft).rotateDeg;
  // ---- 装裱移动端与性能（US-012）------------------------------------------------------
  // 设备口径**每次渲染现算**（纯函数、零成本）：抽屉断点本来就是视口口径（CSS 媒体查询），
  // 预算必须跟着同一个口径切档，否则会出现「抽屉已经切到手机、合成预算还按桌面 800ms 算」的错位。
  // React 不会因为 resize 自己重渲染，所以再把「口径变了」这件事接成一次 state 变化：
  // 值相同的时候 setState 会被 React 直接跳过（一次多余渲染都不会有），只有真的切了档才重渲染一次。
  const [deviceSignature,setDeviceSignature]=useState('');
  useEffect(()=>{
    const sync=()=>{
      const next=framingDeviceProfile({
        userAgent:typeof navigator==='undefined'?'':navigator.userAgent,
        maxTouchPoints:typeof navigator==='undefined'?0:navigator.maxTouchPoints,
        viewportWidth:typeof window==='undefined'?0:window.innerWidth
      }).id;
      setDeviceSignature(current=>current===next?current:next);
    };
    sync();
    window.addEventListener('resize',sync);
    return()=>window.removeEventListener('resize',sync);
  },[]);
  const deviceProfile=framingDeviceProfile({
    userAgent:typeof navigator==='undefined'?'':navigator.userAgent,
    maxTouchPoints:typeof navigator==='undefined'?0:navigator.maxTouchPoints,
    viewportWidth:typeof window==='undefined'?0:window.innerWidth
  });
  // 拖动帧率采样器：整个会话一个实例（一次拖动 = 一次 start / stop，指针抬起时收尾）。
  if(!frameSamplerRef.current) frameSamplerRef.current=createFrameSampler();
  // 内存峰值（≤300MB）：只在第二步采样，离开就停；**只在峰值确实抬高 5MB 以上时才发布到 state**
  // —— 定时器里 setState 会让整个第二步每秒重渲染一次（与 US-413「录入用时不用定时器」同一条纪律）。
  useEffect(()=>{
    if(step!==2) return undefined;
    const sampler=createMemorySampler({intervalMs:500,onPeak:(bytes,previous)=>{
      if(!previous||bytes-previous>=5*1024*1024) setMemoryBytes(bytes);
    }});
    memorySamplerRef.current=sampler;
    sampler.start();
    return()=>{
      sampler.stop();
      memorySamplerRef.current=null;
      const peak=sampler.peakBytes;
      if(peak>0) setMemoryBytes(current=>Math.max(current,peak));
    };
  },[step]);
  // 编辑底图（US-012 的「4000x3000 手机原图加载并显示不超过 2 秒，先降采样到长边 2400 再编辑」）：
  // 打开编辑器时先量一次原图，超过 EDIT_BASE_MAX_EDGE（2400）就**先降采样成编辑底图**，
  // 编辑期间的实时预览与高清稿都以它作源（原图 originalUrl 仍是只读的四层地址之一，不参与反复解码）。
  // 同一幅作品只准备一次（按「作品 id + 原图地址」缓存）；换作品 / 重新上传 / 换班 / 新建草稿都会作废。
  useEffect(()=>{
    if(!artworkEditor.open) return undefined;
    const source=media.artwork?.originalUrl;
    if(!source){setEditBase(null);setEditBaseBusy(false);return undefined;}
    const key=`${media.artwork?.id||''}|${source}`;
    if(editBaseRef.current.key===key&&editBaseRef.current.base){setEditBase(editBaseRef.current.base);return undefined;}
    let cancelled=false;
    const requestId=++editBaseRequestRef.current;
    setEditBase(null);
    setEditBaseBusy(true);
    // 底图还没准备好之前，舞台显示的是上一版成品图（已在屏幕上的解码结果），
    // 裁剪框与把手同时挂起（`is-preparing`）—— 拿旧画幅的框去拖会得到错的几何。
    setCropStage({naturalWidth:0,naturalHeight:0});
    prepareEditBase({source,maxEdge:EDIT_BASE_MAX_EDGE}).then(result=>{
      if(cancelled||requestId!==editBaseRequestRef.current) return;
      const base={url:result.url||source,downsampled:result.downsampled,width:result.width,height:result.height,originalWidth:result.originalWidth,originalHeight:result.originalHeight,message:result.message};
      editBaseRef.current={key,base};
      setEditBase(base);
      setEditBasePerf(result.ok?{ms:result.totalMs,plan:result.plan||null,message:result.message,downsampled:result.downsampled,originalWidth:result.originalWidth,originalHeight:result.originalHeight,width:result.width,height:result.height,at:Date.now()}:null);
      setEditBaseBusy(false);
    }).catch(()=>{
      if(cancelled||requestId!==editBaseRequestRef.current) return;
      // 准备失败也留一条可用的底图（退回原图），编辑器不会因此打不开。
      setEditBase({url:source});
      setEditBasePerf(null);
      setEditBaseBusy(false);
    });
    return()=>{cancelled=true};
  },[artworkEditor.open,media.artwork?.id,media.artwork?.originalUrl]);
  /** 编辑期间真正参与解码的那张图：编辑底图优先，其次是原图（底图还没好 / 准备失败时）。 */
  const editorBaseSource=editBase?.url||media.artwork?.originalUrl||'';
  /**
   * 舞台上的那张图 = 实时预览 → 编辑底图 → 原图（最后一级只在不处于「准备底图」时用）。
   * 准备底图期间**绝不**回落到原图：那正是本故事要避开的那一次「4000×3000 解码」。
   */
  const editorStageSrc=editorPreview||(editBaseBusy?(media.artwork?.framedUrl||media.artwork?.cleanUrl||''):(editorBaseSource||media.artwork?.originalUrl||''));
  useEffect(()=>{
    if(!artworkEditor.open){setEditorPreview('');setEditorPreviewPending(false);return undefined;}
    // 底图还在准备（要先降采样到长边 2400）：这一轮不画预览，等底图就绪后这条 effect 会再跑一次
    // —— 否则 4000×3000 的原图会被先解一遍（正是本故事要避免的那一次解码）。
    if(editBaseBusy){setEditorPreview('');setEditorPreviewPending(true);return undefined;}
    const source=editorBaseSource;
    if(!source){setEditorPreview('');setEditorPreviewPending(false);return undefined;}
    let cancelled=false;
    setEditorPreviewPending(true);
    // 操作过程中先给低分辨率稿（长边 ≤ 900，跟手）；高清稿由下面那条 effect 在停手 300ms 后补上。
    setEditorPreviewMode('low');
    const timer=setTimeout(()=>{
      renderArtworkRotation({source,rotation:normalizeArtworkEdit(artworkEditor.draft).rotateDeg,maxEdge:EDIT_PREVIEW_MAX_EDGE})
        .then(url=>{if(!cancelled)setEditorPreview(url||source)})
        .catch(()=>{if(!cancelled)setEditorPreview(source)})
        .finally(()=>{if(!cancelled)setEditorPreviewPending(false)});
    },120);
    return()=>{cancelled=true;clearTimeout(timer)};
  },[artworkEditor.open,editorRotationKey,media.artwork?.id,editorBaseSource,editBaseBusy]);
  // 缩放/平移的快照键：只影响舞台的 CSS transform（与裁剪渲染），不进入低分辨率稿的依赖 ——
  // 滚轮缩放时没必要重新编码一张 900px 的图（这也是 US-004b 收窄依赖的同一条纪律）。
  const editorViewKey=artworkViewKey(artworkEditor.draft);
  editorDraftRef.current=artworkEditor.draft;
  // 「停止操作 300ms 后合成高清预览」（US-004c 验收原文）：依赖里带上缩放/平移快照键，
  // 于是滚轮 / 双指 / 拖动都会把 300ms 的窗口重新计时；停手之后才编码一次高清稿（长边 ≤ 2400）。
  // 同一个旋转角已经合过高清稿时直接跳过（缩放平移不改变这张位图，位图分辨率只由旋转角决定）。
  // US-012 起记账的口径多一项**源**：编辑底图准备好之后源从原图切成底图，同一个角度也要重画一次。
  useEffect(()=>{
    if(!artworkEditor.open||editBaseBusy) return undefined;
    const source=editorBaseSource;
    if(!source) return undefined;
    let cancelled=false;
    const timer=setTimeout(()=>{
      const hdKey=`${artworkUrlFingerprint(source)}|${editorRotationKey}`;
      if(editorPreviewHdRef.current===hdKey) return;
      renderArtworkRotation({source,rotation:editorRotationKey,maxEdge:EDIT_PREVIEW_HD_MAX_EDGE})
        .then(url=>{
          if(cancelled) return;
          editorPreviewHdRef.current=hdKey;
          setEditorPreview(url||source);
          setEditorPreviewMode('hd');
        })
        .catch(()=>{});
    },ARTWORK_PREVIEW_SETTLE_MS);
    return()=>{cancelled=true;clearTimeout(timer)};
  },[artworkEditor.open,editorRotationKey,editorViewKey,media.artwork?.id,editorBaseSource,editBaseBusy]);
  // 停手 300ms 后的第二件事：把这一段缩放/平移压成**一步**撤销栈。
  // 一次手势 = 一步可撤销的操作（连续滚轮/拖动的中间值不占步），与裁剪拖拽的「松手压栈」同一条纪律。
  // 已经是这一步时 pushArtworkEditHistory 返回同一个对象，这里就原样返回 current（不触发重渲染）。
  useEffect(()=>{
    if(!artworkEditor.open) return undefined;
    const timer=setTimeout(()=>{
      setArtworkEditor(current=>{
        if(!current.open) return current;
        const history=pushArtworkEditHistory(current.history,current.draft,viewLabelRef.current||'缩放 / 平移画面');
        return history===current.history?current:{...current,history};
      });
    },ARTWORK_PREVIEW_SETTLE_MS);
    return()=>clearTimeout(timer);
  },[artworkEditor.open,editorViewKey]);
  // 滚轮缩放（US-004c）：React 的 onWheel 挂在 root 上且是 passive 的，在里面 preventDefault 会被忽略
  // （表现为「缩放的同时整页跟着滚」），所以这里手动挂一个非 passive 监听；最新草稿从 editorDraftRef 读，
  // 监听只在「编辑器开着 + 有原图」时挂一次，连续滚轮不会反复解绑。
  useEffect(()=>{
    const stage=cropStageRef.current;
    if(!stage||!artworkEditor.open||!media.artwork?.originalUrl) return undefined;
    const handleWheel=(event)=>{
      const box=stage.getBoundingClientRect();
      if(!box.width||!box.height) return;
      event.preventDefault();
      const edit=normalizeArtworkEdit(editorDraftRef.current);
      // 指针位置要从「舞台（= 整幅画面）」换算到「裁剪窗口坐标系」：缩放/平移的口径都是窗口。
      const windowRect=cropRectOf(edit.crop||media.artwork?.cleanCropRect);
      const anchorX=((event.clientX-box.left)/box.width-windowRect.x)/windowRect.w;
      const anchorY=((event.clientY-box.top)/box.height-windowRect.y)/windowRect.h;
      const factor=wheelZoomFactor(event.deltaY);
      const next=zoomArtworkEdit(edit,edit.zoom*factor,{x:anchorX,y:anchorY,crop:windowRect});
      if(artworkEditSameValue(next,edit)) return;
      setArtworkViewDraft(next,factor>1?'放大画面':'缩小画面');
    };
    stage.addEventListener('wheel',handleWheel,{passive:false});
    return()=>stage.removeEventListener('wheel',handleWheel);
  },[artworkEditor.open,media.artwork?.id,media.artwork?.originalUrl]);
  useEffect(()=>{
    if(step!==2||!media.photo?.url||media.photo?.portraitReady) return;
    let cancelled=false;
    createPortraitPrint({source:media.photo.url}).then(portraitUrl=>{
      if(cancelled) return;
      setMedia(current=>({...current,photo:{...current.photo,originalUrl:current.photo.originalUrl||current.photo.url,url:portraitUrl,portraitReady:true}}));
    }).catch(()=>{});
    return()=>{cancelled=true};
  },[step,media.photo?.id,media.photo?.url,media.photo?.portraitReady]);
  // 五维点评的正文**只**由大模型产出（人设 + 专业技能 + 记忆 + 作品图）。
  // 这里既不做「进入第三步就自动预填」的本地文案，也没有任何「云端不可用就填一份离线模板」的降级入口：
  // 那类兜底产出的是不带大模型参与的正文，老师却会以为自己在看 AI 的结果（US-108a 已移除）。
  // 云端失败就如实报错（错误文案走 describeReviewError），正文保持为空，等老师重试或换模型重试。
  /**
   * 老师选择的文件先过准入规则，再在本机把超长边图片降采样（US-408）。
   *
   * 三条规则集中在 `data/mediaValidation.js`：
   * - 格式白名单 JPEG / PNG / WebP（非白名单拒绝并说明原因）；
   * - 单张 10MB 上限（超限跳过，**不影响同批其它文件**）；
   * - 长边 > 3000px 在本机降采样后再处理。
   *
   * 返回 `files` 是**已经可以进入绑定/上传**的文件（类型已归一化、已降采样），
   * `notice` 是可读的跳过原因与降采样说明（给内联提示 + toast 用）。
   */
  const prepareSelectedFiles=async(fileList)=>{
    const screened=screenMediaFiles(fileList);
    const notices=[];
    if(screened.message) notices.push(screened.message);
    const files=[];
    for(const file of resolveMediaTypes(screened.accepted)){
      const prepared=await downsampleImageFile(file);
      if(!prepared.ok||!prepared.file){
        notices.push(prepared.message);
        continue;
      }
      if(prepared.downsampled) notices.push(prepared.message);
      files.push(prepared.file);
    }
    return {files,rejected:screened.rejected,notice:notices.filter(Boolean).join('')};
  };
  /**
   * 会话素材的缩略图（US-413）：条目**先**进界面（有 url 就能绑定、能填作品名），
   * 缩略图挪到空闲时段生成，长边不超过 `THUMBNAIL_MAX_EDGE`（320px）；生成完成后只回填这一条的
   * `thumbUrl`，列表随即换成小图。生成过程不阻塞输入 —— 输入框、按钮、后续上传都在缩略图之前就已经可用。
   *
   * 列表在缩略图就绪前渲染占位图（**不是**原图）：22 位学员同时把 3000px 原图塞进列表会让
   * 解码内存和滚动帧率一起塌掉，这正是本故事要避免的。生成失败时才退回原图（极少见）。
   *
   * `entries[i]` 与 `files[i]` 一一对应（绑定函数按传入顺序产出条目），所以这里按顺序配对。
   */
  const scheduleThumbnails=(kind,entries,files)=>{
    const pairs=(entries||[]).map((entry,index)=>({entry,file:(files||[])[index]})).filter(item=>item.entry&&item.file);
    if(!pairs.length) return;
    setThumbPendingCount(current=>current+pairs.length);
    pairs.forEach(({entry,file})=>{
      scheduleMediaTask(async()=>{
        const thumb=await createThumbnail(file);
        setBatchUploads(current=>{
          const list=current[kind]||[];
          // 条目已经被移除 / 换班：这次生成的地址没有归属，直接回收，别留在内存里。
          if(!list.some(item=>item.uploadId===entry.uploadId)){
            if(thumb.ok&&thumb.url) revokeMediaUrl(thumb.url);
            return current;
          }
          // 生成失败时退回原图，列表不至于一直停在占位上（正常情况下不会走到这里）。
          const nextThumb=thumb.ok&&thumb.url?thumb.url:entry.url;
          return {...current,[kind]:updateUploadEntry(list,entry.uploadId,{thumbUrl:nextThumb})};
        });
        setThumbPendingCount(current=>Math.max(0,current-1));
      });
    });
  };
  /** 记一次录入节奏（US-413）：素材变化时重算用时，不用定时器刷整页。 */
  const noteIntakeProgress=()=>setIntakeElapsedSeconds(Math.max(0,Math.round((Date.now()-intakeStartedAtRef.current)/1000)));
  /** 折叠 / 展开某个出席分组（key 形如「artwork:absent」）。 */
  const toggleSlotGroup=(key)=>setCollapsedSlotGroups(current=>current.includes(key)?current.filter(item=>item!==key):[...current,key]);
  // 课后反馈只收图片：作品与课堂照片。视频已从这条工作流里去掉。
  // binding（可选）把「这份素材属于谁」写到媒体对象上：个人反馈只有一个上传位，
  // 归属是隐式的（= 选中的那位学员），US-406b 要求它就地绑定，而不是等下游去猜。
  const readFile=async(kind,file,binding={})=>{
    if(!file) return;
    // 最后一道守卫：prepareSelectedFiles 之外（例如直接调用）的选择也要过同一条规则。
    const check=validateMediaFile(file);
    if(!check.ok){
      setToast(check.message);
      return;
    }
    const previousUrl=media[kind]?.url||'';
    const url=URL.createObjectURL(file);
    // 上一个会话内地址立刻回收：object URL 只在当次会话有效，留着只是白占内存。
    revokeMediaUrl(previousUrl);
    // 重新上传作品 = 换了一幅画：上一幅的编辑状态与撤销栈必须一起清掉，
    // 否则新作品会带着旧作品的旋转角与「可撤销 N 步」的历史（撤销出来的还是上一幅的步骤）。
    if(kind==='artwork'){
      closeArtworkEditor();
      // 换了一幅作品：新的作品位还没有写回，上一次的写回提示（尤其"已写回"那句）要一起清掉。
      setWriteBackAttempt({status:'idle',quality:'',message:''});
    }
    // Show the selected file immediately. The server upload only enriches this
    // local preview for AI processing; a temporary network error must not make
    // the user think the click did nothing.
    setMedia(current=>({...current,[kind]:{id:`local-${Date.now()}`,name:file.name,url,originalUrl:url,orientedUrl:url,rotation:0,orientationConfirmed:false,processingRequested:false,artworkEdit:createArtworkEdit(),type:file.type,size:file.size,storage:'local-preview',uploadStatus:'uploading',...binding}}));
    setUploadState(current=>({...current,[kind]:'uploading'}));
    try{
      const uploaded=await uploadControlledMedia(kind,file);
      setMedia(current=>({...current,[kind]:{...current[kind],...uploaded,url,storage:'controlled-memory',uploadStatus:'ready',...binding}}));
      setUploadState(current=>({...current,[kind]:'ready'}));
      setToast(`已受控上传${kind==='artwork'?'学员作品':'课堂照片'}：${file.name}`);
    }catch(error){
      setMedia(current=>({...current,[kind]:{...current[kind],uploadStatus:'local-only'}}));
      setUploadState(current=>({...current,[kind]:'local-only'}));
      setToast(`${kind==='artwork'?'作品':'照片'}已在本地预览；受控上传暂未连接，稍后可重新选择文件提交 AI。`);
    }
  };
  // 上传卡片的摘要：班级反馈下必须说清「几份素材绑定到了几位学员」，
  // 否则「未绑定」的素材会被当成正常素材，直到第三步展签上才发现。
  // 个人反馈（US-406b）只有一个上传位，摘要里明说它绑定到了哪位学员。
  const uploadSummary=(kind)=>{
    const items=batchUploads[kind];
    const single=kind==='artwork'?media.artwork:media.photo;
    const fallback=kind==='artwork'?'支持个人或按学员批量上传':'课堂人物照片，可批量上传';
    if(mode!=='班级反馈'){
      if(!single?.url) return fallback;
      const bound=single.studentName||selectedParticipant?.name||'';
      return kind==='artwork'&&bound?`${single.name} · 已自动绑定 ${bound}`:single.name;
    }
    if(kind==='artwork'&&items.length) return `本次已上传 ${items.length} 幅作品 · 按学员上传位逐幅管理`;
    if(!items.length) return single?.url?single.name:fallback;
    const bound=items.filter(item=>item.studentId).length;
    const unbound=items.length-bound;
    return `已选择 ${items.length} ${kind==='artwork'?'幅作品':'张照片'} · ${bound} 份已绑定学员${unbound?`，${unbound} 份未绑定`:''}`;
  };
  /**
   * 批量选择素材（班级反馈）。
   *
   * 返回值从「纯文件列表」改成**带 studentId 的绑定结构**：每一份素材在上传这一刻就绑定到
   * 一位具体的到场学员，绑定结果同时写回 participant.artworkIds / photoIds。
   * 空位不够时多出来的素材保持未绑定（studentId 为空）并在提示里说明，**不按序号猜姓名**。
   * 个人反馈只有一个上传位，作品在这里就地绑定到当前选中的学员，因此返回空数组。
   *
   * US-408 起这批文件先过 `prepareSelectedFiles`（格式白名单 / 10MB / 降采样）：
   * 不合格的份数被跳过并说明原因，**不影响同批其它文件**。
   */
  const readFiles=async(kind,fileList,input)=>{
    const rawFiles=Array.from(fileList||[]);
    // Clearing the native input lets a teacher choose the same photo again
    // after a failed upload or a quick correction.
    const sourceInput=input||({artwork:artworkInput,photo:photoInput}[kind]?.current);
    if(sourceInput) sourceInput.value='';
    if(!rawFiles.length) return [];
    const intake=await prepareSelectedFiles(rawFiles);
    setMediaIntakeNotice(intake.notice);
    const files=intake.files;
    if(!files.length){
      setToast(intake.notice||'没有可用的素材，请重新选择。');
      return [];
    }
    if(mode==='班级反馈'){
      const binding=bindFilesToParticipants(files,effectiveParticipants,{kind,existing:batchUploads[kind],title:lessonTopic||''});
      setBatchUploads(current=>({...current,[kind]:[...current[kind],...binding.entries]}));
      // 缩略图在空闲时段生成（US-413）：条目与输入先可用，生成过程不阻塞录入。
      scheduleThumbnails(kind,binding.entries,files);
      noteIntakeProgress();
      // 绑定要同时落到 participants 上：展签、成长档案、海报都按 artworkIds 认人。
      if(binding.bound) setParticipants(binding.participants);
      const names={artwork:'学员作品',photo:'课堂照片'};
      const unboundNote=binding.unbound?`；其中 ${binding.unbound} 份没有对应的到场学员，已标为「未绑定学员」，请核对后重选`:'';
      const bindingToast=`已添加 ${files.length} 份${names[kind]}，${binding.bound} 份已绑定学员${unboundNote}`;
      // readFile 是异步的（受控上传成功后还会再弹一条 toast），绑定结果必须最后说 ——
      // 否则老师只看到「已在本地预览」，看不到「有几份没绑定」。
      readFile(kind,files[0]).finally(()=>setToast(intake.notice?`${bindingToast}；${intake.notice}`:bindingToast));
      return binding.entries;
    }
    // 个人反馈：只有一个上传位，作品自动绑定到当前选中的这位学员（US-406b 的 AC）。
    // binding 写到 media 对象上，下游（展签/档案/海报）据此认人，不需要再靠「当前选中的是谁」猜。
    readFile(kind,files[0],kind==='artwork'?{studentId:selectedParticipant?.studentId||'',studentName:selectedParticipant?.name||''}:{})
      .finally(()=>{if(intake.notice) setToast(intake.notice)});
    return [];
  };
  // ---- 学员乘上传位的操作（US-406b）------------------------------------------------
  /**
   * 在**某位学员的上传位里**选文件：这批文件就是这个孩子的作品，直接绑给他（不做轮转）。
   * 超过每人 5 幅的份数被忽略并明确提示；受控上传仍走同一条 readFile（第一步的「已上传作品」标记、
   * 媒体状态与后续 AI 取图都依赖它）。
   * US-408：这批文件先过准入规则与降采样，不合格的份数被跳过且不影响同批其它文件。
   */
  const readStudentArtwork=async(participant,fileList,input)=>{
    const rawFiles=Array.from(fileList||[]);
    // 清空原生 input，否则同一位学员再选同一批文件不会触发 onChange。
    if(input) input.value='';
    if(!rawFiles.length||!participant?.name) return;
    const intake=await prepareSelectedFiles(rawFiles);
    setMediaIntakeNotice(intake.notice);
    if(!intake.files.length){
      setToast(intake.notice||`「${participant.name}」这次没有可用素材，请重新选择。`);
      return;
    }
    const binding=bindFilesToStudent(intake.files,participant,{kind:'artwork',existing:batchUploads.artwork,participants,title:''});
    // 草稿恢复（US-409）：上次存过的作品名按「这位学员 + 顺序」填回重新选择的素材上，
    // 只填空标题（这次手填过的名字不覆盖）。素材本体不再存在，所以只能按顺序对位。
    const restored=applySavedTitles(binding.entries,pendingTitles,participant);
    const entries=restored.entries;
    const filledCount=entries.filter(item=>String(item.title||'').trim()).length;
    if(restored.titles.length!==pendingTitles.length) setPendingTitles(restored.titles);
    if(entries.length){
      setBatchUploads(current=>({...current,artwork:[...current.artwork,...entries]}));
      // 缩略图挪到空闲时段（US-413）：这一行马上就能继续填作品名、继续传下一位学员。
      scheduleThumbnails('artwork',entries,intake.files);
      noteIntakeProgress();
      // 绑定同时写回 participant.artworkIds：展签、成长档案、海报都按它认人。
      setParticipants(binding.participants);
    }
    const overflowNote=binding.ignored?`；另有 ${binding.ignored} 幅超过每人 ${binding.max} 幅上限，已忽略，请分次或换一位学员上传`:'';
    const titleNote=filledCount?`；已填回 ${filledCount} 个上次保存的作品名`:'';
    const baseMessage=entries.length
      ? `已为「${participant.name}」添加 ${entries.length} 幅作品（共 ${binding.used+entries.length}/${binding.max} 幅）${titleNote}${overflowNote}`
      : `「${participant.name}」已达每人 ${binding.max} 幅上限${overflowNote}`;
    const message=intake.notice?`${baseMessage}；${intake.notice}`:baseMessage;
    // readFile 是异步的（受控上传成功/失败还会再弹一条 toast），绑定结果必须最后说（US-406a 的教训）。
    if(entries.length) readFile('artwork',intake.files[0]).finally(()=>setToast(message));
    else setToast(message);
  };
  /** 逐幅填写作品名：只改这一条，不动绑定与顺序。 */
  const renameArtworkTitle=(uploadId,title)=>setBatchUploads(current=>({...current,artwork:updateUploadEntry(current.artwork,uploadId,{title})}));
  /** 移除一幅作品：条目与 participant 上的 artworkId 一起摘掉，避免留下悬空引用；两个 object URL 一并回收。 */
  const removeArtwork=(uploadId)=>{
    const target=batchUploads.artwork.find(item=>item.uploadId===uploadId);
    revokeMediaUrl(target?.url);
    revokeMediaUrl(target?.thumbUrl);
    setBatchUploads(current=>({...current,artwork:removeUploadEntry(current.artwork,uploadId)}));
    setParticipants(current=>detachUploadBinding(current,uploadId,'artwork'));
  };
  /** 一键把本次课题套用为默认作品名：只填空着的作品名，不覆盖老师已经手填的名字。 */
  const applyTopicToArtworkTitles=()=>{
    const topic=String(lessonTopic||'').trim();
    if(!topic){setToast('本次课程还没有默认课题：请先到「课程库」补充，或逐幅手动填写作品名。');return;}
    const applied=applyDefaultTitles(batchUploads.artwork,topic,{kind:'artwork'});
    if(!applied.changed){setToast('每幅作品都已经有作品名了，没有被改动的条目。');return;}
    setBatchUploads(current=>({...current,artwork:applied.entries}));
    setToast(`已把《${topic}》套用为 ${applied.changed} 幅作品的默认作品名（已手填的名字保持不动）。`);
  };
  // ---- 学员课堂照片上传位（US-009）-------------------------------------------------
  /**
   * 在某位学员的照片上传位里选文件：这批照片就是这个孩子的（**不做轮转、不猜人**）。
   * 照片是选填项，超过每人 10 张的份数被忽略并明确提示。
   * 归属变化后统一用 `syncUploadBindings` 按条目重建 participants.photoIds ——
   * 因为照片支持改分配（分给多人/取消分配），只追加不重算会留下悬空 id。
   */
  const readStudentPhoto=async(participant,fileList,input)=>{
    const rawFiles=Array.from(fileList||[]);
    // 清空原生 input，否则同一位学员再选同一批照片不会触发 onChange。
    if(input) input.value='';
    if(!rawFiles.length||!participant?.name) return;
    const intake=await prepareSelectedFiles(rawFiles);
    setMediaIntakeNotice(intake.notice);
    if(!intake.files.length){
      setToast(intake.notice||`「${participant.name}」这次没有可用素材，请重新选择。`);
      return;
    }
    const binding=bindFilesToStudent(intake.files,participant,{kind:'photo',existing:classPhotoItems,participants,title:''});
    if(!binding.entries.length){
      setToast(`「${participant.name}」已达每人 ${binding.max} 张课堂照片上限，请先移除再添加。`);
      return;
    }
    const next=[...classPhotoItems,...binding.entries];
    setBatchUploads(current=>({...current,photo:next}));
    scheduleThumbnails('photo',binding.entries,intake.files);
    setParticipants(current=>syncUploadBindings(current,next,'photo'));
    const overflowNote=binding.ignored?`；另有 ${binding.ignored} 张超过每人 ${binding.max} 张上限，已忽略`:'';
    const baseMessage=`已为「${participant.name}」添加 ${binding.entries.length} 张课堂照片（共 ${binding.used+binding.entries.length}/${binding.max} 张）${overflowNote}`;
    const message=intake.notice?`${baseMessage}；${intake.notice}`:baseMessage;
    // readFile 是异步的（受控上传成功后还会再弹一条 toast），照片提示必须最后说（US-406a 的教训）。
    readFile('photo',intake.files[0],{studentId:participant.studentId||'',studentName:participant.name||''}).finally(()=>setToast(message));
  };
  /**
   * 全班合影：一次选一张（或多张）照片，**同一份文件同时归属给全部到场学员**。
   * 这是「把同一张照片分配给多位学员」最常用的入口；单张照片的细粒度分配在照片行里点「分给多人」。
   */
  const readSharedPhotos=async(fileList,input)=>{
    const rawFiles=Array.from(fileList||[]);
    if(input) input.value='';
    if(!rawFiles.length) return;
    const intake=await prepareSelectedFiles(rawFiles);
    setMediaIntakeNotice(intake.notice);
    if(!intake.files.length){
      setToast(intake.notice||'没有可用的素材，请重新选择。');
      return;
    }
    const binding=bindSharedFiles(intake.files,effectiveParticipants,{kind:'photo',existing:classPhotoItems});
    if(!binding.entries.length){
      setToast(photoAssignTargets.length?'全班学员的课堂照片都已达每人 10 张上限，无法再添加合影。':'本次课次还没有到场的学员，请先在上方标记出席状态。');
      return;
    }
    const next=[...classPhotoItems,...binding.entries];
    setBatchUploads(current=>({...current,photo:next}));
    scheduleThumbnails('photo',binding.entries,intake.files);
    setParticipants(current=>syncUploadBindings(current,next,'photo'));
    const skippedNote=binding.skipped.length?`；${binding.skipped.join('、')} 已满 10 张，未分到这张合影`:'';
    const baseMessage=`已添加 ${binding.entries.length} 张全班合影，同一张分给 ${binding.owners} 位到场学员${skippedNote}`;
    const message=intake.notice?`${baseMessage}；${intake.notice}`:baseMessage;
    readFile('photo',intake.files[0],{}).finally(()=>setToast(message));
  };
  /** 移除一张课堂照片：条目与所有归属者的 photoIds 一起摘掉（照片可能是多人共用）；两个 object URL 一并回收。 */
  const removePhoto=(uploadId)=>{
    const target=classPhotoItems.find(item=>item.uploadId===uploadId);
    revokeMediaUrl(target?.url);
    revokeMediaUrl(target?.thumbUrl);
    const next=removeUploadEntry(classPhotoItems,uploadId);
    setBatchUploads(current=>({...current,photo:next}));
    setParticipants(current=>syncUploadBindings(current,next,'photo'));
    if(photoAssignId===uploadId){setPhotoAssignId('');setPhotoAssignSelection([]);}
  };
  /** 打开某张照片的「分给多位学员」面板，勾选状态预置为它当前的归属者。 */
  const openPhotoAssign=(uploadId)=>{
    const entry=classPhotoItems.find(item=>item.uploadId===uploadId);
    setPhotoAssignId(uploadId);
    setPhotoAssignSelection((entry?.owners||[]).map(owner=>participantKey(owner)));
    setToast('勾选这张照片要分给的学员，然后点「保存分配」。');
  };
  const cancelPhotoAssign=()=>{setPhotoAssignId('');setPhotoAssignSelection([])};
  const togglePhotoAssignTarget=(key)=>setPhotoAssignSelection(current=>current.includes(key)?current.filter(item=>item!==key):[...current,key]);
  const selectAllPhotoAssignTargets=()=>setPhotoAssignSelection(photoAssignTargets.map(participantKey));
  /** 保存分配：整体替换这张照片的归属，再按条目重建 participants.photoIds（不会留下悬空 id）。 */
  const confirmPhotoAssign=()=>{
    if(!assigningPhoto) return;
    const targets=photoAssignTargets.filter(item=>photoAssignSelection.includes(participantKey(item)));
    const result=setUploadOwners(classPhotoItems,assigningPhoto.uploadId,targets);
    setBatchUploads(current=>({...current,photo:result.items}));
    setParticipants(current=>syncUploadBindings(current,result.items,'photo'));
    setPhotoAssignId('');
    setPhotoAssignSelection([]);
    const rejectedNote=result.rejected.length?`；${result.rejected.join('、')} 已满 ${result.max} 张，未分到这张照片`:'';
    setToast(result.owners
      ? `这张照片已分给 ${result.owners} 位学员${rejectedNote}`
      : `已取消这张照片的全部分配，${assigningPhoto.name} 现在没有归属${rejectedNote}`);
  };
  const hasUploadedArtwork=Boolean(media.artwork?.url);
  const hasProcessedArtwork=Boolean(media.artwork?.cleanUrl&&media.artwork?.cleanAlgorithm===ARTWORK_CLEAN_ALGORITHM);
  // ---- 进入第二步的前置校验（US-410）-----------------------------------------------
  // 六项必填：班级 / 课程 / 课次日期 / 课时序号 / 至少一位出席学员 / 至少一幅作品。
  // 判定与「具体原因」文案的唯一真源是 data/lessonReadiness.js（零依赖纯函数），
  // 界面的校验清单与 go() 的拦截读同一份结果，不会出现「按钮说不行、其实能走」的漂移。
  // 作品数：班级反馈数上传位里已绑定的条目；个人反馈只有 media.artwork 这一个上传位。
  const intakeArtworkCount=mode==='班级反馈'?classArtworkItems.length:(hasUploadedArtwork?1:0);
  const intakeReadiness=evaluateIntake({
    classId:selectedClass?.id||'',
    classCount:availableClasses.length,
    courseId:activeCourseId,
    courseCount:courseOptions.length,
    lessonDate,
    lessonNoValid,
    mode,
    attendedCount,
    artworkCount:intakeArtworkCount
  });
  // 用来在点评区标注「这几段评语是哪位人设写出来的」。
  const activeProfileLabel=(teacherProfiles.find(item=>item.id===activeProfileId)||teacherProfiles[0])?.name||'默认人设';
  const go=(next)=>{
    // 第一步 → 第二步的前置校验（US-410）：六项任缺一项都**停在第一步**，一个 state 都不改，
    // 已填的班级/课程/日期/序号/学员/素材原样保留（「不跳步、不丢失已填内容」）。
    // 按钮本身在校验不通过时是 disabled 的，这里再拦一道：顶部流程导航（FlowStepper）也能直接调 go()。
    // 提示必须给**具体原因**（如「还没有上传任何学员作品」），不是笼统的「请完善信息」。
    if(next>=2&&!intakeReadiness.ok){
      const attendanceBlocked=intakeReadiness.checks.find(check=>check.id==='attendance');
      if(attendanceBlocked&&!attendanceBlocked.ok) setParticipantNotice(attendanceBlocked.reason);
      setToast(`${intakeReadiness.summary}。具体原因见下方「进入下一步的校验清单」。`);
      return;
    }
    if(next>=3&&!hasProcessedArtwork){setToast('作品正在自动处理，请等待作品裁剪完成后再进入五维点评。');return}
    if(next>=4&&(!hasProcessedArtwork||!reviewGenerated)){setToast('请等待作品点评生成完成后再归档。');return}
    // 归档强校验（US-108b）：顶栏流程导航直接跳到第四步同样要过这一关（五维非空 + 轨迹成功），
    // 提示给出**具体原因**；一个 state 都不改，素材与已填内容原样保留。
    if(next>=4&&!reviewArchiveGate.ok){setToast(`${reviewArchiveGate.reasonText}（完整原因见「归档前的校验清单」。）`);return}
    // 离开第二步 = 退出编辑态（US-005）：未确认的编辑就地丢弃并给出提示，
    // 作品保持上一次确认的结果（编辑态本来就是草稿 + 撤销栈，丢弃是结构性的，不会污染成品）。
    if(next!==2&&artworkEditor.open){
      const discarded=hasUnconfirmedArtworkEdit();
      closeArtworkEditor();
      if(discarded) setToast('已离开作品编辑器并放弃未确认的编辑，作品保持上一次确认的结果。');
    }
    setStep(next);
    if(next===2){
      if(hasProcessedArtwork){setFramingState('ready');return;}
      setMedia(current=>({...current,artwork:{...current.artwork,orientationConfirmed:true,processingRequested:true,framedStyle:'',cleanUrl:null,cleanAlgorithm:null,framedUrl:null}}));
      setFramingState('processing');
    }
  };
  /**
   * 新建草稿（US-409）：清空**全部**草稿元数据与会话素材，回到第一步初始态。
   * 这里的「初始态」= 无草稿进入时的状态：我带的第一个班 + 本班课程 + 今天 + 推荐序号 + 本班名单，
   * 个人反馈模式、未选学员。清完 localStorage 后写入 effect 不会立刻又存一份（见 draftHasContent）。
   */
  const resetDraft=()=>{
    clearFeedbackDraft();
    clearSessionMediaSnapshot();
    revokeMediaEntries(batchUploads.artwork);
    revokeMediaEntries(batchUploads.photo);
    revokeMediaUrl(media.artwork?.url);
    revokeMediaUrl(media.photo?.url);
    setMedia({artwork:null,photo:null});
    setBatchUploads({artwork:[],photo:[]});
    setMediaIntakeNotice('');
    setMediaLostDismissed(false);
    // 新草稿 = 新素材：作品的编辑状态与撤销栈也回到初始态（US-004a）；未确认的编辑同样丢弃（US-005）。
    const discardedEdit=hasUnconfirmedArtworkEdit();
    closeArtworkEditor();
    // 录入节奏与折叠分组也回到初始态（US-413）：新草稿的用时从零开始。
    intakeStartedAtRef.current=Date.now();
    setIntakeElapsedSeconds(0);
    setCollapsedSlotGroups([]);
    setThumbPendingCount(0);
    setReviews(reviewDefaults);
    setKeywords([]);
    setAiKeywords([]);
    setKeywordDirty(false);
    setArchived(false);
    setCurrentRecordId('');
    // 新建草稿同样作废推理轨迹（US-102）：它属于上一批素材的那次生成。
    clearReviewTrace();
    setWriteBackAttempt({status:'idle',quality:'',message:''});
    // 新草稿 = 新一批作品：批量装裱的进度 / 失败清单 / 二次确认条一并清掉（US-010）。
    resetBatchFraming();
    setReviewGenerated(false);
    setStep(1);
    setShowAllClasses(false);
    setSelectedClassId(defaultClassId);
    setSelectedStudentName('');
    setSelectedCourseId(resolveCourseId(courses,myClasses[0]?.course));
    setMode('个人反馈');
    setLessonDate(todayDate);
    setLessonNoDirty(false);
    setFutureDateConfirmed(false);
    setSameDayConfirmed(false);
    setLessonConfirm(null);
    setLessonSaveState({status:'idle',message:''});
    setCurrentLessonId('');
    setParticipants(rosterParticipants(management.students.filter(item=>item.className===myClasses[0]?.name)));
    setTemporaryName('');
    setParticipantNotice('');
    setPhotoAssignId('');
    setPhotoAssignSelection([]);
    setDraftRestored(false);
    setPendingTitles([]);
    setToast(discardedEdit?'已新建一份课后反馈草稿（未确认的作品编辑已放弃）':'已新建一份课后反馈草稿');
  };
  // 老师手动增删观察词。AI 选中的词被取消时，同步从「AI 已识别」集合里去掉，标记才一致。
  const toggleKeyword=(keyword)=>{
    setKeywords(current=>current.includes(keyword)?current.filter(item=>item!==keyword):[...current,keyword]);
    setAiKeywords(current=>current.includes(keyword)?current.filter(item=>item!==keyword):current);
    setKeywordDirty(true);
  };
  // ---- 作品编辑器（US-004a「编辑器旋转与撤销重做」）-------------------------------------
  // 编辑态 = 一份**草稿**（artworkEditor.draft）+ 撤销栈；点「完成编辑」才写进 media.artwork.artworkEdit。
  // 因此取消 / 未确认退出不会污染已装裱的成品，而旋转结果永远落在 artworkEdit 上，
  // 原图 originalUrl 全程只读（不覆盖、不重编码）。
  /**
   * 有没有「未确认的编辑」= 编辑器开着、且草稿与已确认那一版不同（US-005 的判据只有这一处）。
   * 「未确认退出编辑态要丢弃本次编辑并给出提示」的所有路径都读它，不各写一遍比较逻辑。
   */
  const hasUnconfirmedArtworkEdit=()=>artworkEditor.open&&artworkEditSnapshotKey(artworkEditor.draft)!==artworkEditKey;
  /** 退出编辑器并清空草稿与撤销栈：换班 / 新建草稿 / 重新上传 / 移除作品 / 离开第二步时调用（别把上一幅的历史带过去）。 */
  const closeArtworkEditor=()=>{
    setArtworkEditor({open:false,draft:createArtworkEdit(),history:createArtworkEditHistory(createArtworkEdit()),cropAspect:''});
    setCropStage({naturalWidth:0,naturalHeight:0});
    setEditorPreview('');
    setEditorPreviewPending(false);
    setEditorPreviewMode('low');
    editorPreviewHdRef.current='';
    viewPointersRef.current.clear();
    viewGestureRef.current=null;
  };
  const openArtworkEditor=()=>{
    const artwork=media.artwork;
    if(!artwork?.originalUrl){setToast('请先上传学员作品，再进入编辑。');return;}
    const seed=normalizeArtworkEdit(artwork.artworkEdit);
    // cropAspect 留空 = 「跟随框自动匹配」：打开时不强行锁定比例，界面上高亮真正对得上的那一颗。
    setArtworkEditor({open:true,draft:seed,history:createArtworkEditHistory(seed,{label:'打开编辑器'}),cropAspect:''});
    // 每次打开都重新走一遍「低分辨率 → 停手 300ms → 高清」的两档预览（不复用上一次的高清稿）。
    editorPreviewHdRef.current='';
    setEditorPreviewMode('low');
    viewPointersRef.current.clear();
    viewGestureRef.current=null;
  };
  // 统一的「提交一步编辑」入口：更新草稿 + 压入撤销栈（label 就是这一步在撤销按钮上的说明）。
  const applyArtworkEditStep=(next,label)=>setArtworkEditor(current=>{
    if(!current.open) return current;
    const edit=normalizeArtworkEdit(next);
    return {...current,draft:edit,history:pushArtworkEditHistory(current.history,edit,label)};
  });
  const rotateArtworkEditor=(direction=1)=>applyArtworkEditStep(
    rotateArtworkEdit(artworkEditor.draft,direction>0?1:-1),
    direction>0?'向右旋转 90°':'向左旋转 90°'
  );
  const nudgeArtworkEditorRotation=(delta=FINE_ROTATION_STEP)=>applyArtworkEditStep(
    nudgeArtworkEditRotation(artworkEditor.draft,delta),
    `旋转微调 ${formatRotationDeg(delta)}`
  );
  const undoArtworkEdit=()=>setArtworkEditor(current=>{
    const history=undoArtworkEditHistory(current.history);
    if(history===current.history) return current;
    return {...current,history,draft:currentArtworkEdit(history)};
  });
  const redoArtworkEdit=()=>setArtworkEditor(current=>{
    const history=redoArtworkEditHistory(current.history);
    if(history===current.history) return current;
    return {...current,history,draft:currentArtworkEdit(history)};
  });
  // 编辑保护（US-005）：两个「回到已知状态」的动作，都只改草稿并各占一步撤销栈。
  //   * 重置 = artworkEdit 恢复默认（不旋转、不裁剪、1× 居中），确认之后系统纸边识别会重新跑；
  //   * 回到完整作品 = 保留旋转方向，把裁剪框恢复成整幅画面（系统自动裁剪前的完整画面）并回 1× 居中。
  const resetArtworkEditor=()=>applyArtworkEditStep(resetArtworkEdit(artworkEditor.draft),'重置编辑');
  const restoreArtworkFullFrameEditor=()=>applyArtworkEditStep(restoreArtworkFullFrame(artworkEditor.draft),'回到完整作品');
  // 图上的快捷旋转按钮：编辑器没开就先按当前 artworkEdit 打开（这一步也进撤销栈），
  // 之后由「完成编辑」统一提交 —— 于是连点旋转不会每一下都重扫一遍像素去重新裁剪。
  const quickRotateArtwork=(direction=1)=>{
    if(!media.artwork?.originalUrl) return;
    if(artworkEditor.open){rotateArtworkEditor(direction);return;}
    const seed=normalizeArtworkEdit(media.artwork.artworkEdit);
    const next=rotateArtworkEdit(seed,direction>0?1:-1);
    setArtworkEditor({open:true,draft:next,history:pushArtworkEditHistory(createArtworkEditHistory(seed),next,direction>0?'向右旋转 90°':'向左旋转 90°'),cropAspect:''});
  };
  // 「完成编辑」：把草稿写进 artworkEdit，并作废下游的裁剪稿/成品图（angle 变了就必须重算）。
  // 编辑与已确认的方向一致时不做无用功 —— 直接关掉编辑态，不动已装裱的成品。
  const confirmArtworkEdit=()=>{
    if(!artworkEditor.open) return;
    const edit=normalizeArtworkEdit(artworkEditor.draft);
    const draftKey=artworkEditSnapshotKey(edit);
    setArtworkEditor(current=>({...current,open:false}));
    if(draftKey===artworkEditKey&&media.artwork?.cleanUrl){
      setToast(`编辑已保存：${rotationSummary(edit)}。方向没有变化，装裱结果保持不变。`);
      return;
    }
    setMedia(current=>{
      if(!current.artwork) return current;
      // 写回的四层地址只走 applyArtworkLayerPatch：派生层随便写，**原图 originalUrl 一律拒绝**
      // （US-005「四层地址独立存在且互不覆盖」在写入侧的实现点）。
      return {...current,artwork:applyArtworkLayerPatch(current.artwork,{
        artworkEdit:edit,
        orientationConfirmed:true,
        processingRequested:true,
        // 旋转稿/裁剪稿/成品图都是「按某个角度算出来的」，角度一改就必须重新生成；
        // 原图 originalUrl 不动，编辑结果只落在 artworkEdit 上（FR-5）。
        orientedUrl:'',
        cleanUrl:null,
        cleanAlgorithm:null,
        cleanEditKey:'',
        framedUrl:null,
        framedStyle:''}).artwork};
    });
    setFramingState('processing');
    setToast(`编辑已保存：${rotationSummary(edit)}。正在按新的方向重新裁剪与装裱。`);
  };
  const cancelArtworkEdit=()=>{
    const changed=hasUnconfirmedArtworkEdit();
    setArtworkEditor(current=>({...current,open:false}));
    if(changed) setToast('已放弃未确认的编辑，作品保持上一次确认的旋转、裁剪与缩放结果。');
  };
  const startArtworkCleanup=()=>{
    if(!media.artwork?.originalUrl||framingState==='processing') return;
    setMedia(current=>({...current,artwork:{...current.artwork,orientationConfirmed:true,processingRequested:true,framedStyle:'',cleanUrl:null,cleanAlgorithm:null,framedUrl:null}}));
    setFramingState('processing');
  };
  const rotatePersonalPhoto=()=>setMedia(current=>({...current,photo:{...current.photo,rotation:((current.photo?.rotation||0)+90)%360}}));
  const rotateBatchItem=(kind,index)=>setBatchUploads(current=>({...current,[kind]:current[kind].map((item,itemIndex)=>itemIndex===index?{...item,rotation:((item.rotation||0)+90)%360,orientationChecked:false}:item)}));
  // 照片按学员分组渲染后，「第 N 张」的下标不再等于 batchUploads.photo 的下标（同一张合影出现在多人行里），
  // 所以照片旋转一律按 uploadId 定位，不按序号。
  const rotateUploadEntry=(kind,uploadId)=>setBatchUploads(current=>({...current,[kind]:current[kind].map(item=>item.uploadId===uploadId?{...item,rotation:((item.rotation||0)+90)%360,orientationChecked:false}:item)}));
  // blob: / http: 素材转成 data URL —— 云端模型只能取到内嵌数据，浏览器本地的 blob: 地址它读不到。
  const mediaToDataUrl=async(url)=>{
    if(!url) return '';
    if(String(url).startsWith('data:')) return String(url);
    try{
      const blob=await (await fetch(url)).blob();
      return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('素材读取失败'));reader.readAsDataURL(blob);});
    }catch{ return ''; }
  };
  const stopCloudReview=()=>{
    reviewAbort.current?.abort();
    reviewAbort.current=null;
    // 停止后保留已经收到的推理增量与正文（US-103a：折叠态写「已停止」，展开还能看到失败/停止前的增量），
    // 秒表就地冻住（再点展开不会让「共 N 秒」继续涨）。
    setReviewStream(current=>({...current,phase:REVIEW_DETAIL_PHASES.stopped,message:'已停止生成',elapsedMs:current.startedAt?Math.max(0,Date.now()-current.startedAt):current.elapsedMs}));
  };
  // 云端流式点评：人设 + 技能库 + 大模型记忆一起进 system 提示词，作品图作为 image_url 传入。
  // 五个维度的正文与「作品观察词」都由这一个调用产出：先让模型读懂画面，再按维度写评语。
  // [US-102] 同一次调用顺手采集推理轨迹（模型 / 耗时 / 用量 / 加载清单 / 提示词 / 推理 / 输出原文），
  // 轨迹只进 `reviewTraceRef`（内存），归档时才提交云端。
  // [US-107b] 第一个参数是**本次要用的模型选择**（'' / 'pool-route' / 模型 id）：生成中换模型的
  // 确认路径把它直接传进来（state 是异步的，等 `reviewModelChoice` 生效再生成会用到旧模型）；
  // 其余调用方（按钮 `onClick` 会把事件对象当第一个参数传进来）不给字符串 → 按当前选择走。
  const startCloudReview=async(overrideChoice)=>{
    const plan=reviewModelResolve(reviewModels,{selection:typeof overrideChoice==='string'?overrideChoice:reviewModelChoice,orgId:DEFAULT_ORG_ID});
    if(mode==='班级反馈'){setToast('班级课程反馈将接入下一段课程目标生成服务');return;}
    if(!media.artwork?.cleanUrl&&!media.artwork?.originalUrl){setToast('请先上传并完成作品处理，再生成点评。');return;}
    // 模型可用性（US-107a）：一个可选模型都没有（全部健康失败 / 未授权 / 额度不足）时不发请求，
    // 给出可读原因 —— 不要拿一个不可用的 id 去撞云端。
    if(!plan.ok){setToast(`${REVIEW_MODEL_EMPTY_TEXT}${plan.reasonText?`（${plan.reasonText}）`:''}`);return;}
    reviewAbort.current?.abort();
    const controller=new AbortController();
    reviewAbort.current=controller;
    // 本次运行的账（US-107b）：**traceId 现在就定下来**（种子里带给轨迹），于是「生成中换模型」
    // 能拿正在跑的这条做父轨迹；`parentTraceId` 指向上一次生成（换模型或重新生成都算）。
    const runTraceId=makeReviewTraceId();
    const parentTraceId=reviewRunRef.current?.traceId||reviewTraceRef.current?.traceId||'';
    reviewRunRef.current={controller,traceId:runTraceId,parentTraceId};
    const activeProfile=teacherProfiles.find(item=>item.id===activeProfileId)||teacherProfiles[0]||null;
    setReviewState('processing');
    setKeywordSuggesting(true);
    // 提示词的输入只在这里算一次：模型调用与「加载了什么」的展示读同一份，
    // 面板上的 agent.md / 技能 / 记忆 / 观察词模板不会与真正发出去的那一份对不上。
    // 观察词候选清单（US-109）：**同一个模板产物**（keywordTemplateView）同时喂面板、
    // 提示词与模型返回值校验，内置兜底时三处一起退到内置词表（并带上界面明示）。
    const keywordCandidates=keywordTemplateView.prompt;
    const keywordScope=mode==='班级反馈'?'课程观察关键词':'作品观察词';
    // 技能加载清单（US-104）：**同一次计算**既拼出提示词里的【已启用技能】段落，
    // 又给出逐项技能清单（名称/分类/来源/版本/字符数 + 是否加载 + 没加载的原因 + 原文片段）。
    const skillLoad=skillLoadout({skillKeys:activeProfile?.skillKeys,library:skillLibrary,legacySkills:activeProfile?.skills});
    // agent.md 与记忆文件的加载规则（US-105）：按固定顺序加载三层 agent.md 与三类记忆文件
    // （学员 > 班级 > 机构），按 studentId / classId / orgId 匹配生效范围，逐层最多 5 个，
    // 总量上限 8000 字符、超限按优先级截断；正文里的 {学员名} {班级名} {老师姓名} {课次日期}
    // 在这里替换成真实值。**同一次计算**既给提示词两段正文，又给面板清单与轨迹留档。
    const agentFileLoad=agentFileLoadout({
      files:loadAgentFiles(),
      context:{
        orgId:DEFAULT_ORG_ID,
        orgName:DEFAULT_ORG_NAME,
        teacherId:activeProfile?.id||'',
        teacherName:activeProfile?.name||currentTeacherName,
        classId:selectedClass?.id||'',
        className:selectedClass?.name||'',
        studentId:selectedParticipant?.studentId||'',
        // 「未选择学员」是界面的占位文案，不是学员名 —— 不把它当成变量值写进记忆文件。
        studentName:selectedStudentLabel==='未选择学员'?'':selectedStudentLabel,
        lessonDate:lessonDateDots
      }
    });
    const promptPreview=buildPersonaPrompt(activeProfile,{subject,skillLibrary,keywordCandidates,keywordScope,keywordTemplate:keywordTemplateView,skillLoadout:skillLoad,agentFiles:agentFileLoad});
    setReviewLoaded(reviewDetailLoaded({
      modules:promptPreview.modules,
      skills:skillLoad,
      agentFiles:agentFileLoad,
      memory:activeProfile?.memory||'',
      // 「加载了什么」里的观察词模板：分组数 / 词条数都读生效模板（内置兜底时就是内置词表的数字）。
      keywordGroups:keywordTemplateView.counts.groups,
      keywordTerms:keywordTemplateView.counts.terms
    }));
    setReviewRequests(count=>count+1);
    // 面板默认折叠（open 只在老师点摘要行时切换）；新一次生成从零开始累积增量。
    setReviewStream({phase:REVIEW_DETAIL_PHASES.running,reasoning:'',content:'',message:'',startedAt:Date.now(),elapsedMs:0});
    // 新一次生成：提示词稍后就位（要带上真正发出去的那两张图的数据地址），
    // 上一条轨迹的渲染副本立刻作废 —— 面板不能拿上一次的用量/输出冒充本次。
    setReviewPrompt(null);
    setReviewTracePanel(null);
    // 轨迹种子：谁（学员 id）/ 哪节课 / **本次的 traceId**（US-107b：生成中就定下来，供下一次关联）/
    // 上一代轨迹（换模型与重新生成都用 parentTraceId 关联上一次）/
    // 附件引用（文件 id 与文件名，图片正文由 llmReview 侧只取 hash）/
    // agent 文件（US-105：逐文件行 + 预算摘要；只有真正进提示词的行带正文）。
    const traceSeed={
      task:REVIEW_TRACE_TASKS.artworkReview,
      traceId:runTraceId,
      studentId:selectedParticipant?.studentId||'',
      // 学员姓名 / 经手老师 / 机构（US-112）：生成日志按学员与老师筛选、判可见性都读它们。
      studentName:selectedStudentLabel==='未选择学员'?'':selectedStudentLabel,
      teacherId:teacherWriteActor.actorId,
      teacherName:currentTeacherName,
      orgId:DEFAULT_ORG_ID,
      lessonId:currentLessonId,
      parentTraceId,
      queuedAt:new Date().toISOString(),
      files:agentFileLoad.files,
      agentFiles:agentFileLoad.summary,
      // 技能加载清单（US-112）：与提示词里【已启用技能】段落同一次计算的产物，逐项留档。
      skills:skillLoad.rows,
      images:{
        artwork:{id:media.artwork?.id,name:media.artwork?.name,mime:media.artwork?.type},
        photo:{id:media.photo?.id,name:media.photo?.name,mime:media.photo?.type}
      }
    };
    try{
      const artworkDataUrl=await mediaToDataUrl(media.artwork?.cleanUrl||media.artwork?.orientedUrl||media.artwork?.originalUrl);
      const photoDataUrl=await mediaToDataUrl(media.photo?.url);
      // 「提示词」分区的内容：与 `streamArtworkReview` 内部同一份纯函数产物（system / user 文本 +
      // 附件引用与 hash）。user 里只有文字，附件正文（data URL）一个字都不进面板。
      setReviewPrompt(buildReviewPromptBundle({
        profile:activeProfile,
        skillLibrary,
        subject,
        studentName:selectedStudentLabel,
        keywords,
        teacherObservation:'',
        artworkDataUrl,
        photoDataUrl,
        keywordCandidates,
        keywordScope,
        // 生效的观察词模板（US-109）：模块版本与来源写进提示词模块清单 → 轨迹留档能复现
        // 「这一次用的是哪一版模板」（内置兜底时来源标成内置兜底词表）。
        keywordTemplate:keywordTemplateView,
        agentFiles:agentFileLoad,
        images:traceSeed.images
      }));
      const result=await streamArtworkReview({
        profile:activeProfile,
        skillLibrary,
        subject,
        studentName:selectedStudentLabel,
        keywords,
        teacherObservation:'',
        artworkDataUrl,
        photoDataUrl,
        keywordCandidates,
        keywordScope,
        // 模型与来源（US-107a）：老师指定 / 模型池路由命中的 id + `teacher-pick` / `pool-route`
        // 标注，一起进真实请求与推理轨迹（轨迹的 `modelSource`）。`plan` 是本次的选择
        // （US-107b：生成中换模型时它就是刚确认的那个，不等 state 生效）。
        model:plan.modelId,
        modelSource:plan.source,
        keywordTemplate:keywordTemplateView,
        agentFiles:agentFileLoad,
        signal:controller.signal,
        trace:traceSeed,
        onTrace:(next)=>{
          // 已收束的轨迹进小账本（US-107b 的对比要读「上一次」；被中止的那一条也在这里）。
          reviewTraceArchiveRef.current=archiveReviewTraces(reviewTraceArchiveRef.current,next);
          // 只读调试钩子（与 `window.__xinlehuiReviewTrace` 同一类，供验证脚本做独立重算）：
          // 已收束轨迹的账本，不参与任何业务判断。
          if(typeof window!=='undefined') window.__xinlehuiReviewTraces=reviewTraceArchiveRef.current;
          // 被新一次生成顶掉的那一代（生成中换模型 = 上一代被中止）：settle 时**只补进对比区**，
          // 绝不能拿它的读数去盖当前面板（否则正被中止的用量/输出会冒充正在跑的这一条）。
          if(reviewRunRef.current?.controller!==controller){
            if(reviewRunRef.current?.parentTraceId===next.traceId) setReviewCompareParent(next);
            return;
          }
          reviewTraceRef.current=next;
          // 收束副本进 state（面板的用量 / 耗时 / 输出原文以它为准）；留档仍只由 ref 在归档那一刻提交。
          setReviewTracePanel(next);
          // 两次对比的「上一次」（US-107b）：本次轨迹的 parentTraceId 命中的那一条。
          setReviewCompareParent(next.parentTraceId?findArchivedTrace(reviewTraceArchiveRef.current,next.parentTraceId):null);
          // 只读调试钩子（与 window.__xinlehuiFeedbackMode 同一类）：验证脚本用它读「本次生成
          // 采到了什么轨迹」，不参与任何业务判断。
          if(typeof window!=='undefined') window.__xinlehuiReviewTrace=next;
        },
        onReasoning:full=>setReviewStream(current=>({...current,reasoning:full})),
        onContent:full=>setReviewStream(current=>({...current,content:full}))
      });
      setReviews(current=>({...current,...result.reviews}));
      // 唯一的置真路径：只有这一次云端调用成功返回了五维正文，才把「已生成」点亮。
      setReviewGenerated(true);
      // 成功一次就把连续失败读数归零（US-108b）：提示只在真的连着失败时出现。
      setReviewFailureStreak(0);
      setKeywordDirty(false);
      setReviewState('ready');
      // 生成结束：保留推理增量与正文原文（面板的正文进度、输出原文都读它们），秒表就地冻住。
      setReviewStream(current=>({...current,phase:REVIEW_DETAIL_PHASES.done,reasoning:result.reasoning||current.reasoning,message:'',elapsedMs:current.startedAt?Math.max(0,Date.now()-current.startedAt):current.elapsedMs}));
      // 模型识别出的观察词：与老师已手动勾选的取并集，再按**生效模板**的顺序排好
      // （US-109：校验与排序都走模板产物 —— 模板之外的词一律丢弃，一处都不例外）。
      const picked=pickTemplateKeywords(result.keywords,keywordTemplateView);
      setAiKeywords(picked);
      if(picked.length) setKeywords(current=>orderTemplateKeywords([...current,...picked],keywordTemplateView));
      const unmatched=!picked.length&&(result.keywords||[]).length;
      setToast(picked.length
        ?`已按「${activeProfileLabel}」生成点评，并识别出 ${picked.length} 个观察词，请老师确认后再发布`
        :unmatched
          ?`已按「${activeProfileLabel}」生成点评；本次识别出的词不在词表内，请老师手动勾选观察词`
          :`已按「${activeProfileLabel}」生成点评草稿，请老师确认后再发布`);
    }catch(error){
      if(controller.signal.aborted) return;
      setReviewState('ready');
      // 连续失败计数（US-108b）：老师自己点「停止生成」走的是上面那行 return，不算失败。
      setReviewFailureStreak(count=>count+1);
      // 失败同样保留失败前收到的推理增量（面板展开后能看到增量 + 错误详情），秒表冻住。
      setReviewStream(current=>({...current,phase:REVIEW_DETAIL_PHASES.error,message:describeReviewError(error),elapsedMs:current.startedAt?Math.max(0,Date.now()-current.startedAt):current.elapsedMs}));
      setToast(describeReviewError(error));
    }finally{
      setKeywordSuggesting(false);
      if(reviewAbort.current===controller) reviewAbort.current=null;
    }
  };
  const archiveRecord=()=>{
    if(!hasProcessedArtwork||!reviewGenerated){setToast('请先完成线稿提取和智能点评，才能归档给家长。');return;}
    // 归档强校验（US-108b）：按钮已经按它禁用，这里再拦一道（顶栏流程导航也能调归档附近的路径），
    // 提示给出**具体原因**（哪一维还空着 / 轨迹为什么不算成功），不是笼统的「请完善信息」。
    if(!reviewArchiveGate.ok){setToast(`${reviewArchiveGate.reasonText}（完整原因见「归档前的校验清单」。）`);return;}
    let traceNote='';
    if(!archived){
      // 成品图写回（US-008b）：归档时把写过回的成品图与四项溯源一起带进档案 ——
      // 3D 画廊挂的就是它（写过回的记录不再套画展的框，见 gallery/exhibitionArtworks.js）。
      // 过期（老师改过装裱参数或变量）就不带：档案里宁可显示实时渲染的成品图，
      // 也不挂一张与当前参数对不上的旧图（面板上会提示「重新保存即可更新档案」）。
      const framedArtwork=writeBackFresh?writeBackRecord:null;
      const record=createFeedbackRecord({
        media,subject,reviews,mode,
        student:selectedStudentLabel,
        className:selectedClassLabel,
        framedArtwork,
        lessonId:currentLessonId,
        lessonDate:lessonDateDots
      });
      setRecords(list=>[record,...list]);
      // 记住这一次的归档 id：之后再保存图片时，写回要**就地更新**这一条（换班/换学员会清掉它）。
      setCurrentRecordId(record.id);
      setArchived(true);
      // 推理轨迹（US-102）在**归档这一刻**才提交：生成期只驻留内存，未归档的轨迹不落盘。
      const stored=commitReviewTrace(record.id);
      traceNote=stored?`；推理轨迹已留档：${reviewTraceSummary(stored)}`:'';
    }
    setToast(`点评已归档到成长档案${traceNote}`);go(4);
  };
  /**
   * 提交本次点评的推理轨迹（[US-102]，只在归档时调用）：
   *   ① 先写本机镜像（`persistReviewTrace`，立刻能在管理端审计里读到，并顺手清掉混进来的素材正文）；
   *   ② 再推云端（`review_traces` 表还没建时会被拒 —— 只影响「跨设备可见」，本机这条照样成立）。
   * 返回真正落盘的轨迹（没有轨迹可提交时返回 null）。
   */
  const commitReviewTrace=(recordId)=>{
    const trace=reviewTraceRef.current;
    if(!trace) return null;
    const stored=persistReviewTrace({...trace,recordId,archivedAt:new Date().toISOString()});
    if(!stored) return null;
    void saveRemoteReviewTrace(stored).catch(()=>{});
    // 开发适配器上的审计存储（US-112）：适配器没起就静默跳过（本机镜像与云端表两条路照常）。
    void pushRemoteReviewTrace(stored,{role:'teacher'}).catch(()=>{});
    return stored;
  };
  /**
   * 换上下文（换班 / 换学员 / 换模式 / 新建草稿）时作废本次轨迹：它属于上一位孩子的那次生成。
   * US-107b 起一并清掉运行账与小账本、对比区与待确认的换模型条 —— 对比基线也属于那一位孩子，
   * 拿别人家的上一次来对比比没有更糟。
   */
  const clearReviewTrace=()=>{
    reviewTraceRef.current=null;
    reviewRunRef.current=null;
    reviewTraceArchiveRef.current=[];
    setReviewTracePanel(null);
    setReviewCompareParent(null);
    setReviewModelSwitch(null);
    setReviewPrompt(null);
    // 连续失败读数同样属于上一位孩子的那一次生成（US-108b）：换上下文就清零。
    setReviewFailureStreak(0);
    if(typeof window!=='undefined'){window.__xinlehuiReviewTrace=null;window.__xinlehuiReviewTraces=[];}
  };
  // 第一步的「家长授权状态提示」（US-411 / F-INTAKE-CONSENT-01）。
  // 非阻断：所选学员里有「未完成查看授权」的孩子时提示一句并列出姓名，全部已授权时**不渲染**
  // （避免噪音）。按钮是唯一入口动作，不影响「进入智能装裱」与「保存课次」的可用性。
  const consentNoticeField=consentSummary.hasUnauthorized?(
    <div className="intake-consent">
      <div className="intake-consent-head">
        <ShieldAlert size={14}/>
        <div>
          <b>{consentSummary.message}</b>
          <small>授权只影响「转发给家长」这一步；本次录入、装裱、点评与归档都不受影响，可以先完成、授权后补。</small>
        </div>
        <button type="button" className="text-link" onClick={()=>setConsentExpanded(value=>!value)}>{consentExpanded?'收起名单':`查看是哪 ${consentSummary.unauthorizedCount} 位`}</button>
      </div>
      {consentExpanded?<ul className="intake-consent-list">
        {consentSummary.items.map(item=><li key={item.studentId||item.name}>
          <b>{item.name}{item.temporary?<span className="tag">临时</span>:null}</b>
          <em className={item.status}>{item.statusLabel}</em>
          <small>{item.guardianName?`监护人：${item.guardianName}`:'还没有登记监护人联系方式'}</small>
        </li>)}
      </ul>:null}
      <div className="intake-consent-actions">
        <Button variant="secondary" icon={ShieldCheck} onClick={()=>navigate('authorization')}>去授权管理</Button>
        <small>{consentSummary.unregisteredCount?`其中 ${consentSummary.unregisteredCount} 位还没有授权记录（如临时加入的试听学员），请在「授权管理」先登记家长授权。`:'请家长在家长端完成查看授权，或联系机构管理员处理。'}</small>
      </div>
    </div>
  ):null;
  // 第一步的「参与学员与出席状态」面板（US-405）。
  // 名单来自班级名单；缺课学员仍写进 lesson.participants，只是 attendance='absent'（成长档案需要缺课留白）。
  // 临时加入的插班/试听只进本次课次，绝不回写班级名单。
  const attendanceButtons=(participant)=>(
    <div className="intake-attendance" role="group" aria-label={`${participant.name} 的出席状态`}>
      {ATTENDANCE_STATES.map(state=>(
        <button key={state} type="button" className={`${participant.attendance===state?'active':''} ${state}`} onClick={()=>setParticipantAttendance(participant.name,state)}>{ATTENDANCE_LABELS[state]}</button>
      ))}
    </div>
  );
  const participantField=selectedClass&&classStudents.length?(
    <div className="intake-participants">
      <div className="intake-participants-head">
        <b>参与学员与出席状态</b>
        <small>{mode==='班级反馈'?'缺课学员仍会写进本次课次，供成长档案生成缺课留白':'个人反馈只把选中的这位学员写进本次课次'}</small>
      </div>
      {mode==='班级反馈'?<div className="intake-participants-actions">
        <button type="button" onClick={selectAllParticipants}>全选本班 {classStudents.length} 人</button>
        <button type="button" onClick={invertParticipants}>反选</button>
        <button type="button" onClick={clearParticipants}>清空</button>
      </div>:null}
      <div className="intake-participants-stats">
        <span>本班 <b>{participantStats.roster}</b> 人</span>
        <span>出席 <b>{participantStats.present}</b></span>
        <span>缺课 <b>{participantStats.absent}</b></span>
        <span>补课 <b>{participantStats.makeup}</b></span>
        {participantStats.temporary?<span>临时学员 <b>{participantStats.temporary}</b></span>:null}
      </div>
      {mode==='班级反馈'?<>
        <div className="intake-participant-list">
          {classStudents.map(item=>{
            const participant=participants.find(entry=>entry.name===item.name)||null;
            return <div key={item.name} className={`intake-participant ${participant?'':'off'}`}>
              <label>
                <input type="checkbox" checked={Boolean(participant)} onChange={()=>toggleParticipant(item.name)} aria-label={`${item.name} 参与本次课次`}/>
                <span>{item.name}</span>
              </label>
              {participant?attendanceButtons(participant):<span className="intake-participant-note">未参与本次课次</span>}
            </div>;
          })}
          {participants.filter(item=>item.temporary).map(participant=><div key={`temporary-${participant.name}`} className="intake-participant temporary">
            <label><span className="tag">临时</span><span>{participant.name}</span></label>
            {attendanceButtons(participant)}
            <button type="button" className="text-link muted" onClick={()=>removeParticipant(participant.name)}>移除</button>
          </div>)}
        </div>
        <div className="intake-attendant-add">
          <input type="text" value={temporaryName} placeholder="临时加入非本班学员（插班 / 试听）" onChange={event=>setTemporaryName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();addTemporaryParticipant()}}}/>
          <button type="button" onClick={addTemporaryParticipant} disabled={!String(temporaryName||'').trim()}>加入本次课次</button>
          <small>只写入本次课次，不回写班级名单</small>
        </div>
      </>:null}
      {mode==='个人反馈'&&selectedParticipant?<div className="intake-participant-list">
        <div className="intake-participant">
          <label><span>{selectedParticipant.name}</span></label>
          {attendanceButtons(selectedParticipant)}
        </div>
      </div>:null}
      {mode==='个人反馈'&&!selectedStudent?<p className="intake-hint">请先在上方「选择学员」，再标记这位孩子的出席状态。</p>:null}
      {participantNotice?<p className="intake-lesson-warn">{participantNotice}</p>:null}
      <small className="intake-participants-foot">改动出席名单后请点「保存课次」，把它写进本次课次。</small>
    </div>
  ):null;
  // 第一步的「学员乘上传位」列表（US-406b）。
  // 班级反馈按到场学员一人一行：每行 1–5 幅作品，上传即绑定到这一行的学员（不做任何顺序推断），
  // 逐幅可填作品名、可单独移除；顶上一键把本次课题套用为默认作品名，并提示还有几位没有作品。
  const artworkSlotField=mode==='班级反馈'?(
    <div className="intake-upload-slots">
      <div className="intake-upload-slots-head">
        <b>学员作品上传位</b>
        <small>每位到场学员 1–5 幅，上传后逐幅填写作品名</small>
        <button type="button" onClick={applyTopicToArtworkTitles} disabled={!classArtworkItems.length}>把本次课题套用为作品名</button>
      </div>
      <p className={missingArtworkCount?'intake-upload-pending':'intake-upload-pending ok'}>
        {!artworkSlotRows.length
          ? '本次课次还没有到场的学员：请先在上方标记出席状态，再按学员上传作品。'
          : (missingArtworkCount?`还有 ${missingArtworkCount} 位学员未上传作品`:`本班 ${artworkSlotRows.length} 位到场学员都已有作品`)}
      </p>
      {artworkPaceTotal?<div
        className={`intake-upload-perf${artworkPaceDone>=artworkPaceTotal?' done':''}`}
        data-intake-pace
        data-intake-done={artworkPaceDone}
        data-intake-total={artworkPaceTotal}
        data-intake-elapsed={intakeElapsedSeconds}
        data-intake-thumb-pending={thumbPendingCount}
      >
        <Clock3 size={13}/>
        <span className="intake-upload-pace">{artworkPaceText}</span>
        {thumbPendingText?<em className="intake-thumb-pending">{thumbPendingText}</em>:null}
      </div>:null}
      {artworkSlotRows.length?<IntakeSlotGroups
        listKey="artwork"
        rows={artworkSlotRows}
        collapsedKeys={collapsedSlotGroups}
        onToggle={toggleSlotGroup}
        renderRow={row=>(
          <div key={row.participant.studentId} className={`intake-upload-slot${row.usage.full?' full':''}${row.attended?'':' absent'}`}>
            <div className="intake-upload-slot-head">
              <label>
                <b>{row.participant.name}</b>
                {row.attended?<span className="tag muted">{ATTENDANCE_LABELS[row.participant.attendance]}</span>:<span className="tag">本次标记为缺课</span>}
              </label>
              <span className="intake-upload-count">已上传 <b>{row.usage.used}</b>/{row.usage.max} 幅</span>
              <input
                ref={element=>{artworkSlotInputs.current[row.participant.studentId]=element}}
                type="file" accept="image/jpeg,image/png,image/webp" hidden multiple
                onChange={event=>readStudentArtwork(row.participant,event.target.files,event.currentTarget)}
              />
              <button type="button" className="intake-upload-add" disabled={row.usage.full} onClick={()=>artworkSlotInputs.current[row.participant.studentId]?.click()}>
                {row.usage.full?`已达每人 ${row.usage.max} 幅上限`:'添加作品'}
              </button>
            </div>
            {row.uploads.length?<div className="intake-upload-items">
              {row.uploads.map((entry,index)=>(
                <figure key={entry.uploadId} data-thumb={entry.thumbUrl?'ready':'pending'}>
                  {/* 列表只渲染缩略图（≤320px，US-413）：生成期间显示占位，绝不把原图塞进列表 */}
                  <img src={entry.thumbUrl||INTAKE_THUMB_PLACEHOLDER} alt={`${row.participant.name}的作品`}/>
                  <div>
                    <input
                      type="text" value={entry.title||''}
                      placeholder="作品名（可点上方套用本次课题）"
                      aria-label={`${row.participant.name} 第 ${index+1} 幅作品的作品名`}
                      onChange={event=>renameArtworkTitle(entry.uploadId,event.target.value)}
                    />
                    <small>{entry.name}</small>
                  </div>
                  <button type="button" className="text-link muted" title="移除这幅作品" onClick={()=>removeArtwork(entry.uploadId)}>
                    <Trash2 size={12}/>移除
                  </button>
                </figure>
              ))}
            </div>:<p className="intake-upload-empty">这位学员还没有上传作品</p>}
          </div>
        )}
      />:null}
      <small className="intake-upload-foot">归属在上传那一刻就写进这位学员名下（展签、成长档案、海报都读这份绑定）；改班不会把作品带过去，请在新班级重新上传。</small>
    </div>
  ):null;
  // 第一步的「学员课堂照片上传位」（US-009）。
  // 与作品上传位**分开管理**：照片选填（0–10 张/人），不参与进入下一步的校验；
  // 另外支持「一张照片分给多位学员」—— 顶上「上传全班合影」一次分给全部到场学员，
  // 单张也可以在照片行里点「分给多人」逐人勾选（例如一位孩子和同伴的合照）。
  const photoSlotField=mode==='班级反馈'?(
    <div className="intake-upload-slots photo-slots">
      <div className="intake-upload-slots-head">
        <b>学员课堂照片上传位</b>
        <small>每位到场学员 0–10 张 · <em>选填</em>，不影响进入下一步</small>
        <input
          ref={sharedPhotoInput}
          type="file" accept="image/jpeg,image/png,image/webp" hidden multiple
          onChange={event=>readSharedPhotos(event.target.files,event.currentTarget)}
        />
        <button type="button" onClick={()=>sharedPhotoInput.current?.click()} disabled={!photoAssignTargets.length}>
          上传全班合影（同一张分给全班）
        </button>
      </div>
      <p className={missingPhotoCount?'intake-upload-pending':'intake-upload-pending ok'}>
        {!photoSlotRows.length
          ? '本次课次还没有到场的学员：请先在上方标记出席状态，再按学员上传课堂照片（也可以跳过）。'
          : (missingPhotoCount
            ? `还有 ${missingPhotoCount} 位学员未上传课堂照片（选填，可以继续下一步）`
            : `本班 ${photoSlotRows.length} 位到场学员都已有课堂照片（已收录 ${classPhotoItems.length} 张）`)}
      </p>
      {photoSlotRows.length?<IntakeSlotGroups
        listKey="photo"
        className="photo-slots-list"
        rows={photoSlotRows}
        collapsedKeys={collapsedSlotGroups}
        onToggle={toggleSlotGroup}
        renderRow={row=>(
          <div key={participantKey(row.participant)} className={`intake-upload-slot${row.usage.full?' full':''}${row.attended?'':' absent'}`}>
            <div className="intake-upload-slot-head">
              <label>
                <b>{row.participant.name}</b>
                {row.attended?<span className="tag muted">{ATTENDANCE_LABELS[row.participant.attendance]}</span>:<span className="tag">本次标记为缺课</span>}
              </label>
              <span className="intake-upload-count">已上传 <b>{row.usage.used}</b>/{row.usage.max} 张</span>
              <input
                ref={element=>{photoSlotInputs.current[participantKey(row.participant)]=element}}
                type="file" accept="image/jpeg,image/png,image/webp" hidden multiple
                onChange={event=>readStudentPhoto(row.participant,event.target.files,event.currentTarget)}
              />
              <button type="button" className="intake-upload-add" disabled={row.usage.full} onClick={()=>photoSlotInputs.current[participantKey(row.participant)]?.click()}>
                {row.usage.full?`已达每人 ${row.usage.max} 张上限`:'添加照片'}
              </button>
            </div>
            {row.uploads.length?<div className="intake-upload-items photo-items">
              {row.uploads.map(entry=>(
                <figure key={entry.uploadId} data-thumb={entry.thumbUrl?'ready':'pending'}>
                  <img src={entry.thumbUrl||INTAKE_THUMB_PLACEHOLDER} alt={`${row.participant.name}的课堂照片`} style={{transform:`rotate(${entry.rotation||0}deg)`}}/>
                  <div>
                    <small className="photo-name">{entry.name}</small>
                    <small className={entry.owners.length>1?'photo-shared':'photo-owner'}>
                      {entry.owners.length>1
                        ? `共用 · 已分给 ${entry.owners.length} 位学员：${entry.owners.map(owner=>owner.studentName).join('、')}`
                        : '仅这位学员'}
                    </small>
                  </div>
                  <button type="button" className="text-link" title="把这张照片分给多位学员" onClick={()=>openPhotoAssign(entry.uploadId)}>分给多人</button>
                  <button type="button" className="text-link muted" title="移除这张照片" onClick={()=>removePhoto(entry.uploadId)}>
                    <Trash2 size={12}/>移除
                  </button>
                </figure>
              ))}
            </div>:<p className="intake-upload-empty">这位学员还没有课堂照片（选填，可留空）</p>}
          </div>
        )}
      />:null}
      {unassignedPhotos.length?<div className="intake-photo-orphans">
        <div className="intake-photo-orphans-head">
          <b>还没有归属的照片（{unassignedPhotos.length} 张）</b>
          <small>这些照片不会出现在展签与成长档案里；请分给学员，或直接移除。</small>
        </div>
        <div className="intake-upload-items photo-items">
          {unassignedPhotos.map(entry=>(
            <figure key={entry.uploadId}>
              <img src={entry.url} alt={entry.name} style={{transform:`rotate(${entry.rotation||0}deg)`}}/>
              <div>
                <small className="photo-name">{entry.name}</small>
                <small className="photo-owner">未归属任何学员</small>
              </div>
              <button type="button" className="text-link" title="把这张照片分给学员" onClick={()=>openPhotoAssign(entry.uploadId)}>分给多人</button>
              <button type="button" className="text-link muted" title="移除这张照片" onClick={()=>removePhoto(entry.uploadId)}>
                <Trash2 size={12}/>移除
              </button>
            </figure>
          ))}
        </div>
      </div>:null}
      {assigningPhoto?<div className="intake-photo-assign">
        <div className="intake-photo-assign-head">
          <img src={assigningPhoto.url} alt={assigningPhoto.name}/>
          <div>
            <b>把「{assigningPhoto.name}」分给哪些学员？</b>
            <small>同一张照片可以分给多位学员（例如全班合影）。取消全部勾选就表示这张照片不归属于任何学员。</small>
          </div>
        </div>
        <div className="intake-photo-assign-targets">
          {photoAssignTargets.length
            ? photoAssignTargets.map(item=>{
              const key=participantKey(item);
              return <label key={key} className={photoAssignSelection.includes(key)?'on':''}>
                <input type="checkbox" checked={photoAssignSelection.includes(key)} onChange={()=>togglePhotoAssignTarget(key)}/>
                <span>{item.name}</span>
              </label>;
            })
            : <small>本次没有到场的学员：请在「参与学员与出席状态」里先标记出席。</small>}
        </div>
        <div className="intake-photo-assign-actions">
          <button type="button" className="text-link" onClick={selectAllPhotoAssignTargets} disabled={!photoAssignTargets.length}>全班都分</button>
          <button type="button" className="text-link muted" onClick={()=>setPhotoAssignSelection([])}>全部取消</button>
          <button type="button" className="intake-upload-add" onClick={confirmPhotoAssign}>保存分配（{photoAssignSelection.length} 位学员）</button>
          <button type="button" className="text-link muted" onClick={cancelPhotoAssign}>放弃修改</button>
        </div>
      </div>:null}
      <small className="intake-upload-foot">课堂照片是选填项，每位学员 0–10 张；归属在上传或分配那一刻写进这些学员名下，展签与成长档案都读这份绑定。没有照片的学员在后续步骤显示占位。</small>
    </div>
  ):null;
  // 第一步的「课次日期 + 课时序号」面板（US-404）：两项必填，日期默认今天、序号默认推荐值。
  // 唯一键 classId + lessonDate + lessonNo 在保存时校验；未来日期与同日已有课次都要二次确认。
  const lessonScheduleField=activeCourseId?(
    <div className="intake-lesson-form">
      <div className="intake-lesson-head">
        <b>课次日期与课时序号</b>
        <small>下游展签、成长档案与阶段报告都取这里的日期</small>
      </div>
      <div className="intake-lesson-fields">
        <label>课次日期 <em>必填</em>
          <input type="date" value={lessonDate} onChange={event=>selectLessonDate(event.target.value)}/>
        </label>
        <label>课时序号 <em>必填</em>
          <input type="number" min="1" step="1" inputMode="numeric" placeholder="例如 13" value={lessonNoInput} onChange={event=>selectLessonNo(event.target.value)}/>
        </label>
      </div>
      <div className="intake-lesson-actions">
        <button type="button" className="text-link" onClick={()=>selectLessonDate(todayDate)}>用今天（{todayDate}）</button>
        <button type="button" className="text-link" onClick={useRecommendedLessonNo}>用推荐值（第 {recommendedLessonNo} 次）</button>
        <small>推荐值 = 该班该课程已归档 {archivedLessonCount} 次 + 1{recommendedTopic?` · 课题《${recommendedTopic}》`:''}</small>
      </div>
      {isFutureLessonDate?<p className={futureDateConfirmed?'intake-lesson-note ok':'intake-lesson-warn'}>
        {futureDateConfirmed?`已二次确认使用未来日期 ${lessonDate}（预排课）`:`${lessonDate} 在今天（${todayDate}）之后：未来日期需二次确认后才能保存`}
      </p>:null}
      {lessonNoConflict?<p className="intake-lesson-warn">
        该班 {lessonDate} 已有第 {lessonNoConflict.lessonNo} 次课，请修改课时序号后再保存。
        <button type="button" className="text-link" onClick={applyConflictNextLessonNo}>改为第 {lessonNoConflict.lessonNo+1} 次课</button>
      </p>:null}
      {!lessonNoConflict&&sameDayNos.length?(
        lessonNoValue>sameDayMaxNo
          ?<p className="intake-lesson-note ok">第 {lessonNoValue} 次课在该日期仍是空位；保存时会再确认一次。</p>
          :<p className="intake-lesson-note">
            该班该日期已有第 {sameDayAllNos.join('、')} 次课，是否创建第 {sameDayNextNo} 次？
            <button type="button" className="text-link" onClick={useSameDayNextLessonNo}>改用第 {sameDayNextNo} 次课</button>
          </p>
      ):null}
      <div className="intake-lesson-preview">
        <span>本次课次</span>
        <b>{lessonNoValid?`第 ${lessonNoValue} 次课`:'待填写课时序号'}</b>
        <small>{lessonDate||'待选择课次日期'} · {lessonTopic?`课题《${lessonTopic}》`:'该课程还没有默认课题，可先到课程库补充'}</small>
      </div>
      {lessonConfirm?<div className="intake-lesson-confirm">
        <span>{lessonConfirm.message}</span>
        <div>
          <button type="button" className="text-link" onClick={confirmLessonAction}>{lessonConfirm.action}</button>
          <button type="button" className="text-link muted" onClick={()=>setLessonConfirm(null)}>{lessonConfirm.kind==='conflict'?'知道了':'取消'}</button>
        </div>
      </div>:null}
      {lessonSaveState.status!=='idle'&&!lessonConfirm?<p className={lessonSaveState.status==='error'?'intake-lesson-warn':'intake-lesson-note ok'}>{lessonSaveState.message}</p>:null}
    </div>
  ):null;
  // 第一步底部的「进入下一步的校验清单」（US-410）：逐项列出六项必填，缺哪项就写清**具体原因**
  // （如「还没有上传任何学员作品」），不做「请完善信息」这种笼统提示。校验不通过时「进入智能装裱」
  // 按钮 disabled，但「保存课次」仍然可用 —— 保存草稿与进入下一步是两个独立动作，互不覆盖。
  const intakeReadinessPanel=(
    <div className={`intake-readiness ${intakeReadiness.ok?'ready':'blocked'}`}>
      <div className="intake-readiness-head">
        {intakeReadiness.ok?<CircleCheck size={14}/>:<ShieldAlert size={14}/>}
        <b>{intakeReadiness.ok?'前置校验已全部通过，可以进入智能装裱':`进入智能装裱前还差 ${intakeReadiness.failedCount} 项：${intakeReadiness.failedLabels.join('、')}`}</b>
        <small>共 {intakeReadiness.total} 项必填 · 已完成 {intakeReadiness.passedCount} 项</small>
      </div>
      <ul className="intake-readiness-list">
        {intakeReadiness.checks.map(check=><li key={check.id} className={check.ok?'ok':'todo'}>
          <span className="intake-readiness-mark">{check.ok?<Check size={12}/>:<X size={12}/>}</span>
          <div><b>{check.label}</b>{check.ok?null:<small>{check.reason}</small>}</div>
        </li>)}
      </ul>
      {intakeReadiness.ok?null:<p className="intake-readiness-note">校验没通过也可以先点「保存课次」把这次课次存成草稿：保存草稿与进入下一步是两个独立动作，互不覆盖 —— 不会跳步，也不会清掉已填内容。</p>}
    </div>
  );
  // ---- 作品编辑器面板（US-004a）-------------------------------------------------------
  // 编辑态就地展开在作品卡片里：左旋/右旋 90°、微调 ±0.5°（范围 ±15°）、撤销/重做（至少 20 步）。
  // 编辑期间预览的是低分辨率「旋转稿」（长边 ≤ EDIT_PREVIEW_MAX_EDGE），确认后才重新裁剪与装裱。
  // 折叠态显示的是**已确认**的 artworkEdit（不是刚被丢弃的草稿）：放弃编辑后摘要必须回到确认过的角度。
  const artworkEditorShown=artworkEditor.open?artworkEditor.draft:normalizeArtworkEdit(media.artwork?.artworkEdit);
  const artworkEditorState=artworkEditHistoryState(artworkEditor.history);
  const artworkEditorFine=fineRotationOf(artworkEditorShown.rotateDeg);
  // 「编辑保护」两个动作（重置 / 回到完整作品，US-005）的现状摘要：默认态、完整画面 + 1× 居中时
  // 对应按钮置灰，这一行说明「现在是哪种状态」，免得老师对着置灰的按钮猜。
  const artworkViewIsIdentity=artworkEditorShown.zoom===1&&artworkEditorShown.offsetX===0&&artworkEditorShown.offsetY===0;
  // ---- 裁剪框（US-004b）---------------------------------------------------------------
  // 归一化裁剪框 ↔ 屏幕坐标的换算只有一处：**裁剪舞台**（图片的渲染盒）就是坐标系，
  // 于是「拖动位移 ÷ 舞台尺寸」就是归一化位移，与图片分辨率、缩放、窗口大小都无关。
  // 八点几何、比例换算、最小 10%、四边吸附、越界回弹全部在 data/artworkCrop.js 的纯函数里（可 Node 断言）。
  const cropImageAspect=cropStage.naturalWidth>0?cropStage.naturalWidth/Math.max(1,cropStage.naturalHeight):1;
  /** 此刻显示在舞台上的裁剪框：草稿里有手动裁剪就用它；没有（= 沿用系统识别）就用识别到的那一版。 */
  const cropShownRect=cropRectOf(artworkEditorShown.crop||media.artwork?.cleanCropRect);
  const cropAspectId=artworkEditor.cropAspect||matchCropPreset(artworkEditorShown.crop,cropImageAspect);
  const cropLockedRatio=artworkEditor.cropAspect?resolveCropAspect(artworkEditor.cropAspect,cropImageAspect):null;
  const cropSizeLabel=cropSizeText(cropShownRect);
  const cropRatioLabel=cropRatioText(cropShownRect,cropImageAspect);
  const cropRectAttr=[cropShownRect.x,cropShownRect.y,cropShownRect.w,cropShownRect.h].map(item=>Number(item.toFixed(4))).join(',');
  // 舞台上的缩放/平移 = `<img>` 的 inline transform（identity 时是空串 = 不放 transform）；
  // 与裁剪渲染 `renderArtworkCrop` 共用 data 层同一份 `artworkImageTransform` 几何 —— 看到什么就得到什么。
  const cropStageTransform=artworkImageTransform(artworkEditorShown,cropShownRect)?.css||'';
  const zoomableView=artworkViewSummary(artworkEditorShown);
  const artworkEditProtectLabel=`${artworkEditIsDefault(artworkEditorShown)?'默认状态':'有编辑'} · ${cropIsFull(cropShownRect)&&artworkViewIsIdentity?'完整画面':'已裁剪 / 已缩放平移'}`;
  // 四层地址（US-005）：原图 / 旋转稿 / 裁剪稿 / 成品图各自的就绪状态与地址指纹。
  // 清单只读 data/artworkLayers.js（层定义与显示口径的唯一真源），界面不自己拼字段名。
  const artworkLayers=artworkLayerEntries(media.artwork);
  const artworkLayersReady=artworkLayerReadyCount(media.artwork);
  /** 拖动过程中只改草稿、**不进撤销栈**：每一步都压栈会把 40 步的上限在一秒内用光。 */
  const setArtworkCropDraft=(nextCrop)=>setArtworkEditor(current=>{
    if(!current.open) return current;
    return {...current,draft:normalizeArtworkEdit({...current.draft,crop:nextCrop})};
  });
  const beginCropDrag=(event,handle)=>{
    if(!artworkEditor.open) return;
    const stage=cropStageRef.current;
    if(!stage) return;
    const box=stage.getBoundingClientRect();
    if(!box.width||!box.height) return;
    event.preventDefault();
    // 指针捕获：拖到舞台外面（甚至拖出窗口）也不丢事件，松手一定能收尾。
    try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}
    cropDragRef.current={
      handle,
      pointerId:event.pointerId,
      startX:event.clientX,
      startY:event.clientY,
      width:box.width,
      height:box.height,
      base:cropShownRect,
      aspect:cropLockedRatio,
      imageAspect:cropImageAspect,
      moved:false
    };
    // 还没显式选过比例时，一动手就按「自由裁剪」记：否则高亮会随着框子对上了某个比例而自己跳。
    if(!artworkEditor.cropAspect) setArtworkEditor(current=>({...current,cropAspect:CROP_FREE_ASPECT_ID}));
    // 拖动帧率采样（US-012）：一次拖动 = 一次采样，松手时收尾并给出结论。
    frameSamplerRef.current?.start();
  };
  const moveCropDrag=(event)=>{
    const drag=cropDragRef.current;
    if(!drag||event.pointerId!==drag.pointerId) return;
    const offsetX=event.clientX-drag.startX;
    const offsetY=event.clientY-drag.startY;
    // 2px 抖动阈值：手一抖就压一步撤销栈的话，「撤销」会按很多次才看得出变化。
    if(!drag.moved&&Math.abs(offsetX)<2&&Math.abs(offsetY)<2) return;
    event.preventDefault();
    drag.moved=true;
    const dx=offsetX/drag.width;
    const dy=offsetY/drag.height;
    const options={minRatio:CROP_MIN_RATIO,snapRatio:CROP_SNAP_RATIO,aspectRatio:drag.aspect,imageAspect:drag.imageAspect};
    setArtworkCropDraft(drag.handle===CROP_BODY_HANDLE
      ? moveCrop(drag.base,dx,dy,options)
      : resizeCrop(drag.base,drag.handle,dx,dy,options));
  };
  const endCropDrag=(event)=>{
    const drag=cropDragRef.current;
    if(!drag||(event&&event.pointerId!==drag.pointerId)) return;
    cropDragRef.current=null;
    // 采样器一定收尾（哪怕这次只是点了一下把手）；只有真的拖动过才把读数给学生看。
    const frameStats=frameSamplerRef.current?.stop();
    if(!drag.moved) return;
    if(frameStats) setDragPerf(frameStats);
    // 松手才把这一步压进撤销栈（与旋转/微调一样：一步 = 一次可撤销的操作，label 说明做了什么）。
    setArtworkEditor(current=>{
      if(!current.open) return current;
      const label=drag.handle===CROP_BODY_HANDLE?'移动裁剪框':`调整裁剪框 · ${cropHandleLabel(drag.handle)}`;
      return {...current,history:pushArtworkEditHistory(current.history,current.draft,label)};
    });
  };
  // ---- 缩放 / 平移手势（US-004c）-------------------------------------------------------
  // 舞台上两件事共用一套指针：① 裁剪框拖拽（US-004b，按 8 个把手与整框）；② 画面缩放/平移（本故事）。
  // 分工：把手与未铺满的整框照旧调裁剪框；**画面空白处**（框外的图片上）拖动 = 平移画面；
  // 裁剪框铺满整幅画面时它本来就无处可移，拖动改为平移画面（否则框一铺满就再也拖不动画面了）。
  // 双指（两根指针同时按下）按两指距离缩放、按两指中点平移，缩放锚点取双指中点。
  const viewStageBox=()=>{
    const stage=cropStageRef.current;
    if(!stage) return null;
    const box=stage.getBoundingClientRect();
    if(!box.width||!box.height) return null;
    return box;
  };
  /** 舞台坐标（0–1，= 整幅画面）→ 裁剪窗口坐标（0–1）。缩放/平移的锚点与位移都按窗口口径算。 */
  const toWindowPoint=(box,clientX,clientY,windowRect)=>({
    x:((clientX-box.left)/box.width-windowRect.x)/windowRect.w,
    y:((clientY-box.top)/box.height-windowRect.y)/windowRect.h
  });
  const beginViewGesture=(event)=>{
    if(!artworkEditor.open) return;
    const marker=event.target.closest?event.target.closest('[data-crop-handle]'):null;
    const isCropBody=Boolean(marker&&marker.getAttribute('data-crop-handle')===CROP_BODY_HANDLE);
    // 裁剪拖拽优先；只有「整框 + 框已铺满整幅画面」这类无处可移的情况才让位给平移。
    if(marker&&!(isCropBody&&cropIsFull(cropShownRect))) return;
    const box=viewStageBox();
    if(!box) return;
    event.preventDefault();
    try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}
    const points=viewPointersRef.current;
    points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const base=normalizeArtworkEdit(artworkEditor.draft);
    const windowRect=cropRectOf(base.crop||media.artwork?.cleanCropRect);
    if(points.size===1){
      viewGestureRef.current={mode:'pan',pointerId:event.pointerId,base,windowRect,start:{x:event.clientX,y:event.clientY},box,moved:false};
      // 拖动帧率采样（US-012）：平移手势同样算「编辑拖动」。
      frameSamplerRef.current?.start();
      return;
    }
    const [first,second]=[...points.values()];
    const mid={x:(first.x+second.x)/2,y:(first.y+second.y)/2};
    viewGestureRef.current={
      mode:'pinch',
      pointerId:event.pointerId,
      base,
      windowRect,
      box,
      anchor:toWindowPoint(box,mid.x,mid.y,windowRect),
      startDistance:Math.max(1,Math.hypot(first.x-second.x,first.y-second.y)),
      startMid:mid,
      moved:false
    };
  };
  const moveViewGesture=(event)=>{
    const gesture=viewGestureRef.current;
    const points=viewPointersRef.current;
    if(!gesture||!points.has(event.pointerId)) return;
    points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    event.preventDefault();
    if(gesture.mode==='pan'){
      // 双指落下后由 pinch 接管：单指阶段只平移（位移 = 窗口宽/高的比例）。
      if(points.size>1) return;
      const dx=(event.clientX-gesture.start.x)/gesture.box.width;
      const dy=(event.clientY-gesture.start.y)/gesture.box.height;
      if(!gesture.moved&&Math.abs(dx)<0.004&&Math.abs(dy)<0.004) return;
      gesture.moved=true;
      // 位移也要换算到窗口口径：舞台位移 ÷ 窗口尺寸。
      const next=panArtworkEdit(gesture.base,dx/gesture.windowRect.w,dy/gesture.windowRect.h);
      if(!artworkEditSameValue(next,gesture.base)) setArtworkViewDraft(next,'平移画面');
      return;
    }
    const [first,second]=[...points.values()];
    const distance=Math.max(1,Math.hypot(first.x-second.x,first.y-second.y));
    const mid={x:(first.x+second.x)/2,y:(first.y+second.y)/2};
    gesture.moved=true;
    const zoomed=zoomArtworkEdit(gesture.base,gesture.base.zoom*distance/gesture.startDistance,{x:gesture.anchor.x,y:gesture.anchor.y,crop:gesture.windowRect});
    const next=panArtworkEdit(
      zoomed,
      (mid.x-gesture.startMid.x)/gesture.box.width/gesture.windowRect.w,
      (mid.y-gesture.startMid.y)/gesture.box.height/gesture.windowRect.h
    );
    if(!artworkEditSameValue(next,gesture.base)) setArtworkViewDraft(next,distance>gesture.startDistance?'放大画面':'缩小画面');
  };
  const endViewGesture=(event)=>{
    const points=viewPointersRef.current;
    if(event&&event.pointerId!==undefined) points.delete(event.pointerId);
    const gesture=viewGestureRef.current;
    if(!gesture) return;
    if(points.size>=1){
      // 双指抬起一根：剩下的那根接着平移（重新以当前位置为基准，画面不会跳）。
      const [only]=[...points.values()];
      viewGestureRef.current={mode:'pan',pointerId:gesture.pointerId,base:normalizeArtworkEdit(artworkEditor.draft),windowRect:gesture.windowRect,box:gesture.box,start:{x:only.x,y:only.y},moved:false};
      return;
    }
    viewGestureRef.current=null;
    // 全部手指都抬起来了：拖动帧率采样收尾（这是一个完整手势的帧率）。没真的动过就不记录读数。
    const frameStats=frameSamplerRef.current?.stop();
    if(frameStats&&gesture.moved) setDragPerf(frameStats);
    if(!gesture.moved) return;
    // 松手才压一步撤销栈（与裁剪拖拽一致）：一次手势 = 一步可撤销的操作。
    setArtworkEditor(current=>{
      if(!current.open) return current;
      const history=pushArtworkEditHistory(current.history,current.draft,viewLabelRef.current||'缩放 / 平移画面');
      return history===current.history?current:{...current,history};
    });
  };
  /** 面板上的缩小 / 放大按钮（手机上没有滚轮，双指之外也要有一条路）：以窗口中心为锚点一步 ×1.25 / ÷1.25。 */
  const zoomArtworkView=(factor)=>{
    const edit=normalizeArtworkEdit(artworkEditor.draft);
    const windowRect=cropRectOf(edit.crop||media.artwork?.cleanCropRect);
    const next=zoomArtworkEdit(edit,edit.zoom*factor,{x:0.5,y:0.5,crop:windowRect});
    if(artworkEditSameValue(next,edit)) return;
    setArtworkViewDraft(next,factor>1?'放大画面':'缩小画面');
    // 按钮是「一步到位」的操作（不是连续手势），所以当场就压栈，响应更直接。
    setArtworkEditor(current=>{
      if(!current.open) return current;
      const history=pushArtworkEditHistory(current.history,current.draft,viewLabelRef.current||'缩放 / 平移画面');
      return history===current.history?current:{...current,history};
    });
  };
  const chooseCropPreset=(presetId)=>{
    const id=CROP_ASPECT_PRESETS.some(item=>item.id===presetId)?presetId:CROP_FREE_ASPECT_ID;
    const name=CROP_ASPECT_PRESETS.find(item=>item.id===id)?.label||'自由';
    setArtworkEditor(current=>{
      if(!current.open) return current;
      const base=cropRectOf(current.draft.crop||media.artwork?.cleanCropRect);
      const edit=normalizeArtworkEdit({...current.draft,crop:applyCropPreset(base,id,cropImageAspect)});
      return {...current,draft:edit,cropAspect:id,history:pushArtworkEditHistory(current.history,edit,`裁剪比例 ${name}`)};
    });
  };
  // ---- 相框样式选择器面板（US-006）-------------------------------------------------
  // 验收四件事都落在这块面板上：① 缩略图网格、缩略图用**当前作品**实时渲染（`frameThumbs` 来自
  // `renderFrameStyleThumbnail`，与成品图同一条渲染路径）；② 只列 `enabled !== false` 的模板
  // （`enabledFrames` 已过滤）；③ 形状 / 材质色 / 框宽三组继续微调 + 卡纸开关与卡纸色；
  // ④ 切换样式只触发装裱那一段 effect（裁剪那一段的依赖里没有 frame / 微调）。
  // 缩略图还没生成（或这一张渲染失败）时卡片退化为 CSS 预览：框色 / 框宽 / 卡纸色 / 形状仍然能看出来。
  const frameStyleFallbackStyle=(desc)=>({
    borderColor:desc.colorHex,
    borderWidth:`${Math.max(3,Math.round((desc.widthRatio||0.0412)*170))}px`,
    background:desc.matVisible?desc.matHex:'#FFFFFF'
  });
  // ---- 装裱性能读数与底部抽屉（US-012）-----------------------------------------------
  // 四项检查（合成耗时 / 原图加载与显示 / 拖动帧率 / 内存峰值）的结论**只在 data 层算**，
  // 界面与断言读同一份 `framingPerformance.rows`；这里只做「测量值 → 结论文本」的编排。
  // `performance.memory` 是 Chromium 的扩展（Safari / Firefox 没有）：不支持时如实写「未提供」。
  const memorySupported=typeof performance!=='undefined'&&Boolean(performance.memory);
  const editBaseCheck=editBasePerf?evaluateEditBase({ms:editBasePerf.ms,plan:editBasePerf.plan}):null;
  const framingPerf=framingPerformanceChecks({
    profile:deviceProfile,
    compose:composePerf,
    editBase:editBasePerf,
    dragFps:dragPerf,
    memory:memoryBytes>0?{bytes:memoryBytes,supported:true}:(memorySupported?null:{bytes:0,supported:false})
  });
  const editBaseSummary=editBaseCheck?`${editBaseCheck.detail} · 加载与显示 ${editBaseCheck.value}（预算 ${editBaseCheck.budget}，${editBaseCheck.ok?'达标':'超标'}）`:'';
  const studioDrawerItem=(id)=>STUDIO_DRAWERS.find(item=>item.id===id)||{id,label:'',hint:''};
  /** 抽屉的触发按钮（只在 ≤430px 显示，桌面端 `display:none` —— 面板本身就是内联的一块）。 */
  const studioDrawerTrigger=(id)=>{
    const item=studioDrawerItem(id);
    return <button type="button" className="studio-drawer-trigger" data-studio-drawer-trigger={id} aria-expanded={studioDrawer===id?'true':'false'} onClick={()=>{setOverlayDrawerOpen(false);setStudioDrawer(id)}}>
      {item.label}<em>{item.hint}</em>
    </button>;
  };
  /** 抽屉的头（把手 + 标题 + 完成）：同样只在手机断点显示（桌面端面板是内联的，不需要「完成」）。 */
  const studioDrawerHead=(id)=>{
    const item=studioDrawerItem(id);
    return <div className="studio-drawer-head" data-studio-drawer-head={id}>
      <span className="studio-drawer-handle" aria-hidden="true"/>
      <b>{item.label}</b>
      <button type="button" data-studio-drawer-close={id} onClick={()=>setStudioDrawer('')}>完成</button>
    </div>;
  };
  const frameStylePanel=(
    <section className={`frame-style-panel${studioDrawer==='frame'?' is-open':''}`} data-frame-style-panel="true" data-studio-drawer="frame" data-studio-drawer-open={studioDrawer==='frame'?'true':'false'} data-frame-active={activeFrameId} data-frame-style-count={enabledFrames.length} data-frame-tweak-count={frameTweakCount} data-frame-tweaks={frameTweakSummary} data-frame-thumb-ready={enabledFrames.filter(item=>frameThumbs[item.id]).length} data-frame-thumb-pending={enabledFrames.filter(item=>!frameThumbs[item.id]).length}
      data-frame-resolve-source={frameResolution.source} data-frame-resolved-id={resolvedFrame?.id||''} data-frame-default-id={(defaultFramingPreset(visibleFrames)?.id)||''} data-frame-manual-pick={framePickedManually?'true':'false'}>
      {studioDrawerHead('frame')}
      <div className="frame-style-head">
        <b>相框样式</b>
        <em className="frame-style-active" data-frame-active-summary={`${activeFrame?.name||'默认装裱'}${frameTweakCount?` · ${frameTweakSummary}`:''}`}>当前：{activeFrame?.name||'默认装裱'}{frameTweakCount?` · ${frameTweakSummary}`:''}</em>
        <small>{enabledFrames.length?`共 ${enabledFrames.length} 套可选；缩略图用当前作品实时渲染。切换样式只重绘装裱，不会重新裁剪作品。`:'正在读取装裱设置…'}</small>
      </div>
      {/* 默认选中说明（US-011b）：按课程绑定 → 默认模板 → 第一套。老师手动点过卡片就不再多说
          （那是老师自己的选择，不是「默认选中」）。 */}
      {enabledFrames.length&&frameResolveText&&!framePickedManually?<p className="frame-style-resolve" data-frame-resolve-text={frameResolveText}>{frameResolveText}</p>:null}
      {enabledFrames.length?<div className="frame-style-grid" role="radiogroup" aria-label="相框样式">
        {enabledFrames.map(preset=>{
          const isActive=preset.id===activeFrameId;
          // 卡片描述与缩略图都按「这套样式 + （若是当前选中）本次微调」算，老师调完立刻能在卡片上看到结果。
          const cardSpec=applyFrameStyleTweaks(preset.spec||DEFAULT_FRAME_SPEC,isActive?frameTweaks:{});
          const desc=describeFrameStyleSpec(cardSpec);
          const thumb=frameThumbs[preset.id];
          // 个人模板带「我的」标记并与系统模板视觉区分（US-009）：卡片上标出来，
          // 「我的模板」管理块里还有重命名 / 删除两个入口（只有个人模板才有）。
          const frameScope=normalizeFramingPreset(preset).scope;
          const isMine=frameScope==='teacher';
          return <button type="button" role="radio" aria-checked={isActive} key={preset.id} className={`frame-style-card${isActive?' active':''}${isMine?' is-mine':''}`} data-frame-style={preset.id} data-frame-style-active={isActive?'true':'false'} data-frame-style-name={preset.name} data-frame-style-scope={frameScope} data-frame-style-mine={isMine?'true':'false'} data-frame-style-shape={desc.shapeId} data-frame-style-color={desc.colorHex} data-frame-style-width={desc.widthRatio===null?'':Number(desc.widthRatio.toFixed(4))} data-frame-style-mat={desc.matVisible?'true':'false'} data-frame-style-builtin={preset.builtin?'true':'false'} data-frame-style-tweaked={isActive&&frameTweakCount?'true':'false'} data-frame-thumb-ready={thumb?'true':'false'} onClick={()=>selectFrameStyle(preset.id)} title={preset.description||preset.name}>
            <span className={`frame-style-thumb is-${desc.shapeId}`} data-frame-thumb={preset.id} style={frameStyleFallbackStyle(desc)}>
              {thumb?<img src={thumb} alt={`${preset.name}：用当前作品实时渲染的装裱缩略图`}/>:<em>{frameThumbSource?'实时渲染中…':'上传作品后显示实时预览'}</em>}
            </span>
            <b>{preset.name}</b>
            <small>{desc.summary}</small>
            {isMine?<i className="frame-style-mine" data-frame-style-mine-badge={preset.id}>{framePresetScopeLabel(preset)}</i>:null}
            {isActive&&frameTweakCount?<i className="frame-style-tweaked">已微调</i>:null}
          </button>;
        })}
      </div>:null}
      {enabledFrames.length?<div className="frame-style-tune" data-frame-tune="true">
        <div className="frame-style-tune-head"><b>继续微调</b><small>微调只作用于本次选用，不写回模板；想留下自己的样式请用「另存为我的模板」。</small></div>
        <div className="frame-style-group" data-frame-tune-group="shape" data-frame-shape-now={frameStyleNow.shapeId}>
          <span>形状</span>
          <div className="frame-style-options">{FRAME_STYLE_SHAPES.map(option=><button type="button" key={option.id} data-frame-shape={option.id} className={frameStyleNow.shapeId===option.id?'active':''} aria-pressed={frameStyleNow.shapeId===option.id} title={option.hint} onClick={()=>setFrameTweak({shape:option.id})}>{option.label}</button>)}</div>
        </div>
        <div className="frame-style-group" data-frame-tune-group="color" data-frame-color-now={frameStyleNow.colorId||frameStyleNow.colorHex}>
          <span>材质色</span>
          <div className="frame-style-options">{FRAME_STYLE_COLORS.map(option=><button type="button" key={option.id} data-frame-color={option.id} className={`frame-style-swatch${frameStyleNow.colorHex===option.hex.toUpperCase()?' active':''}`} aria-pressed={frameStyleNow.colorHex===option.hex.toUpperCase()} title={`${option.label} ${option.hex}`} onClick={()=>setFrameTweak({color:option.id})}><i style={{background:option.hex}}/>{option.label}</button>)}</div>
        </div>
        <div className="frame-style-group" data-frame-tune-group="width" data-frame-width-now={frameStyleNow.widthId||frameStyleNow.widthRatio}>
          <span>框宽</span>
          <div className="frame-style-options">{FRAME_STYLE_WIDTHS.map(option=><button type="button" key={option.id} data-frame-width={option.id} className={frameStyleNow.widthId===option.id?'active':''} aria-pressed={frameStyleNow.widthId===option.id} title={`${option.hint}（画布短边的 ${(option.ratio*100).toFixed(2)}%）`} onClick={()=>setFrameTweak({width:option.id})}>{option.label}</button>)}</div>
        </div>
        <div className="frame-style-group" data-frame-tune-group="mat" data-frame-mat-now={frameStyleNow.matVisible?'on':'off'}>
          <span>卡纸</span>
          <div className="frame-style-options">
            <button type="button" data-frame-mat="on" className={frameStyleNow.matVisible?'active':''} aria-pressed={frameStyleNow.matVisible} onClick={()=>setFrameTweak({matVisible:true})}>卡纸开</button>
            <button type="button" data-frame-mat="off" className={!frameStyleNow.matVisible?'active':''} aria-pressed={!frameStyleNow.matVisible} onClick={()=>setFrameTweak({matVisible:false})}>卡纸关</button>
            {FRAME_STYLE_MAT_COLORS.map(option=><button type="button" key={option.id} data-frame-mat-color={option.id} className={`frame-style-swatch${frameStyleNow.matColorId===option.id?' active':''}`} aria-pressed={frameStyleNow.matColorId===option.id} title={`卡纸${option.label} ${option.hex}`} onClick={()=>setFrameTweak({matColor:option.id})}><i style={{background:option.hex}}/>{option.label}</button>)}
          </div>
        </div>
        <div className="frame-style-tune-foot">
          <em data-frame-tweak-summary={frameTweakSummary}>{frameTweakSummary}</em>
          <button type="button" data-frame-action="reset-tweaks" disabled={!frameTweakCount} onClick={resetFrameTweaks}>重置微调</button>
        </div>
      </div>:null}
      {enabledFrames.length?<div className="frame-preset-mine" data-frame-preset-mine="true" data-frame-preset-mine-count={myTemplateFrames.length}>
        <div className="frame-preset-head">
          <b>我的模板</b>
          <small>{myTemplateFrames.length
            ? `共 ${myTemplateFrames.length} 套；平台与机构模板由管理员在「装裱设置」里维护，老师端不显示这些模板的编辑入口。`
            : '还没有自己的模板：把当前样式（含卡纸、水印、落款与时间规则）存一套，下次进入直接选用。'}</small>
        </div>
        {myTemplateFrames.map(preset=>{
          const editingName=renamingPresetId===preset.id;
          return <div className="frame-preset-row" key={preset.id} data-frame-preset-row={preset.id} data-frame-preset-scope={normalizeFramingPreset(preset).scope}>
            <span className="frame-preset-badge" data-frame-preset-scope-label={framePresetScopeLabel(preset)}>{framePresetScopeLabel(preset)}</span>
            {editingName
              ? <>
                  <input type="text" value={renamePresetValue} data-frame-preset-rename-input={preset.id} aria-label="模板名" onChange={event=>setRenamePresetValue(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();commitRenamePreset(preset)}}}/>
                  <button type="button" data-frame-preset-action={`rename-confirm:${preset.id}`} onClick={()=>commitRenamePreset(preset)}>保存名称</button>
                  <button type="button" data-frame-preset-action={`rename-cancel:${preset.id}`} onClick={()=>setRenamingPresetId('')}>取消</button>
                </>
              : <>
                  <b>{preset.name}</b>
                  <em>{preset.description||'无备注'}</em>
                  <button type="button" data-frame-preset-action={`rename:${preset.id}`} onClick={()=>startRenamePreset(preset)}>重命名</button>
                  <button type="button" className="danger" data-frame-preset-action={`delete:${preset.id}`} onClick={()=>removeMyPreset(preset)}>删除</button>
                </>}
          </div>;
        })}
      </div>:null}
      <div className="frame-preset-save" data-frame-preset-save="true" data-frame-preset-save-busy={myTemplateSaving?'true':'false'}>
        <div className="frame-preset-head">
          <b>另存为我的模板</b>
          <small>保存当前这套样式：相框、卡纸、水印、落款与时间规则；<b>不含</b>对单幅作品的旋转与裁剪（那是这幅作品自己的编辑）。</small>
        </div>
        <div className="frame-preset-fields">
          <label>模板名<input type="text" value={myTemplateForm.name} data-frame-preset-name="true" placeholder="例如：我的暖金细边" onChange={event=>setMyTemplateForm(current=>({...current,name:event.target.value}))}/></label>
          <label>备注（选填）<input type="text" value={myTemplateForm.description} data-frame-preset-note="true" placeholder="例如：结课展用，暖金细边 + 米白卡纸" onChange={event=>setMyTemplateForm(current=>({...current,description:event.target.value}))}/></label>
          <button type="button" data-frame-preset-action="save" disabled={myTemplateSaving} onClick={saveAsMyTemplate}>{myTemplateSaving?'保存中…':'保存为我的模板'}</button>
        </div>
        {myTemplateNotice?<p className="frame-preset-notice" data-frame-preset-notice="true">{myTemplateNotice}</p>:null}
        {/* 审计留痕（[US-013] 第 5 条）：另存为我的模板是一次要留痕的动作 —— 界面如实写出
            这次记下的操作人 / 时间 / 模板 id（学员 id 为空，这条路没有学员）。 */}
        {templateAuditEntry?<p className="frame-preset-audit" data-frame-preset-audit={templateAuditEntry.id}
          data-audit-action={templateAuditEntry.action}
          data-audit-actor={templateAuditEntry.actorId}
          data-audit-student={templateAuditEntry.studentId}
          data-audit-template={templateAuditEntry.templateId}
          data-audit-at={templateAuditEntry.at}
          data-audit-trace={auditTraceText(templateAuditEntry)}
          data-audit-missing={auditEntryMissingFields(templateAuditEntry).join(',')}>
          已写入审计日志：{auditTraceText(templateAuditEntry)} · 模板「{templateAuditEntry.templateName}」
        </p>:null}
      </div>
    </section>
  );
  // ---- 水印 · 落款 · 时间面板（US-007）---------------------------------------------
  // 验收的六件事都落在这块面板上：① 三区（水印：Logo / 文字 / 二维码，落款：姓名 / 寄语 / 签名或印章，
  // 时间：来源 / 格式 / 位置）；② 三区共用**同一个**九宫格控件 `OverlayPositionPad`（点击格子即定位、
  // 在格子上拖动即微调偏移）；③ 面板里的每个输入直接写 `overlayTweaks` → `effectiveFrameSpec`，
  // 所以**没有「应用」按钮**，右侧成品预览当场重画；④ 时间默认取本次课次日期（第一步的课次信息）、
  // 落款默认取当前登录老师姓名；⑤ Logo 与二维码支持上传 / 选择（校验 PNG/JPG、≤512×512、≤200KB）；
  // ⑥ 手机端这块面板是底部抽屉（≤800px 的 CSS），九宫格点击区域 ≥44×44px。
  // 每支元素下面还有一行「渲染为 …」：用的是与绘制层同一份变量替换 / 时间解析 / 二维码目标解析，
  // 老师不用等到出图才知道写进去的变量会变成什么。
  // 选项列表：模板里的值不在预设档里时补一条「模板自定义（原值）」，免得下拉显示成空。
  // 文案由调用方给（字号写 px、比例写百分比，口径不同不能混用同一句）。
  const overlayOptionList=(options,current,customLabel)=>{
    const hit=options.some(option=>Math.abs(Number(option.value)-Number(current))<0.0005);
    if(hit) return options;
    const value=Number(current);
    if(!Number.isFinite(value)) return options;
    return [...options,{id:'custom',label:customLabel?customLabel(value):'模板自定义',value}];
  };
  const overlayRatioCustomLabel=(value)=>`模板自定义（短边的 ${overlayPercentText(value)}）`;
  const overlayFontSizeCustomLabel=(value)=>`模板自定义（${value}px 基准）`;
  const overlayOpacityCustomLabel=(value)=>`模板自定义（${Math.round(value*100)}%）`;
  const overlaySwitch=(card)=>(
    <div className="lesson-overlay-switch" role="group" aria-label={`${card.label}显隐`}>
      <button type="button" data-overlay-toggle={`${card.kind}:on`} className={card.group.visible===true?'active':''} aria-pressed={card.group.visible===true} onClick={()=>card.patch({visible:true})}>开启</button>
      <button type="button" data-overlay-toggle={`${card.kind}:off`} className={card.group.visible!==true?'active':''} aria-pressed={card.group.visible!==true} onClick={()=>card.patch({visible:false})}>关闭</button>
    </div>
  );
  const overlayPadControl=(card)=>(
    <div className="lesson-overlay-pad-row">
      <OverlayPositionPad label={card.label} field={card.kind} value={card.group.position} offsets={card.group} onSelect={position=>selectOverlayPosition(card,position)} onOffsetChange={offsets=>card.patch(offsets)}/>
      <div className="lesson-overlay-offset">
        <b data-overlay-offset={card.kind}>{overlayPositionText(card.group.position)} · {overlayOffsetSummary(card.group)}</b>
        <button type="button" data-overlay-reset-offset={card.kind} disabled={overlayOffsetIsZero(card.group)} onClick={()=>card.patch(OVERLAY_OFFSET_RESET)}>复位偏移</button>
        <small>点格子定位；在格子上按住拖动即可微调偏移（{OVERLAY_OFFSET_RANGE_TEXT} 画布短边）。</small>
      </div>
    </div>
  );
  const overlayRenderLine=(card,text,note)=>(
    <p className="lesson-overlay-render" data-overlay-render={card.kind}><b>渲染为</b><span>{text||'（当前不会绘制）'}</span>{note?<em>{note}</em>:null}</p>
  );
  const overlayBlockedNote=(card)=>{
    if(card.group.visible!==true) return null;
    const blocker=overlayElementBlockerText(card.kind,card.group);
    return blocker?<p className="lesson-overlay-blocked" data-overlay-blocked={card.kind}>{blocker}</p>:null;
  };
  const overlayVariables=OVERLAY_VARIABLES.map(name=>`{${name}}`);
  // 文本类元素的变量占位符提示（FR-19）：点一下把变量插到输入框末尾 —— 提示要能用，不能只是好看。
  const overlayVariableChips=(card,field,current)=>(
    <div className="lesson-overlay-variables" data-overlay-variables={card.kind}>
      <span>支持变量（点一下插入）：</span>
      {OVERLAY_VARIABLES.map(name=><button key={name} type="button" data-overlay-variable={`${card.kind}:${name}`} title={`渲染时替换成当前${name}`} onClick={()=>card.patch({[field]:`${current||''}{${name}}`})}>{`{${name}}`}</button>)}
    </div>
  );
  const overlayColorSwatches=(card,field,current)=>(
    <div className="lesson-overlay-colors" role="group" aria-label={`${card.label}颜色`}>
      {OVERLAY_TEXT_COLORS.map(option=><button key={option.id} type="button" data-overlay-color={`${card.kind}:${option.id}`} className={`frame-style-swatch${String(current||'').toUpperCase()===option.hex.toUpperCase()?' active':''}`} aria-pressed={String(current||'').toUpperCase()===option.hex.toUpperCase()} title={`${option.label} ${option.hex}`} onClick={()=>card.patch({[field]:option.hex})}><i style={{background:option.hex}}/>{option.label}</button>)}
    </div>
  );
  const overlaySizeOptions=(current)=>overlayOptionList(OVERLAY_ELEMENT_SIZE_OPTIONS,current,overlayRatioCustomLabel).map(option=><option key={option.id} value={option.value}>{option.id==='custom'?option.label:`${option.label}（短边的 ${overlayPercentText(option.value)}）`}</option>);
  const overlayFontSizeOptions=(current)=>overlayOptionList(OVERLAY_FONT_SIZE_OPTIONS,current,overlayFontSizeCustomLabel).map(option=><option key={option.id} value={option.value}>{option.id==='custom'?option.label:`${option.label}（${option.value}px 基准）`}</option>);
  const overlayOpacityOptions=(current)=>overlayOptionList(OVERLAY_OPACITY_OPTIONS,current,overlayOpacityCustomLabel).map(option=><option key={option.id} value={option.value}>{option.id==='custom'?option.label:option.label}</option>);
  const overlayAssetInput=(kind,ref)=>(
    <input ref={ref} type="file" accept="image/png,image/jpeg" hidden data-overlay-file={kind} onChange={event=>{const file=event.target.files&&event.target.files[0];if(event.target)event.target.value='';if(file)uploadOverlayAsset(kind,file)}}/>
  );
  const overlayFieldsOf=(card)=>{
    const group=card.group;
    if(card.kind==='logo') return <>
      <div className="lesson-overlay-fields">
        <label>宽度<select data-overlay-field="logo-width" value={group.widthRatio} onChange={event=>card.patch({widthRatio:Number(event.target.value)})}>{overlaySizeOptions(group.widthRatio)}</select></label>
        <label>不透明度<select data-overlay-field="logo-opacity" value={group.opacity} onChange={event=>card.patch({opacity:Number(event.target.value)})}>{overlayOpacityOptions(group.opacity)}</select></label>
      </div>
      <div className="lesson-overlay-asset">
        {overlayAssetInput('logo',overlayLogoInput)}
        <button type="button" data-overlay-action="logo-upload" disabled={overlayAssetBusy==='logo'} onClick={()=>overlayLogoInput.current?.click()}>{overlayAssetBusy==='logo'?'读取中…':(group.url?'重新上传 Logo':'上传 Logo')}</button>
        {group.url?<img className="framing-asset-thumb" src={group.url} alt="机构 Logo 缩略图"/>:null}
        {group.url?<button type="button" className="text-link" data-overlay-action="logo-remove" onClick={()=>removeOverlayAsset('logo')}>移除</button>:null}
        <small className="framing-asset-rules">上传要求：{framingAssetRulesText()}</small>
      </div>
      {overlayAssetError.kind==='logo'?<p className="framing-asset-error" data-overlay-asset-error="logo">{overlayAssetError.message}</p>:null}
      {overlayRenderLine(card,group.url?'机构 Logo 图片（按宽度档等比缩放）':'')}
    </>;
    if(card.kind==='text') return <>
      <div className="lesson-overlay-fields">
        <label className="wide">文字内容<input data-overlay-field="text-content" value={overlayRawValue(card.tweak,'content',group.content)} maxLength={80} placeholder="例如 {机构名}" onChange={event=>card.patch({content:event.target.value})}/></label>
        <label>字号<select data-overlay-field="text-font-size" value={group.fontSize} onChange={event=>card.patch({fontSize:Number(event.target.value)})}>{overlayFontSizeOptions(group.fontSize)}</select></label>
        <label>不透明度<select data-overlay-field="text-opacity" value={group.opacity} onChange={event=>card.patch({opacity:Number(event.target.value)})}>{overlayOpacityOptions(group.opacity)}</select></label>
      </div>
      {overlayColorSwatches(card,'color',group.color)}
      {overlayVariableChips(card,'content',overlayRawValue(card.tweak,'content',group.content))}
      {overlayRenderLine(card,overlayRenderTextOf(group.content))}
    </>;
    if(card.kind==='qr') return <>
      <div className="lesson-overlay-fields">
        <label className="wide">二维码目标<select data-overlay-field="qr-target" value={group.target} onChange={event=>card.patch({target:event.target.value})}>{QR_TARGETS.map(target=><option key={target.key} value={target.key}>{target.label}</option>)}</select></label>
        <label>尺寸<select data-overlay-field="qr-size" value={group.sizeRatio} onChange={event=>card.patch({sizeRatio:Number(event.target.value)})}>{overlaySizeOptions(group.sizeRatio)}</select></label>
        <label className="wide">说明文字<input data-overlay-field="qr-caption" value={overlayRawValue(card.tweak,'caption',group.caption)} maxLength={40} onChange={event=>card.patch({caption:event.target.value})}/></label>
      </div>
      {overlayRenderLine(card,qrTargetSummary(group.target,overlayQrContext))}
      <p className="lesson-overlay-note">{qrTargetRulesText()}</p>
    </>;
    if(card.kind==='signature') return <>
      <div className="lesson-overlay-fields">
        <span className="lesson-overlay-label">形式</span>
        <div className="lesson-overlay-options">{OVERLAY_SIGNATURE_MODE_OPTIONS.map(option=><button key={option.id} type="button" data-overlay-signature-mode={option.id} className={group.mode===option.id?'active':''} aria-pressed={group.mode===option.id} onClick={()=>card.patch({mode:option.id})}>{option.label}</button>)}</div>
      </div>
      <div className="lesson-overlay-fields">
        <label className="wide">姓名 / 落款文字<input data-overlay-field="signature-name" value={overlayRawValue(card.tweak,'teacherName',group.teacherName)} maxLength={40} placeholder={overlaySignatureDefaultName} onChange={event=>card.patch({teacherName:event.target.value})}/></label>
        <label className="wide">寄语（可空，≤60 字）<input data-overlay-field="signature-message" value={overlayRawValue(card.tweak,'message',group.message)} maxLength={60} placeholder="例如：继续用画笔讲你的故事" onChange={event=>card.patch({message:event.target.value})}/></label>
      </div>
      {overlayVariableChips(card,'teacherName',overlayRawValue(card.tweak,'teacherName',group.teacherName))}
      {group.mode==='image'?<div className="lesson-overlay-asset">
        {overlayAssetInput('signature',overlaySignatureInput)}
        <button type="button" data-overlay-action="signature-upload" disabled={overlayAssetBusy==='signature'} onClick={()=>overlaySignatureInput.current?.click()}>{overlayAssetBusy==='signature'?'读取中…':(group.imageUrl?'重新上传签名图':'上传签名图')}</button>
        {group.imageUrl?<img className="framing-asset-thumb" src={group.imageUrl} alt="手写签名图缩略图"/>:null}
        {group.imageUrl?<button type="button" className="text-link" data-overlay-action="signature-remove" onClick={()=>removeOverlayAsset('signature')}>移除</button>:null}
        <label>宽度<select data-overlay-field="signature-width" value={group.imageWidthRatio} onChange={event=>card.patch({imageWidthRatio:Number(event.target.value)})}>{overlaySizeOptions(group.imageWidthRatio)}</select></label>
        <small className="framing-asset-rules">上传要求：{framingAssetRulesText()}（建议 PNG 透明底的手写签名）</small>
      </div>:null}
      {overlayAssetError.kind==='signature'?<p className="framing-asset-error" data-overlay-asset-error="signature">{overlayAssetError.message}</p>:null}
      <div className="lesson-overlay-fields">
        <label>字体<select data-overlay-field="signature-font" value={group.fontFamily} onChange={event=>card.patch({fontFamily:event.target.value})}>{FRAMING_FONT_WHITELIST.map(font=><option key={font} value={font}>{font}</option>)}</select></label>
        <label>字号<select data-overlay-field="signature-font-size" value={group.fontSize} onChange={event=>card.patch({fontSize:Number(event.target.value)})}>{overlayFontSizeOptions(group.fontSize)}</select></label>
      </div>
      {overlayColorSwatches(card,'color',group.color)}
      <div className="lesson-overlay-fields">
        <span className="lesson-overlay-label">印章</span>
        <div className="lesson-overlay-options">
          {/* 印章是落款的一部分：落款关着时印章不会绘制（绘制层只画 visible 的元素），
              所以「印章开」顺手把落款也打开 —— 否则老师点完看不到任何变化。 */}
          <button type="button" data-overlay-seal="on" className={group.seal.visible?'active':''} aria-pressed={group.seal.visible} onClick={()=>applySignatureTweak({visible:true},{visible:true})}>印章开</button>
          <button type="button" data-overlay-seal="off" className={!group.seal.visible?'active':''} aria-pressed={!group.seal.visible} onClick={()=>applySignatureTweak({},{visible:false})}>印章关</button>
          {OVERLAY_SEAL_SHAPE_OPTIONS.map(option=><button key={option.id} type="button" data-overlay-seal-shape={option.id} className={group.seal.shape===option.id?'active':''} aria-pressed={group.seal.shape===option.id} disabled={!group.seal.visible} onClick={()=>applySignatureTweak({},{shape:option.id})}>{option.label}</button>)}
        </div>
        <label className="wide">印章文字<input data-overlay-field="seal-text" value={overlayRawValue(card.tweak.seal,'text',group.seal.text)} maxLength={20} disabled={!group.seal.visible} onChange={event=>applySignatureTweak({},{text:event.target.value})}/></label>
      </div>
      {overlayRenderLine(card,group.mode==='image'
        ?(group.imageUrl?'手写签名图（按宽度档等比缩放）':'')
        :[overlayRenderTextOf(group.teacherName),overlayRenderTextOf(group.message)].filter(Boolean).join(' · '),
        group.seal.visible?`印章：${group.seal.text||'—'}（${group.seal.shape==='round'?'圆形':'方形'}）`:'')}
    </>;
    return <>
      <div className="lesson-overlay-fields">
        <label>来源<select data-overlay-field="date-source" value={group.source} onChange={event=>changeDateSource(event.target.value)}>{DATE_SOURCES.map(source=><option key={source} value={source}>{DATE_SOURCE_LABELS[source]||source}</option>)}</select></label>
        <label>格式<select data-overlay-field="date-format" value={group.format} onChange={event=>card.patch({format:event.target.value})}>{DATE_FORMATS.map(format=><option key={format} value={format}>{format}</option>)}</select></label>
        <label className="wide">前缀<input data-overlay-field="date-prefix" value={overlayRawValue(card.tweak,'prefix',group.prefix)} maxLength={20} onChange={event=>card.patch({prefix:event.target.value})}/></label>
        {group.source==='manual'?<label className="wide">手动日期<input type="date" data-overlay-field="date-manual" value={manualDateInputValue(overlayRawValue(card.tweak,'manualValue',group.manualValue))} onChange={event=>card.patch({manualValue:event.target.value})}/></label>:null}
        <label>字号<select data-overlay-field="date-font-size" value={group.fontSize} onChange={event=>card.patch({fontSize:Number(event.target.value)})}>{overlayFontSizeOptions(group.fontSize)}</select></label>
      </div>
      {overlayColorSwatches(card,'color',group.color)}
      {overlayRenderLine(card,overlayDateRenderText,overlayLessonDate?`本次课次日期：${overlayLessonDate}`:'')}
      <p className="lesson-overlay-note">时间默认取本次课次日期（第一步的课次信息，当前：{overlayLessonDate||'未选择'}），可以切换成生成当天或手动填写。</p>
    </>;
  };
  const overlayElementCard=(card)=>(
    <div key={card.kind} className={`lesson-overlay-element${card.group.visible===true?' is-on':''}`} data-overlay-element={card.kind} data-overlay-element-visible={card.group.visible===true?'true':'false'} data-overlay-position={card.group.position} data-overlay-offset={`${card.group.offsetX},${card.group.offsetY}`}>
      <div className="lesson-overlay-element-head">
        <b>{card.label}</b>
        <em data-overlay-element-state={card.kind}>{card.group.visible===true?'已开启':'未开启'}</em>
        {overlaySwitch(card)}
      </div>
      {overlayPadControl(card)}
      {overlayBlockedNote(card)}
      {overlayFieldsOf(card)}
    </div>
  );
  const overlayPanelTrigger=(
    <button type="button" className="lesson-overlay-trigger" data-overlay-action="open" aria-expanded={overlayDrawerOpen} onClick={()=>{setStudioDrawer('');setOverlayDrawerOpen(true)}}>
      <Sparkles size={15}/>水印 · 落款 · 时间
      <em data-overlay-trigger-summary={overlayTweakSummaryText}>{overlayTweakCountValue?`已调整 ${overlayTweakCountValue} 项`:'跟随模板'}</em>
    </button>
  );
  const overlayPreviewSrc=overlayUsesClassPreview?(overlayPreview||''):(media.artwork?.framedUrl||media.artwork?.cleanUrl||media.artwork?.originalUrl||'');
  const overlayPreviewNote=overlayUsesClassPreview
    ?(overlayPreview?'用本班第一幅已上传作品实时渲染的成品预览（逐幅套用是后续「批量应用装裱」的范围）。':'上传作品后这里显示实时成品预览。')
    :(media.artwork?.framedUrl?'本次装裱的成品图：面板里改任何一项，这张图会立刻重画。':'完成装裱后这里显示成品图（当前显示的是待装裱的画心）。');
  // ---- 保存图片（[第二步 US-008a] / [US-008b] / FR-25 / FR-26）------------------------
  // 两档输出（高清 PNG / 微信 JPG）的口径、文件名规则与导出画布计划全在 `data/artworkExport.js`；
  // 渲染与编码在 `services/artworkExport.js`。这里只做编排：
  //   ① 合成 → 按 UA 选保存路径（US-008a，下载）；
  //   ② 把成品图 + 溯源记录写回**本次课后反馈的作品位**（US-008b，让点评页与 3D 画廊用新图）。
  // 两步互不阻断：下载成功即成功，写回失败只提示「可重试」（PRD 原文口径）。
  const [saveImageState,setSaveImageState]=useState({status:'idle',quality:'',message:''});
  // 长按保存那一档要先把图显示出来（iOS Safari / 微信不执行 blob 下载）：这张 object URL 用完必须回收。
  const [saveImagePreview,setSaveImagePreview]=useState(null);
  // 保存路径由 UA 判据决定（判据本身是 data 层的纯函数）：桌面 / Android 走 `<a download>`，
  // iOS Safari 与微信内置浏览器走「长按保存」提示页 —— 面板上要如实写出当前这一档走哪条路。
  const saveImageStrategy=artworkExportStrategy(typeof navigator==='undefined'?'':navigator.userAgent);
  // 导出用的作品与展签数据：与面板预览（US-006 缩略图 / US-007 实时预览）同一条口径 ——
  // 个人反馈用当前画心，班级反馈用本班第一幅已上传作品（逐幅拍摄/裁剪/导出是 US-010 的范围）。
  // 名字一律取展签上的那份（`framePlaque` / 上传绑定）：文件名里写的学员名与图上印的必须是同一份，
  // 否则老师发出去的文件名和照片里的名字对不上（模板把「展签人名」填成固定值时两者也一起变）。
  const saveImageUsesClassArtwork=mode!=='个人反馈';
  const saveImageSource=saveImageUsesClassArtwork?(batchUploads.artwork[0]?.url||''):(media.artwork?.cleanUrl||'');
  const saveImagePlaque=saveImageUsesClassArtwork
    ?{student:frameThumbStudent,title:frameThumbTitle,date:frameThumbDate}
    :{student:thumbPlaque.student,title:thumbPlaque.title,date:thumbPlaque.date};
  // 写回记录里的学员 id：个人反馈取选中学员，班级反馈取那条上传条目的归属学员（都是「作品位的主人」）。
  const writeBackStudentId=saveImageUsesClassArtwork
    ?(batchUploads.artwork[0]?.studentId||'')
    :(selectedParticipant?.studentId||effectiveParticipants[0]?.studentId||'');
  // 「现在能不能存」：个人反馈要等画心裁好（装裱的输入），班级反馈要至少有一幅本班作品。
  // 门槛同时写在按钮 disabled 与保存函数里 —— 与 US-410 同一条纪律（旁路入口不能被 disabled 兜住）。
  const saveImageReady=Boolean(saveImageSource)&&(saveImageUsesClassArtwork?batchUploads.artwork.length>0:ARTWORK_CLEAN_ALGORITHMS.includes(media.artwork?.cleanAlgorithm));
  const saveImageSubjectLabel=`${saveImagePlaque.student||'未选学员'} · ${saveImagePlaque.title?`《${saveImagePlaque.title}》`:'未填作品名'} · ${lessonDateDots?`创作于 ${lessonDateDots}`:'未填课次日期'}`;
  const saveImageFileNamePreview=artworkExportFilename({
    student:saveImagePlaque.student,
    title:saveImagePlaque.title,
    lessonDate:lessonDateDots,
    quality:saveImageState.status==='saved'&&saveImageState.quality?saveImageState.quality:'hd'
  });
  const closeSaveImagePreview=()=>{
    setSaveImagePreview(current=>{releaseArtworkExportUrl(current?.url);return null});
  };
  // 保存与「重试写回」都走这一个合成入口：两处的输入必须一模一样，
  // 否则重试写回的那张图会和老师手上那份不是同一张（画面不同比没有更糟）。
  const composeSaveImageExport=(entry)=>composeArtworkExport({
    source:saveImageSource,
    spec:effectiveFrameSpec,
    student:saveImagePlaque.student,
    title:saveImagePlaque.title,
    date:saveImagePlaque.date,
    lessonDate:lessonDateDots,
    rotation:0,
    orgName:DEFAULT_ORG_NAME,
    teacherName:currentTeacherName,
    quality:entry.id
  });
  // ---- 成品图写回作品位（[第二步 US-008b]）------------------------------------------
  // 规则（写回口径、字段白名单、新鲜度键、失败文案）在 `data/artworkWriteBack.js`，
  // 这里只做编排：编持久副本 → 造记录 → 写进作品位 → 同步已归档的那条记录。
  //
  // 写回的作品位 = 本次导出的那一幅：个人反馈是 `media.artwork`（当前画心），
  // 班级反馈是刚导出的那条上传条目（本班第一幅，与缩略图 / 预览 / 导出口径一致）。
  const writeBackSlot=saveImageUsesClassArtwork?(batchUploads.artwork[0]||null):(media.artwork||null);
  const writeBackRecord=artworkWriteBackOf(writeBackSlot);
  // 新鲜度键：装裱参数 + 底图地址 + 图上会印的变量（学员名 / 作品名 / 课次日期 / 老师 / 机构）。
  // 任何一项变了，旧的写回图都算过期 —— 消费点退回实时渲染，面板提示「重新保存即可更新档案」。
  const writeBackKey=artworkWriteBackKey({
    specKey:activeFrameSpecKey,
    sourceUrl:saveImageSource,
    student:saveImagePlaque.student,
    title:saveImagePlaque.title,
    lessonDate:lessonDateDots,
    teacherName:currentTeacherName,
    orgName:DEFAULT_ORG_NAME,
    rotation:saveImageUsesClassArtwork?(batchUploads.artwork[0]?.rotation||0):0
  });
  const writeBackFresh=artworkWriteBackIsFresh(writeBackRecord,writeBackKey);
  const writeBackStale=Boolean(writeBackRecord)&&!writeBackFresh;
  const writeBackProvenance=writeBackRecord?artworkWriteBackProvenanceEntries(writeBackRecord):[];
  // 溯源四项的完整性读数（[US-013] 第 3 条）：参数快照 / 原图 / 操作人 / 生成时间，缺一项就点名。
  const writeBackTrace=artworkWriteBackTraceability(writeBackRecord);
  // 五维点评页 / 成长档案该显示哪一张成品图（US-008b 的验收：「保存后点评页立即使用新图」）：
  // 写过回且没过期就用写回的那张；过期（老师改过参数）时退回实时渲染的 framedUrl —— 过期图不冒充新图。
  // 窗口内所有消费点都读这两个派生值，别各自去读 media.artwork.framedUrl。
  const reviewWrittenBackUrl=writtenBackImageUrl(media.artwork,writeBackKey);
  const reviewFramedSrc=reviewWrittenBackUrl||media.artwork?.framedUrl||'';
  // 作品位的**耐用状态**（有没有写回、是否新鲜）与「最近一次尝试的状态」分开报：
  // 面板顶上的状态口径 = 最近一次尝试失败就报 failed（要先处理它），否则报作品位的状态。
  // 两个都挂在 DOM 上（`data-save-image-writeback-status` / `-slot`），断言与界面各读各的。
  const writeBackSlotStatus=writeBackFresh?'synced':(writeBackRecord?'stale':'idle');
  const writeBackStatus=writeBackAttempt.status==='writing'?'writing':(writeBackAttempt.status==='failed'?'failed':writeBackSlotStatus);
  const writeBackStatusLabel=writeBackStatus==='writing'?'正在写回…'
    :writeBackStatus==='synced'?'已写回本次课后反馈'
      :writeBackStatus==='failed'?'未能同步到档案 · 可重试'
        :writeBackStatus==='stale'?'参数已改动 · 待更新':'保存后自动写回';
  // 图上会印的变量 + 装裱参数的一句话摘要：写进溯源记录（面板与归档摘要都读它，不各写一遍）。
  const writeBackSpecSummary=`${frameStyleNow}${overlayEnabledCountValue?` · ${overlayEnabledText}`:''}`;
  /**
   * 把已经合成好的成品图写回本次课后反馈的作品位（US-008b）。
   *
   * 顺序刻意与下载**分开**：下载（US-008a）先跑完，这里再写回；
   * 写回失败只改提示与状态，**不撤回、不阻断**老师手上已经存好的文件（PRD 明文要求）。
   * 返回值：成功时是写回记录，失败时 null（调用方不需要再判断）。
   */
  const performArtworkWriteBack=async({result,entry,plaque,source})=>{
    setWriteBackAttempt({status:'writing',quality:entry.id,message:`正在把成品图写回档案（${ARTWORK_WRITE_BACK_IMAGE.label}）…`});
    try{
      const image=await encodeArtworkWriteBackImage({canvas:result.canvas});
      const record=buildArtworkWriteBack({
        imageUrl:image.url,
        imageWidth:image.width,
        imageHeight:image.height,
        // 溯源四项的第一项：当时的模板参数（整份渲染视图，配 specKey 可复现这一张图）
        specSnapshot:effectiveFrameSpec,
        specKey:activeFrameSpecKey,
        specSummary:writeBackSpecSummary,
        sourceUrl:source,
        generatedAt:new Date().toISOString(),
        // 原型阶段没有账号体系：会话身份串就是操作人（`roleMeta.teacher.name`，与课次 teacherId 同一口径）
        operatorId:currentTeacherName,
        operatorName:currentTeacherName,
        quality:entry.id,
        qualityLabel:entry.label,
        filename:result.filename,
        bytes:result.bytes,
        width:result.width,
        height:result.height,
        lessonId:currentLessonId,
        lessonDate:lessonDateDots,
        studentId:writeBackStudentId,
        studentName:plaque.student,
        title:plaque.title,
        // 这套成品图用的是哪套装裱模板（US-011b）：后台删除模板前的「历史成品引用」判据。
        presetId:activeFrame?.id||'',
        renderKey:writeBackKey
      });
      const problem=artworkWriteBackProblem(record);
      if(problem) throw new Error(problem);
      // ① 作品位：个人反馈写 media.artwork，班级反馈写那条上传条目（走 updateUploadEntry，
      //    因此 writeBack 必须在 createUploadEntry 的白名单里，否则会被静默丢掉）。
      if(saveImageUsesClassArtwork){
        const target=batchUploads.artwork[0];
        if(!target) throw new Error('本次导出的作品位已不在素材列表里');
        setBatchUploads(current=>({...current,artwork:updateUploadEntry(current.artwork,target.uploadId,{writeBack:record})}));
      }else{
        setMedia(current=>({...current,artwork:applyWriteBackToSlot(current.artwork,record)}));
      }
      // ② 已经归档过的记录就地更新：3D 画廊读的就是这条记录（重新进入第二步改完再保存的场景）。
      if(currentRecordId){
        setRecords(list=>list.map(item=>item.id===currentRecordId?{...item,framedArtwork:record}:item));
      }
      const suffix=currentRecordId?'（成长档案已同步更新）':'（归档时会带着它一起进成长档案）';
      setWriteBackAttempt({status:'synced',quality:entry.id,message:`成品图已写回本次课后反馈：${artworkWriteBackSummaryText(record)}${suffix}`});
      return record;
    }catch(error){
      // PRD 口径：下载已经成功，只是没同步进档案 —— 提示可重试，绝不提「保存失败」。
      const message=artworkWriteBackFailureText(String(error?.message||'未知原因'));
      setWriteBackAttempt({status:'failed',quality:entry.id,message});
      setToast(message);
      return null;
    }
  };
  /** 重试写回：只重跑「写回」这一段（不重新下载 —— 老师手上那份文件已经存好了）。 */
  const retryArtworkWriteBack=async()=>{
    if(writeBackAttempt.status==='writing') return;
    if(!saveImageReady){
      setToast(saveImageUsesClassArtwork?'请先在本班上传至少一幅作品，再保存图片。':'请先完成作品的裁剪与装裱，再保存图片。');
      return;
    }
    const entry=ARTWORK_EXPORT_QUALITIES.find(item=>item.id===writeBackAttempt.quality)||ARTWORK_EXPORT_QUALITIES[0];
    try{
      const result=await composeSaveImageExport(entry);
      await performArtworkWriteBack({result,entry,plaque:saveImagePlaque,source:saveImageSource});
    }catch(error){
      const message=artworkWriteBackFailureText(String(error?.message||'重新合成失败'));
      setWriteBackAttempt({status:'failed',quality:entry.id,message});
      setToast(message);
    }
  };
  const saveArtworkImage=async(quality)=>{
    if(saveImageState.status==='saving') return;
    if(!saveImageReady){
      setToast(saveImageUsesClassArtwork?'请先在本班上传至少一幅作品，再保存图片。':'请先完成作品的裁剪与装裱，再保存图片。');
      return;
    }
    const entry=ARTWORK_EXPORT_QUALITIES.find(item=>item.id===quality)||ARTWORK_EXPORT_QUALITIES[0];
    setSaveImageState({status:'saving',quality:entry.id,message:`正在按「${entry.label}」合成（${entry.summary}）…`});
    setWriteBackAttempt({status:'idle',quality:'',message:''});
    let result=null;
    try{
      result=await composeSaveImageExport(entry);
    }catch(error){
      const message=String(error?.message||'图片合成失败，请稍后重试。');
      setSaveImageState({status:'error',quality:entry.id,message});
      setToast(message);
      return;
    }
    const measure=`${result.width}×${result.height}·${result.sizeText}${result.qualityUsed?`·质量${result.qualityUsed}`:''}`;
    // ① 下载（US-008a）：保存路径按 UA 判据分流 —— 常规浏览器 `<a download>` 真下载；
    //    iOS Safari 与微信内置浏览器会忽略 blob 下载，降级为「长按图片保存」的提示页。
    const strategy=artworkExportStrategy(typeof navigator==='undefined'?'':navigator.userAgent);
    if(strategy.mode==='download'){
      const savedName=downloadArtworkExport(result);
      setSaveImageState({status:'saved',quality:entry.id,message:`已保存「${savedName}」（${measure}）到「下载」文件夹。`});
      setToast(`已保存 ${result.qualityLabel}：${savedName}`);
    }else{
      closeSaveImagePreview();
      setSaveImagePreview({url:createArtworkExportUrl(result),filename:result.filename,bytes:result.bytes,width:result.width,height:result.height,hint:strategy.hint,quality:entry.id});
      setSaveImageState({status:'preview',quality:entry.id,message:`已合成本图（${measure}）——${strategy.hint}`});
    }
    // ② 审计留痕（[US-013] 第 5 条）：保存图片是一次要留痕的动作 —— 操作人 / 学员 id / 时间 / 模板 id。
    //    记在**下载成功之后**（这一步才是「保存图片」这个动作本身）；写回失败不影响这条回执。
    auditTeacherEntry({
      action:AUDIT_ACTIONS.artworkSave,
      studentId:writeBackStudentId,
      studentName:saveImagePlaque.student,
      lessonId:currentLessonId,
      lessonDate:lessonDateDots,
      templateId:activeFrameId,
      templateName:activeFrame?.name||'',
      scope:normalizeFramingPreset(activeFrame).scope,
      detail:`保存图片「${entry.label}」（${measure}）${result.filename?`· ${result.filename}`:''}`
    });
    // ③ 写回作品位 + 溯源记录（US-008b）：await 它只是为了让提示有序，
    //    失败也**不影响**上面已经完成的下载（内部自己 catch 并给「可重试」）。
    await performArtworkWriteBack({result,entry,plaque:saveImagePlaque,source:saveImageSource});
  };
  // 离开第二步就把长按保存的提示页收掉并回收 object URL（不回收的话，同一张 blob 会一直占着内存）。
  useEffect(()=>{
    if(step!==2) closeSaveImagePreview();
  },[step]);
  // 底部抽屉是第二步自己的界面态：离开这一步就收起（回来时不会莫名停在一个打开的抽屉上）。
  useEffect(()=>{
    if(step!==2) setStudioDrawer('');
  },[step]);
  const saveImagePanel=(
    <section className={`save-image-panel${studioDrawer==='save'?' is-open':''}`} data-save-image-panel="true" data-studio-drawer="save" data-studio-drawer-open={studioDrawer==='save'?'true':'false'} data-save-image-status={saveImageState.status} data-save-image-quality={saveImageState.quality} data-save-image-ready={saveImageReady?'true':'false'} data-save-image-strategy={saveImageStrategy.mode} data-save-image-filename={saveImageFileNamePreview} data-save-image-subject={saveImageSubjectLabel} data-save-image-source={saveImageUsesClassArtwork?'class':'personal'}>
      {studioDrawerHead('save')}
      <div className="save-image-head">
        <b>保存图片</b>
        <em className="save-image-subject" data-save-image-subject-summary={saveImageSubjectLabel}>{saveImageSubjectLabel}</em>
        <small>两档输出：高清 PNG 保留裁剪后的原始像素（长边 ≤ {ARTWORK_EXPORT_QUALITIES.find(item=>item.id==='hd')?.maxLongEdge}px）留档；微信 JPG 长边 1600px、质量 0.85、体积 ≤ 1MB 直接发家长。文件名规则：学员名_作品名_课次日期_装裱。</small>
      </div>
      {saveImageReady?null:<p className="save-image-hint" data-save-image-hint="true">{saveImageUsesClassArtwork?'本班还没有已上传的作品，先回第一步给孩子们上传作品，再回来保存图片。':'先在下方完成「方向正确，开始裁剪与装裱」，这一档才能合成（导出用的是裁剪后的画心）。'}</p>}
      <div className="save-image-actions">
        {ARTWORK_EXPORT_QUALITIES.map(entry=>(
          <button type="button" key={entry.id} className={`save-image-action${saveImageState.quality===entry.id&&saveImageState.status!=='idle'?' is-active':''}`} data-save-image-action={entry.id} disabled={!saveImageReady||saveImageState.status==='saving'} onClick={()=>saveArtworkImage(entry.id)}>
            <b>{saveImageState.status==='saving'&&saveImageState.quality===entry.id?'正在合成…':entry.actionLabel}</b>
            <small>{entry.summary}</small>
          </button>
        ))}
      </div>
      <p className="save-image-name" data-save-image-name-preview={saveImageFileNamePreview}>文件名预览：<code>{saveImageFileNamePreview}</code></p>
      <p className="save-image-platform" data-save-image-platform-note={saveImageStrategy.mode}>{saveImageStrategy.hint}（{saveImageStrategy.mode==='download'?'直接下载':'长按保存'}）· 保存成功后会同时把成品图写回本次课后反馈（见下方「写回课次作品位」）。</p>
      {saveImageState.message?<p className={`save-image-message is-${saveImageState.status}`} data-save-image-message={saveImageState.message}>{saveImageState.message}</p>:null}
      {/* 成品图写回（US-008b）：写回的图 + 四项溯源（参数快照 / 原图 / 生成时间 / 操作人）。
          「写回失败不阻断下载」的那条降级也在这里给出口：状态 + 一句可读提示 + 重试按钮。 */}
      <div className={`save-image-writeback is-${writeBackStatus}`} data-save-image-writeback="true" data-save-image-writeback-status={writeBackStatus} data-save-image-writeback-slot={writeBackSlotStatus} data-save-image-writeback-fresh={writeBackFresh?'true':'false'} data-save-image-writeback-summary={writeBackRecord?artworkWriteBackSummaryText(writeBackRecord):''} data-save-image-writeback-image={writeBackRecord?artworkUrlFingerprint(writeBackRecord.imageUrl):''} data-save-image-writeback-record-id={currentRecordId||''}>
        <div className="save-image-writeback-head">
          <b>写回课次作品位</b>
          <em data-save-image-writeback-state={writeBackStatus}>{writeBackStatusLabel}</em>
        </div>
        <p className="save-image-writeback-summary" data-save-image-writeback-line={writeBackRecord?artworkWriteBackSummaryText(writeBackRecord):''}>
          {writeBackRecord
            ? (writeBackFresh
              ? (writeBackAttempt.status==='failed'
                ? `本次写回没成功（原因见下），档案里仍是上一次写回的成品图：${artworkWriteBackSummaryText(writeBackRecord)}`
                : `成品图已写回，五维点评页与 3D 画廊立即使用这张图：${artworkWriteBackSummaryText(writeBackRecord)}`)
              : `档案里还是上一版的成品图（你改过装裱参数或变量）。重新保存一次即可更新档案：${artworkWriteBackSummaryText(writeBackRecord)}`)
            : '保存图片后，成品图会写回本次课后反馈的作品位；五维点评页与 3D 画廊立即使用新图。'}
        </p>
        {writeBackRecord&&artworkWriteBackContextText(writeBackRecord)?<p className="save-image-writeback-context" data-save-image-writeback-context={artworkWriteBackContextText(writeBackRecord)}>这份成品图属于：{artworkWriteBackContextText(writeBackRecord)}</p>:null}
        <p className="save-image-writeback-note">{artworkWriteBackImageRulesText()}</p>
        {/* 溯源完整性（[US-013] 第 3 条）：任意一张成品图都要能说出
            「哪张原图 + 哪套参数 + 谁生成的 + 什么时候」。缺项就在这里点名，不粉饰。 */}
        {writeBackRecord?<p className={`save-image-writeback-trace${writeBackTrace.complete?' is-ok':' is-missing'}`}
          data-save-image-writeback-trace="true"
          data-save-image-trace-complete={writeBackTrace.complete?'true':'false'}
          data-save-image-trace-missing={writeBackTrace.missing.join(',')}
          data-save-image-trace-text={artworkWriteBackTraceText(writeBackRecord)}>
          {artworkWriteBackTraceText(writeBackRecord)}
        </p>:null}
        {/* 审计留痕（[US-013] 第 5 条）：保存图片 → 操作人 / 学员 id / 时间 / 模板 id。 */}
        {artworkAuditEntry?<p className="save-image-audit" data-save-image-audit={artworkAuditEntry.id}
          data-audit-action={artworkAuditEntry.action}
          data-audit-actor={artworkAuditEntry.actorId}
          data-audit-student={artworkAuditEntry.studentId}
          data-audit-template={artworkAuditEntry.templateId}
          data-audit-at={artworkAuditEntry.at}
          data-audit-trace={auditTraceText(artworkAuditEntry)}
          data-audit-missing={auditEntryMissingFields(artworkAuditEntry).join(',')}>
          已写入审计日志：{auditTraceText(artworkAuditEntry)}
        </p>:null}
        {writeBackAttempt.status==='failed'?<p className="save-image-writeback-error" data-save-image-writeback-error={writeBackAttempt.message}>{writeBackAttempt.message}</p>:null}
        {writeBackAttempt.message&&writeBackAttempt.status!=='failed'&&(writeBackAttempt.status==='writing'||writeBackRecord)?<p className="save-image-writeback-message" data-save-image-writeback-message={writeBackAttempt.message}>{writeBackAttempt.message}</p>:null}
        {writeBackProvenance.length?<div className="save-image-writeback-provenance" data-save-image-writeback-provenance="true">
          <details>
            <summary>溯源记录（参数快照 / 原图 / 生成时间 / 操作人）</summary>
            <ul>
              {writeBackProvenance.map(item=><li key={item.key} data-writeback-provenance={item.key}>
                <b>{item.label}</b>
                <em data-writeback-provenance-value={item.key}>{item.value}</em>
                {item.key==='specSnapshot'?<details className="save-image-writeback-snapshot"><summary>参数快照 JSON</summary><pre data-writeback-spec-snapshot="true">{item.detail}</pre></details>:null}
                {item.detail&&item.key==='sourceUrl'?<small data-writeback-source-url={item.detail}>{item.detail.startsWith('data:')?'（原图是本机数据地址，正文省略）':item.detail}</small>:null}
              </li>)}
            </ul>
          </details>
        </div>:null}
        <div className="save-image-writeback-actions">
          {writeBackAttempt.status==='failed'?<button type="button" data-save-image-writeback-retry="true" disabled={!saveImageReady} onClick={retryArtworkWriteBack}>重试写回</button>:null}
          {writeBackStale&&writeBackAttempt.status!=='writing'?<button type="button" data-save-image-writeback-refresh="true" disabled={!saveImageReady} onClick={()=>saveArtworkImage(writeBackAttempt.quality||'hd')}>重新保存并更新档案</button>:null}
        </div>
      </div>
    </section>
  );
  // 「装裱性能」面板（US-012）：四项验收指标的**实测读数**与预算一起显示。
  // 结论全部来自 `data/framingPerformance.js`（同一份也进浏览器断言），面板只挑字段渲染。
  // 顶上是设备口径徽标：桌面（800ms）/ 手机（1.5s）两档预算由视口与 UA 决定。
  const framingPerfPanel=(
    <section className="framing-perf-panel" data-framing-perf="true" data-framing-profile={deviceProfile.id} data-framing-profile-label={deviceProfile.label} data-framing-profile-reasons={deviceProfile.reasons.join(' / ')} data-framing-compose-budget={framingComposeBudgetMs(deviceProfile)} data-framing-edit-base-edge={EDIT_BASE_MAX_EDGE} data-framing-min-fps={EDIT_DRAG_MIN_FPS} data-framing-memory-budget={FRAMING_MEMORY_BUDGET_MB} data-framing-drawer-breakpoint={STUDIO_DRAWER_MAX_WIDTH} data-framing-perf-measured={framingPerf.measured} data-framing-perf-total={framingPerf.total} data-framing-perf-all-ok={framingPerf.measured===framingPerf.total&&framingPerf.allOk?'true':'false'}>
      <div className="framing-perf-head">
        <b>装裱性能</b>
        <em data-framing-perf-profile={deviceProfile.id}>{deviceProfile.label}口径 · 合成预算 {framingComposeBudgetMs(deviceProfile)}ms</em>
        <em className="framing-perf-summary" data-framing-perf-summary={framingPerf.summary}>{framingPerf.summary}</em>
        <small>口径判据：{deviceProfile.reasons.length?deviceProfile.reasons.join(' / '):'桌面视口（无手机 UA / 触摸屏 / 窄屏）'}。四项预算 —— 1800px 合成 {framingComposeBudgetMs(deviceProfile)}ms、原图加载与显示 {formatPerfMs(EDIT_BASE_LOAD_BUDGET_MS)}（先降采样到长边 {EDIT_BASE_MAX_EDGE}px）、编辑拖动 ≥{EDIT_DRAG_MIN_FPS}fps、内存峰值 ≤{FRAMING_MEMORY_BUDGET_MB}MB。</small>
      </div>
      <ul className="framing-perf-list">
        {framingPerf.rows.map(row=><li key={row.id} data-perf-check={row.id} data-perf-state={row.ok===null?'pending':(row.ok?'ok':'over')} data-perf-value={row.value} data-perf-budget={row.budget} data-perf-text={row.text}>
          <b>{row.label}</b>
          <em>{row.text}</em>
        </li>)}
      </ul>
    </section>
  );
  // 长按保存提示页：iOS Safari / 微信内置浏览器不执行 blob 下载，把图显示出来并明确写出怎么存。
  const saveImageSheet=saveImagePreview?(
    <div className="save-image-sheet" data-save-image-sheet="true" data-save-image-sheet-name={saveImagePreview.filename} data-save-image-sheet-quality={saveImagePreview.quality}>
      <div className="save-image-sheet-card">
        <div className="save-image-sheet-head">
          <b>{saveImagePreview.filename}</b>
          <small data-save-image-sheet-measure={`${saveImagePreview.width}×${saveImagePreview.height}·${saveImagePreview.bytes}`}>{saveImagePreview.width}×{saveImagePreview.height} · {artworkExportSizeText(saveImagePreview.bytes)}</small>
        </div>
        <img src={saveImagePreview.url} alt={`${saveImagePreview.filename} 预览（长按可保存）`} data-save-image-preview="true"/>
        <p className="save-image-sheet-hint" data-save-image-sheet-hint={saveImagePreview.hint}>{saveImagePreview.hint}</p>
        <div className="save-image-sheet-actions">
          <Button variant="secondary" onClick={closeSaveImagePreview}>关闭</Button>
        </div>
      </div>
    </div>
  ):null;
  // ---- 班级批量应用装裱（[第二步 US-010]）---------------------------------------------
  // 老师带 18 人班时的主操作：选一套模板 → 一次应用到本班已上传的**全部**作品。
  // 三块拼图各有各的真源，别互相抄：
  //   ① 目标分类（要装 / 已是最新 / 已单独调整 / 素材不可读）与状态机、文案 → `data/batchFraming.js`；
  //   ② 「渲染一幅作品 → 档案持久副本」→ `services/batchFraming.js`（与单幅保存同一条渲染路径）；
  //   ③ 循环、进度、取消、失败清单与写回哪条素材 → 这里（串行渲染：一次只画一幅，页面始终可滚动）。
  // 姓名与作品名一律取**作品所属学员**（`batchFramingVariablesOf`），与「当前选中的学员」无关 —— 这就是
  // 验收里的「不串名」；未绑定学员的作品照常装裱，只是展签上不会出现姓名。
  const batchFramingPreset=enabledFrames.find(item=>item.id===batchFramingPresetId)||activeFrame||enabledFrames[0]||null;
  // 选中的这套若正是「当前选用」的那套，就带上本次微调与叠加元素补丁（与缩略图网格同一口径：
  // 当前选中的那一套显示/使用「模板 + 本次微调」，其余用模板本身）。
  const batchFramingSpec=batchFramingPreset
    ?(batchFramingPreset.id===activeFrameId?effectiveFrameSpec:(batchFramingPreset.spec||DEFAULT_FRAME_SPEC))
    :DEFAULT_FRAME_SPEC;
  const batchFramingSpecKey=frameSpecRenderKey(batchFramingSpec);
  // 展签日期与单幅同一条口径（US-014）：**值** = 本次课次日期，**格式** = 批量所选模板的
  // `plaque.dateFormat`（批量面板可能选了另一套模板，所以这里按 `batchFramingSpec` 现算，而不是
  // 复用 `thumbPlaque.date` 那份用当前模板格式化的值）。它不进新鲜度键（键里是课次日期与 specKey）。
  const batchFramingDate=formatOverlayDate(lessonDateDots,frameSpecRenderView(batchFramingSpec).plaqueDateFormat);
  const batchFramingPlan=mode==='班级反馈'
    ?planBatchFraming({entries:batchUploads.artwork,participants:effectiveParticipants,specKey:batchFramingSpecKey,lessonDate:lessonDateDots,teacherName:currentTeacherName,orgName:DEFAULT_ORG_NAME,fallbackDate:batchFramingDate})
    :null;
  // 每幅作品的成品图新鲜度键（按**这一幅**的学员 / 作品名 / 底图 / 旋转算）：
  // 第二步装裱墙与第三步班级合展都读它，于是「批量装裱出来的成品图」在每一幅上都能正确命中，
  // 而不是只有第一幅（US-008b 的 `writtenBackKey` 只算第一幅，逐幅展示是 US-010 的范围）。
  // 键取**记录自己的参数**（`batchFramingDisplayKeyOf`）：在批量面板上换一套模板但还没应用时，
  // 作品上那张图并没有过期；只有这一幅的作品名 / 旋转 / 底图变了才算过期。
  const classArtworkWriteBackKeyOf=(entry)=>{
    if(mode!=='班级反馈') return '';
    return batchFramingDisplayKeyOf(entry,{participants:effectiveParticipants,specKey:activeFrameSpecKey,lessonDate:lessonDateDots,teacherName:currentTeacherName,orgName:DEFAULT_ORG_NAME,fallbackDate:batchFramingDate});
  };
  /**
   * 把一幅作品渲染成装裱成品图并写回它的作品位（批量与「只重试这一幅」共用这一条）。
   * 渲染入参全部来自目标本身（source / student / title / rotation），因此每幅之间互不影响。
   */
  const writeBatchFramedArtwork=async(target,batchId,specKey,spec)=>{
    const variables=target.variables;
    const image=await renderBatchFramedArtwork({
      source:variables.source,
      spec,
      student:variables.studentName,
      title:variables.title,
      date:variables.date,
      lessonDate:variables.lessonDate,
      rotation:variables.rotation,
      orgName:variables.orgName,
      teacherName:variables.teacherName
    });
    const record=buildArtworkWriteBack({
      imageUrl:image.url,
      imageWidth:image.width,
      imageHeight:image.height,
      // 溯源：参数快照 + 底图 + 生成时间 + 操作人（PRD 的四项），加上批次 id 与这一幅的上下文。
      specSnapshot:spec,
      specKey,
      specSummary:writeBackSpecSummary,
      sourceUrl:variables.source,
      generatedAt:new Date().toISOString(),
      operatorId:currentTeacherName,
      operatorName:currentTeacherName,
      quality:BATCH_FRAMING_QUALITY.id,
      qualityLabel:BATCH_FRAMING_QUALITY.label,
      bytes:image.bytes,
      width:image.canvasWidth,
      height:image.canvasHeight,
      lessonId:currentLessonId,
      lessonDate:lessonDateDots,
      studentId:variables.studentId,
      studentName:variables.studentName,
      title:variables.title,
      // 这套成品图用的是哪套装裱模板（US-011b）：后台删除模板前的「历史成品引用」判据。
      presetId:batchFramingPreset?.id||'',
      // 批次 id：客户端据此区分「批量装裱的成品图」与「老师单独保存的成品图」，
      // 下一次批量才能只对「已单独调整过」的那些先做二次确认。
      batchId,
      renderKey:target.key
    });
    const problem=artworkWriteBackProblem(record);
    if(problem) throw new Error(problem);
    // 写回这一条素材（走 updateUploadEntry，所以 writeBack 必须在 createUploadEntry 的白名单里）。
    setBatchUploads(current=>({...current,artwork:updateUploadEntry(current.artwork,variables.uploadId,{writeBack:record})}));
    return record;
  };
  /**
   * 跑一次批量装裱。串行渲染（一次一幅）：内存里同一时刻只有一张 1800×1360 的位图，
   * 页面始终可滚动；每一幅开始前读一次取消标记 —— 取消只停掉「还没开始的那些」。
   * 单幅失败只记进失败清单（可单独重试），**不影响**同一批里已经成功的作品。
   */
  const runBatchFraming=async()=>{
    if(batchFramingIsRunning(batchFraming)) return;
    const plan=batchFramingPlan;
    if(!plan||!plan.jobs.length){
      setToast(plan&&plan.total?'本班作品都已经是最新成品图，不需要重复装裱。':'本班还没有已上传的作品：先回第一步给孩子们上传作品，再回来批量装裱。');
      return;
    }
    const batchId=makeBatchFramingId();
    const spec=batchFramingSpec;
    const specKey=batchFramingSpecKey;
    batchFramingCancelRef.current=false;
    setBatchFramingConfirm('');
    setBatchFraming(current=>batchFramingReducer(current,{type:'start',total:plan.jobs.length,batchId,presetId:batchFramingPreset?.id||''}));
    let finished=0;
    let cancelled=false;
    for(let index=0;index<plan.jobs.length;index+=1){
      if(batchFramingCancelRef.current){cancelled=true;break}
      const target=plan.jobs[index];
      setBatchFraming(current=>batchFramingReducer(current,{type:'progress',done:index,target}));
      try{
        await writeBatchFramedArtwork(target,batchId,specKey,spec);
        setBatchFraming(current=>batchFramingReducer(current,{type:'item-ok',target}));
      }catch(error){
        setBatchFraming(current=>batchFramingReducer(current,{type:'item-failed',target,message:String(error?.message||'未知原因')}));
      }
      finished+=1;
    }
    setBatchFraming(current=>batchFramingReducer(current,{type:'finish',status:cancelled?'cancelled':'done',done:finished}));
    setToast(cancelled?`已取消批量装裱：完成 ${finished} / ${plan.jobs.length} 幅，已完成的成品图不受影响。`:`批量装裱完成：${finished} 幅作品已按「${batchFramingPreset?.name||'当前模板'}」装裱并写回。`);
  };
  /** 二次确认后继续（覆盖「已单独调整过」的作品前必须确认 —— 验收原文那句话在 data 层的 confirm 文案里）。 */
  const confirmBatchFramingApply=()=>{setBatchFramingConfirm('');runBatchFraming();};
  /** 点「批量应用装裱」：没有单独调整过的作品就直接跑；有就先弹确认条，一个 state 都不改。 */
  const requestBatchFraming=()=>{
    const plan=batchFramingPlan;
    if(!plan||!plan.total){setToast('本班还没有已上传的作品：先回第一步给孩子们上传作品，再回来批量装裱。');return;}
    if(!plan.jobs.length){setToast(`本班 ${plan.total} 幅作品都已经是这套参数下的成品图，不需要重复装裱。`);return;}
    if(plan.adjusted.length){setBatchFramingConfirm(batchFramingConfirmText(plan.adjusted));return;}
    runBatchFraming();
  };
  /** 取消：只置标记并改状态文案，当前这一幅画完就停（已完成的作品不受影响）。 */
  const cancelBatchFraming=()=>{
    if(!batchFramingIsRunning(batchFraming)||batchFramingCancelRef.current) return;
    batchFramingCancelRef.current=true;
    setBatchFraming(current=>batchFramingReducer(current,{type:'cancel-request'}));
  };
  /** 失败项单独重试：只重画这一幅（用当前选用的模板），已成功的项一行都不动。 */
  const retryBatchFramingItem=async(uploadId)=>{
    if(batchFramingIsRunning(batchFraming)) return;
    const target=batchFramingPlan?.targets.find(item=>item.variables.uploadId===uploadId);
    if(!target){setToast('这幅作品已经不在本班素材里了。');return;}
    try{
      await writeBatchFramedArtwork(target,batchFraming.batchId||makeBatchFramingId(),batchFramingSpecKey,batchFramingSpec);
      setBatchFraming(current=>batchFramingReducer(current,{type:'item-ok',target}));
      setToast(`已重试成功：${target.label}`);
    }catch(error){
      setBatchFraming(current=>batchFramingReducer(current,{type:'item-failed',target,message:String(error?.message||'未知原因')}));
      setToast(batchFramingFailureText(String(error?.message||'未知原因')));
    }
  };
  const batchFramingVerdict=batchFramingBudgetVerdict(batchFraming);
  const batchFramingPanel=mode==='班级反馈'?(
    <section className="batch-framing-panel" data-batch-framing-panel="true"
      data-batch-status={batchFraming.status}
      data-batch-preset={batchFramingPreset?.id||''}
      data-batch-total={batchFramingPlan.total}
      data-batch-jobs={batchFramingPlan.jobs.length}
      data-batch-adjusted={batchFramingPlan.adjusted.length}
      data-batch-current={batchFramingPlan.current.length}
      data-batch-missing={batchFramingPlan.missing.length}
      data-batch-unbound={batchFramingPlan.unbound}
      data-batch-done={batchFraming.done}
      data-batch-failures={batchFraming.failures.length}
      data-batch-elapsed={batchFraming.elapsedMs}
      data-batch-running={batchFramingIsRunning(batchFraming)?'true':'false'}>
      <div className="batch-framing-head">
        <b>批量应用装裱</b>
        <em className="batch-framing-plan" data-batch-plan-line={batchFramingPlanText(batchFramingPlan)}>{batchFramingPlanText(batchFramingPlan)}</em>
        <small>选一套模板，一次应用到本班已上传的全部作品；落款里的 <code>{'{学员名}'}</code> 与展签姓名按作品所属学员自动替换（不串名）。单幅作品仍可在下方单独调整与保存，「已单独调整」的那些会在覆盖前先确认。</small>
      </div>
      {enabledFrames.length?<div className="batch-framing-templates" role="radiogroup" aria-label="批量装裱模板">
        {enabledFrames.map(preset=><button type="button" role="radio" aria-checked={preset.id===batchFramingPreset?.id} key={preset.id} className={`batch-framing-template${preset.id===batchFramingPreset?.id?' active':''}`} data-batch-template={preset.id} data-batch-template-active={preset.id===batchFramingPreset?.id?'true':'false'} onClick={()=>setBatchFramingPresetId(preset.id)}>{preset.name}</button>)}
      </div>:null}
      <div className="batch-framing-actions">
        <button type="button" data-batch-action="apply" disabled={batchFramingIsRunning(batchFraming)||!batchFramingPlan.jobs.length} onClick={requestBatchFraming}>{batchFramingIsRunning(batchFraming)?'正在批量装裱…':'批量应用装裱'}</button>
        {batchFramingIsRunning(batchFraming)?<button type="button" className="batch-framing-cancel" data-batch-action="cancel" onClick={cancelBatchFraming} disabled={batchFraming.status==='cancelling'}>{batchFraming.status==='cancelling'?'正在取消…':'取消批量装裱'}</button>:null}
      </div>
      {batchFramingConfirm?<div className="batch-framing-confirm" data-batch-confirm="true" data-batch-confirm-count={batchFramingPlan.adjusted.length}>
        <b data-batch-confirm-text={batchFramingConfirm}>{batchFramingConfirm}</b>
        <div className="batch-framing-confirm-actions">
          <button type="button" data-batch-action="confirm" onClick={confirmBatchFramingApply}>继续批量装裱</button>
          <button type="button" data-batch-action="confirm-cancel" onClick={()=>setBatchFramingConfirm('')}>取消</button>
        </div>
      </div>:null}
      {batchFraming.status!=='idle'?<div className="batch-framing-progress" data-batch-progress="true" data-batch-progress-done={batchFraming.done} data-batch-progress-total={batchFraming.total}>
        <div className="batch-framing-bar"><i style={{width:`${batchFraming.total?Math.min(100,Math.round((batchFraming.done/batchFraming.total)*100)):0}%`}}/></div>
        <em data-batch-progress-text={batchFramingIsRunning(batchFraming)?batchFramingProgressText(batchFraming):batchFramingSummaryText(batchFraming)}>{batchFramingIsRunning(batchFraming)?batchFramingProgressText(batchFraming):batchFramingSummaryText(batchFraming)}</em>
        <small>{batchFramingBudgetText()}</small>
      </div>:null}
      {batchFraming.failures.length?<div className="batch-framing-failures" data-batch-failures="true">
        <div className="batch-framing-failures-head">
          <b>失败清单</b>
          <small data-batch-failures-summary={batchFramingFailureSummaryText(batchFraming)}>{batchFramingFailureSummaryText(batchFraming)}</small>
        </div>
        <ul>
          {batchFraming.failures.map(item=><li key={item.uploadId} data-batch-failure={item.uploadId}>
            <b>{item.label}</b>
            <small>{batchFramingFailureText(item.message)}</small>
            <button type="button" data-batch-retry={item.uploadId} disabled={batchFramingIsRunning(batchFraming)} onClick={()=>retryBatchFramingItem(item.uploadId)}>只重试这一幅</button>
          </li>)}
        </ul>
      </div>:null}
      {batchFramingVerdict.text?<p className={`batch-framing-budget ${batchFramingVerdict.withinBudget?'within':'over'}`} data-batch-budget-verdict={batchFramingVerdict.withinBudget?'within':'over'}>{batchFramingVerdict.text}</p>:null}
    </section>
  ):null;
  const overlayPanel=(
    <section className={`lesson-overlay-panel${overlayDrawerOpen?' is-open':''}`} data-overlay-panel="true" data-overlay-open={overlayDrawerOpen?'true':'false'} data-overlay-tweak-count={overlayTweakCountValue} data-overlay-tweak-summary={overlayTweakSummaryText} data-overlay-enabled-count={overlayEnabledCountValue} data-overlay-enabled={overlayEnabledText} data-overlay-spec-fingerprint={artworkUrlFingerprint(activeFrameSpecKey)}>
      <div className="lesson-overlay-drawer-head">
        <span className="lesson-overlay-handle" aria-hidden="true"/>
        <b>水印 · 落款 · 时间</b>
        <button type="button" data-overlay-action="close" onClick={()=>setOverlayDrawerOpen(false)}>完成</button>
      </div>
      <div className="lesson-overlay-head">
        <b>水印 · 落款 · 时间</b>
        <em data-overlay-summary={overlayTweakSummaryText}>{overlayTweakSummaryText}</em>
        <small>三区共用同一个九宫格：点格子定位，在格子上拖动微调偏移。面板里的每个输入都会立刻反映到右侧成品预览，<strong>不需要点「应用」</strong>；调整只作用于本次课次，不写回模板（想长期保留请用「另存为我的模板」）。</small>
      </div>
      <div className="lesson-overlay-body">
        <div className="lesson-overlay-sections">
          {OVERLAY_SECTIONS.map(section=><article key={section.id} className="lesson-overlay-section" data-overlay-section={section.id}>
            <header>
              <b>{section.label}</b>
              <small>{section.hint}</small>
            </header>
            {overlayElementCards.filter(card=>card.section===section.id).map(card=>overlayElementCard(card))}
          </article>)}
        </div>
        <aside className="lesson-overlay-preview" data-overlay-preview-wrap="true">
          <b>成品预览</b><em className="lesson-overlay-preview-state" data-overlay-preview-state={overlayPreviewState}>{overlayPreviewState==='pending'?'正在渲染…':(overlayPreviewState==='error'?`预览失败：${overlayPreviewError}`:(overlayPreviewState==='ready'?'已就绪':'等待作品'))}</em>
          {overlayPreviewSrc?<img data-overlay-preview={overlayUsesClassPreview?'rendered':'framed'} src={overlayPreviewSrc} alt="水印 / 落款 / 时间的成品预览（随面板输入实时更新）"/>:<span className="lesson-overlay-preview-empty" data-overlay-preview-state={overlayPreviewState}>上传作品并完成装裱后显示成品预览</span>}
          <em data-overlay-preview-enabled={overlayEnabledText}>{overlayEnabledText}</em>
          <small>{overlayPreviewNote}</small>
          <small data-overlay-preview-variables={overlayVariables.join(' ')}>变量按当前上下文替换：机构名「{overlayVariableContext.orgName||'—'}」· 学员名「{overlayVariableContext.studentName||'—'}」· 老师「{overlayVariableContext.teacherName||'—'}」· 课次日期「{overlayVariableContext.lessonDate||'—'}」</small>
          <small>落款默认取当前登录老师「{overlaySignatureDefaultName}」；时间默认取本次课次日期「{overlayLessonDate||'未选择'}」。</small>
        </aside>
      </div>
      <div className="lesson-overlay-foot">
        <em data-overlay-foot-summary={overlayEnabledText}>{overlayEnabledText}</em>
        <button type="button" data-overlay-action="reset-all" disabled={!overlayTweakCountValue} onClick={resetOverlayTweaks}>全部恢复模板默认</button>
        <button type="button" className="lesson-overlay-done" data-overlay-action="close" onClick={()=>setOverlayDrawerOpen(false)}>完成</button>
      </div>
    </section>
  );
  const artworkEditorField=(
    <div className={`artwork-editor${artworkEditor.open?' is-open':''}`} data-editor-open={artworkEditor.open?'true':'false'} data-studio-drawer="editor" data-studio-drawer-open={artworkEditor.open?'true':'false'} data-edit-unconfirmed={hasUnconfirmedArtworkEdit()?'true':'false'} data-edit-rotation={artworkEditorShown.rotateDeg} data-edit-fine={artworkEditorFine} data-editor-preview-mode={editorPreviewMode} data-editor-preview-edge={editorPreviewMode==='hd'?EDIT_PREVIEW_HD_MAX_EDGE:EDIT_PREVIEW_MAX_EDGE} data-shown-crop={artworkEditorShown.crop?[artworkEditorShown.crop.x,artworkEditorShown.crop.y,artworkEditorShown.crop.w,artworkEditorShown.crop.h].join(','):'none'} data-shown-zoom={artworkEditorShown.zoom} data-shown-offset={[artworkEditorShown.offsetX,artworkEditorShown.offsetY].join(',')}>
      {/* 手机断点（≤430px）下编辑器是底部抽屉：头里给一个把手与「完成编辑」（= 面板底部的同一个动作）。 */}
      {artworkEditor.open?<div className="studio-drawer-head" data-studio-drawer-head="editor">
        <span className="studio-drawer-handle" aria-hidden="true"/>
        <b>作品编辑器</b>
        <button type="button" data-studio-drawer-close="editor" disabled={editorPreviewPending} onClick={confirmArtworkEdit}>{editorPreviewPending?'正在生成预览…':'完成编辑'}</button>
      </div>:null}
      <div className="artwork-editor-head">
        <b>作品编辑器</b>
        <em data-edit-summary={rotationSummary(artworkEditorShown)}>{rotationSummary(artworkEditorShown)}</em>
        <em className="artwork-editor-crop-badge" data-edit-crop={cropSummary(artworkEditorShown.crop,cropImageAspect)} data-crop-summary={cropSummary(artworkEditorShown.crop,cropImageAspect)}>{cropSummary(artworkEditorShown.crop,cropImageAspect)}</em>
        <em className="artwork-editor-view-badge" data-edit-view={zoomableView}>{zoomableView}</em>
        <small>{artworkEditor.open?`编辑中：预览为${editorPreviewMode==='hd'?`高清稿（长边 ≤ ${EDIT_PREVIEW_HD_MAX_EDGE}px）`:`低分辨率稿（长边 ≤ ${EDIT_PREVIEW_MAX_EDGE}px，跟手）`}，点「完成编辑」后再按新方向重新裁剪与装裱。`:'旋转、裁剪与缩放结果写入独立的 artworkEdit，原图 originalUrl 全程只读、不会被覆盖。'}</small>
      </div>
      {/* 编辑底图（US-012）：手机原图**先降采样到长边 2400 再编辑**，并把「加载与显示」的实测耗时写出来
          （验收原文：4000x3000 手机原图加载并显示不超过 2 秒）。 */}
      {artworkEditor.open?<p className="artwork-editor-base" data-edit-base="true" data-edit-base-status={editBaseBusy?'preparing':(editBasePerf?'ready':'pending')} data-edit-base-edge={EDIT_BASE_MAX_EDGE} data-edit-base-ms={editBasePerf?Math.round(editBasePerf.ms):''} data-edit-base-limit={formatPerfMs(EDIT_BASE_LOAD_BUDGET_MS)} data-edit-base-source={editBasePerf?`${editBasePerf.originalWidth}×${editBasePerf.originalHeight}`:''} data-edit-base-target={editBasePerf?`${editBasePerf.width}×${editBasePerf.height}`:''} data-edit-base-verdict={editBaseCheck?(editBaseCheck.ok?'ok':'over'):''}>
        <b>编辑底图</b>
        {editBaseBusy
          ?<em data-edit-base-summary="preparing">正在准备：先把原图降采样到长边 ≤ {EDIT_BASE_MAX_EDGE}px，再进入编辑（编辑与高清预览共用这一张，避免让手机原图反复解码）。</em>
          :<em data-edit-base-summary={editBaseSummary}>{editBaseSummary||`长边 ≤ ${EDIT_BASE_MAX_EDGE}px 的底图是编辑与高清预览共用的那一张；原图 originalUrl 仍然只读保留。`}</em>}
      </p>:null}
      {artworkEditor.open?<>
        <div className="artwork-crop">
          <div className="artwork-editor-row">
            <span>裁剪框</span>
            <em className="artwork-crop-readout" data-crop-size={cropSizeLabel}>{cropSizeLabel}{cropRatioLabel?` · ${cropRatioLabel}`:''}</em>
            {cropIsFull(cropShownRect)?<small data-crop-full="true">当前是完整画面（框外会被裁掉，框即保留区域）</small>:null}
          </div>
          <div className="artwork-crop-presets" role="group" aria-label="裁剪比例预设">
            {CROP_ASPECT_PRESETS.map(preset=><button key={preset.id} type="button" data-crop-preset={preset.id} className={cropAspectId===preset.id?'active':''} aria-pressed={cropAspectId===preset.id} disabled={preset.id!==CROP_FREE_ASPECT_ID&&!cropStage.naturalWidth} onClick={()=>chooseCropPreset(preset.id)}>{preset.label}</button>)}
          </div>
          <div className={`artwork-crop-stage${artworkEditorShown.zoom<1?' is-zoomed-out':''}${editBaseBusy?' is-preparing':''}`} ref={cropStageRef} data-crop-stage="true" data-crop-preparing={editBaseBusy?'true':'false'} data-crop-image-aspect={Number(cropImageAspect.toFixed(4))} data-crop-locked={cropLockedRatio?Number(cropLockedRatio.toFixed(4)):''} data-editor-zoom={artworkEditorShown.zoom} data-editor-offset={[artworkEditorShown.offsetX,artworkEditorShown.offsetY].map(item=>Number(item.toFixed(4))).join(',')} data-editor-preview-mode={editorPreviewMode} onPointerDown={beginViewGesture} onPointerMove={(event)=>{moveCropDrag(event);moveViewGesture(event)}} onPointerUp={(event)=>{endCropDrag(event);endViewGesture(event)}} onPointerCancel={(event)=>{endCropDrag(event);endViewGesture(event)}}>
            {editorStageSrc?<img src={editorStageSrc} alt="裁剪预览（摆正后的低分辨率旋转稿，缩放与平移实时生效）" draggable={false} style={cropStageTransform?{transform:cropStageTransform}:undefined} onLoad={(event)=>{const image=event.currentTarget;setCropStage(current=>current.naturalWidth===image.naturalWidth&&current.naturalHeight===image.naturalHeight?current:{naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight});}}/>:null}
            {editBaseBusy?<span className="artwork-crop-preparing" data-crop-preparing-note="true">正在准备编辑底图：先把原图降采样到长边 ≤ {EDIT_BASE_MAX_EDGE}px，再进入编辑…</span>:null}
            <div className={`artwork-crop-box${cropIsFull(cropShownRect)?' is-full':''}`} style={cropBoxStyle(cropShownRect)} data-crop-rect={cropRectAttr}>
              <span className="artwork-crop-move" data-crop-handle={CROP_BODY_HANDLE} title="拖动整框（越界会回弹）" onPointerDown={(event)=>beginCropDrag(event,CROP_BODY_HANDLE)}/>
              {CROP_HANDLES.map(handle=><span key={handle} className={`artwork-crop-handle is-${handle}`} data-crop-handle={handle} title={`拖动${cropHandleLabel(handle)}`} onPointerDown={(event)=>beginCropDrag(event,handle)}/>)}
              <b className="artwork-crop-size" data-crop-size-label={cropSizeLabel}>{cropSizeLabel}</b>
            </div>
          </div>
          <small className="artwork-crop-hint">{describeCropRules()}{editorPreviewPending?'（旋转稿正在生成，稍等片刻）':''}</small>
        </div>
        <div className="artwork-editor-row">
          <span>缩放 / 平移</span>
          <button type="button" data-edit-action="zoom-out" title="缩小 0.25 倍" disabled={!canZoomArtworkEdit(artworkEditor.draft,1/ARTWORK_ZOOM_BUTTON_FACTOR)} onClick={()=>zoomArtworkView(1/ARTWORK_ZOOM_BUTTON_FACTOR)}>缩小</button>
          <b className="artwork-editor-zoom" data-editor-zoom-label={zoomLabel(artworkEditorShown.zoom)}>{zoomLabel(artworkEditorShown.zoom)}</b>
          <button type="button" data-edit-action="zoom-in" title="放大 0.25 倍" disabled={!canZoomArtworkEdit(artworkEditor.draft,ARTWORK_ZOOM_BUTTON_FACTOR)} onClick={()=>zoomArtworkView(ARTWORK_ZOOM_BUTTON_FACTOR)}>放大</button>
          <em className="artwork-editor-view" data-editor-view={zoomableView}>{zoomableView}</em>
          <small>滚轮或双指缩放（{ARTWORK_ZOOM_RANGE.min}×–{ARTWORK_ZOOM_RANGE.max}×，锚点跟随指针）；在画面空白处拖动平移——裁剪框铺满整幅画面时直接拖动画即可。</small>
        </div>
        <div className="artwork-editor-row">
          <span>旋转</span>
          <button type="button" data-edit-action="rotate-left" title="向左旋转 90°" disabled={editorPreviewPending} onClick={()=>rotateArtworkEditor(-1)}><RotateCcw size={15}/>左旋 90°</button>
          <button type="button" data-edit-action="rotate-right" title="向右旋转 90°" disabled={editorPreviewPending} onClick={()=>rotateArtworkEditor(1)}><RotateCw size={15}/>右旋 90°</button>
        </div>
        <div className="artwork-editor-row">
          <span>任意角度微调</span>
          <button type="button" data-edit-action="fine-left" title="逆时针微调 0.5°" disabled={!canNudgeArtworkEditRotation(artworkEditor.draft,-FINE_ROTATION_STEP)} onClick={()=>nudgeArtworkEditorRotation(-FINE_ROTATION_STEP)}>-0.5°</button>
          <b className="artwork-editor-fine" data-edit-fine-value={formatRotationDeg(artworkEditorFine)}>{formatRotationDeg(artworkEditorFine)}</b>
          <button type="button" data-edit-action="fine-right" title="顺时针微调 0.5°" disabled={!canNudgeArtworkEditRotation(artworkEditor.draft,FINE_ROTATION_STEP)} onClick={()=>nudgeArtworkEditorRotation(FINE_ROTATION_STEP)}>+0.5°</button>
          <small>步进 0.5°，范围 ±15°</small>
        </div>
        <div className="artwork-editor-row">
          <span>撤销 / 重做</span>
          <button type="button" data-edit-action="undo" disabled={!artworkEditorState.canUndo} onClick={undoArtworkEdit}>撤销{artworkEditorState.undoSteps?`（${artworkEditorState.undoSteps}）`:''}</button>
          <button type="button" data-edit-action="redo" disabled={!artworkEditorState.canRedo} onClick={redoArtworkEdit}>重做{artworkEditorState.redoSteps?`（${artworkEditorState.redoSteps}）`:''}</button>
          <small data-edit-history={artworkEditorState.undoSteps}>最多可撤销 {artworkEditorState.limit} 步{artworkEditorState.undoLabel?` · 上一步：${artworkEditorState.undoLabel}`:''}</small>
        </div>
        <div className="artwork-editor-row">
          <span>编辑保护</span>
          <button type="button" data-edit-action="reset" title={ARTWORK_EDIT_PROTECTIONS[0].hint} disabled={!canResetArtworkEdit(artworkEditor.draft)} onClick={resetArtworkEditor}>重置</button>
          <button type="button" data-edit-action="restore-full" title={ARTWORK_EDIT_PROTECTIONS[1].hint} disabled={!canRestoreArtworkFullFrame(artworkEditor.draft)} onClick={restoreArtworkFullFrameEditor}>回到完整作品</button>
          <em className="artwork-editor-protect" data-edit-protect={artworkEditProtectLabel}>{artworkEditProtectLabel}</em>
          <small>重置 = 不旋转 / 不裁剪 / 1× 居中（确认后仍走系统自动裁剪）；回到完整作品 = 保留旋转方向、取消裁剪与缩放平移，画心恢复为系统自动裁剪前的完整画面。两个动作都只改草稿，点「完成编辑」才生效，且各自占一步撤销。</small>
        </div>
        <div className="artwork-editor-actions">
          <button type="button" className="artwork-editor-cancel" data-edit-action="cancel" onClick={cancelArtworkEdit}>放弃本次编辑</button>
          <button type="button" className="artwork-editor-confirm" data-edit-action="confirm" disabled={editorPreviewPending} onClick={confirmArtworkEdit}>{editorPreviewPending?'正在生成预览…':'完成编辑，重新裁剪与装裱'}</button>
        </div>
        <p className="artwork-editor-note">编辑只改这一幅作品的旋转、裁剪与缩放平移参数（写入 <code>artworkEdit</code>），不写入装裱模板，也不会覆盖原图；「重置」与「回到完整作品」随时能回到已知状态，未确认就退出（放弃 / 离开本步 / 换班 / 新建草稿）会丢弃这一份草稿并给出提示。</p>
      </>:<button type="button" className="artwork-editor-entry" data-edit-action="open" disabled={!media.artwork?.originalUrl} onClick={openArtworkEditor}><WandSparkles size={15}/>编辑作品（旋转 / 微调 / 裁剪 / 缩放平移 / 撤销重做）</button>}
      {media.artwork?.originalUrl?<div className="artwork-layers" data-artwork-layers="true" data-layers-ready={artworkLayersReady}>
        <div className="artwork-layers-head">
          <b>四层地址</b>
          <em data-layers-summary={artworkLayerSummary(media.artwork)}>{artworkLayerSummary(media.artwork)}</em>
          <small>{artworkLayersReady} / {ARTWORK_LAYER_KEYS.length} 层已生成 · 原图只读，编辑只写派生层（旋转稿 / 裁剪稿 / 成品图）</small>
        </div>
        <ul>
          {artworkLayers.map(entry=><li key={entry.key} data-artwork-layer={entry.key} data-layer-ready={entry.ready?'true':'false'} data-layer-readonly={entry.readonly?'true':'false'} data-layer-fingerprint={entry.fingerprint} data-layer-chars={entry.chars}>
            <b>{entry.label}{entry.readonly?<em className="artwork-layer-lock">只读</em>:null}</b>
            <code>{entry.ready?`${entry.fingerprint} · ${entry.chars} 字符`:'未生成'}</code>
            <small>{entry.hint}</small>
          </li>)}
        </ul>
      </div>:null}
    </div>
  );
  // 生成失败态的三个动作（[第三步 US-108b]）：重试 / 换模型重试 / 稍后再来。
  // 三个动作都只碰「生成」这一层，素材与老师自己写下的内容一个字都不动（见 runReviewRecovery）。
  // 到 `REVIEW_FAILURE_STREAK_LIMIT` 次时额外提示「可能是模型服务波动」并推荐最健康的可用模型。
  const reviewRecoveryField=reviewStream.phase===REVIEW_DETAIL_PHASES.error?(
    <div className="review-recovery" data-review-recovery="true" data-recovery-failures={reviewFailureStreak} data-recovery-recommend={reviewFailureView.show?reviewFailureView.recommendId:''}>
      <CircleAlert size={15}/>
      <div className="review-recovery-copy">
        <b data-recovery-reason="true">{reviewStream.message||REVIEW_FAILURE_TITLE_FALLBACK}</b>
        <small>{REVIEW_FAILURE_KEEP_NOTE}可以先重试，也可以换一个模型再试；要先去处理别的事就选「稍后再来」。</small>
        {reviewFailureView.show?<div className="review-recovery-streak" data-recovery-streak="true">
          <b>{reviewFailureView.message}</b>
          <small>{reviewFailureView.recommendationText}</small>
        </div>:null}
      </div>
      <span className="review-recovery-actions">
        {REVIEW_RECOVERY_ACTIONS.map(action=><button key={action.id} type="button" data-recovery-action={action.id} title={action.hint} onClick={()=>runReviewRecovery(action.id)}>{action.label}</button>)}
      </span>
    </div>
  ):null;
  // 归档强校验的清单（[第三步 US-108b]）：五维逐维 + 轨迹状态，缺哪一项就把哪一项写清楚。
  // 归档按钮读同一个 `reviewArchiveGate`：不通过就禁用，并把**第一条**原因挂成 data-archive-block-reason。
  const reviewArchiveGateField=(
    <div className="review-archive-gate" data-review-archive-gate={reviewArchiveGate.ok?'ok':'blocked'} data-archive-gate-reason={reviewArchiveGate.ok?'':reviewArchiveGate.reasonText}>
      <b>{reviewArchiveGate.headline}</b>
      <ul>
        {reviewArchiveGate.checks.map(check=><li key={check.id} data-archive-gate-check={check.id} data-archive-gate-ok={check.ok?'true':'false'}>
          {check.ok?<Check size={13}/>:<CircleAlert size={13}/>}
          <span>{check.ok?check.label:check.reason}</span>
        </li>)}
      </ul>
    </div>
  );
  return <><PageHeader title="课后反馈" desc="每一个环节都可随时进入，当前进度会同步保留。" prd="课后反馈工作流"/>
    <section className="feedback-flow-v2">
      <FlowStepper steps={steps} step={step} flags={[intakeReadiness.ok,hasProcessedArtwork,reviewGenerated,archived]} onGo={go}/>
      <div className="scene-status"><span>当前进行：{steps[step-1][0]}</span><button onClick={()=>go(Math.max(1,step-1))} disabled={step===1}>反馈上一步</button></div>
      {step===3?<ReviewLaunchPanel profiles={teacherProfiles} skillLibrary={skillLibrary} activeProfileId={activeProfileId} setActiveProfileId={setActiveProfileId} onStart={startCloudReview} draftReady={reviewGenerated} keywordCount={keywords.length} hasArtwork={Boolean(media.artwork?.cleanUrl||media.artwork?.originalUrl)} running={reviewStream.phase===REVIEW_DETAIL_PHASES.running} modelPlan={reviewModelPlan} modelChoice={reviewModelChoice} onChooseModel={selectReviewModel} switchConfirm={reviewModelSwitch} onConfirmSwitch={confirmReviewModelSwitch} onCancelSwitch={cancelReviewModelSwitch}/>:null}
      {step===3&&reviewStream.phase!==REVIEW_DETAIL_PHASES.idle&&reviewDetailSurfaceAllowed({surface:REVIEW_DETAIL_SURFACES.teacherFlow,role})?<ReviewDetailPanel stream={reviewStream} loaded={reviewLoaded} prompt={reviewPrompt} trace={reviewTracePanel} compare={reviewCompareParent} model={reviewModelPlan.modelId} modelSource={reviewModelPlan.source} params={REVIEW_MODEL_PARAMS} requests={reviewRequests} student={selectedStudentLabel} lessonDate={lessonDateDots} promptAllowed={reviewPromptDisclosureAllowed(tracePolicy,{role})} open={reviewDetailOpen} onToggle={()=>setReviewDetailOpen(value=>!value)} onStart={startCloudReview} onStop={stopCloudReview}/>:null}
      {step===2&&mode==='班级反馈'?<ClassFramingWall artworks={batchUploads.artwork} photos={batchUploads.photo} photoGroups={photoGroups} writeBackKeyOf={classArtworkWriteBackKeyOf} onRotate={index=>rotateBatchItem('artwork',index)} onRotatePhotoEntry={uploadId=>rotateUploadEntry('photo',uploadId)}/>:null}
      {step===1?<section className="scene-panel"><div className="scene-heading"><span>第一步</span><h2>创建课后反馈信息</h2><p>先确定服务对象，再同步收集本节课素材。素材只在本次操作中保留。</p></div>{draftRestored?<div className="intake-draft-restored"><Clock3 size={14}/><div><b>已恢复上次的课次信息；素材需重新选择</b><small>{draftRestoreDetail}</small></div>{pendingTitles.length?<em>已保留 {pendingTitles.length} 个作品名，「学员作品上传位」里重新选择素材后自动填回</em>:null}<button type="button" className="text-link" onClick={()=>setDraftRestored(false)}>知道了</button></div>:null}<div className="feedback-mode"><button className={mode==='个人反馈'?'selected':''} onClick={()=>selectMode('个人反馈')}>个人反馈<small>为一位孩子完成反馈</small></button><button className={mode==='班级反馈'?'selected':''} onClick={()=>selectMode('班级反馈')}>班级反馈<small>批量处理全班素材</small></button></div>{availableClasses.length?<div className="intake-scope"><span>班级范围</span><div className="intake-scope-switch"><button type="button" className={showAllClasses?'':'active'} onClick={()=>selectClassScope(false)}>我带的班（{myClasses.length}）</button><button type="button" className={showAllClasses?'active':''} onClick={()=>selectClassScope(true)}>全部班级（{availableClasses.length}）</button></div><small>当前登录老师：{currentTeacherName}</small></div>:null}{visibleClasses.length?<div className="task-form"><label>选择班级<select value={selectedClassId} onChange={event=>selectClass(event.target.value)}>{visibleClasses.map(item=><option key={item.id} value={item.id}>{item.name}{item.teacher?`（${item.teacher}）`:''}</option>)}</select></label><label>选择学员<select value={mode==='班级反馈'?'__class__':selectedStudentName} disabled={mode==='班级反馈'} onChange={event=>{setSelectedStudentName(event.target.value);setArchived(false);setCurrentRecordId('');clearReviewTrace();setWriteBackAttempt({status:'idle',quality:'',message:''})}}>{mode==='班级反馈'?<option value="__class__">本班全部学员（{classStudents.length}人）</option>:<><option value="">请选择学员</option>{classStudents.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</>}</select></label>{courseOptions.length?<label>选择课程<select value={activeCourseId} onChange={event=>selectCourse(event.target.value)}>{courseOptions.map(item=><option key={item.courseId} value={item.courseId}>{item.name}{item.courseId===classCourseId?' · 本班课程':''}</option>)}</select></label>:<div className="intake-course-empty"><b>课程库暂时没有可选课程</b><p>{classCourseName?`本班课程「${classCourseName}」不在可选课程里，可能已被停用。`:'课程由机构管理员在「课程库」中维护。'}</p>{role==='admin'?<Button variant="secondary" onClick={()=>navigate('courseLibrary')}>去课程库添加课程</Button>:<small>请联系机构管理员在「课程库」中新增或启用课程。</small>}</div>}{lessonScheduleField}{participantField}{consentNoticeField}{mediaIntakeNotice?<p className="intake-media-notice"><ShieldAlert size={14}/><span>{mediaIntakeNotice}</span></p>:null}</div>:<div className="intake-empty"><Users size={26}/><b>{showAllClasses?'机构里还没有任何班级':'还没有属于你的班级'}</b><p>{showAllClasses?'请先在「学员管理」中新建班级，再回到这里创建课后反馈。':'可以切到「全部班级」确认是否存在其他老师名下的班级，或先去「学员管理」新建班级。'}</p><div className="intake-empty-actions">{showAllClasses?null:<button type="button" className="text-link" onClick={()=>selectClassScope(true)}>查看全部班级</button>}<Button onClick={()=>navigate('classes')}>去学员管理添加班级</Button></div></div>}{mode==='个人反馈'&&selectedClass&&!classStudents.length?<p className="intake-hint">该班级还没有学员，请先在「学员管理」里导入名单，再创建课后反馈。</p>:null}{artworkSlotField}{photoSlotField}{mode==='个人反馈'?<div className="sync-upload"><div className={media.artwork?.url?'has-file':''}><Frame/><b>学员作品 <em>必选</em></b><small>{uploadSummary('artwork')}</small><input ref={artworkInput} type="file" accept="image/jpeg,image/png,image/webp" hidden multiple={mode==='班级反馈'} onChange={e=>readFiles('artwork',e.target.files,e.currentTarget)}/><button onClick={()=>artworkInput.current?.click()}>{media.artwork?.url?'已上传 · 重新选择':'上传作品'}</button></div><div className={media.photo?.url?'has-file':''}><Image/><b>学员照片 <em>选填</em></b><small>{uploadSummary('photo')}</small><input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden multiple={mode==='班级反馈'} onChange={e=>readFiles('photo',e.target.files,e.currentTarget)}/><button onClick={()=>photoInput.current?.click()}>{media.photo?.url?'已上传 · 重新选择':'上传照片'}</button></div></div>:null}{lostSessionMedia&&!mediaLostDismissed?<div className="intake-media-lost"><ShieldAlert size={14}/><div><b>上次选择的素材已失效</b><small>作品与课堂照片只在当次会话里有效（只使用会话内 object URL，不写入 localStorage / IndexedDB）。页面刷新或重新进入后，请重新选择原始素材。</small></div><button type="button" className="text-link" onClick={()=>setMediaLostDismissed(true)}>知道了</button></div>:null}<div className="upload-privacy-note"><ShieldCheck size={14}/>{mediaRulesText(UPLOAD_SLOTS_PER_STUDENT)}</div>{intakeReadinessPanel}<div className="scene-actions"><Button variant="secondary" onClick={resetDraft}>新建草稿</Button><Button variant="secondary" icon={Save} disabled={!activeCourseId||lessonSaveState.status==='saving'} onClick={requestLessonSave}>{lessonSaveState.status==='saving'?'保存中…':'保存课次'}</Button><Button icon={ArrowRight} disabled={!intakeReadiness.ok} onClick={()=>go(2)}>进入智能装裱</Button></div></section>:null}
      {step===2?<section className="scene-panel studio-task"><div className="scene-heading"><span>第二步</span><h2>智能装裱</h2><p>先旋转完整原图并确认方向；确认后自动裁掉纸外的桌面、地面与背景，只保留作品本身。装裱方案（画框、卡纸、展签、日期与署名）由管理员在「装裱设置」中统一维护，这里直接选用。</p></div><div className="media-process"><article><div className={`mini-frame uploaded-art${media.artwork?.framedUrl&&!artworkEditor.open?' framed-preview':''}${artworkEditor.open?' is-editing':''}`}>{media.artwork?.url?<><img src={artworkEditor.open?(editorPreview||media.artwork.originalUrl):(media.artwork.framedUrl||media.artwork.cleanUrl||media.artwork.orientedUrl||media.artwork.originalUrl)} alt={artworkEditor.open?'编辑中的旋转稿预览（低分辨率画布）':media.artwork.framedUrl?`已按「${activeFrame?.name||'默认装裱'}」完成装裱的作品`:media.artwork.cleanUrl?'已裁掉纸外背景、只保留作品本身':'等待确认方向的完整原图'}/>{media.artwork?.framedUrl&&!artworkEditor.open?<span className="framed-badge">{activeFrame?.name||'默认装裱'}</span>:null}{artworkEditor.open?<span className="framed-badge editing-badge">编辑中</span>:null}<div className="frame-rotate-controls" aria-label="旋转作品"><button type="button" title="向左旋转 90°" aria-label="向左旋转作品" disabled={artworkEditor.open&&editorPreviewPending} onClick={()=>quickRotateArtwork(-1)}><RotateCcw size={18}/></button><button type="button" title="向右旋转 90°" aria-label="向右旋转作品" disabled={artworkEditor.open&&editorPreviewPending} onClick={()=>quickRotateArtwork(1)}><RotateCw size={18}/></button></div></>:'✺'}</div><div><b>学员作品</b><p>{artworkEditor.open?(editorPreviewPending?'正在生成低分辨率预览…':'编辑中：调整旋转后点「完成编辑」，再按新的方向重新裁剪与装裱。'):framingState==='processing'?(media.artwork?.cleanUrl?'正在按当前装裱方案合成装裱图…':'正在裁掉纸外的桌面与地面，只保留作品本身…'):media.artwork?.framedUrl?`已装裱：${activeFrame?.name||'默认装裱'}。作品只做等比缩放与居中，不裁切主体、不重绘、不调色。`:media.artwork?.cleanUrl?'已完成作品裁剪，正在生成装裱图…':'当前仅显示完整原图；可以先点「编辑作品」把方向摆正，再开始裁剪与装裱。'}</p>{mode==='个人反馈'?artworkEditorField:null}{!media.artwork?.cleanUrl?<button type="button" className="confirm-artwork-button" onClick={startArtworkCleanup} disabled={framingState==='rotating'||framingState==='processing'}>{framingState==='processing'?'正在裁剪作品…':'方向正确，开始裁剪与装裱'}</button>:null}<span className="frame-choice-hint">相框样式在下方「相框样式」面板里挑（缩略图用这幅作品实时渲染）→</span></div></article><article><div className="photo-card">{media.photo?.url?<><img src={media.photo.url} alt="已自然优化的课堂照片" style={{transform:`rotate(${media.photo.rotation||0}deg)`}}/><button type="button" className="frame-rotate-button photo-rotate-button" onClick={rotatePersonalPhoto}><RefreshCw size={16}/>旋转照片</button></>:<img src={pandaMascot} alt="课堂照片占位预览"/>}</div><div><b>学员照片</b><p>{media.photo?.name||'未上传课堂照片，可返回上一步补充。'}</p></div></article></div>{batchFramingPanel}{studioDrawerTrigger('frame')}{frameStylePanel}{overlayPanelTrigger}{overlayDrawerOpen?<div className="lesson-overlay-scrim" data-overlay-scrim="true" onClick={()=>setOverlayDrawerOpen(false)}/>:null}{overlayPanel}{studioDrawerTrigger('save')}{saveImagePanel}{studioDrawer?<div className="studio-drawer-scrim" data-studio-drawer-scrim={studioDrawer} onClick={()=>setStudioDrawer('')}/>:null}{framingPerfPanel}{saveImageSheet}<div className="scene-actions"><Button variant="secondary" onClick={()=>go(1)}>返回创建信息</Button><Button icon={ArrowRight} onClick={()=>go(3)}>进入五维点评</Button></div></section>:null}
      {step===3?<section className="scene-panel review-task-v2"><div className="review-media"><div className="scene-heading"><span>{mode==='班级反馈'?'本班课后素材':'本次课素材'}</span><h2>{mode==='班级反馈'?'周六创意绘画 2 班 · 班级课后反馈':`${selectedStudentLabel}${activeFrame?.plaqueTitle?` · 《${activeFrame.plaqueTitle}》`:''}`}</h2></div><div className={`review-gallery ${mode==='班级反馈'?'class-review-gallery':''}`}>{mode==='班级反馈'?<><ClassMediaMosaic items={classMosaicArtworks} kind="artwork" date={lessonDateDots} writeBackKeyOf={classArtworkWriteBackKeyOf} onRotate={index=>rotateBatchItem('artwork',index)}/><ClassMediaMosaic items={classMosaicPhotos} kind="photo" groups={photoGroups} date={lessonDateDots} onRotateEntry={uploadId=>rotateUploadEntry('photo',uploadId)}/></>:<><div className={`review-art exhibition-art${reviewFramedSrc?' framed-art':''}`} data-review-artwork-source={reviewWrittenBackUrl?'writeback':'framed'} data-review-artwork-fingerprint={artworkUrlFingerprint(reviewFramedSrc)}>{reviewFramedSrc?<div className="framed-art-final"><img src={reviewFramedSrc} alt={`${selectedStudentLabel}的作品 · ${activeFrame?.name||'装裱'}`} data-review-artwork="true"/>{activeFrame?.name?<span className="framed-badge">{activeFrame.name}</span>:null}{reviewWrittenBackUrl?<span className="written-back-badge" data-review-artwork-written-back="true">老师保存的成品图</span>:null}</div>:<><div className="artwork-mat">{media.artwork?.url?<img src={media.artwork.cleanUrl||media.artwork.originalUrl||media.artwork.url} alt={`${selectedStudentLabel}的作品`}/>:'✺'}</div><div className="artwork-plaque"><div><b>{selectedStudentLabel}</b><span>{activeFrame?.plaqueTitle?`《${activeFrame.plaqueTitle}》`:''}</span></div><time>创作于 {plaqueDateText}</time></div></>}</div><div className="review-photo portrait-print"><div className="portrait-mat">{media.photo?.url?<img src={media.photo.url} alt="陈一诺课堂照片"/>:<img src={pandaMascot} alt="课堂照片占位"/>}</div><div className="portrait-caption">{selectedStudentLabel} · {plaqueDateText}</div></div></>}</div></div><ReviewKeywordDock visible selected={keywords} onToggle={toggleKeyword} suggested={aiKeywords} suggesting={keywordSuggesting} dirty={keywordDirty} generated={reviewGenerated} template={keywordTemplateView}/><div className={`coach-review ${mode==='班级反馈'?'class-coach-review':''}`}><div className="scene-heading"><span>第三步</span><h2>{mode==='班级反馈'?'班级课程反馈':'五维点评'}</h2></div><select value={subject} onChange={e=>setSubject(e.target.value)}><option>通用美术</option><option>创意绘画（3-6岁）</option><option>儿童画（6-9岁）</option><option>素描（9-18岁）</option><option>速写（9-18岁）</option><option>水彩 / 水粉（7-18岁）</option><option>国画（6-18岁）</option></select><p className="evidence">{mode==='班级反馈'?'以下内容基于本节课课程设计、班级素材与老师观察生成，老师可编辑确认后发布给家长。':`下列内容由大模型生成：先读懂作品与课堂素材，再结合「${activeProfileLabel}」的人设、已启用技能与长期记忆，按五个维度分别输出评语。老师可逐条修改后再发布。`}</p>{reviewRecoveryField}{mode==='班级反馈'?<ClassReviewContent subject={subject}/>:<><div className={`review-source ${reviewGenerated?'ai':'pending'}`}>{reviewGenerated?<><Sparkles size={14}/><span>当前正文由大模型「{activeProfileLabel}」依据人设、技能与长期记忆生成，可直接编辑。</span></>:<><Sparkles size={14}/><span>五个维度等待大模型生成：点击上方「开始生成点评」，评语会逐字写入这里。</span></>}{keywordDirty&&reviewGenerated?<em>观察词已调整，建议重新生成</em>:null}</div>{Object.entries(reviews).map(([name,copy])=><article className={`coach-card${copy?'':' is-empty'}`} key={name}><b>{name}{copy?null:<em className="review-pending">待生成</em>}</b><textarea aria-label={name} value={copy} placeholder={REVIEW_DIMENSION_HINTS[name]||''} onChange={event=>setReviews(current=>({...current,[name]:event.target.value}))}/></article>)}</>}{reviewArchiveGateField}<div className="scene-actions"><Button variant="secondary" onClick={()=>go(2)}>返回智能装裱</Button><Button icon={Archive} onClick={archiveRecord} disabled={!reviewArchiveGate.ok} data-archive-gate={reviewArchiveGate.ok?'ok':'blocked'} data-archive-block-reason={reviewArchiveGate.ok?'':reviewArchiveGate.reasonText}>归档并生成分享</Button></div></div></section>:null}
      {step===4?<section className="share-task scene-panel"><img src={pandaObserve} alt="熊猫成长伙伴"/><div><span>已归档至{selectedStudentLabel}的成长档案</span><h2>这一次的成长，<br/>已经被完整记录。</h2><p>作品、课堂照片与五维点评已经写入成长档案。</p><div className="share-actions"><Button icon={Archive} onClick={()=>setToast('成长集锦任务已创建，等待服务端接入')}>制作成长集锦</Button><Button variant="secondary" icon={Frame} onClick={()=>setToast('个人作品集任务已创建，等待服务端接入')}>制作作品集</Button></div><div className="scene-actions"><Button variant="secondary" onClick={()=>go(3)}>返回五维点评</Button><Button icon={FileText} onClick={()=>navigate('archives')}>进入成长档案</Button></div></div></section>:null}
    </section></>;
}

function PremiumFramingResult({setToast}){
  const [framed,setFramed]=useState(false);
  const [photoReady,setPhotoReady]=useState(false);
  const [style,setStyle]=useState('gallery');
  const styles=[['gallery','当代白廊'],['walnut','胡桃木影'],['silk','东方绢雅']];
  const labelName='陈一诺';
  const date='2026.08.07';
  return <>
    <section className="premium-framing-result" aria-label="智能装裱处理结果">
      <div className="premium-framing-head"><div><span>AI 保留原作模式</span><h3>把孩子的作品，安静地带进展厅。</h3><p>仅处理拍摄光影、透视与杂乱背景；原作线条、笔触和色彩不被重绘。</p></div><div className="preserve-pill"><Check/> 原作完整保留</div></div>
      <div className="premium-style-picker">{styles.map(([key,name])=><button key={key} className={style===key?'active':''} onClick={()=>setStyle(key)}><i/><span>{name}</span></button>)}</div>
      <div className="premium-media-grid">
        <article className="museum-piece">
          <div className={`gallery-installation ${style} ${framed?'is-framed':''}`}>
            <div className="gallery-light"/><div className="museum-mount"><div className="artwork-surface"><i className="art-sun"/><i className="art-petal petal-a"/><i className="art-petal petal-b"/><i className="art-petal petal-c"/><i className="art-stem"/><i className="art-wave"/></div></div>
            <div className="museum-label"><b>{labelName}</b><span>《向着光的花》</span><em>创作于 {date}</em></div>
          </div>
          <div className="media-note"><b>学员作品 · 展览装裱</b><span>{framed?'作品已融入展墙与装裱结构':'预览：装裱前将先完成自然校正'}</span></div>
        </article>
        <article className="portrait-piece">
          <div className={`portrait-proof ${photoReady?'is-ready':''}`}><div className="photo-light"/><img src={pandaMascot} alt="课堂照片自然优化预览"/><div className="portrait-label">{labelName} · {date}</div></div>
          <div className="media-note"><b>学员照片 · 自然修图</b><span>只优化构图和光线，不改变五官、神态与真实肤色。</span></div>
          <button className="quiet-process" onClick={()=>{setPhotoReady(true);setToast('已完成自然光线与构图优化，未改变孩子五官（演示）')}}>{photoReady?'照片已自然优化':'一键自然优化'}</button>
        </article>
      </div>
      <div className="framing-one-click"><div><WandSparkles/><span><b>准备好了吗？</b>一键完成作品的校正、融合装裱与展签排版。</span></div><Button icon={Sparkles} onClick={()=>{setFramed(true);setToast('已完成美术馆级融合装裱：原作线条与色彩保持不变（演示）')}}>{framed?'已完成智能装裱':'一键装裱'}</Button></div>
    </section>
  </>;
}

function EvidenceReview({setToast}){
  const [child,setChild]=useState('陈一诺');
  const profiles={
    '陈一诺':{work:'《向着光的花》',facts:['黄、蓝主色与橙色花心形成冷暖层次','花瓣由中心向外延伸，主体集中在画面上半部','视频中在提示后继续补充花瓣细节'],items:[['美术能力','冷暖色关系已经很清楚。下一次可以邀请一诺在花瓣边缘加一层深浅变化，让“光”更有空气感。'],['上课状态','从视频里的持续涂色和最后主动补细节看，她今天保持了稳定投入，遇到停顿后也能重新回到画面。'],['行为能力','在分享环节，她把“花想把光送给妈妈”说得具体，这是把画面想法转成语言的好开始。'],['内在状态','明亮色彩与向上生长的构图，呈现出积极的表达愿望；这是一节课中的创作观察，不作心理诊断。'],['家长建议','回家后先不评价像不像，可以问：“你画里的光最想照到哪里？” 听她讲完，再请她下次把故事补进画面。']]},
    '林小满':{work:'《雨后的花园》',facts:['画面用绿色、紫色和留白表现雨后层次','细线条重复描绘叶片，局部有耐心的补充','照片中先观察同伴作品后再继续调整'],items:[['美术能力','绿色与紫色的搭配很有自己的感觉，留白也让画面透气。可以尝试把前景叶片画得更大，拉开远近关系。'],['上课状态','小满今天进入状态较慢，但找到颜色后能持续安静地完成细节，这种节奏值得被尊重。'],['行为能力','她会先观察、再落笔，说明正在建立自己的判断；老师可用一个具体问题帮助她更快决定下一步。'],['内在状态','画面里反复出现的叶片与留白，像是在用自己的方式整理感受；仅作为作品表达观察，不作心理诊断。'],['家长建议','可以和孩子一起找三处她最满意的细节，再问：“如果明天花园再长一点，你想加什么？” 用具体选择支持她表达。']]}
  };
  const active=profiles[child];
  return <section className="evidence-review-upgrade"><div className="evidence-upgrade-head"><div><span>基于本次素材的观察</span><h3>每一句点评，都能回到孩子的创作现场。</h3></div><select value={child} onChange={e=>setChild(e.target.value)}><option>陈一诺</option><option>林小满</option></select></div><div className="source-facts"><b>{child} · {active.work}</b>{active.facts.map(f=><span key={f}><Check/>{f}</span>)}</div><div className="evidence-dimensions">{active.items.map(([title,copy])=><article key={title}><b>{title}</b><p>{copy}</p></article>)}</div><button className="edit-review" onClick={()=>setToast('老师可在发布前逐条编辑点评内容（演示）')}>老师编辑后再发布</button></section>
}

function ClassReviewContent({subject}){
  const sections=[
    ['课程主题','《向着光的花》· 观察自然中的形态、色彩与生长力量。'],
    ['教学目标','美术目标：观察花瓣方向与色彩关系；能力目标：练习观察、专注与表达；情感目标：在创作中感受生命的明亮与彼此欣赏。'],
    ['课堂流程','① 以“光从哪里来”开启观察；② 认识花朵的形态与色彩；③ 独立创作并完成细节；④ 分享作品，听见同伴的不同表达。'],
    ['本节课的集体收获','孩子们不仅完成了一幅画，也经历了“先观察、再选择、最后表达”的过程。我们看见他们愿意耐心补充细节、讲述自己的想法，也在同伴分享中学习倾听与欣赏。'],
    ['家长可延续的陪伴','回家后可以请孩子用三句话介绍作品：我画了什么、我最满意哪里、下次还想画什么。让创作从课堂延续到日常表达。'],
    ['下一节课预告','将在本节课的观察基础上，继续练习画面的前后关系与色彩层次，帮助孩子把“看见的细节”更自信地呈现出来。']
  ];
  return <div className="class-review-content"><div className="class-review-banner"><span>本节课 · {subject}</span><b>一节美术课，也是一段观察、表达与成长的旅程。</b></div><aside className="review-absence-reminder"><b>也为本次没能来上课的孩子留一句话</b><p>今天的主题和同伴们的创作故事，我们都先好好替孩子保留着。等她回来，老师会用一个轻松的小引子，陪她自然地接上这一课；家长也不用着急补赶进度。</p></aside>{sections.map(([title,copy])=><article key={title}><b>{title}</b><textarea aria-label={title} defaultValue={copy}/></article>)}</div>
}

/**
 * 第二步的班级装裱墙。
 *
 * 作品与照片**分开核对**（US-009）：作品是必选项，按上传位平铺；
 * 课堂照片是选填项，按学员分组渲染 —— **没有照片的学员也占一行并显示占位**，
 * 这样照片不会因为少了几张就整体前移，让老师误以为照片是别人家的。
 */
function ClassFramingWall({artworks=[],photos=[],photoGroups=[],writeBackKeyOf=null,onRotate,onRotatePhotoEntry}){
  // 每幅作品的装裱状态（US-010）：有新鲜的写回成品图就直接显示它，并标出是「批量装裱」还是
  // 「老师单独保存」；写回过期（改过参数或改过这一幅）时退回原始素材并显示「待重画」。
  // 判据只用作品位上的记录 + 这一幅的新鲜度键，不在界面上另算一套规则。
  const framedStateOf=(item)=>{
    const record=artworkWriteBackOf(item);
    const fresh=typeof writeBackKeyOf==='function'?Boolean(writtenBackImageUrl(item,writeBackKeyOf(item))):false;
    if(record&&fresh) return record.batchId?'batch':'single';
    if(record) return 'stale';
    return '';
  };
  const framedLabelOf={batch:'已批量装裱',single:'老师单独保存的成品图',stale:'参数已改动 · 待重新装裱','':'已按完整画面装裱'};
  const renderItems=(items,kind)=>{const rotate=kind==='artwork'?onRotate:onRotatePhotoEntry;const typeLabel=kind==='artwork'?'作品':'照片';return <div className="class-framing-scroll">{items.length?items.map((item,index)=>{const framedState=kind==='artwork'?framedStateOf(item):'';const framedSrc=framedState&&framedState!=='stale'&&typeof writeBackKeyOf==='function'?writtenBackImageUrl(item,writeBackKeyOf(item)):'';const record=kind==='artwork'?artworkWriteBackOf(item):null;const planKey=kind==='artwork'&&typeof writeBackKeyOf==='function'?writeBackKeyOf(item):'';return <article className={`class-framing-item ${kind}${framedState?` is-${framedState}`:''}`} key={`${kind}-${item.uploadId||item.name}-${index}`} data-artwork-framed={kind==='artwork'?(framedState||'none'):undefined} data-artwork-writeback-student={record?.studentName||''} data-artwork-writeback-title={record?.title||''} data-artwork-writeback-batch={record?record.batchId:''} data-artwork-writeback-fingerprint={record?artworkUrlFingerprint(record.imageUrl):''} data-artwork-writeback-key={record?record.renderKey:''} data-artwork-writeback-plan-key={planKey} data-artwork-writeback-fresh={framedSrc?'true':'false'}><div className="class-framing-preview"><img src={framedSrc||item.url} alt={item.name} style={framedSrc?undefined:{transform:`rotate(${item.rotation||0}deg)`}}/><button type="button" onClick={()=>rotate?.(kind==='artwork'?index:item.uploadId)} title={`顺时针旋转${typeLabel}`}><RefreshCw size={14}/></button>{framedSrc?<em className="class-framing-framed-badge" data-artwork-framed-badge={framedState}>已装裱</em>:null}</div><div><b>{kind==='artwork'?'学员作品':'课堂照片'} {index+1}</b><small>{item.name}</small><em>{kind==='artwork'?framedLabelOf[framedState]:'已完成自然优化，可旋转校正'}</em></div></article>}):<div className="class-framing-empty">本次未上传{kind==='artwork'?'学员作品':'课堂照片'}。</div>}</div>};
  const photoSection=photoGroups.length?(
    <div className="class-framing-photo-groups">
      {photoGroups.map(group=>(
        <article className={`class-framing-photo-group${group.uploads.length?'':' empty'}`} key={participantKey(group.participant)}>
          <div className="class-framing-photo-group-head">
            <b>{group.participant.name}</b>
            <small>{group.uploads.length?`${group.uploads.length} 张`:'未上传课堂照片（选填）'}</small>
          </div>
          {group.uploads.length?<div className="class-framing-photo-thumbs">
            {group.uploads.map(item=>(
              <figure key={item.uploadId}>
                <img src={item.url} alt={`${group.participant.name}的课堂照片`} style={{transform:`rotate(${item.rotation||0}deg)`}}/>
                <button type="button" onClick={()=>onRotatePhotoEntry?.(item.uploadId)} title="顺时针旋转照片"><RefreshCw size={14}/></button>
                {item.owners.length>1?<em>共用 · {item.owners.length} 人</em>:null}
              </figure>
            ))}
          </div>:<div className="class-framing-photo-placeholder"><Image size={14}/><span>本次没有这位孩子的课堂照片</span></div>}
        </article>
      ))}
    </div>
  ):renderItems(photos,'photo');
  return <section className="class-framing-wall">
    <div className="class-framing-wall-head"><div><b>本班装裱任务</b><small>作品与照片分开处理、分开核对；课堂照片按学员分组，没有照片的孩子显示占位。</small></div></div>
    <section className="class-framing-section"><div className="class-framing-section-head"><div><Frame size={16}/><b>学员作品</b></div><span>{artworks.length} 幅</span></div>{renderItems(artworks,'artwork')}</section>
    <section className="class-framing-section"><div className="class-framing-section-head"><div><Image size={16}/><b>课堂照片（按学员）</b></div><span>{photos.length} 张</span></div>{photoSection}</section>
  </section>
}

/**
 * 班级素材合展（第三步的班级反馈素材墙）。
 *
 * 展签只读 `item.plaque`（来自 data/uploadBinding 的**带绑定结构**）：姓名来自
 * participant.artworkIds/photoIds 对应的真实学员，作品名来自条目上的 title，日期来自课次日期。
 * 旧实现用 `students[index % students.length]` 猜姓名、把 `2026.08.11` 写死在组件里，
 * 素材份数多于学员数时会把同一个孩子的作品算到别人名下；US-406a 已删除这套推断。
 *
 * US-009：课堂照片传 `groups`（按学员分组，含没有照片的学员）时按分组铺 —— 少照片的学员
 * 显示**占位**而不是让后面的照片前移错位；一张合影出现在多位学员的分组里，展签写明是共用。
 */
function ClassMediaMosaic({items=[],kind='artwork',groups=null,onRotate,onRotateEntry,date='',writeBackKeyOf=null}){
  const label=kind==='artwork'?'班级作品合展':'班级课堂瞬间';
  const plaqueDate=String(date||'').trim();
  const captionOf=item=>{
    const plaque=item.plaque||{};
    const student=String(plaque.studentName||item.studentName||'').trim();
    const title=String(plaque.title||item.title||'').trim();
    const parts=kind==='artwork'
      ? [student||'未绑定学员',title?`《${title}》`:'',plaqueDate]
      : [student||'未绑定学员',plaque.shared?'（共用照片）':'',plaqueDate];
    return parts.filter(Boolean).join(' · ');
  };
  const figureOf=(item,index,keyPrefix='')=>{
    // 保存图片写回档案的成品图优先（US-008b）：老师存过图之后，五维点评页立刻用新图。
    // 写回图已经是**整张成品**（自带画框与展签），所以不再叠条目上的展示旋转，只展示它本身。
    // US-010 起新鲜度键按**这一幅**算（`writeBackKeyOf`）—— 批量装裱会给每一幅写回成品图，
    // 用「第一幅的键」去判其它幅会把它们全部判成过期（US-008b 只算第一幅是当时的口径）。
    const writtenBack=typeof writeBackKeyOf==='function'?writtenBackImageUrl(item,writeBackKeyOf(item)):'';
    return (
    <figure key={`${keyPrefix}${item.uploadId||`${item.name}-${index}`}`}>
      <img src={writtenBack||item.url} alt={item.name} style={writtenBack?undefined:{transform:`rotate(${item.rotation||0}deg)`}} data-mosaic-src={writtenBack?'writeback':'upload'}/>
      {writtenBack?<span className="written-back-badge" data-mosaic-written-back="true">已保存成品图</span>:null}
      {kind==='artwork'?<span className="orientation-note">{item.orientationChecked?'已自动校正':'已手动旋转'}</span>:null}
      <button className="rotate-work" type="button" title={`顺时针旋转${kind==='artwork'?'作品':'照片'}`} onClick={()=>{if(onRotateEntry)onRotateEntry(item.uploadId);else onRotate?.(index)}}><RefreshCw size={12}/></button>
      <figcaption className={item.plaque?.studentName||item.studentName?'':'unbound'}>{captionOf(item)}</figcaption>
    </figure>
    );
  };
  const grouped=Array.isArray(groups)&&groups.length;
  const placeholderCount=grouped?groups.filter(group=>!group.uploads.length).length:0;
  const body=grouped
    ? groups.flatMap(group=>{
      // 同一张共用照片会出现在多行分组里，key 必须带上分组前缀，否则 React 会报重复 key 并可能复用错节点。
      const prefix=`${participantKey(group.participant)}-`;
      const rows=group.uploads.map((item,index)=>figureOf(item,index,prefix));
      if(!rows.length){
        rows.push(<figure key={`empty-${participantKey(group.participant)}`} className="mosaic-placeholder">
          <div><Image size={14}/><span>{group.participant.name}</span><small>本次未上传课堂照片（选填）</small></div>
        </figure>);
      }
      return rows;
    })
    : (items.length?items.map((item,index)=>figureOf(item,index)):<div className="mosaic-empty"><Frame/><span>等待班级素材上传</span></div>);
  return <div className={`class-media-mosaic ${kind}`}>{body}<div className="mosaic-label"><b>{label}</b><small>已收录 {items.length} 份{placeholderCount?` · ${placeholderCount} 位学员暂无照片，显示占位`:''}</small></div></div>;
}

/**
 * 作品观察词面板。
 * 词表来自**生效的观察词模板**（[第三步 US-109]：`data/reviewKeywordTemplates.js` 的
 * `keywordTemplateLoadout()` 产物，由 TeacherFlowV2 按本次模式 / 课程解析后传进来）——
 * 与提示词里的候选清单、模型返回值的校验是同一份，所以大模型识别出来的词一定能在这里被勾中
 * （见 `pickTemplateKeywords` 的说明），而模板之外的词两处都进不来。
 *
 * 面板上还会写明「这次用的是哪一套」：默认模板 / 按课程匹配到的模板，或
 * 「当前使用内置兜底词表（模板未连通）」——**不得静默降级**（FR-142）。
 *
 * 受控组件：selected / onToggle 由 TeacherFlowV2 持有，
 * 生成点评时模型返回的 keywords 会直接写回同一份状态。
 */
function ReviewKeywordDock({visible=false,selected=[],onToggle,suggested=[],suggesting=false,dirty=false,generated=false,template=null}){
  const [step,setStep]=useState(1),[open,setOpen]=useState(visible),[feedbackMode,setFeedbackMode]=useState(()=>window.__xinlehuiFeedbackMode||'个人反馈');
  useEffect(()=>{const update=(event)=>setStep(event.detail);window.addEventListener('xinlehui-feedback-step',update);return()=>window.removeEventListener('xinlehui-feedback-step',update)},[]);
  useEffect(()=>{const update=(event)=>setFeedbackMode(event.detail);window.addEventListener('xinlehui-feedback-mode',update);return()=>window.removeEventListener('xinlehui-feedback-mode',update)},[]);
  // 模型识别出词以后自动展开面板，老师一眼就能看到 AI 勾了什么。
  useEffect(()=>{if(suggested.length)setOpen(true)},[suggested]);
  if(!visible&&step!==3) return null;
  const isClass=feedbackMode==='班级反馈';
  // 分组与词条来自**生效的观察词模板**（US-109：`data/reviewKeywordTemplates.js` 的
  // keywordTemplateLoadout 产物 —— 面板顺序 = 模板 sortOrder，模板之外的词不会出现在这里）。
  // 组件里**不再有第二个词表来源**：模板是唯一入口，所以面板与提示词候选清单不可能各长一个样。
  const categories=template?.groupMap||{};
  const templateNote=template?.noteText||'';
  const active=selected;
  const aiSet=new Set(suggested);
  const toggle=(keyword)=>onToggle?.(keyword);
  const summary=suggesting
    ?'AI 正在识别画面内容…'
    :suggested.length?`AI 已识别 ${suggested.length} 项${active.length!==suggested.length?` · 共选 ${active.length} 项`:''}`
    :active.length?`已选择 ${active.length} 项`:'AI 自动识别，也可手动补充';
  return <aside className="review-keyword-dock">
    <button className="review-keyword-toggle" onClick={()=>setOpen(!open)}>
      <span><Sparkles size={15}/>{isClass?'班级课程观察关键词':'作品观察词'}{suggesting?<i className="keyword-scanning"/>:null}</span>
      <small className={suggested.length?'has-ai':''}>{summary}</small>
      <ChevronDown className={open?'open':''} size={16}/>
    </button>
    {open?<section className="review-keyword-panel">
      <div className="review-keyword-intro">
        <b>{isClass?'本节课的课程观察关键词':'作品观察词'}</b>
        <small>{isClass?'选择本节课的目标、流程与班级表现，AI 会据此生成一份有教育温度的班级课程反馈。':'大模型会先读懂作品，自动勾选能被画面证据支持的观察词；老师可随时增删，改动会同步进下一次生成的提示词。'}</small>
      </div>
      {template?<div className="review-keyword-template"
        data-keyword-template={template.templateKey||''}
        data-keyword-template-name={template.name}
        data-keyword-template-version={template.versionText||''}
        data-keyword-template-status={template.status}
        data-keyword-template-source={template.source}
        data-keyword-template-groups={template.counts?.groups||0}
        data-keyword-template-terms={template.counts?.terms||0}
        data-keyword-template-note={template.noteKind||''}>
        <b>{template.source==='builtin'?'内置兜底词表':`观察词模板：${template.name}${template.versionText?` ${template.versionText}`:''}`}</b>
        <small>{template.source==='builtin'
          ?'模板服务不可用，已回落到代码内置的词表。'
          :`${template.statusLabel}${template.matchedBy?.length?`（${template.matchedBy.join('、')}）`:''} · ${template.counts?.groups||0} 组 ${template.counts?.terms||0} 词`}</small>
        {templateNote?<em className="review-keyword-template-note" data-keyword-template-note-text>{templateNote}</em>:null}
      </div>:null}
      {dirty&&generated?<div className="review-keyword-dirty">观察词已调整，建议重新生成点评，让评语与关键词一致。</div>:null}
      <div className="review-keyword-groups">{Object.entries(categories).map(([name,options])=><section key={name}>
        <strong>{name}</strong>
        <div>{options.map(item=><button key={item}
          className={`${active.includes(item)?'active':''}${aiSet.has(item)?' ai-picked':''}`}
          title={aiSet.has(item)?'AI 依据画面识别并勾选':'老师手动选择'}
          onClick={()=>toggle(item)}>
          {item}{aiSet.has(item)?<i className="ai-mark" aria-hidden="true">AI</i>:null}
        </button>)}</div>
      </section>)}</div>
    </section>:null}
  </aside>;
}

function CourseLearningTimeline(){
  const [selected,setSelected]=useState(null);
  const sessions=[
    {date:'03 月 08 日',order:'第 01 课',title:'向着光的花',review:'大胆使用明亮的黄色，并愿意把画里的故事讲给老师听。'},
    {date:'03 月 15 日',order:'第 02 课',title:'海底世界',review:'开始主动安排画面里的大小关系，专注完成了鱼群细节。'},
    {date:'03 月 22 日',order:'第 03 课',absent:true},
    {date:'04 月 05 日',order:'第 04 课',title:'彩色的家',review:'在老师提问后继续调整颜色，让画面有了更丰富的层次。'},
    {date:'04 月 12 日',order:'第 05 课',title:'春日小径',review:'能安静观察后再落笔，也愿意倾听同伴的创作想法。'}
  ];
  return <section className="course-learning-timeline"><div className="course-timeline-title"><div><b>这一阶段的课程足迹</b><span>作品、课堂影像与老师观察，按上课日期一一留存。</span></div><small>共 12 次课程 · 以下为时间线预览</small></div><div className="course-timeline-list">{sessions.map((session,index)=>session.absent?<article className="lesson-track absent" key={session.date}><div className="lesson-date"><b>{session.date}</b><span>{session.order}</span></div><div className="absence-note"><span>这一次，一诺暂时没有来到课堂。</span><p>我们把这段空白也轻轻留在成长轨迹里，期待下次课再与她一起，把未完的灵感继续画下去。</p></div></article>:<article className="lesson-track" key={session.date}><div className="lesson-date"><b>{session.date}</b><span>{session.order}</span></div><div className={`track-art art-${index}`}><i className="track-flower"/><i className="track-stem"/></div><div className="track-photo"><img src={pandaWave} alt={`${session.title}课堂照片`}/><span>课堂照片</span></div><div className="track-review"><b>{session.title}</b><p>{session.review}</p><button onClick={()=>setSelected(session)}>查看本节完整反馈 <ArrowRight/></button></div></article>)}</div>{selected?<div className="track-feedback-drawer"><div><span>{selected.date} · {selected.order} · {selected.title}</span><h3>本节课的完整成长反馈</h3><p>{selected.review}</p><small>已关联本节作品、课堂照片、视频片段与老师的五维观察。</small></div><button aria-label="关闭本节反馈" onClick={()=>setSelected(null)}><X/></button></div>:null}</section>
}

function StageReviewSummary({show}){
  const [open,setOpen]=useState(false);
  const [assessment,setAssessment]=useState(false);
  const [selectedLesson,setSelectedLesson]=useState(null);
  const lessons=[
    ['第 01 次','向着光的花','能持续完成花瓣细节，并主动讲述“想把光送给妈妈”。'],
    ['第 03 次','海底世界','尝试用不同大小的鱼群组织画面，分享时能说出自己的安排。'],
    ['第 05 次','彩色的家','在颜色选择上更果断，遇到停顿后能在提示下继续完成。'],
    ['第 08 次','春日小径','开始主动留出画面空间，能耐心完成前景与背景的变化。'],
    ['第 10 次','雨后的花园','观察后再落笔，愿意倾听同伴分享，也能表达自己的选择。'],
    ['第 12 次','向日葵的光','冷暖色关系更清晰，专注完成后愿意把创作故事讲给大家听。']
  ];
  if(!show)return null;
  return <section className="stage-review-summary">
    <div className="stage-review-brief"><div><span>课次点评已归档</span><h3>12 次课程的老师观察，已经和每一张作品、课堂照片一一对应保存。</h3><p>阶段总结、进步点与学习规划仍完整保留在上方；这里用于回看每一节课的具体表现。</p></div><button onClick={()=>setOpen(true)}>查看 12 节课点评 <ArrowRight/></button></div>
    {open?<div className="stage-review-detail" role="dialog" aria-label="每节课详细点评"><div className="stage-review-detail-head"><div><span>陈一诺 · 课次成长记录</span><h3>每一节课，都有被认真看见的细节。</h3></div><button aria-label="关闭详细点评" onClick={()=>setOpen(false)}><X/></button></div><div className="lesson-review-list">{lessons.map(([order,title,review])=><article key={order}><div><span>{order}</span><b>{title}</b></div><p>{review}</p><button onClick={()=>setSelectedLesson([order,title,review])}>查看本节完整反馈 <ArrowRight/></button></article>)}</div>{selectedLesson?<div className="lesson-feedback-detail"><div><span>{selectedLesson[0]} · {selectedLesson[1]}</span><h4>本节课堂完整反馈</h4><p>{selectedLesson[2]}</p><small>已关联：本节作品、课堂照片、课堂视频与老师观察。</small></div><button onClick={()=>setSelectedLesson(null)}><X/></button></div>:null}<div className="assessment-entry"><div><Sparkles/><span><b>学能测评报告</b><small>从课堂学习过程观察专注、表达、规划与审美等能力变化。</small></span></div><button onClick={()=>setAssessment(!assessment)}>{assessment?'收起测评报告':'生成学能测评报告'} <ArrowRight/></button></div>{assessment?<div className="learning-assessment"><div><span>阶段学能测评 · 课堂观察版</span><h3>她正在把“想画什么”，慢慢变成“知道怎样画出来”。</h3><p>依据本阶段作品、照片、视频与老师课堂记录形成，仅用于学习陪伴与课程规划，不用于医学、心理或智力诊断。</p></div><div className="assessment-grid">{[['观察与感知','能留意到花瓣朝向、颜色冷暖等细节。','稳定发展'],['专注与坚持','完成细节的持续性比阶段初更稳定。','进步明显'],['表达与叙事','能把画面想法说成具体故事。','进步明显'],['规划与执行','开始先观察再落笔，并能调整画面。','稳步建立'],['审美与创造','有鲜明色彩偏好，也愿意尝试新的组合。','优势表现'],['下一步支持','在构图观察与自主讲述中继续积累。','学习建议']].map(([name,copy,status])=><article key={name}><b>{name}</b><p>{copy}</p><span>{status}</span></article>)}</div></div>:null}<button className="stage-detail-close" onClick={()=>setOpen(false)}>收起课次点评</button></div>:null}
  </section>;
}

function GrowthArchiveBuilderLegacy({setToast}){
  const [period,setPeriod]=useState('一学期');
  const [format,setFormat]=useState('成长集锦');
  const [generated,setGenerated]=useState(false);
  const periods=['半学期','一学期','一年度','自定义时间'];
  const formats=[['成长集锦',Image,'作品、课堂照片与阶段回顾'],['作品集',Frame,'周期内全部作品的线上展览'],['成长记录（视频）',Film,'课堂视频与成长瞬间剪辑']];
  return <><PageHeader title="成长档案" desc="让看得见的服务，沉淀成孩子可感知的进步与下一步学习方向。" prd={PRD.archives}/>
    <section className="growth-builder">
      <div className="growth-builder-top">
        <div><span>为孩子生成一份阶段成长档案</span><h2>把一次次认真，连成清晰的成长轨迹。</h2><p>报告包含作品、课堂照片、视频、五维点评、阶段总结与下一阶段学习规划，方便家长理解孩子，也便于老师持续陪伴。</p></div>
        <img src={pandaObserve} alt="熊猫成长伙伴"/>
      </div>
      <div className="growth-controls"><label>选择学员<select><option>陈一诺 · 7岁</option><option>林小满 · 8岁</option><option>赵禾 · 9岁</option></select></label><label>选择班级<select><option>周六创意绘画 2 班</option><option>色彩启蒙班</option></select></label></div>
      <div className="period-picker"><b>生成周期</b><div>{periods.map(item=><button key={item} className={period===item?'active':''} onClick={()=>setPeriod(item)}>{item}</button>)}</div>{period==='自定义时间'?<div className="custom-period"><input type="date" defaultValue="2026-03-01"/><i>至</i><input type="date" defaultValue="2026-08-31"/></div>:null}</div>
      <div className="archive-format-picker"><b>选择生成内容</b><div>{formats.map(([name,Icon,desc])=><button key={name} className={format===name?'active':''} onClick={()=>{setFormat(name);setGenerated(false)}}><Icon/><span><strong>{name}</strong><small>{desc}</small></span></button>)}</div></div>
      <div className="report-scope"><article><Frame/><div><b>服务被看见</b><small>精选作品、照片、视频与课堂记录</small></div></article><article><Sparkles/><div><b>进步可感知</b><small>美术能力、行为表现与阶段变化</small></div></article><article><ArrowRight/><div><b>下一步有方向</b><small>可执行的学习规划与家庭陪伴建议</small></div></article></div>
      <Button icon={FileText} onClick={()=>{setGenerated(true);setToast(`${period}${format}已生成`)}}>生成{period}{format}</Button>
      {generated?<section className="growth-report-preview"><div className="report-title"><span>陈一诺 · {period}{format}</span><h2>{format==='成长记录（视频）'?'这一阶段的认真，值得被温柔回看。':'这一次的成长，已经被完整看见。'}</h2><p>共记录 12 次课程 · 26 幅作品 · 18 张课堂照片 · 6 段成长影像</p></div>{format==='成长记录（视频）'?<div className="growth-video-hero"><Film/><b>陈一诺 · {period}成长记录</b><small>作品、课堂高光与老师寄语 · 02:16</small></div>:<><div className="all-media-title"><b>{format==='作品集'?'本周期全部作品':'本周期作品与课堂照片'}</b><small>AI 已按课程时间线完整收录，以下为预览</small></div><div className="all-media-grid">{['向着光的花','海底世界','彩色的家','春日小径','课堂合影 01','课堂合影 02','认真创作','分享瞬间'].map((name,index)=><figure key={name} className={index>3?'photo':''}>{index>3?<img src={pandaWave} alt={name}/>:<i>✺</i>}<figcaption>{name}</figcaption></figure>)}</div></>}<div className="growth-report-grid"><article><b>美术能力</b><p>从大胆用色，进步到能主动组织冷暖关系与画面主次。</p></article><article><b>课堂表现</b><p>专注时间更稳定，愿意分享想法，也能倾听并完成自己的创作。</p></article><article><b>本阶段进步</b><p>从“完成作品”走向“用画讲述自己的故事”。</p></article><article><b>下一阶段学习规划</b><p>围绕色彩层次、构图观察与主题表达，每两周保留一次作品回看与自主讲述。</p></article><article><b>给家长的陪伴建议</b><p>先请孩子讲创作，再问一个具体问题；把她的表达当作成长线索，而非对错答案。</p></article><article><b>老师寄语</b><p>愿一诺继续带着好奇与勇气，在每一次落笔里长出更清晰的自己。</p></article></div><div className="report-footer"><span>下一阶段：色彩表达与构图观察 · 建议继续学习 12 次</span><Button icon={MessageSquareText} onClick={()=>setToast('家长版成长档案链接已生成')}>生成家长版并转发</Button></div></section>:null}
    </section><StageReviewSummary show={generated&&format!=='成长记录（视频）'}/></>;
}

function AcademicAssessmentLegacy(){
  return null;
}

function GrowthArchiveBuilderLegacy2({setToast}){
  const [period,setPeriod]=useState('一学期');
  const [format,setFormat]=useState('成长集锦');
  const [generated,setGenerated]=useState(false);
  const periods=['半学期','一学期','一年度','自定义时间'];
  const formats=[['成长集锦',Image,'作品、课堂照片与阶段回看'],['作品集',Frame,'周期内全部作品的线上展览'],['成长记录（视频）',Film,'课堂视频与成长瞬间剪辑']];
  const reportItems=[['美术能力','从大胆用色，进步到能主动组织冷暖关系与画面主次。'],['课堂表现','专注时间更稳定，愿意分享想法，也能倾听并完成自己的创作。'],['本阶段进步','从“完成作品”走向“用画讲述自己的故事”。'],['下一阶段学习规划','围绕色彩层次、构图观察与主题表达，每两周保留一次作品回看与自主讲述。'],['给家长的陪伴建议','先请孩子讲创作，再问一个具体问题；把她的表达当作成长线索，而非对错答案。'],['老师寄语','愿一诺继续带着好奇与勇气，在每一次落笔里长出更清晰的自己。']];
  return <><PageHeader title="成长档案" desc="让看得见的服务，沉淀成孩子可感知的进步与下一步学习方向。" prd={PRD.archives}/><section className="growth-builder"><div className="growth-builder-top"><div><h2>把一次次认真，连成清晰的成长轨迹。</h2><p>按日期串联作品、课堂照片、每节课的点评与阶段总结，让家长清楚看见孩子的学习状态。</p></div><img src={pandaObserve} alt="熊猫成长伙伴"/></div><div className="growth-controls"><label>选择学员<select><option>陈一诺 · 7岁</option><option>林小满 · 8岁</option><option>赵禾 · 9岁</option></select></label><label>选择班级<select><option>周六创意绘画 2 班</option><option>色彩启蒙班</option></select></label></div><div className="period-picker"><b>生成周期</b><div>{periods.map(item=><button key={item} className={period===item?'active':''} onClick={()=>setPeriod(item)}>{item}</button>)}</div>{period==='自定义时间'?<div className="custom-period"><input type="date" defaultValue="2026-03-01"/><i>至</i><input type="date" defaultValue="2026-08-31"/></div>:null}</div><div className="archive-format-picker"><b>选择生成内容</b><div>{formats.map(([name,Icon,desc])=><button key={name} className={format===name?'active':''} onClick={()=>{setFormat(name);setGenerated(false)}}><Icon/><span><strong>{name}</strong><small>{desc}</small></span></button>)}</div></div><Button icon={FileText} onClick={()=>{setGenerated(true);setToast(`${period}${format}已生成`)}}>生成{period}{format}</Button>{generated?<section className="growth-report-preview"><div className="report-title"><span>陈一诺 · {period}{format}</span><h2>{format==='成长记录（视频）'?'这一阶段的认真，值得被温柔回看。':'这一次的成长，已经被完整看见。'}</h2><p>共记录 12 次课程 · 26 幅作品 · 18 张课堂照片 · 6 段成长影像</p></div>{format==='成长记录（视频）'?<div className="growth-video-hero"><Film/><b>陈一诺 · {period}成长记录</b><small>作品、课堂高光与老师寄语 · 02:16</small></div>:<><CourseLearningTimeline/><div className="growth-report-grid">{reportItems.map(([title,copy])=><article key={title}><b>{title}</b><p>{copy}</p></article>)}</div><AcademicAssessment/></>}<div className="report-footer"><span>下一阶段：色彩表达与构图观察 · 建议继续学习 12 次</span><Button icon={MessageSquareText} onClick={()=>setToast('家长版成长档案链接已生成')}>生成家长版并转发</Button></div></section>:null}</section></>;
}

function LearningRadarLegacy(){
  const dimensions=[['观察感知','86'],['专注坚持','78'],['表达叙事','82'],['规划执行','71'],['审美创造','91'],['互动协作','76']];
  return <div className="learning-radar"><div className="radar-visual"><svg viewBox="0 0 240 220" role="img" aria-label="六维课堂学习观察雷达图"><g className="radar-grid"><polygon points="120,16 210,68 210,152 120,204 30,152 30,68"/><polygon points="120,47 183,83 183,137 120,173 57,137 57,83"/><polygon points="120,78 156,99 156,121 120,142 84,121 84,99"/><path d="M120 16V204M30 68L210 152M210 68L30 152"/></g><polygon className="radar-fill" points="120,35 185,82 173,132 120,155 39,157 55,89"/><g className="radar-dot"><circle cx="120" cy="35" r="4"/><circle cx="185" cy="82" r="4"/><circle cx="173" cy="132" r="4"/><circle cx="120" cy="155" r="4"/><circle cx="39" cy="157" r="4"/><circle cx="55" cy="89" r="4"/></g></svg>{dimensions.map(([label,value],i)=><span key={label} className={`radar-label r${i}`}><b>{label}</b><em>{value}</em></span>)}</div><div className="radar-summary"><b>本阶段学习观察</b><p>审美创造与观察感知是这一阶段更突出的力量；规划执行可在下阶段通过“先想一想再落笔”的练习慢慢建立。</p><div><span><i className="good"/>优势：审美创造</span><span><i className="next"/>下一步：规划执行</span></div></div></div>
}

function AcademicAssessment(){
  const [open,setOpen]=useState(false);
  const rows=[['观察与感知','能发现颜色、大小与方向的变化。','稳定发展'],['专注与坚持','完成细节的持续性比阶段初更稳定。','进步明显'],['表达与叙事','能把画面想法讲成具体故事。','进步明显'],['规划与执行','开始先观察再落笔，也会主动调整。','稳步建立'],['审美与创造','有鲜明的色彩偏好，愿意尝试组合。','优势表现'],['下一步支持','继续积累构图观察与自主讲述。','学习建议']];
  return <section className="academic-assessment"><div><span>阶段学能测评报告</span><h3>从每次创作里，看见孩子正在形成的学习力量。</h3><p>依据课程作品、课堂照片、视频与老师观察形成，用于学习陪伴与课程规划，不作为医学、心理或智力诊断。</p></div><button onClick={()=>setOpen(!open)}>{open?'收起测评报告':'查看学能测评报告'} <ArrowRight/></button>{open?<><LearningRadar/><div className="assessment-grid">{rows.map(([name,copy,status])=><article key={name}><b>{name}</b><p>{copy}</p><span>{status}</span></article>)}</div></>:null}</section>
}

function OnlineExhibition(){
  const [active,setActive]=useState('向着光的花');
  const works=['向着光的花','海底世界','彩色的家','春日小径'];
  return <section className="online-exhibition"><div className="exhibition-head"><div><span>陈一诺 · 2026 春季作品展</span><h3>走进她的色彩美术馆。</h3><p>AI 为每一幅作品布置独立展墙与展签，保留作品原本的线条和色彩。</p></div><button><Frame/>进入全屏展览</button></div><div className="virtual-gallery"><div className="gallery-ceiling-light"/>{works.map((work,index)=><button key={work} className={`gallery-work work-${index} ${active===work?'active':''}`} onClick={()=>setActive(work)}><div className="gallery-frame-work"><i/></div><span>陈一诺</span><b>《{work}》</b><small>2026 春季创作</small></button>)}</div><div className="exhibition-footer"><span>当前展出：<b>《{active}》</b></span><p>点击任意作品，进入这幅画的创作故事与课堂记录。</p></div></section>
}

function GrowthArchiveBuilder({setToast}){
 const [period,setPeriod]=useState('一学期'),[format,setFormat]=useState('成长集锦'),[generated,setGenerated]=useState(false);
 const formats=[['成长集锦',Image,'作品、照片、点评与成长数据'],['作品集',Frame,'AI 布置成线上美术馆展览'],['成长记录（视频）',Film,'课堂视频与成长瞬间剪辑']];
 const reportItems=[['美术能力','从大胆用色，进步到能主动组织冷暖关系与画面主次。'],['课堂表现','专注时间更稳定，愿意分享想法，也能倾听并完成自己的创作。'],['本阶段进步','从“完成作品”走向“用画讲述自己的故事”。'],['下一阶段学习规划','围绕色彩层次、构图观察与主题表达，每两周保留一次作品回看与自主讲述。'],['给家长的陪伴建议','先请孩子讲创作，再问一个具体问题；把她的表达当作成长线索，而非对错答案。'],['老师寄语','愿一诺继续带着好奇与勇气，在每一次落笔里长出更清晰的自己。']];
 return <><PageHeader title="成长档案" desc="让看得见的服务，沉淀成孩子可感知的进步与下一步学习方向。" prd={PRD.archives}/><section className="growth-builder"><div className="growth-builder-top"><div><h2>把一次次认真，连成清晰的成长轨迹。</h2><p>按日期串联作品、课堂照片、每节课的点评与阶段总结，让家长清楚看见孩子的学习状态。</p></div><img src={pandaObserve} alt="熊猫成长伙伴"/></div><div className="growth-controls"><label>选择学员<select><option>陈一诺 · 7岁</option><option>林小满 · 8岁</option></select></label><label>选择班级<select><option>周六创意绘画 2 班</option><option>色彩启蒙班</option></select></label></div><div className="period-picker"><b>生成周期</b><div>{['半学期','一学期','一年度','自定义时间'].map(item=><button key={item} className={period===item?'active':''} onClick={()=>setPeriod(item)}>{item}</button>)}</div></div><div className="archive-format-picker"><b>选择生成内容</b><div>{formats.map(([name,Icon,desc])=><button key={name} className={format===name?'active':''} onClick={()=>{setFormat(name);setGenerated(false)}}><Icon/><span><strong>{name}</strong><small>{desc}</small></span></button>)}</div></div><Button icon={FileText} onClick={()=>{setGenerated(true);setToast(`${period}${format}已生成`)}}>生成{period}{format}</Button>{generated?<section className="growth-report-preview"><div className="report-title"><span>陈一诺 · {period}{format}</span><h2>{format==='作品集'?'这一次的作品，正在自己的美术馆里发光。':format==='成长记录（视频）'?'这一阶段的认真，值得被温柔回看。':'这一次的成长，已经被完整看见。'}</h2><p>共记录 12 次课程 · 26 幅作品 · 18 张课堂照片 · 6 段成长影像</p></div>{format==='成长记录（视频）'?<div className="growth-video-hero"><Film/><b>陈一诺 · {period}成长记录</b><small>作品、课堂高光与老师寄语 · 02:16</small></div>:format==='作品集'?<OnlineExhibition/>:<><CourseLearningTimeline/><div className="growth-report-grid">{reportItems.map(([title,copy])=><article key={title}><b>{title}</b><p>{copy}</p></article>)}</div><AcademicAssessment/></>}<div className="report-footer"><span>下一阶段：色彩表达与构图观察 · 建议继续学习 12 次</span><Button icon={MessageSquareText} onClick={()=>setToast('家长版成长档案链接已生成')}>生成家长版并转发</Button></div></section>:null}</section></>;
}

function StudentArchiveHubLegacy(){
  const [student,setStudent]=useState('陈一诺');
  const [tab,setTab]=useState('档案概览');
  const [assessment,setAssessment]=useState('新生试课');
  const [saved,setSaved]=useState(false);
  const tabs=['档案概览','入学 / 学期测评','课程作品','阶段报告'];
  const studentData={
    '陈一诺':{age:'7岁',lessons:'12',expect:'希望在色彩表达中更敢于讲出自己的想法。',ability:'喜欢明亮色彩，已能观察冷暖关系；构图组织正在建立。'},
    '林小满':{age:'8岁',lessons:'9',expect:'希望提升观察力与耐心，找到属于自己的绘画节奏。',ability:'线条细腻，愿意反复观察；画面主次需要继续练习。'},
    '赵禾':{age:'9岁',lessons:'15',expect:'希望在素描基础与空间表达上获得系统提升。',ability:'造型意识较强，画面细节丰富；光影观察需要持续积累。'}
  };
  const profile=studentData[student];
  return <><PageHeader title="班级学员" desc="每个孩子从第一次相遇开始，都有一份持续生长的教育档案。" prd={PRD.classes}/><section className="student-archive-hub"><aside className="archive-student-rail"><div><b>我的学员</b><small>周六创意绘画 2 班</small></div>{Object.keys(studentData).map((name,index)=><button key={name} className={student===name?'active':''} onClick={()=>{setStudent(name);setTab('档案概览')}}><span className={`avatar lg a${index}`}>{name[0]}</span><div><b>{name}</b><small>{studentData[name].age} · 已上 {studentData[name].lessons} 课时</small></div><ArrowRight/></button>)}<button className="new-student-entry"><Plus/>新建学员档案</button></aside><main className="student-archive-main"><header className="student-archive-head"><div><span>{student} · 个人成长档案</span><h2>每一次表达，都成为下一次成长的线索。</h2><p>{profile.age} · 周六创意绘画 2 班 · 已留存 {profile.lessons} 节课记录</p></div><Button icon={FileText}>分享给家长</Button></header><nav className="student-archive-tabs">{tabs.map(item=><button key={item} className={tab===item?'active':''} onClick={()=>setTab(item)}>{item}</button>)}</nav>{tab==='档案概览'?<div className="student-profile-form"><section><div className="profile-section-head"><div><b>入档信息</b><span>第一次沟通时建立，老师可持续更新</span></div><button onClick={()=>setSaved(true)}>{saved?'已保存':'保存档案'}</button></div><div className="profile-fields"><label>孩子的学习期待<textarea defaultValue={profile.expect}/></label><label>当前阶段能力<textarea defaultValue={profile.ability}/></label><label>老师首次观察<textarea defaultValue="在试课中愿意尝试新颜色；先观察后落笔，表达时需要一点等待和鼓励。"/></label><label>家长希望获得的支持<textarea defaultValue="希望孩子能放松创作，也更自信地表达自己的想法。"/></label></div></section><section className="profile-growth-route"><div><b>成长档案会持续收录</b><span>不是一次填写完毕，而是陪伴孩子一路生长。</span></div><div>{[['每次课','作品、照片、视频与课堂点评'],['每个阶段','成长报告、学能测评与学习规划'],['每个学期','前后测对比、家长沟通建议与续学方向']].map(([title,desc])=><article key={title}><i/><b>{title}</b><p>{desc}</p></article>)}</div></section></div>:null}{tab==='入学 / 学期测评'?<section className="assessment-center"><div className="assessment-mode"><div><b>测评类型</b><p>新生试课用于建立教育基线；新学期前复测，用于学期末看见真实变化。</p></div><div>{['新生试课','学期前复测','学期末对比'].map(item=><button key={item} className={assessment===item?'active':''} onClick={()=>setAssessment(item)}>{item}</button>)}</div></div><div className="assessment-overview"><div><span>{assessment}</span><h3>{assessment==='新生试课'?'先看见孩子，再决定怎样陪伴她。':assessment==='学期前复测'?'让新的学习，从清楚的起点开始。':'把这一学期的努力，变成看得见的变化。'}</h3><p>评估维度包含美术能力、学习能力、表达与互动、创作状态和成长支持方向；所有结论来自课堂任务、作品与老师观察。</p><Button icon={Sparkles}>开始本次测评</Button></div><LearningRadar/></div><div className="assessment-compare"><div><b>家长一眼看懂的对比</b><span>当前为课堂观察数据，不用于医学、心理或智力诊断。</span></div>{[['美术观察','72','86'],['专注坚持','66','78'],['表达叙事','61','82'],['规划执行','58','71'],['审美创造','77','91']].map(([name,before,now])=><article key={name}><b>{name}</b><div><i style={{width:`${before}%`}}/><em style={{width:`${now}%`}}/></div><span>入学 {before}</span><strong>当前 {now}</strong></article>)}</div><div className="parent-conversation"><b>本次家长沟通建议</b><p>先告诉家长孩子已经展现出的优势，再共同确认一个本阶段可支持的小目标：例如“每次创作前，先和孩子一起说一说画面里最想表达的一个重点”。</p><button>生成沟通纪要 <ArrowRight/></button></div></section>:null}{tab==='课程作品'?<section className="student-work-archive"><div><b>每节课的作品与记录</b><span>作品、课堂照片和老师点评按上课日期一一留存。</span></div>{[['03.08','向着光的花','大胆用色，愿意分享画里的故事。'],['03.15','海底世界','主动组织大小关系，专注完成细节。'],['03.22','缺课记录','这一次没能来到课堂，我们把这段空白轻轻留在成长轨迹里。'],['04.05','彩色的家','能在提示后调整画面，让色彩层次更丰富。']].map((item,index)=><article className={index===2?'absent':''} key={item[0]}><time>{item[0]}</time>{index===2?<div><b>{item[1]}</b><p>{item[2]}</p></div>:<><div className={`student-work-thumb s${index}`}/><div className="student-photo-thumb"><img src={pandaWave} alt={`${item[1]}课堂照片`}/></div><div><b>《{item[1]}》</b><p>{item[2]}</p><button>查看完整点评 <ArrowRight/></button></div></>}</article>)}</section>:null}{tab==='阶段报告'?<section className="student-reports"><div className="report-card-primary"><span>2026 春季 · 阶段成长报告</span><h3>这一次的成长，已经被完整看见。</h3><p>包含全部课程记录、作品、照片、阶段总结、学能测评与下一阶段学习规划。</p><Button icon={FileText}>查看完整报告</Button></div><div className="report-mini-grid">{[['成长集锦','作品、照片、课程点评与成长雷达'],['线上作品展','陈一诺的春季线上美术馆'],['成长记录（视频）','课堂高光与老师寄语']].map(([title,desc])=><article key={title}><b>{title}</b><p>{desc}</p><button>查看 <ArrowRight/></button></article>)}</div></section>:null}</main></section></>;
}

function StudentArchiveHub(){
 const [student,setStudent]=useState('陈一诺'),[tab,setTab]=useState('基础档案'),[saved,setSaved]=useState(false);
 const people={
  '陈一诺':{age:'7岁',birth:'2019-04-18',gender:'女',source:'家长朋友转介绍',experience:'有半年儿童画学习经历',expect:'希望更自信地表达自己的想法。'},
  '林小满':{age:'8岁',birth:'2018-09-06',gender:'女',source:'小红书内容了解',experience:'无系统学习经历',expect:'希望在观察和耐心上有更多进步。'},
  '赵禾':{age:'9岁',birth:'2017-01-22',gender:'男',source:'校区路过咨询',experience:'学过一年创意美术',expect:'希望获得更系统的造型与色彩训练。'}
 };
 const profile=people[student];
 return <><PageHeader title="学员档案" desc="从第一次沟通开始，为每个孩子建立可持续生长的教育档案。" prd={PRD.classes}/><section className="student-archive-hub"><aside className="archive-student-rail"><div><b>我的学员</b><small>周六创意绘画 2 班</small></div>{Object.keys(people).map((name,index)=><button key={name} className={student===name?'active':''} onClick={()=>{setStudent(name);setTab('基础档案')}}><span className={`avatar lg a${index}`}>{name[0]}</span><div><b>{name}</b><small>{people[name].age} · 成长档案</small></div><ArrowRight/></button>)}<button className="new-student-entry"><Plus/>新建学员档案</button></aside><main className="student-archive-main"><header className="student-archive-head"><div><span>{student} · 个人成长档案</span><h2>让孩子的每一步，都有温柔而清晰的记录。</h2><p>{profile.age} · 已归档 12 节课 · 26 幅作品</p></div><Button icon={FileText}>分享给家长</Button></header><nav className="student-archive-tabs">{['基础档案','入学 / 学期测评','课程作品','阶段报告'].map(item=><button key={item} className={tab===item?'active':''} onClick={()=>setTab(item)}>{item}</button>)}</nav>{tab==='基础档案'?<section className="student-profile-form"><div className="profile-section-head"><div><b>学员基础信息</b><span>首次建立档案时填写；信息会成为后续教学与沟通的背景。</span></div><button onClick={()=>setSaved(true)}>{saved?'已保存':'保存档案'}</button></div><div className="base-info-grid"><label>姓名<input defaultValue={student}/></label><label>性别<select defaultValue={profile.gender}><option>女</option><option>男</option><option>其他 / 暂不填写</option></select></label><label>出生年月日<input type="date" defaultValue={profile.birth}/></label><label>当前年龄<input defaultValue={profile.age}/></label><label>是否有学习经历<select defaultValue={profile.experience}><option>无系统学习经历</option><option>有半年儿童画学习经历</option><option>有一年以上美术学习经历</option></select></label><label>了解机构的渠道<select defaultValue={profile.source}><option>家长朋友转介绍</option><option>小红书内容了解</option><option>校区路过咨询</option><option>活动 / 公开课</option></select></label></div><div className="profile-fields"><label>孩子与家长的学习期待<textarea defaultValue={profile.expect}/></label><label>当前阶段能力与偏好<textarea defaultValue="喜欢明亮色彩，愿意尝试；画面组织与自主表达正在建立。"/></label><label>老师首次观察<textarea defaultValue="愿意参与任务，开始时稍有犹豫；得到具体鼓励后能持续完成作品。"/></label><label>家长沟通备注<textarea defaultValue="家长希望孩子享受创作过程，也期待看到明确的阶段进步。"/></label></div></section>:null}{tab==='入学 / 学期测评'?<StudentAssessment student={student}/>:null}{tab==='课程作品'?<CourseLearningTimeline/>:null}{tab==='阶段报告'?<section className="student-reports"><div className="report-card-primary"><span>2026 春季 · 阶段成长报告</span><h3>这一次的成长，已经被完整看见。</h3><p>包含作品、照片、每节课点评、成长数据和下阶段学习规划。</p><Button icon={FileText}>查看完整报告</Button></div><div className="report-mini-grid">{[['成长集锦','作品、照片、课堂点评与成长雷达'],['线上作品展','陈一诺的春季线上美术馆'],['成长记录（视频）','课堂高光与老师寄语']].map(([title,desc])=><article key={title}><b>{title}</b><p>{desc}</p><button>查看 <ArrowRight/></button></article>)}</div></section>:null}</main></section></>;
}

function StudentAssessment({student}){const [type,setType]=useState('新生试课');return <section className="assessment-center"><div className="assessment-mode"><div><b>测评类型</b><p>新生试课建立教育基线；新学期前复测；学期末以同一维度看见具体变化。</p></div><div>{['新生试课','学期前复测','学期末对比'].map(item=><button key={item} className={type===item?'active':''} onClick={()=>setType(item)}>{item}</button>)}</div></div><div className="assessment-overview"><div><span>{student} · {type}</span><h3>{type==='新生试课'?'先理解孩子，再开始适合她的陪伴。':type==='学期前复测'?'让新的学习，从清楚的起点开始。':'这一学期的努力，正在变成看得见的变化。'}</h3><p>从美术观察、造型色彩、专注、表达叙事、规划执行、审美创造与互动协作七个维度观察。</p><Button icon={Sparkles}>开始本次测评</Button></div><LearningRadar/></div><div className="assessment-compare"><div><b>阶段前后对比</b><span>数据来自课堂任务、作品与老师观察，不作医学、心理或智力诊断。</span></div>{[['美术观察','72','86'],['造型色彩','68','83'],['专注坚持','66','78'],['表达叙事','61','82'],['规划执行','58','71'],['审美创造','77','91']].map(([name,before,now])=><article key={name}><b>{name}</b><div><i style={{width:`${before}%`}}/><em style={{width:`${now}%`}}/></div><span>起点 {before}</span><strong>当前 {now}</strong></article>)}</div><div className="parent-conversation"><b>与家长的沟通建议</b><p>先分享孩子已经拥有的力量，再一起确定一个可实践的小目标：下次创作前，邀请孩子说出“我最想画的一个重点”。</p><button>生成沟通纪要 <ArrowRight/></button></div></section>}

function TeacherAIWorkspace({navigate}){const [zone,setZone]=useState('课前工作');const zones={
 '课前工作':[['课程灵感与教案','按年龄、主题和材料生成可编辑教案'],['备课材料清单','自动整理材料、步骤与安全提醒'],['学员课前画像','快速了解期待、能力与上次课观察']],
 '课中支持':[['课堂观察速记','语音转文字，留存孩子的关键表现'],['课堂提问卡','生成启发式问题，帮助孩子表达'],['课堂素材采集','按学员归档照片、视频和作品']],
 '课后反馈':[['智能装裱','作品、照片、视频的一键专业呈现'],['五维点评','基于本次素材生成可编辑观察'],['成长档案','归档课程记录并生成阶段报告']],
 '宣传招生':[['体验课邀约','生成不同家长人群的邀约文案'],['课程亮点海报','整理主题、作品与活动信息'],['家长案例素材','把真实成长过程整理成合规内容']],
 '转介绍':[['阶段成果分享','将成长数据转成可分享的家长版内容'],['家长感谢卡','生成克制而有温度的感谢与回访文案'],['转介绍沟通建议','基于满意度和阶段成果生成建议话术']]
 };return <><PageHeader title="AI助手" desc="围绕美术老师真实工作场景，让每一段时间都被更好地节省下来。" prd={PRD.ai}/><section className="teacher-ai-workspace"><div className="ai-zone-nav">{Object.keys(zones).map(name=><button key={name} className={zone===name?'active':''} onClick={()=>setZone(name)}>{name}</button>)}</div><div className="ai-zone-intro"><div><span>{zone}</span><h2>{zone==='课前工作'?'把准备，留给真正重要的孩子。':zone==='课中支持'?'让观察发生在课堂，而不打断课堂。':zone==='课后反馈'?'把辛苦的整理，交给 AI 完成。':zone==='宣传招生'?'把真实的教育价值，说得更清楚。':'让被看见的成长，自然产生口碑。'}</h2><p>选择一个工具进入，不需要在复杂功能里来回寻找。</p></div><img src={pandaWave} alt="熊猫工作伙伴"/></div><div className="ai-work-cards">{zones[zone].map(([name,desc],i)=><button key={name} onClick={()=>navigate(zone==='课后反馈'?'teacherFlow':'create')}><span>0{i+1}</span><b>{name}</b><p>{desc}</p><ArrowRight/></button>)}</div></section></>}

function LearningRadar(){
 const dimensions=[['视觉空间','86'],['语言表达','82'],['自我管理','71'],['人际互动','76'],['身体协调','74'],['自然感知','79'],['节奏韵律','73'],['逻辑规划','68']];
 return <div className="holistic-radar"><div className="holistic-radar-visual"><svg viewBox="0 0 260 245" role="img" aria-label="八维课堂成长观察雷达图"><g className="holistic-grid"><polygon points="130,16 210,50 244,122 210,194 130,228 50,194 16,122 50,50"/><polygon points="130,48 187,72 211,122 187,172 130,196 73,172 49,122 73,72"/><polygon points="130,80 164,94 178,122 164,150 130,164 96,150 82,122 96,94"/><path d="M130 16V228M16 122H244M50 50L210 194M210 50L50 194"/></g><polygon className="holistic-fill" points="130,33 192,72 177,146 180,160 130,202 69,170 47,122 82,94"/></svg>{dimensions.map(([label,value],i)=><span className={`holistic-label h${i}`} key={label}><b>{label}</b><em>{value}</em></span>)}</div><div className="holistic-radar-copy"><b>八维成长全景</b><p>这不是给孩子排名，而是帮助老师和家长看见：她现在最有力量的地方在哪里，下一步需要怎样支持。</p><div><span><i className="strength"/>优势线索：视觉空间、语言表达</span><span><i className="support"/>支持重点：逻辑规划、自我管理</span></div></div></div>
}

function PersonalGrowthCenterLegacy({role,setToast}){
 const [topic,setTopic]=useState('今日成长');
 const [done,setDone]=useState(false);
 const teacher=role==='teacher';
 const topics=teacher?['今日成长','课堂观察','家长沟通','教育阅读','AI 效率']:['今日成长','亲子陪伴','读懂孩子','亲子阅读','家庭行动'];
 const learning=teacher?{
  '今日成长':{title:'孩子犹豫时，老师可以先给“具体的允许”。',copy:'与其急着教孩子怎么画，不如先告诉她：“你可以先试一小块，画错也没关系。” 这会保护探索的安全感。',action:'今天课堂里，记录一位孩子犹豫后重新投入的瞬间。'},
  '课堂观察':{title:'观察行为，不急着解释孩子。',copy:'把“她不专心”换成“她在 8 分钟后开始看向窗外，老师提醒后回到画面”。具体记录，才是有依据的教育观察。',action:'用“我看见……”写下一条课堂观察。'},
  '家长沟通':{title:'先分享孩子的力量，再讨论需要支持的地方。',copy:'家长更容易接住具体、温和、有证据的反馈。先让家长知道孩子被真正看见，再共同商量下一步。',action:'选择一位孩子，写下一句可分享给家长的具体肯定。'},
  '教育阅读':{title:'读懂发展规律，才不会催促成长。',copy:'同年龄孩子的发展节奏也不同。教育者需要提供合适的环境和支持，而不是用单一标准比较孩子。',action:'阅读 5 分钟：儿童绘画发展中的“符号表达”阶段。'},
  'AI 效率':{title:'把重复整理交给 AI，把注意力留给孩子。',copy:'用 AI 整理素材、生成初稿和沉淀记录；老师仍然负责观察、判断与最后的温度。',action:'尝试用 AI 把一次课堂观察整理成点评初稿。'}
 }:{
  '今日成长':{title:'孩子需要的，常常是一位愿意听她讲完的大人。',copy:'当孩子展示作品时，先说“我想听听你画了什么”，比“真好看”更能让她感到被理解。',action:'今天用 10 分钟，请孩子讲一讲最近的一幅画。'},
  '亲子陪伴':{title:'少一点替孩子完成，多一点陪她自己发现。',copy:'孩子卡住时，可以问：“你想先从哪里开始？” 给选择、给等待，比直接给答案更有力量。',action:'本周一次：遇到孩子求助时，先等待 10 秒再回应。'},
  '读懂孩子':{title:'作品是表达的入口，不是给孩子下结论的依据。',copy:'颜色、构图和主题可以帮助我们开启对话，但不能替代对孩子真实感受的倾听。',action:'围绕作品问一个开放问题：“画里谁最想说话？”'},
  '亲子阅读':{title:'共读不是完成任务，而是共享一段安静的连接。',copy:'每天 10 分钟，允许孩子翻页、停留、提问，甚至只看图。被尊重的阅读体验会慢慢长出兴趣。',action:'今晚共读 10 分钟，让孩子决定从哪一页开始。'},
  '家庭行动':{title:'成长不需要很多大事，只需要稳定的小行动。',copy:'一个被坚持的小习惯，会让孩子在日常中感到确定和被支持。',action:'本周家庭行动：完成一次“作品故事夜”。'}
 };
 const active=learning[topic];
 const recommendations=teacher?[['来自学员档案的推荐','陈一诺的“规划执行”正在建立：试试课堂提问《你准备先画哪里？》'],['本周共学','如何把作品点评从“好不好”变成“看见了什么”'],['成长工具','五分钟课堂观察记录卡']]:[['来自孩子档案的推荐','一诺正在练习“表达叙事”：试试《如何听孩子讲一幅画》'],['本周共学','当孩子说“我不会”时，家长可以怎样回应'],['成长工具','亲子共读 10 分钟行动卡']];
 return <><PageHeader title="个人成长中心" desc={teacher?'让专业持续生长，让陪伴更有力量。':'和孩子一起成长，也把自己慢慢照顾好。'} prd="MVP-个人成长中心"/><section className="growth-center"><div className="growth-center-hero"><div><span>{teacher?'老师成长路径':'家庭成长路径'}</span><h2>{teacher?'今天也把一点时间，留给自己的教育成长。':'当我们愿意学习，孩子也会在被理解中慢慢长大。'}</h2><p>每天只需要五到十分钟，学一点、做一点、记录一点。</p></div><img src={pandaObserve} alt="熊猫成长伙伴"/></div><nav className="growth-topic-nav">{topics.map(item=><button key={item} className={topic===item?'active':''} onClick={()=>{setTopic(item);setDone(false)}}>{item}</button>)}</nav><div className="growth-today"><article><span>今天值得学习的一件事</span><h3>{active.title}</h3><p>{active.copy}</p><button onClick={()=>setToast('已加入我的学习清单')}>收藏这一课 <BookOpen/></button></article><aside><span>本周成长行动</span><b>{active.action}</b><p>{done?'已完成，给自己的坚持点个赞。':'完成后点一下，让成长留下小小的足迹。'}</p><Button icon={done?Check:Sparkles} onClick={()=>setDone(!done)}>{done?'本周行动已完成':'完成本周行动'}</Button></aside></div><div className="growth-recommendations"><div className="recommendation-title"><div><b>为你推荐</b><span>根据{teacher?'学员档案与日常教学':'孩子档案与当前陪伴需要'}整理</span></div><button>查看学习路径 <ArrowRight/></button></div>{recommendations.map(([tag,content],index)=><article key={tag}><span>0{index+1}</span><b>{tag}</b><p>{content}</p><button>开始学习 <ArrowRight/></button></article>)}</div><div className="growth-center-note"><Sparkles/><div><b>成长中心会持续连接你的真实生活。</b><span>后续将逐步加入本地升学政策、主题共学和经过审核的专业内容；政策信息会标明地区、来源与核验日期。</span></div></div></section></>;
}

function GrowthQA({teacher}){
 const [question,setQuestion]=useState(''); const [answer,setAnswer]=useState(null);
 const prompts=teacher?['孩子总说“我不会”，课堂上怎么回应？','怎样把对孩子的观察说给家长听？','孩子今天不愿意画，老师怎么办？']:['孩子总说“我不会”，我该怎么回应？','孩子画画时坐不住，怎么办？','怎样和孩子聊她的作品？'];
 const solve=(value)=>{const q=value||question;if(!q.trim())return;const text=q.includes('不会')?'先接住感受：“你觉得这里有点难，是吗？” 再把任务缩小成一个可尝试的动作：“我们先一起选一个颜色，画一小块。” 让孩子获得一次可完成的经验，再决定下一步。':q.includes('坐不住')?'先看具体情境：是任务太难、等待太久，还是环境干扰？可以把活动拆成 5–8 分钟的小目标，安排一次身体活动，再回到创作。若这种困难跨场景持续影响生活，建议和专业人士进一步沟通。':q.includes('家长')?'用“作品/课堂里我看见了什么 → 这说明孩子正在练习什么 → 家庭可以怎样支持”的顺序沟通。避免给孩子贴标签，也避免把一次课堂表现扩大成结论。':'从作品细节开始，不急着评价。可以问：“你最想让我先看哪里？” “这幅画里发生了什么？” 听完后复述孩子的话，让她知道自己的表达被认真接住。';setQuestion(q);setAnswer(text)};
 return <section className="growth-qa"><div><span>随时问一问</span><h3>{teacher?'你的教育成长搭档，在日常工作里陪你一起想。':'遇到育儿小问题，先来这里一起理一理。'}</h3><p>回答提供教育陪伴思路与可执行做法；如涉及孩子安全、健康、持续情绪困扰或发展疑虑，会建议寻求相应专业支持。</p></div><div className="qa-input"><input value={question} onChange={e=>setQuestion(e.target.value)} placeholder={teacher?'例如：孩子不愿意动笔，怎么开始陪她？':'例如：孩子不愿意分享作品，我该怎么聊？'}/><Button icon={Sparkles} onClick={()=>solve()}>问一问</Button></div><div className="qa-prompts">{prompts.map(item=><button key={item} onClick={()=>solve(item)}>{item}</button>)}</div>{answer?<div className="qa-answer"><b>给你的建议</b><p>{answer}</p><span>你可以继续追问，或把这个方法加入本周行动。</span></div>:null}</section>
}

function PersonalGrowthCenterV1({role,setToast}){
 const [topic,setTopic]=useState('今日成长'); const [done,setDone]=useState(false); const teacher=role==='teacher';
 const content=teacher?[
  ['课堂观察','用事实记录孩子，而不是用标签定义孩子。','把“她不专心”改成“她在 8 分钟后看向窗外，提醒后回到作品”。'],
  ['家长沟通','先让家长看见孩子的力量，再讨论需要支持的地方。','把一次课堂的具体细节，转成家长今天就能做的一句话。'],
  ['教育阅读','尊重发展节奏，比急着纠正更重要。','理解儿童绘画从符号表达走向画面组织的自然过程。']
 ]:[
  ['亲子陪伴','孩子需要的，常常是一位愿意听她讲完的大人。','先问“你最想让我看哪里？” 再听孩子讲她的作品。'],
  ['读懂孩子','作品是表达的入口，不是给孩子下结论的依据。','从颜色、故事和细节开启对话，不急着解释孩子。'],
  ['亲子阅读','共读是一段连接，不是一项任务。','每天十分钟，让孩子决定从哪一页开始。']
 ];
 const resources=teacher?[
  ['UNICEF · 学习中的玩耍','关于游戏如何支持儿童探索、创造和发展。','文章 / 视频','https://www.unicef.org/parenting/playbox'],
  ['Reading Rockets · 与孩子一起阅读','把阅读变成对话，为课堂语言表达积累素材。','文章 / 视频','https://www.readingrockets.org/literacy-home/reading-your-child'],
  ['HealthyChildren · 家庭沟通','理解孩子如何从大人的沟通方式中学习表达。','文章','https://www.healthychildren.org/English/family-life/family-dynamics/communication-discipline/Pages/Components-of-Good-Communication.aspx']
 ]:[
  ['UNICEF · 让游戏成为学习','用日常游戏支持孩子的探索、创造与情绪发展。','文章 / 视频','https://www.unicef.org/parenting/playbox'],
  ['Reading Rockets · 与孩子共读','把朗读变成故事、图画和感受的对话。','文章 / 视频','https://www.readingrockets.org/literacy-home/reading-your-child'],
  ['HealthyChildren · 从家开始学沟通','大人的倾听和表达，会成为孩子学习沟通的样子。','文章','https://www.healthychildren.org/English/family-life/family-dynamics/communication-discipline/Pages/Components-of-Good-Communication.aspx']
 ];
 const active=content.find(([name])=>name===topic)||content[0];
 return <><PageHeader title="个人成长中心" desc={teacher?'有依据地学习，更有力量地陪伴孩子。':'在陪伴孩子长大的路上，也照顾自己的成长。'} prd="MVP-个人成长中心"/><section className="growth-center"><div className="growth-center-hero"><div><span>{teacher?'老师成长路径':'家庭成长路径'}</span><h2>{teacher?'今天也把一点时间，留给自己的教育成长。':'当我们愿意学习，孩子会在被理解中慢慢长大。'}</h2><p>可信内容、日常问题与可执行行动，都在这里。</p></div><img src={pandaObserve} alt="熊猫成长伙伴"/></div><nav className="growth-topic-nav">{['今日成长',...content.map(([name])=>name)].map(item=><button key={item} className={topic===item?'active':''} onClick={()=>{setTopic(item);setDone(false)}}>{item}</button>)}</nav><div className="growth-today"><article><span>今天值得学习的一件事</span><h3>{active[1]}</h3><p>{active[2]}</p><button onClick={()=>setToast('已加入我的学习清单')}>收藏这一课 <BookOpen/></button></article><aside><span>本周成长行动</span><b>{teacher?'记录一位孩子本周的一个“重新投入”瞬间。':'完成一次 10 分钟的作品故事对话。'}</b><p>{done?'已完成。微小而稳定的行动，会慢慢改变陪伴的质量。':'完成后点一下，让成长留下小小的足迹。'}</p><Button icon={done?Check:Sparkles} onClick={()=>setDone(!done)}>{done?'本周行动已完成':'完成本周行动'}</Button></aside></div><section className="trusted-library"><div className="library-head"><div><b>精选内容</b><span>优先推荐权威儿童发展、教育与阅读机构的公开内容</span></div><button>浏览全部主题 <ArrowRight/></button></div><div>{resources.map(([title,desc,type,url],index)=><a href={url} key={title} target="_blank" rel="noreferrer"><span>0{index+1}</span><b>{title}</b><p>{desc}</p><small>{type} · 外部可信来源</small><ArrowRight/></a>)}</div></section><GrowthQA teacher={teacher}/><div className="growth-center-note"><Sparkles/><div><b>我们只推荐能说明来源的内容。</b><span>升学政策将按地区、学段、发布来源与核验日期呈现；涉及医疗、心理或安全风险的问题，会优先提示专业支持渠道。</span></div></div></section></>;
}

function AdmissionsNavigator(){
 const [city,setCity]=useState('全国政策框架'); const [stage,setStage]=useState('幼升小'); const [channel,setChannel]=useState('全部');
 const stages=['进幼儿园','幼升小','小升初','中考','高考'];
 const data={
  '进幼儿园':['重点查看年龄要求、报名材料、招生范围与园所办园资质。','当地教育局 / 区县教育行政部门、园所官方通知'],
  '幼升小':['重点查看义务教育招生时间、材料、学区/片区与各地实施细则。','市/区教育局官网、学校官方招生通知'],
  '小升初':['重点查看本地义务教育入学政策、报名流程、材料与时间节点。','市/区教育局官网、学校官方招生通知'],
  '中考':['重点查看本地中考报名、指标/名额分配、志愿与高中招生政策。','市教育局 / 教育考试院、学校官方通知'],
  '高考':['重点查看本省考试招生、选科要求、招生章程与阳光高考信息。','省教育考试院、阳光高考、高校官方招生网']
 };
 const routes=[['普通升学','入园、义务教育、中高考的基本流程与核验清单。'],['艺体发展','关注孩子长期兴趣与能力积累；具体招生资格、专业测试与录取规则必须以当年省市和学校官方通知为准。'],['竞赛活动','只查看主管部门公布或认可的活动；不把竞赛当作升学承诺。'],['多元通道','包括综合素质、特色项目、职业教育等信息，按当地政策与孩子实际情况了解。']];
 const visible=channel==='全部'?routes:routes.filter(([name])=>name===channel);
 return <section className="admissions-navigator"><div className="admissions-head"><div><span>升学信息导航</span><h3>先建立清晰框架，再查证当地最新信息。</h3><p>政策因地区、年份、学段和学校而异；这里帮家长找到该从哪里开始查、该问什么、该如何核验。</p></div><div className="policy-status"><b>信息使用提醒</b><span>最后核验：以当地教育行政部门当年公开通知为准</span></div></div><div className="admissions-filters"><label>所在地区<select value={city} onChange={e=>setCity(e.target.value)}><option>全国政策框架</option><option>北京市</option><option>上海市</option><option>广州市</option><option>深圳市</option><option>自定义地区（即将支持）</option></select></label><div>{stages.map(item=><button key={item} className={stage===item?'active':''} onClick={()=>setStage(item)}>{item}</button>)}</div></div><div className="stage-policy-card"><div><span>{city} · {stage}</span><h4>{data[stage][0]}</h4><p><b>优先核验：</b>{data[stage][1]}</p></div><button>查看本阶段清单 <ArrowRight/></button></div><div className="route-filter">{['全部',...routes.map(([name])=>name)].map(item=><button key={item} className={channel===item?'active':''} onClick={()=>setChannel(item)}>{item}</button>)}</div><div className="admissions-route-grid">{visible.map(([name,desc],index)=><article key={name}><span>0{index+1}</span><b>{name}</b><p>{desc}</p><button>了解这一通道 <ArrowRight/></button></article>)}</div><div className="official-policy-links"><b>权威政策入口</b><a href="https://www.moe.gov.cn/jyb_xxgk/xxgk/neirong/fenlei/sxml_jcjy/jcjy_ywjy/ywjy_rxzc/" target="_blank" rel="noreferrer">义务教育招生入学政策文件 <ArrowRight/></a><a href="https://www.moe.gov.cn/jyb_xxgk/xxgk/neirong/fenlei/sxml_gdjy/gdjy_gxzs/gxzs_zszcwj/" target="_blank" rel="noreferrer">高校招生政策文件 <ArrowRight/></a><a href="https://www.moe.gov.cn/srcsite/A29/202203/t20220314_607247.html" target="_blank" rel="noreferrer">全国性竞赛活动管理办法 <ArrowRight/></a></div></section>
}

function PersonalGrowthCenter({role,setToast}){
 const [view,setView]=useState('成长学习'); const teacher=role==='teacher';
 const resources=teacher?[['UNICEF · 学习中的玩耍','游戏如何支持儿童探索、创造与发展。','https://www.unicef.org/parenting/playbox'],['Reading Rockets · 与孩子一起阅读','把阅读变成对话，为课堂表达积累素材。','https://www.readingrockets.org/literacy-home/reading-your-child']]:[['UNICEF · 让游戏成为学习','用日常游戏支持探索、创造与情绪发展。','https://www.unicef.org/parenting/playbox'],['Reading Rockets · 与孩子共读','把朗读变成故事、图画和感受的对话。','https://www.readingrockets.org/literacy-home/reading-your-child']];
 return <><PageHeader title="个人成长中心" desc={teacher?'有依据地学习，更有力量地陪伴孩子。':'在陪伴孩子长大的路上，也照顾自己的成长。'} prd="MVP-个人成长中心"/><section className="growth-center"><div className="growth-center-hero"><div><span>{teacher?'老师成长路径':'家庭成长路径'}</span><h2>{teacher?'今天也把一点时间，留给自己的教育成长。':'当我们愿意学习，孩子会在被理解中慢慢长大。'}</h2><p>可信内容、日常问题与可执行行动，都在这里。</p></div><img src={pandaObserve} alt="熊猫成长伙伴"/></div><nav className="growth-topic-nav"><button className={view==='成长学习'?'active':''} onClick={()=>setView('成长学习')}>成长学习</button><button className={view==='升学信息'?'active':''} onClick={()=>setView('升学信息')}>升学信息导航</button></nav>{view==='升学信息'?<AdmissionsNavigator/>:<><div className="growth-today"><article><span>今天值得学习的一件事</span><h3>{teacher?'观察行为，不急着解释孩子。':'先听孩子把故事讲完，再说你的感受。'}</h3><p>{teacher?'用“我看见……”记录具体情境，再与家长沟通孩子正在练习什么。':'当孩子展示作品时，先问“你最想让我看哪里？” 让她知道自己的表达被认真接住。'}</p><button onClick={()=>setToast('已加入我的学习清单')}>收藏这一课 <BookOpen/></button></article><aside><span>本周成长行动</span><b>{teacher?'记录一位孩子重新投入创作的瞬间。':'完成一次 10 分钟的作品故事对话。'}</b><p>完成后点一下，让成长留下小小的足迹。</p><Button icon={Sparkles} onClick={()=>setToast('本周成长行动已完成')}>完成本周行动</Button></aside></div><section className="trusted-library"><div className="library-head"><div><b>精选内容</b><span>优先推荐权威儿童发展、教育与阅读机构的公开内容</span></div></div><div>{resources.map(([title,desc,url],index)=><a href={url} key={title} target="_blank" rel="noreferrer"><span>0{index+1}</span><b>{title}</b><p>{desc}</p><small>文章 / 视频 · 外部可信来源</small><ArrowRight/></a>)}</div></section><GrowthQA teacher={teacher}/></>}<div className="growth-center-note"><Sparkles/><div><b>我们只推荐能说明来源的内容。</b><span>涉及升学、竞赛和特色招生时，优先呈现官方来源与核验路径；涉及安全、健康或持续发展疑虑时，建议联系相应专业支持。</span></div></div></section></>;
}

// —— 老师人设 / 技能库 / 大模型记忆 与 装裱设置 ——

function PersonaPicker({profiles=[],activeProfileId,setActiveProfileId}){
  return <label className="persona-picker">由哪位老师的人设点评
    <select value={activeProfileId||''} onChange={event=>setActiveProfileId(event.target.value)}>
      {profiles.length?profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name}{profile.roleLabel?` · ${profile.roleLabel}`:''}</option>):<option value="">默认人设</option>}
    </select>
    <small>人设、技能库与大模型记忆会一起加载进提示词。</small>
  </label>;
}

/**
 * 课后反馈步骤条。
 * 不用圆形序号表示选中：每一环节是一段进度条，
 *  - 当前环节：整段金色高亮；
 *  - 已完成环节：段内压深并换上对勾；
 *  - 未到达环节：整段置灰。
 * flags 是各环节的「真的做完了吗」，只有已走过的环节才会显示完成态。
 */
function FlowStepper({steps=[],step=1,flags=[],onGo}){
  const total=steps.length;
  return <nav className="flow-stepper" aria-label={`课后反馈共 ${total} 步，当前第 ${step} 步`}>
    {steps.map(([name,desc],index)=>{
      const stage=index+1;
      const active=step===stage;
      const done=stage<step&&Boolean(flags[index]);
      const state=active?'active':done?'done':'todo';
      return <button key={name} type="button" className={`flow-stepper-step ${state}`}
        aria-current={active?'step':undefined}
        aria-label={`第 ${stage} 步 ${name}：${desc}${done?'（已完成）':active?'（当前进行）':'（未开始）'}`}
        onClick={()=>onGo?.(stage)}>
        <span className="flow-stepper-title">
          <em aria-hidden="true">{done?<Check size={12}/>:stage}</em>
          <b>{name}</b>
        </span>
        <small>{desc}</small>
        <span className="flow-stepper-track" aria-hidden="true"><i/></span>
      </button>;
    })}
  </nav>;
}

/**
 * 点评模型选择器（[第三步 US-107a] / F-REVIEW-MODEL-01；生成中换模型见 US-107b）。
 *
 * 选项行、不可选原因、池路由那一行与「本次用哪个模型」的结论全部来自
 * `reviewModelPlan`（`reviewModelResolve()` 的产物）—— 组件不自己过滤、不自己排序、
 * 不自己拼「为什么用不了」的文案（那些都在 `data/reviewModels.js` 里写一次）。
 *
 * 四件事在这里只做呈现：
 *  1. 每行显示 名称 / 供应商 / 版本 / 能力标签 / 单价 / 近期 P95 耗时 / 健康状态；
 *  2. 不可用（健康检查失败 / 未授权 / 额度不足）的行**置灰且不可点**，并写明原因；
 *  3. 「由模型池自动路由」是列表里的第一行，池里没有可用模型时同样置灰；
 *  4. **生成中也能换模型**（US-107b）：行保持可点，点了出二次确认条
 *     （文案来自 `reviewModelSwitchConfirmText`，含验收原话「将重新生成，当前正文会被替换」），
 *     确认前选择不变、当前生成继续跑。
 *
 * 只读探针：`data-review-model-option` / `-selectable` / `-reason` / `-health` / `-price` /
 * `-p95` / `-provider` / `-version` / `-caps`（行内读数）+ `data-review-model-selected`、
 * `data-review-model-resolved`（本次实际会用的 id）与 `data-review-model-source`（来源标注）+
 * `data-review-model-running`（生成中标记）与确认条 `data-review-model-switch`（待切换到的 id）/
 * `-target`（切换文案）/ `-confirm` / `-cancel`。
 */
function ReviewModelPicker({plan,choice,onChoose,running=false,switchConfirm=null,onConfirmSwitch,onCancelSwitch}){
  const rows=[...(plan.poolRow?[plan.poolRow]:[]),...(plan.options?.rows||[])];
  // 选中态读 `plan.choice`（本次**实际**会用的那个）：老师上次选的模型已失效时，
  // 高亮应当落在回落后的池路由上，而不是落在那条置灰的行上（原因由下面的回落提示条说明）。
  const selected=plan.choice||choice||REVIEW_MODEL_POOL_ROUTE_ID;
  return <section className="review-model-picker" data-review-model-picker="true" data-review-model-resolved={plan.modelId||''} data-review-model-source={plan.source||''} data-review-model-choice={selected} data-review-model-running={running?'true':'false'}>
    <div className="review-model-head">
      <b>点评视觉模型</b>
      <small data-review-model-summary="true">{plan.options?.summaryText||''}</small>
    </div>
    <p className="review-model-note">{plan.options?.note||''}</p>
    {/* 生成中换模型的二次确认条（US-107b）：确认前一个选择都不改，当前正文继续生成。 */}
    {switchConfirm?<div className="review-model-switch" data-review-model-switch={switchConfirm.value||REVIEW_MODEL_POOL_ROUTE_ID} data-review-model-switch-name={switchConfirm.targetName||''}>
      <CircleAlert size={14}/>
      <div>
        <b data-review-model-switch-text="true">{switchConfirm.message}</b>
        <small>确认会立刻停掉当前这一次生成并重新开始；已经收到的正文会被新的这一次替换。</small>
      </div>
      <span className="review-model-switch-actions">
        <button type="button" data-review-model-switch-confirm="true" onClick={onConfirmSwitch}>{REVIEW_MODEL_SWITCH_CONFIRM_ACTION}</button>
        <button type="button" className="muted" data-review-model-switch-cancel="true" onClick={onCancelSwitch}>{REVIEW_MODEL_SWITCH_CANCEL_ACTION}</button>
      </span>
    </div>:null}
    <div className="review-model-list" role="radiogroup" aria-label="点评视觉模型">
      {rows.map(row=><button key={row.id} type="button" role="radio" aria-checked={selected===row.id} disabled={!row.selectable}
        className={`review-model-option${selected===row.id?' is-selected':''}${row.selectable?'':' is-disabled'}`}
        data-review-model-option={row.id} data-review-model-selectable={row.selectable?'true':'false'}
        data-review-model-reason={row.reasonKey} data-review-model-health={row.health||''}
        data-review-model-price={row.priceText||''} data-review-model-p95={row.p95Text||''}
        data-review-model-provider={row.provider||''} data-review-model-version={row.version||''}
        data-review-model-caps={row.capabilityText||''}
        onClick={()=>{if(!row.selectable)return;onChoose?.(row.id)}}>
        <span className="review-model-radio" aria-hidden="true">{selected===row.id?'●':'○'}</span>
        <span className="review-model-body">
          <span className="review-model-title"><b>{row.name}</b><em>{row.vendorText||''}</em></span>
          <span className="review-model-meta">
            {row.capabilityText?<i>{row.capabilityText}</i>:null}
            {row.priceText?<i>{row.priceText}</i>:null}
            <i>P95 {row.p95Text}{row.p95Samples?`（${row.p95Samples} 次）`:''}</i>
            <i className={`review-model-health ${row.health==='ok'?'ok':'bad'}`}>{row.healthLabel}</i>
          </span>
          {row.selectable?null:<span className="review-model-reason" data-review-model-reason-text="true">不可用：{row.reasonText}{row.reasonKey==='health-failed'&&row.healthNote?`（${row.healthNote}）`:''}</span>}
        </span>
      </button>)}
    </div>
    {(plan.options?.excluded||[]).length?<p className="review-model-excluded" data-review-model-excluded="true">
      另有 {plan.options.excluded.length} 个模型未列出：{plan.options.excluded.map(item=>`${item.name}（${item.reasonText}）`).join('、')}
    </p>:null}
    {running?<p className="review-model-switch-hint" data-review-model-switch-hint="true">{REVIEW_MODEL_RUNNING_NOTE}</p>:null}
    <p className="review-model-plan" data-review-model-plan={plan.source||''}><Sparkles size={13}/><span>{plan.note||REVIEW_MODEL_EMPTY_TEXT}</span></p>
    {plan.fallbackFrom?<p className="review-model-fallback" data-review-model-fallback={plan.fallbackFrom}>上次选用的模型已不可用，本次按模型池自动路由。保存后可在「本次点评详情」的模型分区看到来源标注 {plan.source}。</p>:null}
  </section>;
}

function ReviewLaunchPanel({profiles=[],skillLibrary=[],activeProfileId,setActiveProfileId,onStart,hasArtwork,draftReady,keywordCount,running=false,modelPlan=null,modelChoice='',onChooseModel,switchConfirm=null,onConfirmSwitch,onCancelSwitch}){
  const active=profiles.find(profile=>profile.id===activeProfileId)||profiles[0]||null;
  const skills=resolveSkills(active?.skillKeys,skillLibrary,active?.skills);
  const modelName=modelPlan?.row?.name||modelPlan?.modelId||'—';
  return <section className="review-launch">
    <div className="review-launch-head">
      <span>五维点评 · 云端视觉模型</span>
      <h3>让大模型带着老师的人设，先读懂这幅画。</h3>
      <p>一次生成会同时完成两件事：识别画面内容并自动勾选作品观察词，再按五个维度写下评语。人设、{skills.length} 项技能与长期记忆一起加载，单次约 20 秒，可随时停止。</p>
    </div>
    <PersonaPicker profiles={profiles} activeProfileId={activeProfileId} setActiveProfileId={setActiveProfileId} disabled={running}/>
    {modelPlan?<ReviewModelPicker plan={modelPlan} choice={modelChoice} onChoose={onChooseModel} running={running} switchConfirm={switchConfirm} onConfirmSwitch={onConfirmSwitch} onCancelSwitch={onCancelSwitch}/>:null}
    {active?<div className="persona-loaded">
      <div><b>已加载人设</b><span>{[active.name,active.roleLabel,active.campus].filter(Boolean).join(' · ')}</span></div>
      <div><b>长期记忆</b><span>{active.memory?`${active.memory.slice(0,46)}${active.memory.length>46?'…':''}`:'未填写'}</span></div>
      <div className="persona-skill-tags">{skills.length?skills.map(skill=><em key={skill.name}>{skill.name}</em>):<span>未启用技能</span>}</div>
    </div>:null}
    <div className="review-launch-actions">
      <Button icon={WandSparkles} onClick={onStart} disabled={!hasArtwork||running}>{hasArtwork?(running?'正在生成…':draftReady?'重新生成点评':'开始生成点评'):'请先上传作品'}</Button>
      <small data-review-model-selected="true">模型：{modelName}{modelPlan?.sourceLabel?`（${modelPlan.sourceLabel}）`:''}{keywordCount?` · 已识别 ${keywordCount} 个观察词`:''}</small>
    </div>
  </section>;
}

/**
 * 本次点评详情面板（[第三步 US-103a] 折叠态 / [US-103b] 六分区与导出 / F-REVIEW-TRACE-02）。
 *
 * 四条硬约定：
 *  1. **默认折叠**：初始只占一行摘要（加载了什么 · 用了哪个模型 · 花了多久 / 生成中给实时读数），
 *     点摘要行才展开 —— 老师平时不看这些细节，需要时一次点击就能看到全部。
 *  2. **折叠不丢内容、不重新请求**：推理增量一直住在 `reviewStream` 里，折叠只是把正文 DOM 整个不渲染；
 *     展开不触发任何模型调用（`data-detail-requests` 就是这条判据的读数）。
 *  3. **展开后逐字流式追加**：`<pre data-detail-reasoning>` 直接渲染推理增量，
 *     模型每来一段增量就长一段，不做打字机缓冲（缓冲会吞掉/滞后内容）。
 *  4. **六个分区只读一份载荷**（`reviewDetailPayload`）：推理过程 / 加载清单 / 提示词 / 模型与参数 /
 *     用量与耗时 / 输出原文；「复制全部」与「导出 JSON / Markdown」渲染的是同一份载荷，
 *     所以界面上看到的与导出文件里写的永远一致（素材正文与图片 base64 都进不来）。
 *  5. **两次对比是六个分区之外的一块**（[US-107b]）：`parentTraceId` 关联的上一次 vs 本次的
 *     模型 / 耗时 / 推理（`data/reviewTraceCompare.js` 的产物），只在确有上一次时渲染 ——
 *     它不进 `payload.sections`，所以六个分区与「复制全部 / 导出」的口径一字不变。
 */
function ReviewDetailPanel({stream,loaded,prompt,trace,compare=null,model,modelSource='',params,requests,student,lessonDate,open,onToggle,onStart,onStop,promptAllowed=true}){
  const running=stream.phase===REVIEW_DETAIL_PHASES.running;
  const phase=stream.phase;
  // 轨迹收束后以它为准（真正发出去的提示词、模型返回的用量与输出原文都在里面）；
  // 生成中只读流式增量。两处都不改变「加载清单」的来源（它来自生成开始时的那一次拼装）。
  const reasoning=typeof trace?.reasoning==='string'&&trace.reasoning?trace.reasoning:stream.reasoning;
  const output=typeof trace?.output?.raw==='string'&&trace.output.raw?trace.output.raw:stream.content;
  const promptSource=trace?.prompts?.system
    ?{system:trace.prompts.system,user:trace.prompts.user,attachments:trace.prompts.attachments,modules:trace.loaded?.modules||prompt?.modules||[]}
    :(prompt||{});
  // 「复制全部 / 导出」回执与导出时间戳：都按**一次生成**冻结 —— 同一次生成的「复制全部」与
  // 「导出 Markdown」必须是逐字符相同的一份文本（导出的 JSON 里的时间也指着同一份快照）。
  // 声明必须排在 `reviewDetailPayload` 之前：载荷要读 `exportedAtRef.current`。
  const exportedAtRef=useRef(new Date().toISOString());
  const [receipt,setReceipt]=useState({copy:'',chars:0,export:''});
  useEffect(()=>{exportedAtRef.current=new Date().toISOString();setReceipt({copy:'',chars:0,export:''})},[requests]);
  const payload=reviewDetailPayload({
    phase,
    student,
    lessonDate,
    model,
    // 模型来源（US-107a）：`pool-route` / `teacher-pick`；面板的「模型与参数」分区与两种导出都读它。
    modelSource,
    params,
    requests,
    message:stream.message,
    loaded,
    prompt:promptSource,
    reasoning,
    output,
    usage:trace?.usage||null,
    timing:trace?.timing||null,
    traceId:trace?.traceId||'',
    taskLabel:trace?.taskLabel||'',
    exportedAt:exportedAtRef.current
  });
  // 平台开关「允许老师查看提示词正文」（US-112 第 5 条）：关闭时**只显示清单** ——
  // 遮罩落在载荷上，所以「复制全部 / 导出 JSON / 导出 Markdown」与界面上看到的是同一份口径。
  const shownPayload=reviewPromptDisclosureMask(payload,{allowed:promptAllowed});
  const sectionOf=key=>shownPayload.sections.find(item=>item.key===key)||{};
  const loadedSection=sectionOf('loaded');
  // 两次对比（US-107b）：`compare` 是本次轨迹 `parentTraceId` 指到的那条**收束**轨迹；
  // 本次还没收束就用 `stream` 的流式读数当对照侧（耗时与推理字数照样实时可比）。
  // 结果为空 = 还没有可对比的上一次 → 这一块整体不渲染（空表不如不出现）。
  const compareView=reviewTraceCompare({parent:compare,current:trace,live:stream,model,modelSource});  const promptSection=sectionOf('prompt');
  const modelSection=sectionOf('model');
  const usageSection=sectionOf('usage');
  const outputSection=sectionOf('output');
  const summary=reviewDetailSummary({loaded,model,modelSource,phase,elapsedMs:stream.elapsedMs,reasoningChars:reasoning.length,content:output,message:stream.message});
  const progress=reviewContentProgress(output);
  const liveText=readableFromRawJson(output);
  const copyAll=async()=>{
    const result=buildReviewDetailExport(shownPayload,{format:'markdown',student,lessonDate});
    const ok=await copyReviewDetailText(result.text);
    setReceipt(current=>({...current,copy:ok?'copied':'failed',chars:result.text.length}));
  };
  const exportDetail=format=>{
    const result=buildReviewDetailExport(shownPayload,{format,student,lessonDate});
    const filename=downloadReviewDetailExport(result);
    setReceipt(current=>({...current,export:filename||result.filename}));
  };
  const copyText=receipt.copy==='copied'?`已复制全部内容（${receipt.chars} 字）`
    :receipt.copy==='failed'?'复制失败，请手动选择文本复制'
      :'复制与导出只含提示词、推理、输出与素材引用，不含图片正文';
  return <section className="review-detail" data-review-detail="true" data-review-detail-surface={REVIEW_DETAIL_SURFACES.teacherFlow} data-detail-open={open?'true':'false'} data-detail-phase={phase} data-detail-requests={requests} data-detail-sections={shownPayload.sections.length}>
    <div className="review-detail-head">
      <button type="button" className="review-detail-toggle" aria-expanded={open} data-detail-toggle="true" onClick={onToggle}>
        <ChevronDown size={16}/>
        <b data-detail-phase-label="true">{reviewDetailPhaseLabel(phase)}</b>
        <span data-detail-summary="true">{summary}</span>
        <em>{reviewDetailToggleLabel(open)}</em>
      </button>
      <div className="review-detail-actions">
        {running?<button type="button" data-detail-action="stop" onClick={onStop}>停止生成</button>
          :<button type="button" data-detail-action="start" onClick={onStart}>重新生成</button>}
      </div>
    </div>
    {open?<div className="review-detail-body" data-detail-body="true">
      {phase===REVIEW_DETAIL_PHASES.error?<div className="review-detail-error" data-detail-error="true"><CircleAlert size={15}/><span>{stream.message||'生成失败'}</span></div>:null}
      <div className="review-detail-tools" data-detail-tools="true">
        <button type="button" data-detail-action="copy-all" onClick={copyAll}>复制全部</button>
        <button type="button" data-detail-action="export-json" onClick={()=>exportDetail('json')}>导出 {reviewDetailExportFormat('json').label}</button>
        <button type="button" data-detail-action="export-markdown" onClick={()=>exportDetail('markdown')}>导出 {reviewDetailExportFormat('markdown').label}</button>
        <small data-detail-copy-state={receipt.copy||'idle'}>{copyText}</small>
        {receipt.export?<small data-detail-export-state="done">已导出 {receipt.export}</small>:null}
      </div>

      <section className="review-detail-section" data-detail-section="reasoning">
        <div className="review-detail-block-head">
          <b>{sectionOf('reasoning').title||'推理过程'}</b>
          <small>已收到 {reasoning.length} 字{running?' · 逐字追加中':' · 生成已结束'}</small>
        </div>
        <pre data-detail-reasoning="true" data-detail-reasoning-chars={reasoning.length}>{reasoning||reviewDetailReasoningPlaceholder(phase)}</pre>
        <div className="review-detail-live" data-detail-live="true" data-detail-done={progress.done} data-detail-total={progress.total} data-detail-chars={progress.chars} data-detail-ratio={progress.ratio.toFixed(3)}>
          <div className="review-detail-block-head">
            <b>正文进度</b>
            <small>{progress.done}/{progress.total} 维 · {progress.chars} 字</small>
          </div>
          <div className="review-detail-bar"><i style={{width:`${Math.round(progress.ratio*100)}%`}}/></div>
          <p>{liveText||(running?'模型正在写作，正文会在这里逐字出现…':'本次没有可展示的正文增量。')}</p>
        </div>
      </section>

      <section className="review-detail-section" data-detail-section="loaded">
        <div className="review-detail-block-head">
          <b>{loadedSection.title||'加载清单'}</b>
          <small>{loadedSection.included||0}/{loadedSection.total||0} 项已加载</small>
        </div>
        <ul className="review-detail-loaded" data-detail-loaded="true">
          {(loadedSection.rows||[]).map(row=><li key={row.key} data-detail-loaded-item={row.key} data-detail-loaded-included={row.included?'true':'false'} className={row.included?'':'is-off'}>
            <b>{row.label}</b>{row.detail?<span>{row.detail}</span>:null}{row.included?null:<em>{row.reason}</em>}
          </li>)}
        </ul>
        {(loadedSection.skills||[]).length?<div className="review-detail-skills" data-detail-skills="true" data-detail-skills-included={loadedSection.skillsIncluded||0} data-detail-skills-total={loadedSection.skillsTotal||0} data-detail-skills-empty={loadedSection.skillsEmpty?'true':'false'}>
          <div className="review-detail-block-head">
            <b>技能清单</b>
            <small>{loadedSection.skillsIncluded||0}/{loadedSection.skillsTotal||0} 项已加载 · 点开单项可看进入提示词的原文片段</small>
          </div>
          {loadedSection.skillsNote?<p className="review-detail-skills-empty" data-detail-skills-note="true">{loadedSection.skillsNote}</p>:null}
          <ul>
            {(loadedSection.skills||[]).map(row=><li key={row.id||row.name} className={row.included?'':'is-off'} data-detail-skill={row.id||row.name} data-detail-skill-included={row.included?'true':'false'} data-detail-skill-reason={row.reasonKey} data-detail-skill-category={row.category} data-detail-skill-source={row.sourceLabel} data-detail-skill-chars={row.chars}>
              <details>
                <summary>
                  <b>{row.name}</b>
                  <span data-detail-skill-detail="true">{row.detail}</span>
                  <em data-detail-skill-state="true">{row.included?'[已加载]':`[未加载] ${row.reason}`}</em>
                </summary>
                <div className="review-detail-skill-body">
                  <small>{row.included?'该技能进入提示词的原文片段（与 system 提示词里的【已启用技能】段落逐字符一致）：':'该技能未进入本次提示词；下面是它若启用会写入的原文片段：'}</small>
                  <pre data-detail-skill-excerpt="true">{row.excerpt}</pre>
                </div>
              </details>
            </li>)}
          </ul>
        </div>:null}
        {(loadedSection.agentFiles||[]).length?<div className="review-detail-agentfiles" data-detail-agentfiles="true" data-detail-agentfiles-included={loadedSection.agentFilesIncluded||0} data-detail-agentfiles-total={loadedSection.agentFilesTotal||0} data-detail-agentfiles-limit={loadedSection.agentFilesSummary?.limit||0} data-detail-agentfiles-per-level={loadedSection.agentFilesSummary?.perLevel||0} data-detail-agentfiles-chars={loadedSection.agentFilesSummary?.chars||0} data-detail-agentfiles-truncated={loadedSection.agentFilesSummary?.truncated?'true':'false'} data-detail-agentfiles-truncated-at={loadedSection.agentFilesSummary?.truncatedAt||0} data-detail-agentfiles-loadout-hash={loadedSection.agentFilesSummary?.loadoutHash||''}>
          <div className="review-detail-block-head">
            <b>agent.md 与记忆文件</b>
            <small>{loadedSection.agentFilesIncluded||0}/{loadedSection.agentFilesTotal||0} 个已加载 · 点开单项可看进入提示词的正文（变量已替换）</small>
          </div>
          {loadedSection.agentFilesNote?<p className="review-detail-agentfiles-note" data-detail-agentfiles-note="true">{loadedSection.agentFilesNote}</p>:null}
          <ul>
            {(loadedSection.agentFiles||[]).map(row=><li key={row.fileId||row.name} className={row.included?'':'is-off'} data-detail-agentfile={row.fileId||row.name} data-detail-agentfile-included={row.included?'true':'false'} data-detail-agentfile-reason={row.reasonKey} data-detail-agentfile-scope={row.scope} data-detail-agentfile-version={row.version} data-detail-agentfile-chars={row.chars} data-detail-agentfile-included-chars={row.includedChars} data-detail-agentfile-hash={row.hash} data-detail-agentfile-truncated={row.truncated?'true':'false'} data-detail-agentfile-truncated-at={row.truncatedAt}>
              <details>
                <summary>
                  <b>{row.name}</b>
                  <span data-detail-agentfile-detail="true">{row.detail}</span>
                  <em data-detail-agentfile-state="true">{row.stateText}</em>
                </summary>
                <div className="review-detail-agentfile-body">
                  <small data-detail-agentfile-body="true">{row.bodyNote}</small>
                  {row.included&&row.body?<pre data-detail-agentfile-text="true">{row.body}</pre>:null}
                </div>
              </details>
            </li>)}
          </ul>
        </div>:null}
        {(loadedSection.modules||[]).length?<details className="review-detail-modules" data-detail-modules="true">
          <summary>提示词模块（{loadedSection.modulesIncluded}/{loadedSection.modulesTotal} 项）</summary>
          <ul>
            {(loadedSection.modules||[]).map(row=><li key={row.id} data-detail-module={row.id} data-detail-module-included={row.included?'true':'false'} className={row.included?'':'is-off'}>
              <b>{row.title}</b><span>{[row.version,`${row.chars} 字`].filter(Boolean).join(' · ')}</span>{row.included?null:<em>未进入本次提示词</em>}
            </li>)}
          </ul>
        </details>:null}
      </section>

      <section className="review-detail-section" data-detail-section="prompt" data-detail-prompt-restricted={promptSection.restricted?'true':'false'}>
        <div className="review-detail-block-head">
          <b>{promptSection.title||'提示词'}</b>
          <small>system {promptSection.systemChars||0} 字 · user {promptSection.userChars||0} 字 · 附件 {(promptSection.attachments||[]).length} 个</small>
        </div>
        <div className="review-detail-prompt">
          {promptSection.restricted?<p className="review-detail-prompt-restricted" data-detail-prompt-note="true"><ShieldAlert size={14}/><span>{promptSection.restrictionNote}</span></p>:<>
            <b>system</b>
            <pre data-detail-prompt-system="true" data-detail-prompt-system-chars={promptSection.systemChars||0}>{promptSection.system||'（本次没有 system 提示词）'}</pre>
            <b>user</b>
            <pre data-detail-prompt-user="true" data-detail-prompt-user-chars={promptSection.userChars||0}>{promptSection.user||'（本次没有 user 消息）'}</pre>
          </>}
          <b>附件（只记引用与 hash）</b>
          <ul data-detail-attachments="true">
            {(promptSection.attachments||[]).length
              ?(promptSection.attachments||[]).map(row=><li key={row.index} data-detail-attachment={row.kind}>{row.text}</li>)
              :<li data-detail-attachment="none">本次没有附件</li>}
          </ul>
        </div>
      </section>

      <section className="review-detail-section" data-detail-section="model">
        <div className="review-detail-block-head">
          <b>{modelSection.title||'模型与参数'}</b>
          <small data-detail-model="true">{modelSection.model||'—'}</small>
        </div>
        <ul className="review-detail-rows" data-detail-params="true">
          {modelSection.modelSourceLabel?<li data-detail-model-source={modelSection.modelSource||''}><b>模型来源</b><span>{modelSection.modelSourceLabel}{modelSection.modelSource?`（${modelSection.modelSource}）`:''}</span></li>:null}
          {(modelSection.params||[]).map(row=><li key={row.key} data-detail-param={row.key}><b>{row.label}</b><span>{row.value}</span></li>)}
        </ul>
      </section>

      {/* 两次对比（US-107b）：换模型 / 重新生成后，新轨迹用 parentTraceId 关联上一次，
          这一块把两次的模型、耗时与推理并排读出来（不做 diff 视图，见 PRD 开放问题 Q9）。 */}
      {compareView?<section className="review-detail-compare" data-detail-compare="true" data-compare-parent-trace={compareView.parentTraceId} data-compare-current-trace={compareView.currentTraceId} data-compare-live={compareView.live?'true':'false'} data-compare-model-changed={compareView.modelChanged?'true':'false'}>
        <div className="review-detail-block-head">
          <b>{compareView.title}</b>
          <small data-compare-summary="true">{compareView.summaryText}</small>
        </div>
        <p className="review-detail-compare-note" data-compare-note="true">{compareView.note}</p>
        <table className="review-detail-compare-table">
          <thead><tr><th>指标</th><th>上一次</th><th>本次</th><th>差值</th></tr></thead>
          <tbody data-compare-rows="true">
            {compareView.rows.map(row=><tr key={row.key} data-compare-row={row.key} data-compare-parent={row.parentText} data-compare-current={row.currentText} data-compare-delta={row.deltaText} className={row.changed?'is-changed':''}>
              <th scope="row">{row.label}</th>
              <td>{row.parentText}</td>
              <td>{row.currentText}</td>
              <td>{row.deltaText||'—'}</td>
            </tr>)}
          </tbody>
        </table>
        <div className="review-detail-compare-reasoning" data-compare-reasoning="true" data-compare-reasoning-parent-chars={compareView.reasoning.parentChars} data-compare-reasoning-current-chars={compareView.reasoning.currentChars} data-compare-reasoning-prefix={compareView.reasoning.commonPrefixChars} data-compare-reasoning-identical={compareView.reasoning.identical?'true':'false'}>
          <div className="review-detail-block-head">
            <b>推理对照</b>
            <small data-compare-reasoning-text="true">{compareView.reasoning.text}</small>
          </div>
          <ul className="review-detail-rows">
            <li data-compare-reasoning-parent-excerpt="true"><b>上一次开头</b><span>{compareView.reasoning.parentExcerpt||'（没有推理增量）'}</span></li>
            <li data-compare-reasoning-current-excerpt="true"><b>本次开头</b><span>{compareView.reasoning.currentExcerpt||'（还没有推理增量）'}</span></li>
          </ul>
        </div>
      </section>:null}

      <section className="review-detail-section" data-detail-section="usage">
        <div className="review-detail-block-head">
          <b>{usageSection.title||'用量与耗时'}</b>
          <small>{usageSection.costText?`估算成本 ${usageSection.costText}`:'本次未返回用量'}</small>
        </div>
        <ul className="review-detail-rows" data-detail-usage="true">
          {(usageSection.tokens||[]).map(row=><li key={row.key} data-detail-token={row.key} data-detail-value={row.value===null?'':row.value}><b>{row.label}</b><span>{row.valueText}</span></li>)}
          {(usageSection.timing||[]).map(row=><li key={row.key} data-detail-timing={row.key} data-detail-value={row.value===null?'':row.value}><b>{row.label}</b><span>{row.valueText}</span></li>)}
          {usageSection.cost?<li data-detail-cost="true"><b>估算成本</b><span>{usageSection.costText}</span></li>:null}
        </ul>
        {usageSection.note?<small className="review-detail-note" data-detail-usage-note="true">{usageSection.note}</small>:null}
      </section>

      <section className="review-detail-section" data-detail-section="output">
        <div className="review-detail-block-head">
          <b>{outputSection.title||'输出原文'}</b>
          <small>{outputSection.chars||0} 字{outputSection.parse?.message?` · ${outputSection.parse.message}`:''}</small>
        </div>
        <pre data-detail-output="true" data-detail-output-chars={outputSection.chars||0} data-detail-output-parse={outputSection.parse?.ok===null?'':String(outputSection.parse?.ok)}>{output||'（本次没有输出原文）'}</pre>
      </section>
    </div>:null}
  </section>;
}

function TeacherPersonaPage({teacherProfiles=[],setTeacherProfiles,skillLibrary=[],setToast,navigate}){
  const [editingId,setEditingId]=useState(teacherProfiles[0]?.id||'');
  const editing=teacherProfiles.find(item=>item.id===editingId)||teacherProfiles[0]||null;
  const [draft,setDraft]=useState(()=>editing?{...editing,skillKeys:[...(editing.skillKeys||[])]}:null);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{setDraft(editing?{...editing,skillKeys:[...(editing.skillKeys||[])]}:null)},[editingId,teacherProfiles.length]);
  const patch=(key,value)=>setDraft(current=>current?{...current,[key]:value}:current);

  const commit=async(next)=>{
    const list=teacherProfiles.some(item=>item.id===next.id)?teacherProfiles.map(item=>item.id===next.id?next:item):[...teacherProfiles,next];
    setTeacherProfiles(list);
    setSaving(true);
    try{ await saveRemoteTeacherProfile(next); setToast(`「${next.name}」的人设已保存到云端`); }
    catch{ setToast('已保存到本地；云端暂未连通，稍后可重试。'); }
    finally{ setSaving(false); }
  };
  const remove=async(id)=>{
    if(teacherProfiles.length<2){setToast('至少保留一位老师人设');return;}
    const list=teacherProfiles.filter(item=>item.id!==id);
    setTeacherProfiles(list); setEditingId(list[0]?.id||'');
    try{ await deleteRemoteTeacherProfile(id); setToast('人设已删除'); }catch{ setToast('已从本地移除，云端删除未成功。'); }
  };
  // 人设不再自己维护技能内容，只在技能库里勾选。
  const toggleSkill=(skillId)=>{
    const current=Array.isArray(draft?.skillKeys)?draft.skillKeys:[];
    patch('skillKeys',current.includes(skillId)?current.filter(key=>key!==skillId):[...current,skillId]);
  };
  const selectableSkills=skillLibrary.filter(skill=>skill.enabled!==false);
  const disabledSkills=skillLibrary.filter(skill=>skill.enabled===false);
  const selectedCount=(draft?.skillKeys||[]).filter(key=>selectableSkills.some(skill=>skill.id===key)).length;
  const groupedCategories=[...new Set(selectableSkills.map(skill=>skill.category||'未分类'))];

  return <>
    <PageHeader title="老师人设" desc="人设、勾选的技能与大模型记忆会一起加载给模型；技能本身在「技能库」中维护。" prd="PRD-4 / F-AI-PERSONA-01"
      actions={<Button icon={Plus} onClick={()=>{const next=createEmptyTeacherProfile();setTeacherProfiles([...teacherProfiles,next]);setEditingId(next.id);}}>新增人设</Button>}/>
    <div className="split-page persona-page">
      <div className="panel persona-list">
        <div className="panel-head"><h2>人设列表</h2><small>{teacherProfiles.length} 位</small></div>
        {teacherProfiles.map(profile=><button key={profile.id} className={profile.id===editingId?'active':''} onClick={()=>setEditingId(profile.id)}>
          <span className="avatar">{profile.name?profile.name[0]:'师'}</span>
          <div><b>{profile.name}</b><small>{[profile.roleLabel,profile.campus].filter(Boolean).join(' · ')||'未填写'}</small></div>
          <em>{resolveSkills(profile.skillKeys,skillLibrary,profile.skills).length} 技能</em>
        </button>)}
      </div>
      <div className="panel persona-editor">
        {draft?<>
          <div className="panel-head"><div><h2>{draft.name||'未命名老师'}</h2><p>人设越具体，点评越像这位老师说的话。</p></div>
            <div className="row-actions">
              <button className="text-link" disabled={saving} onClick={()=>commit(draft)}>{saving?'保存中…':'保存到云端'}</button>
              <button className="icon-btn danger-text" title="删除" onClick={()=>remove(draft.id)}><Trash2 size={16}/></button>
            </div>
          </div>
          <div className="form-grid compact">
            <label>姓名<input value={draft.name||''} onChange={event=>patch('name',event.target.value)}/></label>
            <label>职务<input value={draft.roleLabel||''} placeholder="例如：创意绘画主教" onChange={event=>patch('roleLabel',event.target.value)}/></label>
            <label>校区<input value={draft.campus||''} placeholder="例如：星河校区" onChange={event=>patch('campus',event.target.value)}/></label>
            <label>教龄（年）<input type="number" value={draft.years??''} onChange={event=>patch('years',event.target.value===''?null:Number(event.target.value))}/></label>
          </div>
          <label className="persona-field">教学信念<textarea rows={3} value={draft.beliefs||''} onChange={event=>patch('beliefs',event.target.value)} placeholder="例如：先看见孩子的表达，再谈技法。"/></label>
          <label className="persona-field">说话风格<textarea rows={3} value={draft.tone||''} onChange={event=>patch('tone',event.target.value)} placeholder="例如：温暖具体，多用「我看见……」句式。"/></label>
          <label className="persona-field">安全与伦理边界<textarea rows={3} value={draft.boundaries||''} onChange={event=>patch('boundaries',event.target.value)} placeholder="例如：不作心理诊断，不给孩子贴标签。"/></label>
          <label className="persona-field memory">大模型记忆<textarea rows={5} value={draft.memory||''} onChange={event=>patch('memory',event.target.value)} placeholder="写下需要模型长期记住的信息：孩子的用色习惯、上次给出的练习建议、需要回访的点……"/><small>这段文字会原样进入 system 提示词，并参与每次点评。</small></label>
          <div className="persona-skills">
            <div className="panel-head">
              <div><h3>勾选技能</h3><p>从技能库中勾选这位老师启用的技能。已勾选 {selectedCount} 项，会随人设一起写进提示词。</p></div>
              {navigate?<button className="text-link" onClick={()=>navigate('skillLibrary')}>去维护技能库 <ArrowRight size={14}/></button>:null}
            </div>
            {selectableSkills.length?groupedCategories.map(category=><div className="skill-pick-group" key={category}>
              <strong>{category}</strong>
              {selectableSkills.filter(skill=>(skill.category||'未分类')===category).map(skill=>{
                const checked=(draft.skillKeys||[]).includes(skill.id);
                return <label className={`skill-pick ${checked?'checked':''}`} key={skill.id}>
                  <input type="checkbox" checked={checked} onChange={()=>toggleSkill(skill.id)}/>
                  <span><b>{skill.name}</b><small>{skill.description||'未填写说明'}</small></span>
                </label>;
              })}
            </div>):<p className="persona-empty">技能库还是空的，请先到「技能库」里添加。</p>}
            {disabledSkills.length?<p className="persona-empty">另有 {disabledSkills.length} 项技能在库中已停用，不会进入点评。</p>:null}
          </div>
        </>:<p className="persona-empty">选择左侧的一位老师，或新增一位。</p>}
      </div>
    </div>
  </>;
}

// 技能来源徽标：手工维护 / 上传导入 / 本机发现 / 技能市场。
const SOURCE_LABEL={manual:'手工',upload:'上传',local:'本机',market:'市场'};
const AUDIT_TEXT={safe:'未发现风险特征',review:'含脚本文件，建议确认后导入',risky:'命中风险特征，请确认后再导入'};

// base64 归档还原成文件下载，让「装过的包随时可回溯」成立。
function downloadSkillPackage(skill){
  try{
    const name=(skill.packagePath||'').split('//')[1]||`${skill.name}.zip`;
    const binary=atob(skill.packageBlob);
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i+=1) bytes[i]=binary.charCodeAt(i);
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
    const link=document.createElement('a');
    link.href=url; link.download=name; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
  }catch{ /* 归档数据损坏时静默失败：这只是回溯入口，不影响技能本身 */ }
}

function SkillImportPanel({skillLibrary=[],setSkillLibrary,setToast,onClose}){
  const [tab,setTab]=useState('upload');
  const [busy,setBusy]=useState(false);
  const [parsed,setParsed]=useState(null);
  const [error,setError]=useState('');
  const [keyword,setKeyword]=useState('');
  const [category,setCategory]=useState('all');
  const [dragging,setDragging]=useState(false);
  const inputRef=useRef(null);
  const installedRefs=new Set(skillLibrary.map(item=>item.originRef||item.id));

  const takeFile=async(file)=>{
    if(!file) return;
    setError(''); setBusy(true);
    try{ setParsed({...(await readSkillPackage(file)),file}); }
    catch(parseError){ setParsed(null); setError(parseError.message||'这个文件解析不出来。'); }
    finally{ setBusy(false); }
  };

  const commitUpload=async()=>{
    if(!parsed) return;
    setBusy(true);
    try{
      const skill=skillFromPackage(parsed,skillLibrary);
      // zip 原包以 base64 归档进技能行（匿名模式下云存储不可写，database 通道够用且真实）。
      if(parsed.kind==='zip'&&parsed.file){
        try{
          const archived=await archiveSkillPackage(parsed.file);
          if(archived&&archived.inlined){ skill.packageBlob=archived.base64; skill.packagePath=`inline://${parsed.sourceName}`; }
          else{ skill.packagePath=`manifest-only://${parsed.sourceName}`; }
        }catch{ skill.packagePath=`manifest-only://${parsed.sourceName||parsed.name}`; }
      }
      const list=[...skillLibrary,skill];
      setSkillLibrary(list);
      await saveRemoteSkill(skill);
      setToast(`技能「${skill.name}」已导入，人设立即可勾选`);
      setParsed(null); if(onClose) onClose();
    }catch(saveError){ setToast(saveError.message||'导入失败，请重试。'); }
    finally{ setBusy(false); }
  };

  const importEntry=async(entry,kind)=>{
    const skill=skillFromIndexEntry(entry,kind==='market'?'market':'local');
    if(skillLibrary.some(item=>item.id===skill.id)){ setToast(`「${skill.name}」已经在技能库里了`); return; }
    const list=[...skillLibrary,skill];
    setSkillLibrary(list);
    try{ await saveRemoteSkill(skill); setToast(`「${skill.name}」已加入技能库`); }
    catch{ setToast('已加入本地技能库；云端同步未成功，可稍后重试。'); }
  };

  const localHits=searchSkillIndex(keyword);
  const marketHits=searchMarket(keyword,category);

  return <section className="skill-import">
    <div className="skill-import-head">
      <div>
        <span>导入技能</span>
        <h3>从本地文件、本机已装技能或技能市场，把技能加进技能库。</h3>
      </div>
      <button className="icon-btn" title="收起" onClick={()=>onClose&&onClose()}><X size={16}/></button>
    </div>
    <div className="skill-import-tabs">
      {[['upload','上传本地',UploadCloud],['local','本机发现',Package],['market','技能市场',Store]].map(([key,label,Icon])=>
        <button key={key} className={tab===key?'active':''} onClick={()=>{setTab(key);setError('');}}><Icon size={15}/>{label}</button>)}
    </div>

    {tab==='upload'?<div className="skill-import-body">
      <div className={`skill-drop ${dragging?'over':''}`}
        onDragOver={event=>{event.preventDefault();setDragging(true)}}
        onDragLeave={()=>setDragging(false)}
        onDrop={event=>{event.preventDefault();setDragging(false);takeFile(event.dataTransfer.files&&event.dataTransfer.files[0])}}>
        <FileText size={22}/>
        <b>把技能包拖到这里</b>
        <small>支持 .zip 技能包（自动找包里的 SKILL.md）与单个 .md 技能文件</small>
        <button className="primary" disabled={busy} onClick={()=>inputRef.current&&inputRef.current.click()}>{busy?'解析中…':'选择文件'}</button>
        <input ref={inputRef} type="file" accept=".zip,.md,.markdown,text/markdown" hidden
          onChange={event=>{takeFile(event.target.files&&event.target.files[0]);event.target.value=''}}/>
      </div>
      {error?<p className="skill-import-error"><CircleAlert size={14}/>{error}</p>:null}
      {parsed?<div className="skill-audit">
        <div className="skill-audit-head">
          <div>
            <b>{parsed.displayName||parsed.name||'未命名技能'}</b>
            <small>{parsed.kind==='zip'?`技能包 · ${parsed.skillPath}`:'单个技能文件'}{parsed.version?` · v${parsed.version}`:''}{parsed.author?` · ${parsed.author}`:''}</small>
          </div>
          <span className={`audit-badge ${parsed.audit.level}`}>{AUDIT_TEXT[parsed.audit.level]}</span>
        </div>
        <p className="skill-audit-desc">{parsed.description||'（这份技能没有写 description，导入后可在右侧补充。）'}</p>
        <div className="skill-audit-files">
          <strong>包内 {parsed.files.length} 个文件{parsed.files.length>8?`，列出前 8 个`:''}</strong>
          <ul>{parsed.files.slice(0,8).map(file=><li key={file.path}><code>{file.path}</code><em>{file.size>1024?`${Math.round(file.size/1024)} KB`:`${file.size} B`}</em></li>)}</ul>
          {parsed.audit.scriptFiles.length?<p className="skill-audit-warn">含 {parsed.audit.scriptFiles.length} 个脚本文件：{parsed.audit.scriptFiles.slice(0,4).join('、')}</p>:null}
          {parsed.audit.hits.length?<p className="skill-audit-warn risky">命中 {parsed.audit.labels.length} 类风险特征：{parsed.audit.labels.join('、')}。导入只会把 SKILL.md 的说明写进提示词，不会执行包内任何脚本。</p>:null}
        </div>
        <div className="skill-audit-actions">
          <button className="primary" disabled={busy} onClick={commitUpload}>{busy?'导入中…':'确认导入技能库'}</button>
          <button onClick={()=>{setParsed(null);setError('')}}>取消</button>
        </div>
      </div>:null}
    </div>:null}

    {tab==='local'?<div className="skill-import-body">
      <div className="skill-import-search">
        <Search size={15}/>
        <input value={keyword} placeholder={`在本机已安装的 ${indexStats.local} 个技能里查找（find-skills）`} onChange={event=>setKeyword(event.target.value)}/>
      </div>
      <ul className="skill-index-list">
        {localHits.map(entry=>{
          const skillId=`idx-${entry.name}`;
          const done=installedRefs.has(entry.name)||skillLibrary.some(item=>item.id===skillId);
          return <li key={entry.name}>
            <div className="skill-index-main">
              <b>{entry.displayName}</b>
              <small>{entry.description}</small>
              <div className="skill-index-meta">
                <em>{entry.category}</em>
                {entry.version?<em>v{entry.version}</em>:null}
                <em>{entry.fileCount} 文件{entry.scriptCount?` · ${entry.scriptCount} 脚本`:''}{entry.referenceCount?` · ${entry.referenceCount} 参考`:''}</em>
              </div>
            </div>
            <button className={done?'done':''} disabled={done} onClick={()=>importEntry(entry,'local')}>{done?'已在库中':'导入'}</button>
          </li>;
        })}
        {!localHits.length?<li className="skill-index-empty">没有匹配的技能。</li>:null}
      </ul>
    </div>:null}

    {tab==='market'?<div className="skill-import-body">
      <div className="skill-import-search">
        <Search size={15}/>
        <input value={keyword} placeholder={`在技能市场的 ${indexStats.market} 个技能里搜索`} onChange={event=>setKeyword(event.target.value)}/>
      </div>
      <div className="skill-market-cats">
        {marketCategories.map(key=><button key={key} className={category===key?'active':''} onClick={()=>setCategory(key)}>{key==='all'?'全部':key}</button>)}
      </div>
      <ul className="skill-index-list">
        {marketHits.map(entry=>{
          const skillId=`mkt-${entry.name}`;
          const done=installedRefs.has(entry.name)||skillLibrary.some(item=>item.id===skillId);
          return <li key={entry.name}>
            <div className="skill-index-main">
              <b>{entry.displayName}{entry.installs?<span className="installs">{entry.installs>=10000?`${(entry.installs/10000).toFixed(1)} 万次安装`:`${entry.installs} 次安装`}</span>:null}</b>
              <small>{entry.description}</small>
              <div className="skill-index-meta">
                <em>{entry.category}</em>
                {entry.version?<em>v{entry.version}</em>:null}
                {entry.author?<em>{entry.author}</em>:null}
                {entry.license?<em>{entry.license}</em>:null}
                <em>{entry.marketSource==='skillhub'?'skillhub':'marketplace'}</em>
              </div>
            </div>
            <button className={done?'done':''} disabled={done} onClick={()=>importEntry(entry,'market')}>{done?'已安装':'安装'}</button>
          </li>;
        })}
        {!marketHits.length?<li className="skill-index-empty">没有匹配的技能。</li>:null}
      </ul>
      <p className="skill-import-note">市场目录同步于 {MARKETPLACE_SYNCED_AT}，共 {indexStats.market} 个技能，其中 {indexStats.withInstalls} 个带有真实安装量数据。</p>
    </div>:null}
  </section>;
}

function SkillLibraryPage({skillLibrary=[],setSkillLibrary,teacherProfiles=[],setToast}){
  const [editingId,setEditingId]=useState(skillLibrary[0]?.id||'');
  const [importOpen,setImportOpen]=useState(false);
  const editing=skillLibrary.find(item=>item.id===editingId)||skillLibrary[0]||null;
  const [draft,setDraft]=useState(()=>editing?{...editing}:null);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{setDraft(editing?{...editing}:null)},[editingId,skillLibrary.length]);
  const patch=(key,value)=>setDraft(current=>current?{...current,[key]:value}:current);
  const usersOf=(id)=>teacherProfiles.filter(profile=>(profile.skillKeys||[]).includes(id)).map(profile=>profile.name);

  const commit=async(next)=>{
    const list=skillLibrary.some(item=>item.id===next.id)?skillLibrary.map(item=>item.id===next.id?next:item):[...skillLibrary,next];
    setSkillLibrary(list);
    setSaving(true);
    try{ await saveRemoteSkill(next); setToast(`技能「${next.name}」已保存到云端，人设立即可勾选`); }
    catch{ setToast('已保存到本地；云端暂未连通，稍后可重试。'); }
    finally{ setSaving(false); }
  };
  const remove=async(id)=>{
    const used=usersOf(id);
    if(used.length){ setToast(`「${used.join('、')}」还在勾选这项技能，请先到人设中取消勾选。`); return; }
    const list=skillLibrary.filter(item=>item.id!==id);
    setSkillLibrary(list); setEditingId(list[0]?.id||'');
    try{ await deleteRemoteSkill(id); setToast('技能已删除'); }
    catch{ setToast('已从本地移除，云端删除未成功。'); }
  };

  return <>
    <PageHeader title="技能库" desc="所有人设共用的技能基础数据。可手工维护，也可上传技能包、从本机已装技能或技能市场导入。" prd="PRD-4 / F-AI-SKILL-01"
      actions={<>
        <Button variant="secondary" icon={UploadCloud} onClick={()=>setImportOpen(current=>!current)}>导入技能</Button>
        <Button icon={Plus} onClick={()=>{const next=createEmptySkill();setSkillLibrary([...skillLibrary,next]);setEditingId(next.id);}}>新增技能</Button>
      </>}/>
    {importOpen?<SkillImportPanel skillLibrary={skillLibrary} setSkillLibrary={setSkillLibrary} setToast={setToast} onClose={()=>setImportOpen(false)}/>:null}
    <div className="split-page persona-page skill-library-page">
      <div className="panel persona-list">
        <div className="panel-head"><h2>技能列表</h2><small>{skillLibrary.length} 项</small></div>
        {skillLibrary.map(skill=>{
          const used=usersOf(skill.id).length;
          return <button key={skill.id} className={skill.id===editingId?'active':''} onClick={()=>setEditingId(skill.id)}>
            <span className={`skill-cat src-${skill.source||'manual'}`}>{skill.category||'未分类'}</span>
            <div><b>{skill.name}<i className="src-tag">{SOURCE_LABEL[skill.source||'manual']}</i></b><small>{skill.description||'未填写说明'}</small></div>
            <em>{used?`${used} 人使用`:skill.enabled===false?'已停用':'未使用'}</em>
          </button>;
        })}
      </div>
      <div className="panel persona-editor">
        {draft?<>
          <div className="panel-head"><div><h2>{draft.name||'未命名技能'}</h2><p>技能描述会原样写进提示词，直接决定模型怎么观察与表达。</p></div>
            <div className="row-actions">
              <button className="text-link" disabled={saving} onClick={()=>commit(draft)}>{saving?'保存中…':'保存到云端'}</button>
              <button className="icon-btn danger-text" title="删除" onClick={()=>remove(draft.id)}><Trash2 size={16}/></button>
            </div>
          </div>
          <div className="form-grid compact">
            <label>技能名称<input value={draft.name||''} onChange={event=>patch('name',event.target.value)}/></label>
            <label>分类<input value={draft.category||''} placeholder="例如：作品观察" onChange={event=>patch('category',event.target.value)}/></label>
            <label>排序<input type="number" value={draft.sortOrder??90} onChange={event=>patch('sortOrder',Number(event.target.value)||0)}/></label>
            <label className="framing-enable"><input type="checkbox" checked={draft.enabled!==false} onChange={event=>patch('enabled',event.target.checked)}/> 启用</label>
          </div>
          <label className="persona-field">技能描述<textarea rows={5} value={draft.description||''} onChange={event=>patch('description',event.target.value)} placeholder="写清楚这项技能要求模型怎么做，例如：只描述画面中真实可见的颜色关系，不推断孩子对颜色的主观感受。"/><small>这段文字会原样进入 system 提示词。</small></label>
          {draft.source&&draft.source!=='manual'?<div className="skill-origin">
            <div><b>来源</b><span>{SOURCE_LABEL[draft.source]} · {draft.originRef||draft.id}</span></div>
            {draft.version?<div><b>版本</b><span>v{draft.version}</span></div>:null}
            {draft.author?<div><b>作者</b><span>{draft.author}</span></div>:null}
            {draft.license?<div><b>许可</b><span>{draft.license}</span></div>:null}
            {draft.packagePath?<div><b>归档</b><span>
              {draft.packageBlob
                ?<button className="text-link" onClick={()=>downloadSkillPackage(draft)}>下载原包 <Download size={13}/></button>
                :<span>仅保留文件清单（原包未内联归档）</span>}
              <code style={{marginLeft:8}}>{draft.packagePath}</code>
            </span></div>:null}
            <div><b>导入体检</b><span className={`audit-text ${draft.auditLevel||'safe'}`}>{AUDIT_TEXT[draft.auditLevel||'safe']}</span></div>
            {Array.isArray(draft.packageFiles)&&draft.packageFiles.length?<div className="skill-origin-files"><b>包内文件</b><span>{draft.packageFiles.slice(0,10).map(file=><code key={typeof file==='string'?file:file.path}>{typeof file==='string'?file:file.path}</code>)}{draft.packageFiles.length>10?`等 ${draft.packageFiles.length} 个`:''}</span></div>:null}
          </div>:null}
          {usersOf(draft.id).length?<p className="persona-empty">当前被 {usersOf(draft.id).join('、')} 勾选。停用后这些人设会自动跳过这项技能。</p>:<p className="persona-empty">还没有人设勾选这项技能。</p>}
        </>:<p className="persona-empty">选择左侧的一项技能，或新增一项。</p>}
      </div>
    </div>
  </>;
}

/**
 * 叠加元素的位置选择：九宫格按钮（F-FRAME-MARK-02，后台与老师端**共用这一个控件**）。
 * 位置枚举、锚点与中文名全部来自 `services/overlayLayout.js`（与渲染层同一份），
 * 所以这里点出来的位置就是成品图上水印真正落的地方。
 *
 * 传入 `onSelect` / `onOffsetChange` 时支持「拖动微调」（US-007 的老师端面板）：
 *   - 点格子 = 定位（`onSelect(position)`）；
 *   - 在格子上按住拖动 = 改偏移（`onOffsetChange({offsetX,offsetY})`）——
 *     换算规则与常量都在 `data/lessonOverlays.js` 的 `overlayDragOffsets`（拖过整块 = 0.3、
 *     方向取自 `resolveElementAnchor`，所以「往右拖」在成品图上也是往右移）。
 * 拖动过程中**以按下那一刻的偏移为基准**算总位移（指针来回移动不会累积漂移）；
 * 位移小于 `OVERLAY_DRAG_THRESHOLD_PX` 时仍算点击，不产生微小偏移。
 * 后台沿用旧签名（`value` + `onChange`）时行为一字不变：没有 `onOffsetChange` 就没有拖动。
 */
function OverlayPositionPad({value,onChange,label,field,offsets,onSelect,onOffsetChange,dataParam}){
  const padRef=useRef(null);
  const dragRef=useRef(null);
  const dragEnabled=typeof onOffsetChange==='function';
  const select=typeof onSelect==='function'?onSelect:(position=>onChange&&onChange(position));
  const beginDrag=(position)=>(event)=>{
    select(position);
    if(!dragEnabled) return;
    const rect=padRef.current?.getBoundingClientRect();
    if(!rect) return;
    const dir=overlayElementDragDirection(position);
    dragRef.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,dir,
      from:{offsetX:Number(offsets?.offsetX)||0,offsetY:Number(offsets?.offsetY)||0},width:rect.width,height:rect.height,moved:false};
    try{event.currentTarget.setPointerCapture?.(event.pointerId)}catch{/* 老浏览器没有指针捕获：靠容器上的 move 兜底 */}
  };
  const moveDrag=(event)=>{
    const drag=dragRef.current;
    if(!drag||!dragEnabled) return;
    const dx=event.clientX-drag.startX;
    const dy=event.clientY-drag.startY;
    if(!drag.moved&&!overlayDragIsActive(dx,dy)) return;
    drag.moved=true;
    if(event.cancelable) event.preventDefault();
    onOffsetChange(overlayDragOffsets({from:drag.from,dx,dy,padWidth:drag.width,padHeight:drag.height,dirX:drag.dir.dirX,dirY:drag.dir.dirY}));
  };
  const endDrag=()=>{dragRef.current=null};
  const offsetX=Number(offsets?.offsetX)||0;
  const offsetY=Number(offsets?.offsetY)||0;
  const dir=overlayElementDragDirection(value);
  // 拖动可视化：当前格子里的小圆点按偏移方向移动（±0.5 偏移 → ±14px，超过就夹住）。
  const dotX=Math.max(-14,Math.min(14,dir.dirX*offsetX*28));
  const dotY=Math.max(-14,Math.min(14,dir.dirY*offsetY*28));
  const shifted=Math.abs(offsetX)>0.0005||Math.abs(offsetY)>0.0005;
  return <div className="overlay-position-pad" ref={padRef} role="group" aria-label={`${label}位置`} data-overlay-pad={field||label} data-overlay-pad-position={value} data-overlay-pad-offset={`${offsetX},${offsetY}`} data-overlay-pad-draggable={dragEnabled?'true':'false'} data-frame-param={dataParam||undefined}
    onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
    {ELEMENT_POSITIONS.filter(position=>position!==CUSTOM_ELEMENT_POSITION).map(position=>
      <button key={position} type="button" className={position===value?'active':''} aria-pressed={position===value}
        data-overlay-cell={position} data-overlay-cell-active={position===value?'true':'false'}
        aria-label={`${label}：${overlayPositionLabel(position)}`} title={`${overlayPositionLabel(position)}${dragEnabled?'（按住拖动可微调偏移）':''}`}
        onPointerDown={beginDrag(position)} onClick={()=>select(position)}>
        {position===value&&shifted?<i className="overlay-pad-dot" style={{transform:`translate(${dotX}px,${dotY}px)`}}/>:null}
        {overlayPositionLabel(position)}
      </button>)}
  </div>;
}

function FramingSettingsPage({framingPresets=[],setFramingPresets,setToast,records=[],courses=[],auditLog=[],recordAudit=()=>{}}){
  // 后台每一次变更的操作人（原型阶段没有账号体系，会话身份串就是操作人 —— 与课次 teacherId 同一口径）。
  const adminName=roleMeta.admin.name;
  // [US-013] 写权限：后台这个会话是**平台管理员**（角色组见「权限设置」页）。
  // 三层模板里它只能写 platform 层 —— org 层归本机构管理员、teacher 层归老师本人，
  // 界面上对这两层不显示写入入口（`FRAMING_PRESET_READONLY_NOTE` 说明去哪儿改），
  // 服务层（`saveRemoteFramingPreset` / `deleteRemoteFramingPreset`）再拦一道 403。
  const adminFrameViewer={role:'admin',adminTier:'platform',orgId:DEFAULT_ORG_ID,actorName:adminName,actorId:adminName};
  const adminActor=framingActor(adminFrameViewer);
  const adminPermissionRows=framingPermissionRows(adminFrameViewer);
  // 审计：后台只**写**两类事件（模板写入被拒 / 顺便把管理端自己的动作也留痕），列表读全局日志。
  const auditDenied=(preset,action)=>{
    const issue=framingPresetWriteIssue(preset,adminFrameViewer);
    if(!issue) return '';
    recordAudit(buildAuditEntry({
      action:AUDIT_ACTIONS.templateWriteDenied,
      actorId:adminActor.actorId,
      actorName:adminActor.actorName,
      actorRole:adminActor.role,
      actorRoleLabel:adminActor.roleLabel,
      orgId:DEFAULT_ORG_ID,
      templateId:preset?.id||'',
      templateName:preset?.name||'',
      scope:normalizeFramingPreset(preset).scope,
      outcome:'denied',
      detail:`${action}被拒绝：${issue}`
    }));
    setToast(framingWriteDeniedMessage(preset,adminFrameViewer));
    return issue;
  };
  const [mediaSinkProbe,setMediaSinkProbe]=useState(null);
  // 排序的唯一来源（`sortOrder`）：列表、上移 / 下移、老师端的网格读的都是它。
  const library=sortFramingPresets(framingPresets);
  const defaultPreset=defaultFramingPreset(library);
  const courseOptions=selectableCourses(courses);
  const missingBuiltins=missingBuiltinFramingPresets(library);
  const [editingId,setEditingId]=useState(library[0]?.id||'');
  const editing=library.find(item=>item.id===editingId)||library[0]||null;
  const [draft,setDraft]=useState(()=>editing?{...editing}:null);
  // 删除的影响范围 / 拒绝原因（US-011b：被引用的模板只允许停用）与「待二次确认的删除」。
  const [deleteNotice,setDeleteNotice]=useState('');
  const [confirmDeleteId,setConfirmDeleteId]=useState('');
  // 草稿读 US-011b 的四个字段（isDefault / boundCourseTypes / updatedBy / history）之前先过一遍收敛：
  // 种子数据与本机老镜像里的行还没有这些字段，直接读到 undefined 会炸掉整页。
  const draftV2=normalizeFramingPreset(draft);
  const [generating,setGenerating]=useState(false);
  // 生成回执（US-011c）：建议清单（形状 + 六类位置）+ 被收敛的非法枚举值 + 模型名。
  // `ok: false` 时只有 message（云端不通 / 模型没吐 JSON）—— 草稿的 spec 一个字不动、保存不被阻塞。
  const [generationReport,setGenerationReport]=useState(null);
  const [preview,setPreview]=useState('');
  const [saving,setSaving]=useState(false);
  // 后台预览 / 遮挡统计里的展签日期（US-014）：后台没有真实课次上下文，值用 `FRAME_PREVIEW_LESSON_DATE`
  // 这份示例课次日期，格式取模板保存的 `plaque.dateFormat` —— 也就是说面板上看到的就是
  // 「这份模板 + 一节真实课次」会印出来的那一行，而模板自己结构上装不下一个日期值。
  const adminPlaqueDateText=(spec)=>formatOverlayDate(FRAME_PREVIEW_LESSON_DATE,normalizeFrameSpecV2(spec).plaque.dateFormat);
  // 水印（US-003b）：Logo 上传的忙碌态 / 上传校验的错误文案 / 已保存 Logo 的复核结果 / 遮挡统计。
  const [logoBusy,setLogoBusy]=useState(false);
  const [assetError,setAssetError]=useState('');
  const [logoInfo,setLogoInfo]=useState(null);
  // 落款（US-003c）：签名图上传的忙碌态 / 错误文案 / 已存签名图的复核结果。
  const [signatureBusy,setSignatureBusy]=useState(false);
  const [signatureError,setSignatureError]=useState('');
  const [signatureInfo,setSignatureInfo]=useState(null);
  const [coverage,setCoverage]=useState(null);
  const logoInput=useRef(null);
  const signatureInput=useRef(null);
  // 换模板 = 换草稿：生成回执也一起清掉（它描述的是刚才那一份草稿的建议），否则会显示上一套模板的生成结果。
  useEffect(()=>{setDraft(editing?{...editing}:null);setGenerationReport(null)},[editingId,framingPresets.length]);
  useEffect(()=>{if(!draft)return undefined;let active=true;renderFramePreview({spec:draft.spec||DEFAULT_FRAME_SPEC,student:draft.plaqueStudent||'陈一诺',title:draft.plaqueTitle||'向着光的花',date:adminPlaqueDateText(draft.spec),orgName:DEFAULT_ORG_NAME,teacherName:roleMeta.teacher.name}).then(url=>{if(active)setPreview(url)}).catch(()=>{if(active)setPreview('')});return()=>{active=false}},[draft?.spec,draft?.plaqueStudent,draft?.plaqueTitle]);
  const patch=(key,value)=>setDraft(current=>current?{...current,[key]:value}:current);
  // 面板只认识 v1 平面字段，这里统一取视图：老预设（v1）原样、v2 预设映射成平面值。
  const draftSpec=frameSpecView(draft?.spec);
  // 叠加元素（US-003b/003c）读 v2 收敛后的分组；但**显示值优先用 draft 里的原值**，
  // 否则「输入 2 立刻被收敛成 8」会让数字框没法正常输入（收敛发生在渲染时，不发生在输入时）。
  const specV2=normalizeFrameSpecV2(draft?.spec);
  const rawGroup=(name)=>draft?.spec&&typeof draft.spec==='object'&&draft.spec[name]&&typeof draft.spec[name]==='object'?draft.spec[name]:{};
  const rawWatermark=rawGroup('watermark');
  const rawSignature=rawGroup('signature');
  const rawDate=rawGroup('date');
  const logoWatermark={...specV2.watermark.logo,...(rawWatermark.logo||{})};
  const textWatermark={...specV2.watermark.text,...(rawWatermark.text||{})};
  const qrWatermark={...specV2.watermark.qr,...(rawWatermark.qr||{})};
  const signatureMark={...specV2.signature,...rawSignature,seal:{...specV2.signature.seal,...(rawSignature.seal||{})}};
  const dateMark={...specV2.date,...rawDate};
  // 相框 / 卡纸 / 展签三组（US-011a）：与上面同一个口径 —— 收敛值兜底、draft 原值优先显示。
  const rawFrame=rawGroup('frame');
  const frameCtl={...specV2.frame,...rawFrame,lighting:{...specV2.frame.lighting,...(rawFrame.lighting||{})}};
  const matCtl={...specV2.mat,...rawGroup('mat')};
  const plaqueCtl={...specV2.plaque,...rawGroup('plaque')};
  // 光影开关 = 渲染层的同一条判据（`frame.lighting` 是对象才算显式给出）；关掉时写回去的相框分组里没有它。
  const lightingOn=framingPanelLightingOn(draft?.spec);
  // 覆盖率（验收原文「覆盖相框、卡纸、展签、水印、落款、时间的全部 v2 参数」）：
  // 拿收敛后的整份 spec 逐叶子比对，缺一个都不算覆盖完整；面板上的徽标与浏览器断言读同一份。
  const panelCoverage=framingPanelCoverage(specV2);
  const panelMissing=framingPanelMissingFields(specV2);

  // 写回一组参数：**只覆盖这一组 + version**，老模板的平面字段（outer / mat / plaque* …）一个都不动
  // —— 混写结构在 `normalizeFrameSpecV2` 里是合法输入（v2 分组优先、v1 平面字段兜底），
  // 所以后台改相框/卡纸/展签/落款/时间不会改变这套模板原本的其它长相。
  const patchOverlayGroup=(group,value)=>setDraft(current=>{
    if(!current) return current;
    return {...current,spec:framingPanelGroupSpec(current.spec,group,value)};
  });
  // 相框组多一条口径：光影开关关着时不写 `lighting` 字段（= v1 老模板的实色框，逐像素不变）。
  const patchFrame=(values)=>patchOverlayGroup('frame',framingPanelFrameGroup({...frameCtl,...values},lightingOn));
  const toggleFrameLighting=(on)=>patchOverlayGroup('frame',framingPanelFrameGroup(frameCtl,on));
  const patchMat=(values)=>patchOverlayGroup('mat',{...matCtl,...values});
  const patchPlaque=(values)=>patchOverlayGroup('plaque',{...plaqueCtl,...values});
  // 叠加元素的精细偏移（offsetX / offsetY，-0.5~0.5，口径见 services/overlayLayout.js 的 clampOverlayOffset）：
  // 面板改的是**模板上的全局默认值**，老师端仍可在自己的水印面板上继续微调。
  const offsetTargets={
    'watermark.logo':{values:logoWatermark,patch:values=>patchWatermark({logo:{...logoWatermark,...values}})},
    'watermark.text':{values:textWatermark,patch:values=>patchWatermark({text:{...textWatermark,...values}})},
    'watermark.qr':{values:qrWatermark,patch:values=>patchWatermark({qr:{...qrWatermark,...values}})},
    signature:{values:signatureMark,patch:values=>patchSignature(values)},
    date:{values:dateMark,patch:values=>patchDate(values)}
  };
  // 两个偏移数字框（五支叠加元素共用同一段 JSX，就不用在五个块里各抄一遍）。
  const offsetInputs=(target)=>{
    const entry=offsetTargets[target];
    return ['offsetX','offsetY'].map(key=><label key={key}>偏移 {key==='offsetX'?'X':'Y'}
      <input type="number" data-frame-param={`${target}.${key}`} min="-0.5" max="0.5" step="0.01"
        value={Number(entry.values[key]||0)}
        onChange={event=>entry.patch({[key]:Number(event.target.value)})}/>
    </label>);
  };
  const patchWatermark=(groups)=>setDraft(current=>{
    if(!current) return current;
    const base=current.spec&&typeof current.spec==='object'?current.spec:{};
    const currentWatermark=normalizeFrameSpecV2(base).watermark;
    return {...current,spec:{...base,version:2,watermark:{...currentWatermark,...groups}}};
  });
  const uploadLogo=async(file)=>{
    setLogoBusy(true);
    setAssetError('');
    try{
      const result=await readFramingAsset(file);
      if(!result.ok){setAssetError(result.message);setToast(result.message);return}
      patchWatermark({logo:{...logoWatermark,visible:true,url:result.asset.url}});
      setToast(`已上传机构 Logo（${framingAssetSummary(result.asset)}），右侧预览已更新`);
    }finally{setLogoBusy(false)}
  };
  const removeLogo=()=>{
    setAssetError('');
    patchWatermark({logo:{...logoWatermark,url:'',visible:false}});
    setToast('已移除机构 Logo，保存后老师端不再带水印');
  };
  // 落款（US-003c）：文字（姓名 + 寄语）或手写签名图 + 可选印章。签名图沿用 Logo 的上传准入
  // （PNG/JPG、≤512×512、≤200KB），因为它是同一个「装裱素材」口径（FR-22）。
  const patchSignature=(values)=>patchOverlayGroup('signature',{...signatureMark,...values});
  const patchSeal=(values)=>patchSignature({seal:{...signatureMark.seal,...values}});
  const patchDate=(values)=>patchOverlayGroup('date',{...dateMark,...values});
  const patchQr=(values)=>patchWatermark({qr:{...qrWatermark,...values}});
  const uploadSignature=async(file)=>{
    setSignatureBusy(true);
    setSignatureError('');
    try{
      const result=await readFramingAsset(file);
      if(!result.ok){setSignatureError(result.message);setToast(result.message);return}
      patchSignature({mode:'image',visible:true,imageUrl:result.asset.url});
      setToast(`已上传手写签名图（${framingAssetSummary(result.asset)}），右侧预览已更新`);
    }finally{setSignatureBusy(false)}
  };
  const removeSignature=()=>{
    setSignatureError('');
    patchSignature({mode:'text',imageUrl:''});
    setToast('已移除手写签名图，落款回到文字模式');
  };
  // 已存签名图的复核（与 Logo 同一个口径：只判尺寸，因为能解码就说明格式可用）。
  const signatureUrl=signatureMark.imageUrl;
  useEffect(()=>{
    if(!signatureUrl){setSignatureInfo(null);return undefined}
    let active=true;
    inspectFramingAssetUrl(signatureUrl,'手写签名图').then(info=>{if(active)setSignatureInfo(info)}).catch(()=>{if(active)setSignatureInfo(null)});
    return()=>{active=false};
  },[signatureUrl]);
  // 二维码内容（FR-23）：后台配置目标 → 解析成 URL → 编码。老师端拿不到「填 URL」的入口，
  // 面板这里也只能选目标；长度不够放时（超出版本上限）当场说明，而不是到渲染时才静默消失。
  const qrResolved=resolveQrTargetUrl(qrWatermark.target);
  const qrBytes=qrByteLength(qrResolved.url);
  const qrVersion=qrVersionFor(qrResolved.url,QR_DEFAULT_ECC);
  // 已保存 Logo 的复核：解码拿真实尺寸，尺寸超限或地址失效都在面板上说明（FR-22）。
  const logoUrl=logoWatermark.url;
  useEffect(()=>{
    if(!logoUrl){setLogoInfo(null);return undefined}
    let active=true;
    inspectFramingAssetUrl(logoUrl,'机构 Logo').then(info=>{if(active)setLogoInfo(info)}).catch(()=>{if(active)setLogoInfo(null)});
    return()=>{active=false};
  },[logoUrl]);
  // 遮挡统计（US-003b 的验收：水印遮挡作品主体超过 15% 要提示）。
  // 与成品图共用同一份几何（measureFramingCoverage → buildFramingLayout），所以面板上的百分比
  // 就是成品图上真实压住的面积；预览用的是占位作品，尺寸与占位图一致。
  useEffect(()=>{
    if(!draft){setCoverage(null);return undefined}
    let active=true;
    measureFramingCoverage({
      spec:draft.spec||DEFAULT_FRAME_SPEC,
      imageWidth:FRAME_PREVIEW_ARTWORK_SIZE.width,
      imageHeight:FRAME_PREVIEW_ARTWORK_SIZE.height,
      orgName:DEFAULT_ORG_NAME,
      teacherName:roleMeta.teacher.name,
      student:draft.plaqueStudent||'陈一诺',
      title:draft.plaqueTitle||'向着光的花',
      date:adminPlaqueDateText(draft.spec)
    }).then(result=>{if(active)setCoverage(result)}).catch(()=>{if(active)setCoverage(null)});
    return()=>{active=false};
  },[draft?.spec,draft?.plaqueStudent,draft?.plaqueTitle]);

  const generate=async()=>{
    if(!draft) return;
    setGenerating(true);
    try{
      const result=await generateFrameSpecV2(draft.description);
      if(!result.ok){
        setGenerationReport({ok:false,model:result.model,message:result.message});
        setToast(result.message);
        return;
      }
      // 生成结果并进草稿：模型产出的 v2 分组覆盖旧的，Logo / 签名图这类上传素材保留
      // （mergeGeneratedFrameSpec 里处理，否则「先生成再上传」的顺序会让 Logo 白传）。
      setDraft(current=>current?{...current,spec:mergeGeneratedFrameSpec(current.spec,result.spec)}:current);
      setGenerationReport({ok:true,model:result.model,...result.report});
      setToast('大模型已生成 v2 装裱参数（含形状与水印位置建议），右侧预览可确认效果');
    }catch(error){
      // 服务层返回信封、不抛错；这里只兜住编程性错误，同样不阻断保存。
      setGenerationReport({ok:false,model:'',message:error.message||'装裱参数生成失败，请调整描述后重试。'});
      setToast(error.message||'装裱参数生成失败，请调整描述后重试。');
    }
    finally{ setGenerating(false); }
  };
  // ---- 保存（「保存到云端」）------------------------------------------------------------
  // 保存 = 把草稿写回模板库：这一次变更同样记进 updated_by / updated_at / 变更历史
  // （US-011b 的「模板变更记录」），并把改动内容写进历史行的 detail。
  // [US-013] 写权限先判：平台管理员只写 platform 层（`draftWritable`），不合格的写入
  // **不做任何乐观更新**、记一条「被拒绝」的审计，界面上的按钮也据此关闭。
  const commit=async(next)=>{
    if(auditDenied(next,'保存参数')) return;
    const summary=framingPresetChangeSummary(editing,next);
    const stamped=stampFramingPresetUpdate(next,{by:adminName,action:'保存参数',detail:summary.join(' · ')});
    const list=library.some(item=>item.id===stamped.id)?library.map(item=>item.id===stamped.id?stamped:item):[...library,stamped];
    setFramingPresets(list);
    setDraft({...stamped});
    setSaving(true);
    try{
      await saveRemoteFramingPreset(stamped,adminFrameViewer);
      setToast(`装裱「${stamped.name}」已保存，老师端即可选用${summary.length?`（本次改动：${summary.join(' · ')}）`:''}`);
    }
    catch{ setToast('已保存到本机；云端暂未连通，稍后可重试。'); }
    finally{ setSaving(false); }
  };
  // ---- 模板库的立即生效动作（US-011b）：默认 / 启停 / 课程绑定 / 排序 ----------------
  // 这四件事不经过「保存到云端」那一按钮（点一下就该生效），但仍然走同一条写入口径：
  // 过 `stampFramingPresetUpdate` 记 updated_by / updated_at / 变更历史，再把**这次真的变了**
  // 的那几条推云端。编辑草稿里对应字段也同步过去（老师写了一半的名称 / 描述不能被这些点击冲掉）。
  // [US-013]：库里若有不属于当前管理员那一层的模板（机构 / 老师个人），这里逐条判权限 ——
  // 不合格的那几条**跳过**并把原因说出来，其余照常生效。
  const commitLibrary=async(next,{message=''}={})=>{
    const before=new Map(library.map(item=>[item.id,item]));
    const changed=next.filter(item=>before.get(item.id)?.updatedAt!==item.updatedAt);
    const writable=changed.filter(item=>!framingPresetWriteIssue(item,adminFrameViewer));
    const denied=changed.filter(item=>framingPresetWriteIssue(item,adminFrameViewer));
    setFramingPresets(next);
    if(message) setToast(message);
    if(denied.length){
      denied.forEach(item=>auditDenied(item,'库级设置'));
      setToast(`已跳过 ${denied.length} 套不属于平台管理员维护范围的模板：${denied.map(item=>`「${item.name}」`).join('')}${FRAMING_PRESET_READONLY_NOTE.org}`);
      return;
    }
    if(!writable.length) return;
    try{ for(const item of writable) await saveRemoteFramingPreset(item,adminFrameViewer); }
    catch{ setToast('已保存在本机；云端暂未连通，稍后可重试。'); }
  };
  // 只把这几个字段同步进编辑草稿（别整条覆盖：草稿承载着还没保存的改名 / 改描述）。
  const syncDraft=(stored)=>setDraft(current=>{
    if(!current||current.id!==stored.id) return current;
    const merged={...current};
    ['isDefault','enabled','boundCourseTypes','sortOrder','updatedBy','updatedAt','history'].forEach(key=>{merged[key]=stored[key]});
    return merged;
  });
  const replaceInLibrary=(preset)=>library.map(item=>item.id===preset.id?preset:item);
  const setAsDefault=(preset)=>{
    const next=setDefaultFramingPreset(library,preset?.id||'',{by:adminName});
    const stamped=next.find(item=>item.id===preset?.id);
    if(stamped) syncDraft(stamped);
    void commitLibrary(next,{message:preset?`已把「${preset.name}」设为默认模板：老师端没命中课程绑定时默认选中它`:'已取消默认模板'});
  };
  const clearDefault=()=>{
    const next=setDefaultFramingPreset(library,'',{by:adminName});
    const hit=next.find(item=>item.id===draft?.id);
    if(hit) syncDraft(hit);
    void commitLibrary(next,{message:'已取消默认模板：老师端会回落到排序里的第一套'});
  };
  const toggleEnabled=(preset)=>{
    if(!preset) return;
    const on=preset.enabled===false;
    const stamped=stampFramingPresetUpdate({...preset,enabled:on},{by:adminName,action:on?'启用模板':'停用模板'});
    syncDraft(stamped);
    void commitLibrary(replaceInLibrary(stamped),{message:on?`「${preset.name}」已启用，老师端即可选用`:`「${preset.name}」已停用：老师端不再出现，已产出的成品图不受影响`});
  };
  const toggleCourseBinding=(preset,courseId,courseName)=>{
    if(!preset) return;
    const bound=!(preset.boundCourseTypes||[]).includes(courseId);
    const stamped=bindFramingPresetCourse(preset,courseId,bound,{by:adminName,detail:courseName});
    syncDraft(stamped);
    void commitLibrary(replaceInLibrary(stamped),{
      message:bound?`已把「${preset.name}」绑定到「${courseName}」：这门课进入智能装裱时默认选中它`:`已解绑「${courseName}」：这门课改回默认模板`
    });
  };
  const move=(preset,delta)=>{
    if(!preset) return;
    const next=moveFramingPreset(library,preset.id,delta,{by:adminName});
    const hit=next.find(item=>item.id===preset.id);
    if(hit) syncDraft(hit);
    void commitLibrary(next,{message:`已调整「${preset.name}」的顺序：老师端样式网格按这个顺序排`});
  };
  const restoreBuiltins=()=>{
    // 恢复的内置样式排在最后（列表顺序是管理员维护的，别插回中间打乱它）。
    void commitLibrary(restoreMissingBuiltinFramingPresets(library),{message:`已恢复 ${missingBuiltins.length} 套内置样式，排在列表最后`});
  };
  // ---- 删除（US-011b）：先算引用范围，被引用的只允许停用 ------------------------------
  const requestRemove=(preset)=>{
    if(!preset) return;
    const verdict=framingPresetDeleteVerdict(preset,framingPresetUsage(preset,{presets:library,records}));
    setDeleteNotice(verdict.message);
    if(!verdict.allowed){ setConfirmDeleteId(''); setToast(verdict.message); return; }
    setConfirmDeleteId(preset.id);
  };
  const remove=async()=>{
    const target=library.find(item=>item.id===confirmDeleteId);
    if(!target) return;
    // [US-013] 删除也是写：不属于这一层的模板连删除都不允许（按钮侧已关闭，这里再拦一道）。
    if(auditDenied(target,'删除模板')){ setConfirmDeleteId(''); return; }
    const next=library.filter(item=>item.id!==target.id);
    setConfirmDeleteId('');
    setDeleteNotice('');
    setFramingPresets(next);
    setEditingId(next[0]?.id||'');
    setDraft(next[0]?{...next[0]}:null);
    try{ await deleteRemoteFramingPreset(target,adminFrameViewer); setToast(`装裱「${target.name}」已删除`); }
    catch{ setToast('已从本机移除，云端删除未成功。'); }
  };
  // 当前草稿能不能由这个会话写（界面据此关掉「保存到云端」与「删除」两个入口）。
  const draftWritable=Boolean(draft)&&!framingPresetWriteIssue(draft,adminFrameViewer);
  const draftWritableNote=Boolean(draft)&&!draftWritable?framingPresetWriteIssue(draft,adminFrameViewer):'';
  // 儿童素材的存储落点探测（[US-013] 第 4 条）：合规面板挂载时探一次开发适配器声明，
  // 不抛错（未启动时如实显示「未连接」）；探测结果只用于展示，上传侧的策略由服务层强制。
  useEffect(()=>{let active=true;probeChildMediaSink().then(result=>{if(active)setMediaSinkProbe(result)});return()=>{active=false}},[]);
  const auditStats=auditLogStats(auditLog);
  const recentAudit=(Array.isArray(auditLog)?auditLog:[]).slice(0,8);
  const storageRows=mediaStoragePolicyRows();

  return <>
    <PageHeader title="装裱设置" desc="后台维护装裱方案：新增一套样式只需填参数（不用改代码），可以设为默认模板、按课程绑定、启停与排序；被引用的模板只允许停用。" prd="PRD-11 / F-FRAME-ADM-01"
      actions={<Button icon={Plus} onClick={()=>{const next=createEmptyFramingPreset({by:adminName});setFramingPresets([...library,next]);setEditingId(next.id);setDeleteNotice('');setConfirmDeleteId('');}}>新增装裱</Button>}/>
    <div className="split-page framing-settings">
      <div className="panel persona-list">
        <div className="panel-head"><h2>装裱方案</h2><small data-frame-library-count={library.length}>{library.length} 套 · 默认 {defaultPreset?.name||'未设置'} · 可选 {selectableFramingPresets(library).length}</small></div>
        {library.map((preset,index)=>{const rowWritable=!framingPresetWriteIssue(preset,adminFrameViewer);return <div key={preset.id} className={`frame-library-row${preset.id===editingId?' active':''}`}
          data-frame-library-row={preset.id}
          data-frame-preset-default={preset.isDefault===true?'true':'false'}
          data-frame-preset-enabled={preset.enabled===false?'false':'true'}
          data-frame-preset-scope={preset.scope||'platform'}
          data-frame-preset-writable={rowWritable?'true':'false'}
          data-frame-preset-writer={framingPresetWriteOwnerText(preset)}
          data-frame-preset-order={index+1}>
          <button type="button" className="frame-library-pick" data-frame-library-pick={preset.id} onClick={()=>{setEditingId(preset.id);setDeleteNotice('');setConfirmDeleteId('')}}>
            <span className="frame-dot" style={{background:frameSpecView(preset.spec).outer||'#cfa52e'}}/>
            <div><b>{preset.name}</b><small>{preset.spec?.atmosphere||preset.description||'未生成参数'}</small></div>
            {preset.isDefault===true?<em className="frame-library-default" data-frame-default-badge="true">默认</em>:null}
            {rowWritable?null:<em className="frame-library-readonly" data-frame-library-readonly={preset.id} title={`由${framingPresetWriteOwnerText(preset)}维护`}>只读</em>}
            <em>{preset.builtin?'内置':preset.enabled===false?'已停用':'启用中'}</em>
          </button>
          {/* [US-013] 不属于当前会话那一层的模板（机构 / 老师个人）关掉写入口：本会话是平台管理员。 */}
          <div className="frame-library-ops">
            <button type="button" title="上移" disabled={index===0||!rowWritable} data-frame-move-up={preset.id} onClick={()=>move(preset,-1)}><ArrowUp size={13}/></button>
            <button type="button" title="下移" disabled={index===library.length-1||!rowWritable} data-frame-move-down={preset.id} onClick={()=>move(preset,1)}><ArrowDown size={13}/></button>
            <button type="button" title={rowWritable?(preset.enabled===false?'启用':'停用'):`由${framingPresetWriteOwnerText(preset)}维护`} disabled={!rowWritable} data-frame-enable-toggle={preset.id} onClick={()=>toggleEnabled(preset)}>{preset.enabled===false?'启用':'停用'}</button>
          </div>
        </div>})}
        {library.length?null:<p className="persona-empty">装裱方案还是空的：点右上角「新增装裱」建第一套（只填参数，不用改代码）。</p>}
        {missingBuiltins.length?<div className="frame-library-restore" data-frame-missing-builtins={missingBuiltins.length}>
          <span>内置样式库缺 {missingBuiltins.length} 套（{missingBuiltins.map(item=>item.name).join('、')}）</span>
          <button type="button" className="text-link" data-frame-restore-builtins={missingBuiltins.length} onClick={restoreBuiltins}>恢复内置样式库</button>
        </div>:null}
        <p className="persona-empty">删掉的内置样式不会自己回来（列表以本机镜像为准）；停用的模板不出现在老师端，历史成品图不受影响。</p>
      </div>
      <div className="panel persona-editor">
        {draft?<>
          <div className="panel-head" data-frame-draft-writable={draftWritable?'true':'false'} data-frame-draft-owner={framingPresetWriteOwnerText(draft)}>
            <div><h2>{draft.name||'未命名装裱'}</h2><p>描述需求 → 大模型给出参数 → 老师端按参数精确绘制。</p></div>
            <div className="row-actions">
              <button className="text-link" disabled={saving||!draftWritable} title={draftWritable?'':draftWritableNote} onClick={()=>commit(draft)}>{saving?'保存中…':'保存到云端'}</button>
              <button className="icon-btn danger-text" title={draftWritable?'删除':draftWritableNote} data-frame-delete={draft.id} disabled={!draftWritable} onClick={()=>requestRemove(draft)}><Trash2 size={16}/></button>
            </div>
          </div>
          {/* 不可写的模板在编辑区顶部说明「谁维护、为什么关掉了入口」（FR-44 的「其余角色只读」）。 */}
          {draftWritable?null:<p className="frame-preset-readonly" data-frame-draft-readonly="true"
            data-frame-draft-readonly-reason={draftWritableNote}>
            只读：{draftWritableNote}这套模板由{framingPresetWriteOwnerText(draft)}维护，本会话（{adminActor.roleLabel}）没有写入入口。
          </p>}
          {/* 模板的库级设置（US-011b）：默认标记 / 启停 / 最后变更 / 按课程绑定 / 变更历史 /
              引用范围与删除门槛。这几项点一下就生效（不经过「保存到云端」），
              但仍然走同一条变更记录口径。 */}
          <div className="frame-preset-admin" data-frame-preset-admin={draft.id}>
            <div className="frame-preset-admin-row">
              <div className="frame-preset-admin-item">
                <b>默认模板</b>
                <span data-frame-default-state={draftV2.isDefault?'default':'none'}>{draftV2.isDefault?'当前默认模板':'不是默认模板'}</span>
                {draftV2.isDefault
                  ?<button type="button" className="text-link" data-frame-default-clear="1" onClick={clearDefault}>取消默认</button>
                  :<button type="button" className="text-link" data-frame-default-set="1" onClick={()=>setAsDefault(draftV2)}>设为默认模板</button>}
              </div>
              <div className="frame-preset-admin-item">
                <b>老师端可选</b>
                <span data-frame-enabled-state={draftV2.enabled===false?'disabled':'enabled'}>{draftV2.enabled===false?'已停用':'启用中'}</span>
                <button type="button" className="text-link" data-frame-enabled-toggle-editor="1" onClick={()=>toggleEnabled(draftV2)}>{draftV2.enabled===false?'启用':'停用'}</button>
              </div>
              <div className="frame-preset-admin-item">
                <b>最后变更</b>
                <span data-frame-preset-updated={framingPresetUpdateText(draftV2)||'none'}>{framingPresetUpdateText(draftV2)||'还没有变更记录'}</span>
              </div>
            </div>
            <p className="frame-preset-usage" data-frame-preset-usage={framingPresetUsage(draftV2,{presets:library,records}).referenced?'referenced':'none'}>
              {framingPresetUsageText(draftV2,framingPresetUsage(draftV2,{presets:library,records}))}
            </p>
            <div className="frame-preset-courses" data-frame-preset-courses={draftV2.boundCourseTypes.length}>
              <div className="frame-preset-courses-head"><b>按课程绑定</b><small>{FRAMING_PRESET_COURSE_BINDING_NOTE}</small></div>
              {courseOptions.length?<div className="frame-preset-course-list">{courseOptions.map(course=>{
                const bound=draftV2.boundCourseTypes.includes(course.courseId);
                const conflicts=bound?[]:framingPresetCourseConflicts(library,course.courseId,{exceptId:draftV2.id});
                return <label key={course.courseId} className={bound?'is-bound':''} data-frame-course-row={course.courseId} data-frame-course-bound={bound?'true':'false'}>
                  <input type="checkbox" data-frame-bind-course={course.courseId} checked={bound} onChange={()=>toggleCourseBinding(draftV2,course.courseId,course.name)}/>
                  <span>{course.name}</span>
                  {bound?<em data-frame-course-bound-badge="1">已绑定本模板</em>:conflicts.length?<em className="is-warn" data-frame-course-conflict={conflicts[0].id}>已绑定「{conflicts[0].name}」</em>:null}
                </label>;
              })}</div>:<p className="persona-empty">课程库还没有可选课程，先去「课程库」建课。</p>}
            </div>
            <details className="frame-preset-history" data-frame-preset-history={framingPresetHistory(draftV2).length}>
              <summary data-frame-history-count={framingPresetHistory(draftV2).length}>变更历史（{framingPresetHistory(draftV2).length} 条）</summary>
              {framingPresetHistory(draftV2).length
                ?<ol>{framingPresetHistory(draftV2).map((entry,index)=><li key={`${entry.at}-${index}`} data-frame-history-entry={entry.action}>{framingPresetHistoryText(entry)}</li>)}</ol>
                :<p className="persona-empty">{FRAMING_PRESET_HISTORY_EMPTY}</p>}
            </details>
            {deleteNotice?<p className={confirmDeleteId?'frame-preset-admin-notice confirm':'frame-preset-admin-notice blocked'} data-frame-delete-notice={confirmDeleteId?'confirm':'blocked'}>{deleteNotice}</p>:null}
            {confirmDeleteId?<div className="frame-library-confirm-actions">
              <button type="button" className="text-link danger-text" data-frame-delete-confirm="1" onClick={()=>remove()}>确认删除</button>
              <button type="button" className="text-link" data-frame-delete-cancel="1" onClick={()=>{setConfirmDeleteId('');setDeleteNotice('')}}>取消</button>
            </div>:null}
            <p className="frame-library-note" data-frame-default-note="1">{FRAMING_PRESET_DEFAULT_NOTE}</p>
          </div>
          <div className="form-grid compact">
            <label>名称<input value={draft.name||''} onChange={event=>patch('name',event.target.value)}/></label>
            <label>展签人名<input value={draft.plaqueStudent||''} placeholder="留空则用学员姓名" onChange={event=>patch('plaqueStudent',event.target.value)}/></label>
            <label>作品名<input value={draft.plaqueTitle||''} placeholder="留空则不显示作品名" onChange={event=>patch('plaqueTitle',event.target.value)}/></label>
          </div>
          <label className="persona-field">装裱需求描述（自然语言）<textarea rows={3} data-frame-description="1" value={draft.description||''} onChange={event=>patch('description',event.target.value)} placeholder="例如：新中式水墨风，墨色细外框 + 米色纸纹卡纸，落款用深墨色小字，整体安静克制，适合水彩作品。"/><small>生成结果会填进 v2 参数（形状建议、水印位置建议至少都有），非法输出由 normalizeFrameSpecV2 收敛成默认值，不影响保存。</small></label>
          <div className="framing-generate">
            <Button icon={Sparkles} onClick={generate} disabled={generating||!draft.description}>{generating?'大模型正在设计…':'由大模型生成装裱参数'}</Button>
            <label className="framing-enable"><input type="checkbox" checked={draft.enabled!==false} onChange={event=>patch('enabled',event.target.checked)}/> 在老师端可选</label>
          </div>
          {/* 生成回执（US-011c）：模型给到的 v2 建议（形状 + 六类位置，读的是**收敛后**的生效值）
              与被收敛掉的非法枚举值。失败（云端不通 / 模型没吐 JSON）在这里给一句可读的话，
              草稿的 spec 不动、「保存到云端」也不受阻塞。 */}
          {generationReport?<div className={`framing-generation-report${generationReport.ok?'':' is-error'}`}
            data-frame-generation-report={generationReport.ok?'ok':'error'} data-frame-generation-model={generationReport.model||''}
            data-frame-suggestion-count={generationReport.ok?generationReport.suggestions.length:0}
            data-frame-converged-count={generationReport.ok?generationReport.converged.length:0}>
            {generationReport.ok?<>
              <b data-frame-generation-title="1">本次生成已应用到参数面板（模型 {generationReport.model}）：</b>
              <ul className="framing-generation-suggestions">{generationReport.suggestions.map(item=>
                <li key={item.path} data-frame-suggestion={item.path} data-frame-suggestion-value={item.value}>{item.label}：{item.text}</li>)}</ul>
              {generationReport.converged.length?<p className="framing-generation-converged" data-frame-converged-count={generationReport.converged.length}>
                模型输出有 {generationReport.converged.length} 处非法值，已按规则收敛：
                {generationReport.converged.map(item=><em key={item.path} data-frame-converged={item.path}>{item.label}「{item.from}」→「{item.text}」</em>)}
              </p>:null}
            </>:<p data-frame-generation-message="1">{generationReport.message}</p>}
          </div>:null}
          {/* 参数区（US-011a）：相框 / 卡纸 / 展签 / 水印 / 落款 / 时间六组。
              左侧每一个控件都带 `data-frame-param="<spec 路径>"`，右侧是实时预览 ——
              预览走的就是成品图那一支渲染函数（services/framePreview.js），改一个字段立刻重画一次。 */}
          <div className="framing-params" data-framing-params="1">
            <div className="framing-params-controls">
              <div className="framing-params-head">
                <div>
                  <h3>装裱参数</h3>
                  <p>改任何一个字段，右侧立刻用真实渲染函数重画一次；「保存到云端」后老师端在新会话里即可选用。</p>
                </div>
                <em className={panelMissing.length?'framing-coverage-bad':'framing-coverage-ok'}
                  data-panel-coverage={panelCoverage.covered} data-panel-missing={panelMissing.length}>
                  已覆盖 {panelCoverage.covered} / {panelCoverage.total} 个参数
                </em>
              </div>
              {panelMissing.length?<p className="framing-coverage-bad" data-panel-missing-list={panelMissing.join(',')}>面板还没有这些参数的控件：{panelMissing.join('、')}</p>:null}

              <div className="framing-overlay-block" data-framing-group="frame">
                <div className="framing-overlay-title">
                  <h3>相框</h3>
                  <small>形状只影响外框与卡纸的收边；作品像素只做等比缩放，不裁切、不调色。</small>
                </div>
                <div className="framing-overlay-controls">
                  <label>形状<select data-frame-param="frame.shape" value={frameCtl.shape}
                    onChange={event=>{
                      const shape=event.target.value;
                      const bump=shape==='rounded'&&!(Number(frameCtl.cornerRadiusRatio)>=FRAME_STYLE_MIN_VISIBLE_CORNER_RADIUS);
                      patchFrame({shape,...(bump?{cornerRadiusRatio:FRAME_STYLE_DEFAULT_CORNER_RADIUS}:{})});
                    }}>
                    {FRAME_STYLE_SHAPES.map(shape=><option key={shape.id} value={shape.id}>{shape.label}</option>)}
                  </select></label>
                  <label>框宽 %<input type="number" data-frame-param="frame.widthRatio" min="0.8" max="8" step="0.1"
                    value={Math.round((Number(frameCtl.widthRatio)||0)*1000)/10}
                    onChange={event=>patchFrame({widthRatio:Number(event.target.value)/100})}/></label>
                  <label>圆角半径 %<input type="number" data-frame-param="frame.cornerRadiusRatio" min="0" max="50" step="1"
                    value={Math.round((Number(frameCtl.cornerRadiusRatio)||0)*1000)/10}
                    onChange={event=>patchFrame({cornerRadiusRatio:Number(event.target.value)/100})}/></label>
                  <label>材质色<input type="color" data-frame-param="frame.color" value={frameCtl.color}
                    onChange={event=>patchFrame({color:event.target.value})}/></label>
                  <label>纹理<select data-frame-param="frame.texture" value={frameCtl.texture} onChange={event=>patchFrame({texture:event.target.value})}>
                    <option value="solid">纯色</option>
                  </select></label>
                </div>
                <div className="framing-overlay-controls">
                  <label className="framing-enable"><input type="checkbox" data-frame-lighting="1" checked={lightingOn}
                    onChange={event=>toggleFrameLighting(event.target.checked)}/> 相框光影</label>
                  <label>高光<input type="color" data-frame-param="frame.lighting.highlight" disabled={!lightingOn} value={frameCtl.lighting.highlight}
                    onChange={event=>patchFrame({lighting:{...frameCtl.lighting,highlight:event.target.value}})}/></label>
                  <label>暗部<input type="color" data-frame-param="frame.lighting.shadow" disabled={!lightingOn} value={frameCtl.lighting.shadow}
                    onChange={event=>patchFrame({lighting:{...frameCtl.lighting,shadow:event.target.value}})}/></label>
                  <label>角度<input type="number" data-frame-param="frame.lighting.angle" min="0" max="360" step="15" disabled={!lightingOn} value={frameCtl.lighting.angle}
                    onChange={event=>patchFrame({lighting:{...frameCtl.lighting,angle:Number(event.target.value)}})}/></label>
                </div>
                <p className="framing-overlay-note">光影关掉时写出去的相框分组里**没有** lighting 字段 —— 那是 v1 老模板的实色框，渲染逐像素不变（打开时用高光 + 本色 + 暗部的方向性渐变）。</p>
              </div>

              <div className="framing-overlay-block" data-framing-group="mat">
                <div className="framing-overlay-title">
                  <h3>卡纸</h3>
                  <small>关掉卡纸时作品区占满卡纸开口（相框直接收在作品边上）；细分隔线画在开口外沿。</small>
                </div>
                <div className="framing-overlay-controls">
                  <label className="framing-enable"><input type="checkbox" data-frame-param="mat.visible" checked={matCtl.visible!==false}
                    onChange={event=>patchMat({visible:event.target.checked})}/> 显示卡纸</label>
                  <label>卡纸色<input type="color" data-frame-param="mat.color" value={matCtl.color}
                    onChange={event=>patchMat({color:event.target.value})}/></label>
                  <label>卡纸宽 %<input type="number" data-frame-param="mat.widthRatio" min="2" max="12" step="0.1"
                    value={Math.round((Number(matCtl.widthRatio)||0)*1000)/10}
                    onChange={event=>patchMat({widthRatio:Number(event.target.value)/100})}/></label>
                  <label className="framing-enable"><input type="checkbox" data-frame-matline="1" checked={!!matCtl.innerLine}
                    onChange={event=>patchMat({innerLine:event.target.checked?(matCtl.innerLine||'#8C8578'):null})}/> 细分隔线</label>
                  <label>分隔线色<input type="color" data-frame-param="mat.innerLine" disabled={!matCtl.innerLine} value={matCtl.innerLine||'#8C8578'}
                    onChange={event=>patchMat({innerLine:event.target.value})}/></label>
                </div>
              </div>

              <div className="framing-overlay-block" data-framing-group="plaque">
                <div className="framing-overlay-title">
                  <h3>展签</h3>
                  <small>展签上的学员名 / 作品名取上面「展签人名 / 作品名」两项；日期取<b>本次课次日期</b>（lesson.lessonDate），这里只管日期格式、开关、样式与位置。</small>
                </div>
                <div className="framing-overlay-controls">
                  <label className="framing-enable"><input type="checkbox" data-frame-param="plaque.visible" checked={plaqueCtl.visible!==false}
                    onChange={event=>patchPlaque({visible:event.target.checked})}/> 显示展签</label>
                  <label>位置<select data-frame-param="plaque.position" value={plaqueCtl.position}
                    onChange={event=>patchPlaque({position:event.target.value})}>
                    <option value="bottom">贴在作品区下方</option>
                    <option value="top">贴在作品区上方</option>
                  </select></label>
                  <label>日期格式<select data-frame-param="plaque.dateFormat" value={plaqueCtl.dateFormat}
                    onChange={event=>patchPlaque({dateFormat:event.target.value})}>
                    {DATE_FORMATS.map(format=><option key={format} value={format}>{format}</option>)}
                  </select></label>
                  <label>底色<input type="color" data-frame-param="plaque.bg" value={plaqueCtl.bg}
                    onChange={event=>patchPlaque({bg:event.target.value})}/></label>
                  <label>文字色<input type="color" data-frame-param="plaque.text" value={plaqueCtl.text}
                    onChange={event=>patchPlaque({text:event.target.value})}/></label>
                  <label>字体<select data-frame-param="plaque.fontFamily" value={plaqueCtl.fontFamily}
                    onChange={event=>patchPlaque({fontFamily:event.target.value})}>
                    {FRAMING_FONT_WHITELIST.map(font=><option key={font} value={font}>{font}</option>)}
                  </select></label>
                  <label>字距<input type="number" data-frame-param="plaque.letterSpacing" min="0" max="8" step="1" value={plaqueCtl.letterSpacing}
                    onChange={event=>patchPlaque({letterSpacing:Number(event.target.value)})}/></label>
                </div>
              </div>
            </div>

            <aside className="framing-params-preview">
              <div className="framing-preview" data-preview-state={preview?'ready':'pending'}>
                {preview?<img src={preview} alt={`${draft.name||'装裱'}预览`}/>:<div className="framing-preview-pending">正在渲染预览…</div>}
                <small>预览使用占位作品（{FRAME_PREVIEW_ARTWORK_SIZE.width}×{FRAME_PREVIEW_ARTWORK_SIZE.height}），渲染走的是老师端成品图同一个函数；实际渲染时替换为学员作品。</small>
              </div>
              {draftSpec&&(draftSpec.atmosphere||draftSpec.rationale)?<div className="framing-preview-notes">
                {draftSpec.atmosphere?<p className="spec-note">氛围：{draftSpec.atmosphere}</p>:null}
                {draftSpec.rationale?<p className="spec-note">理由：{draftSpec.rationale}</p>:null}
              </div>:null}
              {coverage&&coverage.items.length?<em className={coverage.exceeds?'framing-coverage-bad':'framing-coverage-ok'} data-coverage-ratio={coverage.coveredRatio.toFixed(4)}>{coverage.summary}</em>:null}
              {coverage&&coverage.items.length?<em className={coverage.exceeds?'framing-coverage-bad':'framing-coverage-ok'} data-coverage-ratio={coverage.coveredRatio.toFixed(4)}>{coverage.summary}</em>:null}
            </aside>
          </div>
          {draft.spec?null:<p className="persona-empty">这套模板还没有装裱参数，下面各个参数用的是默认值；写好需求描述后也可以点「由大模型生成装裱参数」。</p>}
          {/* 水印（US-003b）：机构 Logo + 文字水印 + 二维码。三项都画在成品图最上层，
              位置与尺寸走 overlayLayout 的九宫格 + 短边比例，与老师端成品图是同一套规则。 */}
          <div className="framing-overlay">
            <div className="framing-overlay-head">
              <div>
                <h3>水印</h3>
                <p>叠加元素画在成品图最上层；位置用九宫格，尺寸用「相对画布短边的比例」，所以换更大尺寸的作品也跑不出格子。</p>
              </div>
              {coverage&&coverage.items.length?<em className={coverage.exceeds?'framing-coverage-bad':'framing-coverage-ok'} data-coverage-ratio={coverage.coveredRatio.toFixed(4)}>{coverage.summary}</em>:null}
            </div>
            {coverage&&coverage.exceeds?<p className="framing-coverage-bad" data-coverage-warning="1">{coverage.message}</p>:null}

            <div className="framing-overlay-block">
              <div className="framing-overlay-title">
                <label className="framing-enable"><input type="checkbox" data-frame-param="watermark.logo.visible" checked={logoWatermark.visible}
                  onChange={event=>patchWatermark({logo:{...logoWatermark,visible:event.target.checked}})}/> 机构 Logo</label>
                <small>{logoWatermark.visible?'老师端成品图会盖上机构 Logo':'关闭时完全不绘制，不留空白占位'}</small>
              </div>
              <div className="framing-overlay-row">
                <input ref={logoInput} type="file" accept="image/png,image/jpeg" hidden
                  onChange={event=>{const file=event.target.files&&event.target.files[0];event.target.value='';if(file)uploadLogo(file)}}/>
                <Button icon={UploadCloud} data-frame-param="watermark.logo.url" onClick={()=>{if(logoInput.current)logoInput.current.click()}} disabled={logoBusy}>{logoBusy?'读取中…':'上传 Logo'}</Button>
                {logoWatermark.url?<img className="framing-asset-thumb" src={logoWatermark.url} alt="机构 Logo 缩略图"/>:<em className="framing-asset-empty">还没有 Logo</em>}
                {logoWatermark.url?<button type="button" className="text-link" onClick={removeLogo}>移除</button>:null}
              </div>
              <p className="framing-asset-rules">上传要求：{framingAssetRulesText()}{logoInfo&&logoInfo.ok?`（当前 ${logoInfo.width}×${logoInfo.height}）`:''}</p>
              {assetError?<p className="framing-asset-error">{assetError}</p>:null}
              {!assetError&&logoInfo&&!logoInfo.ok?<p className="framing-asset-error">{logoInfo.message}</p>:null}
              <div className="framing-overlay-controls">
                <div className="framing-overlay-field"><span>位置</span>
                  <OverlayPositionPad label="机构 Logo" dataParam="watermark.logo.position" value={logoWatermark.position} onChange={position=>patchWatermark({logo:{...logoWatermark,position}})}/>
                </div>
                <label>宽度 %<input type="number" data-frame-param="watermark.logo.widthRatio" min="2" max="40" step="1" value={Number((logoWatermark.widthRatio*100).toFixed(2))}
                  onChange={event=>patchWatermark({logo:{...logoWatermark,widthRatio:Number(event.target.value)/100}})}/></label>
                <label>透明度 %<input type="number" data-frame-param="watermark.logo.opacity" min="0" max="100" step="5" value={Math.round(logoWatermark.opacity*100)}
                  onChange={event=>patchWatermark({logo:{...logoWatermark,opacity:Number(event.target.value)/100}})}/></label>
                {offsetInputs('watermark.logo')}
              </div>
              <p className="framing-overlay-note">偏移（offsetX / offsetY）是模板上的全局默认值，老师端的水印面板（US-007）仍可在此基础上继续微调。</p>
            </div>

            <div className="framing-overlay-block">
              <div className="framing-overlay-title">
                <label className="framing-enable"><input type="checkbox" data-frame-param="watermark.text.visible" checked={textWatermark.visible}
                  onChange={event=>patchWatermark({text:{...textWatermark,visible:event.target.checked}})}/> 文字水印</label>
                <small>可用变量：{'{机构名}{学员名}{作品名}{老师姓名}{课次日期}'}</small>
              </div>
              <div className="framing-overlay-controls">
                <label className="wide">内容<input data-frame-param="watermark.text.content" value={textWatermark.content}
                  onChange={event=>patchWatermark({text:{...textWatermark,content:event.target.value}})}/></label>
              </div>
              <div className="framing-overlay-controls">
                <label>字体<select data-frame-param="watermark.text.fontFamily" value={textWatermark.fontFamily} onChange={event=>patchWatermark({text:{...textWatermark,fontFamily:event.target.value}})}>
                  {FRAMING_FONT_WHITELIST.map(font=><option key={font} value={font}>{font}</option>)}
                </select></label>
                <label>字号 px<input type="number" data-frame-param="watermark.text.fontSize" min="8" max="200" step="1" value={textWatermark.fontSize}
                  onChange={event=>patchWatermark({text:{...textWatermark,fontSize:Number(event.target.value)}})}/></label>
                <label>颜色<input type="color" data-frame-param="watermark.text.color" value={textWatermark.color}
                  onChange={event=>patchWatermark({text:{...textWatermark,color:event.target.value}})}/></label>
                <label>透明度 %<input type="number" data-frame-param="watermark.text.opacity" min="0" max="100" step="5" value={Math.round(textWatermark.opacity*100)}
                  onChange={event=>patchWatermark({text:{...textWatermark,opacity:Number(event.target.value)/100}})}/></label>
                <label>旋转 度<input type="number" data-frame-param="watermark.text.rotateDeg" min="-180" max="180" step="5" value={textWatermark.rotateDeg}
                  onChange={event=>patchWatermark({text:{...textWatermark,rotateDeg:Number(event.target.value)}})}/></label>
                <div className="framing-overlay-field"><span>位置</span>
                  <OverlayPositionPad label="文字水印" dataParam="watermark.text.position" value={textWatermark.position} onChange={position=>patchWatermark({text:{...textWatermark,position}})}/>
                </div>
                {offsetInputs('watermark.text')}
              </div>
              <p className="framing-overlay-note">字体限后台白名单；渲染时会按变量替换内容，未命中的变量保留原文。</p>
            </div>

            {/* 落款（US-003c）：文字（姓名 + 寄语）或手写签名图，另含可选印章（方形 / 圆形文字章）。
                变量与位置口径与水印完全一致 —— 九宫格 + 短边比例，别再写第二套定位。 */}
            <div className="framing-overlay-block">
              <div className="framing-overlay-title">
                <label className="framing-enable"><input type="checkbox" data-frame-param="signature.visible" checked={signatureMark.visible}
                  onChange={event=>patchSignature({visible:event.target.checked})}/> 落款</label>
                <small>可用变量：{'{老师姓名}{机构名}{学员名}{作品名}{课次日期}'}</small>
              </div>
              <div className="framing-overlay-controls">
                <label>形式<select data-frame-param="signature.mode" value={signatureMark.mode} onChange={event=>patchSignature({mode:event.target.value})}>
                  <option value="text">文字落款</option>
                  <option value="image">手写签名图</option>
                </select></label>
                <label className="wide">姓名 / 落款文字<input data-frame-param="signature.teacherName" value={signatureMark.teacherName}
                  onChange={event=>patchSignature({teacherName:event.target.value})}/></label>
              </div>
              <div className="framing-overlay-controls">
                <label className="wide">寄语（可空）<input data-frame-param="signature.message" value={signatureMark.message} maxLength={60} placeholder="例如：继续用画笔讲你的故事"
                  onChange={event=>patchSignature({message:event.target.value})}/></label>
              </div>
              {/* 签名图行**始终渲染**（形式选「文字落款」时它照样在，只是不参与绘制）：
                  参数面板的覆盖率是「v2 的每个参数都有控件」，条件渲染会让 `signature.imageUrl`
                  在文字模式下整支消失 —— 面板上看不到自己的签名图是不是还在。 */}
              <div className="framing-overlay-row">
                <input ref={signatureInput} type="file" accept="image/png,image/jpeg" hidden
                  onChange={event=>{const file=event.target.files&&event.target.files[0];event.target.value='';if(file)uploadSignature(file)}}/>
                <Button icon={UploadCloud} data-frame-param="signature.imageUrl" onClick={()=>{if(signatureInput.current)signatureInput.current.click()}} disabled={signatureBusy}>{signatureBusy?'读取中…':'上传签名图'}</Button>
                {signatureMark.imageUrl?<img className="framing-asset-thumb" src={signatureMark.imageUrl} alt="手写签名图缩略图"/>:<em className="framing-asset-empty">还没有签名图，没有图时整支不绘制</em>}
                {signatureMark.imageUrl?<button type="button" className="text-link" onClick={removeSignature}>移除</button>:null}
              </div>
              <p className="framing-asset-rules">上传要求：{framingAssetRulesText()}（当前：{signatureInfo&&signatureInfo.ok?`${signatureInfo.width}×${signatureInfo.height}`:'待复核'}）{signatureMark.mode==='image'?'' :'；当前形式是文字落款，签名图不会被画上。'}</p>
              {signatureError?<p className="framing-asset-error">{signatureError}</p>:null}
              {!signatureError&&signatureInfo&&!signatureInfo.ok?<p className="framing-asset-error">{signatureInfo.message}</p>:null}
              <div className="framing-overlay-controls">
                <label>字体<select data-frame-param="signature.fontFamily" value={signatureMark.fontFamily} onChange={event=>patchSignature({fontFamily:event.target.value})}>
                  {FRAMING_FONT_WHITELIST.map(font=><option key={font} value={font}>{font}</option>)}
                </select></label>
                <label>字号 px<input type="number" data-frame-param="signature.fontSize" min="8" max="200" step="1" value={signatureMark.fontSize}
                  onChange={event=>patchSignature({fontSize:Number(event.target.value)})}/></label>
                <label>颜色<input type="color" data-frame-param="signature.color" value={signatureMark.color}
                  onChange={event=>patchSignature({color:event.target.value})}/></label>
                <label>签名图宽度 %<input type="number" data-frame-param="signature.imageWidthRatio" min="2" max="40" step="1" value={Number(((signatureMark.imageWidthRatio||0)*100).toFixed(2))}
                  onChange={event=>patchSignature({imageWidthRatio:Number(event.target.value)/100})}/></label>
                <div className="framing-overlay-field"><span>位置</span>
                  <OverlayPositionPad label="落款" dataParam="signature.position" value={signatureMark.position} onChange={position=>patchSignature({position})}/>
                </div>
                {offsetInputs('signature')}
              </div>
              <div className="framing-overlay-controls">
                <label className="framing-enable"><input type="checkbox" data-frame-param="signature.seal.visible" checked={signatureMark.seal.visible}
                  onChange={event=>patchSeal({visible:event.target.checked})}/> 印章</label>
                <label>印文<input data-frame-param="signature.seal.text" value={signatureMark.seal.text} maxLength={4} placeholder="4 字以内"
                  onChange={event=>patchSeal({text:event.target.value})}/></label>
                <label>形状<select data-frame-param="signature.seal.shape" value={signatureMark.seal.shape} onChange={event=>patchSeal({shape:event.target.value})}>
                  {SEAL_SHAPES.map(shape=><option key={shape} value={shape}>{shape==='round'?'圆形章':'方形章'}</option>)}
                </select></label>
                <label>颜色<input type="color" data-frame-param="signature.seal.color" value={signatureMark.seal.color}
                  onChange={event=>patchSeal({color:event.target.value})}/></label>
              </div>
              <p className="framing-overlay-note">印章贴在落款块内侧（贴左的落款章在右边）；文字模式按「姓名在上、寄语在下」排两行，图片模式按签名图原比例缩放、不拉伸。</p>
            </div>

            {/* 时间（US-003c）：来源 / 格式 / 前缀 / 位置。默认取本次课次日期（PRD 原文）。 */}
            <div className="framing-overlay-block">
              <div className="framing-overlay-title">
                <label className="framing-enable"><input type="checkbox" data-frame-param="date.visible" checked={dateMark.visible}
                  onChange={event=>patchDate({visible:event.target.checked})}/> 时间</label>
                <small>默认取本次课次日期（lesson.lessonDate），补录上周的课次也会跟着显示上周的日期</small>
              </div>
              <div className="framing-overlay-controls">
                <label>来源<select data-frame-param="date.source" value={dateMark.source} onChange={event=>patchDate({source:event.target.value})}>
                  {DATE_SOURCES.map(source=><option key={source} value={source}>{DATE_SOURCE_LABELS[source]}</option>)}
                </select></label>
                <label>格式<select data-frame-param="date.format" value={dateMark.format} onChange={event=>patchDate({format:event.target.value})}>
                  {DATE_FORMATS.map(format=><option key={format} value={format}>{format}</option>)}
                </select></label>
                <label>前缀<input data-frame-param="date.prefix" value={dateMark.prefix} maxLength={12} placeholder="例如 创作于 "
                  onChange={event=>patchDate({prefix:event.target.value})}/></label>
                <label>手填日期<input data-frame-param="date.manualValue" value={dateMark.manualValue} placeholder={dateMark.source==='manual'?'来源为「手动填写」时用这里的值':'仅「手动填写」时生效'}
                  onChange={event=>patchDate({manualValue:event.target.value})}/></label>
              </div>
              <div className="framing-overlay-controls">
                <label>字号 px<input type="number" data-frame-param="date.fontSize" min="8" max="200" step="1" value={dateMark.fontSize}
                  onChange={event=>patchDate({fontSize:Number(event.target.value)})}/></label>
                <label>颜色<input type="color" data-frame-param="date.color" value={dateMark.color}
                  onChange={event=>patchDate({color:event.target.value})}/></label>
                <div className="framing-overlay-field"><span>位置</span>
                  <OverlayPositionPad label="时间" dataParam="date.position" value={dateMark.position} onChange={position=>patchDate({position})}/>
                </div>
                {offsetInputs('date')}
              </div>
              <p className="framing-overlay-note">认不出来的手填值会原样输出（例如「上周三」），不会编造日期。</p>
            </div>

            {/* 二维码（US-003c）：**内容由后台配置**（FR-23），老师端不能填任意 URL。 */}
            <div className="framing-overlay-block">
              <div className="framing-overlay-title">
                <label className="framing-enable"><input type="checkbox" data-frame-param="watermark.qr.visible" checked={qrWatermark.visible}
                  onChange={event=>patchQr({visible:event.target.checked})}/> 二维码</label>
                <small>{qrTargetRulesText()}</small>
              </div>
              <div className="framing-overlay-controls">
                <label>目标<select data-frame-param="watermark.qr.target" value={qrWatermark.target} onChange={event=>patchQr({target:event.target.value})}>
                  {QR_TARGETS.map(target=><option key={target.key} value={target.key}>{target.label}</option>)}
                </select></label>
                <label className="wide">说明文字<input data-frame-param="watermark.qr.caption" value={qrWatermark.caption}
                  onChange={event=>patchQr({caption:event.target.value})}/></label>
              </div>
              <p className="framing-overlay-note" data-qr-url={qrResolved.url}>
                {qrTargetSummary(qrWatermark.target)}（{qrBytes} 字节 / 纠错等级 {QR_DEFAULT_ECC} / 版本 {qrVersion||`超过 ${QR_MAX_VERSION}`}）
                {qrVersion?null:'：链接过长，二维码不会绘制，请改用更短的目标'}
              </p>
              <div className="framing-overlay-controls">
                <label>尺寸 %<input type="number" data-frame-param="watermark.qr.sizeRatio" min="3" max="25" step="1" value={Number(((qrWatermark.sizeRatio||0)*100).toFixed(2))}
                  onChange={event=>patchQr({sizeRatio:Number(event.target.value)/100})}/></label>
                <div className="framing-overlay-field"><span>位置</span>
                  <OverlayPositionPad label="二维码" dataParam="watermark.qr.position" value={qrWatermark.position} onChange={position=>patchQr({position})}/>
                </div>
                {offsetInputs('watermark.qr')}
              </div>
              <p className="framing-overlay-note">二维码会自动铺一块带静区的白底（否则落在卡纸底色上扫不出来），说明文字排在白底外侧。</p>
            </div>
          </div>
        </>:<p className="persona-empty">选择左侧的一套装裱，或新增一套。</p>}
      </div>
    </div>
    {/* 合规面板（[第二步 US-013]）：模板写权限矩阵 + 审计日志 + 儿童素材存储策略。
        三块都读同一份零依赖规则（`data/framingPermissions` / `data/auditLog` / `data/mediaStoragePolicy`），
        与管理端动作、服务层校验共用一份判据 —— 界面上写的「谁能写」就是服务层真正放行的那些角色。 */}
    <section className="panel compliance-panel" data-compliance-panel="true"
      data-compliance-actor={adminActor.actorId} data-compliance-actor-role={adminActor.role}
      data-compliance-summary={FRAMING_PERMISSION_SUMMARY}>
      <div className="panel-head">
        <div>
          <h2>权限与合规</h2>
          <p>{FRAMING_PERMISSION_SUMMARY}</p>
        </div>
        <em className="compliance-actor" data-compliance-actor-label={adminActor.roleLabel}>当前会话：{adminActor.actorName}（{adminActor.roleLabel}）</em>
      </div>
      <div className="compliance-grid">
        <div className="compliance-block" data-compliance-matrix="true">
          <h3>模板写权限</h3>
          <ul className="compliance-matrix">
            {adminPermissionRows.map(row=><li key={row.scope} data-compliance-scope={row.scope}
              data-compliance-scope-label={row.label}
              data-compliance-writer-role={row.writerRole}
              data-compliance-writer={row.writer}
              data-compliance-readable-by={row.readers}
              data-compliance-allowed={row.allowed?'true':'false'}>
              <b>{row.label}</b>
              <span>可写：{row.writer}</span>
              <small>{row.note}其他角色（{row.readers}）只读。</small>
              <em className={row.allowed?'ok':'muted'} data-compliance-verdict={row.allowed?'allowed':'readonly'}>{row.allowed?'本会话可写':'本会话只读'}</em>
            </li>)}
          </ul>
          <p className="compliance-note">
            写入在服务层再拦一道：services/framingPresetsApi.js 的保存 / 删除都会校验 scope 与操作人，
            越权写入直接抛 403（FramingPresetWriteError），不会先落库再发现。
          </p>
        </div>
        <div className="compliance-block" data-compliance-audit="true" data-audit-log-count={auditStats.total}>
          <h3>审计日志</h3>
          <p className="compliance-note">
            留痕的动作：{AUDIT_ACTION_LABELS[AUDIT_ACTIONS.templateSave]}、{AUDIT_ACTION_LABELS[AUDIT_ACTIONS.artworkSave]}，
            以及管理端观察词 AI 补充的三条（{AUDIT_ACTION_LABELS[AUDIT_ACTIONS.keywordCandidates]} / {AUDIT_ACTION_LABELS[AUDIT_ACTIONS.keywordAdopt]} / {AUDIT_ACTION_LABELS[AUDIT_ACTIONS.keywordDiscard]}）；
            每条记下操作人 / 学员 id / 时间 / 模板 id。共 {auditStats.total} 条（被拒绝的写入 {auditStats.denied} 条）。
          </p>
          {recentAudit.length?<ul className="compliance-audit">
            {recentAudit.map(entry=><li key={entry.id} data-audit-entry={entry.id}
              data-audit-entry-action={entry.action}
              data-audit-entry-outcome={entry.outcome}
              data-audit-entry-actor={entry.actorId}
              data-audit-entry-student={entry.studentId}
              data-audit-entry-template={entry.templateId}
              data-audit-entry-at={entry.at}
              data-audit-entry-missing={auditEntryMissingFields(entry).join(',')}>
              <b>{auditEntryText(entry)}</b>
              <small>{auditTraceText(entry)}</small>
              {/* detail 是「这一次具体做了什么」：观察词 AI 补充的「采纳了哪些词」就在这一行里
                  （US-111 验收点名要能从留痕里读出采纳的词）。 */}
              {entry.detail?<small className="compliance-audit-detail" data-audit-entry-detail={entry.detail}>{entry.detail}</small>:null}
              {entry.outcome==='denied'?<em className="denied">被拒绝</em>:null}
            </li>)}
          </ul>:<p className="persona-empty" data-audit-log-empty="true">{AUDIT_LOG_EMPTY_TEXT}</p>}
        </div>
        <div className="compliance-block" data-media-storage-policy="true"
          data-media-storage-auth={`${CHILD_MEDIA_UPLOAD_AUTH.roleHeader}=${CHILD_MEDIA_UPLOAD_AUTH.requiredRole} · ${CHILD_MEDIA_UPLOAD_AUTH.consentHeader}=${CHILD_MEDIA_UPLOAD_AUTH.requiredConsent}`}
          data-media-storage-probe-state={mediaSinkProbe?(mediaSinkProbe.ok?'ok':(mediaSinkProbe.reachable?'blocked':'unreachable')):'pending'}
          data-media-storage-probe-sink={mediaSinkProbe?.sinkId||''}
          data-media-storage-probe-declared={mediaSinkProbe?.declared||''}>
          <h3>儿童素材存储</h3>
          <p className="compliance-note">{MEDIA_STORAGE_POLICY_SUMMARY}</p>
          <ul className="compliance-matrix">
            {storageRows.map(row=><li key={row.id} data-media-sink={row.id} data-media-sink-allowed={row.allowed?'true':'false'}>
              <b>{row.label}</b>
              <em className={row.allowed?'ok':'muted'} data-media-sink-verdict={row.allowed?'allowed':'forbidden'}>{row.allowed?'允许':'禁止'}</em>
              <small>{row.note}</small>
            </li>)}
          </ul>
          <p className="compliance-note" data-media-storage-credential={MEDIA_STORAGE_CREDENTIAL_NOTE}>{MEDIA_STORAGE_CREDENTIAL_NOTE}</p>
          <p className={`compliance-probe is-${mediaSinkProbe?(mediaSinkProbe.ok?'ok':(mediaSinkProbe.reachable?'blocked':'unreachable')):'pending'}`} data-media-storage-probe={mediaSinkProbe?.note||'正在探测开发适配器声明的落点…'}>
            {mediaSinkProbe
              ? `开发适配器（${CHILD_MEDIA_API_BASE}）：${mediaSinkProbe.reachable?`声明的落点 ${mediaSinkProbe.declared} → ${mediaSinkProbe.sinkLabel}`:'未连接'}。${mediaSinkProbe.note}`
              : '正在探测开发适配器声明的落点…'}
          </p>
        </div>
      </div>
    </section>
  </>;
}

// 机构级基础数据页：只有管理员能进。导航已经隐藏入口，这里再拦一道，
// 避免从导览页、历史链接或未来新增入口绕过。
const ADMIN_ONLY_PAGES=['teacherPersona','skillLibrary','courseLibrary','keywordTemplates','agentFiles','framingSettings','galleryAdmin'];

function PageRouter(props){
 // 「课次表单」全站只有一份实现：`TeacherFlowV2`（第一步创建信息 / 后续装裱·点评·归档都在这个组件里）。
 // 旧的 CreateFlow 向导（StepLesson/StepUpload/StepApps/StepGenerate/StepSuccess）已删除，
 // `create` 这个路由 id 保留下来只作为别名，供工作台 / 课后反馈列表 / AI 创作台的历史入口复用同一组件。
 const map={dashboard:TeacherWelcome,teacherFlow:TeacherFlowV2,create:TeacherFlowV2,lessons:LessonsPage,ai:TeacherAIWorkspace,tasks:TasksPage,progress:ProgressBoard,classes:StudentArchiveData,growthCenter:PersonalGrowthCenter,archives:GrowthArchiveData,parent:ParentHomeFamily,parentInsight:ParentInsight,parentArchive:ParentArchiveFamily,authorization:AuthorizationPage,profile:ProfilePage,adminDash:AdminDashboard,apps:AppsPage,providers:ProvidersPage,teacherPersona:TeacherPersonaPage,skillLibrary:SkillLibraryPage,courseLibrary:CourseLibraryPage,keywordTemplates:KeywordTemplatesPage,agentFiles:AgentFilesPage,framingSettings:FramingSettingsPage,galleryAdmin:GalleryAdminPage,gallery:GalleryPage,users:UsersPage,logs:LogsPage,archiveAdmin:ArchiveAdmin,permissions:PermissionsPage,settings:SettingsPage,guide:GuidePage};
 if(ADMIN_ONLY_PAGES.includes(props.page)&&props.role!=='admin'){
   const Fallback=props.role==='parent'?ParentHomeFamily:TeacherWelcome;
   return <Fallback {...props}/>;
 }
 const C=map[props.page]||NotFound; return <C {...props}/>;
}

function AIAppCard({app,onClick,admin=false,onToggle,onUninstall}){const Icon=app.icon;return <div className="app-card"><div className={`app-icon ${app.color}`}><Icon/></div><div className="app-copy"><h3>{app.name}</h3><p>{app.desc}</p>{admin?<small>v{app.version}</small>:null}</div>{admin?<div className="app-admin-actions"><Status value={app.status==='enabled'?'已启用':'已停用'}/><button className="icon-btn" onClick={onToggle} title="启停"><RefreshCw size={16}/></button><button className="icon-btn danger-text" onClick={onUninstall} title="卸载"><Trash2 size={16}/></button></div>:<button className="circle-go" onClick={onClick}><ArrowRight size={17}/></button>}</div>}

function TaskTable({tasks,onView,title='生成任务'}){return <section className="panel table-panel"><div className="panel-head"><h2>{title}</h2><button className="text-link" onClick={onView}>查看全部</button></div><div className="table-scroll"><table><thead><tr><th>任务</th><th>对象</th><th>AI 应用</th><th>实际模型</th><th>状态</th><th>耗时/进度</th><th></th></tr></thead><tbody>{tasks.map(t=><tr key={t.id}><td><b>{t.title}</b><small>{t.id}</small></td><td>{t.student}</td><td>{t.app}</td><td>{t.model}</td><td><Status value={t.status}/></td><td>{t.time}</td><td><button className="icon-btn"><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table></div></section>}

function LessonsPage({navigate,demoState,setDemoState}){const lessons=[['08 月 04 日','梵高的向日葵','周六创意绘画 2 班','18/18','待制作'],['08 月 03 日','色彩的情绪','色彩启蒙班','12/12','已发布'],['08 月 02 日','城市线描','大师创想班','14/15','已发布'],['07 月 27 日','海底世界','周六创意绘画 2 班','18/18','已归档']];return <><PageHeader title="课后反馈" desc="以课次为单位组织素材、AI 生成、审核发布和档案沉淀。" prd={PRD.lessons} actions={<Button icon={Plus} onClick={()=>navigate('create')}>新建课后反馈</Button>}/><DemoStateSwitch value={demoState} setValue={setDemoState}/>{demoState==='empty'?<EmptyState icon={BookOpen} title="还没有课后反馈" desc="创建第一节课次并上传作品后，就能体验完整 AI 工作流。" action="创建课后反馈" onClick={()=>navigate('create')}/>:demoState==='error'?<ErrorState onRetry={()=>setDemoState('normal')}/>:<div className="panel list-panel"><div className="filters"><div className="search-field"><Search size={16}/><input placeholder="搜索课程或班级"/></div><select><option>全部状态</option><option>待制作</option><option>已发布</option></select><select><option>全部班级</option><option>周六创意绘画 2 班</option></select></div>{lessons.map((l,i)=><button className="lesson-row" key={l[0]+l[1]} onClick={()=>i===0?navigate('create'):navigate('archives')}><div className="date-block"><b>{l[0].split(' ')[2]}</b><span>{l[0].slice(0,5)}</span></div><div className="lesson-main"><b>{l[1]}</b><span>{l[2]}</span></div><span>{l[3]} 人已关联</span><Status value={l[4]}/><ArrowRight size={18}/></button>)}</div>}</>}

function DemoStateSwitch({value,setValue}){return <div className="state-switch"><span>状态预览</span>{[['normal','正常'],['empty','空状态'],['error','错误']].map(([k,v])=><button className={value===k?'active':''} key={k} onClick={()=>setValue(k)}>{v}</button>)}</div>}
function EmptyState({icon:Icon,title,desc,action,onClick}){return <div className="empty"><span><Icon size={30}/></span><h2>{title}</h2><p>{desc}</p>{action?<Button onClick={onClick}>{action}</Button>:null}</div>}
function ErrorState({onRetry}){return <div className="empty error-state"><span><CircleAlert size={30}/></span><h2>加载失败</h2><p>网络似乎开了小差，数据没有成功返回。</p><Button icon={RefreshCw} onClick={onRetry}>重新加载</Button></div>}

function AIStudio({navigate}){return <><PageHeader title="AI 创作台" desc="单独使用 AI 应用，或从课后反馈工作流批量调用。" prd={PRD.ai} actions={<Button icon={Plus} onClick={()=>navigate('create')}>组合工作流</Button>}/><div className="ai-hero"><div><h2>让作品呈现更专业，<br/>让反馈表达更有温度。</h2><p>所有任务均通过已启用模型池调用，结果保留生成血缘与成本记录。</p></div><span><Sparkles/></span></div><div className="app-grid">{aiAppsSeed.map(a=><AIAppCard key={a.id} app={a} onClick={()=>navigate('create')}/>)}</div><section className="panel prompt-panel"><div><h2>快速体验：智能点评</h2><p>上传作品并补充教学目标，AI 会生成可编辑的点评草稿。</p></div><div className="quick-form"><label>评价对象<select><option>个人点评 · 陈一诺</option><option>班级点评 · 周六 2 班</option></select></label><label>老师观察<textarea placeholder="例如：今天主动尝试了冷暖色对比……"/></label><Button onClick={()=>navigate('create')} icon={WandSparkles}>进入完整体验</Button></div></section></>}
function TasksPage({tasks,demoState,setDemoState}){return <><PageHeader title="生成任务" desc="查看 AI 任务、实际模型、进度、重试和降级链路。" prd={PRD.tasks}/><DemoStateSwitch value={demoState} setValue={setDemoState}/>{demoState==='empty'?<EmptyState icon={Clock3} title="暂无生成任务" desc="提交 AI 创作后，任务进度会显示在这里。"/>:demoState==='error'?<ErrorState onRetry={()=>setDemoState('normal')}/>:<><div className="filters"><div className="search-field"><Search size={16}/><input placeholder="搜索任务 ID 或标题"/></div><select><option>全部应用</option><option>作品智能装裱</option><option>AI 生视频</option></select><select><option>全部状态</option><option>成功</option><option>生成中</option></select></div><TaskTable tasks={tasks} title="全部任务"/></>}</>}
function ClassesPage(){const students=['陈一诺','林小满','赵禾','周子墨','苏西','陆一白'];return <><PageHeader title="班级与学员" desc="管理老师可访问的班级、学员、家长绑定和授权状态。" prd={PRD.classes} actions={<Button icon={Plus}>添加学员</Button>}/><div className="split-page"><div className="class-list panel"><div className="panel-head"><h2>我的班级</h2><button className="icon-btn"><Plus/></button></div>{['周六创意绘画 2 班','色彩启蒙班','大师创想班'].map((x,i)=><button className={i===0?'active':''} key={x}><span className="class-color"/><div><b>{x}</b><small>{[18,12,15][i]} 位学员</small></div><ArrowRight size={16}/></button>)}</div><div className="panel student-table"><div className="panel-head"><div><h2>周六创意绘画 2 班</h2><p>主教：林晓 · 每周六 14:30</p></div><Button variant="secondary" icon={Plus}>添加学员</Button></div><div className="student-grid">{students.map((s,i)=><button key={s}><span className={`avatar lg a${i}`}>{s[0]}</span><b>{s}</b><small>{7+i%4} 岁 · 已上 {12+i} 课时</small><Status value={i===4?'待授权':'已授权'}/></button>)}</div></div></div></>}
function ArchivesPage(){return <><PageHeader title="成长档案" desc="按学员持续沉淀作品、影像、点评与阶段性成长记录。" prd={PRD.archives} actions={<Button variant="secondary" icon={Download}>批量导出</Button>}/><div className="archive-feature"><div><span className="avatar xl">陈</span><div><h2>陈一诺的成长档案</h2><p>7 岁 · 周六创意绘画 2 班 · 已记录 18 次课程</p></div></div><div className="archive-metrics"><span><b>18</b>课程记录</span><span><b>42</b>作品</span><span><b>6</b>能力维度</span><span><b>4</b>阶段总结</span></div><Button icon={FileText}>导出阶段报告</Button></div><Timeline/></>}
function Timeline(){return <section className="timeline"><div className="timeline-filter"><h2>成长时间线</h2><select><option>全部记录</option><option>作品与点评</option><option>阶段总结</option></select></div>{[['08 月 04 日','梵高的向日葵','色彩表达 · 构图观察','今天大胆使用了冷暖色对比，画面节奏明显增强。'],['07 月 20 日','阶段成长总结','阶段报告 · 第 2 阶段','对色彩关系的感知更敏锐，开始形成个人画面语言。'],['07 月 13 日','海底世界','想象力 · 造型能力','通过大小不同的鱼群建立了清晰的空间层次。']].map((x,i)=><article key={x[0]}><div className="time-dot"><i/></div><div className="timeline-card"><div className="timeline-date">{x[0]}</div><div className="timeline-art">{i===1?'✦':'✺'}</div><div><h3>{x[1]}</h3><span>{x[2]}</span><p>{x[3]}</p><button className="text-link">查看完整记录 <ArrowRight size={14}/></button></div></div></article>)}</section>}

function ParentHome({navigate}){return <><PageHeader title="一诺妈妈，下午好" desc="孩子本周有一份新的课后反馈。" prd={PRD.parent}/><div className="parent-hero"><div><span>最新课后反馈 · 08 月 04 日</span><h2>今天，我们和梵高一起<br/>看见了向日葵的光。</h2><p>林晓老师已经完成作品装裱、课堂回顾和个人点评。</p><Button onClick={()=>navigate('parentArchive')} icon={ArrowRight}>查看完整反馈</Button></div><div className="parent-art"><img src={pandaMascot} alt="熊猫艺术导师"/><span>陈一诺 · 7 岁</span></div></div><div className="parent-grid"><div className="panel"><div className="panel-head"><h2>老师想对一诺说</h2><MessageSquareText/></div><blockquote>“一诺今天用厚重又明亮的黄色画出了很有生命力的向日葵。她还大胆加入蓝色线条形成冷暖对比。”</blockquote><button className="text-link" onClick={()=>navigate('parentArchive')}>查看完整点评</button></div><div className="panel observation-cta"><div><span>新功能</span><h2>读懂孩子的作品</h2><p>上传一幅孩子的画，获得温和的表达线索与可操作的陪伴建议。</p></div><Button onClick={()=>navigate('parentInsight')} icon={Sparkles}>开始作品观察</Button></div><div className="panel"><div className="panel-head"><h2>成长概览</h2><Archive/></div><div className="growth-bars"><label><span>色彩表达</span><i><b style={{width:'86%'}}/></i><em>进步明显</em></label><label><span>造型能力</span><i><b style={{width:'72%'}}/></i><em>稳定成长</em></label><label><span>创造力</span><i><b style={{width:'92%'}}/></i><em>突出</em></label></div></div></div></>}
function parentBoundData(records=[],parentStudent=''){const {students}=loadStudentManagement();const child=students.find(item=>item.name===parentStudent)||students.find(item=>item.guardianName)||students[0]||{name:'孩子',guardianName:'家长'};const entries=records.filter(record=>record.student===child.name).sort((a,b)=>b.date.localeCompare(a.date));return {child,entries,latest:entries.find(item=>item.status!=='缺课')};}
function ParentChildSwitch({parentStudents=[],parentStudent,setParentStudent}){if(parentStudents.length<2)return null;return <div className="parent-child-switch"><span>正在查看</span>{parentStudents.map(name=><button key={name} className={name===parentStudent?'active':''} onClick={()=>setParentStudent(name)}>{name}</button>)}</div>}
function useParentScopedRecords(records,parentSession,parentStudents){const [scoped,setScoped]=useState([]);useEffect(()=>{let active=true;if(!parentSession){setScoped(records.filter(record=>parentStudents.includes(record.student)));return()=>{active=false};}loadParentFeedbackRecords(parentSession).then(remote=>{if(active)setScoped(remote);}).catch(()=>{if(active)setScoped([]);});return()=>{active=false};},[parentSession,parentStudents,records]);return scoped;}
function ParentHomeFamily(props){const records=useParentScopedRecords(props.records,props.parentSession,props.parentStudents);return <><ParentChildSwitch {...props}/><ParentHomeBound {...props} records={records}/></>}
function ParentArchiveFamily(props){const records=useParentScopedRecords(props.records,props.parentSession,props.parentStudents);return <><ParentChildSwitch {...props}/><ParentArchiveBound {...props} records={records}/></>}
function ParentHomeBound({navigate,records=[],parentStudent}){const {child,latest,entries}=parentBoundData(records,parentStudent);const title=latest?.title||'新的作品';const review=latest?.reviews?.美术能力||'老师正在为孩子整理本节课的作品与成长记录。';return <><PageHeader title={`${child.guardianName||`${child.name}家长`}，下午好`} desc={latest?'孩子有一份新的课后反馈。':'老师会在完成课后反馈后，把新的记录发布到这里。'} prd={PRD.parent}/><div className="parent-hero"><div><span>{latest?`最新课后反馈 · ${latest.date.slice(5).replace('-',' 月 ')} 日`:'成长档案已建立'}</span><h2>今天，我们一起看见<br/>{title}里的表达。</h2><p>{latest?'老师已经完成作品处理与个人点评。':'孩子的作品、课堂照片与老师点评会在发布后按时间留存。'}</p><Button onClick={()=>navigate('parentArchive')} icon={ArrowRight}>查看完整反馈</Button></div><div className="parent-art"><img src={pandaMascot} alt="熊猫艺术导师"/><span>{child.name} · 成长档案</span></div></div><div className="parent-grid"><div className="panel"><div className="panel-head"><h2>老师想对{child.name}说</h2><MessageSquareText/></div><blockquote>“{review}”</blockquote><button className="text-link" onClick={()=>navigate('parentArchive')}>查看完整点评</button></div><div className="panel observation-cta"><div><span>新功能</span><h2>读懂孩子的作品</h2><p>上传一幅孩子的画，获得温和的表达线索与可操作的陪伴建议。</p></div><Button onClick={()=>navigate('parentInsight')} icon={Sparkles}>开始作品观察</Button></div><div className="panel"><div className="panel-head"><h2>成长概览</h2><Archive/></div><p className="parent-bound-summary">当前已归档 {entries.length} 条作品与课后记录；每一条都只属于{child.name}的成长档案。</p></div></div></>}
function ParentArchiveBound({records=[],parentStudent}){const {child,entries}=parentBoundData(records,parentStudent);return <><PageHeader title={`${child.name}的成长档案`} desc="记录每一次表达、尝试与进步。" prd={PRD.archives} actions={<Button variant="secondary" icon={Download}>下载阶段报告</Button>}/><div className="archive-feature parent"><div><span className="avatar xl">{child.name[0]}</span><div><h2>个人成长档案</h2><p>已归档 {entries.length} 次课程记录</p></div></div><Status value={child.guardianName?'已绑定':'待绑定'}/></div><section className="parent-bound-timeline"><h2>成长时间线</h2>{entries.length?entries.map(entry=><article key={entry.id}><time>{entry.date}</time><div><b>{entry.status==='缺课'?'这节课，先为孩子留下一页。':`《${entry.title}》`}</b><p>{entry.status==='缺课'?entry.reviews?.summary:entry.reviews?.美术能力}</p></div></article>):<p>老师发布作品和点评后，会在这里呈现。</p>}</section></>}
function ParentInsight({setToast}){const [done,setDone]=useState(false);return <><PageHeader title="作品表达观察" desc="从绘画中理解孩子当下的表达；结论仅供亲子沟通与教育陪伴参考，不作心理诊断。" prd="PRD-5 / F-PARENT-INSIGHT-01"/>{!done?<section className="insight-shell"><div className="insight-copy"><span>温和的看见，而不是给孩子贴标签</span><h2>让一幅画，成为<br/>走近孩子的入口。</h2><p>上传孩子近期独立完成的作品。AI 将结合色彩、构图与符号表达，生成可与孩子展开对话的观察线索和家庭陪伴建议。</p><ul><li><Check/>不评价好坏，只关注表达</li><li><Check/>不作医学或心理诊断</li><li><Check/>每次观察自动归入成长档案</li></ul></div><div className="insight-upload"><img src={pandaObserve} alt="熊猫艺术导师"/><UploadCloud size={28}/><b>上传一幅孩子的作品</b><span>JPG、PNG，建议在自然光下拍摄</span><Button onClick={()=>{setDone(true);setToast('作品观察已生成')}} icon={Sparkles}>生成温和观察</Button></div></section>:<section className="insight-result"><div className="insight-art">✺<small>《太阳花园》· 陈一诺</small></div><div><span className="result-label">作品表达观察</span><h2>一诺正在用明亮的色彩<br/>确认自己的想象力。</h2><p>画面里反复出现的黄色和向上伸展的线条，可能是在表达积极的能量与被看见的愿望。她大胆加入蓝色，不急着追求“像不像”，显示出对自我表达的信心正在生长。</p><div className="parent-tip"><b>今晚可以这样聊</b><span>“这朵花好像很有力量。你觉得它今天想把光送给谁？”</span></div><Button onClick={()=>setToast('已保存到陈一诺的成长档案')} icon={Archive}>保存到成长档案</Button></div></section>}</>}
function ParentArchive(){return <><PageHeader title="陈一诺的成长档案" desc="记录每一次表达、尝试与进步。" prd={PRD.archives} actions={<Button variant="secondary" icon={Download}>下载阶段报告</Button>}/><div className="archive-feature parent"><div><span className="avatar xl">陈</span><div><h2>第 2 成长阶段</h2><p>2026 年 05 月—08 月 · 12 次课程</p></div></div><Status value="已发布"/></div><Timeline/></>}
function AuthorizationPage({setToast}){return <><PageHeader title="授权管理" desc="管理孩子作品、肖像和课堂视频的使用范围。" prd="PRD-16 / F-CONSENT-01"/><div className="panel consent"><div className="consent-head"><span><ShieldCheck/></span><div><h2>陈一诺 · 监护人授权</h2><p>当前授权有效期至 2027-08-04</p></div><Status value="正常"/></div>{[['用于生成课后反馈','允许处理作品、照片和视频'],['用于个人成长档案','允许长期保存已发布记录'],['用于机构内部教学展示','仅本机构老师可见'],['用于公开案例展示','默认关闭，需单独授权']].map((x,i)=><label className="toggle-row" key={x[0]}><div><b>{x[0]}</b><small>{x[1]}</small></div><input type="checkbox" defaultChecked={i<3}/><span/></label>)}<div className="consent-actions"><Button variant="danger" onClick={()=>setToast('撤回申请已提交，公开分享将立即关闭')}>申请撤回授权</Button><Button variant="secondary" icon={Download}>下载授权记录</Button></div></div></>}
function ProfilePage(){return <><PageHeader title="个人中心" desc="管理账号、安全设置和消息通知。" prd="PRD-5 / F-PROFILE-01"/><div className="settings-stack"><div className="panel profile-card"><span className="avatar xl">陈</span><div><h2>陈一诺妈妈</h2><p>138****2026 · 已绑定 1 名学员</p></div><Button variant="secondary">编辑资料</Button></div><div className="panel settings-list">{[['账号与安全','手机号、登录设备和账号注销'],['消息通知','课后反馈、阶段报告和授权变更'],['隐私设置','数据导出、保存期限和授权记录']].map(x=><button key={x[0]}><div><b>{x[0]}</b><small>{x[1]}</small></div><ArrowRight/></button>)}</div></div></>}

function AdminDashboard({navigate}){return <><PageHeader title="运营总览" desc="监控平台业务、AI 调用质量、成本与风险。" prd="PRD-6 / F-ADMIN-01" actions={<Button icon={Plus} onClick={()=>navigate('apps')}>新增 AI 应用</Button>}/><div className="stats"><Stat label="今日 AI 任务" value="1,284" delta="较昨日 +12.8%" icon={Sparkles}/><Stat label="任务成功率" value="96.7%" delta="目标 ≥95%" icon={CircleCheck} tone="green"/><Stat label="今日预估成本" value="¥ 428.60" delta="预算内 72%" icon={Zap} tone="yellow"/><Stat label="待处理告警" value="3" delta="1 个高优先级" icon={CircleAlert} tone="coral"/></div><div className="admin-grid"><div className="panel health-panel"><div className="panel-head"><h2>模型池健康度</h2><button className="text-link" onClick={()=>navigate('providers')}>管理模型</button></div>{[['文本模型池','99.2%','正常'],['图片模型池','97.8%','正常'],['视频模型池','91.4%','需关注'],['视觉理解 / ASR','98.6%','正常']].map(x=><div className="health-row" key={x[0]}><div><b>{x[0]}</b><span>{x[1]} 成功率</span></div><div className="sparkline"><i/><i/><i/><i/><i/></div><Status value={x[2]}/></div>)}</div><div className="panel alerts"><div className="panel-head"><h2>实时告警</h2><Bell/></div><div className="alert-item high"><CircleAlert/><div><b>视频主模型错误率升高</b><span>已自动切换备用模型 · 8 分钟前</span></div></div><div className="alert-item"><Clock3/><div><b>图片任务队列延迟</b><span>P95 达 4.8 分钟 · 21 分钟前</span></div></div><div className="alert-item"><Zap/><div><b>供应商余额低于阈值</b><span>VisualCloud · 1 小时前</span></div></div></div></div><TaskTable tasks={taskSeed} title="最近生成任务" onView={()=>navigate('logs')}/></>}

function AppsPage({apps,setApps,setModal,setToast}){const uninstall=(id)=>setModal({kind:'confirm-uninstall',id});return <><PageHeader title="应用中心" desc="安装、启停、卸载和新增 AI 应用；历史数据始终保留。" prd={PRD.apps} actions={<Button icon={Plus} onClick={()=>setModal({kind:'add-app'})}>新增应用</Button>}/><div className="tabs"><button className="active">已安装 4</button><button>可安装 2</button><button>版本记录</button></div><div className="admin-app-grid">{apps.map(a=><AIAppCard admin key={a.id} app={a} onToggle={()=>{setApps(xs=>xs.map(x=>x.id===a.id?{...x,status:x.status==='enabled'?'disabled':'enabled'}:x));setToast(`${a.name}状态已更新`)}} onUninstall={()=>uninstall(a.id)}/>)}</div><div className="panel marketplace"><div className="panel-head"><div><h2>可安装应用</h2><p>经过平台审核的配置式应用</p></div></div>{[['课堂语音转写','ASR · v1.2.0'],['作品风格分析','视觉理解 · v0.9.2']].map(x=><div className="market-row" key={x[0]}><span className="app-icon blue"><Package/></span><div><b>{x[0]}</b><small>{x[1]}</small></div><Button variant="secondary" onClick={()=>setToast(`${x[0]}已安装`)}>安装</Button></div>)}</div></>}

function ProvidersPage({setModal,setToast}){const [tab,setTab]=useState('providers');return <><PageHeader title="模型供应商与模型池" desc="AI 应用只能引用配置完整、测试通过且已启用的模型。" prd={PRD.providers} actions={<Button icon={Plus} onClick={()=>setModal({kind:'add-provider'})}>新增供应商</Button>}/><div className="tabs"><button className={tab==='providers'?'active':''} onClick={()=>setTab('providers')}>供应商</button><button className={tab==='models'?'active':''} onClick={()=>setTab('models')}>模型列表</button><button className={tab==='pools'?'active':''} onClick={()=>setTab('pools')}>模型池与路由</button></div>{tab==='providers'?<ProviderTable setToast={setToast}/>:tab==='models'?<ModelTable/>:<ModelPools setToast={setToast}/>}</>}
function ProviderTable({setToast}){const rows=[['OpenAI Compatible','文本 / 视觉','https://api.openai.com/v1','已启用','99.4%'],['VisualCloud','图片生成 / 编辑','https://api.visualcloud.cn/v2','已启用','97.8%'],['MotionSeed','视频生成','https://api.motionseed.cn/v1','已启用','91.4%'],['VoiceFlow','ASR / 字幕','https://api.voiceflow.cn','已停用','—']];return <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>供应商</th><th>能力</th><th>Endpoint</th><th>状态</th><th>近 24h 成功率</th><th>操作</th></tr></thead><tbody>{rows.map(r=><tr key={r[0]}><td><b>{r[0]}</b><small>凭据：sk-••••••8K2</small></td><td>{r[1]}</td><td><code>{r[2]}</code></td><td><Status value={r[3]}/></td><td>{r[4]}</td><td><div className="row-actions"><button className="text-link" onClick={()=>setToast('连接测试通过 · 386ms')}>连接测试</button><button className="icon-btn"><MoreHorizontal/></button></div></td></tr>)}</tbody></table></div></div>}
function ModelTable(){const rows=[['Qwen Text Max','OpenAI Compatible','文本生成 / 视觉理解','v3.2','已启用','¥0.012 / 1K tokens'],['VisionArt Pro','VisualCloud','图片生成','2026-07','已启用','¥0.18 / 张'],['VisionArt Edit','VisualCloud','图片编辑','v2.1','已启用','¥0.12 / 张'],['Seedance 2','MotionSeed','视频生成','2.0','已启用','¥1.80 / 秒'],['Voice ASR Pro','VoiceFlow','ASR / 字幕','1.4','已停用','¥0.03 / 分钟']];return <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>模型</th><th>供应商</th><th>能力标签</th><th>版本</th><th>状态</th><th>价格</th></tr></thead><tbody>{rows.map(r=><tr key={r[0]}>{r.map((x,i)=><td key={i}>{i===0?<b>{x}</b>:i===4?<Status value={x}/>:x}</td>)}</tr>)}</tbody></table></div></div>}
function ModelPools({setToast}){return <div className="pool-list">{[['文本点评模型池','Qwen Text Max','GPT Text Pro','优先质量'],['图片装裱模型池','VisionArt Pro','VisionArt Edit','均衡'],['视频生成模型池','Seedance 2','MotionLite','优先成本']].map((x,i)=><div className="panel pool-card" key={x[0]}><div className="pool-title"><span className={`app-icon ${['green','blue','yellow'][i]}`}><Zap/></span><div><h3>{x[0]}</h3><p>健康检查每 60 秒 · 自动熔断已开启</p></div><Status value="正常"/></div><div className="route"><div><small>主模型</small><b>{x[1]}</b><span>权重 80%</span></div><ArrowRight/><div><small>备用模型</small><b>{x[2]}</b><span>失败自动切换</span></div></div><div className="pool-foot"><span>路由策略：{x[3]}</span><button className="text-link" onClick={()=>setToast('路由策略已保存')}>编辑策略</button></div></div>)}</div>}

function UsersPage({setModal}){const rows=[['林晓','老师','星河校区 / 3 个班级','正常','今天 14:32'],['王琪','老师','星河校区 / 2 个班级','正常','今天 11:20'],['陈芳','家长','绑定：陈一诺','正常','昨天 20:41'],['赵明','家长','绑定：赵禾','待验证','—'],['平台运营','管理员','全平台','正常','今天 09:12']];return <><PageHeader title="用户管理" desc="统一管理管理员、老师、家长及其数据访问范围。" prd={PRD.users} actions={<Button icon={Plus} onClick={()=>setModal({kind:'invite-user'})}>邀请用户</Button>}/><div className="filters"><div className="search-field"><Search/><input placeholder="姓名、手机号或学员"/></div><select><option>全部角色</option><option>管理员</option><option>老师</option><option>家长</option></select></div><div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>用户</th><th>角色</th><th>数据范围</th><th>状态</th><th>最后登录</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r[0]}><td><b>{r[0]}</b><small>138****{Math.floor(Math.random()*8999+1000)}</small></td><td>{r[1]}</td><td>{r[2]}</td><td><Status value={r[3]}/></td><td>{r[4]}</td><td><button className="icon-btn"><MoreHorizontal/></button></td></tr>)}</tbody></table></div></div></>}
/**
 * 生成日志（[第三步 US-112]）：任务明细与调用链路照旧，另接一块**点评轨迹**面板 ——
 * 任意一次五维点评的完整轨迹（六分区）、五个筛选维度、复制 / 导出留痕。
 * 面板自己会判位面与角色（家长端与家长分享页不存在任何轨迹入口，`reviewTraceSurfaceAllowed`）。
 */
function LogsPage({tasks,role='admin',traceLog=[],tracePolicy=null,traceSource=null,refreshReviewTraces=()=>{},auditTraceEntry=()=>{},adminTraceViewer=null,teacherTraceViewer=null,auditLog=[],setToast=()=>{}}){
  const traceViewer=role==='admin'?adminTraceViewer:teacherTraceViewer;
  const [loading,setLoading]=useState(false);
  // 进页面就把轨迹账刷新一次（本机镜像 + 云端表 + 开发适配器）：刷新是异步的，界面先用本机镜像渲染。
  useEffect(()=>{let active=true;setLoading(true);Promise.resolve(refreshReviewTraces()).catch(()=>{}).then(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
  const refresh=()=>{setLoading(true);Promise.resolve(refreshReviewTraces()).catch(()=>{}).then(()=>setLoading(false))};
  return <><PageHeader title="生成日志" desc="追踪逻辑任务、供应商调用 attempt、降级、用量与成本，并审计每一次点评的完整轨迹。" prd={PRD.logs} actions={<Button variant="secondary" icon={Download}>导出日志</Button>}/><div className="log-summary"><span><b>96.7%</b>成功率</span><span><b>4.2s</b>P95 文本延迟</span><span><b>¥428.60</b>今日成本</span><span><b>18</b>自动降级</span></div><TaskTable tasks={tasks} title="任务与调用明细"/><ReviewTraceLogsPanel role={role} viewer={traceViewer} traces={traceLog} policy={tracePolicy} sourceNote={traceSource?.note||''} loading={loading} onRefresh={refresh} recordAudit={auditTraceEntry} auditLog={auditLog} setToast={setToast}/><div className="panel trace"><div className="panel-head"><h2>调用链路示例 · T-0822</h2><Status value="生成中"/></div>{[['请求校验','通过','0.12s'],['模型池路由','Seedance 2（主）','0.03s'],['供应商调用 attempt-01','超时 · 自动重试','60.0s'],['供应商调用 attempt-02','MotionLite（备用）','运行中']].map((x,i)=><div className="trace-row" key={x[0]}><span className={i<3?'done':'running'}>{i<3?<Check/>:<RefreshCw/>}</span><div><b>{x[0]}</b><small>{x[1]}</small></div><em>{x[2]}</em></div>)}</div></>}
function ArchiveAdmin(){return <><PageHeader title="档案管理" desc="检索、纠错、导出、删除和审计学员成长档案。" prd={PRD.archiveAdmin}/><div className="filters"><div className="search-field"><Search/><input placeholder="学员姓名、档案 ID 或班级"/></div><select><option>全部授权状态</option><option>有效</option><option>已撤回</option></select></div><div className="archive-admin-grid">{['陈一诺','林小满','赵禾','周子墨','苏西','陆一白'].map((s,i)=><div className="archive-admin-card" key={s}><span className={`avatar lg a${i}`}>{s[0]}</span><div><b>{s}</b><small>档案 A-2026-00{i+12}</small></div><span>{12+i} 条记录</span><Status value={i===4?'待授权':'正常'}/><button className="icon-btn"><MoreHorizontal/></button></div>)}</div></>}
function PermissionsPage({setToast}){const perms=[['课后反馈','创建课次','上传素材','审核发布'],['AI 创作','使用生图','使用视频','使用点评'],['成长档案','查看','导出','纠错','删除'],['平台治理','应用管理','供应商密钥','模型启停','生成日志']];return <><PageHeader title="角色与权限" desc="功能权限与机构、校区、班级、学员数据范围同时生效。" prd={PRD.permissions} actions={<Button icon={Plus}>新建权限组</Button>}/><div className="permission-layout"><div className="panel role-list"><h2>角色/权限组</h2>{['平台超级管理员','机构管理员','老师','家长'].map((x,i)=><button className={i===2?'active':''} key={x}><ShieldCheck/><div><b>{x}</b><small>{[2,3,28,86][i]} 位用户</small></div></button>)}</div><div className="panel permission-matrix"><div className="panel-head"><div><h2>老师</h2><p>默认角色 · 仅访问被授权班级和学员</p></div><Button onClick={()=>setToast('权限配置已保存')}>保存更改</Button></div>{perms.map((g,gi)=><div className="permission-group" key={g[0]}><b>{g[0]}</b><div>{g.slice(1).map((p,pi)=><label key={p}><input type="checkbox" defaultChecked={gi<3||pi===0}/><span/>{p}</label>)}</div></div>)}</div></div></>}
/**
 * 点评轨迹的保留期与披露开关（[第三步 US-112] / F-REVIEW-TRACE-03）。
 *
 * 三条口径都在这里落地，判据一律来自 `data/reviewTracePolicy.js`（页面不自己算日期）：
 *  1. **保留期可配置**（默认 90 天；「长期保留」= 不清理）；
 *  2. **到期清理先预览影响范围**：先看清楚「截止哪天、将删几条、是哪几条」，再执行 ——
 *     预览与执行读同一份纯函数，所以不会出现「预览说 3 条、执行删掉 5 条」；
 *  3. **平台开关 `allowPromptDisclosure`**：关闭后老师端提示词分区显示
 *     「管理员已限制查看，仅显示清单」（那句话的唯一真源在 data 层，界面只转出）。
 */
function TraceRetentionSection({policy,setPolicy,traces=[],onCleanup=()=>{},setToast=()=>{}}){
  const [preview,setPreview]=useState(null);
  const current=normalizeReviewTracePolicy(policy);
  const change=patch=>{setPolicy(prev=>reviewTracePolicyPatch(prev,patch,{updatedBy:roleMeta.admin.name}));setPreview(null)};
  const runPreview=()=>{const next=reviewTraceCleanupPreview(traces,current);setPreview(next);setToast(next.expiredCount?`预览完成：${next.expiredCount} 条到期，${next.keepCount} 条保留`:'预览完成：没有到期轨迹');return next};
  const runCleanup=()=>{const result=onCleanup();setPreview(result.preview)};
  return <div className="panel config-section trace-policy" data-trace-policy-section="true" data-trace-policy-retention-value={current.retentionDays} data-trace-policy-disclosure-value={current.allowPromptDisclosure?'on':'off'}>
    <h2>点评轨迹：保留期与披露</h2>
    <p className="config-note">轨迹按白名单留档（图片只记引用与 hash）；到期清理需先预览影响范围，确认后再执行。</p>
    <div className="form-grid">
      <label>轨迹保留期<select data-trace-policy-retention="true" value={current.retentionDays} onChange={event=>change({retentionDays:Number(event.target.value)})}>{REVIEW_TRACE_RETENTION_OPTIONS.map(option=><option key={option.days} value={option.days}>{option.label}</option>)}</select></label>
      <label className="config-check"><input type="checkbox" data-trace-policy-disclosure="true" checked={current.allowPromptDisclosure} onChange={event=>change({allowPromptDisclosure:event.target.checked})}/><span>允许老师查看提示词正文（关闭后老师端只显示清单）</span></label>
    </div>
    <div className="trace-policy-actions">
      <Button variant="secondary" onClick={runPreview}>预览到期清理影响范围</Button>
      <Button variant="secondary" disabled={!preview||preview.expiredCount===0} onClick={runCleanup}>执行清理{preview&&preview.expiredCount?`（${preview.expiredCount} 条）`:''}</Button>
      <small data-trace-policy-summary="true">{reviewTracePolicySummary(current)}</small>
    </div>
    {current.allowPromptDisclosure?null:<small className="trace-policy-note" data-trace-policy-note="true">关闭后老师端提示词分区显示「{REVIEW_TRACE_DISCLOSURE_NOTE}」；管理端仍可审计。</small>}
    {preview?<div className="trace-cleanup-preview" data-trace-cleanup-preview="true" data-trace-cleanup-expired={preview.expiredCount} data-trace-cleanup-keep={preview.keepCount} data-trace-cleanup-total={preview.total} data-trace-cleanup-cutoff={preview.cutoff||''}>
      <p data-trace-cleanup-text="true">{preview.text}</p>
      {preview.expired.length?<ul data-trace-cleanup-rows="true">{preview.expired.slice(0,10).map(row=><li key={row.traceId} data-trace-cleanup-row={row.traceId}>{row.text}</li>)}</ul>:null}
      {preview.expired.length>10?<small>另有 {preview.expired.length-10} 条同样到期，执行清理时一并处理。</small>:null}
    </div>:null}
  </div>;
}

function SettingsPage({setToast,tracePolicy=null,setTracePolicy=()=>{},traceLog=[],cleanupReviewTraces=()=>{}}){return <><PageHeader title="系统配置" desc="管理上传阈值、任务超时、数据保存和通知策略。" prd="PRD-8.3 / F-CONFIG-01"/><div className="settings-stack"><div className="panel config-section"><h2>上传与任务阈值</h2><div className="form-grid"><label>每班学员上限<input defaultValue="60"/></label><label>单任务作品图上限<input defaultValue="30"/></label><label>单任务照片上限<input defaultValue="100"/></label><label>单个视频上限（分钟）<input defaultValue="10"/></label></div></div><div className="panel config-section"><h2>数据保存与隐私</h2><div className="form-grid"><label>原始素材默认保存<select><option>365 天</option><option>180 天</option><option>长期</option></select></label><label>删除冷静期<select><option>7 天</option><option>立即删除</option><option>30 天</option></select></label></div></div><TraceRetentionSection policy={tracePolicy} setPolicy={setTracePolicy} traces={traceLog} onCleanup={cleanupReviewTraces} setToast={setToast}/><div><Button onClick={()=>setToast('系统配置已保存')}>保存配置</Button></div></div></>}

function GuidePage({navigate}){const sections=[
 ['公共认证',['登录','注册','表单校验','角色快速体验'],PRD.auth,'从登录页开始'],
 ['老师前台',['工作台','课后反馈','AI 创作','班级学员','成长档案','生成任务'],PRD.dashboard,'进入老师工作台'],
 ['核心业务流程',['课次学员','素材上传','AI 应用','生成审核','发布档案'],PRD.create,'体验完整流程'],
 ['家长前台',['首页','成长档案','授权管理','个人中心'],PRD.parent,'进入家长端'],
 ['管理后台',['运营总览','应用中心','模型供应商','老师人设','技能库','装裱设置','3D 画廊','用户','日志','档案','权限','配置'],PRD.apps,'进入管理员后台']
 ];return <><PageHeader title="原型页面与体验路径" desc="每个页面均标注 PRD 功能编号；下列入口可直接跳转体验。" prd={PRD.guide}/><div className="guide-path"><span>1 注册登录</span><ArrowRight/><span>2 选择身份</span><ArrowRight/><span>3 完成核心任务</span><ArrowRight/><span>4 验证权限差异</span><ArrowRight/><span>5 查看异常状态</span></div><div className="guide-grid">{sections.map((s,i)=><div className="guide-card" key={s[0]}><span>0{i+1}</span><h2>{s[0]}</h2><p>{s[1].join(' · ')}</p><small>{s[2]}</small><button onClick={()=>{if(i===1)navigate('dashboard');else if(i===2)navigate('create');else if(i===3)navigate('parent');else if(i===4)navigate('adminDash')}}>{s[3]}<ArrowRight/></button></div>)}</div><div className="panel page-inventory"><h2>完整页面清单（36 个页面/主要状态）</h2><div>{['登录','注册','老师工作台','课后反馈列表','创建课次','素材上传','AI 应用选择','生成进度','结果审核','发布成功','AI 创作台','生成任务','班级学员','老师端成长档案','家长首页','家长档案','授权管理','家长个人中心','运营总览','应用中心','新增应用弹窗','供应商管理','模型列表','模型池路由','老师人设','技能库','装裱设置','3D 画廊展陈','3D 画廊设置','用户管理','生成日志','后台档案','角色权限','系统配置','空状态','错误状态'].map((x,i)=><span key={x}>{String(i+1).padStart(2,'0')} {x}</span>)}</div></div></>}

function Modal({type,close,setToast,apps,setApps}){const kind=type.kind;const [error,setError]=useState('');const save=()=>{if(kind==='add-provider'){const name=document.querySelector('#provider-name')?.value;if(!name)return setError('请输入供应商名称')}if(kind==='add-app'){const name=document.querySelector('#app-name')?.value;if(!name)return setError('请输入应用名称');setApps(xs=>[...xs,{id:`custom-${Date.now()}`,name,desc:'配置式外部 API 应用',icon:Package,color:'blue',status:'disabled',version:'0.1.0'}])}if(kind==='confirm-uninstall'){setApps(xs=>xs.filter(x=>x.id!==type.id))}setToast(kind==='confirm-uninstall'?'应用已卸载，历史任务和档案仍保留':'配置已保存');close()};return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="modal"><div className="modal-head"><div><h2>{kind==='add-app'?'新增 AI 应用':kind==='add-provider'?'新增模型供应商':kind==='invite-user'?'邀请用户':'确认卸载应用'}</h2><p>{kind==='confirm-uninstall'?'卸载后将阻止新任务，但不会删除历史数据。':'填写必要信息后可继续完善配置。'}</p></div><button className="icon-btn" onClick={close}><X/></button></div>{kind==='confirm-uninstall'?<div className="danger-note"><CircleAlert/><span>请先确保没有运行中任务，并确认机构已停用该应用。</span></div>:<div className="modal-form">{kind==='add-app'?<><label>应用名称<input id="app-name" placeholder="例如：课堂语音转写"/></label><label>能力类型<select><option>外部 API</option><option>文本生成</option><option>图片生成/编辑</option><option>视频生成</option></select></label><label>输入 Schema<textarea placeholder={'{"type":"object","properties":{...}}'}/></label></>:kind==='add-provider'?<><label>供应商名称<input id="provider-name" placeholder="例如：VisualCloud"/></label><label>供应商类型<select><option>OpenAI Compatible</option><option>图片供应商</option><option>视频供应商</option></select></label><label>API Endpoint<input placeholder="https://api.example.com/v1"/></label><label>API Key<input type="password" placeholder="仅加密保存，不会明文返回"/></label></>:<><label>手机号<input placeholder="请输入手机号"/></label><label>角色<select><option>老师</option><option>家长</option><option>管理员</option></select></label><label>数据范围<select><option>星河校区</option><option>指定班级</option><option>全平台</option></select></label></>}</div>}{error?<div className="form-error"><CircleAlert/>{error}</div>:null}<div className="modal-actions"><Button variant="secondary" onClick={close}>取消</Button><Button variant={kind==='confirm-uninstall'?'danger':'primary'} onClick={save}>{kind==='confirm-uninstall'?'确认卸载':'保存并继续'}</Button></div></div></div>}
function NotFound({navigate}){return <EmptyState icon={FolderOpen} title="页面不存在" desc="这个原型页面可能已移动。" action="返回工作台" onClick={()=>navigate('dashboard')}/>}

createRoot(document.getElementById('root')).render(<App/>);
