// 二维码目标配置（[第二步 US-003c]，PRD FR-23 / 9.5）。
//
// 铁律：**二维码里装什么由后台配置，老师端不可自由填写 URL**（防止把外链印在孩子的作品上）。
// 所以 spec 里的 `watermark.qr.target` 存的是**目标键**而不是 URL —— 本模块是这些键的
// 唯一真源：`normalizeFrameSpecV2` 的白名单收敛、后台面板的目标下拉、渲染时的 URL 解析
// 都读这一份（界面上再抄一遍白名单必然漂移，沿 US-001b 的分层口径）。
//
// 目标可以是「固定页」也可以是「带占位符的模板」（如分享令牌）。占位符没有真实值时
// 用 `QR_TARGET_SAMPLE` 里的示例值解析，并把 `ready: false` 回报给面板 ——
// 界面必须显式说明「这是示例链接」，不能让老师以为印上去的是真地址。
//
// 本模块零依赖（不 import services / 不 import 任何模块），可直接 `node xxx.mjs` 跑断言
// （与 `framingAssets.js` / `mediaValidation.js` 同一个口径）。

/** 分享页 / 机构页的部署地址（与 `cloud.js` 里的原型站点同一个 host）。 */
export const QR_TARGET_BASE_URL = 'https://xinlehui-feedback-prototype.app.workbuddy.host';

/** 默认目标（spec v2 的 `watermark.qr.target` 默认值）。 */
export const QR_TARGET_DEFAULT = 'growth-archive';

/**
 * 后台可配置的目标清单。`template` 里的 `{键}` 由 `resolveQrTargetUrl` 的上下文替换，
 * 上下文里没有的键用 `QR_TARGET_SAMPLE` 兜底并标记为「示例」。
 */
export const QR_TARGETS = [
  {
    key: 'growth-archive',
    label: '学员成长档案分享页',
    description: '家长扫码直接看这位孩子本次课的作品与点评（分享令牌由归档流程生成，撤回后链接失效）。',
    template: `${QR_TARGET_BASE_URL}/p/{shareToken}`
  },
  {
    key: 'org-home',
    label: '机构主页',
    description: '机构对外主页，适合做品牌曝光，不包含孩子的任何素材。',
    template: `${QR_TARGET_BASE_URL}/org/{orgId}`
  },
  {
    key: 'course-intro',
    label: '课程介绍页',
    description: '这门课的介绍与排期，家长可以直接了解后续课程。',
    template: `${QR_TARGET_BASE_URL}/course/{courseId}`
  }
];

/** 目标键清单（顺序即后台下拉顺序，第一项是默认）。 */
export const QR_TARGET_KEYS = QR_TARGETS.map((target) => target.key);

/** 占位符的示例值（没有真实上下文时用它把链接拼完整，并在面板上标注「示例链接」）。 */
export const QR_TARGET_SAMPLE = {
  shareToken: 'demoShareToken',
  orgId: 'org-xinlehui',
  courseId: 'course-creative-painting'
};

/** 键是否在白名单里（老师端填进来的任意 URL 一定不在）。 */
export function isQrTarget(value) {
  return QR_TARGET_KEYS.includes(String(value ?? '').trim());
}

/**
 * 归一化目标键：**白名单之外一律回落默认目标**。
 *
 * 这是 FR-23 在数据层的实现点：`watermark.qr.target` 写成一个外链（`https://evil.example`）
 * 时会被收敛成默认键，渲染层拿不到任何非白名单地址。收敛方向选「回落默认」而不是「置空」，
 * 因为置空会让二维码整块消失（面板上看起来像功能坏了）。
 */
export function normalizeQrTarget(value) {
  const key = String(value ?? '').trim();
  return isQrTarget(key) ? key : QR_TARGET_DEFAULT;
}

/** 按键找目标配置（找不到返回 null）。 */
export function findQrTarget(key) {
  const normalized = normalizeQrTarget(key);
  return QR_TARGETS.find((target) => target.key === normalized) || null;
}

/** 目标的中文名（面板与轨迹文案用）。 */
export function qrTargetLabel(key) {
  return findQrTarget(key)?.label || QR_TARGETS[0].label;
}

/** 模板里的占位符键（按出现顺序去重）。 */
export function qrTargetPlaceholders(key) {
  const target = findQrTarget(key);
  if (!target) return [];
  const found = [];
  for (const match of target.template.matchAll(/\{([^{}]{1,24})\}/g)) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/**
 * 把目标键解析成真正要编码的 URL。
 *
 * 返回 `{ key, label, url, placeholders, missing, ready, sample }`：
 *   - `ready: false` 表示有占位符没有真实值，用的是 `QR_TARGET_SAMPLE` 的示例值
 *     （面板必须据此提示「示例链接」，分享令牌生成后会自动替换）；
 *   - `missing` 列出缺值的占位符键；
 *   - `sample: true` 表示这条 URL 里至少有一个示例值。
 * 永不抛错：键不认识时按默认目标解析。
 */
export function resolveQrTargetUrl(key, context = {}) {
  const target = findQrTarget(key);
  const values = context && typeof context === 'object' ? context : {};
  const placeholders = qrTargetPlaceholders(target.key);
  const missing = [];
  const url = target.template.replace(/\{([^{}]{1,24})\}/g, (whole, name) => {
    const real = values[name];
    if (real === undefined || real === null || String(real).trim() === '') {
      missing.push(name);
      return String(QR_TARGET_SAMPLE[name] ?? name);
    }
    return String(real).trim();
  });
  return {
    key: target.key,
    label: target.label,
    template: target.template,
    url,
    placeholders,
    missing,
    ready: missing.length === 0,
    sample: missing.length > 0
  };
}

/** 面板上的一句话说明（含「示例链接」的口径）。 */
export function qrTargetSummary(key, context = {}) {
  const resolved = resolveQrTargetUrl(key, context);
  const suffix = resolved.ready ? '' : `（${resolved.missing.join(' / ')} 尚未生成，当前为示例链接）`;
  return `${resolved.label}：${resolved.url}${suffix}`;
}

/** 后台配置规则的文案（预览面板上常驻，说明为什么老师不能自己填 URL）。 */
export function qrTargetRulesText() {
  return `二维码内容由平台在装裱模板里统一配置（可选：${QR_TARGETS.map((target) => target.label).join(' / ')}），老师端不能填写任意 URL。`;
}
