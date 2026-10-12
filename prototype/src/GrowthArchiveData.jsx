import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Clapperboard, Download, FileText, Frame, Gauge, Loader2, MessageSquareText, Plus, RefreshCw, Sparkles, Trash2, XCircle } from 'lucide-react';
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
import { ARCHIVE_SHARE_LINK_NOTE } from './data/archiveSummary';
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
import { AUDIT_ACTIONS, auditEntryMissingFields, auditTraceText } from './data/auditLog';
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
  videoJobErrorText,
  videoJobKey,
  videoJobQueueView,
  videoJobSubmitIssue
} from './data/videoJobs';
import {
  cancelVideoJob,
  listVideoJobs,
  resumeVideoJobQueue,
  retryVideoJob,
  submitVideoJob,
  subscribeVideoJobs
} from './services/videoJobQueue';
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
// 个人成长视频时间线（[第四步 US-217]）：按课次日期升序串联 / 缺课 1.5 秒留白卡 / 片头写学员与周期 /
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
// 机构名（帧清单的片头与片尾都要写它，与装裱叠加元素的变量同一份来源）。
import { DEFAULT_ORG_NAME } from './data/lessons';
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
  return <article className="archive-lesson" data-archive-lesson="true" data-archive-lesson-id={entry.id} data-archive-lesson-date={entry.date} data-archive-lesson-status={entry.status} data-archive-lesson-plaque={entry.dateDots} data-archive-lesson-dimensions={entry.dimensionCount} data-archive-lesson-photos={entry.photoCount} data-archive-lesson-forward={entry.forward.state} data-archive-lesson-forward-label={entry.forward.stateLabel} data-archive-lesson-forward-opens={String(entry.forward.openCount)} data-archive-lesson-forward-text={entry.forward.line}>
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
        data-video-frame-title={frame.titleText} data-video-frame-subtitle={frame.subtitle}
        data-video-frame-subtitle-truncated={frame.subtitleTruncated?'true':'false'}
        data-video-frame-subtitle-verbatim={frame.subtitle&&!frame.boundaryIssue?'true':'false'}
        data-video-frame-asset={frame.asset.ready?'ready':frame.asset.status}>
        <header><b data-video-frame-index-label="true">{frame.indexLabel} · {frame.kindLabel}</b><span data-video-frame-time-label="true">{frame.timeText}</span><em data-video-frame-duration-label="true">{frame.durationText}</em></header>
        <div className="video-frame-body">
          {frame.asset.ready?<img src={frame.asset.url} alt={`${frame.titleText}帧`} loading="lazy" decoding="async" data-video-frame-image="true"/>:null}
          <div>
            <p className="video-frame-title" data-video-frame-title-label="true">{frame.titleText}{frame.date?` · ${frame.date}`:''}</p>
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
 * 个人成长视频时间线（[第四步 US-217]）：一位孩子的作品按课次日期升序串成一条 —— 片头写学员与周期、
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
    {view.notes.map((note,index)=><p className="video-personal-note" key={note} data-personal-note={index}>{note}</p>)}
    <p className="video-personal-no-output" data-personal-no-output="true">{view.noOutputNote}</p>
    <ol className="video-personal-list" data-personal-frame-list="true">
      {view.frames.map(frame=><li key={frame.id} className={`video-personal-frame is-${frame.kind}`} data-personal-frame={frame.kind}
        data-personal-frame-index={frame.index} data-personal-frame-date={frame.date}
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
              <p className="video-personal-frame-title" data-personal-frame-title-label="true">{frame.titleText}{frame.date?` · ${frame.date}`:''}</p>
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
 * 段首 1.5 秒姓名卡写着姓名与作品数，段内按课次时间线排；本期没有作品的学员保留一张留白卡。
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
          data-class-frame-date={frame.date} data-class-frame-title={frame.titleText} data-class-frame-subtitle={frame.subtitle}
          data-class-frame-start={frame.startSec} data-class-frame-end={frame.endSec} data-class-frame-duration={frame.durationSec}>
          <header><b data-class-frame-kind-label="true">{frame.kindLabel}</b><span data-class-frame-time-label="true">{frame.timeText}</span><em data-class-frame-duration-label="true">{frame.durationText}</em></header>
          <div className="video-class-frame-body">
            {frame.asset.ready?<img src={frame.asset.url} alt={`${frame.titleText}帧`} loading="lazy" decoding="async" data-class-frame-image="true"/>:null}
            <div>
              <p className="video-class-frame-title" data-class-frame-title-label="true">{frame.titleText}{frame.date?` · ${frame.date}`:''}</p>
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
 */
function VideoJobsPanel({isClass,objectName,period,onPeriod,lessonCount,artworkCount,photoCount,teacherName,setToast,entries=[],scopeEntries=[],classEntries=[],roster=[],tokens=[]}){
  const [jobs,setJobs]=useState(()=>listVideoJobs());
  const [notice,setNotice]=useState('');
  const [simulateFail,setSimulateFail]=useState(false);
  // 老师手动排除的作品（[第四步 US-216] 第 5 条）：只对这一份精选清单有效，不写进任务、也不落库。
  // 换对象 / 换周期 / 换类型后清空 —— 「排除」是对某个对象某个周期说的，不是一条永久规则。
  const [excludedArtworks,setExcludedArtworks]=useState([]);
  // 片尾寄语（帧清单的输入：≤40 字，超限由数据层给可读原因；空着就不显示寄语，不编一句）。
  const [endingNote,setEndingNote]=useState('');
  // 班级集锦的学员顺序（[第四步 US-218] 第 2 条验收）：默认按班级名单（`null` = 跟着名单走），
  // 老师点过「上移 / 下移」之后才是一份显式顺序 —— 换班级就清空（顺序是对某个班级说的）。
  const [classOrder,setClassOrder]=useState(null);
  // 演示失败原因（四类：模型 / 字体 / 素材 / 存储）—— 可选值与文案都来自数据层。
  const [simulateErrorCode,setSimulateErrorCode]=useState(VIDEO_JOB_SIMULATE_ERROR_DEFAULT);
  // 刚提交的那条（卡片高亮 + 滚动到卡片）：提交后「立即进入任务卡片」是可见的，不只是一个 state。
  const [latestKey,setLatestKey]=useState('');
  // 本次进入页面的时刻（组件挂载）：`videoJobResumed` 用它判断「这条是离开页面前提交的」。
  const sessionStartRef=useRef(Date.now());
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
  // 提交完把那条卡片滚进视野（`block:'nearest'`：已经看得见就不动滚动位置）。
  useEffect(()=>{
    if(!latestKey||typeof document==='undefined')return;
    const card=document.querySelector(`[data-video-job-card][data-video-job-key="${latestKey}"]`);
    if(card&&typeof card.scrollIntoView==='function')card.scrollIntoView({block:'nearest'});
  },[latestKey]);
  const view=videoJobQueueView(jobs,{resumedAt:sessionStartRef.current});
  const submitIssue=videoJobSubmitIssue({type,studentId:isClass?'':objectName,classId:isClass?objectName:'',period});
  const jobKey=videoJobKey({type,studentId:isClass?'':objectName,classId:isClass?objectName:'',period});
  // 精选（[第四步 US-216]）：先定「哪些作品进成片」（时长上限 + 均匀取样 + 手动排除），
  // 帧清单再按**收录的那一批**排 —— 于是「已精选 M 幅」与帧清单上的帧数、预估时长三者同源。
  useEffect(()=>{setExcludedArtworks([])},[objectName,period,isClass]);
  const selection=useMemo(()=>videoSelectionPlan({entries,type,excluded:excludedArtworks}),[entries,type,excludedArtworks]);
  const selectionView=useMemo(()=>videoSelectionView(selection),[selection]);
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
  const report=result=>{setJobs(listVideoJobs());setNotice(result.ok?result.notice:result.issue);setToast(result.ok?result.notice:result.issue)};
  const submit=()=>{
    const result=submitVideoJob({type,studentId:isClass?'':objectName,classId:isClass?objectName:'',period,objectName,lessonCount,artworkCount,photoCount,createdBy:teacherName,simulate:simulateFail?'fail':'success',simulateErrorCode});
    if(result.ok&&result.job)setLatestKey(result.job.jobKey);
    report(result);
  };
  const cancel=key=>report(cancelVideoJob(key));
  const retry=key=>report(retryVideoJob(key));
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
      <Button icon={Clapperboard} data-video-submit="true" data-video-submit-key={jobKey} disabled={Boolean(submitIssue)} onClick={submit}>{VIDEO_JOB_SUBMIT_LABEL}</Button>
    </div>
    <p className="video-jobs-note" data-video-submit-note="true">{VIDEO_JOB_SUBMIT_NOTE}</p>
    {submitIssue?<p className="video-jobs-issue" data-video-submit-issue="true">{submitIssue}</p>:null}
    <VideoSelectionPanel view={selectionView} onToggleExclude={toggleExclude}/>
    <VideoTimelinePreview plan={timelinePlan} endingNote={endingNote} onEndingNote={setEndingNote}/>
    {personalPlan?<VideoPersonalTimeline plan={personalPlan}/>:null}
    {classPlan&&classView?<VideoClassTimeline plan={classPlan} view={classView} onMove={moveClassOrder} onReset={resetClassOrder}/>:null}
    {notice?<p className="video-jobs-notice" data-video-notice="true">{notice}</p>:null}
    {view.resumeSummary?<p className="video-jobs-resumed" data-video-jobs-resumed="true">{view.resumeSummary}</p>:null}
    <p className="video-jobs-summary" data-video-jobs-summary="true">{view.summary}</p>
    {view.empty
      ? <p className="video-jobs-empty" data-video-jobs-empty-text="true">{view.emptyText}</p>
      : <div className="video-jobs-list">{view.jobs.map(job=><VideoJobCard key={job.jobKey} job={job} isLatest={job.jobKey===latestKey} onCancel={cancel} onRetry={retry}/>)}</div>}
  </section>;
}

export default function GrowthArchiveData({records=[],setToast=()=>{},navigate,pageParams,recordsSource=null,reloadRecords=null,archiveReports=[],setArchiveReports=()=>{},teacherName='',shareTokens=[],recordAudit=()=>{},auditActor=null}){
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
  // 常驻视图的唯一产物：概况 + 时间线 + 被筛掉的条数（界面只读它，不自己过滤一遍）。
  // 时间线每一行还带**转发状态**（US-209）：按档案记录 id 在令牌账里查，三态与打开次数都从 data 层推出来。
  const view=useMemo(()=>archiveResidentView({records,target,student,className,period,absenceOnly:absenceFilter===ARCHIVE_ABSENCE_ONLY,tokens:shareTokens}),[records,target,student,className,period,absenceFilter,shareTokens]);
  // 帧清单（[第四步 US-215]）读的是**生成周期**（`videoPeriod`）而不是上面那个「周期筛选」：
  // 筛选是「看什么」，视频是「生成什么」—— 两件事各用各的窗口，与提交时的任务口径一致。
  const videoEntries=useMemo(()=>archiveResidentView({records,target,student,className,period:videoPeriod,absenceOnly:false,tokens:shareTokens}).entries,[records,target,student,className,videoPeriod,shareTokens]);
  // 个人成长视频时间线（[第四步 US-217]）读的是这个周期的**全部记录**（不带对象筛选）：
  // 「只收录该学员自己的作品」交给数据层保证（它自己按 `entry.student` 过滤，并把其他学员的记录如实报数），
  // 不靠这里传对了参数 —— 传错了也串不进去。
  const videoScopeEntries=useMemo(()=>filterArchiveRecordsByPeriod(records,resolveArchivePeriod(videoPeriod)).map(record=>archiveLessonEntry(record,{tokens:shareTokens})),[records,videoPeriod,shareTokens]);
  // 班级视频集锦（[第四步 US-218]）读的是**这个班级**在这个周期的记录 + 班级名单（顺序真源）：
  // 分段顺序默认就是名单的顺序，名单之外但本期有记录的学员由数据层接在后面（并如实报数）。
  const videoClassEntries=useMemo(()=>{
    if(!view.isClass) return [];
    const className=view.name;
    return filterArchiveRecordsByPeriod(records,resolveArchivePeriod(videoPeriod))
      .filter(record=>String((record&&record.className)||'').trim()===className)
      .map(record=>archiveLessonEntry(record,{tokens:shareTokens}));
  },[records,videoPeriod,view.isClass,view.name,shareTokens]);
  const classRoster=useMemo(()=>{
    if(!view.isClass) return [];
    const className=view.name;
    return management.students
      .filter(item=>String((item&&item.className)||'').trim()===className)
      .map(item=>String((item&&item.name)||'').trim())
      .filter(Boolean);
  },[management,view.isClass,view.name]);
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
        <VideoJobsPanel isClass={view.isClass} objectName={view.name} period={videoPeriod} onPeriod={setVideoPeriod} lessonCount={view.summary.lessons} artworkCount={view.summary.artworks} photoCount={view.summary.photos} teacherName={teacherName} setToast={setToast} entries={videoEntries} scopeEntries={videoScopeEntries} classEntries={videoClassEntries} roster={classRoster} tokens={shareTokens}/>
        <section className="archive-perf-panel" data-archive-perf="true" data-archive-perf-measured={String(perfChecks.measured)} data-archive-perf-total={String(perfChecks.total)} data-archive-perf-all-ok={perfChecks.allOk?'true':'false'} data-archive-perf-summary-text={perfChecks.summary}>
          <div className="archive-perf-head"><Gauge size={15}/><b>档案性能</b><em data-archive-perf-summary="true">{perfChecks.summary}</em><small>{ARCHIVE_PERF_HINT}</small></div>
          <ul className="archive-perf-list">{perfChecks.rows.map(row=><li key={row.id} data-archive-perf-row={row.id} data-archive-perf-state={row.ok===null?'pending':row.ok?'ok':'over'} data-archive-perf-value={row.value} data-archive-perf-budget={row.budget} data-archive-perf-text={row.text}>
            <b>{row.label}</b><span data-archive-perf-row-value="true">{row.value||'待测'}{row.budget?` / ${row.budget}`:''}</span><em>{row.text}</em>
          </li>)}</ul>
        </section>
        <div className="report-footer"><span>家长看到的与这里同一份内容：只含成品素材与老师确认后的点评。</span><div><button onClick={downloadAssets} data-archive-download="true"><Download size={17}/>下载成品</button><button className="primary" onClick={()=>setToast(ARCHIVE_SHARE_LINK_NOTE)}><MessageSquareText size={17}/>一键转发家长</button></div></div>
      </>:null}
    </section>
  </>;
}
