// 海报二维码与分享令牌联动（[海报 US-313]）的规则层。
//
// 「海报上的码扫了要真能看到东西；分享撤回了，码也不该还能打开」这件事的**全部判断**在这里
// （零依赖纯函数 + 常量，可 `node` 直跑断言）。四条规则：
//
//  ① **二维码内容 = 分享令牌链接**（`/p/<shareToken>`）：令牌本体由 `data/shareTokens.js` 唯一产出，
//     海报这一侧的 plan 只把链接放进 `qrcode` 占位区的 `value`（渲染层照画，不认第二种码）。
//  ② **没有可用分享时二维码位换成一句文字**（结构上画不出一个空方块），且那句话**按状态分档**：
//         `none`    → 「分享链接待生成」（验收原文；US-303 起就有的口径）
//         `revoked` → 「分享已撤回」    `expired` → 「分享已过期」
//     撤回 / 过期后还写「待生成」就是在骗老师（他会以为只是还没生成，实际是家长打不开了）。
//  ③ **海报内只出现一个二维码**（验收第 4 条）：模板里写了第二个可见二维码位时，只有**第一个**进绘制层，
//     其余置为 `visible:false`。判据（`posterShareQrSpecFacts`）与 `posterSpecIssues` 的「二维码数量」
//     读同一件事，只是这里管的是「画出来几个」。
//  ④ **有效期在预览处如实提示**：二维码本身指向的是同一条令牌（分享有效期变了，码不变），
//     但面板上必须写清「有效期至 …」/「已于 … 过期」—— 读数直接取令牌账的 `expiresText`，
//     本模块不另算一份日期。
//
// 本模块只 import 其它 data 模块（`posterForward` 的「这一张对应哪条记录」唯一出口 + `shareTokens` 的文案常量），
// 不 import 任何 services / React —— 与 `posterSingle.js` 同一口径。

import { posterForwardNames } from './posterForward';
import { SHARE_TOKEN_REGENERATE_LABEL } from './shareTokens';

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const str = (value) => String(value === null || value === undefined ? '' : value).trim();
const count = (value) => {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
};

// ---------------------------------------------------------------------------
// ① 状态与文案（二维码区那几句的唯一真源）
// ---------------------------------------------------------------------------

/** 分享的五种状态（与 `data/shareTokens.js` 的 `SHARE_TOKEN_STATUS` 同一套值，`none` 是「还没有」）。 */
export const POSTER_SHARE_QR_STATES = ['none', 'active', 'expired', 'revoked', 'invalid'];

/**
 * 「这条分享不可用」时二维码位显示的那句话（按状态分档）。
 * `none` 那一句就是验收原文（US-303 的 `POSTER_SINGLE_SHARE_PENDING_TEXT` 也 re-export 它，别在别处再写一遍）。
 */
export const POSTER_SHARE_QR_STATE_TEXTS = {
  none: '分享链接待生成',
  active: '',
  expired: '分享已过期',
  revoked: '分享已撤回',
  invalid: '分享链接待生成'
};

/** 验收原文（AC2）：「尚未生成分享时，二维码区显示『分享链接待生成』」。 */
export const POSTER_SHARE_QR_PENDING_TEXT = POSTER_SHARE_QR_STATE_TEXTS.none;

/** AC2 的动作（验收原文）与面板标题。 */
export const POSTER_SHARE_QR_HEADING = '海报二维码';
export const POSTER_SHARE_QR_GENERATE_LABEL = '先生成分享链接';

/** AC4 的规则句（面板常驻；也是「多出来的二维码位」那条说明的前半句）。 */
export const POSTER_SHARE_QR_SINGLE_RULE = '海报内只出现一个二维码：模板里多余的二维码位一律不绘制（机构公众号 / 招生码要展示时必须另有文字标签区分）。';

/** 撤回 / 过期后二维码同步失效的那句读数（扫码句来自令牌账，不在这里另写）。 */
export const POSTER_SHARE_QR_REVOKED_NOTE = '分享已撤回：二维码同步失效，家长再扫码会看到「该分享已撤回」。';
export const POSTER_SHARE_QR_EXPIRED_NOTE = '分享已过期：二维码同步失效，家长再扫码会看到「该分享已过期」。';
export const POSTER_SHARE_QR_NONE_NOTE = '还没有生成分享链接：先生成一条，二维码会立刻出现在这张海报上（内容就是那条 `/p/<令牌>` 链接）。';
export const POSTER_SHARE_QR_ACTIVE_NOTE = '二维码内容就是这条分享链接：家长扫码打开成长档案；撤回或过期后这个码会同步失效。';

/**
 * 状态归一：认不出的值按「还没有分享」处理（读坏了也不能谎报「可用」）。
 * `state` 与 `active` 同时给时以**两者都成立**为准（`state: 'active'` + `active: false` = 不可用）。
 */
