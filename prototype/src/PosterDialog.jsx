// 一键转发弹窗（[海报 US-308] / FR-327 ~ FR-334）。
//
// 「点一键转发家长 → 弹窗里左侧选模板、右侧看 1:1 实时预览」这一块界面。三件事都在别处：
//   - 规则（入口匹配 / 适用性 / 默认选中 / 空态 / 五类版式的装配）在 `data/posterDialog.js`（零依赖纯函数）；
//   - 落笔（预览 / 缩略图都是同一个 `renderPoster`，只差倍数）在 `services/posterDialog.js`；
//   - 这一块只做两件界面该做的事：**排缩略图的渲染队列**（先出预览、再补小图）与**记账**（两条耗时读数）。
//
// 三条纪律：
//   ① **先预览、后缩略图**：打开弹窗后先把选中模板的 1× 预览画出来（FR-361 的 ≤3 秒预算只留给它），
//      8 张 0.25× 缩略图排在它后面逐张画（`POSTER_DIALOG_THUMB_SCALE`）—— 别一口气发 9 个渲染把首张拖慢。
//   ② 缩略图用**当前对象的真实数据**渲染（FR-329）：每一张都是那一套模板 + 同一份学员 / 周期数据装配出的
//      plan，不是通用示意图，也没有第二份「演示数据」。
//   ③ **换模板有加载态、不闪白**：预览区高度固定，pending 时显示「正在换模板…」而不是空一块 ——
//      老师看到的是「在换」，不是「图没了」。耗时读数由 `posterDialogPerfChecks()` 算（预算是数据层的常量）。
//
// 复用：US-309 的课后反馈第四步入口渲染**同一个组件**（`entry = 'feedback'`、对象带本次课次的 record），
// 因此这里不写任何「成长档案专属」的逻辑（档案页给的是 target / name / students / 周期筛选）。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Loader2, MessageSquareText, Plus, X } from 'lucide-react';
import { Button } from './ui';
import { nowMs } from './services/archivePerformance';
import { loadPosterTemplates } from './data/posterTemplates';
import { listVideoJobs } from './services/videoJobQueue';
import {
  POSTER_TUNING_ARTWORKS_MIN_NOTE,
  POSTER_TUNING_FIELD_ARTWORKS,
  POSTER_TUNING_FIELD_DATE,
  POSTER_TUNING_FIELD_HINTS,
  POSTER_TUNING_FIELD_LABELS,
  POSTER_TUNING_FIELD_QRCODE,
  POSTER_TUNING_FIELD_QUOTE,
  POSTER_TUNING_FIELD_TITLE,
  POSTER_TUNING_LOCKED_NOTE,
  POSTER_TUNING_QUOTE_MAX_CHARS,
  POSTER_TUNING_RESET_LABEL,
  POSTER_TUNING_TITLE_MAX_CHARS,
  applyPosterTuning,
  posterTuningDefaults,
  posterTuningTargets
} from './data/posterTuning';
import {
  POSTER_DIALOG_ARCHIVE_ONLY_NOTE,
  POSTER_DIALOG_ASSET_NOTE,
  POSTER_DIALOG_ENTRY_ARCHIVE,
  POSTER_DIALOG_ENTRY_LABELS,
  POSTER_DIALOG_FIRST_PENDING_TEXT,
  POSTER_DIALOG_PERIOD_OPTIONS,
  POSTER_DIALOG_RENDER_FAILED_TEXT,
  POSTER_DIALOG_SWITCH_PENDING_TEXT,
  POSTER_DIALOG_THUMB_SCALE,
  buildPosterDialogPlan,
  posterDialogEmptyView,
  posterDialogKindSubject,
  posterDialogObject,
  posterDialogPerfChecks,
  posterDialogPeriod,
  posterDialogPeriodNote,
  posterDialogPeriodSource,
  posterDialogPlanKey,
  posterDialogRecords,
  posterDialogSelectTemplate,
  posterDialogSubjectRecord,
  posterDialogTemplateRows
} from './data/posterDialog';
import {
  POSTER_DIALOG_PREVIEW_SCALE,
  createPosterDialogUrl,
  releasePosterDialogUrl,
  renderPosterDialog
} from './services/posterDialog';

/**
 * @param {object} props
 * @param {'archive'|'feedback'} props.entry 入口（成长档案 / 课后反馈第四步）
 * @param {{target?:string,name?:string,record?:object,students?:Array}} props.object 档案页当前选中的对象
 * @param {string} props.periodFilter 档案页的「周期筛选」值（跟随它；`全部` 时回落默认周期并说明）
 */
