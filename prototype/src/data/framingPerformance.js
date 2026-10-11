/**
 * 第二步「智能装裱」的移动端与性能规则（US-012「装裱移动端与合成性能」）。
 *
 * 与 `data/intakePerformance.js` 同一套纪律：**纯函数 + 常量**，不碰 DOM、不碰网络，
 * 可以直接用 Node 跑断言（见 prototype/AGENTS.md 的「验证技巧」一节）。
 * 浏览器侧的执行（合成计时、编辑底图降采样、帧率采样、内存采样）在 `services/framingPerformance.js`。
 *
 * 这里放五件事，每一件都只有一份真源：
 * 1. 手机口径 `framingDeviceProfile()`（手机 UA / 触摸窄屏 / ≤430px 抽屉断点，任一命中即算手机）；
 * 2. 1800px 合成预算 `FRAMING_COMPOSE_BUDGET_MS`（桌面 800ms / 手机 1.5s）；
 * 3. 编辑底图 `EDIT_BASE_MAX_EDGE`（2400）与加载显示预算 `EDIT_BASE_LOAD_BUDGET_MS`（2s）；
 * 4. 编辑拖动帧率下限 `EDIT_DRAG_MIN_FPS`（30fps）；
 * 5. 内存占用峰值上限 `FRAMING_MEMORY_BUDGET_MB`（300MB）。
 *
 * 界面上那块「装裱性能」读数、浏览器断言与 Node 断言读的都是 `framingPerformanceChecks()`
 * 的同一份结论 —— 不要在面板或脚本里各写一遍「多少算超标」。
 */
import { downsamplePlan } from './mediaValidation.js';

/** 验收使用的手机宽度（390px）。 */
export const MOBILE_STUDIO_WIDTH = 390;

/** 抽屉化断点：≤430px 时第二步的编辑器 / 相框 / 水印 / 保存全部走底部抽屉（CSS 里同值，改一处要同步另一处）。 */
export const STUDIO_DRAWER_MAX_WIDTH = 430;

/** 手机口径的视口上限（触摸屏 + 不超过这个宽度也算手机，即使 UA 是桌面 UA）。 */
export const MOBILE_PROFILE_MAX_WIDTH = 800;

/** 1800px 合成耗时预算（验收原文：桌面不超过 800ms、手机不超过 1.5 秒）。 */
export const FRAMING_COMPOSE_BUDGET_MS = { desktop: 800, mobile: 1500 };

/** 手机原图**先降采样到长边 2400 再编辑**（编辑底图的上限）。 */
export const EDIT_BASE_MAX_EDGE = 2400;

/** 「4000x3000 手机原图加载并显示」的时限（2 秒）：解码 + 降采样 + 编码 + 底图可显示的合计。 */
export const EDIT_BASE_LOAD_BUDGET_MS = 2000;

/** 编辑拖动（裁剪框 / 缩放平移）的帧率下限：不低于 30fps。 */
export const EDIT_DRAG_MIN_FPS = 30;

/** 内存占用峰值上限：不超过 300MB。 */
export const FRAMING_MEMORY_BUDGET_MB = 300;

/** 四项性能检查的清单（界面顺序、断言钩子 id 都读它）。 */
export const FRAMING_PERF_CHECK_IDS = ['compose', 'edit-base', 'drag-fps', 'memory'];

export const FRAMING_PERF_CHECK_LABELS = {
  compose: '1800px 合成耗时',
  'edit-base': '原图加载与显示',
  'drag-fps': '编辑拖动帧率',
  memory: '内存占用峰值'
};

/** 第二步的四个底部抽屉（390px 验收：编辑 / 选框 / 调水印 / 保存全在抽屉里完成）。 */
export const STUDIO_DRAWERS = [
  { id: 'editor', label: '编辑作品', hint: '旋转 / 微调 / 裁剪 / 缩放平移 / 撤销重做' },
  { id: 'frame', label: '相框样式', hint: '缩略图用当前作品实时渲染' },
  { id: 'overlay', label: '水印 · 落款 · 时间', hint: '三区共用九宫格定位' },
  { id: 'save', label: '保存图片', hint: '高清 PNG / 微信 JPG 两档' }
];

/** 手机 UA 的正则：命中即按手机口径（微信内置浏览器也算手机）。 */
const MOBILE_UA_PATTERN = /(iPhone|iPod|iPad|Android|Mobile|Windows Phone|MicroMessenger|HarmonyOS)/i;

/**
 * 设备口径（合成预算按它取桌面 / 手机两档）。
 *
 * 三条判据任一命中即算手机：① 手机 UA；② 触摸屏 + 视口 ≤ 800px；③ 视口 ≤ 430px（抽屉断点）。
 * 第 ③ 条让「脚本把视口切到 390px」这种场景也走手机预算 —— 抽屉已经按视口切了，
 * 预算不跟着切就会出现「手机上按桌面预算验收」的错位。任一判据的命中理由都会带出去给界面显示。
 */