export function posterShareQrState(share) {
  const source = isPlainObject(share) ? share : {};
  const value = str(source.state).toLowerCase();
  if (value === 'active') return source.active === false ? 'none' : 'active';
  if (POSTER_SHARE_QR_STATES.includes(value)) return value;
  return source.active ? 'active' : 'none';
}

/** 二维码位（或面板）该显示的那句话：可用时为空串（画真码，不写占位）。 */
export function posterShareQrPlaceholderText(share) {
  const state = posterShareQrState(share);
  const value = POSTER_SHARE_QR_STATE_TEXTS[state];
  // 注意：`active` 那一档就是空串（可用时写占位就是错的），所以这里不能写 `|| 兜底`。
  return value === undefined ? POSTER_SHARE_QR_STATE_TEXTS.none : value;
}

/** 面板上的状态说明句（三种状态各有各的话，界面不自己 if）。 */
export function posterShareQrStateNote(share) {
  const state = posterShareQrState(share);
  if (state === 'revoked') return POSTER_SHARE_QR_REVOKED_NOTE;
  if (state === 'expired') return POSTER_SHARE_QR_EXPIRED_NOTE;
  if (state === 'active') return POSTER_SHARE_QR_ACTIVE_NOTE;
  return POSTER_SHARE_QR_NONE_NOTE;
}

/** 生成动作的按钮文案：还没有 → 验收原文；已有过一条（撤回 / 过期）→ 归档模块那份「重新生成」。 */
export function posterShareQrGenerateLabel(share) {
  return posterShareQrState(share) === 'none' ? POSTER_SHARE_QR_GENERATE_LABEL : SHARE_TOKEN_REGENERATE_LABEL;
}

// ---------------------------------------------------------------------------
// ② 只画一个二维码（AC4）：模板 spec 里的可见二维码位
// ---------------------------------------------------------------------------

/**
 * 模板 spec 里的二维码读数：`{ visibleCount, keptId, hiddenIds }`。
 * 「保留哪一个」的判据只有一条：**slots 数组里第一个 `visible !== false` 的 `qrcode`**（顺序即作者意图）。
 */
export function posterShareQrSpecFacts(spec) {
  const slots = isPlainObject(spec) && Array.isArray(spec.slots) ? spec.slots : [];
  const visible = slots.filter((slot) => isPlainObject(slot) && slot.type === 'qrcode' && slot.visible !== false);
  return {
    visibleCount: visible.length,
    keptId: visible.length ? str(visible[0].id) : '',
    hiddenIds: visible.slice(1).map((slot) => str(slot.id))
  };
}

/**
 * 收起多余的二维码位：只保留第一个可见的 `qrcode`，其余置为 `visible:false`（不画、不留空白）。
 * 返回 `{ spec, facts }` —— `spec` 是同一个收敛器归一化过的形状（调用方已在收敛之后调它），
 * 非 `qrcode` 的占位区与其它字段**一个字都不改**（与 `posterSingleSpecPatch` 同一条纪律）。
 */
export function posterShareQrGuard(spec) {
  const facts = posterShareQrSpecFacts(spec);
  if (facts.hiddenIds.length === 0) return { spec, facts };
  const hidden = new Set(facts.hiddenIds);
  return {
    spec: {
      ...spec,
      slots: spec.slots.map((slot) => (
        isPlainObject(slot) && slot.type === 'qrcode' && hidden.has(str(slot.id))
          ? { ...slot, visible: false }
          : slot
      ))
    },
    facts
  };
}

/** 多出来的二维码位那条说明（没有多出来的返回空串，调用方据此决定要不要进 notes）。 */
export function posterShareQrExtraNote(facts) {
  const value = isPlainObject(facts) ? facts : {};
  const extra = Math.max(0, Math.trunc(Number(value.visibleCount) || 0) - 1);
  if (!extra) return '';
  const names = (Array.isArray(value.hiddenIds) ? value.hiddenIds : []).filter(Boolean).join(' / ');
  return `${POSTER_SHARE_QR_SINGLE_RULE}这套模板多了 ${extra} 个二维码位${names ? `（${names}）` : ''}：只画第一个，其余不绘制。`;
}

// ---------------------------------------------------------------------------
// ③ plan 的 `share` 段：五个版式共用的唯一装配点
// ---------------------------------------------------------------------------

/**
 * 装配 plan 的 `share` 段（五类版式都走这一支，字段名因此不会各写一套）。
 *
 * 入参是各版式手边就有的事实（令牌账读数 + 这一张的基准 spec），产物既给界面读（`link` / `expiresText` /
 * `stateNote`），也给渲染层读（`placeholderText` 进占位补丁），还给断言读（`qr.*` 的二维码数量读数）。
 * `active` 与 `link` 同时成立才算「可用」—— `shareTokenView` 已经这么判过，这里再兜一次底：
 * 没有链接时绝不让渲染层以为可以画码。
 */
