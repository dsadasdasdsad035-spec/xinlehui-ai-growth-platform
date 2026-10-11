// 管理端「生成日志」里的**点评轨迹**面板（[第三步 US-112] / F-REVIEW-TRACE-03）。
//
// 四件事都在这里落地，判据一律读数据层（页面不自己写 if）：
//  1. **任意一次点评的完整轨迹**：列表 → 详情复用老师端那套**六分区**载荷
//     （`data/reviewDetailPanel.js` 的 `reviewTracePayload` 把留档轨迹翻译成同一份 payload）；
//  2. **筛选**：学员 / 老师 / 模型 / 时间范围 / 状态（`filterReviewTraces`）；
//  3. **提示词正文的平台开关**：`allowPromptDisclosure` 关闭时老师端只显示清单；
//     管理端（平台审计）始终可看，并在面板上点明开关当前状态；
//  4. **复制 / 导出留痕**：每次复制或导出都写一条审计（操作人 / 时间 / 轨迹 id / 导出范围）。
//
// 这里**不做**的两件事（各自有归属）：留档清理的影响范围预览在「系统配置」里；
// 家长端与家长分享页不存在任何轨迹入口 —— 由 `reviewTraceSurfaceAllowed` 直接判死（FR-114）。

import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Download, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '../ui';
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, TRACE_AUDIT_ACTIONS } from '../data/auditLog';
import {
  REVIEW_TRACE_DISCLOSURE_NOTE,
  REVIEW_TRACE_SURFACES,
  REVIEW_TRACE_STATUS_OPTIONS,
  filterReviewTraces,
  normalizeReviewTracePolicy,
  reviewPromptDisclosureAllowed,
  reviewTraceAuditScopeText,
  reviewTraceFilterOptions,
  reviewTracePolicySummary,
  reviewTraceSurfaceAllowed,
  reviewTraceViewer
} from '../data/reviewTracePolicy';
import {
  REVIEW_DETAIL_SECTION_KEYS,
  reviewPromptDisclosureMask,
  reviewTracePayload
} from '../data/reviewDetailPanel';
import { buildReviewDetailExport, copyReviewDetailText, downloadReviewDetailExport } from '../services/reviewDetailExport';

const EMPTY_FILTERS = { student: '', teacher: '', model: '', status: '', from: '', to: '' };

function StatusChip({ status, label }) {
  return <span className={`review-trace-status is-${status || 'unknown'}`}>{label || status || '未知'}</span>;
}

/** 一行读数（标签 + 值）；值缺的时候写「—」而不是空白。 */
function Readout({ label, value, attr = '' }) {
  return <span className="review-trace-readout" data-review-trace-readout={attr || label}><b>{label}</b>{value || '—'}</span>;
}

/**
 * 轨迹详情：六分区只读展示（顺序与老师端一致，读 `REVIEW_DETAIL_SECTION_KEYS`）。
 * `payload` 已按平台开关遮过（`reviewPromptDisclosureMask`），所以提示词分区分两种画法。
 */
