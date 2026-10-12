import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Download, Frame, MessageSquareText, Plus, RefreshCw, Sparkles } from 'lucide-react';
// 档案页的「常驻视图」（[第四步 US-206]）：
//  - 对象 / 周期 / 缺课筛选的**可选项、默认选中、过滤、空态**在 `data/archiveTargets.js` 与
//    `data/archiveResident.js` 两份零依赖模块里，组件只渲染它们的产物（一个名字都不写死）；
//  - 「进页面先看到内容」靠的是**没有生成步骤**：概况 + 时间线在组件 body 里无条件算出来，
//    只有数据源还在读 / 读失败 / 真的一条都没有时才渲染状态面板（US-206 第 1、5 条）。
//  - 「切换只过滤不重置内容」：学员 / 班级 / 周期 / 缺课筛选都只改筛选 state，
//    时间线、概况、空态当场跟着换，周期与已选对象一律保留。
import { loadStudentManagement } from './data/studentManagement';
import {
  ARCHIVE_PERIOD_FILTER_DEFAULT,
  ARCHIVE_PERIOD_FILTERS,
  ARCHIVE_TARGET_CLASS,
  ARCHIVE_TARGET_PERSONAL,
  archiveTargetLists,
  archiveTargetOptions,
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
import { Button } from './ui';

/** 一节课在时间线上的卡：日期与作品名 · 成品作品图 · 课堂照片 · 五维点评摘要。 */
function ResidentLesson({entry}){
  return <article className="archive-lesson" data-archive-lesson="true" data-archive-lesson-id={entry.id} data-archive-lesson-date={entry.date} data-archive-lesson-status={entry.status} data-archive-lesson-plaque={entry.dateDots} data-archive-lesson-dimensions={entry.dimensionCount} data-archive-lesson-photos={entry.photoCount}>
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
    </div>
  </article>;
}

/** 缺课记录：保留现有的温暖缺课文案（US-206 点名要保留的那一段）。 */
function ResidentAbsence({entry}){
  return <article className="archive-absence" data-archive-lesson="true" data-archive-lesson-id={entry.id} data-archive-lesson-date={entry.date} data-archive-lesson-status={entry.status} data-archive-lesson-absence="true">
    <span>{entry.date}</span>
    <div><b>这节课，我们先为孩子轻轻留下一页。</b><p>{entry.absenceText}</p></div>
  </article>;
}

export default function GrowthArchiveData({records=[],setToast=()=>{},navigate,pageParams,recordsSource=null,reloadRecords=null}){
  const [target,setTarget]=useState(ARCHIVE_TARGET_PERSONAL); const [period,setPeriod]=useState(ARCHIVE_PERIOD_FILTER_DEFAULT); const [absenceFilter,setAbsenceFilter]=useState(ARCHIVE_ABSENCE_ALL);
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
  const view=useMemo(()=>archiveResidentView({records,target,student,className,period,absenceOnly:absenceFilter===ARCHIVE_ABSENCE_ONLY}),[records,target,student,className,period,absenceFilter]);
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
        <section className="archive-lesson-history" data-archive-timeline="true" data-archive-timeline-count={view.count}>
          <div className="archive-section-head"><span>课次时间线 · 按日期升序</span><h3>{ARCHIVE_TIMELINE_TITLE}</h3><p>{ARCHIVE_TIMELINE_DESC}</p></div>
          <div className="history-list">{view.entries.map(entry=>entry.isAbsence?<ResidentAbsence key={entry.id||entry.recordKey} entry={entry}/>:<ResidentLesson key={entry.id||entry.recordKey} entry={entry}/>)}</div>
        </section>
        <div className="report-footer"><span>家长看到的与这里同一份内容：只含成品素材与老师确认后的点评。</span><div><button onClick={downloadAssets} data-archive-download="true"><Download size={17}/>下载成品</button><button className="primary" onClick={()=>setToast(ARCHIVE_SHARE_LINK_NOTE)}><MessageSquareText size={17}/>一键转发家长</button></div></div>
      </>:null}
    </section>
  </>;
}
