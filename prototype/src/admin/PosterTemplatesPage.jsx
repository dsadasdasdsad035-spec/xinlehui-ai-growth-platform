// 管理端「海报模板」：[海报 US-312a / US-312b] / F-POSTER-ADMIN-01 / FR-350、FR-353 ~ FR-359。
//
// 三栏：**模板列表（系统 / 机构 / 老师个人）· 参数面板 · 实时预览**。
// 这一页要解决的事：没有设计交付也能做出一套海报版式 —— 参数改一下，右边立刻看到那张图长什么样；
// 以及 US-312b 的四件事：**启停 / 排序 / 设为默认**、**按类型与入口配适用范围**、
// **保存前三项校验**（占位区越界 / 文字可能溢出 / 二维码可扫性）、**被使用过的模板只允许停用**，
// 并把每一次改动记进 `updated_by / updated_at` 与变更历史（FR-359）。
//
// 三件事都在别处，这一层不重复实现：
//   · 规则（三层写权限 / 控件描述表 / 新增与复制 / 保存前读数与三项校验 / 引用范围与删除判据 /
//     库级动作与留痕）在 `data/posterAdmin.js` 与 `data/posterTemplates.js`；
//   · 出图在 `services/posterAdminPreview.js` —— 它把 plan 交给 `services/posterDialog.js` 的
//     `renderPosterDialog()`，**与老师端弹窗、缩略图、导出是同一支渲染分派**（FR-312 的口径）；
//   · 云端读写（含「先落本机镜像再推云端」与内置模板幂等初始化）在 `services/posterTemplatesApi.js`。
//
// 五条纪律：
//   ① **写入口一关到底**：列表里不属于平台层的模板（机构 / 老师个人）整页只读 —— 面板控件全部 disabled、
//      保存与复制按钮不可点，行上也不出现排序 / 默认 / 删除入口，并在顶部说明「由谁维护、去哪儿改」
//      （`posterAdminTemplateWriteIssue`）。服务层的 403 是第二道，这里不是唯一一道。
//   ② **草稿不做收敛**：输入框里写什么就是什么（`posterAdminInputValue` 连 `0.` 都原样留着），
//      收敛只发生在渲染与保存时 —— 「输入一半被夹住」是这个仓里踩过的坑。
//   ③ **预览是节流的**：数字框改一下不必连发三次渲染（`POSTER_ADMIN_PREVIEW_THROTTLE_MS`）。
//   ④ **新增 / 复制先停用**：参数没确认就漏到老师端是最容易犯的错，「启用」是一个显式动作。
//   ⑤ **库级动作（启停 / 排序 / 默认 / 删除）立即落盘**（本机镜像 + 云端），参数编辑仍等「保存」：
//      前四件是**库级设置**（老师端立刻该看到），后一件是这一套模板的草稿。库级动作只会把
//      「刚被动作改过的那几个字段」贴回草稿（`syncDraftFromRows`），用户没保存的参数改动不会被顶掉。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button, PageHeader } from '../ui';
import { DEFAULT_ORG_ID } from '../data/lessons';
import { AUDIT_ACTIONS, auditTimeText, buildAuditEntry } from '../data/auditLog';
import {
  POSTER_ENTRY_SCOPES,
  POSTER_ENTRY_SCOPE_LABELS,
  POSTER_KIND_LABELS,
  POSTER_KINDS,
  POSTER_SLOT_TYPE_LABELS,
  POSTER_SLOT_TYPES,
  loadPosterTemplates,
  mergePosterTemplates,
  normalizePosterSpec,
  normalizePosterTemplate,
  persistPosterTemplates
} from '../data/posterTemplates';
import {
  POSTER_ADMIN_BACKGROUND_TYPE_LABELS,
  POSTER_ADMIN_CHECK_BLOCKED_TITLE,
  POSTER_ADMIN_CHECK_ESTIMATE_NOTE,
  POSTER_ADMIN_CHECK_POLICY_NOTE,
  POSTER_ADMIN_CONVERGE_NOTE,
  POSTER_ADMIN_DEFAULT_NOTE,
  POSTER_ADMIN_DELETE_CONFIRM_TEXT,
  POSTER_ADMIN_DELETE_ERROR_TEXT,
  POSTER_ADMIN_DELETE_NOTE,
  POSTER_ADMIN_DESCRIPTION_MAX,
  POSTER_ADMIN_DISABLE_INSTEAD_LABEL,
  POSTER_ADMIN_DRAFT_NOTE,
  POSTER_ADMIN_ENABLED_NOTE,
  POSTER_ADMIN_HISTORY_EMPTY,
  POSTER_ADMIN_HISTORY_NOTE,
  POSTER_ADMIN_HISTORY_TITLE,
  POSTER_ADMIN_NAME_MAX,
  POSTER_ADMIN_NAME_PLACEHOLDER,
  POSTER_ADMIN_PAGE_ID,
  POSTER_ADMIN_PREVIEW_FAILED_TEXT,
  POSTER_ADMIN_PREVIEW_NOTE,
  POSTER_ADMIN_PREVIEW_PENDING_TEXT,
  POSTER_ADMIN_PREVIEW_SAMPLE_NOTE,
  POSTER_ADMIN_PREVIEW_THROTTLE_MS,
  POSTER_ADMIN_READONLY_BADGE,
  POSTER_ADMIN_READONLY_NOTE,
  POSTER_ADMIN_RELOAD_SAVED_LABEL,
  POSTER_ADMIN_RESET_CANVAS_LABEL,
  POSTER_ADMIN_SCOPE_NOTE,
  POSTER_ADMIN_SECTION_FIELDS,
  POSTER_ADMIN_SORT_NOTE,
  POSTER_ADMIN_TEMPLATE_DESCRIPTION_NOTE,
  POSTER_ADMIN_TITLE,
  POSTER_ADMIN_DESC,
  POSTER_ADMIN_USAGE_EMPTY_TEXT,
  posterAdminApplyDefault,
  posterAdminCanvasPresetPatch,
  posterAdminCopyTemplate,
  posterAdminCoverageLine,
  posterAdminDefaultId,
  posterAdminDefaultTemplateId,
  posterAdminDeleteVerdict,
  posterAdminDraftState,
  posterAdminHistoryRows,
  posterAdminInputValue,
  posterAdminKindCanvas,
  posterAdminKindPatch,
  posterAdminLibraryGroups,
  posterAdminMoveTemplate,
  posterAdminNewTemplate,
  posterAdminPreSaveChecks,
  posterAdminPreviewKey,
  posterAdminReadPath,
  posterAdminRowView,
  posterAdminSaveFacts,
  posterAdminScopeView,
  posterAdminSetEnabled,
  posterAdminSetPath,
  posterAdminSlotFieldRows,
  posterAdminSlotTypePatch,
  posterAdminSortPosition,
  posterAdminStampSave,
  posterAdminTemplateUsage,
  posterAdminTemplateWriteIssue,
  posterAdminTemplateWriteOwnerText,
  posterAdminUpdatedFacts,
  posterAdminUsageText
} from '../data/posterAdmin';
import {
  deletePosterTemplate,
  loadPosterTemplateStore,
  savePosterTemplate,
  savePosterTemplates
} from '../services/posterTemplatesApi';
import {
  createPosterAdminPreviewUrl,
  posterAdminPreviewSampleLine,
  releasePosterAdminPreviewUrl,
  renderPosterAdminPreview
} from '../services/posterAdminPreview';

