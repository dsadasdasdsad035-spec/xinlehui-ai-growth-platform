// 管理员端「作品观察词模板」：左列表 + 右编辑，维护多套模板的增删改查 / 启停 / 排序，
// 以及每套模板的分组与词条两级内容。
//
// 这一页是老师端第三步「观察词面板 + 提示词候选清单 + 模型返回值校验」的数据源
// （[第三步 US-109]：三处共用 `keywordTemplateLoadout()` 产物）。所以这里的每一次改动都要**留档**：
// 版本自增 + 版本快照 + 变更历史（写入口全在 `data/reviewKeywordAdmin.js`，页面不许自己动
// `templateVersion` / `versions` / `history` / `updatedBy` / `updatedAt` 这几个字段）。
//
// 两个闸门都读数据层的同一份纯函数，页面**不许**再写一遍：
//   · `keywordTemplateSaveGate(draft)` —— 保存前拦下无名分组与「归一化后重复的词」；
//   · `keywordTemplateDuplicateIndex(draft)` —— 界面上把重复的那两行当场标出来。
//
// 写入一律走 `services/reviewKeywordTemplatesApi.js`（云端 `review_keyword_templates` 表还没建，
// 推不上去时只提示「已保存到本机」—— 本机镜像才是老师端当前真正读的那一份）。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CircleAlert, Copy, Download, GripVertical, ListChecks, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Button, PageHeader } from '../ui';
import {
  KEYWORD_TEMPLATE_COPY_NOTE,
  KEYWORD_TEMPLATE_DELETE_NOTE,
  KEYWORD_TEMPLATE_EMPTY_NOTE,
  KEYWORD_TEMPLATE_EXPORT_NOTE,
  KEYWORD_TEMPLATE_IMPORT_NOTE,
  KEYWORD_TEMPLATE_ORDER_NOTE,
  KEYWORD_TEMPLATE_RESOLVE_NOTE,
  KEYWORD_TEMPLATE_ROLLBACK_NOTE,
  KEYWORD_TEMPLATE_SAVE_NOTE,
  KEYWORD_TEMPLATE_TERMS_PER_GROUP_LIMIT,
  applyKeywordTemplateDefault,
  buildKeywordTemplateExport,
  copyKeywordTemplateName,
  createKeywordTemplateDraft,
  duplicateKeywordTemplateRecord,
  keywordGroupAdd,
  keywordGroupMove,
  keywordGroupRemove,
  keywordGroupRename,
  keywordGroupSetEnabled,
  keywordTemplateCourseAdd,
  keywordTemplateCourseOptions,
  keywordTemplateCourseRemove,
  keywordTemplateDirty,
  keywordTemplateDraftFrom,
  keywordTemplateDuplicateIndex,
  keywordTemplateDuplicateTerms,
  keywordTemplateEditGroups,
  keywordTemplateExportFilename,
  keywordTemplateExportText,
  keywordTemplateListMeta,
  keywordTemplateOrderText,
  keywordTemplateSaveGate,
  keywordTemplateTimeText,
  keywordTemplateVersionRows,
  keywordTermAdd,
  keywordTermMove,
  keywordTermRemove,
  keywordTermSet,
  keywordTermSetEnabled,
  mergeKeywordTemplateImport,
  moveKeywordTemplate,
  moveKeywordTemplateTo,
  normalizeKeywordTemplateRecord,
  parseKeywordTemplateCourseTypes,
  parseKeywordTemplateImport,
  removeKeywordTemplate,
  rollbackKeywordTemplateRecord,
  saveKeywordTemplateRecord,
  setKeywordTemplateEnabledRecord,
  sortKeywordTemplates
} from '../data/reviewKeywordAdmin';
import { KEYWORD_TEMPLATE_MODE_LIST, KEYWORD_TEMPLATE_MODES, keywordTemplateCounts } from '../data/reviewKeywordTemplates';
import { COURSE_AGE_RANGE_OPTIONS } from '../data/courses';
import { DEFAULT_ORG_ID } from '../data/lessons';
import { deleteRemoteReviewKeywordTemplate, saveRemoteReviewKeywordTemplate } from '../services/reviewKeywordTemplatesApi';
import KeywordAiPanel from './KeywordAiPanel';

/** 左列表按适用模式分两栏（个人 / 班级）—— 与老师端「模式不同、词表不同」一一对应。 */
function modeGroups(records) {
  return KEYWORD_TEMPLATE_MODE_LIST.map((mode) => ({
    mode,
    label: KEYWORD_TEMPLATE_MODES[mode] || mode,
    records: records.filter((item) => item.mode === mode)
  }));
}

