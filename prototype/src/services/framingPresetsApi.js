import { cloud, unwrap } from '../cloud';
import { filterFramingPresetsForViewer, normalizeFramingPreset, sortFramingPresets } from '../data/framingPresets';
import { framingPresetWriteIssue, framingWriteDeniedMessage } from '../data/framingPermissions';

// 装裱模板：平台 / 机构 / 老师个人**三层共用一张表**，靠 `scope` + `owner_key` 区分归属
// （平台模板 owner_key 为空），与其它表同一套共享工作区模型。
// `preset_key` 仍是幂等 upsert 的冲突键：三层的模板 id 各自唯一，所以 upsert 不会跨层互相覆盖。
//
// [第二步 US-013]：**写接口全部要过 scope 写权限校验**（FR-45）。
// 这一层就是原型里的「服务端」边界（`cloud.database` 是它后面的库），所以校验放在这里：
// 老师端带着 `scope=platform` 的 payload 过来、机构管理员写别的机构的模板、
// 任何人写别人的个人模板，都会在**落库之前**被拒（403），不会出现「先写进去再发现越权」。
const TABLE = 'framing_presets';

/** 越权写入的错误：带 403 状态、被拒的 scope 与可读原因（界面直接读 `message`）。 */
export class FramingPresetWriteError extends Error {
  constructor(preset, viewer = {}) {
    const item = normalizeFramingPreset(preset);
    super(framingWriteDeniedMessage(item, viewer));
    this.name = 'FramingPresetWriteError';
    this.status = 403;
    this.code = 'forbidden-scope-write';
    this.scope = item.scope;
    this.ownerKey = item.ownerKey;
    this.presetId = String(item.id || '');
    this.reason = framingPresetWriteIssue(item, viewer);
  }
}

/** 写权限断言：不合格就抛 `FramingPresetWriteError`（保存与删除共用一个闸口）。 */
export function assertFramingPresetWrite(preset, viewer = {}) {
  if (framingPresetWriteIssue(preset, viewer)) throw new FramingPresetWriteError(preset, viewer);
  return true;
}

function rowToPreset(row) {
  const source = row && typeof row === 'object' ? row : {};
  // 老记录没有 scope 列 → normalizeFramingPreset 按 platform 读取（US-001b 的兼容要求）。
  // 云端的 `plaque_date` 列是历史字段（曾经存一个具体日期），US-014 起**不再读它**：
  // 展签日期的值取 `lesson.lessonDate`，模板只保留格式（`spec.plaque.dateFormat`）与位置。
  return normalizeFramingPreset({
    id: source.preset_key,
    name: source.name || '未命名装裱',
    description: source.description || '',
    spec: source.spec && typeof source.spec === 'object' ? source.spec : null,
    plaqueStudent: source.plaque_student || '',
    plaqueTitle: source.plaque_title || '',
    enabled: source.enabled !== false,
    builtin: source.builtin === true,
    scope: source.scope,
    ownerKey: source.owner_key,
    sortOrder: Number.isFinite(source.sort_order) ? source.sort_order : 90,
    updatedAt: source.updated_at || '',
    // US-011b 的四列（默认标记 / 课程绑定 / 更新人 / 变更历史）。
    // 云端表还没有这几列时读到的是 undefined → normalizeFramingPreset 收敛成安全值。
    isDefault: source.is_default === true,
    boundCourseTypes: source.bound_course_types,
    updatedBy: source.updated_by || '',
    history: source.history
  });
}

function presetToRow(preset) {
  const item = normalizeFramingPreset(preset);
  return {
    preset_key: String(item.id),
    name: item.name || '未命名装裱',
    description: item.description || '',
    spec: item.spec || null,
    plaque_student: item.plaqueStudent || '',
    // 历史列：**不再承载日期值**（US-014 后日期一律取 lesson.lessonDate）。
    // 保留这一列并写空串，是为了「云表补上 scope 等新列、写入重新可用」时顺手把老数据清干净。
    plaque_date: '',
    plaque_title: item.plaqueTitle || '',
    enabled: item.enabled !== false,
    builtin: item.builtin === true,
    scope: item.scope,
    owner_key: item.ownerKey || '',
    sort_order: Number.isFinite(item.sortOrder) ? item.sortOrder : 90,
    // US-011b：默认标记 / 课程绑定 / 更新人 / 变更历史（云表补列后即可同步；
    // 缺列时 PostgREST 会整条拒掉 400，调用方按「已保存到本机」处理）。
    is_default: item.isDefault === true,
    bound_course_types: item.boundCourseTypes,
    updated_by: item.updatedBy || '',
    history: item.history
  };
}

/**
 * 读取模板。
 * - 不传 viewer：返回**全部三层**，供管理端维护（后台「装裱设置」要能看到并编辑每一层）。
 * - 传 viewer（`{ role, teacherId, teacherName, orgId }`）：按 `scope + owner_key` 过滤 ——
 *   平台模板所有人可见、机构模板限本机构、老师个人模板仅 ownerKey 命中自己的可见，
 *   老师看不到别人的个人模板。过滤与可见性规则都在 `data/framingPresets.js` 里（零依赖纯函数）。
 */
export async function loadRemoteFramingPresets(viewer = null) {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  const presets = sortFramingPresets((rows || []).map(rowToPreset));
  return viewer ? filterFramingPresetsForViewer(presets, viewer) : presets;
}

export async function saveRemoteFramingPreset(preset, viewer = {}) {
  // 写权限先判：不合格的 payload 连云端都不碰（也不写本机镜像 —— 调用方在 await 前就已拦住）。
  assertFramingPresetWrite(preset, viewer);
  unwrap(await cloud.database.from(TABLE).upsert(presetToRow(preset), { onConflict: 'preset_key' }));
  return preset;
}

/** 删除也是写：`preset` 是待删的那一条（用它的 scope + owner_key 判权限），`viewer` 是操作人。 */
export async function deleteRemoteFramingPreset(preset, viewer = {}) {
  const target = preset && typeof preset === 'object' ? preset : { id: preset };
  assertFramingPresetWrite(target, viewer);
  unwrap(await cloud.database.from(TABLE).delete().eq('preset_key', String(normalizeFramingPreset(target).id)));
  return normalizeFramingPreset(target).id;
}
