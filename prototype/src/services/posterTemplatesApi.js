import { cloud, unwrap } from '../cloud';
import {
  POSTER_TEMPLATE_SORT_FALLBACK,
  loadPosterTemplates as loadLocalPosterTemplates,
  mergePosterTemplates,
  missingBuiltinPosterTemplates,
  normalizePosterTemplate,
  persistPosterTemplates as persistLocalPosterTemplates,
  posterTemplateDeleteIssue,
  seedPosterTemplates,
  sortPosterTemplates,
  withBuiltinPosterTemplates
} from '../data/posterTemplates';

// 海报模板（云表 `poster_templates`）的云端读写与**幂等初始化**（[海报 US-302b] / FR-356、FR-357、FR-368）。
//
// 与装裱 `services/framingPresetsApi.js` **完全同构**，差别只有两点：
//   ① 幂等键叫 `template_key`（装裱是 `preset_key`）—— 沿用其它表 `*_key` 的约定；
//   ② 这里多一个「内置模板库随首次加载幂等写入云端」的入口（`ensureBuiltinPosterTemplates`），
//      因为海报的内置模板是**参数化数据**（US-302a 的 8 套），要能被后台当成普通模板继续改。
//
// 三层归属（platform / org / teacher，`scope` + `owner_key`）直接复用装裱那一套（见 `data/posterTemplates.js`），
// 不再发明第二套权限模型；写权限校验（FR-360）属 US-312b 的范围，本故事只做读写与初始化。
//
// 三条纪律，改代码前先读：
//   ① **云端行是 snake_case，应用内是 camelCase** —— 转换只在本文件的 `rowToPosterTemplate` /
//      `posterTemplateToRow` 里做，且列名单一来源是 `POSTER_TEMPLATE_ROW_FIELDS`（14 列），
//      业务代码永远不碰 snake_case。
//   ② **写入先落本机镜像、再推云端**（`mirrorPosterTemplateLocally`）：本机云端的 `poster_templates`
//      表还没建立，带新列的 row 会被 PostgREST 整条拒掉 —— 云端失败时数据不丢，只是提示同步失败。
//   ③ **云端不可达时不静默降级**（FR-368）：`loadPosterTemplateStore()` 会回退内置模板，并带上
//      「当前使用内置模板（云端未连通）」，界面层直接显示它（US-312a 的面板读这个字段）。
const TABLE = 'poster_templates';

/** 云端读不到时的兜底文案（FR-368 的原文，界面直接显示这一句，别在别处再抄一遍）。 */
export const POSTER_TEMPLATE_OFFLINE_NOTICE = '当前使用内置模板（云端未连通）';

/** 内置模板写进云端时记的操作人（留痕口径沿用装裱的 `updated_by`，见 FR-359）。 */
export const POSTER_TEMPLATE_SEED_OPERATOR = '系统初始化';

/** 模板来源：`cloud` = 云端读回的一份；`builtin` = 云端不可达，当前用的是内置模板库。 */
export const POSTER_TEMPLATE_SOURCES = { cloud: 'cloud', builtin: 'builtin' };

/**
 * `poster_templates` 的**列名单一来源**（应用字段名 → 云表列名）。
 *
 * 表结构建议见 `tasks/prd-share-poster.md` 9.3；读 / 写映射都从这里派生，于是「新增一个字段」
 * 只改这一处、`POSTER_TEMPLATE_ROW_COLUMNS` 自动跟着变（断言读它核对 14 列一个不少）。
 */
export const POSTER_TEMPLATE_ROW_FIELDS = {
  id: 'template_key',
  name: 'name',
  description: 'description',
  kind: 'kind',
  spec: 'spec',
  scope: 'scope',
  ownerKey: 'owner_key',
  entryScope: 'entry_scope',
  enabled: 'enabled',
  builtin: 'builtin',
  isDefault: 'is_default',
  sortOrder: 'sort_order',
  updatedBy: 'updated_by',
  updatedAt: 'updated_at'
};

/** 云表列清单（断言与人工核对表结构时读它；顺序 = 上面对象的书写顺序）。 */
export const POSTER_TEMPLATE_ROW_COLUMNS = Object.values(POSTER_TEMPLATE_ROW_FIELDS);