export default function PosterDialog({
  entry = POSTER_DIALOG_ENTRY_ARCHIVE,
  object = null,
  periodFilter = '',
  records = [],
  lessons = [],
  tokens = [],
  videoRecords = [],
  jobs = null,
  templates = null,
  teacherName = '',
  orgName = '',
  logo = '',
  navigate = null,
  onClose = () => {}
} = {}) {
  const shareOrigin = typeof window === 'undefined' ? '' : (window.location?.origin || '');
  const [period, setPeriod] = useState(() => posterDialogPeriod(periodFilter));
  const [pickedId, setPickedId] = useState('');
  const [preview, setPreview] = useState({ key: '', url: '', phase: 'idle', kind: '', templateId: '', width: 0, height: 0, warnings: [] });
  const [thumbs, setThumbs] = useState({});
  const [perf, setPerf] = useState({ firstPreviewMs: null, switchMs: null });
  // 「文案与作品微调」（[海报 US-310a] / FR-335 ~ FR-339）：老师填的五个字段。
  // 空值 = 不改这一项（留空 = 用原值），因此初始态是「原样」，一个字段都不覆盖。
  const [tuning, setTuning] = useState({ title: '', quote: '', date: '', qrcode: true, artworks: [] });
  const thumbsRef = useRef({});
  const perfRef = useRef({ openAt: nowMs(), requestAt: nowMs(), request: 'open', firstDone: false });
  const tuningSignatureRef = useRef('');

  const templateList = useMemo(() => (Array.isArray(templates) ? templates : loadPosterTemplates()), [templates]);
  const videoJobList = useMemo(() => (Array.isArray(jobs) ? jobs : listVideoJobs()), [jobs]);
  const videoRecordList = useMemo(() => (Array.isArray(videoRecords) ? videoRecords : []), [videoRecords]);
  // 对象（学员 / 班级）与模板清单：规则全在 data 层，这里只读产物。
  const subject = useMemo(() => posterDialogObject({
    target: object && object.target,
    name: object && object.name,
    record: object && object.record,
    students: (object && object.students) || []
  }), [object]);
  const rows = useMemo(() => posterDialogTemplateRows({ templates: templateList, entry, object: subject }), [templateList, entry, subject]);
  const selectedId = useMemo(() => posterDialogSelectTemplate(rows, pickedId), [rows, pickedId]);
  const selectedRow = rows.find((row) => row.id === selectedId) || null;
  const empty = useMemo(() => posterDialogEmptyView({ records, object: subject, period }), [records, subject, period]);
  const recordView = useMemo(() => posterDialogSubjectRecord({ records, object: subject, period }), [records, subject, period]);
  const periodRecords = useMemo(() => posterDialogRecords({ records, object: subject, period }), [records, subject, period]);
  const periodNote = posterDialogPeriodNote(periodFilter, entry);
  const periodSource = posterDialogPeriodSource(periodFilter);
  // 置灰读数（FR-333）：课后反馈入口下「阶段 / 班级 / 封面 / 长图」几套按周期与多幅作品生成的版式
  // 只在成长档案里有数据 —— 这一条把「几套置灰、原因原文是什么」变成可读的一处读数，
  // 界面文案、浏览器断言与验收原文读同一份（不各自数一遍灰按钮）。
  const archiveOnlyRows = rows.filter((row) => !row.applicable && row.reason === POSTER_DIALOG_ARCHIVE_ONLY_NOTE);

  // 每一套模板的 plan（同一个对象 + 同一个周期的真实数据）—— 预览用选中那一份，缩略图逐张用各自那一份。
  const plans = useMemo(() => rows.map((row) => ({
    row,
    plan: row.applicable && !empty.on
      ? buildPosterDialogPlan({
        kind: row.kind,
        template: row.template,
        object: subject,
        period,
        records,
        lessons,
        tokens,
        videoRecords: videoRecordList,
        jobs: videoJobList,
        teacherName,
        orgName,
        logo,
        origin: shareOrigin
      })
      : null
  })), [rows, subject, period, records, lessons, tokens, videoRecordList, videoJobList, teacherName, orgName, logo, shareOrigin, empty.on]);
  // 微调只作用于**这一张要发的海报**（预览 + 导出）：`applyPosterTuning()` 一次给出「哪些项改了、
  // 哪些项这套版式承载不了」。缩略图仍然画模板本身 —— 老师打字时不必把 8 张 0.25× 小图重画一遍
  // （缩略图回答的是「这套模板长什么样」，右侧 1:1 预览回答的是「我这一张现在长什么样」）。
  const tunedPlans = useMemo(() => plans.map((item) => ({
    row: item.row,
    base: item.plan,
    plan: item.plan ? applyPosterTuning(item.plan, tuning) : null
  })), [plans, tuning]);
  const selectedEntry = tunedPlans.find((item) => item.row.id === selectedId) || null;
  const selectedPlan = (selectedEntry && selectedEntry.plan) || null;
  const selectedBase = (selectedEntry && selectedEntry.base) || null;
  // 微调面板读的是**没打补丁**的那一份 plan：可编辑项 / 默认值 / 收录清单都是「改之前」的事实，
  // 界面因此不可能把自己刚打上的补丁当成模板的默认值（那会让「恢复默认」还原成一个假的默认）。
  const tuningTargets = useMemo(() => posterTuningTargets(selectedBase), [selectedBase]);
  const tuningDefaults = useMemo(() => posterTuningDefaults(selectedBase), [selectedBase]);
  const tuningView = selectedPlan && selectedPlan.tuning ? selectedPlan.tuning : null;
  const planKey = posterDialogPlanKey(selectedPlan);
  const plansKey = useMemo(() => plans.map((item) => `${item.row.id}:${posterDialogPlanKey(item.plan)}`).join('~'), [plans]);

  const recordPerf = useCallback((request) => {
    const stamp = nowMs();
    const info = perfRef.current;
    if (request === 'open') {
      info.firstDone = true;
      setPerf((current) => (current.firstPreviewMs === null ? { ...current, firstPreviewMs: Math.max(0, Math.round(stamp - info.openAt)) } : current));
    } else if (request === 'switch') {
      setPerf((current) => ({ ...current, switchMs: Math.max(0, Math.round(stamp - info.requestAt)) }));
    }
  }, []);

  // 预览：随「重绘键」重跑（键里已包含会影响这一张图的所有输入）。先出预览，缩略图排在后面。
  useEffect(() => {
    if (!planKey || !selectedPlan) {
      setPreview({ key: '', url: '', phase: 'idle', kind: '', templateId: '', width: 0, height: 0, warnings: [] });
      return () => {};
    }
    const request = perfRef.current.request;
    let cancelled = false;
    let createdUrl = '';
    setPreview({ key: planKey, url: '', phase: 'pending', kind: selectedRow ? selectedRow.kind : '', templateId: selectedId, width: 0, height: 0, warnings: [] });
    renderPosterDialog(selectedPlan, { scale: POSTER_DIALOG_PREVIEW_SCALE }).then((rendered) => {
      if (cancelled) return;
      if (!rendered || !rendered.blob) {
        setPreview({ key: planKey, url: '', phase: 'failed', kind: selectedRow ? selectedRow.kind : '', templateId: selectedId, width: 0, height: 0, warnings: [] });
        recordPerf(request);
        if (request === 'switch') perfRef.current.request = 'idle';
        return;
      }
      createdUrl = createPosterDialogUrl(rendered);
      setPreview({
        key: planKey,
        url: createdUrl,
        phase: 'ready',
        kind: selectedRow ? selectedRow.kind : '',
        templateId: selectedId,
        width: rendered.width,
        height: rendered.height,
        warnings: rendered.warnings || []
      });
      recordPerf(request);
      if (request === 'switch') perfRef.current.request = 'idle';
    }).catch(() => {
      if (cancelled) return;
      setPreview({ key: planKey, url: '', phase: 'failed', kind: selectedRow ? selectedRow.kind : '', templateId: selectedId, width: 0, height: 0, warnings: [] });
      recordPerf(request);
      if (request === 'switch') perfRef.current.request = 'idle';
    });
    return () => { cancelled = true; if (createdUrl) releasePosterDialogUrl(createdUrl); };
    // 预览只随「重绘键」重跑：selectedPlan / selectedRow 是同一份输入的另一半（键里已有它们的全部尺寸）。
  }, [planKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 缩略图：**首张预览就绪之后**才排队列（一张一张画，画完一张再画下一张）。
  useEffect(() => {
    if (preview.phase !== 'ready' && preview.phase !== 'failed') return () => {};
    let cancelled = false;
    const queue = plans.filter((item) => item.plan && (thumbsRef.current[item.row.id] || {}).key !== posterDialogPlanKey(item.plan));
    const setThumb = (id, value) => { thumbsRef.current = { ...thumbsRef.current, [id]: value }; setThumbs(thumbsRef.current); };
    (async () => {
      for (const item of queue) {
        if (cancelled) return;
        const key = posterDialogPlanKey(item.plan);
        const stale = thumbsRef.current[item.row.id];
        if (stale && stale.key === key && stale.phase === 'ready') continue;
        if (stale && stale.url) releasePosterDialogUrl(stale.url);
        setThumb(item.row.id, { key, phase: 'pending', url: '', width: 0, height: 0 });
        // eslint-disable-next-line no-await-in-loop
        const rendered = await renderPosterDialog(item.plan, { scale: POSTER_DIALOG_THUMB_SCALE }).catch(() => null);
        if (cancelled) return;
        if (!rendered || !rendered.blob) { setThumb(item.row.id, { key, phase: 'failed', url: '', width: 0, height: 0 }); continue; }
        setThumb(item.row.id, { key, phase: 'ready', url: createPosterDialogUrl(rendered), width: rendered.width, height: rendered.height });
      }
    })();
    return () => { cancelled = true; };
  }, [preview.phase, plansKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 关闭时回收所有缩略图地址（预览那一张由它自己的 effect 回收）。
  useEffect(() => () => {
    Object.values(thumbsRef.current).forEach((item) => { if (item && item.url) releasePosterDialogUrl(item.url); });
    thumbsRef.current = {};
  }, []);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 换模板 / 换周期 / 换对象后「收录哪些作品」的清单会变：老选择不再适用，清掉它
  // （留着会把图收空或收错 —— 数据层虽然也有兜底，但界面自己先说清楚更省事）。
  const artworkSignature = tuningTargets.artworks.signature;
  useEffect(() => {
    if (tuningSignatureRef.current === artworkSignature) return;
    tuningSignatureRef.current = artworkSignature;
    setTuning((current) => (current.artworks.length ? { ...current, artworks: [] } : current));
  }, [artworkSignature]);

  const pickTemplate = (row) => {
    if (!row.applicable || row.id === selectedId) return;
    perfRef.current = { ...perfRef.current, requestAt: nowMs(), request: 'switch' };
    setPickedId(row.id);
  };
  const pickPeriod = (value) => {
    // 换周期不是「换模板」：不记进换模板的耗时读数（那是 FR-362 的口径）。
    perfRef.current = { ...perfRef.current, request: 'idle' };
    setPeriod(value);
  };
  // 微调的三个写入点：改一个字段 / 勾掉（或勾回）一幅作品 / 全部恢复默认。
  // **没有「应用」按钮**：改完直接进 state → 重绘键变 → 预览重画（FR-337）。
  const setTuningField = (field, value) => {
    setTuning((current) => ({ ...current, [field]: value }));
  };
  const toggleArtwork = (id) => {
    setTuning((current) => {
      const all = tuningTargets.artworks.items.map((item) => item.id);
      const picked = current.artworks.length ? current.artworks.filter((value) => all.includes(value)) : all;
      const next = picked.includes(id) ? picked.filter((value) => value !== id) : [...picked, id];
      // 勾到一幅不剩：原样保留（至少留一幅，最后一个勾选框在界面上也是禁用的）。
      if (!next.length) return current;
      // 又勾回全选 = 不再覆盖（与数据层的 「全选 = 没改」 同一条口径，重绘键因此稳定）。
      if (next.length === all.length) return (current.artworks.length ? { ...current, artworks: [] } : current);
      return { ...current, artworks: next };
    });
  };
  const resetTuning = () => setTuning({ title: '', quote: '', date: '', qrcode: true, artworks: [] });

  const perfChecks = posterDialogPerfChecks(perf);
  // 微调面板的渲染读数（只算一次：界面不自己数勾选框，也不自己判「改了什么」）。
  const tuningApplied = tuningView ? tuningView.applied : [];
  const tuningActive = tuningApplied.length > 0;
  const artworkItems = tuningTargets.artworks.items;
  const artworkIds = artworkItems.map((item) => item.id);
  const artworkPicked = tuning.artworks.length
    ? tuning.artworks.filter((id) => artworkIds.includes(id))
    : artworkIds;
  const artworkCanUncheck = artworkPicked.length > 1;
  const tuningPanel = empty.on ? null : (
    <section
      className="poster-dialog-tuning"
      data-poster-tuning="true"
      data-poster-tuning-kind={tuningTargets.kind}
      data-poster-tuning-active={tuningActive ? 'true' : 'false'}
      data-poster-tuning-key={tuningView ? tuningView.key : ''}
      data-poster-tuning-applied={tuningApplied.join(',')}
      data-poster-tuning-available={tuningView ? tuningView.available.join(',') : ''}
      data-poster-tuning-locked={tuningView ? tuningView.locked.join(',') : ''}
      data-poster-tuning-ignored={tuningView ? tuningView.ignored.join(',') : ''}
    >
      <header className="poster-dialog-tuning-head">
        <b>文案与作品微调</b>
        <small data-poster-tuning-locked-note="true">{POSTER_TUNING_LOCKED_NOTE}</small>
        <button
          type="button"
          className="text-link"
          data-poster-tuning-reset="true"
          disabled={!tuningActive}
          onClick={resetTuning}
        >{POSTER_TUNING_RESET_LABEL}
        </button>
      </header>
      <div className="poster-dialog-tuning-text">
        <label htmlFor="poster-tuning-title">{POSTER_TUNING_FIELD_LABELS[POSTER_TUNING_FIELD_TITLE]}</label>
        <input
          id="poster-tuning-title"
          type="text"
          className="poster-dialog-tuning-input"
          data-poster-tuning-field={POSTER_TUNING_FIELD_TITLE}
          data-poster-tuning-field-available={tuningTargets.title.available ? 'true' : 'false'}
          data-poster-tuning-field-value={tuning.title}
          data-poster-tuning-field-default={tuningDefaults.title}
          placeholder={tuningTargets.title.available ? (tuningDefaults.title || '用这一套版式的默认标题') : ''}
          disabled={!tuningTargets.title.available}
          value={tuning.title}
          onChange={(event) => setTuningField(POSTER_TUNING_FIELD_TITLE, event.target.value)}
        />
        <small data-poster-tuning-field-note={POSTER_TUNING_FIELD_TITLE}>
          {tuningTargets.title.available
            ? `${POSTER_TUNING_FIELD_HINTS[POSTER_TUNING_FIELD_TITLE]}（${tuning.title.length}/${POSTER_TUNING_TITLE_MAX_CHARS}）`
            : tuningTargets.title.reason}
        </small>
      </div>
      <div className="poster-dialog-tuning-text">
        <label htmlFor="poster-tuning-quote">{POSTER_TUNING_FIELD_LABELS[POSTER_TUNING_FIELD_QUOTE]}</label>
        <textarea
          id="poster-tuning-quote"
          rows={2}
          className="poster-dialog-tuning-input"
          data-poster-tuning-field={POSTER_TUNING_FIELD_QUOTE}
          data-poster-tuning-field-available={tuningTargets.quote.available ? 'true' : 'false'}
          data-poster-tuning-field-value={tuning.quote}
          data-poster-tuning-field-default={tuningDefaults.quote}
          placeholder={tuningTargets.quote.available ? (tuningDefaults.quote || '留空 = 用点评「美术能力」首句') : ''}
          disabled={!tuningTargets.quote.available}
          value={tuning.quote}
          onChange={(event) => setTuningField(POSTER_TUNING_FIELD_QUOTE, event.target.value)}
        />
        <small data-poster-tuning-field-note={POSTER_TUNING_FIELD_QUOTE}>
          {tuningTargets.quote.available
            ? `${POSTER_TUNING_FIELD_HINTS[POSTER_TUNING_FIELD_QUOTE]}（${tuning.quote.length}/${POSTER_TUNING_QUOTE_MAX_CHARS}）`
            : tuningTargets.quote.reason}
        </small>
      </div>
      <div className="poster-dialog-tuning-text">
        <label htmlFor="poster-tuning-date">{POSTER_TUNING_FIELD_LABELS[POSTER_TUNING_FIELD_DATE]}</label>
        <input
          id="poster-tuning-date"
          type="text"
          className="poster-dialog-tuning-input"
          data-poster-tuning-field={POSTER_TUNING_FIELD_DATE}
          data-poster-tuning-field-available={tuningTargets.date.available ? 'true' : 'false'}
          data-poster-tuning-field-value={tuning.date}
          data-poster-tuning-field-default={tuningDefaults.date}
          placeholder={tuningTargets.date.available ? (tuningDefaults.date || '留空 = 用课次日期') : ''}
          disabled={!tuningTargets.date.available}
          value={tuning.date}
          onChange={(event) => setTuningField(POSTER_TUNING_FIELD_DATE, event.target.value)}
        />
        <small data-poster-tuning-field-note={POSTER_TUNING_FIELD_DATE}>
          {tuningTargets.date.available ? POSTER_TUNING_FIELD_HINTS[POSTER_TUNING_FIELD_DATE] : tuningTargets.date.reason}
        </small>
      </div>
      <div className="poster-dialog-tuning-row" data-poster-tuning-field-row={POSTER_TUNING_FIELD_QRCODE}>
        <label className="poster-dialog-tuning-check">
          <input
            type="checkbox"
            data-poster-tuning-field={POSTER_TUNING_FIELD_QRCODE}
            data-poster-tuning-field-available={tuningTargets.qrcode.available ? 'true' : 'false'}
            data-poster-tuning-field-value={tuning.qrcode === false ? 'off' : 'on'}
            checked={tuning.qrcode !== false}
            disabled={!tuningTargets.qrcode.available}
            onChange={(event) => setTuningField(POSTER_TUNING_FIELD_QRCODE, event.target.checked)}
          />
          <span>{POSTER_TUNING_FIELD_LABELS[POSTER_TUNING_FIELD_QRCODE]}</span>
        </label>
        <small data-poster-tuning-field-note={POSTER_TUNING_FIELD_QRCODE}>
          {tuningTargets.qrcode.available ? POSTER_TUNING_FIELD_HINTS[POSTER_TUNING_FIELD_QRCODE] : tuningTargets.qrcode.reason}
        </small>
      </div>
      <div className="poster-dialog-tuning-row" data-poster-tuning-field-row={POSTER_TUNING_FIELD_ARTWORKS}>
        <div className="poster-dialog-tuning-row-head">
          <label>{POSTER_TUNING_FIELD_LABELS[POSTER_TUNING_FIELD_ARTWORKS]}</label>
          <small data-poster-tuning-artworks-count="true">
            {tuningTargets.artworks.available ? `已勾选 ${artworkPicked.length} / ${artworkItems.length}` : '不可选'}
          </small>
          {/* 「全选」只在可选时出现；「为什么不可选」由下面那一行读数说一次（不重复两遍）。 */}
          {tuningTargets.artworks.available ? (
            <button
              type="button"
              className="text-link"
              data-poster-tuning-artworks-all="true"
              disabled={!artworkItems.length || !tuning.artworks.length}
              onClick={() => setTuningField(POSTER_TUNING_FIELD_ARTWORKS, [])}
            >全选
            </button>
          ) : null}
        </div>
        <div
          className="poster-dialog-tuning-artworks"
          data-poster-tuning-artworks-list="true"
          data-poster-tuning-artworks-total={String(artworkItems.length)}
          data-poster-tuning-artworks-selected={String(artworkPicked.length)}
          data-poster-tuning-artworks-available={tuningTargets.artworks.available ? 'true' : 'false'}
        >
          {artworkItems.map((item) => {
            const checked = artworkPicked.includes(item.id);
            return (
              <label
                key={item.id}
                className="poster-dialog-tuning-artwork"
                data-poster-tuning-artwork={item.id}
                data-poster-tuning-artwork-checked={checked ? 'true' : 'false'}
                data-poster-tuning-artwork-has-artwork={item.hasArtwork ? 'true' : 'false'}
              >
                <input
                  type="checkbox"
                  data-poster-tuning-artwork-input={item.id}
                  checked={checked}
                  disabled={!artworkCanUncheck && checked}
                  onChange={() => toggleArtwork(item.id)}
                />
                <span>{item.label}</span>
              </label>
            );
          })}
        </div>
        <small data-poster-tuning-artworks-note="true">
          {tuningTargets.artworks.available
            ? (artworkCanUncheck ? POSTER_TUNING_FIELD_HINTS[POSTER_TUNING_FIELD_ARTWORKS] : POSTER_TUNING_ARTWORKS_MIN_NOTE)
            : tuningTargets.artworks.reason}
        </small>
      </div>
      {tuningView && tuningView.notes.length ? (
        <ul className="poster-dialog-tuning-notes" data-poster-tuning-notes="true">
          {tuningView.notes.map((note) => <li key={note} data-poster-tuning-note="true">{note}</li>)}
        </ul>
      ) : null}
    </section>
  );
  const blockedReason = (rows.find((row) => !row.applicable) || {}).reason || '';
  const state = empty.on
    ? 'empty'
    : (!selectedRow ? 'blocked' : (preview.phase === 'ready' ? 'ready' : preview.phase === 'failed' ? 'failed' : preview.phase === 'pending' ? 'pending' : 'blocked'));
  const previewHoldText = preview.phase === 'failed'
    ? POSTER_DIALOG_RENDER_FAILED_TEXT
    : preview.phase === 'pending'
      ? (perf.firstPreviewMs === null ? POSTER_DIALOG_FIRST_PENDING_TEXT : POSTER_DIALOG_SWITCH_PENDING_TEXT)
      : (selectedRow ? `${selectedRow.name} 这套版式暂时出不了图：${selectedRow.reason}` : (blockedReason || '这个入口暂时没有可用的海报模板'));
  const canvasLine = selectedPlan && selectedPlan.spec && selectedPlan.spec.canvas
    ? `${selectedPlan.spec.canvas.width}×${selectedPlan.spec.canvas.height}`
    : '';
  const recordLine = subject.kind === 'class'
    ? `本周期 ${periodRecords.length} 条归档记录（班级集体海报按名单出格）`
    : (recordView.source === 'lesson'
      ? `本次课次${recordView.dateDots ? ` ${recordView.dateDots}` : ''}${recordView.hasArtwork ? '' : '（作品还没同步完成）'}`
      : (recordView.record
        ? `本周期 ${recordView.count} 条归档记录 · 单作品取最新一条${recordView.dateDots ? `（${recordView.dateDots}）` : ''}`
        : '本周期还没有归档记录'));
  const entryLabel = POSTER_DIALOG_ENTRY_LABELS[entry] || POSTER_DIALOG_ENTRY_LABELS[POSTER_DIALOG_ENTRY_ARCHIVE];

  return (
    <div className="poster-dialog-scrim" data-poster-dialog-scrim="true" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        className="poster-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="poster-dialog-title"
        data-poster-dialog="true"
        data-poster-dialog-state={state}
        data-poster-dialog-entry={entry}
        data-poster-dialog-entry-label={entryLabel}
        data-poster-dialog-object={subject.name}
        data-poster-dialog-object-kind={subject.kind}
        data-poster-dialog-object-class={subject.className || ''}
        data-poster-dialog-roster={String(subject.roster.length)}
        data-poster-dialog-period={period}
        data-poster-dialog-period-source={periodSource}
        data-poster-dialog-templates={String(rows.length)}
        data-poster-dialog-templates-applicable={String(rows.filter((row) => row.applicable).length)}
        data-poster-dialog-archive-only={String(archiveOnlyRows.length)}
        data-poster-dialog-archive-only-note={archiveOnlyRows.length ? POSTER_DIALOG_ARCHIVE_ONLY_NOTE : ''}
        data-poster-dialog-selected={selectedId}
        data-poster-dialog-selected-kind={selectedRow ? selectedRow.kind : ''}
        data-poster-dialog-canvas={canvasLine}
        data-poster-dialog-preview={preview.phase}
        data-poster-dialog-preview-scale={String(POSTER_DIALOG_PREVIEW_SCALE)}
        data-poster-dialog-thumb-scale={String(POSTER_DIALOG_THUMB_SCALE)}
        data-poster-dialog-thumbs={String(Object.values(thumbs).filter((item) => item.phase === 'ready').length)}
        data-poster-dialog-records={String(periodRecords.length)}
        data-poster-dialog-record-source={recordView.source}
        data-poster-dialog-record={recordView.record ? String(recordView.record.id || recordView.record.recordKey || '') : ''}
        data-poster-dialog-perf-first={perfChecks.rows[0].value}
        data-poster-dialog-perf-first-ok={perfChecks.rows[0].ok === null ? 'pending' : perfChecks.rows[0].ok ? 'true' : 'false'}
        data-poster-dialog-perf-switch={perfChecks.rows[1].value}
        data-poster-dialog-perf-switch-ok={perfChecks.rows[1].ok === null ? 'pending' : perfChecks.rows[1].ok ? 'true' : 'false'}
      >
        <header className="poster-dialog-head">
          <MessageSquareText size={16} />
          <b id="poster-dialog-title">转发给家长 · 海报</b>
          <small data-poster-dialog-object-line="true" data-poster-dialog-object-line-kind={subject.kind}>
            {`${subject.name || '未选择对象'} · ${entryLabel}入口 · 周期 ${period}`}
          </small>
          <button type="button" className="poster-dialog-close" data-poster-dialog-close="true" aria-label="关闭海报弹窗" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="poster-dialog-controls">
          <label>周期<select value={period} data-poster-dialog-period-select="true" onChange={(event) => pickPeriod(event.target.value)} aria-label="海报周期">
            {POSTER_DIALOG_PERIOD_OPTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
          </select></label>
          <small data-poster-dialog-period-line="true" data-poster-dialog-period-source={periodSource}>{`${subject.name || '未选择对象'} · ${period}`}</small>
          {periodNote ? <small className="poster-dialog-period-note" data-poster-dialog-period-note="true">{periodNote}</small> : null}
          <div className="poster-dialog-perf" data-poster-dialog-perf="true" data-poster-dialog-perf-summary={perfChecks.summary}>
            {perfChecks.rows.map((row) => (
              <span key={row.id} data-poster-dialog-perf-row={row.id} data-poster-dialog-perf-value={row.value} data-poster-dialog-perf-budget={row.budget} data-poster-dialog-perf-ok={row.ok === null ? 'pending' : row.ok ? 'true' : 'false'}>{`${row.label} ${row.value || '待测'} / ${row.budget}`}</span>
            ))}
          </div>
        </div>
        {empty.on ? (
          <div className="poster-dialog-empty" data-poster-dialog-empty="true" data-poster-dialog-empty-reason={empty.reason} data-poster-dialog-empty-outside={String(empty.outside)}>
            <Archive size={24} />
            <b>{empty.title}</b>
            <p>{empty.desc}</p>
            <small data-poster-dialog-empty-hint="true">{empty.hint}</small>
            {navigate ? <Button icon={Plus} data-poster-dialog-create="true" onClick={() => navigate('create')}>{empty.action}</Button> : null}
          </div>
        ) : (
          <div className="poster-dialog-body">
            <div className="poster-dialog-templates" role="listbox" aria-label="海报模板" data-poster-dialog-list="true">
              {rows.map((row) => {
                const thumb = thumbs[row.id] || { phase: 'idle', url: '', width: 0, height: 0 };
                const selected = row.id === selectedId;
                return (
                  <button
                    type="button"
                    key={row.id}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={!row.applicable}
                    disabled={!row.applicable}
                    className={`poster-dialog-template${selected ? ' is-selected' : ''}${row.applicable ? '' : ' is-disabled'}${row.scope === 'teacher' ? ' is-mine' : ''}`}
                    data-poster-dialog-template-option={row.id}
                    data-poster-dialog-template-option-kind={row.kind}
                    data-poster-dialog-template-option-subject={posterDialogKindSubject(row.kind)}
                    data-poster-dialog-template-option-applicable={row.applicable ? 'true' : 'false'}
                    data-poster-dialog-template-option-selected={selected ? 'true' : 'false'}
                    data-poster-dialog-template-option-reason={row.reason}
                    data-poster-dialog-template-option-default={row.isDefault ? 'true' : 'false'}
                    data-poster-dialog-template-option-thumb={thumb.phase}
                    title={row.applicable ? row.name : `${row.name}：${row.reason}`}
                    onClick={() => pickTemplate(row)}
                  >
                    <span className="poster-dialog-thumb" data-poster-dialog-thumb-box={row.id}>
                      {thumb.url
                        ? <img src={thumb.url} alt={`${row.name} 模板缩略图（用 ${subject.name} 的真实数据渲染）`} data-poster-dialog-thumb={row.id} data-poster-dialog-thumb-size={`${thumb.width}x${thumb.height}`} />
                        : <span className="poster-dialog-thumb-hold" data-poster-dialog-thumb-hold={row.id}>{thumb.phase === 'failed' ? '缩略图没出来' : (thumb.phase === 'pending' ? <Loader2 size={14} /> : '待渲染')}</span>}
                    </span>
                    <span className="poster-dialog-template-meta">
                      <b>{row.name}</b>
                      <small data-poster-dialog-template-option-line={row.id}>{`${row.kindLabel}${row.applicable ? '' : ` · ${row.reason}`}`}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="poster-dialog-preview" data-poster-dialog-preview-box="true" data-poster-dialog-preview-canvas={canvasLine}>
              {/* 微调面板放在预览**上面**：一打开弹窗就看得见「能改哪几项」，改完往下一眼就是这张图
                  （弹窗本身可滚动，不必先滚过一张最高 780px 的预览图才找到输入框）。 */}
              {tuningPanel}
              <figure className="poster-dialog-preview-figure" data-poster-dialog-preview-figure="true">
                {preview.url
                  ? <img src={preview.url} alt={`${selectedRow ? selectedRow.name : '海报'}预览（${subject.name} · ${period}）`} data-poster-dialog-image="true" data-poster-dialog-image-size={`${preview.width}x${preview.height}`} data-poster-dialog-image-template={preview.templateId} />
                  : <span className="poster-dialog-hold" data-poster-dialog-hold="true" data-poster-dialog-hold-phase={preview.phase}>{preview.phase === 'pending' ? <Loader2 size={16} /> : null}{previewHoldText}</span>}
              </figure>
              <div className="poster-dialog-meta">
                <ul>
                  <li data-poster-dialog-line="object">{`对象：${subject.name || '未选择'}（${subject.kind === 'class' ? '班级' : '学员'}）· 周期：${period} · 入口：${entryLabel}`}</li>
                  <li data-poster-dialog-line="template">{`模板：${selectedRow ? selectedRow.name : '—'}（${selectedRow ? selectedRow.kindLabel : '—'}）${selectedRow && selectedRow.isDefault ? ' · 默认模板' : ''}`}</li>
                  <li data-poster-dialog-line="source" data-poster-dialog-line-source={recordView.source}>{`数据来源：${recordLine}`}</li>
                  <li data-poster-dialog-line="canvas">{`画布：${canvasLine || '—'} · 预览 1:1（${preview.phase === 'ready' ? `${preview.width}×${preview.height}` : '待出图'}）`}</li>
                  <li data-poster-dialog-line="tuning" data-poster-dialog-line-tuning={tuningActive ? 'on' : 'off'}>{`微调：${tuningActive ? `${tuningApplied.length} 项已改（${tuningApplied.join(' / ')}）` : '未修改（标题 / 金句 / 日期 / 二维码 / 收录作品）'}`}</li>
                  <li data-poster-dialog-line="assets">{POSTER_DIALOG_ASSET_NOTE}</li>
                </ul>
                {preview.warnings.length ? <p className="poster-dialog-warning" data-poster-dialog-warning="true">{preview.warnings.join('；')}</p> : null}
                {selectedPlan && (selectedPlan.notes || []).length ? <ul className="poster-dialog-notes">
                  {selectedPlan.notes.map((note) => <li key={note} data-poster-dialog-note="true">{note}</li>)}
                </ul> : null}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