export function framingDeviceProfile({ userAgent = '', maxTouchPoints = 0, viewportWidth = 0 } = {}) {
  const ua = String(userAgent || '');
  const touch = Number(maxTouchPoints) || 0;
  const width = Number(viewportWidth) || 0;
  const reasons = [];
  if (MOBILE_UA_PATTERN.test(ua)) reasons.push('手机 UA');
  if (touch > 0 && width > 0 && width <= MOBILE_PROFILE_MAX_WIDTH) reasons.push(`触摸屏 + 视口 ${width}px ≤ ${MOBILE_PROFILE_MAX_WIDTH}px`);
  if (width > 0 && width <= STUDIO_DRAWER_MAX_WIDTH) reasons.push(`视口 ${width}px ≤ ${STUDIO_DRAWER_MAX_WIDTH}px（抽屉断点）`);
  const id = reasons.length ? 'mobile' : 'desktop';
  return {
    id,
    label: id === 'mobile' ? '手机' : '桌面',
    mobile: id === 'mobile',
    reasons,
    viewportWidth: width,
    touch,
    budgetMs: FRAMING_COMPOSE_BUDGET_MS[id]
  };
}

/** 合成预算（传 profile 对象或 'desktop' / 'mobile' 都行，认不出的按桌面算）。 */
export function framingComposeBudgetMs(profile) {
  const id = typeof profile === 'string' ? profile : profile?.id;
  return FRAMING_COMPOSE_BUDGET_MS[id] || FRAMING_COMPOSE_BUDGET_MS.desktop;
}

/**
 * 编辑底图的降采样方案：长边超过 `maxEdge`（2400）才降采样，否则**原样使用**（不重新编码）。
 * 实际绘制在 `services/framingPerformance.js` 的 `prepareEditBase()`，两边共用这一个纯函数判据。
 */
export function editBasePlan(width, height, maxEdge = EDIT_BASE_MAX_EDGE) {
  const limit = Number(maxEdge) > 0 ? Number(maxEdge) : EDIT_BASE_MAX_EDGE;
  const plan = downsamplePlan(width, height, limit);
  return {
    ...plan,
    maxEdge: limit,
    sourceLongEdge: Math.max(Number(width) || 0, Number(height) || 0),
    sourceWidth: Number(width) || 0,
    sourceHeight: Number(height) || 0
  };
}

