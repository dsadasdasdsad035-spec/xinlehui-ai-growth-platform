// 视频模块的移动端与弱网规则（[第四步 US-224]「视频模块移动端与弱网」）。
//
// 与 `data/reviewStreamPerformance.js`（US-113）/ `data/framingPerformance.js`（US-012）同一套纪律：
// **纯函数 + 常量**，不碰 DOM、不碰网络，可以直接用 Node 跑断言（见 prototype/AGENTS.md 的「验证技巧」）。
// 浏览器侧的执行（全屏 API 包装、播放器盒子测量、逐块溢出测量、可见性恢复）在 `services/videoMobile.js`。
//
// 四条验收各有一份真源，界面与断言读的都是这里：
// 1. **提交后可退出页面甚至锁屏，回到档案页能恢复进度** —— 恢复那一句话
//    （`videoJobVisibilityResumeNote`）+ 「按 jobKey 恢复」的既有判据（`data/videoJobs.js`，
//    不写第二份）；本文件只多一个「回到前台补推进了几次」的读数。
// 2. **手机端播放器占位竖屏自适应并支持全屏** —— 盒子尺寸规则（`videoPlayerBox`，CSS 里是同一套
//    数字：`min(100%, 70vh × 9 / 16)`）、竖屏判定、全屏入口的两句文案与「不支持时说真话」的文案。
// 3. **弱网下重复点击生成不创建多条任务（幂等 jobKey）** —— 结构性保证是「按 jobKey upsert」
//    （`applyVideoJob` / `dedupeVideoJobs`，服务层每次提交都过它）；这里给的是界面那道
//    **提交锁窗**（`VIDEO_JOB_SUBMIT_LOCK_MS`）：窗口内的重复点击直接忽略并计数，
//    锁窗结束时给一句可读回执，因此「同一条 jobKey 只有一条任务」在两层上都成立。
// 4. **390px 宽度下任务卡片与音乐选择面板不溢出** —— 断点、容差、被测量的块清单
//    （`VIDEO_MOBILE_TARGETS`）与逐块判定（`videoOverflowReport`）。
import { VIDEO_JOB_ACTIVE_STATUSES } from './videoJobs';

/** 移动端断点（验收原文就是 390px）：≤ 这个宽度按移动端口径量。 */
export const VIDEO_MOBILE_BREAKPOINT = 390;

/** 布局容差（像素）：`scrollWidth` 与 `clientWidth` 差 1~2px 是亚像素取整，不算溢出。 */
export const VIDEO_MOBILE_LAYOUT_TOLERANCE_PX = 2;

/** 可点区域下限（与全站移动端口径一致：390px 下所有可点区域不小于 44×44）。 */
export const VIDEO_MOBILE_MIN_TOUCH_PX = 44;

/**
 * 提交锁窗（毫秒）：模型的是弱网下「提交请求在飞」的那段时间 —— 真实渲染服务接入后是网络往返，
 * 本机演示队列是同步的，所以这段窗口只做一件事：窗口内的重复点击**直接忽略**（不落到队列上）。
 */
export const VIDEO_JOB_SUBMIT_LOCK_MS = 600;

/** 播放器占位：竖屏 9:16（验收原文）。 */
export const VIDEO_PLAYER_ASPECT = { width: 9, height: 16 };
export const VIDEO_PLAYER_ASPECT_RATIO = VIDEO_PLAYER_ASPECT.width / VIDEO_PLAYER_ASPECT.height;
/** 占位高度上限 = 视口高度 × 这个比例（CSS 里同值：`min(100%, 70vh × 9 / 16)`）。 */
export const VIDEO_PLAYER_VIEWPORT_HEIGHT_RATIO = 0.7;
/** 桌面端的宽度上限（CSS 里同值：`max-width:220px`）。 */
export const VIDEO_PLAYER_DESKTOP_MAX_WIDTH_PX = 220;

// ---------------------------------------------------------------------------
// ① 文案（验收点名的句子只能有一份：界面渲染它，组件不自己写）
// ---------------------------------------------------------------------------

export const VIDEO_MOBILE_SECTION_TITLE = '移动端与弱网';
export const VIDEO_MOBILE_SECTION_DESC = '手机上的四条硬口径：提交后可以退出页面甚至锁屏（回来按 jobKey 接着算）、播放器占位竖屏 9:16 且能全屏、弱网重复点击不会创建多条任务、390px 下任务卡片与音乐面板都不横向溢出。下面每一行都是当场量出来的读数。';

/** 播放器占位比例标签（界面与断言读同一份）。 */
export const VIDEO_PLAYER_RATIO_LABEL = `竖屏 ${VIDEO_PLAYER_ASPECT.width}:${VIDEO_PLAYER_ASPECT.height}`;

