import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Download, FileText, Frame, MessageSquareText, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
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
  archiveResidentPhase,
  archiveResidentStateView,
  archiveResidentView
} from './data/archiveResident';
import { ARCHIVE_SHARE_LINK_NOTE } from './data/archiveSummary';
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
import { Button } from './ui';

/** 一节课在时间线上的卡：日期与作品名 · 成品作品图 · 课堂照片 · 五维点评摘要 · 转发状态（US-209）。 */
function ResidentLesson({entry}){
  return <article className="archive-lesson" data-archive-lesson="true" data-archive-lesson-id={entry.id} data-archive-lesson-date={entry.date} data-archive-lesson-status={entry.status} data-archive-lesson-plaque={entry.dateDots} data-archive-lesson-dimensions={entry.dimensionCount} data-archive-lesson-photos={entry.photoCount} data-archive-lesson-forward={entry.forward.state} data-archive-lesson-forward-label={entry.forward.stateLabel} data-archive-lesson-forward-opens={String(entry.forward.openCount)} data-archive-lesson-forward-text={entry.forward.line}>
    <div className="history-art" data-archive-lesson-artwork={entry.artwork.url?'ok':'empty'} data-archive-media-status={entry.artwork.status||''}>
      {entry.artwork.url?<img src={entry.artwork.url} alt={`${entry.title?entry.title+' ':''}成品作品图`} data-archive-lesson-artwork-img="true"/>:entry.artwork.placeholder?<span className="archive-media-placeholder" data-archive-media-hold="true">{entry.artwork.placeholderText}</span>:<Frame/>}
    </div>
    <div className="history-copy">
      <span>{entry.date}{entry.title?` · 《${entry.title}》`:''}</span>
      {entry.dimensions.length?<dl className="history-dimensions">{entry.dimensions.map(row=><div key={row.name}><dt>{row.name}</dt><dd>{row.text}</dd></div>)}</dl>:<p data-archive-lesson-review="empty">老师已记录这节课里值得被看见的创作尝试。</p>}
      <div className="history-photos">
        {entry.photos.length?entry.photos.map((photo,index)=>(photo.url
          ?<img key={`${entry.id}-photo-${index}`} src={photo.url} alt={`${entry.title||entry.date}课堂照片 ${index+1}`} data-archive-lesson-photo="true"/>
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

export default function GrowthArchiveData({records=[],setToast=()=>{},navigate,pageParams,recordsSource=null,reloadRecords=null,archiveReports=[],setArchiveReports=()=>{},teacherName='',shareTokens=[],recordAudit=()=>{},auditActor=null}){
  // 报告生成 / 更新要留痕（[第四步 US-211] 第 4 条：操作人 / 时间 / 对象 / 版本）——
  // 留痕入口与报告写入在同一次动作里（`generateReport`），界面只多显示一行回执。
  const [reportAuditEntry,setReportAuditEntry]=useState(null);
  const [target,setTarget]=useState(ARCHIVE_TARGET_PERSONAL); const [period,setPeriod]=useState(ARCHIVE_PERIOD_FILTER_DEFAULT); const [absenceFilter,setAbsenceFilter]=useState(ARCHIVE_ABSENCE_ALL);
  // 阶段报告（[第四步 US-207a]）的界面 state：两个选择器 + 生成中 / 回执 / 待确认的删除 / 正在回看的历史版本。
  const [reportPeriod,setReportPeriod]=useState(ARCHIVE_PERIOD_DEFAULT); const [reportType,setReportType]=useState(ARCHIVE_REPORT_TYPE_DEFAULT);
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
        <section className="archive-lesson-history" data-archive-timeline="true" data-archive-timeline-count={view.count}>
          <div className="archive-section-head"><span>课次时间线 · 按日期升序</span><h3>{ARCHIVE_TIMELINE_TITLE}</h3><p>{ARCHIVE_TIMELINE_DESC}</p></div>
          <div className="history-list">{view.entries.map(entry=>entry.isAbsence?<ResidentAbsence key={entry.id||entry.recordKey} entry={entry}/>:<ResidentLesson key={entry.id||entry.recordKey} entry={entry}/>)}</div>
        </section>
        <div className="report-footer"><span>家长看到的与这里同一份内容：只含成品素材与老师确认后的点评。</span><div><button onClick={downloadAssets} data-archive-download="true"><Download size={17}/>下载成品</button><button className="primary" onClick={()=>setToast(ARCHIVE_SHARE_LINK_NOTE)}><MessageSquareText size={17}/>一键转发家长</button></div></div>
      </>:null}
    </section>
  </>;
}