/** 毫秒的可读说法：320ms / 1.1s（小于 1 秒不带小数点，读起来更像仪表盘）。 */
export function formatPerfMs(ms) {
  const value = Math.max(0, Number(ms) || 0);
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

/** 1800px 合成耗时的结论（`ms` 为实测值，`budgetMs` 缺省按设备口径取预算）。 */
export function evaluateComposeTiming({ ms, budgetMs, profile } = {}) {
  const value = Math.max(0, Number(ms) || 0);
  const deviceId = typeof profile === 'string' ? profile : profile?.id;
  const budget = Number(budgetMs) > 0 ? Number(budgetMs) : framingComposeBudgetMs(profile);
  const ok = value <= budget;
  // 结论文案要写明「按哪个口径判的」：同一份耗时在桌面预算下可能超标、在手机预算下达标。
  const deviceLabel = (typeof profile === 'object' && profile?.label) ? profile.label : (deviceId === 'mobile' ? '手机' : (deviceId === 'desktop' ? '桌面' : ''));
  return {
    id: 'compose',
    ok,
    ms: Math.round(value),
    budgetMs: budget,
    device: deviceId || '',
    value: `${Math.round(value)}ms`,
    budget: `${budget}ms`,
    text: `1800px 合成 ${Math.round(value)}ms（预算 ${budget}ms${deviceLabel ? ` · ${deviceLabel}` : ''}，${ok ? '达标' : '超标'}）`
  };
}

/**
 * 「手机原图加载并显示」的结论。`plan` 为 `editBasePlan()` 的产物（有降采样时写明从多少降到多少）。
 * `ms` 是「解码原图 + 降采样 + 编码底图 + 底图可显示」的合计耗时（`prepareEditBase` 量出来的）。
 */
export function evaluateEditBase({ ms, plan } = {}) {
  const value = Math.max(0, Number(ms) || 0);
  const budget = EDIT_BASE_LOAD_BUDGET_MS;
  const ok = value <= budget;
  const source = plan ? `${plan.sourceWidth}×${plan.sourceHeight}` : '';
  const target = plan ? `${plan.width}×${plan.height}` : '';
  const detail = plan && plan.needed ? `${source} → ${target}` : `${source || target || '原图'}（未超 ${EDIT_BASE_MAX_EDGE}px，直接用原图）`;
  return {
    id: 'edit-base',
    ok,
    ms: Math.round(value),
    budgetMs: budget,
    value: formatPerfMs(value),
    budget: formatPerfMs(budget),
    detail,
    text: `编辑底图 ${detail} · 加载与显示 ${formatPerfMs(value)}（预算 ${formatPerfMs(budget)}，${ok ? '达标' : '超标'}）`
  };
}

/**
 * 拖动帧率的结论：`frames` 太少（< 4）时不给结论（`ok: null`）——
 * 一次两帧的采样算出来的「500fps」没有任何意义，不能拿来当达标证据。
 */
export function evaluateDragFps({ fps, frames } = {}) {
  const count = Math.max(0, Number(frames) || 0);
  const value = Math.max(0, Number(fps) || 0);
  if (count < 4) {
    return {
      id: 'drag-fps',
      ok: null,
      fps: Math.round(value),
      frames: count,
      minFps: EDIT_DRAG_MIN_FPS,
      value: '',
      budget: `${EDIT_DRAG_MIN_FPS}fps`,
      text: '编辑拖动帧率：还没量到足够长的拖动'
    };
  }
  const ok = value >= EDIT_DRAG_MIN_FPS;
  return {
    id: 'drag-fps',
    ok,
    fps: Math.round(value),
    frames: count,
    minFps: EDIT_DRAG_MIN_FPS,
    value: `${Math.round(value)}fps`,
    budget: `${EDIT_DRAG_MIN_FPS}fps`,
    text: `编辑拖动 ${Math.round(value)}fps（不低于 ${EDIT_DRAG_MIN_FPS}fps，${ok ? '达标' : '未达标'}）`
  };
}

/** 内存峰值的结论（`bytes` 为 usedJSHeapSize 的峰值；不支持 precise memory 的环境给 `supported:false`）。 */
export function evaluateMemoryPeak({ bytes, supported = true } = {}) {
  if (!supported || !(Number(bytes) > 0)) {
    return {
      id: 'memory',
      ok: null,
      mb: 0,
      budgetMb: FRAMING_MEMORY_BUDGET_MB,
      value: '',
      budget: `${FRAMING_MEMORY_BUDGET_MB}MB`,
      supported: false,
      text: '内存占用峰值：本机浏览器未提供 performance.memory'
    };
  }
  const mb = Number(bytes) / (1024 * 1024);
  const ok = mb <= FRAMING_MEMORY_BUDGET_MB;
  return {
    id: 'memory',
    ok,
    mb: Math.round(mb),
    budgetMb: FRAMING_MEMORY_BUDGET_MB,
    value: `${Math.round(mb)}MB`,
    budget: `${FRAMING_MEMORY_BUDGET_MB}MB`,
    supported: true,
    text: `内存占用峰值 ${Math.round(mb)}MB（上限 ${FRAMING_MEMORY_BUDGET_MB}MB，${ok ? '达标' : '超标'}）`
  };
}

/**
 * 四项性能检查的汇总（界面读数与断言读同一份）。
 * 每行 `{ id, label, ok, value, budget, text }`：`ok === null` 表示「还没测到」（pending），
 * 界面据此显示灰字，而不是把「没测」当成「达标」。
 */
export function framingPerformanceChecks({ profile, compose, editBase, dragFps, memory } = {}) {
  const device = profile && typeof profile === 'object' ? profile : framingDeviceProfile(profile || {});
  const rows = [];
  const push = (id, label, row) => rows.push({ id, label, ok: row.ok, value: row.value, budget: row.budget, text: row.text, detail: row.detail || '' });
  push('compose', FRAMING_PERF_CHECK_LABELS.compose, compose
    ? evaluateComposeTiming({ ...compose, profile: device })
    : { ok: null, value: '', budget: `${framingComposeBudgetMs(device)}ms`, text: `1800px 合成：等待第一次合成（预算 ${framingComposeBudgetMs(device)}ms · ${device.label}）` });
  push('edit-base', FRAMING_PERF_CHECK_LABELS['edit-base'], editBase
    ? evaluateEditBase(editBase)
    : { ok: null, value: '', budget: formatPerfMs(EDIT_BASE_LOAD_BUDGET_MS), text: `原图加载与显示：打开「编辑作品」后测量（先降采样到长边 ${EDIT_BASE_MAX_EDGE}px，预算 ${formatPerfMs(EDIT_BASE_LOAD_BUDGET_MS)}）` });
  push('drag-fps', FRAMING_PERF_CHECK_LABELS['drag-fps'], dragFps
    ? evaluateDragFps(dragFps)
    : { ok: null, value: '', budget: `${EDIT_DRAG_MIN_FPS}fps`, text: `编辑拖动帧率：拖动裁剪框或画面后测量（不低于 ${EDIT_DRAG_MIN_FPS}fps）` });
  push('memory', FRAMING_PERF_CHECK_LABELS.memory, memory
    ? evaluateMemoryPeak(memory)
    : { ok: null, value: '', budget: `${FRAMING_MEMORY_BUDGET_MB}MB`, text: `内存占用峰值：进入第二步后持续采样（上限 ${FRAMING_MEMORY_BUDGET_MB}MB）` });
  const measured = rows.filter(row => row.ok !== null);
  return {
    profile: device,
    rows,
    measured: measured.length,
    total: rows.length,
    allOk: measured.length === rows.length && measured.every(row => row.ok),
    summary: measured.length === rows.length
      ? `四项性能检查${measured.every(row => row.ok) ? '全部达标' : '有超标项'}`
      : `性能检查已测 ${measured.length}/${rows.length} 项`
  };
}

/** 抽屉的可读说明（触发按钮上的小字）。 */
export function studioDrawerLabel(id) {
  return STUDIO_DRAWERS.find(item => item.id === id)?.label || '';
}