/** JSON 导出走浏览器原生下载（与「保存图片」同一套 `<a download>`）。 */
function downloadJsonFile(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 下载是异步取字节，晚一点再回收 object URL。
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function KeywordTemplatesPage({
  keywordTemplates = [],
  setKeywordTemplates = () => {},
  setToast = () => {},
  adminName = '',
  courses = [],
  // US-111：AI 补充观察词要写审计留痕（读同一份审计日志，与「权限与合规」面板同源），
  // 还要按模型目录走独立通道的模型链。
  auditLog = [],
  recordAudit = () => null,
  reviewModels = [],
  orgId = DEFAULT_ORG_ID
}) {
  // 后台这个会话是「平台管理员」（原型阶段没有账号体系，会话身份串就是操作人 —— 与课次 teacherId 同一口径）。
  const operator = String(adminName || '平台管理员');
  const records = useMemo(() => sortKeywordTemplates(keywordTemplates), [keywordTemplates]);
  const groups = useMemo(() => modeGroups(records), [records]);

  const [editingKey, setEditingKey] = useState(() => sortKeywordTemplates(keywordTemplates)[0]?.templateKey || '');
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [courseInput, setCourseInput] = useState('');
  // ---- US-110b：拖拽排序 / 复制为派生模板 / 导出导入 / 回滚 ----------------
  const [confirmRollback, setConfirmRollback] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyName, setCopyName] = useState('');
  const [copyCourse, setCopyCourse] = useState('');
  const [importReport, setImportReport] = useState(null);
  // 拖拽排序的选中项（松手即提交）。指针可能离开手柄，所以拖动期间在 window 上收 move/up。
  const dragRef = useRef(null);
  const [dragView, setDragView] = useState(null);
  const importRef = useRef(null);

  const editing = isNew ? null : records.find((item) => item.templateKey === editingKey) || null;
  const editingStamp = editing ? `${editing.templateKey}@${editing.templateVersion}@${editing.updatedAt}` : '';

  // 选中项变了就重置草稿（保存后版本与时间会变，于是这里自动切到新一版）。
  useEffect(() => {
    if (isNew) return;
    setDraft(editing ? keywordTemplateDraftFrom(editing) : null);
    setNotice('');
    setConfirmDelete(false);
    setCourseInput('');
    setConfirmRollback('');
    setCopyOpen(false);
  }, [editingStamp, isNew]);

  /**
   * 拖拽排序（US-110b）：按住手柄把这一套拖到同模式另一套的位置上，松手立刻落盘。
   * 指针抬起的位置用 `elementFromPoint` 找落点行 —— 拖动过程中高亮的那一行不一定是松手那一行。
   */
  useEffect(() => {
    if (!dragView) return undefined;
    const overKeyOf = (x, y) => {
      const element = document.elementFromPoint(x, y);
      const row = element && element.closest ? element.closest('[data-keyword-template-pick]') : null;
      return row ? row.getAttribute('data-keyword-template-pick') || '' : '';
    };
    const onMove = (event) => {
      const overKey = overKeyOf(event.clientX, event.clientY);
      setDragView((current) => (current && current.overKey === overKey ? current : (current ? { ...current, overKey } : current)));
    };
    const onUp = (event) => {
      const current = dragRef.current;
      const target = overKeyOf(event.clientX, event.clientY) || current?.overKey || '';
      dragRef.current = null;
      setDragView(null);
      if (!current || !target || target === current.key) return;
      const nextList = moveKeywordTemplateTo(records, current.key, target);
      if (keywordTemplateOrderText(nextList) === keywordTemplateOrderText(records)) return;
      const moved = nextList.find((item) => item.templateKey === current.key);
      setKeywordTemplates(nextList);
      // 顺序改动也推一次云端（表没建时安静失败）：改的是同一个 template_key，upsert 幂等。
      if (moved) void saveRemoteReviewKeywordTemplate(moved).catch(() => {});
      setToast(`「${moved?.name || ''}」的顺序已保存：老师端按新顺序解析`);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragView, records, setKeywordTemplates, setToast]);

  const startDrag = (event, templateKey) => {
    if (saving) return;
    event.preventDefault();
    dragRef.current = { key: templateKey, overKey: '' };
    setDragView({ key: templateKey, overKey: '' });
  };

  const patch = (key, value) => setDraft((current) => (current ? { ...current, [key]: value } : current));

  const editGroups = useMemo(() => keywordTemplateEditGroups(draft), [draft]);
  const duplicateIndex = useMemo(() => keywordTemplateDuplicateIndex(draft), [draft]);
  const duplicates = useMemo(() => keywordTemplateDuplicateTerms(draft), [draft]);
  // 保存闸门（唯一判据）：按钮禁用、save() 前置拦截、注意事项都读它。
  const gate = useMemo(() => keywordTemplateSaveGate(draft), [draft]);
  const counts = useMemo(() => (draft
    ? keywordTemplateCounts(normalizeKeywordTemplateRecord({ ...draft, groups: editGroups }))
    : { groups: 0, terms: 0 }), [draft, editGroups]);
  const courseOptions = useMemo(() => keywordTemplateCourseOptions(courses, draft), [courses, draft]);

  const meta = draft ? keywordTemplateListMeta(draft) : null;
  const savedMeta = editing ? keywordTemplateListMeta(editing) : null;
  const dirty = Boolean(draft && (isNew || keywordTemplateDirty(editing, draft)));
  const versionRows = useMemo(() => keywordTemplateVersionRows(draft), [draft]);

  const commit = async (record, nextList, okText) => {
    setKeywordTemplates(nextList);
    setSaving(true);
    try {
      await saveRemoteReviewKeywordTemplate(record);
      setToast(okText);
    } catch {
      // 推云端之前本机镜像已经落盘（persistReviewKeywordTemplates 由 state 变化触发），
      // 所以这里只提示同步失败 —— 不要回滚 state，否则刷新后刚保存的那一版反而没了。
      setToast('已保存到本机；云端暂未连通，稍后可重试。');
    } finally {
      setSaving(false);
    }
  };

  const startNew = (mode) => {
    setIsNew(true);
    setEditingKey('');
    setNotice('');
    setConfirmDelete(false);
    setCourseInput('');
    setDraft(createKeywordTemplateDraft({ mode }));
  };

  const save = async () => {
    if (!draft) return;
    // 保存闸门：重复词 / 无名分组在这里被拦下，一个 state 都不改（版本与镜像都不动）。
    if (!gate.ok) { setNotice(gate.issue); return; }
    setNotice('');
    const wasNew = isNew;
    const saved = saveKeywordTemplateRecord(wasNew ? null : editing, draft, { by: operator, at: Date.now() });
    const replaced = wasNew ? [...records, saved] : records.map((item) => (item.templateKey === saved.templateKey ? saved : item));
    // 同模式只能有一套默认模板：勾了默认就把同模式其它模板的标记清掉（库级属性，不增版本）。
    const nextList = sortKeywordTemplates(saved.isDefault ? applyKeywordTemplateDefault(replaced, saved.templateKey) : replaced);
    setIsNew(false);
    setEditingKey(saved.templateKey);
    setDraft(keywordTemplateDraftFrom(saved));
    await commit(saved, nextList, wasNew
      ? `「${saved.name}」已创建（v${saved.templateVersion}），老师端下一次生成即按它取词`
      : `「${saved.name}」已保存为 v${saved.templateVersion}`);
  };

  const toggleEnabled = async () => {
    if (!editing || !draft) return;
    const base = normalizeKeywordTemplateRecord({ ...draft, groups: editGroups });
    const record = setKeywordTemplateEnabledRecord(base, base.enabled === false, { by: operator, at: Date.now() });
    if (record.templateVersion === base.templateVersion) { setToast('状态没有变化'); return; }
    const nextList = records.map((item) => (item.templateKey === record.templateKey ? record : item));
    setDraft(keywordTemplateDraftFrom(record));
    await commit(record, sortKeywordTemplates(nextList), record.enabled
      ? `「${record.name}」已启用（v${record.templateVersion}）`
      : `「${record.name}」已停用（v${record.templateVersion}）：老师端不再命中它`);
  };

  const remove = async () => {
    if (!editing) return;
    const target = editing;
    const nextList = removeKeywordTemplate(records, target.templateKey);
    setConfirmDelete(false);
    setIsNew(false);
    setEditingKey(nextList[0]?.templateKey || '');
    setDraft(nextList[0] ? keywordTemplateDraftFrom(nextList[0]) : null);
    setKeywordTemplates(nextList);
    try {
      await deleteRemoteReviewKeywordTemplate(target.templateKey);
      setToast(`「${target.name}」已从观察词模板里删除`);
    } catch {
      setToast('已从本机移除，云端删除未同步。');
    }
  };

  /**
   * 排序：与同模式的邻居换位（`moveKeywordTemplate` 负责重排序号）。
   * 排序不改内容，所以**不增版本**（与装裱模板的 `moveFramingPreset` 同一口径），
   * 但改动照样落本机镜像 —— 老师端下一次生成就按新顺序解析。
   */
  const move = (templateKey, delta) => {
    const nextList = moveKeywordTemplate(records, templateKey, delta);
    if (keywordTemplateOrderText(nextList) === keywordTemplateOrderText(records)) {
      setToast(delta < 0 ? '已经是同模式里的第一套了' : '已经是同模式里的最后一套了');
      return;
    }
    const moved = nextList.find((item) => item.templateKey === templateKey);
    setKeywordTemplates(nextList);
    // 顺序改动也推一次云端（表没建时安静失败）：改的是同一个 template_key，upsert 幂等。
    if (moved) void saveRemoteReviewKeywordTemplate(moved).catch(() => {});
    setToast(`「${moved?.name || ''}」的顺序已更新：老师端按新顺序解析`);
  };

  /** 打开「复制为派生模板」表单：名字默认「（副本）」，派生课程类型留空 = 照抄源模板的适用范围。 */
  const openCopy = () => {
    if (!draft) return;
    setCopyName(copyKeywordTemplateName(draft.name, records.map((item) => item.name)));
    setCopyCourse('');
    setCopyOpen(true);
    setNotice('');
  };

  /**
   * 复制为派生模板：新 id + v1，分组 / 词条 / 适用范围照抄（可顺手把课程类型换成派生画种）。
   * 复制的是**当前编辑的内容**，所以先过与保存同一道闸门（重复词 / 无名分组不许带进新模板）。
   */
  const copy = async () => {
    if (!draft) return;
    if (!gate.ok) { setNotice(gate.issue); return; }
    const source = normalizeKeywordTemplateRecord({ ...draft, groups: editGroups });
    const derived = parseKeywordTemplateCourseTypes(copyCourse);
    const record = duplicateKeywordTemplateRecord(source, {
      existing: records,
      by: operator,
      at: Date.now(),
      name: copyName,
      courseTypes: derived.length ? derived : null
    });
    setCopyOpen(false);
    setNotice('');
    setIsNew(false);
    setEditingKey(record.templateKey);
    setDraft(keywordTemplateDraftFrom(record));
    await commit(record, sortKeywordTemplates([...records, record]), derived.length
      ? `已派生「${record.name}」（v${record.templateVersion}，适用课程类型：${derived.join(' / ')}）`
      : `已复制为「${record.name}」（v${record.templateVersion}）`);
  };

  /**
   * 回滚到任一历史版本：那一版的分组与配置写成**新的**版本（版本号 +1），历史版本一条不删。
   * 认不出的版本号 / 就是当前版本 → 一个字段都不动，只给一句提示。
   */
  const rollback = async (versionLabel) => {
    if (!editing) return;
    const record = rollbackKeywordTemplateRecord(editing, versionLabel, { by: operator, at: Date.now() });
    setConfirmRollback('');
    if (record.templateVersion === editing.templateVersion) {
      setNotice(`「${versionLabel}」没有可回滚的内容（它就是当前版本，或这一版没有留下快照）。`);
      return;
    }
    setNotice('');
    setIsNew(false);
    setEditingKey(record.templateKey);
    setDraft(keywordTemplateDraftFrom(record));
    const replaced = records.map((item) => (item.templateKey === record.templateKey ? record : item));
    const nextList = sortKeywordTemplates(record.isDefault ? applyKeywordTemplateDefault(replaced, record.templateKey) : replaced);
    await commit(record, nextList, `已回滚到 ${versionLabel}：新版本为 v${record.templateVersion}，历史版本都保留`);
  };

  /** 导出全部模板为 JSON（含分组、词条、适用范围、版本与变更历史）。 */
  const exportJson = () => {
    const payload = buildKeywordTemplateExport(records, { at: Date.now(), by: operator });
    const filename = keywordTemplateExportFilename(payload);
    downloadJsonFile(keywordTemplateExportText(payload), filename);
    setImportReport({ kind: 'export', text: `已导出 ${records.length} 套模板：${filename}` });
    setToast(`已导出 ${records.length} 套观察词模板（${filename}）`);
  };

  /**
   * 导入 JSON：按 `templateKey` 合并（已存在的更新 + 自增一版，新 key 直接加入）。
   * 解析失败只给可读原因，**一个字段都不改**（与保存闸门同一条纪律）。
   */
  const importJson = async (file) => {
    if (!file) return;
    const text = await file.text();
    const parsed = parseKeywordTemplateImport(text);
    if (!parsed.ok) {
      setNotice(parsed.message);
      setImportReport({ kind: 'error', text: parsed.message });
      return;
    }
    const merged = mergeKeywordTemplateImport(records, parsed.templates, {
      by: operator,
      at: Date.now(),
      source: keywordTemplateTimeText(parsed.payload?.exportedAt) || file.name
    });
    setNotice('');
    setKeywordTemplates(merged.list);
    // 逐条推云端（表没建时安静失败：本机镜像才是老师端当前真正读的那一份）。
    [...merged.added, ...merged.updated].forEach((record) => { void saveRemoteReviewKeywordTemplate(record).catch(() => {}); });
    setImportReport({ kind: 'ok', text: `${parsed.message}${merged.reportText}` });
    setToast(merged.reportText);
    const focus = merged.added[0] || merged.updated[0];
    if (focus) {
      setIsNew(false);
      setEditingKey(focus.templateKey);
      setDraft(keywordTemplateDraftFrom(focus));
    }
  };

  const addCourse = () => {
    const next = keywordTemplateCourseAdd(draft, courseInput);
    setCourseInput('');
    if (next === draft) return;
    setDraft(next);
  };

  return <>
    <PageHeader
      title="作品观察词模板"
      desc="老师端第三步的观察词候选清单来自这里：按反馈模式、课程类型与年龄段维护多套模板，改完保存即生效。"
      prd="PRD-8 / F-REVIEW-KW-01"
      actions={<>
        <Button variant="secondary" icon={ListChecks} onClick={() => startNew(KEYWORD_TEMPLATE_MODES.class)}>新增班级模板</Button>
        <Button icon={Plus} onClick={() => startNew(KEYWORD_TEMPLATE_MODES.personal)}>新增个人模板</Button>
      </>}/>

    <div className="keyword-templates-rule">
      <b>老师端怎么选</b>
      <span data-keyword-template-rule>{KEYWORD_TEMPLATE_RESOLVE_NOTE}</span>
    </div>

    <div className="keyword-template-toolbar">
      <Button variant="secondary" icon={Download} onClick={exportJson} data-keyword-template-export>导出 JSON</Button>
      <Button variant="secondary" icon={Upload} onClick={() => importRef.current?.click()} data-keyword-template-import>导入 JSON</Button>
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        data-keyword-template-import-input
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files && event.target.files[0];
          event.target.value = '';
          void importJson(file);
        }}/>
      <small>{KEYWORD_TEMPLATE_EXPORT_NOTE}{KEYWORD_TEMPLATE_IMPORT_NOTE}</small>
      {importReport ? <span className={`keyword-template-import-report is-${importReport.kind}`} data-keyword-template-import-report={importReport.kind} data-keyword-template-import-report-text={importReport.text}>{importReport.text}</span> : null}
    </div>

    <div className="split-page persona-page keyword-templates-page"
      data-keyword-template-dragging={dragView?.key || ''}
      data-keyword-template-drop-key={dragView?.overKey || ''}>
      <div className="panel persona-list keyword-template-groups">
        <div className="panel-head">
          <h2>模板</h2>
          <small>{records.length} 套 · 启用 {records.filter((item) => item.enabled !== false).length} 套 · 按住手柄拖拽排序</small>
        </div>
        {groups.map((group) => <div className="keyword-template-group" key={group.mode}
          data-keyword-template-mode-group={group.mode}
          data-keyword-template-mode-count={group.records.length}>
          <div className="keyword-template-group-head">
            <b>{group.label}</b>
            <small>{group.records.length} 套</small>
          </div>
          {group.records.map((record, rowIndex) => {
            const rowMeta = keywordTemplateListMeta(record);
            const active = !isNew && record.templateKey === editingKey;
            const dragging = dragView?.key === record.templateKey;
            const dropTarget = Boolean(dragView?.overKey) && dragView.overKey === record.templateKey && !dragging;
            return <div className={`keyword-template-row ${active ? 'active' : ''}${dragging ? ' is-dragging' : ''}${dropTarget ? ' is-drop-target' : ''}`} key={record.templateKey}
              data-keyword-template-row={record.templateKey}
              data-keyword-template-row-index={rowIndex}
              data-keyword-template-dragging={dragging ? 'true' : 'false'}
              data-keyword-template-drop-target={dropTarget ? 'true' : 'false'}>
              <button
                type="button"
                className="keyword-template-drag-handle"
                title="按住拖动排序（同模式内换位）"
                aria-label={`拖动「${record.name}」排序`}
                data-keyword-template-drag={record.templateKey}
                onPointerDown={(event) => startDrag(event, record.templateKey)}
                onClick={(event) => event.preventDefault()}><GripVertical size={14}/></button>
              <button
                type="button"
                className="keyword-template-pick"
                data-keyword-template-pick={record.templateKey}
                data-keyword-template-row-enabled={record.enabled !== false ? 'true' : 'false'}
                data-keyword-template-row-version={rowMeta.versionText}
                data-keyword-template-row-default={record.isDefault ? 'true' : 'false'}
                data-keyword-template-row-sort={record.sortOrder}
                onClick={() => { setIsNew(false); setEditingKey(record.templateKey); setConfirmDelete(false); }}>
                <div>
                  <b>{record.name || '未命名模板'}</b>
                  <small>{rowMeta.countsText} · {rowMeta.versionText}{record.isDefault ? ' · 默认' : ''}{record.enabled === false ? ' · 已停用' : ''}</small>
                </div>
              </button>
              <span className="keyword-template-order">
                <button type="button" className="icon-btn" title="上移" data-keyword-template-move={`${record.templateKey}:-1`} onClick={() => move(record.templateKey, -1)}><ArrowUp size={14}/></button>
                <button type="button" className="icon-btn" title="下移" data-keyword-template-move={`${record.templateKey}:1`} onClick={() => move(record.templateKey, 1)}><ArrowDown size={14}/></button>
              </span>
            </div>;
          })}
          {group.records.length ? null : <p className="persona-empty">这一模式还没有模板。</p>}
        </div>)}
        <p className="persona-empty">{KEYWORD_TEMPLATE_ORDER_NOTE} 停用的模板不出现在老师端候选里；一套都命不中时老师端回落内置兜底词表，并在面板上明示。</p>
      </div>

      <div className="panel persona-editor"
        data-keyword-template-current={draft ? draft.templateKey : ''}
        data-keyword-template-version={draft ? draft.templateVersion : ''}
        data-keyword-template-dirty={dirty ? 'true' : 'false'}
        data-keyword-template-unsaved={isNew ? 'true' : 'false'}
        data-keyword-template-groups={editGroups.length}
        data-keyword-template-terms={counts.terms}
        data-keyword-template-duplicates={duplicates.length}
        data-keyword-template-gate={gate.ok ? 'ok' : 'blocked'}>
        {draft ? <>
          <div className="panel-head">
            <div>
              <h2>{draft.name || '未命名模板'}</h2>
              <p>
                {isNew
                  ? '还没有保存：保存后才会进模板库，并产生 v1 与「新建」这一条版本记录。'
                  : <>当前 <b data-keyword-template-version-text>v{draft.templateVersion}</b> · {draft.enabled === false ? '已停用（老师端不命中）' : '启用中'}{savedMeta?.updatedText ? ` · 最后变更 ${savedMeta.updatedText}` : ''}</>}
              </p>
            </div>
            <div className="row-actions">
              <Button onClick={save} disabled={saving || !gate.ok} data-keyword-template-save>{saving ? '保存中…' : (isNew ? '保存新模板' : '保存（版本自增）')}</Button>
              {isNew ? null : <>
                <button type="button" className="text-link" disabled={saving} data-keyword-template-copy onClick={() => (copyOpen ? setCopyOpen(false) : openCopy())}><Copy size={14}/>复制为派生模板</button>
                <button type="button" className="text-link" disabled={saving} data-keyword-template-toggle onClick={toggleEnabled}>{draft.enabled === false ? '启用' : '停用'}</button>
                <button type="button" className="icon-btn danger-text" title="删除模板" data-keyword-template-delete onClick={() => setConfirmDelete(true)}><Trash2 size={16}/></button>
              </>}
            </div>
          </div>

          {copyOpen ? <div className="keyword-template-copy" data-keyword-template-copy-form>
            <div className="panel-head">
              <div>
                <h3>复制为派生模板</h3>
                <p>{KEYWORD_TEMPLATE_COPY_NOTE}</p>
              </div>
            </div>
            <div className="form-grid compact">
              <label>新模板名
                <input data-keyword-template-copy-name value={copyName} placeholder="例如：国画 · 观察词" onChange={(event) => setCopyName(event.target.value)}/>
              </label>
              <label>派生课程类型（留空 = 照抄这一套的适用范围）
                <input data-keyword-template-copy-course list="keyword-template-course-options" value={copyCourse} placeholder="例如：国画" onChange={(event) => setCopyCourse(event.target.value)}/>
              </label>
            </div>
            <div className="row-actions">
              <Button variant="secondary" onClick={() => setCopyOpen(false)}>取消</Button>
              <Button onClick={copy} disabled={saving || !gate.ok} data-keyword-template-copy-submit>复制为派生模板</Button>
            </div>
            {gate.ok ? null : <small className="keyword-template-copy-block" data-keyword-template-copy-blocked="true">当前草稿还过不了保存闸门：{gate.issue}</small>}
          </div> : null}

          <div className="keyword-template-facts">
            <span>{KEYWORD_TEMPLATE_SAVE_NOTE}</span>
            <span>{KEYWORD_TEMPLATE_EMPTY_NOTE}</span>
          </div>

          <div className="form-grid compact">
            <label>模板名<input data-keyword-template-name value={draft.name || ''} placeholder="例如：国画 · 作品观察词" onChange={(event) => patch('name', event.target.value)}/></label>
            <label>适用模式
              <select data-keyword-template-mode value={draft.mode} onChange={(event) => patch('mode', event.target.value)}>
                {KEYWORD_TEMPLATE_MODE_LIST.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
              </select>
            </label>
            <label>适用年龄段（留空 = 不限）
              <input data-keyword-template-age list="keyword-template-age-options" value={draft.ageRange || ''} placeholder="例如：6-9岁" onChange={(event) => patch('ageRange', event.target.value)}/>
            </label>
            <label>排序（越小越靠前）
              <input data-keyword-template-sort type="number" value={draft.sortOrder} onChange={(event) => patch('sortOrder', Number(event.target.value))}/>
            </label>
          </div>
          <datalist id="keyword-template-age-options">
            {COURSE_AGE_RANGE_OPTIONS.map((option) => <option key={option} value={option}/>)}
          </datalist>

          <div className="keyword-template-flags">
            <label className="framing-enable">
              <input type="checkbox" data-keyword-template-default checked={draft.isDefault === true} onChange={(event) => patch('isDefault', event.target.checked)}/> 设为该模式的默认模板
            </label>
            <label className="framing-enable">
              <input type="checkbox" data-keyword-template-enabled checked={draft.enabled !== false} onChange={(event) => patch('enabled', event.target.checked)}/> 启用（老师端可以命中）
            </label>
          </div>

          <div className="keyword-template-courses">
            <div className="panel-head">
              <div>
                <h3>适用课程类型</h3>
                <p>留空 = 不限（任何课程都能用）；配了之后只有命中的课程才会用这一套。</p>
              </div>
            </div>
            <div className="keyword-template-course-rows" data-keyword-template-course-count={(draft.courseTypes || []).length}>
              {(draft.courseTypes || []).map((name) => <span className="keyword-template-course" key={name} data-keyword-template-course={name}>
                {name}
                <button type="button" className="icon-btn danger-text" title={`移除 ${name}`} data-keyword-template-course-remove={name} onClick={() => setDraft(keywordTemplateCourseRemove(draft, name))}><Trash2 size={13}/></button>
              </span>)}
              {(draft.courseTypes || []).length ? null : <small>当前不限课程类型。</small>}
            </div>
            <div className="keyword-template-course-add">
              <input data-keyword-template-course-input list="keyword-template-course-options" value={courseInput} placeholder="填或选一个课程类型，例如：国画" onChange={(event) => setCourseInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCourse(); } }}/>
              <Button variant="secondary" icon={Plus} onClick={addCourse} data-keyword-template-course-submit>添加课程类型</Button>
            </div>
            <datalist id="keyword-template-course-options">
              {courseOptions.map((name) => <option key={name} value={name}/>)}
            </datalist>
          </div>

          <div className="keyword-template-editor">
            <div className="panel-head">
              <div>
                <h3>分组与词条</h3>
                <p>启用的 {counts.groups} 组 / {counts.terms} 词（含停用项共 {editGroups.length} 组）。分组与词条的顺序就是老师端面板上的顺序。</p>
              </div>
              <div className="row-actions">
                <button type="button" className="text-link" data-keyword-group-add onClick={() => setDraft(keywordGroupAdd(draft))}><Plus size={14}/>新增分组</button>
              </div>
            </div>

            {editGroups.map((group, groupIndex) => <div className={`keyword-group ${group.enabled ? '' : 'is-off'}`} key={`g${groupIndex}`}
              data-keyword-group={groupIndex}
              data-keyword-group-enabled={group.enabled ? 'true' : 'false'}
              data-keyword-group-terms={group.terms.length}>
              <div className="keyword-group-head">
                <input
                  data-keyword-group-name={groupIndex}
                  className="keyword-group-name"
                  value={group.name}
                  placeholder="分组名（例如：色彩感受）"
                  onChange={(event) => setDraft(keywordGroupRename(draft, groupIndex, event.target.value))}/>
                <label className="framing-enable">
                  <input type="checkbox" data-keyword-group-toggle={groupIndex} checked={group.enabled} onChange={(event) => setDraft(keywordGroupSetEnabled(draft, groupIndex, event.target.checked))}/> 启用
                </label>
                <span className="keyword-template-order">
                  <button type="button" className="icon-btn" title="分组上移" data-keyword-group-move={`${groupIndex}:-1`} onClick={() => setDraft(keywordGroupMove(draft, groupIndex, -1))}><ArrowUp size={14}/></button>
                  <button type="button" className="icon-btn" title="分组下移" data-keyword-group-move={`${groupIndex}:1`} onClick={() => setDraft(keywordGroupMove(draft, groupIndex, 1))}><ArrowDown size={14}/></button>
                  <button type="button" className="icon-btn danger-text" title="删除分组" data-keyword-group-remove={groupIndex} onClick={() => setDraft(keywordGroupRemove(draft, groupIndex))}><Trash2 size={14}/></button>
                </span>
              </div>
              <div className="keyword-terms">
                {group.terms.map((term, termIndex) => {
                  const duplicate = duplicateIndex.get(`${groupIndex}:${termIndex}`);
                  return <div className={`keyword-term ${term.enabled ? '' : 'is-off'} ${duplicate ? 'is-duplicate' : ''}`} key={`t${groupIndex}-${termIndex}`}
                    data-keyword-term={`${groupIndex}:${termIndex}`}
                    data-keyword-term-enabled={term.enabled ? 'true' : 'false'}
                    data-keyword-term-duplicate={duplicate ? 'true' : 'false'}
                    data-keyword-term-empty={term.term ? 'false' : 'true'}>
                    <input
                      data-keyword-term-input={`${groupIndex}:${termIndex}`}
                      value={term.term}
                      placeholder="词条（例如：暖色调）"
                      onChange={(event) => setDraft(keywordTermSet(draft, groupIndex, termIndex, event.target.value))}/>
                    <label className="framing-enable">
                      <input type="checkbox" data-keyword-term-toggle={`${groupIndex}:${termIndex}`} checked={term.enabled} onChange={(event) => setDraft(keywordTermSetEnabled(draft, groupIndex, termIndex, event.target.checked))}/> 启用
                    </label>
                    <span className="keyword-template-order">
                      <button type="button" className="icon-btn" title="词条上移" data-keyword-term-move={`${groupIndex}:${termIndex}:-1`} onClick={() => setDraft(keywordTermMove(draft, groupIndex, termIndex, -1))}><ArrowUp size={13}/></button>
                      <button type="button" className="icon-btn" title="词条下移" data-keyword-term-move={`${groupIndex}:${termIndex}:1`} onClick={() => setDraft(keywordTermMove(draft, groupIndex, termIndex, 1))}><ArrowDown size={13}/></button>
                      <button type="button" className="icon-btn danger-text" title="删除词条" data-keyword-term-remove={`${groupIndex}:${termIndex}`} onClick={() => setDraft(keywordTermRemove(draft, groupIndex, termIndex))}><Trash2 size={13}/></button>
                    </span>
                    {duplicate ? <small className="keyword-term-duplicate-note" data-keyword-term-duplicate-note={`${groupIndex}:${termIndex}`}>{duplicate.isFirst ? '与后面某个词归一化后重复' : `与第 ${duplicate.firstGroupIndex + 1} 组「${duplicate.firstGroupName}」的「${duplicate.firstTerm}」重复`}</small> : null}
                  </div>;
                })}
                {group.terms.length ? null : <p className="persona-empty">这一组还没有词条。</p>}
                <div className="keyword-term-add">
                  <button type="button" className="text-link" data-keyword-term-add={groupIndex} onClick={() => setDraft(keywordTermAdd(draft, groupIndex))}><Plus size={13}/>新增词条</button>
                  <small>每组上限 {KEYWORD_TEMPLATE_TERMS_PER_GROUP_LIMIT} 个</small>
                </div>
              </div>
            </div>)}
            {editGroups.length ? null : <p className="persona-empty">还没有分组。点「新增分组」建第一组。</p>}
          </div>

          {/* AI 补充观察词（US-111）：独立通道生成候选 → 逐条/按分组勾选 → 采纳进**草稿区**。
              `key` 绑定 templateKey：换一套模板就重挂载，候选与勾选不会串到另一套上。 */}
          <KeywordAiPanel
            key={`ai-${draft.templateKey}`}
            templateKey={draft.templateKey}
            draft={draft}
            setDraft={setDraft}
            groups={editGroups}
            courseOptions={courseOptions}
            operator={operator}
            reviewModels={reviewModels}
            auditLog={auditLog}
            recordAudit={recordAudit}
            setToast={setToast}
            orgId={orgId}/>

          {/* 保存被拦下时把原因**一直摆在界面上**（不只在点了之后才出 toast）：按钮 disabled 的同时说明为什么。 */}
          {gate.ok ? null : <div className="form-error" data-keyword-template-blocked="true" data-keyword-template-block-reason={gate.issue}><CircleAlert size={16}/>保存被拦下：{gate.issue}</div>}
          {notice ? <div className="form-error" data-keyword-template-notice><CircleAlert size={16}/>{notice}</div> : null}
          {duplicates.length ? <div className="keyword-template-duplicate" data-keyword-template-duplicate-list={duplicates.length}>
            <div className="keyword-template-duplicate-head"><CircleAlert size={15}/><b>归一化后重复的词（保存会被拦下）</b></div>
            <ul>
              {duplicates.map((row) => <li key={`${row.groupIndex}:${row.termIndex}`} data-keyword-duplicate-row={`${row.groupIndex}:${row.termIndex}`}>{row.text}</li>)}
            </ul>
            <p>归一化会去掉空格与标点（复用老师端同一套规则），重复的词在面板上老师分不出来，请先合并或改名。</p>
          </div> : null}
          {gate.warnings.length ? <ul className="keyword-template-warnings" data-keyword-template-warning-count={gate.warnings.length}>
            {gate.warnings.map((text) => <li key={text} data-keyword-template-warning>{text}</li>)}
          </ul> : null}

          {isNew ? null : <div className="keyword-template-history" data-keyword-template-version-rows={versionRows.length} data-keyword-template-history={(draft.history || []).length}>
            <div className="panel-head">
              <div>
                <h3>变更历史（{versionRows.length} 版）</h3>
                <p>每保存一次都留一版（快照 + 操作人 + 时间）：停用或改词条同样记一版，老师端的轨迹里能对上用的是哪一版。{KEYWORD_TEMPLATE_ROLLBACK_NOTE}</p>
              </div>
            </div>
            <ol>
              {versionRows.map((row) => <li key={row.versionLabel}
                data-keyword-template-version-row={row.versionLabel}
                data-keyword-template-version-current={row.isCurrent ? 'true' : 'false'}
                data-keyword-template-version-action={row.action}>
                <div className="keyword-template-version-head">
                  <b>{row.versionLabel}</b>
                  <span>{row.actionLabel}</span>
                  {row.isCurrent ? <em>当前</em> : <em className="muted">{row.enabledText}</em>}
                </div>
                <small>{row.changeText || '无变更记录'}</small>
                <div className="keyword-template-version-meta">{row.countsText}</div>
                <div className="keyword-template-version-actions">
                  <button type="button" className="text-link" disabled={row.isCurrent || saving}
                    data-keyword-template-rollback={row.versionLabel}
                    onClick={() => setConfirmRollback(row.versionLabel === confirmRollback ? '' : row.versionLabel)}>
                    <RotateCcw size={13}/>{row.isCurrent ? '当前版本' : `回滚到 ${row.versionLabel}`}
                  </button>
                </div>
              </li>)}
            </ol>
          </div>}

          {confirmRollback ? <div className="danger-note" style={{ marginTop: 14 }} data-keyword-template-confirm-rollback={confirmRollback}>
            <CircleAlert size={18}/>
            <span style={{ flex: 1 }}>
              回滚到 <b>{confirmRollback}</b>：把那一版的分组与配置写成「新的」版本（版本号继续 +1），历史版本一条不删。
              当前草稿里没保存的修改会被丢弃。
            </span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button variant="secondary" onClick={() => setConfirmRollback('')}>取消</Button>
              <Button onClick={() => rollback(confirmRollback)} disabled={saving} data-keyword-template-rollback-confirm>确认回滚</Button>
            </span>
          </div> : null}

          {confirmDelete ? <div className="danger-note" style={{ marginTop: 14 }}>
            <CircleAlert size={18}/>
            <span style={{ flex: 1 }}>
              删除「{draft.name}」后老师端不再有这一套（{meta?.countsText}）。{KEYWORD_TEMPLATE_DELETE_NOTE}
              如果只是暂时不想用它，建议改为「停用」。
            </span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>取消</Button>
              <Button variant="danger" onClick={remove} data-keyword-template-delete-confirm>确认删除</Button>
            </span>
          </div> : null}
        </> : <p className="persona-empty"><ListChecks size={16}/> 选择左侧的一套模板，或点右上角新增一套。</p>}
      </div>
    </div>
  </>;
}
