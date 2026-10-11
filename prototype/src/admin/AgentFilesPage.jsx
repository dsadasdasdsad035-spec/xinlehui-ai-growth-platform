// 管理员端「Agent 指令与记忆」：左列表按「类型 × 生效范围」分组（平台 / 机构 / 老师 agent.md
// 与 学员 / 班级 / 机构记忆），右侧是 Markdown 编辑器 + 实时预览 + 版本历史。
//
// 这一页是老师端生成点评时「加载了什么」的数据源：`data/agentFiles.js` 按固定顺序读这些文件，
// 把 agent.md 与记忆文件拼进 system 提示词，并把版本指纹写进推理轨迹。所以这里的每一次改动
// 都必须**留档**：版本自增 + 版本快照 + 变更历史（写入口全在 `data/agentFileAdmin.js`，
// 页面不许自己动 version / versions / history / updatedBy 这几个字段）。
//
// 写入一律走 `services/agentFilesApi.js`（先落本机镜像、再推云端），页面只做表单校验与引用范围提示。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Copy, FileText, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button, PageHeader } from '../ui';
import { AGENT_FILE_CHAR_LIMIT, AGENT_FILE_KINDS, AGENT_FILE_KIND_LABELS, AGENT_FILE_SCOPE_LABELS, AGENT_FILE_VARIABLES, renderAgentFileContent } from '../data/agentFiles';
import {
  AGENT_FILE_BUDGET_NOTE, AGENT_FILE_DELETE_NOTE, AGENT_FILE_EDITABLE_FIELDS, AGENT_FILE_EMPTY_NOTE,
  AGENT_FILE_KIND_HINTS, AGENT_FILE_RESTORE_NOTE, AGENT_FILE_SAVE_NOTE, AGENT_FILE_SCOPES_BY_KIND,
  AGENT_FILE_SCOPE_HINTS, agentFileDiff, agentFileDiffText, agentFileListMeta, agentFileOrderText,
  agentFileReferenceText, agentFileScopeOptions, agentFileTimeText, agentFileTraceReferences,
  agentFileVariableButtons, agentFileVersionRows, createAgentFileDraft, duplicateAgentFileRecord,
  groupAgentFiles, normalizeAgentFileRecord, rollbackAgentFileRecord, saveAgentFileRecord,
  setAgentFileEnabledRecord
} from '../data/agentFileAdmin';
import { markdownStats, markdownStatsText, parseMarkdownBlocks } from '../data/markdown';
import { deleteRemoteAgentFile, saveRemoteAgentFile } from '../services/agentFilesApi';
import { loadReviewTraces } from '../data/reviewTrace';
import { loadStudentManagement } from '../data/studentManagement';
import { DEFAULT_ORG_ID, DEFAULT_ORG_NAME } from '../data/lessons';

/** 行内片段渲染（`**加粗**` / `` `代码` ``）：预览里不会出现 HTML 注入面。 */
function MarkdownInline({ inline = [] }) {
  return <>{inline.map((part, index) => {
    if (part.type === 'strong') return <b key={index}>{part.text}</b>;
    if (part.type === 'code') return <code key={index}>{part.text}</code>;
    return <React.Fragment key={index}>{part.text}</React.Fragment>;
  })}</>;
}

/** Markdown 实时预览：结构化块由 `data/markdown.js` 解析，这里只按类型渲染。 */
function MarkdownPreview({ text }) {
  const blocks = useMemo(() => parseMarkdownBlocks(text), [text]);
  if (!blocks.length) return <p className="persona-empty">还没有正文。左侧写点什么，这里会实时显示结构。</p>;
  return <div className="agent-file-preview" data-agent-file-preview data-agent-file-preview-blocks={blocks.length}>
    {blocks.map((block, index) => {
      const key = `${block.type}-${index}`;
      if (block.type === 'heading') return <p key={key} className={`md-heading md-h${block.level}`}><MarkdownInline inline={block.inline}/></p>;
      if (block.type === 'list') return <ul key={key}>{block.items.map((item, i) => <li key={i}><MarkdownInline inline={item.inline}/></li>)}</ul>;
      if (block.type === 'ordered') return <ol key={key} start={block.start}>{block.items.map((item, i) => <li key={i}><MarkdownInline inline={item.inline}/></li>)}</ol>;
      if (block.type === 'quote') return <blockquote key={key}><MarkdownInline inline={block.inline}/></blockquote>;
      if (block.type === 'code') return <pre key={key}>{block.text}</pre>;
      if (block.type === 'hr') return <hr key={key}/>;
      return <p key={key} className="md-paragraph"><MarkdownInline inline={block.inline}/></p>;
    })}
  </div>;
}

