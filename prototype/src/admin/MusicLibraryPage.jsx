// 管理员端「音乐库」：[第四步 US-220a] / F-ARCHIVE-MUSIC-01 / FR-289 ~ FR-294。
//
// 这一页是老师端「背景音乐选择」（US-221）的数据源：老师只能看到 `confirmed` 且未过期的曲目，
// 所以授权状态必须能在后台被**如实维护**，而不是写死在代码里。
//
// 三条写入纪律（与「课程库」同一套）：
//  ① **新建入库默认 `pending`**：新增曲目的路径走 `createMusicTrack`，data 层强制把状态收成 pending，
//     这一页连状态选择器都不给（只显示一句「入库后待确认授权」的解释）；
//  ② 写入一律走 `services/musicLibraryApi.js`（它自己负责「先落本机镜像再推云端」），
//     云端不通时仍要更新 React state —— 否则下一次 persist 会用不含它的旧列表覆盖镜像；
//  ③ **删除前必须说清有多少成片引用过它**：引用范围由 `data/musicTracks.js` 的
//     `musicLibraryRows` 一次算好（列表与编辑区读同一份），删除确认里点名数量。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Music, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Button, PageHeader } from '../ui';
import {
  MUSIC_LIBRARY_DEMO_LABEL,
  MUSIC_LIBRARY_LICENSE_NOTE,
  MUSIC_LICENSE_STATUS_IDS,
  MUSIC_LICENSE_TYPE_OPTIONS,
  MUSIC_MOOD_OPTIONS,
  MUSIC_SOURCE_PROVIDER_OPTIONS,
  MUSIC_TRACK_EMPTY_TEXT,
  MUSIC_TRACK_UNNAMED_TEXT,
  createNewMusicTrack,
  musicLicenseState,
  musicLicenseStatusLabel,
  musicLibraryRows,
  musicTrackCommercialText,
  musicTrackSaveIssue,
  normalizeMusicTrack
} from '../data/musicTracks';
import {
  MUSIC_SOURCE_COPYRIGHT_NOTE,
  MUSIC_SOURCE_IMPORT_NOTE,
  MUSIC_SOURCE_IMPORT_STEPS,
  MUSIC_SOURCE_NO_MATCH_TEXT,
  MUSIC_SOURCE_SEARCH_EMPTY_TEXT,
  MUSIC_SOURCE_UNCONNECTED_LABEL,
  createMusicSourceQuery,
  musicSourceProbeView,
  musicSourceQueryIssue,
  musicSourceQuerySummary,
  musicSourceResultRow
} from '../data/musicSource';
import { importMusicSourceTrack, probeMusicSource, searchMusicSource } from '../services/musicSourceApi';
import { createMusicTrack, deleteMusicTrack, loadMusicReferenceRecords, setMusicTrackEnabled, updateMusicTrack } from '../services/musicLibraryApi';
// 引用范围要数「有多少成片引用过它」：成片任务由视频模块的本机队列持有（US-213a），
// 这一页订阅它（与档案页的 VideoJobsPanel 同一份数据源），引用数字才会随任务变化实时更新。
import { listVideoJobs, subscribeVideoJobs } from '../services/videoJobQueue';

/** 曲目 → 可编辑草稿：数字字段按字符串存（空行才好输入），情绪数组换成顿号分隔的文本。 */
function draftFromTrack(track) {
  const item = normalizeMusicTrack(track);
  return {
    trackKey: item.trackKey,
    title: item.title,
    artist: item.artist,
    durationSec: item.durationSec ? String(item.durationSec) : '',
    bpm: item.bpm ? String(item.bpm) : '',
    mood: item.mood.join('、'),
    sourceUrl: item.sourceUrl,
    sourceProvider: item.sourceProvider,
    licenseType: item.licenseType,
    licenseProofUrl: item.licenseProofUrl,
    licenseStatus: item.licenseStatus,
    licenseExpiresAt: item.licenseExpiresAt,
    commercialUse: item.commercialUse === true,
    // 入库文件由「搜索与下载入库」（US-220b）写入，这里只读展示、保存时原样带回。
    fileKey: item.fileKey,
    fileUrl: item.fileUrl,
    hash: item.hash,
    createdBy: item.createdBy
  };
}