export const VIDEO_PLAYER_FULLSCREEN_LABEL = '全屏查看';
export const VIDEO_PLAYER_EXIT_FULLSCREEN_LABEL = '退出全屏';

/** 全屏入口旁边的说明（「占位也能全屏」这件事要说清）。 */
export const VIDEO_PLAYER_FULLSCREEN_NOTE = '占位也能全屏：按钮把这块竖屏 9:16 的占位放进全屏；成片接入后同一个按钮就是全屏播放（系统控件里的全屏走同一条路）。';

/** 不支持全屏时的那句实话（不伪造一个点了没反应的按钮）。 */
export const VIDEO_PLAYER_FULLSCREEN_UNSUPPORTED_TEXT = '这台设备 / 这个浏览器没有全屏接口：占位仍按竖屏 9:16 显示，按钮会如实说明，而不会假装能全屏。';

/** 被锁窗挡下的那次点击的回执（同时点名「没有重复创建」，与幂等那条回执同一口径）。 */
export const VIDEO_JOB_SUBMIT_LOCK_TEXT = `提交中…重复点击已忽略（${VIDEO_JOB_SUBMIT_LOCK_MS}ms 提交锁窗）：同一条 jobKey 只会有一条任务，没有重复创建。`;

/** 锁窗的规则说明（面板上那一行；结构性保证 + 界面那道锁都说清）。 */
export const VIDEO_JOB_SUBMIT_LOCK_NOTE = '弱网下重复点击生成不会创建多条任务：任务键由「类型 + 对象 + 周期」派生（同一个 jobKey 只会有一条任务），提交还有一道锁窗挡住窗口内的重复点击。';

/** 回到前台 / 锁屏解锁后的那一句（`jobs` 是补推进之后的任务清单）。 */
export function videoJobVisibilityResumeNote({ jobs = [] } = {}) {
  const rows = Array.isArray(jobs) ? jobs : [];
  const active = rows.filter(job => VIDEO_JOB_ACTIVE_STATUSES.includes(String(job && job.status))).length;
  const tail = '锁屏 / 切到后台那段时间也算数：进度按真实经过时间接着算，没有重新开始。';
  return active
    ? `回到前台：按真实经过时间补推进一次（还有 ${active} 条在跑）。${tail}`
    : `回到前台：按真实经过时间补推进一次（进行中的任务已结算）。${tail}`;
}

/** 还没有提交过任务时的恢复读数（不编一条「恢复了 0 条」的空话）。 */
export const VIDEO_JOB_RESUME_IDLE_NOTE = '还没有提交过任务：提交后即使退出页面、锁屏，回到档案页也会按 jobKey 把那条任务接回来。';

// ---------------------------------------------------------------------------
// ② 播放器占位盒子（竖屏自适应）
// ---------------------------------------------------------------------------

const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
const round = value => Math.round(num(value) * 100) / 100;

/**
 * 播放器占位的盒子尺寸（**纯函数**，CSS 里是同一套数字）：
 *
 *   width  = min(容器可用宽度, 视口高度 × 70% × 9/16, 宽度上限)
 *   height = width / (9/16)
 *
 * - 桌面：`maxWidth = VIDEO_PLAYER_DESKTOP_MAX_WIDTH_PX`（220px，与 CSS 同值）；
 * - 手机：不传 `maxWidth` → 高度跟着视口走（横屏时它也自动变窄），因此占位**永远是竖屏 9:16**、
 *   且高度不超过视口高度的 70% —— 这就是「竖屏自适应」的判据（`videoPlayerFit`）。
 * - 任何入参缺失 / 脏值都不会抛错（读成 0 → 盒子为 0，由调用方如实显示）。
 */