export default function AgentFilesPage({ agentFiles = [], setAgentFiles, setToast, teacherProfiles = [], adminName = '' }) {
  // 后台这个会话是「平台管理员」（原型阶段没有账号体系，会话身份串就是操作人 —— 与课次 teacherId 同一口径）。
  const operator = String(adminName || '平台管理员');
  const records = useMemo(() => (Array.isArray(agentFiles) ? agentFiles : []).map(normalizeAgentFileRecord).filter(item => item.id), [agentFiles]);
  const groups = useMemo(() => groupAgentFiles(records), [records]);

  const [editingId, setEditingId] = useState(() => records[0]?.id || '');
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [compareVersion, setCompareVersion] = useState('');
  const [confirmRollback, setConfirmRollback] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const contentRef = useRef(null);

  const editing = isNew ? null : records.find(item => item.id === editingId) || null;
  const editingKey = editing ? `${editing.id}@${editing.version}@${editing.updatedAt}` : '';

  // 选中项 / 保存结果变了就重置草稿（保存后 version 与 updatedAt 会变，于是这里自动切到新一版）。
  useEffect(() => {
    if (isNew) return;
    setDraft(editing ? { ...editing } : null);
    setNotice('');
    setCompareVersion('');
    setConfirmRollback('');
    setConfirmDelete(false);
  }, [editingKey, isNew]);

  const scopeSources = useMemo(() => {
    const management = loadStudentManagement();
    return {
      orgId: DEFAULT_ORG_ID,
      orgName: DEFAULT_ORG_NAME,
      teachers: (Array.isArray(teacherProfiles) ? teacherProfiles : []).map(item => ({ id: item.id, name: item.name })),
      students: management.students.map(item => ({ name: item.name })),
      classes: management.classes.map(item => ({ id: item.id, name: item.name }))
    };
  }, [teacherProfiles]);

  const patchDraft = (key, value) => setDraft(current => (current ? { ...current, [key]: value } : current));

  /** 换类型：范围收敛到该类型的合法值，否则文件会落在「不会被加载」的组合上。 */
  const selectKind = (kind) => setDraft(current => {
    if (!current) return current;
    const list = AGENT_FILE_SCOPES_BY_KIND[kind] || [];
    const scope = list.includes(current.scope) ? current.scope : list[0];
    const name = current.name && current.name !== AGENT_FILE_KIND_LABELS[current.kind] ? current.name : AGENT_FILE_KIND_LABELS[kind] || current.name;
    return { ...current, kind, scope, name };
  });

  const draftFieldsOf = (source) => {
    const fields = {};
    AGENT_FILE_EDITABLE_FIELDS.forEach(key => { fields[key] = source ? source[key] : undefined; });
    return fields;
  };

  /** 把草稿里手改的字段并进一条已保存的记录（启停 / 复制 / 回滚时不能让未保存的编辑静默丢掉）。 */
  const recordWithDraftFields = (record) => ({ ...record, ...draftFieldsOf(draft) });

  const commit = async (record, okText) => {
    const nextList = records.some(item => item.id === record.id)
      ? records.map(item => (item.id === record.id ? record : item))
      : [...records, record];
    setAgentFiles(nextList);
    setSaving(true);
    try {
      await saveRemoteAgentFile(record);
      setToast(okText);
    } catch {
      // agentFilesApi 推云端之前本机镜像已经落盘（persistAgentFiles 由 state 变化触发），
      // 所以这里只提示同步失败 —— 不要回滚 state，否则刷新后刚保存的那一版反而没了。
      setToast('已保存到本机；云端暂未连通，稍后可重试。');
    } finally {
      setSaving(false);
    }
  };

  const startNew = (kind) => {
    const scope = (AGENT_FILE_SCOPES_BY_KIND[kind] || [])[0];
    setIsNew(true);
    setEditingId('');
    setNotice('');
    setCompareVersion('');
    setConfirmRollback('');
    setConfirmDelete(false);
    setDraft(createAgentFileDraft({
      kind,
      scope,
      name: kind === AGENT_FILE_KINDS.memory ? '新的记忆文件' : '新的 agent.md',
      content: ''
    }));
  };

  const save = async () => {
    if (!draft) return;
    const name = String(draft.name || '').trim();
    if (!name) { setNotice('请先填写名称：加载清单与推理轨迹里都靠它认人。'); return; }
    const wasNew = isNew;
    // 保存的基准是**上一次落盘的那一条**（isNew 时还没有，就用草稿自己），
    // patch 才是草稿里手改的字段 —— 变更历史里的「改动：…」是这两者比出来的。
    const record = saveAgentFileRecord(isNew ? draft : editing, {
      name,
      kind: draft.kind,
      scope: draft.scope,
      scopeRef: draft.scopeRef,
      sortOrder: draft.sortOrder,
      content: draft.content
    }, { by: operator, at: Date.now() });
    setNotice('');
    setIsNew(false);
    setEditingId(record.id);
    await commit(record, wasNew
      ? `「${record.name}」已创建（${record.version}），老师端下次生成即加载`
      : `「${record.name}」已保存为 ${record.version}`);
  };

  const toggleEnabled = async () => {
    if (!editing) return;
    const base = recordWithDraftFields(editing);
    const record = setAgentFileEnabledRecord(base, base.enabled === false, { by: operator, at: Date.now() });
    if (record.version === base.version) { setToast('状态没有变化'); return; }
    setDraft({ ...record });
    await commit(record, record.enabled
      ? `「${record.name}」已启用（${record.version}）`
      : `「${record.name}」已停用（${record.version}）：后续生成不再加载它`);
  };

  const duplicate = async () => {
    if (!editing) return;
    const record = duplicateAgentFileRecord(recordWithDraftFields(editing), { existing: records, by: operator, at: Date.now() });
    setIsNew(false);
    setEditingId(record.id);
    setDraft({ ...record });
    await commit(record, `已复制为「${record.name}」（${record.version}）`);
  };

  const rollback = async (version) => {
    if (!editing) return;
    const record = rollbackAgentFileRecord(editing, version, { by: operator, at: Date.now() });
    setConfirmRollback('');
    setCompareVersion('');
    setDraft({ ...record });
    await commit(record, `已回滚到 ${version}：新版本为 ${record.version}，历史版本都保留`);
  };

  const remove = async () => {
    if (!editing) return;
    const target = editing;
    const nextList = records.filter(item => item.id !== target.id);
    setConfirmDelete(false);
    setIsNew(false);
    setEditingId(nextList[0]?.id || '');
    setDraft(nextList[0] ? { ...nextList[0] } : null);
    setAgentFiles(nextList);
    try {
      await deleteRemoteAgentFile(target.id);
      setToast(`「${target.name}」已从文件库删除`);
    } catch {
      setToast('已从本机移除，云端删除未同步。');
    }
  };

  /** 插入变量占位符：有光标就插在光标处（并把光标移到占位符之后），否则追加到末尾。 */
  const insertVariable = (token) => {
    const element = contentRef.current;
    if (!element) { patchDraft('content', `${draft?.content || ''}${token}`); return; }
    const start = Number.isFinite(element.selectionStart) ? element.selectionStart : String(element.value).length;
    const end = Number.isFinite(element.selectionEnd) ? element.selectionEnd : start;
    const next = `${element.value.slice(0, start)}${token}${element.value.slice(end)}`;
    patchDraft('content', next);
    requestAnimationFrame(() => {
      element.focus();
      try { element.setSelectionRange(start + token.length, start + token.length); } catch { /* 光标设置失败不影响内容 */ }
    });
  };

  const meta = draft ? agentFileListMeta(draft) : null;
  const stats = draft ? markdownStats(draft.content) : null;
  const variableReport = draft ? renderAgentFileContent(draft.content, {}) : { missing: [], replaced: [], empty: [] };
  const usedVariables = [...new Set([...variableReport.replaced, ...variableReport.empty])];
  const scopeOptions = draft ? agentFileScopeOptions(draft.scope, scopeSources) : [];
  const scopeHint = draft ? (AGENT_FILE_SCOPE_HINTS[draft.scope] || '') : '';
  const versionRows = draft ? agentFileVersionRows(draft) : [];
  const compareRow = compareVersion ? versionRows.find(row => row.versionLabel === compareVersion) || null : null;
  const diff = compareRow && draft ? agentFileDiff(compareRow.content, draft.content) : null;
  const reference = editing ? agentFileTraceReferences(editing.id, loadReviewTraces()) : { count: 0, latestAt: '' };
  const dirty = Boolean(draft && (isNew || AGENT_FILE_EDITABLE_FIELDS.some(key => String(draft[key] ?? '') !== String(editing?.[key] ?? ''))));

  return <>
    <PageHeader
      title="Agent 指令与记忆"
      desc="老师端生成五维点评时加载的 agent.md 与记忆文件：按类型与生效范围分组维护，每次保存都留一版，可对比、可回滚。"
      prd="PRD-8 / F-REVIEW-PROMPT-02"
      actions={<>
        <Button variant="secondary" icon={FileText} onClick={() => startNew(AGENT_FILE_KINDS.memory)}>新增记忆文件</Button>
        <Button icon={Plus} onClick={() => startNew(AGENT_FILE_KINDS.agentMd)}>新增 agent.md</Button>
      </>}/>

    <div className="agent-files-order">
      <b>加载顺序</b>
      <span>{agentFileOrderText()}</span>
    </div>

    <div className="split-page persona-page agent-files-page">
      <div className="panel persona-list agent-file-groups">
        <div className="panel-head"><h2>文件</h2><small>{records.length} 份 · {groups.length} 组</small></div>
        {groups.map(group => <div className="agent-file-group" key={group.key} data-agent-file-group={group.key} data-agent-file-group-count={group.files.length}>
          <div className="agent-file-group-head">
            <b>{group.label}</b>
            <small>{group.order ? `加载顺序第 ${group.order} 步` : '不参与加载'}</small>
          </div>
          <p className="agent-file-group-note">{group.scopeHint}</p>
          {group.files.map(record => {
            const rowMeta = agentFileListMeta(record);
            const active = !isNew && record.id === editingId;
            return <button
              key={record.id}
              className={active ? 'active' : ''}
              data-agent-file-id={record.id}
              data-agent-file-row-version={rowMeta.versionText}
              data-agent-file-row-enabled={record.enabled !== false ? 'true' : 'false'}
              data-agent-file-row-updated={rowMeta.updatedText}
              onClick={() => { setIsNew(false); setEditingId(record.id); setConfirmDelete(false); setCompareVersion(''); }}
            >
              <span className={`agent-file-chip ${record.enabled === false ? 'is-off' : ''}`}>{record.enabled === false ? '已停用' : rowMeta.versionText}</span>
              <div>
                <b>{record.name}</b>
                <small>{rowMeta.scopeText} · {rowMeta.charsText}</small>
              </div>
              <em>{rowMeta.updatedShortText || '未改动'}</em>
            </button>;
          })}
          {group.files.length ? null : <p className="persona-empty">这一层还没有文件。</p>}
        </div>)}
      </div>

      <div className="panel persona-editor"
        data-agent-file-current={draft ? draft.id : ''}
        data-agent-file-current-version={draft ? draft.version : ''}
        data-agent-file-dirty={dirty ? 'true' : 'false'}
        data-agent-file-unsaved={isNew ? 'true' : 'false'}>
        {draft ? <>
          <div className="panel-head">
            <div>
              <h2>{draft.name || '未命名文件'}</h2>
              <p>
                {isNew
                  ? '还没有保存：保存后才会写进文件库，并产生 v1 与「新建」这一条版本记录。'
                  : <>当前 <b data-agent-file-version={draft.version}>{draft.version}</b> · {draft.enabled === false ? '已停用（不进入新生成的点评）' : '启用中'}{meta?.updatedText ? ` · 最后变更 ${meta.updatedText}` : ''}</>}
              </p>
            </div>
            <div className="row-actions">
              <Button onClick={save} disabled={saving} data-agent-file-save>{saving ? '保存中…' : (isNew ? '保存新文件' : '保存（版本自增）')}</Button>
              {isNew ? null : <>
                <button type="button" className="text-link" disabled={saving} onClick={duplicate} data-agent-file-duplicate><Copy size={14}/>复制为副本</button>
                <button type="button" className="text-link" disabled={saving} onClick={toggleEnabled} data-agent-file-toggle>{draft.enabled === false ? '启用' : '停用'}</button>
                <button type="button" className="icon-btn danger-text" title="删除" onClick={() => setConfirmDelete(true)}><Trash2 size={16}/></button>
              </>}
            </div>
          </div>

          <div className="agent-file-facts">
            <span>{AGENT_FILE_KIND_HINTS[draft.kind] || ''}</span>
            <span>{scopeHint}</span>
            <span>{AGENT_FILE_SAVE_NOTE}</span>
          </div>

          <div className="form-grid compact">
            <label>名称<input value={draft.name || ''} placeholder="例如：机构 agent.md（昕乐绘）" onChange={event => patchDraft('name', event.target.value)}/></label>
            <label>类型
              <select value={draft.kind} onChange={event => selectKind(event.target.value)}>
                {Object.values(AGENT_FILE_KINDS).map(kind => <option key={kind} value={kind}>{AGENT_FILE_KIND_LABELS[kind]}</option>)}
              </select>
            </label>
            <label>生效范围
              <select value={draft.scope} onChange={event => patchDraft('scope', event.target.value)}>
                {(AGENT_FILE_SCOPES_BY_KIND[draft.kind] || []).map(scope => <option key={scope} value={scope}>{AGENT_FILE_SCOPE_LABELS[scope]}</option>)}
              </select>
            </label>
            <label>范围对象<input list="agent-file-scope-options" value={draft.scopeRef || ''} placeholder="留空 = 本层通用" onChange={event => patchDraft('scopeRef', event.target.value)}/></label>
            <label>排序（越小越先加载）<input type="number" value={draft.sortOrder ?? 90} onChange={event => patchDraft('sortOrder', Number(event.target.value) || 0)}/></label>
          </div>
          <datalist id="agent-file-scope-options">
            {scopeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </datalist>
          <p className="persona-empty">变量占位符：{usedVariables.length ? usedVariables.map(name => `{${name}}`).join(' ') : '暂未使用'}</p>

          <div className="agent-file-editor">
            <div className="agent-file-md">
              <div className="agent-file-md-head">
                <b>Markdown 编辑</b>
                <small data-agent-file-chars={stats.chars} data-agent-file-stats={markdownStatsText(draft.content)}>实时字符数：{markdownStatsText(draft.content)}</small>
              </div>
              <textarea
                ref={contentRef}
                rows={16}
                value={draft.content || ''}
                data-agent-file-editor
                placeholder={'# 平台指令\n- 只依据画面与素材里真实可见的证据作答。'}
                onChange={event => patchDraft('content', event.target.value)}
              />
              <div className="agent-file-vars" data-agent-file-variable-count={AGENT_FILE_VARIABLES.length}>
                <span>插入变量：</span>
                {agentFileVariableButtons().map(button => <button key={button.name} type="button" className="text-link" onClick={() => insertVariable(button.token)} data-agent-file-variable={button.name}>{button.token}</button>)}
              </div>
            </div>
            <div className="agent-file-md">
              <div className="agent-file-md-head"><b>预览</b><small>进提示词的是左侧原文（变量在加载时替换成真实值）</small></div>
              <MarkdownPreview text={draft.content || ''}/>
            </div>
          </div>

          <div className="agent-file-editor-notes">
            <p>{AGENT_FILE_EMPTY_NOTE}</p>
            <p>{AGENT_FILE_BUDGET_NOTE}</p>
            {stats.chars > AGENT_FILE_CHAR_LIMIT
              ? <p className="is-warn" data-agent-file-over-budget="true">这一份已经超过单文件总量上限（{AGENT_FILE_CHAR_LIMIT} 字）：加载时会被截断，排在它后面的文件会被挤掉。</p>
              : null}
            {variableReport.missing.length
              ? <p className="is-warn" data-agent-file-unknown-variables={variableReport.missing.map(name => `{${name}}`).join(' ')}>
                  未知占位符 {variableReport.missing.map(name => `{${name}}`).join(' ')}：加载时保留原文，可选变量为 {AGENT_FILE_VARIABLES.map(name => `{${name}}`).join(' ')}。
                </p>
              : null}
          </div>

          {notice ? <div className="form-error"><CircleAlert size={16}/>{notice}</div> : null}

          <div className="agent-file-history" data-agent-file-versions={versionRows.length} data-agent-file-history={draft.history.length}>
            <div className="panel-head">
              <div>
                <h3>版本历史（{versionRows.length} 版）</h3>
                <p>{AGENT_FILE_RESTORE_NOTE}</p>
              </div>
            </div>
            <ol>
              {versionRows.map(row => <li key={row.versionLabel}
                data-agent-file-version-row={row.versionLabel}
                data-agent-file-version-action={row.action}
                data-agent-file-version-current={row.isCurrent ? 'true' : 'false'}
                data-agent-file-version-chars={row.chars}
                data-agent-file-version-hash={row.hash}>
                <div className="agent-file-version-head">
                  <b>{row.versionLabel}</b>
                  <span>{row.actionLabel}</span>
                  {row.isCurrent ? <em>当前</em> : <em className="muted">{row.enabledText}</em>}
                </div>
                <small>{row.changeText || '无变更记录'}</small>
                <div className="agent-file-version-meta">{row.charsText} · {row.hashText}</div>
                <div className="row-actions">
                  <button type="button" className="text-link" data-agent-file-compare={row.versionLabel} onClick={() => setCompareVersion(row.versionLabel === compareVersion ? '' : row.versionLabel)}>{row.versionLabel === compareVersion ? '收起对比' : '对比'}</button>
                  <button type="button" className="text-link" disabled={row.isCurrent} data-agent-file-rollback={row.versionLabel} onClick={() => setConfirmRollback(row.versionLabel)}><RotateCcw size={13}/>回滚到此版本</button>
                </div>
              </li>)}
            </ol>
            {versionRows.length ? null : <p className="persona-empty" data-agent-file-version-empty="true">还没有版本：保存一次之后，这里会留一版（之后每保存一次 +1 版）。</p>}
            {diff && compareRow ? <div className="agent-file-diff" data-agent-file-diff={compareRow.versionLabel}>
              <div className="panel-head">
                <div>
                  <h3>对比 {compareRow.versionLabel}（旧）↔ 当前草稿（新）</h3>
                  <p data-agent-file-diff-summary>{agentFileDiffText(diff.stats)}</p>
                </div>
                <button type="button" className="text-link" onClick={() => setCompareVersion('')}>关闭对比</button>
              </div>
              <ol className="agent-file-diff-lines">
                {diff.lines.map((line, index) => <li key={index} className={`diff-${line.type}`} data-agent-file-diff-line={line.type}>
                  <span className="diff-mark">{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span>
                  <code>{line.text || ' '}</code>
                </li>)}
              </ol>
            </div> : null}
          </div>

          {confirmRollback ? <div className="danger-note" style={{ marginTop: 14 }}>
            <CircleAlert size={18}/>
            <span style={{ flex: 1 }}>
              回滚到 <b>{confirmRollback}</b>：把那一版的正文与启停状态写成「新的」版本（版本号继续 +1），历史版本一条不删。
              当前草稿里没保存的修改会被丢弃。
            </span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button variant="secondary" onClick={() => setConfirmRollback('')}>取消</Button>
              <Button onClick={() => rollback(confirmRollback)}>确认回滚</Button>
            </span>
          </div> : null}

          {confirmDelete ? <div className="danger-note" style={{ marginTop: 14 }}>
            <CircleAlert size={18}/>
            <span style={{ flex: 1 }}>
              {agentFileReferenceText(reference)}{AGENT_FILE_DELETE_NOTE}
            </span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>取消</Button>
              <Button variant="danger" onClick={remove}>确认删除</Button>
            </span>
          </div> : null}

          {isNew ? null : <p className="persona-empty" data-agent-file-reference={reference.count}>
            引用范围：{agentFileReferenceText(reference)}{agentFileTimeText(editing?.updatedAt) ? `最后变更 ${agentFileTimeText(editing.updatedAt)}。` : ''}
          </p>}
        </> : <p className="persona-empty"><FileText size={16}/> 选择左侧的一份文件，或点右上角新增一份。</p>}
      </div>
    </div>
  </>;
}