export function posterShareQrShareView({
  state = 'none',
  stateLabel = '',
  active = false,
  tokenText = '',
  link = '',
  path = '',
  expiresText = '',
  daysLeft = 0,
  spec = null
} = {}) {
  const url = str(link);
  const ready = Boolean(active) && Boolean(url);
  const normalized = posterShareQrState({ state, active: ready });
  const facts = posterShareQrSpecFacts(spec);
  return {
    state: ready ? 'active' : normalized,
    stateLabel: str(stateLabel),
    active: ready,
    tokenText: str(tokenText),
    link: url,
    path: str(path),
    expiresText: str(expiresText),
    daysLeft: count(daysLeft),
    pending: !ready,
    placeholderText: ready ? '' : posterShareQrPlaceholderText({ state: normalized }),
    stateNote: posterShareQrStateNote({ state: ready ? 'active' : normalized }),
    qr: {
      visibleCount: facts.visibleCount,
      keptId: facts.keptId,
      hiddenIds: facts.hiddenIds,
      extra: Math.max(0, facts.visibleCount - 1),
      note: posterShareQrExtraNote(facts)
    }
  };
}

// ---------------------------------------------------------------------------
// ④ 面板读数与「先生成分享链接」的目标
// ---------------------------------------------------------------------------

/** 这一张海报的二维码面板整份读数（弹窗只渲染它的产物，不自己 if 状态）。 */
export function posterShareQrFacts(plan = null) {
  const value = isPlainObject(plan) ? plan : null;
  const share = value && isPlainObject(value.share) ? value.share : {};
  const qr = isPlainObject(share.qr) ? share.qr : posterShareQrSpecFacts(value ? value.spec : null);
  const state = posterShareQrState(share);
  const active = Boolean(share.active) && Boolean(str(share.link));
  const target = posterShareQrGenerateTarget(value);
  return {
    plan: Boolean(value),
    kind: value ? str(value.kind) : '',
    state: active ? 'active' : state,
    stateLabel: str(share.stateLabel),
    active,
    pending: !active,
    tokenText: str(share.tokenText),
    link: str(share.link),
    path: str(share.path),
    expiresText: str(share.expiresText),
    daysLeft: count(share.daysLeft),
    placeholderText: active ? '' : posterShareQrPlaceholderText({ state }),
    stateNote: posterShareQrStateNote({ state: active ? 'active' : state }),
    generateLabel: posterShareQrGenerateLabel({ state }),
    qrVisibleCount: count(qr.visibleCount),
    qrKeptId: str(qr.keptId),
    qrHiddenIds: (Array.isArray(qr.hiddenIds) ? qr.hiddenIds : []).map(str).filter(Boolean),
    qrExtra: count(qr.extra),
    qrNote: str(qr.note),
    targetKind: target.targetKind,
    recordId: target.recordId,
    jobKey: target.jobKey
  };
}

/**
 * 「先生成分享链接」要生成的是哪一种令牌：图文（按档案记录）还是成片（按视频任务）。
 * 记录 id 复用 `posterForwardNames(plan).recordId` 这**一个出口**（五类版式的三个字段位置只有它知道）；
 * 成片版式按 `plan.video.jobKey` 走成片分享那一支（`kind:'video'`），不混进图文令牌账。
 */
export function posterShareQrGenerateTarget(plan = null) {
  const value = isPlainObject(plan) ? plan : {};
  if (str(value.kind) === 'video-cover') {
    const video = isPlainObject(value.video) ? value.video : {};
    const type = str(value.type) === 'class' || value.isClass ? 'class' : 'personal';
    return {
      targetKind: 'video',
      recordId: '',
      jobKey: str(video.jobKey),
      type,
      isClass: type === 'class',
      objectName: str(value.objectName),
      className: type === 'class' ? str(value.objectName) : str(value.className),
      period: str(value.period)
    };
  }
  const names = posterForwardNames(value);
  return {
    targetKind: 'record',
    recordId: str(names.recordId),
    jobKey: '',
    type: '',
    isClass: false,
    objectName: str(names.subject),
    className: '',
    period: str(value.period)
  };
}

/** 重绘键里的分享段：状态与链接都算数（撤回 → 过期这种状态变化也要重画，别停在旧图上）。 */
export function posterShareQrPlanKey(share) {
  const source = isPlainObject(share) ? share : {};
  const state = posterShareQrState(source);
  if (state === 'active' && str(source.link)) return `share:${str(source.link)}`;
  return `no-share:${state}`;
}