export function videoPlayerBox({
  viewportWidth = 0,
  viewportHeight = 0,
  containerWidth = 0,
  reservedHeight = 0,
  maxWidth = 0,
  heightRatio = VIDEO_PLAYER_VIEWPORT_HEIGHT_RATIO
} = {}) {
  const vw = Math.max(0, num(viewportWidth));
  const vh = Math.max(0, num(viewportHeight));
  const container = Math.max(0, num(containerWidth) || vw);
  const available = Math.min(container, vw || container);
  const maxHeight = Math.max(0, vh * (num(heightRatio) || VIDEO_PLAYER_VIEWPORT_HEIGHT_RATIO) - Math.max(0, num(reservedHeight)));
  const byHeight = maxHeight * VIDEO_PLAYER_ASPECT_RATIO;
  const cap = num(maxWidth) > 0 ? num(maxWidth) : Infinity;
  const width = Math.max(0, Math.min(available, byHeight, cap));
  const height = width / VIDEO_PLAYER_ASPECT_RATIO;
  return {
    width: round(width),
    height: round(height),
    aspect: VIDEO_PLAYER_ASPECT_RATIO,
    ratioLabel: VIDEO_PLAYER_RATIO_LABEL,
    portrait: VIDEO_PLAYER_ASPECT_RATIO < 1,
    // 是被哪一条约束住的一目了然（读数上会写出来）。
    limitedBy: !available ? 'container' : (width >= available ? 'container' : (width >= byHeight ? 'height' : 'width')),
    byHeight: round(byHeight),
    maxHeight: round(maxHeight),
    available: round(available),
    maxWidth: Number.isFinite(cap) ? cap : 0
  };
}

/**
 * 这个盒子在给定视口里合格吗（**唯一判据**）：
 *  - 宽度不超过容器 / 视口；
 *  - 高度不超过视口高度的 `heightRatio`（默认 70%）；
 *  - 仍然是竖屏（宽 < 高）。
 * 返回 `{ ok, issues:[可读原因], widthPct, heightPct, portrait }`。
 */
export function videoPlayerFit(box, { viewportWidth = 0, viewportHeight = 0, heightRatio = VIDEO_PLAYER_VIEWPORT_HEIGHT_RATIO, tolerance = VIDEO_MOBILE_LAYOUT_TOLERANCE_PX } = {}) {
  const vw = Math.max(0, num(viewportWidth));
  const vh = Math.max(0, num(viewportHeight));
  const width = Math.max(0, num(box && box.width));
  const height = Math.max(0, num(box && box.height));
  const allowed = vh * (num(heightRatio) || VIDEO_PLAYER_VIEWPORT_HEIGHT_RATIO);
  const slack = Math.max(0, num(tolerance));
  const issues = [];
  if (vw > 0 && width > vw + slack) issues.push(`占位宽 ${Math.round(width)}px 超出视口宽 ${Math.round(vw)}px（应为 min(100%, 70vh × 9/16)）`);
  if (allowed > 0 && height > allowed + slack) issues.push(`占位高 ${Math.round(height)}px 超过视口高的 ${Math.round((num(heightRatio) || VIDEO_PLAYER_VIEWPORT_HEIGHT_RATIO) * 100)}%（${Math.round(allowed)}px）`);
  if (height > 0 && width >= height) issues.push(`占位不是竖屏：宽 ${Math.round(width)}px ≥ 高 ${Math.round(height)}px（应为 9:16）`);
  return {
    ok: issues.length === 0,
    issues,
    portrait: height > 0 ? width < height : false,
    widthPct: vw > 0 ? Math.round((width / vw) * 100) : 0,
    heightPct: vh > 0 ? Math.round((height / vh) * 100) : 0
  };
}

// ---------------------------------------------------------------------------
// ③ 390px 溢出测量（被测量的块清单 + 逐块判定）
// ---------------------------------------------------------------------------

/**
 * 要量的块（验收点名两块：任务卡片与音乐选择面板；上下游的几块一起量，免得换个地方又溢出来）。
 * 选择器只写在这一份里，服务层按它去量、断言按同一个 id 读读数。
 */
export const VIDEO_MOBILE_TARGETS = [
  { id: 'page', selector: ':root', label: '页面整体（横向滚动条）', viewport: true },
  { id: 'panel', selector: '[data-video-jobs-panel]', label: '视频任务面板' },
  { id: 'cards', selector: '.video-jobs-list', label: '任务卡片列表' },
  { id: 'card', selector: '.video-job-card', label: '任务卡片' },
  { id: 'music', selector: '.music-selection', label: '音乐选择面板' },
  { id: 'preview', selector: '.video-preview', label: '成片预览面板' },
  { id: 'record', selector: '.video-record', label: '成片版本面板' },
  { id: 'mobile', selector: '.video-mobile', label: '本读数面板' }
];

/**
 * 逐块判定横向溢出（**纯函数**）：`scrollWidth > clientWidth + 容差` 才算溢出。
 *
 * `viewport` 那一块（页面整体）的 `clientWidth` 用视口宽：`html` 的 `clientWidth` 在有些浏览器里
 * 会跟着内容一起变宽，那样「溢出了也判不出来」。
 */