/** 草稿 → 领域字段（time / bpm / mood 交给 normalizeMusicTrack 收敛，页面不自己解析）。 */
function payloadFromDraft(draft) {
  return {
    title: String(draft.title || '').trim(),
    artist: String(draft.artist || '').trim(),
    durationSec: draft.durationSec,
    bpm: draft.bpm,
    mood: String(draft.mood || ''),
    sourceUrl: String(draft.sourceUrl || '').trim(),
    sourceProvider: String(draft.sourceProvider || '').trim(),
    licenseType: String(draft.licenseType || '').trim(),
    licenseProofUrl: String(draft.licenseProofUrl || '').trim(),
    licenseStatus: draft.licenseStatus,
    licenseExpiresAt: draft.licenseExpiresAt,
    commercialUse: draft.commercialUse === true,
    fileKey: draft.fileKey,
    fileUrl: draft.fileUrl,
    hash: draft.hash
  };
}

/**
 * 「从授权曲源搜索 + 下载入库」面板（[第四步 US-220b] / FR-289 ~ FR-297）。
 *
 * 这条面板的全部规矩都在验收原文里，逐条落在这里：
 *  ① 搜索入口与四个过滤条件（关键词 / 情绪 / 时长 / BPM）是真的：条件归一化与查询串在
 *     `data/musicSource.js`，服务层照它发请求；
 *  ② 搜索框下方**常驻**版权提示（`MUSIC_SOURCE_COPYRIGHT_NOTE`，FR-296 的原文，一个字不改）；
 *  ③ 未配置授权曲源时只显示验收原文那句「未配置授权曲源」，结果列表保持为空 ——
 *     **不返回假数据**（本文件与 data 层都没有任何演示结果数组）；
 *  ④ 下载入库按契约走服务端（抓取 → 探测格式 → 转码 → 去重）；失败原因（防盗链 / 超时 / 格式不支持）
 *     来自服务端失败码的翻译，**不凭空编原因**；每条失败记录都带「重试」；
 *     转码与去重是服务端 TODO，面板上如实标注「尚未接入」（`MUSIC_SOURCE_IMPORT_NOTE`）。
 */