function TraceSections({ payload }) {
  const sectionOf = (key) => (payload.sections || []).find((item) => item.key === key) || {};
  const loaded = sectionOf('loaded');
  const prompt = sectionOf('prompt');
  const model = sectionOf('model');
  const usage = sectionOf('usage');
  const output = sectionOf('output');
  const reasoning = sectionOf('reasoning');
  return (
    <div className="review-trace-sections" data-review-trace-sections={REVIEW_DETAIL_SECTION_KEYS.length}>
      <section className="review-trace-section" data-review-trace-section="reasoning">
        <div className="review-trace-block-head">
          <b>{reasoning.title}</b>
          <small>{reasoning.chars || 0} 字</small>
        </div>
        <pre data-review-trace-reasoning="true" data-review-trace-reasoning-chars={reasoning.chars || 0}>{reasoning.text}</pre>
      </section>

      <section className="review-trace-section" data-review-trace-section="loaded">
        <div className="review-trace-block-head">
          <b>{loaded.title}</b>
          <small>{loaded.included || 0}/{loaded.total || 0} 项已加载</small>
        </div>
        <ul className="review-trace-loaded" data-review-trace-loaded="true">
          {(loaded.rows || []).map((row) => (
            <li key={row.key} data-review-trace-loaded-item={row.key} data-review-trace-loaded-included={row.included ? 'true' : 'false'} className={row.included ? '' : 'is-off'}>
              <b>{row.label}</b>{row.detail ? <span>{row.detail}</span> : null}{row.included ? null : <em>{row.reason}</em>}
            </li>
          ))}
        </ul>
        {(loaded.agentFiles || []).length ? (
          <div className="review-trace-files" data-review-trace-agentfiles={loaded.agentFilesIncluded || 0} data-review-trace-agentfiles-total={loaded.agentFilesTotal || 0}>
            <div className="review-trace-block-head">
              <b>agent.md 与记忆文件</b>
              <small>{loaded.agentFilesIncluded || 0}/{loaded.agentFilesTotal || 0} 个已加载 · 点开单项可看进入提示词的正文</small>
            </div>
            {loaded.agentFilesNote ? <p className="review-trace-note">{loaded.agentFilesNote}</p> : null}
            <ul>
              {(loaded.agentFiles || []).map((row) => (
                <li key={row.fileId || row.name} className={row.included ? '' : 'is-off'} data-review-trace-agentfile={row.fileId || row.name} data-review-trace-agentfile-included={row.included ? 'true' : 'false'}>
                  <details>
                    <summary>
                      <b>{row.name}</b>
                      <span>{row.detail}</span>
                      <em>{row.stateText}</em>
                    </summary>
                    <div className="review-trace-body">
                      <small>{row.bodyNote}</small>
                      <pre data-review-trace-file-body="true">{row.body || '（本次未加载，没有正文）'}</pre>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {(loaded.skills || []).length ? (
          <div className="review-trace-skills" data-review-trace-skills={loaded.skillsIncluded || 0} data-review-trace-skills-total={loaded.skillsTotal || 0}>
            <div className="review-trace-block-head">
              <b>技能清单</b>
              <small>{loaded.skillsIncluded || 0}/{loaded.skillsTotal || 0} 项已加载</small>
            </div>
            <ul>
              {(loaded.skills || []).map((row) => (
                <li key={row.id || row.name} className={row.included ? '' : 'is-off'} data-review-trace-skill={row.id || row.name} data-review-trace-skill-included={row.included ? 'true' : 'false'}>
                  <details>
                    <summary>
                      <b>{row.name}</b>
                      <span>{row.detail}</span>
                      <em>{row.included ? '[已加载]' : `[未加载] ${row.reason}`}</em>
                    </summary>
                    <div className="review-trace-body">
                      <small>该技能进入提示词的原文片段：</small>
                      <pre data-review-trace-skill-excerpt="true">{row.excerpt}</pre>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {(loaded.modules || []).length ? (
          <div className="review-trace-modules" data-review-trace-modules={loaded.modulesTotal || 0}>
            <div className="review-trace-block-head">
              <b>提示词模块</b>
              <small>{loaded.modulesIncluded || 0}/{loaded.modulesTotal || 0} 项</small>
            </div>
            <ul>
              {(loaded.modules || []).map((row) => (
                <li key={row.id} className={row.included ? '' : 'is-off'} data-review-trace-module={row.id}>
                  <b>{row.title}</b><span>{row.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="review-trace-section" data-review-trace-section="prompt" data-review-trace-prompt-restricted={prompt.restricted ? 'true' : 'false'}>
        <div className="review-trace-block-head">
          <b>{prompt.title}</b>
          <small>system {prompt.systemChars || 0} 字 · user {prompt.userChars || 0} 字 · 附件 {(prompt.attachments || []).length} 个</small>
        </div>
        {prompt.restricted ? (
          <p className="review-trace-restricted" data-review-trace-prompt-note="true">
            <ShieldAlert size={14} />
            <span>{prompt.restrictionNote || REVIEW_TRACE_DISCLOSURE_NOTE}</span>
          </p>
        ) : (
          <div className="review-trace-prompt">
            <b>system</b>
            <pre data-review-trace-prompt-system="true" data-review-trace-prompt-system-chars={prompt.systemChars || 0}>{prompt.system || '（本次没有 system 提示词）'}</pre>
            <b>user</b>
            <pre data-review-trace-prompt-user="true" data-review-trace-prompt-user-chars={prompt.userChars || 0}>{prompt.user || '（本次没有 user 消息）'}</pre>
          </div>
        )}
        <b>附件（只记引用与 hash）</b>
        <ul className="review-trace-attachments" data-review-trace-attachments="true">
          {(prompt.attachments || []).length
            ? (prompt.attachments || []).map((row) => <li key={row.index} data-review-trace-attachment={row.kind}>{row.text}</li>)
            : <li data-review-trace-attachment="none">本次没有附件</li>}
        </ul>
      </section>

      <section className="review-trace-section" data-review-trace-section="model">
        <div className="review-trace-block-head"><b>{model.title}</b><small>{model.model || '未知模型'}</small></div>
        <div className="review-trace-readouts">
          <Readout label="模型" value={model.model} attr="model" />
          <Readout label="模型来源" value={model.modelSourceLabel} attr="model-source" />
        </div>
        <ul className="review-trace-params" data-review-trace-params={(model.params || []).length}>
          {(model.params || []).length
            ? (model.params || []).map((row) => <li key={row.key}><b>{row.label}</b><span>{row.value}</span></li>)
            : <li data-review-trace-params-empty="true">这次点评没有留下参数表（旧轨迹）。</li>}
        </ul>
      </section>

      <section className="review-trace-section" data-review-trace-section="usage">
        <div className="review-trace-block-head"><b>{usage.title}</b><small>{usage.costText || '本次未产生可估算的用量'}</small></div>
        <ul className="review-trace-usage" data-review-trace-usage="true">
          {(usage.tokens || []).map((row) => <li key={row.key} data-review-trace-token={row.key}><b>{row.label}</b><span>{row.valueText}</span></li>)}
          {(usage.timing || []).map((row) => <li key={row.key} data-review-trace-timing={row.key}><b>{row.label}</b><span>{row.valueText}</span></li>)}
          <li data-review-trace-cost="true"><b>估算成本</b><span>{usage.costText || '本次未产生可估算的用量'}</span></li>
        </ul>
        {usage.note ? <p className="review-trace-note">{usage.note}</p> : null}
      </section>

      <section className="review-trace-section" data-review-trace-section="output">
        <div className="review-trace-block-head">
          <b>{output.title}</b>
          <small>{output.chars || 0} 字</small>
        </div>
        <pre data-review-trace-output="true" data-review-trace-output-chars={output.chars || 0}>{output.text || '（本次没有输出原文）'}</pre>
        {output.parse?.message ? <p className="review-trace-note" data-review-trace-output-parse={output.parse.ok ? 'ok' : 'failed'}>{output.parse.message}</p> : null}
      </section>
    </div>
  );
}

/**
 * 点评轨迹面板。props：
 *  - `role` / `viewer`：当前会话身份（决定可见轨迹与披露开关的读法）；
 *  - `traces`：本机镜像 + 云端 + 开发适配器合并后的轨迹（App 负责合并与刷新）；
 *  - `policy`：平台策略（保留期 + 披露开关，读 `data/reviewTracePolicy.js`）；
 *  - `sourceNote` / `loading` / `onRefresh`：数据来源读数与刷新；
 *  - `recordAudit` / `setToast`：复制与导出的留痕（App 的 recordAudit）。
 */
export default function ReviewTraceLogsPanel({
  role = 'admin',
  viewer = null,
  traces = [],
  policy = null,
  sourceNote = '',
  loading = false,
  onRefresh = () => {},
  recordAudit = () => {},
  auditLog = [],
  setToast = () => {}
}) {
  const who = useMemo(() => reviewTraceViewer(viewer || { role }), [viewer, role]);
  const surfaceAllowed = reviewTraceSurfaceAllowed({ surface: REVIEW_TRACE_SURFACES.adminLogs, role });
  // 平台开关（对老师端生效的那一个）与**本会话实际能不能看**是两件事：管理员始终可看，
  // 开关状态单独读出来，面板上照实写清「开关关着、但管理端仍可审计」。
  const switchOn = normalizeReviewTracePolicy(policy).allowPromptDisclosure;
  const promptAllowed = reviewPromptDisclosureAllowed(policy, { role });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState('');
  const [receipt, setReceipt] = useState({ copy: '', export: '', audit: '' });

  const options = useMemo(() => reviewTraceFilterOptions(traces, who), [traces, who]);
  const query = useMemo(() => filterReviewTraces(traces, filters, { viewer: who }), [traces, filters, who]);
  const rows = query.rows;
  const row = rows.find((item) => item.traceId === selectedId) || rows[0] || null;
  const trace = useMemo(() => (row ? traces.find((item) => String(item?.traceId) === row.traceId) || null : null), [row, traces]);
  const payload = useMemo(() => (trace ? reviewTracePayload(trace) : null), [trace]);
  const masked = useMemo(() => (payload ? reviewPromptDisclosureMask(payload, { allowed: promptAllowed }) : null), [payload, promptAllowed]);
  // 轨迹操作留痕（复制 / 导出）：读 App 的审计日志，按两个轨迹动作过滤（不在页面里另存一份）。
  const auditEntries = useMemo(() => (Array.isArray(auditLog) ? auditLog : []), [auditLog]);

  // 选中项被筛选掉时回落到第一条：详情永远与列表对得上（不留一个「列表里没有的详情」）。
  useEffect(() => {
    if (selectedId && !rows.some((item) => item.traceId === selectedId)) setSelectedId('');
  }, [rows, selectedId]);

  useEffect(() => { setReceipt({ copy: '', export: '', audit: '' }); }, [row?.traceId]);

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const sectionCount = masked ? (masked.sections || []).length : 0;

  const recordTraceAudit = (action, kind) => {
    if (!row) return null;
    const scope = reviewTraceAuditScopeText({ kind, sectionCount, student: row.studentName, restricted: !promptAllowed });
    const entry = recordAudit({
      action,
      traceId: row.traceId,
      studentId: row.studentId,
      studentName: row.studentName,
      lessonId: row.lessonId,
      scope,
      detail: `${AUDIT_ACTION_LABELS[action] || action}：${scope}`
    });
    setReceipt((current) => ({ ...current, audit: `${AUDIT_ACTION_LABELS[action] || action}已写入审计日志（轨迹 ${row.traceId} · ${scope}）` }));
    return entry;
  };

  const copyTrace = async () => {
    if (!masked || !row) return;
    const result = buildReviewDetailExport(masked, { format: 'markdown', student: row.studentName, lessonDate: '' });
    const ok = await copyReviewDetailText(result.text);
    setReceipt((current) => ({ ...current, copy: ok ? 'copied' : 'failed' }));
    recordTraceAudit(AUDIT_ACTIONS.traceCopy, 'copy');
    if (!ok) setToast('复制失败，请手动选择文本复制');
  };

  const exportTrace = (format) => {
    if (!masked || !row) return;
    const result = buildReviewDetailExport(masked, { format, student: row.studentName, lessonDate: '' });
    const filename = downloadReviewDetailExport(result) || result.filename;
    setReceipt((current) => ({ ...current, export: filename }));
    recordTraceAudit(AUDIT_ACTIONS.traceExport, format);
    setToast(`已导出 ${filename}`);
  };

  if (!surfaceAllowed) {
    return (
      <section className="panel review-trace-panel" data-review-trace-panel="true" data-review-trace-surface-allowed="false">
        <p className="review-trace-blocked" data-review-trace-blocked="true">
          <ShieldAlert size={14} />
          <span>当前身份不能查看点评轨迹：轨迹只对老师与管理员开放，家长端与家长分享页不存在任何轨迹入口。</span>
        </p>
      </section>
    );
  }

  const copyText = receipt.copy === 'copied' ? '已复制轨迹（六分区 Markdown）'
    : receipt.copy === 'failed' ? '复制失败，请手动选择文本复制'
      : '复制与导出只含提示词、推理、输出与素材引用，不含图片正文';

  return (
    <section className="panel review-trace-panel" data-review-trace-panel="true" data-review-trace-surface-allowed="true" data-review-trace-role={role}>
      <div className="review-trace-head">
        <div>
          <h2>点评轨迹（生成日志）</h2>
          <p>任意一次点评的完整轨迹：推理过程 / 加载清单 / 提示词 / 模型与参数 / 用量与耗时 / 输出原文。轨迹按白名单留档，图片只记引用与 hash。</p>
        </div>
        <div className="review-trace-head-actions">
          <small data-review-trace-source={sourceNote || '本机镜像'}>{sourceNote || '本机镜像'}</small>
          <Button variant="secondary" icon={RefreshCw} onClick={onRefresh}>{loading ? '刷新中…' : '刷新轨迹'}</Button>
        </div>
      </div>

      <div className="review-trace-policy" data-review-trace-policy="true" data-review-trace-disclosure={promptAllowed ? 'open' : 'restricted'} data-review-trace-switch={switchOn ? 'on' : 'off'}>
        <span data-review-trace-policy-summary="true">{reviewTracePolicySummary(policy)}</span>
        <em>
          平台开关「允许老师查看提示词正文」当前{switchOn ? '开启' : '关闭'}
          {switchOn ? '' : `：老师端提示词分区显示「${REVIEW_TRACE_DISCLOSURE_NOTE}」，管理端仍可审计`}
          {switchOn ? '' : '（平台开关在「系统配置 → 点评轨迹：保留期与披露」里改）'}
        </em>
      </div>

      <div className="review-trace-filters" data-review-trace-filters="true">
        <label>学员
          <input data-review-trace-filter="student" list="review-trace-students" value={filters.student} onChange={(event) => setFilter('student', event.target.value)} placeholder="姓名或 id" />
          <datalist id="review-trace-students">{(options.students || []).map((item) => <option key={item.value} value={item.value} />)}</datalist>
        </label>
        <label>老师
          <input data-review-trace-filter="teacher" list="review-trace-teachers" value={filters.teacher} onChange={(event) => setFilter('teacher', event.target.value)} placeholder="姓名或 id" />
          <datalist id="review-trace-teachers">{(options.teachers || []).map((item) => <option key={item.value} value={item.value} />)}</datalist>
        </label>
        <label>模型
          <select data-review-trace-filter="model" value={filters.model} onChange={(event) => setFilter('model', event.target.value)}>
            <option value="">全部模型</option>
            {(options.models || []).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>状态
          <select data-review-trace-filter="status" value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
            {REVIEW_TRACE_STATUS_OPTIONS.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>起始日期
          <input type="date" data-review-trace-filter="from" value={filters.from} onChange={(event) => setFilter('from', event.target.value)} />
        </label>
        <label>截止日期
          <input type="date" data-review-trace-filter="to" value={filters.to} onChange={(event) => setFilter('to', event.target.value)} />
        </label>
        <div className="review-trace-filter-actions">
          <button type="button" data-review-trace-reset="true" onClick={() => setFilters(EMPTY_FILTERS)}>清空筛选</button>
          <small data-review-trace-summary="true">{query.summaryText}</small>
        </div>
      </div>

      <div className="review-trace-body">
        <div className="review-trace-list" data-review-trace-count={rows.length} data-review-trace-visible={query.visibleTotal} data-review-trace-total={query.total}>
          {rows.length ? rows.map((item) => (
            <button
              type="button"
              key={item.traceId}
              className={row && item.traceId === row.traceId ? 'review-trace-row is-active' : 'review-trace-row'}
              data-review-trace-row={item.traceId}
              data-review-trace-row-status={item.status}
              data-review-trace-row-student={item.studentName}
              data-review-trace-row-teacher={item.teacherName}
              data-review-trace-row-model={item.model}
              onClick={() => setSelectedId(item.traceId)}
            >
              <span className="review-trace-row-top">
                <b>{item.studentName || '未关联学员'}</b>
                <StatusChip status={item.status} label={item.statusLabel} />
              </span>
              <span className="review-trace-row-meta">{item.createdAtText} · {item.model || '未知模型'}{item.teacherName ? ` · ${item.teacherName}` : ''}</span>
              <span className="review-trace-row-foot">
                {item.durationText ? `耗时 ${item.durationText}` : '无耗时读数'}
                {item.reasoningChars ? ` · 推理 ${item.reasoningChars} 字` : ''}
                {item.outputChars ? ` · 输出 ${item.outputChars} 字` : ''}
              </span>
              <em className="review-trace-row-id">{item.traceId}</em>
            </button>
          )) : <p className="review-trace-empty" data-review-trace-empty="true">{query.emptyText}</p>}
        </div>

        <div className="review-trace-detail" data-review-trace-detail={row ? row.traceId : ''}>
          {row && masked ? (
            <>
              <div className="review-trace-detail-head">
                <div>
                  <b data-review-trace-detail-student="true">{row.studentName || '未关联学员'}</b>
                  <small>{row.createdAtText} · {row.taskLabel} · 轨迹 {row.traceId}</small>
                </div>
                <StatusChip status={row.status} label={row.statusLabel} />
              </div>
              {row.errorMessage ? <p className="review-trace-error" data-review-trace-error="true"><ShieldAlert size={14} /><span>{row.errorCode ? `${row.errorCode}：` : ''}{row.errorMessage}</span></p> : null}
              <div className="review-trace-readouts">
                <Readout label="学员" value={row.studentName || row.studentId} attr="student" />
                <Readout label="经手老师" value={row.teacherName || row.teacherId} attr="teacher" />
                <Readout label="模型" value={row.model} attr="model" />
                <Readout label="耗时" value={row.durationText} attr="duration" />
              </div>
              <div className="review-trace-tools" data-review-trace-tools="true">
                <button type="button" data-review-trace-action="copy" onClick={copyTrace}><Copy size={14} />复制轨迹</button>
                <button type="button" data-review-trace-action="export-markdown" onClick={() => exportTrace('markdown')}><Download size={14} />导出 Markdown</button>
                <button type="button" data-review-trace-action="export-json" onClick={() => exportTrace('json')}><Download size={14} />导出 JSON</button>
                <small data-review-trace-copy-state={receipt.copy || 'idle'}>{copyText}</small>
                {receipt.export ? <small data-review-trace-export-state="done">已导出 {receipt.export}</small> : null}
              </div>
              {receipt.audit ? <p className="review-trace-receipt" data-review-trace-audit="true">{receipt.audit}</p> : null}
              <TraceSections payload={masked} />
            </>
          ) : <p className="review-trace-empty" data-review-trace-empty="true">{query.emptyText}</p>}
        </div>
      </div>

      <div className="review-trace-audit" data-review-trace-audit-log="true">
        <div className="review-trace-block-head"><b>轨迹操作留痕</b><small>{TRACE_AUDIT_ACTIONS.map((action) => AUDIT_ACTION_LABELS[action]).join(' / ')}</small></div>
        {auditEntries.filter((entry) => TRACE_AUDIT_ACTIONS.includes(entry.action)).length ? (
          <ul>
            {auditEntries.filter((entry) => TRACE_AUDIT_ACTIONS.includes(entry.action)).slice(0, 5).map((entry) => (
              <li key={entry.id} data-review-trace-audit-entry={entry.id}>
                <b>{entry.actionLabel}</b>
                <span>{entry.actorName || entry.actorId} · {entry.traceId} · {entry.scope}</span>
              </li>
            ))}
          </ul>
        ) : <p className="review-trace-note">还没有复制 / 导出记录：任一操作都会写入审计日志（操作人 / 时间 / 轨迹 id / 导出范围）。</p>}
      </div>
    </section>
  );
}