export function videoOverflowReport(rows = [], { viewportWidth = 0, tolerance = VIDEO_MOBILE_LAYOUT_TOLERANCE_PX } = {}) {
  const slack = Math.max(0, num(tolerance));
  const targets = Array.isArray(rows) ? rows : [];
  const measured = targets.map(row => {
    const scrollWidth = Math.max(0, Math.round(num(row && row.scrollWidth)));
    const fallback = Math.max(0, Math.round(num(row && row.rectWidth)));
    const clientWidth = row && row.viewport
      ? Math.max(0, Math.round(num(viewportWidth)))
      : Math.max(0, Math.round(num(row && row.clientWidth)));
    const missing = Boolean(row && row.missing);
    // 缺块（比如还没提交过任务，列表不在页面上）：不算溢出，也不假装量过。
    const overflow = !missing && scrollWidth > clientWidth + slack;
    return {
      id: String((row && row.id) || ''),
      label: String((row && row.label) || ''),
      viewport: Boolean(row && row.viewport),
      missing,
      scrollWidth: missing ? 0 : (scrollWidth || fallback),
      clientWidth: missing ? 0 : clientWidth,
      overflow
    };
  });
  const offenders = measured.filter(row => row.overflow);
  const counted = measured.filter(row => !row.missing);
  return {
    ok: offenders.length === 0,
    rows: measured,
    measuredCount: counted.length,
    offenders: offenders.map(row => row.id),
    offenderText: offenders.map(row => `${row.label}（${row.scrollWidth} > ${row.clientWidth}）`).join('、'),
    state: offenders.length ? 'overflow' : (counted.length ? 'clean' : 'unmeasured'),
    text: offenders.length
      ? `有 ${offenders.length} 块横向溢出：${offenders.map(row => row.label).join('、')}`
      : (counted.length ? `已量 ${counted.length} 块：滚动宽都没有超过客户宽（容差 ${slack}px），没有横向溢出` : '还没有量到任何块')
  };
}

// ---------------------------------------------------------------------------
// ④ 面板视图（四条验收的可读读数；所有状态同形状）
// ---------------------------------------------------------------------------

export const VIDEO_MOBILE_CHECK_IDS = ['viewport', 'overflow', 'player', 'fullscreen', 'weaknet', 'resume'];

/**
 * 「移动端与弱网」面板的视图产物 —— 每一行都是**当场量出来的读数**，不是写死的结论：
 *  - `viewport`：当前视口与断点（390px 那条规则现在是不是在生效口径里）；
 *  - `overflow`：逐块横向溢出测量（`videoOverflowReport` 的产物）；
 *  - `player`：播放器占位盒子的实测尺寸 + 竖屏自适应判定（`videoPlayerFit`）；
 *  - `fullscreen`：全屏接口在这台设备上可不可用（不可用就如实说）；
 *  - `weaknet`：同一条 jobKey 只有一条任务（镜像里的键 vs 界面上的卡片）+ 本次挡下几次重复点击；
 *  - `resume`：本机镜像里有几条任务、本次回到前台补推进了几次（「退出页面 / 锁屏回来接着算」的读数）。
 */