/** 删除被拒的错误（内置模板不可删，只可停用 —— FR-357）：界面直接读 `message`。 */
export class PosterTemplateDeleteError extends Error {
  constructor(templateKey, reason) {
    super(reason || '该海报模板不可删除。');
    this.name = 'PosterTemplateDeleteError';
    this.code = 'poster-template-delete-denied';
    this.templateKey = String(templateKey || '');
    this.reason = reason || '';
  }
}

/** 云端错误的可读文案（SDK 抛的有 Error、也有 `{ message }` 信封，两种都要能读）。 */
function posterTemplateErrorMessage(error) {
  if (!error) return '云端写入失败';
  if (typeof error === 'string') return error;
  return error.message || error.error_description || error.details || '云端写入失败';
}

/** `spec` 列可能是 jsonb（对象）也可能是被序列化成字符串的文本列，两种都读得回来。 */
function posterTemplateSpecFromRow(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 行 → 应用对象（snake_case 只在这里出现）。
 * 收敛一律交给 `normalizePosterTemplate`：缺列（云表还没补上某列）、脏值、旧数据都安全降级，永不抛错。
 */
export function rowToPosterTemplate(row) {
  const source = row && typeof row === 'object' ? row : {};
  return normalizePosterTemplate({
    id: source[POSTER_TEMPLATE_ROW_FIELDS.id],
    name: source[POSTER_TEMPLATE_ROW_FIELDS.name],
    description: source[POSTER_TEMPLATE_ROW_FIELDS.description],
    kind: source[POSTER_TEMPLATE_ROW_FIELDS.kind],
    spec: posterTemplateSpecFromRow(source[POSTER_TEMPLATE_ROW_FIELDS.spec]),
    scope: source[POSTER_TEMPLATE_ROW_FIELDS.scope],
    ownerKey: source[POSTER_TEMPLATE_ROW_FIELDS.ownerKey],
    entryScope: source[POSTER_TEMPLATE_ROW_FIELDS.entryScope],
    enabled: source[POSTER_TEMPLATE_ROW_FIELDS.enabled],
    builtin: source[POSTER_TEMPLATE_ROW_FIELDS.builtin],
    isDefault: source[POSTER_TEMPLATE_ROW_FIELDS.isDefault],
    sortOrder: source[POSTER_TEMPLATE_ROW_FIELDS.sortOrder],
    updatedBy: source[POSTER_TEMPLATE_ROW_FIELDS.updatedBy],
    updatedAt: source[POSTER_TEMPLATE_ROW_FIELDS.updatedAt]
  });
}

/**
 * 应用对象 → 行：14 列**一个不少**地写出来（云表缺列时整条会被拒，那是调用方要处理的失败，
 * 而不是「少写两列凑合」——少写会让「模板改了名字但库里没变」这类问题变得不可解释）。
 * `spec` 先过 `normalizePosterTemplate`：写进云端的永远是一份能被渲染器画出来的 spec。
 */
export function posterTemplateToRow(template) {
  const item = normalizePosterTemplate(template);
  if (!item.id) throw new Error('海报模板缺少 template_key，未写入云端。');
  return {
    [POSTER_TEMPLATE_ROW_FIELDS.id]: item.id,
    [POSTER_TEMPLATE_ROW_FIELDS.name]: item.name,
    [POSTER_TEMPLATE_ROW_FIELDS.description]: item.description,
    [POSTER_TEMPLATE_ROW_FIELDS.kind]: item.kind,
    [POSTER_TEMPLATE_ROW_FIELDS.spec]: item.spec,
    [POSTER_TEMPLATE_ROW_FIELDS.scope]: item.scope,
    [POSTER_TEMPLATE_ROW_FIELDS.ownerKey]: item.ownerKey || '',
    [POSTER_TEMPLATE_ROW_FIELDS.entryScope]: item.entryScope,
    [POSTER_TEMPLATE_ROW_FIELDS.enabled]: item.enabled !== false,
    [POSTER_TEMPLATE_ROW_FIELDS.builtin]: item.builtin === true,
    [POSTER_TEMPLATE_ROW_FIELDS.isDefault]: item.isDefault === true,
    [POSTER_TEMPLATE_ROW_FIELDS.sortOrder]: Number.isFinite(item.sortOrder) ? item.sortOrder : POSTER_TEMPLATE_SORT_FALLBACK,
    [POSTER_TEMPLATE_ROW_FIELDS.updatedBy]: item.updatedBy || '',
    // 写下去的那一刻就是「最后变更时间」（与音乐库同一口径：调用方不用自己盖时间戳）。
    [POSTER_TEMPLATE_ROW_FIELDS.updatedAt]: item.updatedAt || new Date().toISOString()
  };
}

/** 云端读全部（含停用与三层归属 —— 过滤是界面 / viewer 的事，这里不做裁剪）。 */
export async function loadRemotePosterTemplates() {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  return sortPosterTemplates((rows || []).map(rowToPosterTemplate));
}

/** 单条写云端（幂等 upsert，冲突键 `template_key`）。不做本机镜像 —— 那是 `savePosterTemplate` 的事。 */
export async function saveRemotePosterTemplate(template) {
  const item = normalizePosterTemplate(template);
  unwrap(await cloud.database.from(TABLE).upsert(posterTemplateToRow(item), { onConflict: POSTER_TEMPLATE_ROW_FIELDS.id }));
  return item;
}

/** 单条删云端（内置模板的「不可删」由 `deletePosterTemplate` 拦在前面）。 */
export async function deleteRemotePosterTemplate(templateKey) {
  unwrap(await cloud.database.from(TABLE).delete().eq(POSTER_TEMPLATE_ROW_FIELDS.id, String(templateKey)));
  return String(templateKey);
}

/** 把一条模板并进本机镜像（同 `template_key` 覆盖）；云端写失败时它就是唯一副本。 */
export function mirrorPosterTemplateLocally(template) {
  const next = mergePosterTemplates([normalizePosterTemplate(template)], loadLocalPosterTemplates());
  persistLocalPosterTemplates(next);
  return next;
}

/**
 * **幂等初始化内置模板**（FR-356）：只把「当前列表里还没有」的那几条内置模板写进云端。
 *
 * 三条口径，别改：
 *   ① **只补不覆盖**：已存在的 `template_key` 一律跳过 —— 管理员改过的名字 / 停用 / 排序 / 默认
 *      标记都属于「已存在的那一条」，重复初始化不能把它们顶回出厂值；
 *   ② **不抛错**：单条写失败只记进 `failed`（云端表未建、欠列、断网都可能），其余照写 ——
 *      「初始化」不该让整个页面打不开；
 *   ③ **返回列表而不是自己去改界面**：要不要落本机镜像由调用方决定（本模块的 `loadPosterTemplateStore`
 *      就是调用方），保证只有一条路径写镜像。
 *
 * @returns `{ created, createdIds, failed, present, skipped, templates }`
 *   created = 本次真正写出去的内置模板（含盖章后的 updated_by / updated_at）、
 *   failed = 写失败的内置模板 `{ id, message }`、present = 已经存在（跳过）的 id、
 *   templates = 合并后的完整列表（主列表优先，顺序仍是 `sortPosterTemplates`）。
 */
export async function ensureBuiltinPosterTemplates({ existing = null, operator = POSTER_TEMPLATE_SEED_OPERATOR } = {}) {
  const current = Array.isArray(existing) ? sortPosterTemplates(existing) : await loadRemotePosterTemplates();
  const missing = missingBuiltinPosterTemplates(current);
  const created = [];
  const failed = [];
  const missingIds = new Set(missing.map((template) => template.id));
  for (const template of missing) {
    const payload = normalizePosterTemplate({
      ...template,
      updatedBy: template.updatedBy || operator,
      updatedAt: new Date().toISOString()
    });
    try {
      await saveRemotePosterTemplate(payload);
      created.push(payload);
    } catch (error) {
      failed.push({ id: template.id, message: posterTemplateErrorMessage(error) });
    }
  }
  return {
    created,
    createdIds: created.map((template) => template.id),
    failed,
    present: seedPosterTemplates.filter((template) => !missingIds.has(template.id)).map((template) => template.id),
    skipped: seedPosterTemplates.length - missing.length,
    templates: mergePosterTemplates(current, created)
  };
}

/**
 * 海报模板的**读取入口**：首次加载时幂等初始化内置模板，云端不可达时回退内置模板。
 *
 * 返回的不只是列表，还有**降级事实**（FR-368：不静默降级）：
 *   `{ templates, source, cloudConnected, notice, seeded, seedFailed, remote, error }`
 *   - `source` = `cloud`（云端读回并合并后的那一份）/ `builtin`（回退到内置模板库）；
 *   - `notice` = 云端不可达时就是「当前使用内置模板（云端未连通）」，界面直接显示这一句；
 *   - `seeded` / `seedFailed` = 本次初始化真正补进云端的内置模板 id / 失败的 `{ id, message }`。
 *
 * 合并方向是**本机镜像优先**（与装裱 / 音乐库同一处境：`poster_templates` 云表还没建立时，
 * 带新列的写入会被 PostgREST 拒掉，本机的那一份才是最新的），云端只补进本机没有的 key。
 * 不带 `viewer` 过滤：这里给的是「三层全量」，谁能看 / 谁能写是界面与 US-312b 的事。
 */
export async function loadPosterTemplateStore({ persist = true, seed = true } = {}) {
  const local = loadLocalPosterTemplates();
  try {
    const remote = await loadRemotePosterTemplates();
    const seeding = seed ? await ensureBuiltinPosterTemplates({ existing: remote }) : { created: [], createdIds: [], failed: [] };
    const templates = mergePosterTemplates(local, [...remote, ...seeding.created]);
    if (persist) persistLocalPosterTemplates(templates);
    return {
      templates,
      source: POSTER_TEMPLATE_SOURCES.cloud,
      cloudConnected: true,
      notice: '',
      seeded: seeding.createdIds,
      seedFailed: seeding.failed,
      remote,
      error: ''
    };
  } catch (error) {
    // 读失败（断网 / 云表未建立）→ 回退内置模板库 + 一句可读文案，页面照常可用。
    // 回退的这一份也落本机镜像：**镜像里永远是「正在用的那一份」**，两条路径的观察结果一致
    // （断网首访也有镜像，下一次 savePosterTemplate 的合并基于同一份数据）。
    const templates = withBuiltinPosterTemplates(local);
    if (persist) persistLocalPosterTemplates(templates);
    return {
      templates,
      source: POSTER_TEMPLATE_SOURCES.builtin,
      cloudConnected: false,
      notice: POSTER_TEMPLATE_OFFLINE_NOTICE,
      seeded: [],
      seedFailed: [],
      remote: [],
      error: posterTemplateErrorMessage(error)
    };
  }
}

/** 只要列表时的简写（`loadPosterTemplateStore()` 的 `templates`）。 */
export async function loadPosterTemplates(options) {
  return (await loadPosterTemplateStore(options)).templates;
}

/**
 * 保存一条模板：**先落本机镜像，再推云端**。
 * 云端失败时**抛出**（调用方据此提示「已保存到本机」）—— 本机镜像此时已经写过了，数据不丢。
 */
export async function savePosterTemplate(template) {
  const normalized = normalizePosterTemplate(template);
  if (!normalized.id) throw new Error('海报模板缺少 template_key，未保存。');
  // 没带时间戳的（新建 / 复制副本）在这里盖一次，两边用同一个值。
  const item = normalizePosterTemplate({ ...normalized, updatedAt: normalized.updatedAt || new Date().toISOString() });
  mirrorPosterTemplateLocally(item);
  unwrap(await cloud.database.from(TABLE).upsert(posterTemplateToRow(item), { onConflict: POSTER_TEMPLATE_ROW_FIELDS.id }));
  return item;
}

/**
 * 删除一条模板：内置模板**不可删除**（FR-357，只可停用），在碰云端之前就拒。
 * 非内置的模板：先清本机镜像（断网也要真的删掉），再尽力推云端。
 * 「已被使用过的模板只允许停用」那一条要数引用范围（FR-358），属 US-312b 的界面校验。
 */
export async function deletePosterTemplate(templateKey, { existing = null } = {}) {
  const key = String(templateKey || '').trim();
  if (!key) throw new Error('缺少要删除的海报模板标识。');
  const list = sortPosterTemplates(existing || loadLocalPosterTemplates());
  const target = list.find((template) => template.id === key) || normalizePosterTemplate({ id: key });
  const issue = posterTemplateDeleteIssue(target);
  if (issue) throw new PosterTemplateDeleteError(key, issue);
  persistLocalPosterTemplates(list.filter((template) => template.id !== key));
  try {
    await deleteRemotePosterTemplate(key);
  } catch { /* 云端不可用时本机已删除，调用方提示同步失败即可（与音乐库同一口径） */ }
  return key;
}