function MusicSourcePanel({ onImported, setToast }) {
  const [query, setQuery] = useState(() => createMusicSourceQuery());
  const [probe, setProbe] = useState(null);
  const [checking, setChecking] = useState(true);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [notice, setNotice] = useState('');
  const [imports, setImports] = useState([]);
  const seqRef = useRef(0);

  const view = useMemo(() => musicSourceProbeView(checking ? null : probe), [checking, probe]);

  // 进页面就探测一次：曲源配没配是「当前事实」，不该让管理员先搜一次才知道。
  useEffect(() => {
    let alive = true;
    probeMusicSource().then(result => { if (alive) { setProbe(result); setChecking(false); } });
    return () => { alive = false; };
  }, []);

  const runProbe = async () => {
    setChecking(true);
    const result = await probeMusicSource();
    setProbe(result);
    setChecking(false);
  };

  const patch = (key, value) => setQuery(current => ({ ...current, [key]: value }));

  const runSearch = async () => {
    const issue = musicSourceQueryIssue(query);
    if (issue) { setNotice(issue); setResults([]); return; }
    setSearching(true);
    setNotice('');
    try {
      const out = await searchMusicSource(query);
      setResults(out.results);
      setNotice(out.results.length
        ? `找到 ${out.results.length} 条结果${out.dropped ? `；另有 ${out.dropped} 条结果字段不全，已如实忽略（不猜元数据）` : ''}。`
        : MUSIC_SOURCE_NO_MATCH_TEXT);
    } catch (error) {
      setResults([]);
      setNotice(String((error && error.message) || '搜索失败。'));
    } finally {
      setSearching(false);
    }
  };

  const updateImport = (id, patchValue) => setImports(list => list.map(item => (item.id === id ? { ...item, ...patchValue } : item)));

  const runImport = async (id, candidate, attempts) => {
    updateImport(id, {
      status: 'downloading',
      attempts,
      failureCode: '',
      text: `正在下载入库：${MUSIC_SOURCE_IMPORT_STEPS.map(step => step.label).join(' → ')}…`
    });
    try {
      const out = await importMusicSourceTrack(candidate);
      onImported(out.track);
      updateImport(id, {
        status: 'imported',
        trackKey: out.track.trackKey,
        text: `已入库「${out.track.title}」：授权状态「待确认授权」，确认后老师端才可选。`
      });
      setToast(`曲目「${out.track.title}」已从授权曲源入库；授权状态为「待确认授权」，确认后老师端才可选。`);
    } catch (error) {
      const message = String((error && error.message) || '下载入库失败。');
      updateImport(id, { status: 'failed', failureCode: String((error && error.failureCode) || ''), text: message });
      setToast(message);
    }
  };

  const startImport = candidate => {
    seqRef.current += 1;
    const id = `source-import-${seqRef.current}`;
    setImports(list => [{ id, candidate, attempts: 0, status: 'downloading', failureCode: '', text: '' }, ...list]);
    runImport(id, candidate, 1);
  };

  const retryImport = attempt => runImport(attempt.id, attempt.candidate, attempt.attempts + 1);

  const rows = results.map(musicSourceResultRow);
  const downloading = imports.filter(item => item.status === 'downloading').map(item => item.candidate.sourceUrl);
  const emptyText = view.state === 'unconfigured' ? view.text : MUSIC_SOURCE_SEARCH_EMPTY_TEXT;

  return <div className="panel music-source" data-music-source data-music-source-state={view.state} data-music-source-count={results.length} data-music-source-imports={imports.length}>
    <div className="panel-head">
      <div>
        <h2>从授权曲源搜索</h2>
        <p>服务端代理调用已签约的授权曲源（密钥不下发前端），支持关键词 / 情绪 / 时长 / BPM 过滤。</p>
      </div>
      <div className="row-actions">
        <span className="music-source-contract-label" data-music-source-label>{MUSIC_SOURCE_UNCONNECTED_LABEL}</span>
        <Button variant="secondary" data-music-source-probe onClick={runProbe}>{checking ? '探测中…' : '重新探测'}</Button>
      </div>
    </div>

    <div className="music-source-search" data-music-source-filters>
      <label>关键词<input value={query.keyword} data-music-source-field="keyword" placeholder="曲名 / 作者" onChange={event => patch('keyword', event.target.value)}/></label>
      <label>情绪<select value={query.mood} data-music-source-field="mood" onChange={event => patch('mood', event.target.value)}><option value="">全部情绪</option>{MUSIC_MOOD_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
      <label>时长（秒）<span className="music-source-range"><input type="number" min="0" value={query.durationMin || ''} data-music-source-field="durationMin" placeholder="下限" onChange={event => patch('durationMin', event.target.value)}/><em>–</em><input type="number" min="0" value={query.durationMax || ''} data-music-source-field="durationMax" placeholder="上限" onChange={event => patch('durationMax', event.target.value)}/></span></label>
      <label>BPM<span className="music-source-range"><input type="number" min="0" value={query.bpmMin || ''} data-music-source-field="bpmMin" placeholder="下限" onChange={event => patch('bpmMin', event.target.value)}/><em>–</em><input type="number" min="0" value={query.bpmMax || ''} data-music-source-field="bpmMax" placeholder="上限" onChange={event => patch('bpmMax', event.target.value)}/></span></label>
      <Button icon={Search} data-music-source-search onClick={runSearch}>{searching ? '搜索中…' : '搜索'}</Button>
    </div>
    {/* 搜索框下方的常驻版权提示（FR-296）：不随探测 / 搜索状态消失，也不进任何折叠。 */}
    <p className="music-source-copyright" data-music-source-copyright>{MUSIC_SOURCE_COPYRIGHT_NOTE}</p>
    <p className="music-source-summary" data-music-source-summary>{musicSourceQuerySummary(query)}</p>
    <p className="music-source-state" data-music-source-state-text>{view.text}</p>
    <p className="music-source-note" data-music-source-note>{MUSIC_SOURCE_IMPORT_NOTE}</p>
    {notice ? <p className="music-source-notice" data-music-source-notice>{notice}</p> : null}

    {rows.length ? <div className="music-source-results" data-music-source-results>
      {rows.map((row, index) => {
        const candidate = results[index];
        const busy = downloading.includes(candidate.sourceUrl);
        return <div className="music-source-result" key={row.id || index} data-music-source-result={row.id || index} data-music-source-result-url={candidate.sourceUrl}>
          <div>
            <b>{row.name}</b>
            <small>{row.meta}{row.mood ? ` · ${row.mood}` : ''}</small>
            <small>{row.sourceProvider} · {row.licenseType}</small>
          </div>
          <Button variant="secondary" data-music-source-import-btn={row.id || index} onClick={() => startImport(candidate)}>{busy ? '下载中…' : '下载入库'}</Button>
        </div>;
      })}
    </div> : <p className="persona-empty" data-music-source-empty>{emptyText}</p>}

    {imports.length ? <div className="music-source-imports" data-music-source-imports>
      {imports.map(item => <p key={item.id} className={`music-source-import is-${item.status}`} data-music-source-import={item.id} data-music-source-import-status={item.status} data-music-source-import-code={item.failureCode || ''} data-music-source-import-attempts={item.attempts}>
        <b>{item.candidate.title || item.candidate.sourceUrl}</b>
        <span data-music-source-import-text>{item.text}</span>
        {item.status === 'failed' ? <Button variant="secondary" data-music-source-import-retry onClick={() => retryImport(item)}>重试</Button> : null}
      </p>)}
    </div> : null}
  </div>;
}

export default function MusicLibraryPage({ musicTracks = [], setMusicTracks, setToast, adminName = '' }) {
  const operator = String(adminName || '平台管理员');
  const [videos, setVideos] = useState(() => listVideoJobs());
  useEffect(() => subscribeVideoJobs(rows => setVideos(rows)), []);
  // 引用统计的数据源 = 队列里跑着的任务 ∪ 镜像里的**原始记录行**（见 loadMusicReferenceRecords）：
  // 归一化会丢掉记录上将来才有的字段（成片选了哪首曲子是 US-221 才写进去的），
  // 只读队列行会让这个数字永远停在 0。
  const [records, setRecords] = useState(() => loadMusicReferenceRecords());
  useEffect(() => { setRecords(loadMusicReferenceRecords()); }, [videos]);
  const rows = useMemo(() => musicLibraryRows(musicTracks, { videos: records }), [musicTracks, records]);
  const [editingKey, setEditingKey] = useState(() => rows[0]?.trackKey || '');
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 编辑用的值取自**原始曲目**（`musicTracks`），列表行只用来显示引用范围与删除结论 ——
  // 列表行是渲染产物（`meta` 把时长拼成一句话、情绪拼成字符串），拿它当草稿会丢掉
  // `licenseStatus` / `licenseExpiresAt` / `commercialUse` 这些字段（保存后状态被重置成 pending）。
  const source = isNew ? null : (Array.isArray(musicTracks) ? musicTracks : []).find(item => normalizeMusicTrack(item).trackKey === editingKey) || null;
  const track = source ? normalizeMusicTrack(source) : null;
  const editing = source ? rows.find(row => row.trackKey === editingKey) || null : null;

  // 选中项变了（或云端水合回来刷新了库）就重置草稿，避免拿旧内容覆盖新数据。
  useEffect(() => {
    if (isNew) return;
    setDraft(track ? draftFromTrack(track) : null);
    setError('');
  }, [editingKey, musicTracks, isNew]);

  const patch = (key, value) => setDraft(current => (current ? { ...current, [key]: value } : current));

  /** 保存成功后把这一条并回列表（同 trackKey 覆盖），成功与云端失败两条路径共用。 */
  const commit = (saved) => setMusicTracks(current => {
    const rest = (Array.isArray(current) ? current : []).filter(item => item?.trackKey !== saved.trackKey);
    return [...rest, saved];
  });

  const startNew = () => {
    setIsNew(true);
    setEditingKey('');
    setConfirmDelete(false);
    setError('');
    // 新曲目的 trackKey 现在就要定下来：入库时沿用它，云端推不上去时列表与镜像也是同一条记录。
    setDraft(draftFromTrack(createNewMusicTrack({})));
  };

  const validate = () => {
    if (!draft) return '';
    return musicTrackSaveIssue(payloadFromDraft({ ...draft, trackKey: draft.trackKey || 'track-new' }));
  };

  const save = async () => {
    if (!draft) return;
    const reason = validate();
    if (reason) { setError(reason); return; }
    setError('');
    setSaving(true);
    const payload = payloadFromDraft(draft);
    try {
      if (isNew) {
        // createMusicTrack 内部把授权状态强制成 pending（FR-293），传进来的 draft 状态不作数。
        const created = await createMusicTrack({ ...payload, createdBy: operator });
        commit(created);
        setIsNew(false);
        setEditingKey(created.trackKey);
        setToast(`曲目「${created.title}」已入库；授权状态为「待确认授权」，确认后老师端才可选。`);
      } else {
        const saved = await updateMusicTrack(draft.trackKey, payload, { existingTracks: musicTracks });
        commit(saved);
        setToast(`曲目「${saved.title}」已更新`);
      }
    } catch {
      // 服务层在推云端之前已经写过本机镜像：这里必须把这一条并回 state，
      // 否则下一次 persistMusicTracks 会用不含它的旧列表把镜像覆盖掉（刷新就丢）。
      const local = normalizeMusicTrack({ ...payload, trackKey: draft.trackKey, createdBy: draft.createdBy || operator });
      commit(local);
      if (isNew) {
        setIsNew(false);
        setEditingKey(local.trackKey);
      }
      setToast('已保存到本机；云端暂未连通，稍后可重试。');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (row, enabled) => {
    setConfirmDelete(false);
    try {
      const saved = await setMusicTrackEnabled(row.trackKey, enabled, { existingTracks: musicTracks });
      commit(saved);
      setToast(enabled ? `曲目「${saved.title}」已启用` : `曲目「${saved.title}」已停用；老师端不再出现。`);
    } catch {
      const local = normalizeMusicTrack({ ...normalizeMusicTrack(row), enabled });
      commit(local);
      setToast('已保存到本机；云端暂未连通，稍后可重试。');
    }
  };

  const remove = async () => {
    const target = editing;
    if (!target) return;
    setConfirmDelete(false);
    setIsNew(false);
    setMusicTracks(current => (Array.isArray(current) ? current : []).filter(item => item?.trackKey !== target.trackKey));
    setEditingKey(rows.filter(row => row.trackKey !== target.trackKey)[0]?.trackKey || '');
    try {
      await deleteMusicTrack(target.trackKey);
      setToast(`曲目「${target.name}」已删除`);
    } catch {
      setToast('已从本机移除，云端删除未同步。');
    }
  };

  const state = track ? musicLicenseState(track) : null;
  const usage = editing?.usage || null;
  const deleteVerdict = editing?.deleteVerdict || null;
  const referencedCount = rows.filter(row => row.usage.referenced).length;

  return <>
    <PageHeader
      title="音乐库"
      desc="机构可用的背景音乐在这里维护：入库默认「待确认授权」，确认且未过期后老师端才能选到；删除前会提示有多少成片引用过它。"
      prd="PRD-15 / F-ARCHIVE-MUSIC-01"
      actions={<Button icon={Plus} onClick={startNew} data-music-new>新增曲目</Button>}
    />
    {/* US-220b：从授权曲源搜索 + 下载入库（接口契约）；曲源未配置时只如实提示，不返回假数据 */}
    <MusicSourcePanel onImported={commit} setToast={setToast}/>
    <div className="split-page music-library" data-music-library data-music-library-count={rows.length} data-music-library-referenced={referencedCount}>
      <div className="panel persona-list">
        <div className="panel-head">
          <h2>曲目</h2>
          <small>{rows.length} 首{referencedCount ? ` · ${referencedCount} 首被成片引用过` : ''}</small>
        </div>
        {rows.map(row => <button
          key={row.trackKey}
          className={!isNew && row.trackKey === editingKey ? 'active' : ''}
          data-music-track={row.trackKey}
          data-music-track-status={row.status}
          data-music-track-enabled={row.enabled ? 'true' : 'false'}
          data-music-track-references={row.usage.count}
          onClick={() => { setIsNew(false); setEditingKey(row.trackKey); setConfirmDelete(false); }}
        >
          <span className={`music-license-chip is-${row.status}`} data-music-track-chip={row.status}>{row.enabled === false ? '已停用' : musicLicenseStatusLabel(row.status)}</span>
          <div>
            <b>{row.name}</b>
            <small>{row.meta}{row.mood ? ` · ${row.mood}` : ''}</small>
          </div>
          <em>{row.usage.referenced ? `引用 ${row.usage.count}` : row.sourceProvider}</em>
        </button>)}
        {rows.length ? null : <p className="persona-empty" data-music-empty>{MUSIC_TRACK_EMPTY_TEXT}</p>}
        <p className="persona-empty">
          <span className="music-demo-label" data-music-demo-label>{MUSIC_LIBRARY_DEMO_LABEL}</span>
          {' '}演示曲目覆盖「已确认 / 待确认 / 到期 / 已停用」几种情形；搜索与下载入库按接口契约实现（见上方面板，授权曲源本身仍未接入），也可在右侧手工录入。
        </p>
        <p className="persona-empty">{MUSIC_LIBRARY_LICENSE_NOTE}</p>
      </div>

      <div className="panel persona-editor" data-music-editor={draft?.trackKey || ''} data-music-editor-new={isNew ? 'true' : 'false'} data-music-editor-status={draft?.licenseStatus || ''}>
        {draft ? <>
          <div className="panel-head">
            <div>
              <h2>{isNew ? '新增曲目（手工入库）' : (draft.title || MUSIC_TRACK_UNNAMED_TEXT)}</h2>
              <p>
                {isNew
                  ? '保存后进入音乐库，授权状态为「待确认授权」；确认授权后老师端才可选。'
                  : <>曲目 ID <code>{draft.trackKey}</code> · 老师端{state?.selectable ? '可选' : '不可选'} · 更新人 {operator}</>}
              </p>
            </div>
            <div className="row-actions">
              {isNew ? null : <>
                <Button variant="secondary" data-music-toggle onClick={() => toggleEnabled(editing, editing.enabled === false)}>
                  {editing.enabled === false ? '启用' : '停用'}
                </Button>
                <button className="icon-btn danger-text" title="删除曲目" data-music-delete onClick={() => setConfirmDelete(true)}><Trash2 size={16}/></button>
              </>}
              <Button onClick={save} disabled={saving} data-music-save>{saving ? '保存中…' : (isNew ? '入库并保存' : '保存修改')}</Button>
            </div>
          </div>

          {isNew ? <p className="persona-empty" data-music-new-note>
            <ShieldCheck size={14}/> 新入库曲目一律先落「待确认授权」（来源不清的音乐不得进老师端）；查过授权凭证后再把状态改成「已确认授权」。
          </p> : null}

          <div className="persona-skills">
            <div className="panel-head"><div><h3>曲目元数据</h3><p>列表与老师端选择器显示的就是这几项（FR-292）。</p></div></div>
            <div className="form-grid compact">
              <label>曲目标题<input value={draft.title} data-music-field="title" placeholder="例如：晨光里的小森林" onChange={event => patch('title', event.target.value)}/></label>
              <label>作者 / 团队<input value={draft.artist} data-music-field="artist" placeholder="例如：木野工作室" onChange={event => patch('artist', event.target.value)}/></label>
              <label>时长（秒）<input type="number" min="0" value={draft.durationSec} data-music-field="durationSec" placeholder="留空表示未知" onChange={event => patch('durationSec', event.target.value)}/></label>
              <label>BPM<input type="number" min="0" value={draft.bpm} data-music-field="bpm" placeholder="留空表示未标注" onChange={event => patch('bpm', event.target.value)}/></label>
              <label>情绪标签（顿号 / 逗号分隔）<input list="music-mood-options" value={draft.mood} data-music-field="mood" placeholder="例如：温暖、安静" onChange={event => patch('mood', event.target.value)}/></label>
              <label>来源平台<input list="music-provider-options" value={draft.sourceProvider} data-music-field="sourceProvider" placeholder="例如：演示曲库" onChange={event => patch('sourceProvider', event.target.value)}/></label>
              <label>来源地址（来源 URL，去重用）<input value={draft.sourceUrl} data-music-field="sourceUrl" placeholder="https://…" onChange={event => patch('sourceUrl', event.target.value)}/></label>
            </div>
            <datalist id="music-mood-options">{MUSIC_MOOD_OPTIONS.map(option => <option key={option} value={option}/>)}</datalist>
            <datalist id="music-provider-options">{MUSIC_SOURCE_PROVIDER_OPTIONS.map(option => <option key={option} value={option}/>)}</datalist>
          </div>

          <div className="persona-skills" data-music-license>
            <div className="panel-head"><div><h3>授权信息</h3><p>{state ? <>当前结论：{state.label}。{state.note}</> : null}</p></div></div>
            <div className="form-grid compact">
              <label>授权类型<input list="music-license-type-options" value={draft.licenseType} data-music-field="licenseType" placeholder="例如：免版税商用授权" onChange={event => patch('licenseType', event.target.value)}/></label>
              <label>授权凭证地址<input value={draft.licenseProofUrl} data-music-field="licenseProofUrl" placeholder="https://…（凭证文件或截图）" onChange={event => patch('licenseProofUrl', event.target.value)}/></label>
              <label>授权状态
                {isNew
                  ? <input value={musicLicenseStatusLabel('pending')} data-music-field="licenseStatus" readOnly disabled/>
                  : <select value={draft.licenseStatus} data-music-field="licenseStatus" onChange={event => patch('licenseStatus', event.target.value)}>
                    {MUSIC_LICENSE_STATUS_IDS.map(id => <option key={id} value={id}>{musicLicenseStatusLabel(id)}</option>)}
                  </select>}
              </label>
              <label>授权到期日<input type="date" value={draft.licenseExpiresAt} data-music-field="licenseExpiresAt" onChange={event => patch('licenseExpiresAt', event.target.value)}/></label>
              <div className="span-2 music-commercial-row" style={{ alignSelf: 'end', paddingBottom: 10 }}>
                <label className="framing-enable" data-music-commercial>
                  <input type="checkbox" checked={draft.commercialUse === true} onChange={event => patch('commercialUse', event.target.checked)}/> 可商用（授权允许商业使用）
                </label>
                <small data-music-commercial-text>{musicTrackCommercialText({ ...draft, trackKey: draft.trackKey || 'track-new' })}</small>
              </div>
            </div>
            <datalist id="music-license-type-options">{MUSIC_LICENSE_TYPE_OPTIONS.map(option => <option key={option} value={option}/>)}</datalist>
          </div>

          <div className="persona-skills">
            <div className="panel-head"><div><h3>入库文件</h3><p>下载入库（US-220b）会写入文件键、文件地址与去重 hash；这里只读展示。</p></div></div>
            <p className="persona-empty" data-music-file>
              文件键：<code>{draft.fileKey || '—'}</code> · 文件地址：<code data-music-file-url>{draft.fileUrl || '—'}</code> · hash：<code>{draft.hash || '—'}</code>
            </p>
          </div>

          {editing ? <p className="persona-empty" data-music-usage>
            <Music size={14}/> {editing.usageText}
            {usage?.references?.length ? <> 最近引用：{usage.references.slice(0, 3).map(item => `${item.name || item.id}（第 ${Math.max(1, item.version)} 版）`).join(' · ')}</> : null}
          </p> : null}

          {error ? <div className="form-error" data-music-error><CircleAlert size={16}/>{error}</div> : null}

          {confirmDelete && deleteVerdict ? <div className="danger-note" style={{ marginTop: 18 }} data-music-delete-note={editing.usage.count}>
            <CircleAlert size={18}/>
            <span style={{ flex: 1 }}>
              {editing.usage.count
                ? <>有 <b>{editing.usage.count}</b> 条成片引用过「{editing.name}」{editing.usage.versionCount > editing.usage.count ? `（含 ${editing.usage.versionCount} 处历史版本引用）` : ''}。</>
                : null}
              {' '}{deleteVerdict.message}
            </span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>取消</Button>
              <Button variant="danger" onClick={remove} data-music-delete-confirm>确认删除</Button>
            </span>
          </div> : null}
        </> : <p className="persona-empty"><Music size={16}/> 选择左侧的一首曲目，或点右上角「新增曲目」。</p>}
      </div>
    </div>
  </>;
}
