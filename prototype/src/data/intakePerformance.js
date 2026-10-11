/**
 * 录入页的移动端与性能规则（US-413「录入页移动端与性能」）。
 *
 * 与 `data/mediaValidation.js` 同一套纪律：**纯函数 + 常量**，不碰 DOM、不碰网络，
 * 可以直接用 Node 跑断言（见 prototype/AGENTS.md 的「验证技巧」一节）。
 * 浏览器侧的执行（canvas 生成缩略图、空闲时段调度）在 `services/mediaIntake.js`。
 *
 * 这里放四件事，每一件都只有一份真源：
 * 1. 缩略图长边上限 `THUMBNAIL_MAX_EDGE`（320px）—— 列表里**先**渲染小图，原图留给下游装裱/点评；
 * 2. 可点区域下限 `TAP_TARGET_MIN`（44px）—— 390px 手机上的验收下限（CSS 里同值，改一处要同步另一处）；
 * 3. 名单分组阈值 `ROSTER_GROUP_THRESHOLD`（20）—— 超过就按出席状态折叠分组；
 * 4. 录入节奏 `INTAKE_TARGET_SECONDS`（180s）—— 「18 位学员各 1 幅」的验收门槛与界面用时文案。
 */
import { downsamplePlan } from './mediaValidation.js';

/** 验收使用的手机宽度（390px）。 */
export const MOBILE_INTAKE_WIDTH = 390;

/** 可点区域下限：390px 下所有按钮 / 输入 / 下拉都不小于 44x44px。 */
export const TAP_TARGET_MIN = 44;

/** 列表缩略图的长边上限：先生成不超过 320px 的小图，生成过程不阻塞输入。 */
export const THUMBNAIL_MAX_EDGE = 320;

/** 学员数**超过**这个数时，上传位列表按出席状态折叠分组。 */
export const ROSTER_GROUP_THRESHOLD = 20;

/** 「18 位学员各 1 幅作品」的录入时限（3 分钟）。 */
export const INTAKE_TARGET_SECONDS = 180;

/** 分组的固定顺序：先看得到的孩子，再补课，最后是缺课（缺课的孩子本次没有作品）。 */
export const ATTENDANCE_GROUP_ORDER = ['present', 'makeup', 'absent'];

export const ATTENDANCE_GROUP_LABELS = { present: '出席', makeup: '补课', absent: '缺课' };

/**
 * 缩略图缩放方案（纯计算，实际绘制在 `services/mediaIntake.js` 的 `createThumbnail`）。
 *
 * 与 `downsamplePlan` 的差别只在语义：缩略图**总是**要画一张新的小图（即使原图本来就不大），
 * 因为它要成为列表里独立的小地址；`needed` 只表示「需要按比例缩小」。
 */
export function thumbnailPlan(width, height, maxEdge = THUMBNAIL_MAX_EDGE) {
  const limit = Number(maxEdge) > 0 ? Number(maxEdge) : THUMBNAIL_MAX_EDGE;
  const plan = downsamplePlan(width, height, limit);
  return { ...plan, maxEdge: limit };
}

/** 学员数超过阈值才分组折叠（不超过时沿用平铺列表，与 US-406b 的行为一致）。 */
export function shouldGroupSlotRows(count) {
  return (Number(count) || 0) > ROSTER_GROUP_THRESHOLD;
}

/** 一行上传位属于哪个出席分组：认不出的状态按「出席」算（宁可显示出来，也不要藏起来）。 */
export function slotGroupKeyOf(row) {
  const attendance = String(row?.participant?.attendance || '').trim();
  return ATTENDANCE_GROUP_ORDER.includes(attendance) ? attendance : 'present';
}

/**
 * 把上传位行按出席状态分组（空组不返回）。每组的 `pending` 是**该组里还没上传任何作品**的人数
 * —— 组头直接写明「还有 N 位未上传」，老师不用展开也能定位到没录完的那一组。
 */
export function groupSlotRows(rows = []) {
  const list = Array.from(rows || []).filter(Boolean);
  return ATTENDANCE_GROUP_ORDER
    .map(key => {
      const groupRows = list.filter(row => slotGroupKeyOf(row) === key);
      return {
        key,
        label: ATTENDANCE_GROUP_LABELS[key],
        rows: groupRows,
        total: groupRows.length,
        pending: groupRows.filter(row => (Number(row?.usage?.used) || 0) === 0).length
      };
    })
    .filter(group => group.total > 0);
}

/** 用时的可读说法：48 秒 / 1 分 05 秒 / 12 分 30 秒。 */
export function formatElapsed(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes} 分 ${String(rest).padStart(2, '0')} 秒`;
}

/** 是否在验收时限内（18 位学员各 1 幅 ≤ 3 分钟）。 */
export function withinIntakeTarget(elapsedSeconds) {
  return Math.max(0, Number(elapsedSeconds) || 0) <= INTAKE_TARGET_SECONDS;
}

/**
 * 界面上的录入节奏文案（顶在学员作品上传位上方）：`已录入 7/22 位到场学员的作品 · 用时 1 分 05 秒`。
 * 全部录完时换成完成口径，并写明验收目标。`total` 为 0 时返回空串（没有到场学员就没什么可说的）。
 */
export function intakePaceSummary({ total = 0, done = 0, elapsedSeconds = 0 } = {}) {
  const limit = Math.max(0, Number(total) || 0);
  if (!limit) return '';
  const finished = Math.min(limit, Math.max(0, Number(done) || 0));
  const time = formatElapsed(elapsedSeconds);
  const targetMinutes = Math.round(INTAKE_TARGET_SECONDS / 60);
  if (finished >= limit) return `已完成 ${finished}/${limit} 位到场学员的作品录入 · 用时 ${time} · 目标 ${targetMinutes} 分钟内`;
  return `已录入 ${finished}/${limit} 位到场学员的作品 · 用时 ${time}`;
}

/** 缩略图生成中的提示（0 张时返回空串，界面据此决定渲不渲染）。 */
export function thumbnailPendingLabel(count) {
  const pending = Math.max(0, Number(count) || 0);
  return pending ? `正在生成缩略图（${pending} 张）…` : '';
}
