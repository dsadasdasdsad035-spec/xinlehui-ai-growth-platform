// 管理端「AI 补充观察词」面板（[第三步 US-111] / FR-147、FR-148）。
//
// 教研不想一个字一个字想词，所以这里让模型先给一批候选（建议分组 + 词条 + 推荐理由），
// 教研在上面挑：候选默认全不选中 → 逐条勾 / 按分组批量勾 / 全选 / 清空 →
// 「采纳选中」写进**草稿区**（点「保存」才落库并让模板 version 自增）。
//
// 这一块只渲染与调用，判据全在零依赖的 data 层：
//   · `data/reviewKeywordAi.js` —— 上下文与提示词、候选解析、去重与疑似同义、勾选、采纳、留痕文案；
//   · `services/reviewKeywordAi.js` —— 独立通道的模型链调用（不复用点评的提示词与参数表）。
// 页面里**不许**再写一遍「哪些候选能勾 / 哪些词已存在 / 同义怎么判」。

import React, { useEffect, useMemo, useState } from 'react';
import { CircleAlert, ListPlus, RefreshCw, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import { Button } from '../ui';
import {
  KEYWORD_AI_CHANNEL,
  KEYWORD_AI_CHANNEL_NOTE,
  KEYWORD_AI_COUNT_DEFAULT,
  KEYWORD_AI_COUNT_HINT,
  KEYWORD_AI_COUNT_MAX,
  KEYWORD_AI_COUNT_MIN,
  KEYWORD_AI_SCOPE_NOTE,
  KEYWORD_AI_SYNONYM_NOTE,
  keywordAiAuditDetail,
  keywordAiContextText,
  keywordAiModelPlan,
  keywordCandidateAdopt,
  keywordCandidateBuckets,
  keywordCandidateCounts,
  keywordCandidateDiscardText,
  keywordCandidateRows,
  keywordCandidateSelectableKeys,
  selectedKeywordCandidateKeys,
  selectKeywordCandidates
} from '../data/reviewKeywordAi';
import { KEYWORD_AI_AUDIT_ACTIONS, AUDIT_ACTIONS } from '../data/auditLog';
import { generateKeywordCandidates } from '../services/reviewKeywordAi';

/** 一句话说明候选行为什么被标灰（界面与断言读同一个字段）。 */
const blockedTextOf = (row) => (row.blocked ? row.blockText : '');

export default function KeywordAiPanel({
  templateKey = '',
  draft = null,
  setDraft = () => {},
  groups = [],
  courseOptions = [],
  operator = '',
  reviewModels = [],
  auditLog = [],
  recordAudit = () => null,
  setToast = () => {},
  orgId = ''
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState(() => ({
    courseType: '',
    ageRange: '',
    artForm: '',
    targetGroup: '',
    count: KEYWORD_AI_COUNT_DEFAULT
  }));
  // 目标分组 / 课程类型 / 年龄段 / 画种 的默认值来自当前模板（切模板由页面的 key 重挂载兜底）。
  useEffect(() => {
    const courseTypes = (draft?.courseTypes || []).filter(Boolean);
    setContext((current) => ({
      ...current,
      courseType: current.courseType || courseTypes[0] || '',
      ageRange: current.ageRange || draft?.ageRange || '',
      artForm: current.artForm || courseTypes[0] || ''
    }));
  }, [draft?.templateKey, draft?.ageRange, (draft?.courseTypes || []).join('|')]);
  const [modelChoice, setModelChoice] = useState('');
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  // `result` = 最近一次**成功**的候选（列表读它）；`receipt` = 最近一次**尝试**的回执（成功或失败都读它）。
  // 分成两份是为了「生成失败不毁掉上一批候选」—— 换模型重试时上一批还在，勾选不会白做。
  const [result, setResult] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [selection, setSelection] = useState({});
  const [adoptReport, setAdoptReport] = useState(null);
  const [notice, setNotice] = useState('');

  const plan = useMemo(() => keywordAiModelPlan({ models: reviewModels, explicit: modelChoice, orgId }), [reviewModels, modelChoice, orgId]);
  const editGroups = useMemo(() => (Array.isArray(groups) ? groups : []), [groups]);
  // 模板里已有的词（交给模型避开；候选判定也读这一份 —— 与保存闸门同一条归一化规则）。
  const existingTerms = useMemo(() => editGroups.flatMap((group) => group.terms
    .filter((term) => String(term.term || '').trim())
    .map((term) => ({ term: term.term, group: group.name }))), [editGroups]);
  // 候选行：**每次渲染按当前草稿重算**（采纳之后这些词立刻变成「模板内已有」并标灰，不会重复采纳）。
  const rows = useMemo(() => keywordCandidateRows(result?.candidates || [], { existing: existingTerms }), [result, existingTerms]);
  const counts = useMemo(() => keywordCandidateCounts(rows), [rows]);
  const buckets = useMemo(() => keywordCandidateBuckets(rows, selection), [rows, selection]);
  const selectedKeys = useMemo(() => selectedKeywordCandidateKeys(rows, selection), [rows, selection]);
  const trail = useMemo(() => (Array.isArray(auditLog) ? auditLog : [])
    .filter((entry) => KEYWORD_AI_AUDIT_ACTIONS.includes(entry.action) && entry.templateId === templateKey)
    .slice(0, 6), [auditLog, templateKey]);

  const patchContext = (key, value) => setContext((current) => ({ ...current, [key]: value }));

  /** 记一条留痕：动作键在 `data/auditLog.js`，detail 文案在 data 层（页面只负责调 recordAudit）。 */
  const audit = (action, detail) => recordAudit({
    action,
    actorId: operator,
    actorName: operator,
    actorRole: 'admin',
    actorRoleLabel: '平台管理员',
    orgId,
    templateId: templateKey,
    templateName: draft?.name || '',
    detail
  });

  /**
   * 生成候选：走独立通道（自己的提示词 + 自己的模型链）。
   * 失败只写回执 —— 草稿一个字不动、上一批候选也留着，手工新增词条照常可用
   * （验收原文「生成失败时可重试或换模型，不阻断手工新增词条」）。
   */
  const generate = async () => {
    if (status === 'running') return;
    setStatus('running');
    setNotice('');
    setAdoptReport(null);
    const envelope = await generateKeywordCandidates({
      context,
      existingTerms: existingTerms.map((item) => item.term),
      models: reviewModels,
      model: modelChoice,
      orgId
    });
    setReceipt(envelope);
    setStatus(envelope.ok ? 'done' : 'error');
    if (envelope.ok) {
      setResult(envelope);
      setSelection({});
      const detail = keywordAiAuditDetail('generate', {
        context,
        model: envelope.model,
        count: envelope.candidates.length,
        fallbackNote: envelope.fallbackNote
      });
      audit(AUDIT_ACTIONS.keywordCandidates, detail);
      setToast(`模型 ${envelope.model} 返回 ${envelope.candidates.length} 条候选（默认全不选中，勾选后采纳）`);
    } else {
      setToast(envelope.message || '观察词生成失败，可重试或换模型。');
    }
  };

  const adopt = () => {
    if (!draft || !selectedKeys.length) return;
    const adopted = keywordCandidateAdopt(draft, rows, selection, { targetGroup: context.targetGroup });
    setDraft(adopted.draft);
    setAdoptReport(adopted);
    setNotice('');
    audit(AUDIT_ACTIONS.keywordAdopt, keywordAiAuditDetail('adopt', adopted));
    setToast(adopted.reportText);
  };

  const discard = () => {
    if (!result) return;
    audit(AUDIT_ACTIONS.keywordDiscard, keywordAiAuditDetail('discard', { rows, selection }));
    const text = keywordCandidateDiscardText(rows, selection);
    setResult(null);
    setReceipt(null);
    setSelection({});
    setAdoptReport(null);
    setStatus('idle');
    setNotice(`已丢弃本次候选（${text}）。`);
    setToast(text);
  };

  const modelRows = plan.rows;
  const running = status === 'running';

  return <div className="keyword-ai" data-keyword-ai-panel
    data-keyword-ai-channel={KEYWORD_AI_CHANNEL.id}
    data-keyword-ai-prompt-id={KEYWORD_AI_CHANNEL.promptId}
    data-keyword-ai-open={open ? 'true' : 'false'}
    data-keyword-ai-status={status}
    data-keyword-ai-chain={plan.chain.join('>')}
    data-keyword-ai-candidate-count={rows.length}
    data-keyword-ai-selected={selectedKeys.length}>
    <div className="keyword-ai-head">
      <div>
        <h3><Sparkles size={14}/>{KEYWORD_AI_CHANNEL.title}</h3>
        <p>{KEYWORD_AI_CHANNEL.purpose}</p>
      </div>
      <div className="row-actions">
        {result ? <small data-keyword-ai-report-count={counts.total}>{counts.total} 条候选 · 已选 {selectedKeys.length}</small> : null}
        <Button variant="secondary" icon={open ? ListPlus : WandSparkles} data-keyword-ai-toggle
          onClick={() => setOpen((current) => !current)}>{open ? '收起' : '展开面板'}</Button>
      </div>
    </div>

    {open ? <>
      <div className="keyword-ai-notes">
        <span>{KEYWORD_AI_CHANNEL_NOTE}</span>
        <span>{KEYWORD_AI_SCOPE_NOTE}</span>
      </div>

      <div className="form-grid compact keyword-ai-context">
        <label>课程类型
          <input data-keyword-ai-course list="keyword-template-course-options" value={context.courseType}
            placeholder="例如：国画"
            onChange={(event) => patchContext('courseType', event.target.value)}/>
        </label>
        <label>年龄段
          <input data-keyword-ai-age list="keyword-template-age-options" value={context.ageRange}
            placeholder="例如：6-9岁"
            onChange={(event) => patchContext('ageRange', event.target.value)}/>
        </label>
        <label>画种
          <input data-keyword-ai-artform value={context.artForm} placeholder="例如：国画 / 水彩 / 综合材料"
            onChange={(event) => patchContext('artForm', event.target.value)}/>
        </label>
        <label>目标分组
          <select data-keyword-ai-group value={context.targetGroup} onChange={(event) => patchContext('targetGroup', event.target.value)}>
            <option value="">按模型建议分组</option>
            {editGroups.map((group) => group.name ? <option key={group.name} value={group.name}>{group.name}</option> : null)}
          </select>
        </label>
        <label>期望数量（{KEYWORD_AI_COUNT_HINT}）
          <input data-keyword-ai-count type="number" min={KEYWORD_AI_COUNT_MIN} max={KEYWORD_AI_COUNT_MAX} value={context.count}
            onChange={(event) => patchContext('count', event.target.value)}/>
        </label>
        <label>用哪个模型（换模型 = 钉住它，不做静默替换）
          <select data-keyword-ai-model-select value={modelChoice} onChange={(event) => setModelChoice(event.target.value)}>
            <option value="">通道默认：{plan.chain.join(' → ') || '无可用模型'}</option>
            {modelRows.map((row) => <option key={row.id} value={row.id} disabled={!row.available}>
              {row.label}{row.available ? '' : `（不可用：${row.reasonText}）`}
            </option>)}
          </select>
        </label>
      </div>
      <p className="keyword-ai-context-text" data-keyword-ai-context={keywordAiContextText(context)}>{keywordAiContextText(context)}
        {plan.chain.length ? ` · 本次走 ${plan.chain.join(' → ')}` : ` · ${plan.emptyText}`}</p>

      <div className="row-actions keyword-ai-actions">
        <Button icon={result ? RefreshCw : WandSparkles} onClick={generate} disabled={running || !plan.chain.length}
          data-keyword-ai-generate>{running ? '模型正在生成候选…' : (result ? '重新生成候选' : '生成候选')}</Button>
        {status === 'error' ? <Button variant="secondary" icon={RefreshCw} onClick={generate} data-keyword-ai-retry>重试</Button> : null}
        {result ? <>
          <Button variant="secondary" icon={ListPlus} onClick={() => setSelection(selectKeywordCandidates(selection, keywordCandidateSelectableKeys(rows), true))}
            disabled={!counts.selectable} data-keyword-ai-select-all>全选（{counts.selectable}）</Button>
          <Button variant="secondary" onClick={() => setSelection({})} disabled={!selectedKeys.length} data-keyword-ai-clear>清空</Button>
          <Button icon={ListPlus} onClick={adopt} disabled={!selectedKeys.length} data-keyword-ai-adopt>采纳选中（{selectedKeys.length}）</Button>
          <Button variant="secondary" icon={Trash2} onClick={discard} data-keyword-ai-discard>丢弃候选</Button>
        </> : null}
      </div>

      {/* 生成回执：成功写模型 / 条数 / 是否换档；失败写一句可读的话
          （草稿不动、上一批候选还在、手工新增不受影响）。 */}
      {receipt ? <div className={`keyword-ai-receipt${receipt.ok ? '' : ' is-error'}`}
        data-keyword-ai-receipt={receipt.ok ? 'ok' : 'error'}
        data-keyword-ai-receipt-model={receipt.model || ''}
        data-keyword-ai-receipt-requested={receipt.requestedModel || ''}
        data-keyword-ai-receipt-fallback={receipt.fallbackNote || ''}
        data-keyword-ai-receipt-count={receipt.ok ? receipt.candidates.length : 0}
        data-keyword-ai-receipt-ms={receipt.elapsedMs}
        data-keyword-ai-receipt-attempts={receipt.attempts.map((item) => `${item.model}:${item.ok ? 'ok' : item.kind}`).join('>')}>
        {receipt.ok ? <>
          <b data-keyword-ai-receipt-text>{receipt.fallbackNote
            ? `本次用模型 ${receipt.model} 生成 ${receipt.candidates.length} 条候选（${receipt.fallbackNote}）。`
            : `本次用模型 ${receipt.model} 生成 ${receipt.candidates.length} 条候选（${receipt.elapsedMs}ms）。`}</b>
          <small>{KEYWORD_AI_SYNONYM_NOTE}</small>
          {receipt.issues.length ? <small data-keyword-ai-receipt-issues={receipt.issues.join('；')}>{receipt.issues.join('；')}</small> : null}
        </>:<b data-keyword-ai-receipt-text>{receipt.message}</b>}
      </div> : null}

      {receipt?.prompt ? <details className="keyword-ai-prompt" data-keyword-ai-prompt={receipt.prompt.promptId}
        data-keyword-ai-prompt-chars={receipt.prompt.chars}>
        <summary>本次提示词（独立通道 {receipt.prompt.promptId}，{receipt.prompt.chars} 字）</summary>
        <pre data-keyword-ai-prompt-system>{receipt.prompt.system}</pre>
        <pre data-keyword-ai-prompt-user>{receipt.prompt.user}</pre>
      </details> : null}

      {rows.length ? <>
        <div className="keyword-ai-counts" data-keyword-ai-counts={`total:${counts.total}|selectable:${counts.selectable}|existing:${counts.existing}|duplicate:${counts.duplicate}|synonym:${counts.synonym}`}>
          <span>共 {counts.total} 条</span>
          <span>可采纳 {counts.selectable} 条</span>
          <span>模板内已有（标灰跳过）{counts.existing} 条</span>
          {counts.duplicate ? <span>候选内重复（标灰跳过）{counts.duplicate} 条</span> : null}
          <span>疑似同义 {counts.synonym} 条</span>
        </div>
        <div className="keyword-ai-candidates" data-keyword-ai-candidates={rows.length}>
          {buckets.map((bucket) => <div className="keyword-ai-bucket" key={bucket.group}
            data-keyword-ai-bucket={bucket.group}
            data-keyword-ai-bucket-selectable={bucket.selectable}
            data-keyword-ai-bucket-selected={bucket.selected}>
            <div className="keyword-ai-bucket-head">
              <label className="framing-enable">
                <input type="checkbox" data-keyword-ai-bucket-toggle={bucket.group}
                  checked={bucket.allSelected}
                  disabled={!bucket.keys.length}
                  onChange={(event) => setSelection(selectKeywordCandidates(selection, bucket.keys, event.target.checked))}/>
                <b>{bucket.group}</b>
              </label>
              <small>{bucket.selectable ? `可采纳 ${bucket.selected}/${bucket.selectable}` : bucket.blockedText}</small>
            </div>
            {bucket.rows.map((row) => <div className={`keyword-ai-row${row.blocked ? ' is-blocked' : ''}`} key={row.key}
              data-keyword-ai-candidate={row.key}
              data-keyword-ai-candidate-group={row.group}
              data-keyword-ai-candidate-term={row.term}
              data-keyword-ai-candidate-reason={row.reason}
              data-keyword-ai-candidate-existing={row.blockKind === 'existing' ? 'true' : 'false'}
              data-keyword-ai-candidate-duplicate={row.blockKind === 'duplicate' ? 'true' : 'false'}
              data-keyword-ai-candidate-blocked={row.blocked ? 'true' : 'false'}
              data-keyword-ai-candidate-synonym={row.synonym ? row.synonym.term : ''}
              data-keyword-ai-candidate-checked={selection[row.key] && !row.blocked ? 'true' : 'false'}>
              <label className="framing-enable">
                <input type="checkbox" data-keyword-ai-candidate-check={row.key}
                  checked={Boolean(selection[row.key]) && !row.blocked}
                  disabled={row.blocked}
                  onChange={(event) => setSelection(selectKeywordCandidates(selection, [row.key], event.target.checked))}/>
                <em data-keyword-ai-candidate-text>{row.term}</em>
              </label>
              <small className="keyword-ai-reason" data-keyword-ai-candidate-reason-text>{row.reason || '（模型没有给推荐理由）'}</small>
              {row.blocked ? <small className="keyword-ai-blocked" data-keyword-ai-candidate-block-text={blockedTextOf(row)}>{row.blockText}</small> : null}
              {row.synonymText ? <small className="keyword-ai-synonym" data-keyword-ai-candidate-synonym-text={row.synonymText}>{row.synonymText}</small> : null}
            </div>)}
          </div>)}
        </div>
      </> : null}

      {adoptReport ? <div className="keyword-ai-adopt" data-keyword-ai-adopt-report={adoptReport.added.length}
        data-keyword-ai-adopt-skipped={adoptReport.skipped.length}
        data-keyword-ai-adopt-groups={adoptReport.groupsCreated.join('|')}
        data-keyword-ai-adopt-text={adoptReport.reportText}>
        <b><ListPlus size={14}/>已写进草稿区（{adoptReport.added.length} 条）</b>
        <small>{adoptReport.reportText}</small>
        {adoptReport.added.length ? <ul>{adoptReport.added.map((item) => <li key={`${item.group}:${item.term}`} data-keyword-ai-adopt-row={`${item.group}:${item.term}`}>{item.group} · {item.term}</li>)}</ul> : null}
      </div> : null}

      {/* 留痕（验收原文「每次候选、采纳与丢弃都留痕（谁、什么时候、采纳了哪些词）」）：
          读的就是审计日志里这三个动作、这一套模板的记录，与权限页的审计列表同源。 */}
      <div className="keyword-ai-trail" data-keyword-ai-trail={trail.length}>
        <div className="keyword-ai-trail-head">
          <b>AI 补充留痕（{trail.length} 条）</b>
          <small>候选 / 采纳 / 丢弃都写进审计日志：操作人、时间与采纳了哪些词都在里面。</small>
        </div>
        {trail.length ? <ul>{trail.map((entry) => <li key={entry.id} data-keyword-ai-trail-row={entry.id}
          data-keyword-ai-trail-action={entry.action}>
          <span>{entry.actionLabel}</span>
          <em>{entry.actorName || entry.actorId || '未知操作人'}</em>
          <small>{entry.detail}</small>
        </li>)}</ul> : <p className="persona-empty">还没有 AI 补充记录：生成一次候选、采纳或丢弃之后，这里会留下「谁 / 什么时候 / 采纳了哪些词」。</p>}
      </div>

      {notice ? <p className="keyword-ai-notice" data-keyword-ai-notice>{notice}</p> : null}
    </> : null}

    {plan.emptyText && open ? <p className="form-error" data-keyword-ai-model-empty><CircleAlert size={15}/>{plan.emptyText}</p> : null}
  </div>;
}