const EMPTY_PREVIEW = { phase: 'idle', url: '', width: 0, height: 0, warnings: [], key: '' };

/** 库级动作之后要贴回草稿的字段（只贴「刚被动作改过」的那几个，用户的参数草稿一个都不动）。 */
const LIBRARY_ACTION_FIELDS = ['sortOrder', 'isDefault', 'enabled', 'updatedBy', 'updatedAt', 'history'];

/** 两次列表之间「这一行变了吗」（库级动作只写变了的行；`history` 用逐条比对，别比引用）。 */
const rowChanged = (before, after) => !before || LIBRARY_ACTION_FIELDS.some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));

/** 渲染一个控件（五种控制种类只有这一处实现；面板里每一行都走它）。 */
function AdminControl({ field, value, disabled, fieldKey, onCommit }) {
  const commit = (next) => onCommit(field.path, next);
  if (field.control === 'check') {
    return <label className="poster-admin-check" data-poster-admin-field={fieldKey}>
      <input type="checkbox" checked={value !== false} disabled={disabled} onChange={(event) => commit(event.target.checked)} />
      <span>{field.label}</span>
    </label>;
  }
  if (field.control === 'select') {
    return <label className="poster-admin-field" data-poster-admin-field={fieldKey}>
      <b>{field.label}</b>
      <select value={value} disabled={disabled} onChange={(event) => commit(event.target.value)}>
        {field.options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      {field.hint ? <small>{field.hint}</small> : null}
    </label>;
  }
  if (field.control === 'color') {
    return <label className="poster-admin-field" data-poster-admin-field={fieldKey}>
      <b>{field.label}</b>
      <span className="poster-admin-color">
        <input type="color" data-poster-admin-color={fieldKey} value={/^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value) : '#fbf8f2'} disabled={disabled} onChange={(event) => commit(event.target.value.toUpperCase())} />
        <input type="text" value={value === undefined || value === null ? '' : String(value)} disabled={disabled} onChange={(event) => commit(event.target.value)} />
      </span>
      {field.hint ? <small>{field.hint}</small> : null}
    </label>;
  }
  if (field.control === 'number') {
    return <label className="poster-admin-field" data-poster-admin-field={fieldKey}>
      <b>{field.label}</b>
      <input type="number" value={value === undefined || value === null ? '' : value} disabled={disabled}
        min={field.min} max={field.max} step={field.step === undefined ? 0.001 : field.step}
        onChange={(event) => commit(posterAdminInputValue(event.target.value))} />
      {field.hint ? <small>{field.hint}</small> : null}
    </label>;
  }
  return <label className="poster-admin-field" data-poster-admin-field={fieldKey}>
    <b>{field.label}</b>
    <input type="text" value={value === undefined || value === null ? '' : String(value)} disabled={disabled}
      onChange={(event) => commit(event.target.value)} />
    {field.hint ? <small>{field.hint}</small> : null}
  </label>;
}