export function videoMobileView({
  viewportWidth = 0,
  viewportHeight = 0,
  overflow = null,
  overflowRows: rawOverflowRows = [],
  player = null,
  playerFit = null,
  fullscreenSupported = false,
  mirrorJobs = [],
  cardKeys = [],
  duplicatesBlocked = 0,
  visibilityResumes = 0,
  resumeNote = ''
} = {}) {
  const vw = Math.max(0, Math.round(num(viewportWidth)));
  const vh = Math.max(0, Math.round(num(viewportHeight)));
  const rows = Array.isArray(mirrorJobs) ? mirrorJobs : [];
  const cards = Array.isArray(cardKeys) ? cardKeys.map(String) : [];
  const keys = rows.map(job => String((job && job.jobKey) || '')).filter(Boolean);
  const uniqueKeys = [...new Set(keys)];
  // `overflow` 传的是**已经算好的报告**（Node 断言直接喂报告）；只给原始测量行时在这里合成报告。
  const overflowView = overflow && Array.isArray(overflow.rows)
    ? overflow
    : videoOverflowReport(rawOverflowRows, { viewportWidth: vw });
  const fit = playerFit || (player ? videoPlayerFit(player, { viewportWidth: vw, viewportHeight: vh }) : { ok: false, issues: ['还没有量到播放器占位'], portrait: false, widthPct: 0, heightPct: 0 });
  const duplicateKeys = keys.length - uniqueKeys.length;
  const cardSet = [...new Set(cards)];
  const allKeysOnScreen = uniqueKeys.every(key => cardSet.includes(key));
  const allCardsTracked = cardSet.every(key => uniqueKeys.includes(key));
  const mobileWidth = vw > 0 && vw <= VIDEO_MOBILE_BREAKPOINT;
  const playerText = player
    ? `${Math.round(num(player.width))}×${Math.round(num(player.height))}px · ${VIDEO_PLAYER_RATIO_LABEL} · 占视口高 ${fit.heightPct}%`
    : '还没有量到（播放器还没渲染）';

  const checks = {
    viewport: {
      label: `视口与断点（≤${VIDEO_MOBILE_BREAKPOINT}px 走移动端口径）`,
      value: `${vw}×${vh}`,
      note: mobileWidth
        ? `当前就是移动端口径：任务卡片单列、音乐面板单列、可点区域 ≥${VIDEO_MOBILE_MIN_TOUCH_PX}px`
        : `当前是桌面口径（>${VIDEO_MOBILE_BREAKPOINT}px）：390px 那条结论要把设备切成 ${VIDEO_MOBILE_BREAKPOINT}px 再量`,
      ok: true
    },
    overflow: {
      label: `任务卡片与音乐面板不横向溢出（容差 ${VIDEO_MOBILE_LAYOUT_TOLERANCE_PX}px）`,
      value: overflowView.text,
      note: overflowView.ok ? '' : overflowView.offenderText,
      ok: overflowView.ok
    },
    player: {
      label: '播放器占位竖屏自适应（9:16，高 ≤70vh）',
      value: playerText,
      note: fit.ok ? VIDEO_PLAYER_FULLSCREEN_NOTE : fit.issues.join('；'),
      ok: Boolean(player) && fit.ok
    },
    fullscreen: {
      label: '全屏入口',
      value: fullscreenSupported ? 'Fullscreen API 在这台设备上可用' : '这台设备 / 浏览器不支持全屏接口',
      note: fullscreenSupported ? `按钮在播放器占位上（${VIDEO_PLAYER_FULLSCREEN_LABEL} / ${VIDEO_PLAYER_EXIT_FULLSCREEN_LABEL}）` : VIDEO_PLAYER_FULLSCREEN_UNSUPPORTED_TEXT,
      ok: true
    },
    weaknet: {
      label: '弱网重复点击不创建多条任务（幂等 jobKey）',
      value: `本机镜像 ${uniqueKeys.length} 条任务 · 界面上 ${cardSet.length} 张卡片 · 同键重复 ${duplicateKeys} 条 · 本次挡下 ${Math.max(0, Math.round(num(duplicatesBlocked)))} 次重复点击`,
      note: VIDEO_JOB_SUBMIT_LOCK_NOTE,
      ok: duplicateKeys === 0 && allKeysOnScreen && allCardsTracked
    },
    resume: {
      label: '提交后可退出页面 / 锁屏回来恢复进度（按 jobKey）',
      value: `本机镜像 ${uniqueKeys.length} 条任务 · 本次回到前台补推进 ${Math.max(0, Math.round(num(visibilityResumes)))} 次`,
      note: resumeNote || (uniqueKeys.length ? '退出页面、锁屏都不影响：回到档案页按 jobKey 把任务接回来，进度按真实经过时间接着算。' : VIDEO_JOB_RESUME_IDLE_NOTE),
      ok: uniqueKeys.length === 0 || (allKeysOnScreen && allCardsTracked)
    }
  };
  const checkRows = VIDEO_MOBILE_CHECK_IDS.map(id => ({ id, ...checks[id] }));
  const failed = checkRows.filter(row => !row.ok);
  return {
    viewportWidth: vw,
    viewportHeight: vh,
    mobileWidth,
    rows: checkRows,
    checks,
    ok: failed.length === 0,
    failedIds: failed.map(row => row.id),
    overflow: overflowView,
    overflowRows: overflowView.rows,
    overflowState: overflowView.state,
    offenders: overflowView.offenders,
    player,
    playerFit: fit,
    fullscreenSupported: Boolean(fullscreenSupported),
    mirrorCount: uniqueKeys.length,
    cardCount: cardSet.length,
    duplicateKeys,
    blocked: Math.max(0, Math.round(num(duplicatesBlocked))),
    visibilityResumes: Math.max(0, Math.round(num(visibilityResumes))),
    summary: failed.length
      ? `移动端与弱网：${failed.length} 项没到口径（${failed.map(row => row.label).join('；')}）`
      : (uniqueKeys.length
        ? '移动端与弱网：六项读数都在口径内（提交可离开页面 / 占位竖屏可全屏 / 弱网不重复建任务 / 390px 不溢出）'
        : '移动端与弱网：布局与全屏读数已在口径内；提交一条任务后这里会多出「可恢复 / 不重复建任务」的实测读数')
  };
}