export default function PosterTemplatesPage({
  adminName = '平台管理员',
  setToast = () => {},
  recordAudit = null,
  // 审计日志（老师端的导出 / 转发留痕）：**引用范围**（FR-358「已被使用过的模板只允许停用」）读它。
  auditLog = []
} = {}) {
  const actor = adminName || '平台管理员';
  // 本会话是**平台管理员**（原型里管理员会话就是平台管理员，与装裱 US-013 同一口径）：
  // 三层模板都看得见，但只有 platform 层写得动。
  const viewer = useMemo(() => ({
    role: 'admin',
    adminTier: 'platform',
    orgId: DEFAULT_ORG_ID,
    actorName: actor,
    actorId: actor
  }), [actor]);
  const [library, setLibrary] = useState(() => loadPosterTemplates());
  const [persisted, setPersisted] = useState(() => loadPosterTemplates());
  const [store, setStore] = useState(null);
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  // 删除是**两步**：先点「删除」看影响范围与判据（`{ id, verdict }`），再点「确认删除」才真的删。
  const [pendingDelete, setPendingDelete] = useState(null);
  const [preview, setPreview] = useState(EMPTY_PREVIEW);
  const bootRef = useRef(false);
  // 「本机镜像已经动过」：云端读回晚于用户操作时必须**以本机为准**（见下面那段注释）。
  const touchedRef = useRef(false);

  // 打开页面时同步一次云端（幂等初始化内置模板 + 云端不可达时回退内置库并给出一句可读文案）。
  //
  // 两条纪律（这是本仓踩过的「夹具 ↔ 云端合并竞态」的同一类坑）：
  //   ① `persist: false` —— 由这一页**独占**写镜像，服务层读回的那一份不许覆盖它；
  //   ② 用户在读回之前就动过手（touchedRef）时**回灌直接放弃** —— 否则「刚新增的那一套」
  //      会被一份更早读到的旧列表顶掉（界面看着好好的，镜像是空的）。
  // 合并方向仍是**本机优先**（`mergePosterTemplates` 主列表在前），云端只补本机没有的 key。
  useEffect(() => {
    if (bootRef.current) return undefined;
    bootRef.current = true;
    let active = true;
    loadPosterTemplateStore({ persist: false })
      .then((loaded) => {
        if (!active || touchedRef.current) return;
        const merged = mergePosterTemplates(loadPosterTemplates(), loaded.templates);
        persistPosterTemplates(merged);
        setLibrary(merged);
        setPersisted(merged);
        setStore(loaded);
      })
      .catch(() => { if (active) setStore(null); });
    return () => { active = false; };
  }, []);

  // 「已保存的那一份」跟着列表走：这个状态只用来算列表上的「未保存」徽标。
  useEffect(() => { setPersisted(loadPosterTemplates()); }, [library]);

  const groups = useMemo(() => posterAdminLibraryGroups(library, viewer), [library, viewer]);
  const draftState = useMemo(() => posterAdminDraftState({ templates: library, persisted, editingId, dirty }), [library, persisted, editingId, dirty]);
  const editing = library.find((item) => item.id === editingId) || null;
  // 进页面就选中第一套平台模板（不然参数面板与预览都是空的，管理员还得先点一下才知道这里能干什么）。
  useEffect(() => {
    if (editingId || !library.length) return;
    setEditingId(posterAdminDefaultTemplateId(library));
  }, [editingId, library]);
  // 切换选中 = 换草稿（未保存的改动一起丢弃：草稿属于上一套模板，留着只会写错对象）。
  useEffect(() => {
    if (!editing) return;
    setDraft({ ...editing, spec: editing.spec });
    setDirty(false);
  }, [editingId, library.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const spec = draft && draft.spec && typeof draft.spec === 'object' ? draft.spec : {};
  // 收敛后的 spec 只用来看枚举（下拉选项不能是半个值）与预览键；数字 / 颜色 / 文案一律读草稿原值。
  const normalized = useMemo(() => normalizePosterSpec(spec), [spec]);
  // 模板记录层的读数（类型 / 适用入口 / 层级 / 排序 / 最后变更）也走收敛器：面板上的下拉不能显示半个值。
  const draftRecord = useMemo(() => (draft ? normalizePosterTemplate(draft) : null), [draft]);
  // 预览按**模板记录的类型**分派（老师端弹窗也是按它分派装配的）：两者不一致的老数据也不会看着跑偏。
  const draftKind = draft ? draft.kind : '';
  const previewKey = useMemo(() => posterAdminPreviewKey(spec, draftKind), [spec, draftKind]);
  const facts = useMemo(() => (draft ? posterAdminSaveFacts(draft, { templates: library }) : null), [draft, library]);
  const coverage = useMemo(() => posterAdminCoverageLine(spec), [spec]);
  const draftIssue = draft ? posterAdminTemplateWriteIssue(draft, viewer) : '';
  const writable = draft ? draftIssue === '' : false;
  const sampleLine = useMemo(() => posterAdminPreviewSampleLine(spec), [spec]);
  // 保存前的三项校验（AC3 / FR-355）：占位区越界 · 文字可能溢出（按最长内容估算）· 二维码可扫性。
  const checks = useMemo(() => (draft ? posterAdminPreSaveChecks(draft) : null), [draft]);
  // 适用范围读数（AC2）：类型 + 入口。
  const scopeView = useMemo(() => (draft ? posterAdminScopeView(draft) : null), [draft]);
  // 引用范围（AC4 / FR-358）：这套模板有没有被用过（审计日志里的导出 / 转发留痕 + 默认标记）。
  const usage = useMemo(() => (draft ? posterAdminTemplateUsage(draft, { audit: auditLog }) : null), [draft, auditLog]);
  const deleteVerdict = useMemo(() => (draft ? posterAdminDeleteVerdict(draft, usage) : null), [draft, usage]);
  const sortPosition = useMemo(() => (draft ? posterAdminSortPosition(library, draft.id) : null), [draft, library]);
  const historyRows = useMemo(() => (draft ? posterAdminHistoryRows(draft).slice(0, 6) : []), [draft]);
  const updatedFacts = useMemo(() => (draft ? posterAdminUpdatedFacts(draft, { timeText: auditTimeText }) : null), [draft]);
  const defaultId = useMemo(() => posterAdminDefaultId(library), [library]);
  // 行级读数（列表里每一行都要一份：这一行的写权限 / 位次 / 引用范围），一次算好别在 JSX 里现算。
  const rowViews = useMemo(() => {
    const map = new Map();
    library.forEach((item) => {
      map.set(item.id, {
        view: posterAdminRowView(item, viewer),
        position: posterAdminSortPosition(library, item.id),
        usage: posterAdminTemplateUsage(item, { audit: auditLog })
      });
    });
    return map;
  }, [library, viewer, auditLog]);

  // 实时预览：spec 变了就重画（节流），出图走与老师端同一支 `renderPosterDialog()`。
  useEffect(() => {
    if (!draft) { setPreview(EMPTY_PREVIEW); return () => {}; }
    let cancelled = false;
    let createdUrl = '';
    setPreview((current) => ({ ...current, url: '', phase: 'pending' }));
    const timer = setTimeout(() => {
      renderPosterAdminPreview({ spec, kind: draft.kind }).then((rendered) => {
        if (cancelled) return;
        if (!rendered || !rendered.blob) {
          setPreview({ ...EMPTY_PREVIEW, phase: 'failed', key: previewKey });
          return;
        }
        createdUrl = createPosterAdminPreviewUrl(rendered);
        setPreview({
          phase: 'ready',
          url: createdUrl,
          width: rendered.width,
          height: rendered.height,
          warnings: rendered.warnings || [],
          key: previewKey
        });
      }).catch(() => {
        if (!cancelled) setPreview({ ...EMPTY_PREVIEW, phase: 'failed', key: previewKey });
      });
    }, POSTER_ADMIN_PREVIEW_THROTTLE_MS);
    return () => { cancelled = true; clearTimeout(timer); if (createdUrl) releasePosterAdminPreviewUrl(createdUrl); };
  }, [previewKey, editingId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 越权写入的留痕（界面已经把入口关掉了，这一道是给「绕过界面」的调用点的）。 */
  const auditDenied = (template, action) => {
    const issue = posterAdminTemplateWriteIssue(template, viewer);
    if (!issue) return '';
    if (typeof recordAudit === 'function') {
      recordAudit(buildAuditEntry({
        action: AUDIT_ACTIONS.templateWriteDenied,
        actorId: actor,
        actorName: actor,
        actorRole: 'platform-admin',
        actorRoleLabel: '平台管理员',
        orgId: DEFAULT_ORG_ID,
        templateId: template?.id || '',
        templateName: template?.name || '',
        scope: normalizePosterTemplate(template).scope,
        outcome: 'denied',
        detail: `${action}被拒绝：${issue}`
      }));
    }
    setToast(`越权写入已拒绝：${issue}`);
    return issue;
  };

  const pick = (id) => {
    setEditingId(id);
    setNotice('');
  };

  /** 改一个 spec 路径（界面只认路径字符串，不认字段名）。 */
  const patchSpec = (path, value) => {
    if (!writable) return;
    setDraft((current) => (current ? { ...current, spec: posterAdminSetPath(current.spec, path, value) } : current));
    setDirty(true);
  };
  const patchField = (key, value) => {
    if (!writable) return;
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
  };

  const addTemplate = () => {
    const created = posterAdminNewTemplate({ kind: 'single', templates: library, actor });
    if (auditDenied(created, '新增模板')) return;
    touchedRef.current = true;
    setLibrary((current) => mergePosterTemplates([created], current));
    setEditingId(created.id);
    setNotice(`已新增「${created.name}」（${POSTER_ADMIN_DRAFT_NOTE}）`);
    setToast(`已新增一套平台模板：${created.name}`);
  };

  const copyTemplate = () => {
    const source = draft || editing || library[0] || null;
    if (!source) return;
    // 复制是**在平台层新做一套**：源模板可以是任何一层（管理员读全量），
    // 但新模板落在本会话唯一能写的 platform 层，并且与其他新增一样先停用。
    const created = posterAdminCopyTemplate(source, { templates: library, actor });
    if (auditDenied(created, '复制模板')) return;
    touchedRef.current = true;
    setLibrary((current) => mergePosterTemplates([created], current));
    setEditingId(created.id);
    setNotice(`已把「${normalizePosterTemplate(source).name}」复制为平台模板「${created.name}」：参数逐字段照抄，${POSTER_ADMIN_DRAFT_NOTE}`);
    setToast(`已复制为副本：${created.name}`);
  };

  const reloadSaved = () => {
    if (!editing) return;
    setDraft({ ...editing, spec: editing.spec });
    setDirty(false);
    setNotice('已回到上一次保存的参数（这次没保存的改动已丢弃）。');
  };

  const resetCanvas = () => {
    if (!writable || !draft) return;
    const canvas = posterAdminKindCanvas(draft.kind);
    setDraft((current) => (current ? { ...current, spec: posterAdminCanvasPresetPatch(current.spec) } : current));
    setDirty(true);
    setNotice(`${POSTER_ADMIN_RESET_CANVAS_LABEL}：${canvas.width}×${canvas.height}（${POSTER_KIND_LABELS[draft.kind] || draft.kind}）。`);
  };

  const changeKind = (kind) => {
    if (!writable || !draft) return;
    setDraft((current) => (current ? posterAdminKindPatch(current, kind) : current));
    setDirty(true);
  };

  // -------------------------------------------------------------------------
  // 库级动作（AC1 / AC4）：启停 · 排序 · 设为默认 · 删除
  //
  // 三件事都在 data 层判定、这里只负责「落盘 + 贴回草稿 + 说一句回执」：
  //   · 落盘走 `savePosterTemplate()`（先本机镜像再推云端，与保存同一条路）；
  //   · 只写**真的变了的行**（`rowChanged`）—— 排序会顺带改动邻居的序号，默认会清掉上一个默认；
  //   · 贴回草稿只贴 `LIBRARY_ACTION_FIELDS` 那几个字段，用户没保存的参数改动不会被顶掉。
  // -------------------------------------------------------------------------

  /** 库级动作之后把「刚被改过的那几行」贴回草稿（只贴库级字段，草稿里的参数一个都不动）。 */
  const syncDraftFromRows = (rows) => {
    if (!rows.length) return;
    setDraft((current) => {
      if (!current) return current;
      const hit = rows.find((row) => row.id === current.id);
      if (!hit) return current;
      return LIBRARY_ACTION_FIELDS.reduce((acc, key) => ({ ...acc, [key]: hit[key] }), { ...current });
    });
  };

  /**
   * 落盘：写变化的那几行。**一次调用写全**（`savePosterTemplates` 先把本机镜像写全、再逐条推云端；
   * 逐条 save 在第一条云端失败时会中断循环，后面的行镜像都没写 —— US-312b 真踩到过）。
   */
  const persistLibraryChange = async (next, { noticeText = '', toastText = '', changed = null } = {}) => {
    const before = new Map(library.map((item) => [item.id, item]));
    const rows = Array.isArray(changed) ? changed : next.filter((item) => rowChanged(before.get(item.id), item));
    touchedRef.current = true;
    setLibrary(next);
    syncDraftFromRows(rows);
    if (!rows.length) {
      if (noticeText) setNotice(noticeText);
      return;
    }
    const result = await savePosterTemplates(rows);
    const mirror = loadPosterTemplates();
    setLibrary(mirror);
    setPersisted(mirror);
    if (result.failed.length) {
      setNotice(`已写进本机镜像：云端暂未连通（${result.failed.length} 条待同步），稍后重试即可。${noticeText}`);
      setToast('已写进本机镜像；云端暂未连通');
      return;
    }
    setNotice(noticeText);
    if (toastText) setToast(toastText);
  };

  /** 某一行的启用 / 停用（列表行与面板都要用：面板走草稿，行上直接落盘）。 */
  const setRowEnabled = async (id, enabled) => {
    const target = library.find((item) => item.id === id);
    if (!target || auditDenied(target, enabled === false ? '停用模板' : '启用模板')) return;
    const stamped = posterAdminSetEnabled(target, enabled, { by: actor, at: Date.now(), viewer });
    const next = library.map((item) => (item.id === id ? stamped : item));
    await persistLibraryChange(next, {
      changed: [stamped],
      noticeText: enabled === false
        ? `已停用「${stamped.name}」：老师端不再出现这一套（已经导出或转发过的海报图片不受影响）。`
        : `已启用「${stamped.name}」：老师端「一键转发」的版式列表里现在能选到它。`,
      toastText: enabled === false ? '已停用这套模板' : '已启用这套模板'
    });
  };

  /** 上下移动一行（同层内；`delta` -1 上移 / +1 下移）。 */
  const moveRow = async (id, delta) => {
    const target = library.find((item) => item.id === id);
    if (!target || auditDenied(target, '调整排序')) return;
    const position = posterAdminSortPosition(library, id);
    if ((delta < 0 && !position.canUp) || (delta > 0 && !position.canDown)) return;
    const next = posterAdminMoveTemplate(library, id, delta, { by: actor, at: Date.now(), viewer });
    const before = new Map(library.map((item) => [item.id, item]));
    const changed = next.filter((item) => rowChanged(before.get(item.id), item));
    if (!changed.length) return;
    const after = posterAdminSortPosition(next, id);
    await persistLibraryChange(next, {
      changed,
      noticeText: `已调整排序：「${target.name}」现在排在本层第 ${after.position} / ${after.count} 位（老师端版式列表按这个顺序显示）。`
    });
  };

  /** 设为默认 / 取消默认（同一时间只有一套默认模板）。 */
  const toggleDefault = async () => {
    if (!draft || auditDenied(draft, '设为默认模板')) return;
    const next = posterAdminApplyDefault(library, defaultId === draft.id ? '' : draft.id, { by: actor, at: Date.now(), viewer });
    const before = new Map(library.map((item) => [item.id, item]));
    const changed = next.filter((item) => rowChanged(before.get(item.id), item));
    if (!changed.length) return;
    const nowDefault = posterAdminDefaultId(next) === draft.id;
    await persistLibraryChange(next, {
      changed,
      noticeText: nowDefault
        ? `${POSTER_ADMIN_DEFAULT_NOTE}现在默认模板是「${draft.name}」。`
        : `已取消「${draft.name}」的默认标记：老师端弹窗回到「第一套可用的单作品」那一支。`,
      toastText: nowDefault ? '已设为默认模板' : '已取消默认标记'
    });
  };

  /** 第一次点「删除」：先算判据与影响范围（**不删**），让管理员看清再决定。 */
  const askDelete = () => {
    if (!draft || auditDenied(draft, '删除模板')) return;
    const info = posterAdminTemplateUsage(draft, { audit: auditLog });
    setPendingDelete({ id: draft.id, verdict: posterAdminDeleteVerdict(draft, info) });
    setNotice('');
  };

  /** 第二次点「确认删除」才真的删（服务层再拦一道「被使用过 / 内置」的判据）。 */
  const confirmDelete = async () => {
    const pending = pendingDelete;
    if (!pending) return;
    const row = library.find((item) => item.id === pending.id);
    if (!row) { setPendingDelete(null); return; }
    const info = posterAdminTemplateUsage(row, { audit: auditLog });
    const verdict = posterAdminDeleteVerdict(row, info);
    if (!verdict.allowed) {
      setPendingDelete({ id: row.id, verdict });
      setNotice(verdict.message);
      setToast(verdict.reason || '这套模板不能删除');
      return;
    }
    try {
      await deletePosterTemplate(row.id, { existing: library, usage: info });
      touchedRef.current = true;
      const next = loadPosterTemplates();
      setLibrary(next);
      setPersisted(next);
      setPendingDelete(null);
      if (editingId === row.id) setEditingId(posterAdminDefaultTemplateId(next));
      setNotice(`已删除「${row.name}」。${POSTER_ADMIN_DELETE_NOTE}${verdict.usageText}`);
      setToast(`海报模板「${row.name}」已删除`);
    } catch (error) {
      setPendingDelete(null);
      setNotice(`${POSTER_ADMIN_DELETE_ERROR_TEXT}${error && error.message ? error.message : '请稍后重试。'}`);
    }
  };

  /** 判据不允许删除时的那条出路：改为停用（被使用过的模板的正解）。 */
  const disableInstead = async () => {
    const pending = pendingDelete;
    setPendingDelete(null);
    if (!pending) return;
    await setRowEnabled(pending.id, false);
  };

  const toggleEnabled = () => {
    if (!writable || !draft) return;
    const next = draft.enabled === false;
    patchField('enabled', next);
    setNotice(next
      ? '已标记为启用：保存后老师端「一键转发」的版式列表里就能选到它。'
      : '已标记为停用：保存后老师端不再出现这一套，已经导出过的海报不受影响。');
  };

  const save = async () => {
    if (!draft) return;
    const issue = auditDenied(draft, '保存模板');
    if (issue) return;
    const current = posterAdminSaveFacts(draft, { templates: library });
    if (!current.ready) {
      setNotice(current.blockers.join('；'));
      setToast(current.blockers[0] || '保存前请先修正模板名');
      return;
    }
    // 三项校验（AC3）：越界与二维码不达标**拦保存**；文字溢出是估算警告，只提示不拦。
    const verdict = posterAdminPreSaveChecks(draft);
    if (verdict.blocked) {
      const text = `${POSTER_ADMIN_CHECK_BLOCKED_TITLE}${verdict.blockers.join(' ')}`;
      setNotice(text);
      setToast('保存前校验没通过：占位区越界或二维码过小');
      return;
    }
    setSaving(true);
    setNotice('');
    touchedRef.current = true;
    // 存下去的是一份**过留痕**的记录（FR-359）：updatedBy / updatedAt / 一条变更历史。
    const stamped = posterAdminStampSave(draft, { previous: editing, by: actor, at: Date.now() });
    try {
      await savePosterTemplate(stamped);
      setLibrary(loadPosterTemplates());
      setPersisted(loadPosterTemplates());
      setDraft({ ...stamped });
      setDirty(false);
      const changeText = posterAdminHistoryRows(stamped).slice(0, 1).map((row) => row.text).join('');
      setNotice(`已保存「${current.name}」：本机镜像已更新，云端已同步（${changeText}）。${current.specIssues.length ? `${POSTER_ADMIN_CONVERGE_NOTE}（本次收敛 ${current.specIssues.length} 处）` : ''}${verdict.warnings.length ? ` ${verdict.warnings.join(' ')}` : ''}`);
      setToast(`海报模板「${current.name}」已保存`);
    } catch {
      // 云端不通时本机镜像已经写过了（服务层先落镜像再推云端）：如实说清，界面照常更新。
      const mirror = loadPosterTemplates();
      setLibrary(mirror);
      setPersisted(mirror);
      setDraft({ ...stamped });
      setDirty(false);
      setNotice(`已保存到本机：云端暂未连通，稍后重试即可（本机镜像已经是最新的那一份）。`);
      setToast('已保存到本机；云端暂未连通');
    } finally {
      setSaving(false);
    }
  };

  const sectionFields = (name) => POSTER_ADMIN_SECTION_FIELDS[name] || [];

  return <>
    <PageHeader title={POSTER_ADMIN_TITLE} desc={POSTER_ADMIN_DESC} prd="PRD-9 / F-POSTER-ADMIN-01"
      actions={<>
        <Button icon={Copy} variant="secondary" onClick={copyTemplate} data-poster-admin-copy="true" disabled={!library.length}>复制为副本</Button>
        <Button icon={Plus} onClick={addTemplate} data-poster-admin-new="true">新增海报模板</Button>
      </>} />
    <div className="poster-admin" data-poster-admin-page={POSTER_ADMIN_PAGE_ID}
      data-poster-admin-library={String(library.length)}
      data-poster-admin-groups={String(groups.length)}>
      {/* ① 模板列表：三层分组（系统 / 机构 / 老师个人），不属于平台层的一律只读。 */}
      <div className="panel poster-admin-list">
        <div className="panel-head">
          <h2>模板列表</h2>
          <small data-poster-admin-list-summary={String(library.length)}>{library.length} 套 · 平台 {library.filter((item) => item.scope === 'platform').length} · 机构 {library.filter((item) => item.scope === 'org').length} · 老师 {library.filter((item) => item.scope === 'teacher').length}</small>
        </div>
        {store && !store.cloudConnected ? <p className="poster-admin-offline" data-poster-admin-offline="true">{store.notice}</p> : null}
        {groups.map((group) => <div className="poster-admin-group" key={group.scope} data-poster-admin-group={group.scope} data-poster-admin-group-count={String(group.rows.length)}>
          <div className="poster-admin-group-head">
            <b>{group.label}</b>
            <small>{group.note}</small>
          </div>
          {group.rows.map((template) => {
            const row = posterAdminRowView(template, viewer);
            // 行读数（位次 / 引用范围）在 `rowViews` 里一次算好：模板对象是渲染的真源，别在 JSX 里现算。
            const rowInfo = rowViews.get(row.id) || { view: row, position: posterAdminSortPosition(library, row.id), usage: posterAdminTemplateUsage(template, { audit: auditLog }) };
            return <div key={row.id} className={`poster-admin-row${row.id === editingId ? ' active' : ''}`}
              data-poster-admin-row={row.id}
              data-poster-admin-row-scope={row.scope}
              data-poster-admin-row-enabled={row.enabled ? 'true' : 'false'}
              data-poster-admin-row-builtin={row.builtin ? 'true' : 'false'}
              data-poster-admin-row-writable={row.writable ? 'true' : 'false'}
              data-poster-admin-row-used={rowInfo.usage.referenced ? 'true' : 'false'}
              data-poster-admin-row-default={row.isDefault ? 'true' : 'false'}
              data-poster-admin-row-kind={row.kind}>
              <button type="button" className="poster-admin-pick" data-poster-admin-pick={row.id} onClick={() => pick(row.id)}>
                <div className="poster-admin-row-copy">
                  <b>{row.name}</b>
                  <small>{row.kindLabel} · {row.canvas} · {row.slotCount} 个占位区 · {row.entryLabel}</small>
                </div>
                <span className="poster-admin-row-tags">
                  {row.isDefault ? <em className="is-default">默认</em> : null}
                  {row.builtin ? <em className="is-builtin">内置</em> : null}
                  {draftState.rowUnsaved(row.id) ? <em className="is-dirty" data-poster-admin-row-dirty="true">未保存</em> : null}
                  {rowInfo.usage.referenced ? <em className="is-used" data-poster-admin-row-used="true" title={posterAdminUsageText(template, rowInfo.usage)}>已使用</em> : null}
                  <em className={row.enabled ? 'is-on' : 'is-off'}>{row.enabled ? '启用中' : '已停用'}</em>
                  {row.writable ? null : <em className="is-readonly" data-poster-admin-row-readonly={row.id} title={`由${row.ownerText}维护`}>{POSTER_ADMIN_READONLY_BADGE}</em>}
                </span>
              </button>
              {/* 列表行上的两个快捷动作（AC 原文：模板列表带启用开关与排序）——不可写的行不出现。 */}
              {row.writable ? <span className="poster-admin-row-actions">
                <button type="button" className="icon-btn" title="上移" data-poster-admin-row-up={row.id}
                  disabled={!rowInfo.position.canUp} onClick={() => moveRow(row.id, -1)}>↑</button>
                <button type="button" className="icon-btn" title="下移" data-poster-admin-row-down={row.id}
                  disabled={!rowInfo.position.canDown} onClick={() => moveRow(row.id, 1)}>↓</button>
                <button type="button" className="text-link" data-poster-admin-row-toggle={row.id}
                  onClick={() => setRowEnabled(row.id, row.enabled === false)}>{row.enabled ? '停用' : '启用'}</button>
              </span> : null}
            </div>;
          })}
        </div>)}
        {library.length ? null : <p className="persona-empty">模板库是空的：点右上角「新增海报模板」建第一套。</p>}
      </div>

      {/* ② 参数面板：spec 的每个可编辑叶子都在这里（描述表在 data 层，界面不写死任何字段名）。 */}
      <div className="panel poster-admin-panel">
        {draft ? <>
          <div className="panel-head" data-poster-admin-draft={draft.id}
            data-poster-admin-writable={writable ? 'true' : 'false'}
            data-poster-admin-dirty={dirty ? 'true' : 'false'}
            data-poster-admin-coverage={String(coverage.covered)}
            data-poster-admin-coverage-missing={String(coverage.missing.length)}
            data-poster-admin-spec-issues={String(facts ? facts.specIssues.length : 0)}
            data-poster-admin-unknown-vars={String(facts ? facts.unknownRows.length : 0)}
            data-poster-admin-kind={normalized.kind}>
            <div>
              <h2 data-poster-admin-draft-name={facts ? facts.name : ''}>{facts && facts.name ? facts.name : '未命名海报模板'}</h2>
              <p>{coverage.text}</p>
            </div>
            <div className="row-actions">
              <button type="button" className="text-link" data-poster-admin-reload="true" disabled={!dirty} onClick={reloadSaved}>{POSTER_ADMIN_RELOAD_SAVED_LABEL}</button>
              <Button onClick={save} disabled={!writable || saving} data-poster-admin-save="true">{saving ? '保存中…' : '保存'}</Button>
            </div>
          </div>
          {writable ? null : <p className="poster-admin-readonly-note" data-poster-admin-readonly-note={draftRecord.scope}>
            只读：{POSTER_ADMIN_READONLY_NOTE[draftRecord.scope] || draftIssue}这套模板由{posterAdminTemplateWriteOwnerText(draft)}维护，本会话（平台管理员）只能改平台层模板。
          </p>}
          {facts && !facts.ready ? <p className="poster-admin-blocker" data-poster-admin-blocker={facts.blockers.length}>{facts.blockers.join('；')}</p> : null}
          {notice ? <p className="poster-admin-notice" data-poster-admin-notice="true">{notice}</p> : null}

          <section className="poster-admin-section" data-poster-admin-section="meta">
            <h3>库级设置</h3>
            <div className="poster-admin-grid">
              <label className="poster-admin-field" data-poster-admin-field="name">
                <b>模板名</b>
                <input type="text" value={draft.name || ''} maxLength={POSTER_ADMIN_NAME_MAX} disabled={!writable}
                  placeholder={POSTER_ADMIN_NAME_PLACEHOLDER}
                  onChange={(event) => patchField('name', event.target.value)} />
                {facts && facts.nameIssue ? <small className="is-error" data-poster-admin-name-issue="true">{facts.nameIssue}</small> : <small>同名模板只能有一套（重名会让人分不清选的是哪一套）。</small>}
              </label>
              <label className="poster-admin-field" data-poster-admin-field="description">
                <b>一句话说明</b>
                <input type="text" value={draft.description || ''} maxLength={POSTER_ADMIN_DESCRIPTION_MAX} disabled={!writable}
                  onChange={(event) => patchField('description', event.target.value)} />
                <small>{POSTER_ADMIN_TEMPLATE_DESCRIPTION_NOTE}</small>
              </label>
              <label className="poster-admin-field" data-poster-admin-field="kind">
                <b>海报类型</b>
                <select value={draftRecord.kind} disabled={!writable} data-poster-admin-kind-select="true" onChange={(event) => changeKind(event.target.value)}>
                  {POSTER_KINDS.map((kind) => <option key={kind} value={kind}>{POSTER_KIND_LABELS[kind] || kind}</option>)}
                </select>
                <small>类型决定版式在哪些入口出现（学员 / 班级 / 长图各自一套装配）。</small>
              </label>
              <label className="poster-admin-field" data-poster-admin-field="entryScope">
                <b>适用入口</b>
                <select value={draftRecord.entryScope} disabled={!writable} data-poster-admin-entry-scope="true" onChange={(event) => patchField('entryScope', event.target.value)}>
                  {POSTER_ENTRY_SCOPES.map((scope) => <option key={scope} value={scope}>{POSTER_ENTRY_SCOPE_LABELS[scope] || scope}</option>)}
                </select>
                <small>「两处入口」= 成长档案与课后反馈第四步都选得到。</small>
              </label>
            </div>
            {/* 适用范围读数（AC2）：类型 + 入口两件事各自配成了什么、老师端会在哪儿看到它。 */}
            <ul className="poster-admin-issues" data-poster-admin-scope-facts="true"
              data-poster-admin-scope-kind={scopeView.kind} data-poster-admin-scope-entry={scopeView.entryScope}
              data-poster-admin-scope-entries={scopeView.entries.join(',')}>
              <li data-poster-admin-scope="readout">{scopeView.text}</li>
              <li data-poster-admin-scope="kind-note">{scopeView.kindNote}</li>
              <li data-poster-admin-scope="note">{POSTER_ADMIN_SCOPE_NOTE}</li>
            </ul>
            <div className="poster-admin-meta-row">
              <label className="poster-admin-check" data-poster-admin-field="enabled">
                <input type="checkbox" checked={draft.enabled !== false} disabled={!writable} data-poster-admin-enabled="true" onChange={toggleEnabled} />
                <span>在老师端可选（保存后生效）</span>
              </label>
              <span className="poster-admin-chip" data-poster-admin-meta="scope">{draftRecord.scope === 'platform' ? '系统模板' : draftRecord.scope}</span>
              <span className="poster-admin-chip" data-poster-admin-meta="sort" data-poster-admin-meta-sort={String(draftRecord.sortOrder)}>
                排序 {sortPosition.position}/{sortPosition.count}
              </span>
              <span className="poster-admin-chip" data-poster-admin-meta="updated" data-poster-admin-meta-updated-by={draftRecord.updatedBy} data-poster-admin-meta-updated-at={draftRecord.updatedAt}>
                最后变更：{updatedFacts.text}
              </span>
              <span className="poster-admin-chip" data-poster-admin-meta="enabled">{draft.enabled === false ? '已停用（老师端看不到）' : '启用中'}</span>
            </div>
            {/* 库级动作（AC1 / AC4）：排序 · 设为默认 · 删除 —— 不可写的层整组不出现。 */}
            {writable ? <div className="poster-admin-library-actions" data-poster-admin-library-actions="true">
              <button type="button" className="text-link" data-poster-admin-move="up" disabled={!sortPosition.canUp} onClick={() => moveRow(draft.id, -1)}>上移</button>
              <button type="button" className="text-link" data-poster-admin-move="down" disabled={!sortPosition.canDown} onClick={() => moveRow(draft.id, 1)}>下移</button>
              <button type="button" className="text-link" data-poster-admin-set-default={defaultId === draft.id ? 'off' : 'on'} onClick={toggleDefault}>
                {defaultId === draft.id ? '取消默认标记' : '设为默认模板'}
              </button>
              <button type="button" className="text-link is-danger" data-poster-admin-delete="true" onClick={askDelete}><Trash2 size={13} /> 删除模板</button>
            </div> : null}
            <p className="poster-admin-hint" data-poster-admin-sort-note="true">{POSTER_ADMIN_SORT_NOTE}{POSTER_ADMIN_DEFAULT_NOTE}{POSTER_ADMIN_ENABLED_NOTE}</p>
            <p className="poster-admin-hint" data-poster-admin-default-state={defaultId === draft.id ? 'default' : 'plain'}>
              {defaultId === draft.id ? `现在默认模板就是这一套（${draft.name}）。` : (defaultId ? `现在默认模板是「${(library.find((item) => item.id === defaultId) || {}).name || defaultId}」。` : '现在还没有默认模板：老师端弹窗会回落到「第一套可用的单作品」。')}
            </p>
            {/* 删除的两步确认（AC4）：先看影响范围与判据，再点确认；判据不允许时给「改为停用」这条出路。 */}
            {pendingDelete && pendingDelete.id === draft.id ? <div className={`poster-admin-delete-panel${pendingDelete.verdict.allowed ? '' : ' is-blocked'}`}
              data-poster-admin-delete-panel={pendingDelete.verdict.allowed ? 'confirm' : 'denied'}
              data-poster-admin-delete-kind={pendingDelete.verdict.kind}>
              <p data-poster-admin-delete-message="true">{pendingDelete.verdict.message}</p>
              <small>{pendingDelete.verdict.allowed ? `${POSTER_ADMIN_DELETE_CONFIRM_TEXT}${POSTER_ADMIN_DELETE_NOTE}` : '只能停用：停用后老师端不再出现这一套，已经产出的海报图片不受影响。'}</small>
              <div className="row-actions">
                {pendingDelete.verdict.allowed ? <Button variant="secondary" onClick={confirmDelete} data-poster-admin-delete-confirm="true">确认删除</Button> : null}
                {pendingDelete.verdict.allowed ? null : <Button variant="secondary" onClick={disableInstead} data-poster-admin-disable-instead="true">{POSTER_ADMIN_DISABLE_INSTEAD_LABEL}</Button>}
                <button type="button" className="text-link" data-poster-admin-delete-cancel="true" onClick={() => setPendingDelete(null)}>取消</button>
              </div>
            </div> : null}
            {/* 引用范围（AC4）：删除判据与「被使用过的模板只允许停用」读的就是这一份读数。 */}
            <ul className="poster-admin-issues" data-poster-admin-usage="true" data-poster-admin-usage-referenced={usage.referenced ? 'true' : 'false'}
              data-poster-admin-usage-count={String(usage.count)}>
              <li data-poster-admin-usage="text">{posterAdminUsageText(draft, usage)}</li>
              <li data-poster-admin-usage="verdict" data-poster-admin-usage-allowed={deleteVerdict.allowed ? 'true' : 'false'}>{deleteVerdict.allowed ? `可以删除：${deleteVerdict.message}` : deleteVerdict.message}</li>
            </ul>
            {/* 变更历史（AC5 / FR-359）：每一次保存 / 启停 / 排序 / 设为默认都在这里留一条。 */}
            <details className="poster-admin-history" data-poster-admin-history={String(historyRows.length)} data-poster-admin-history-total={String(draftRecord.history.length)} open>
              <summary><b>{POSTER_ADMIN_HISTORY_TITLE}</b><span>{draftRecord.history.length ? `${draftRecord.history.length} 条` : '暂无'}</span></summary>
              {historyRows.length ? <ul className="poster-admin-history-rows">
                {historyRows.map((entry, index) => <li key={`${entry.at}-${index}`} data-poster-admin-history-row={entry.action}
                  data-poster-admin-history-latest={entry.isLatest ? 'true' : 'false'}>
                  <b>{auditTimeText(entry.at) || entry.at}</b>
                  <span>{entry.by || '（未记录操作人）'}</span>
                  <em>{entry.text}</em>
                </li>)}
              </ul> : <p className="persona-empty" data-poster-admin-history-empty="true">{POSTER_ADMIN_HISTORY_EMPTY}</p>}
              <small>{POSTER_ADMIN_HISTORY_NOTE}</small>
            </details>
            <p className="poster-admin-hint" data-poster-admin-draft-note="true">{POSTER_ADMIN_DRAFT_NOTE}</p>
          </section>

          <section className="poster-admin-section" data-poster-admin-section="canvas">
            <h3>画布</h3>
            <div className="poster-admin-grid">
              {sectionFields('canvas').map((field) => <AdminControl key={field.path} field={field} value={posterAdminReadPath(spec, field.path)} disabled={!writable} fieldKey={field.path} onCommit={patchSpec} />)}
            </div>
            <div className="poster-admin-actions">
              <button type="button" className="text-link" data-poster-admin-reset-canvas="true" disabled={!writable} onClick={resetCanvas}>{POSTER_ADMIN_RESET_CANVAS_LABEL}</button>
              <small data-poster-admin-canvas-hint="true">{`${POSTER_KIND_LABELS[draftRecord.kind] || draftRecord.kind}的默认画布：${posterAdminKindCanvas(draftRecord.kind).width}×${posterAdminKindCanvas(draftRecord.kind).height}`}</small>
            </div>
          </section>

          <section className="poster-admin-section" data-poster-admin-section="background">
            <h3>背景</h3>
            <div className="poster-admin-grid">
              {sectionFields('background').map((field) => <AdminControl key={field.path} field={field} value={posterAdminReadPath(spec, field.path)} disabled={!writable} fieldKey={field.path} onCommit={patchSpec} />)}
            </div>
            <p className="poster-admin-hint" data-poster-admin-background-hint="true">
              {`背景类型 ${POSTER_ADMIN_BACKGROUND_TYPE_LABELS[normalized.background.type] || normalized.background.type}：纯色只用起始色，线性渐变按角度铺两个色标。`}
            </p>
          </section>

          <section className="poster-admin-section" data-poster-admin-section="frame">
            <h3>边框</h3>
            <div className="poster-admin-grid">
              {sectionFields('frame').map((field) => <AdminControl key={field.path} field={field} value={field.control === 'check' ? normalized.frame.enabled : posterAdminReadPath(spec, field.path)} disabled={!writable} fieldKey={field.path} onCommit={patchSpec} />)}
            </div>
          </section>

          <section className="poster-admin-section" data-poster-admin-section="decor">
            <h3>装饰线</h3>
            <div className="poster-admin-grid">
              {sectionFields('decor').map((field) => <AdminControl key={field.path} field={field} value={field.control === 'check' ? normalized.decor.hairline.visible : posterAdminReadPath(spec, field.path)} disabled={!writable} fieldKey={field.path} onCommit={patchSpec} />)}
            </div>
          </section>

          <section className="poster-admin-section" data-poster-admin-section="slots" data-poster-admin-slot-count={String(normalized.slots.length)}>
            <h3>占位区（{normalized.slots.length} 个）</h3>
            {normalized.slots.map((slot, index) => <details className="poster-admin-slot" key={`${slot.id}-${index}`} open={index < 2}
              data-poster-admin-slot={slot.id} data-poster-admin-slot-type-value={slot.type} data-poster-admin-slot-index={String(index)}>
              <summary>
                <b>{POSTER_SLOT_TYPE_LABELS[slot.type] || slot.type} · {slot.id}</b>
                <span data-poster-admin-slot-visible={slot.visible === false ? 'false' : 'true'}>{slot.visible === false ? '已隐藏' : '显示中'}</span>
              </summary>
              <div className="poster-admin-grid">
                <label className="poster-admin-field" data-poster-admin-field="type">
                  <b>占位区类型</b>
                  <select value={slot.type} disabled={!writable} data-poster-admin-slot-type={String(index)}
                    onChange={(event) => { if (!writable) return; setDraft((current) => (current ? { ...current, spec: posterAdminSlotTypePatch(current.spec, index, event.target.value) } : current)); setDirty(true); }}>
                    {POSTER_SLOT_TYPES.map((type) => <option key={type} value={type}>{POSTER_SLOT_TYPE_LABELS[type] || type}</option>)}
                  </select>
                  <small>换类型会换成该类型的默认尺寸（位置与显隐保留）。</small>
                </label>
                {posterAdminSlotFieldRows(slot).map((field) => <AdminControl key={`${slot.id}-${field.path}`} field={field}
                  value={field.control === 'check' ? posterAdminReadPath(spec, `slots.${index}.${field.path}`) !== false : posterAdminReadPath(spec, `slots.${index}.${field.path}`)}
                  disabled={!writable} fieldKey={`slots.${index}.${field.path}`}
                  onCommit={(relPath, next) => patchSpec(`slots.${index}.${relPath}`, next)} />)}
              </div>
            </details>)}
          </section>

          <section className="poster-admin-section" data-poster-admin-section="issues">
            <h3>保存前读数</h3>
            {/* 保存前三项校验（AC3 / FR-355）：越界与二维码不达标拦保存，文字溢出是估算警告。 */}
            <ul className="poster-admin-issues poster-admin-checks" data-poster-admin-checks="true"
              data-poster-admin-checks-ok={checks.ok ? 'true' : 'false'}
              data-poster-admin-checks-blocked={checks.blocked ? 'true' : 'false'}
              data-poster-admin-checks-blockers={String(checks.blockers.length)}
              data-poster-admin-checks-warnings={String(checks.warnings.length)}>
              {checks.rows.map((row) => <li key={row.id} className={row.ok ? 'is-ok' : (row.level === 'block' ? 'is-error' : 'is-warn')}
                data-poster-admin-check={row.id}
                data-poster-admin-check-ok={row.ok ? 'true' : 'false'}
                data-poster-admin-check-level={row.level}
                data-poster-admin-check-value={row.value}>
                <b>{row.ok ? '通过' : (row.level === 'block' ? '不通过' : '警告')} · {row.label}</b>
                <span>{row.detail}</span>
              </li>)}
              <li data-poster-admin-check-note="estimate">{checks.note}</li>
            </ul>
            {checks.blocked ? <p className="poster-admin-blocker" data-poster-admin-checks-blocker={String(checks.blockers.length)}>{POSTER_ADMIN_CHECK_BLOCKED_TITLE}{checks.blockers.join(' ')}</p> : null}
            <ul className="poster-admin-issues" data-poster-admin-issue-count={String((facts ? facts.specIssues.length : 0) + (facts ? facts.unknownRows.length : 0))}>
              <li data-poster-admin-issue="converge">{facts && facts.specIssues.length ? `有 ${facts.specIssues.length} 处参数越界 / 非法，保存时会被收敛：${facts.specIssues.slice(0, 3).map((issue) => issue.message).join('；')}` : '参数都在允许范围内（保存时不会改动任何值）。'}</li>
              <li data-poster-admin-issue="variables">{facts && facts.unknownRows.length ? `有 ${facts.unknownRows.length} 个未知变量：${facts.unknownRows.map((row) => `${row.slotLabel}{${row.name}}`).join('、')}（渲染时保留原文）` : '文案模板里的变量都在白名单内。'}</li>
              <li data-poster-admin-issue="policy">{POSTER_ADMIN_CHECK_POLICY_NOTE}</li>
              <li data-poster-admin-issue="note">{facts ? facts.note : ''}</li>
            </ul>
          </section>
        </> : <p className="persona-empty">左边选一套模板（或点右上角「新增海报模板」）开始调参数。</p>}
      </div>

      {/* ③ 实时预览：同一支渲染分派（`renderPosterDialog`），只差倍数。 */}
      <div className="panel poster-admin-preview" data-poster-admin-preview={preview.phase}
        data-poster-admin-preview-kind={draftKind}
        data-poster-admin-preview-size={`${preview.width}x${preview.height}`}>
        <div className="panel-head">
          <h2>实时预览</h2>
          <small>{POSTER_ADMIN_PREVIEW_NOTE}</small>
        </div>
        <figure className="poster-admin-preview-figure">
          {preview.url
            ? <img src={preview.url} alt="海报模板预览" data-poster-admin-preview-img="true"
              data-poster-admin-preview-img-kind={draftKind}
              data-poster-admin-preview-img-size={`${preview.width}x${preview.height}`} />
            : <span className="poster-admin-preview-hold" data-poster-admin-preview-hold={preview.phase}>
              {preview.phase === 'pending' ? <Loader2 size={16} /> : preview.phase === 'failed' ? <RefreshCw size={16} /> : <Eye size={16} />}
              {preview.phase === 'pending' ? POSTER_ADMIN_PREVIEW_PENDING_TEXT
                : preview.phase === 'failed' ? POSTER_ADMIN_PREVIEW_FAILED_TEXT
                  : '选一套模板就能看到它长什么样'}
            </span>}
        </figure>
        <ul className="poster-admin-preview-notes">
          <li data-poster-admin-preview-line="canvas">{`画布：${normalized.canvas.width}×${normalized.canvas.height}（短边 ${Math.min(normalized.canvas.width, normalized.canvas.height)}px 是比例坐标的尺子）`}</li>
          <li data-poster-admin-preview-line="sample">{sampleLine}</li>
          <li data-poster-admin-preview-line="render">{preview.phase === 'ready' ? `本次出图：${preview.width}×${preview.height}（预览 1×，导出走同一支渲染的 2×）` : preview.phase === 'pending' ? POSTER_ADMIN_PREVIEW_PENDING_TEXT : preview.phase === 'failed' ? POSTER_ADMIN_PREVIEW_FAILED_TEXT : '还在等模板'}</li>
          <li data-poster-admin-preview-line="sample-note">{POSTER_ADMIN_PREVIEW_SAMPLE_NOTE}</li>
          {preview.warnings.length ? <li className="is-warn" data-poster-admin-preview-warning="true">{preview.warnings.join('；')}</li> : null}
        </ul>
        <p className="poster-admin-preview-foot" data-poster-admin-preview-enabled={draft && draft.enabled !== false ? 'true' : 'false'}>
          {draft
            ? (draft.enabled === false
              ? <><EyeOff size={13} /> 这一套现在是<b>停用</b>状态：老师端看不到，先在参数面板勾上「在老师端可选」再保存。</>
              : <><Eye size={13} /> 这一套是<b>启用</b>状态：保存后老师端的版式列表里就能选到它。</>)
            : '还没有选中模板'}
        </p>
      </div>
    </div>
  </>;
}
