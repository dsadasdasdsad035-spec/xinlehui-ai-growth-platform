/**
 * 视频模块移动端与弱网的浏览器侧实现（[第四步 US-224]）。
 *
 * `data/videoMobile.js` 只负责规则（盒子尺寸 / 判定 / 文案，纯函数、可 Node 断言）；
 * 这里做规则之外必须有运行时能力的部分：
 * 1. `videoFullscreenSupported()` / `requestVideoFullscreen()` / `exitVideoFullscreen()` /
 *    `subscribeVideoFullscreen()` —— 全屏 API 的包装（标准 + `webkit` 前缀两条路，两者都没有时
 *    **如实说不支持**，不抛错、也不伪造一个点了没反应的按钮）。
 * 2. `measureVideoPlayerBox()` —— 播放器占位的实测盒子（`getBoundingClientRect`），
 *    交给 data 层的 `videoPlayerFit()` 判定「竖屏 + 高 ≤70vh + 不超视口宽」。
 * 3. `measureVideoOverflow()` —— 按 data 层的 `VIDEO_MOBILE_TARGETS` 逐块量横向溢出
 *    （`scrollWidth` / `clientWidth`；页面整体那一块用视口宽当客户宽）。
 * 4. `attachVideoLayoutWatch()` —— 视口变化（`resize` / `orientationchange`）时通知调用方重量一次。
 *
 * 与 `services/mediaIntake.js` / `services/framingPerformance.js` 同一套约定：任何一步失败都
 * **不抛错**，返回空读数，界面退回「还没有读数」而不是崩掉。
 */
import { VIDEO_MOBILE_TARGETS } from '../data/videoMobile';

function docOf(doc) {
  if (doc) return doc;
  return typeof document !== 'undefined' ? document : null;
}

function winOf(win) {
  if (win) return win;
  return typeof window !== 'undefined' ? window : null;
}

/** 全屏接口在这台设备上可不可用（标准 / webkit 两条路任一条可用即可）。 */
export function videoFullscreenSupported(doc = null) {
  const target = docOf(doc);
  if (!target) return false;
  if (target.fullscreenEnabled) return true;
  return typeof target.webkitFullscreenEnabled === 'boolean' ? target.webkitFullscreenEnabled : false;
}

/** 当前全屏元素（没有 → null；标准与 webkit 两个键都认）。 */
export function videoFullscreenElement(doc = null) {
  const target = docOf(doc);
  if (!target) return null;
  return target.fullscreenElement || target.webkitFullscreenElement || null;
}

/**
 * 订阅全屏状态变化（进入 / 退出都通知；返回取消订阅的函数）。
 * `listener(element|null)`：调用方据此把「退出全屏」按钮与 `data-*` 读数同步过去。
 *
 * **不要把它当成唯一真源**：部分环境（headless Chrome / 无窗口管理器的嵌入式浏览器）在
 * `document.fullscreenElement` 真的变化之后**一个 `fullscreenchange` 事件都不派发**（US-085 实测）。
 * 界面因此必须「按动作结果乐观同步 + 每次测量时拿 DOM 的真实值对一次账」，这里的事件只负责
 * 带外变化（Esc 退出 / 系统控件全屏 / 页面里直接调 API）。
 */
export function subscribeVideoFullscreen(listener, doc = null) {
  const target = docOf(doc);
  if (!target || typeof listener !== 'function' || typeof target.addEventListener !== 'function') return () => {};
  const handler = () => listener(videoFullscreenElement(target));
  target.addEventListener('fullscreenchange', handler);
  target.addEventListener('webkitfullscreenchange', handler);
  return () => {
    target.removeEventListener('fullscreenchange', handler);
    target.removeEventListener('webkitfullscreenchange', handler);
  };
}

/**
 * 进入全屏（返回 `{ ok, mode, issue }`；`mode` = `standard` / `webkit` / `unsupported`）。
 *
 * 约定的两件事：
 *  - 元素上两条路都试（有些浏览器只挂了 `webkitRequestFullscreen`）；
 *  - 失败（被拒 / 接口缺失 / 抛错）时返回**可读原因**，由界面照原样显示 —— 调用方不许自己编文案。
 */
export async function requestVideoFullscreen(element, doc = null) {
  const target = docOf(doc);
  if (!element) return { ok: false, mode: 'missing', issue: '还没有播放器占位可以全屏（元素不在页面上）。' };
  const standard = typeof element.requestFullscreen === 'function';
  const webkit = typeof element.webkitRequestFullscreen === 'function';
  if (!standard && !webkit) {
    return { ok: false, mode: 'unsupported', issue: '这台设备 / 这个浏览器没有全屏接口：占位仍按竖屏 9:16 显示。' };
  }
  try {
    if (standard) await element.requestFullscreen();
    else element.webkitRequestFullscreen();
    return { ok: true, mode: standard ? 'standard' : 'webkit', issue: '' };
  } catch (error) {
    const detail = (error && (error.message || error.name)) || '浏览器拒绝了这次全屏请求';
    return { ok: false, mode: standard ? 'standard' : 'webkit', issue: `进入全屏失败（${detail}）：可以直接用系统控件放大，或稍后再试。` };
  }
}

/** 退出全屏（返回 `{ ok, mode, issue }`）。 */
export async function exitVideoFullscreen(doc = null) {
  const target = docOf(doc);
  if (!target) return { ok: false, mode: 'unsupported', issue: '没有可用的全屏接口。' };
  const standard = typeof target.exitFullscreen === 'function';
  const webkit = typeof target.webkitExitFullscreen === 'function';
  if (!standard && !webkit) return { ok: false, mode: 'unsupported', issue: '这台设备 / 这个浏览器没有全屏接口。' };
  try {
    if (standard) await target.exitFullscreen();
    else target.webkitExitFullscreen();
    return { ok: true, mode: standard ? 'standard' : 'webkit', issue: '' };
  } catch (error) {
    const detail = (error && (error.message || error.name)) || '浏览器拒绝了这次退出全屏';
    return { ok: false, mode: standard ? 'standard' : 'webkit', issue: `退出全屏失败（${detail}）。` };
  }
}

/** 播放器占位的实测盒子（元素不在页面上 → null）。 */
export function measureVideoPlayerBox(element, win = null) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return null;
  const target = winOf(win);
  const rect = element.getBoundingClientRect();
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    viewportWidth: target ? Math.round(target.innerWidth) : 0,
    viewportHeight: target ? Math.round(target.innerHeight) : 0,
    fullscreen: Boolean(element === videoFullscreenElement(element.ownerDocument || docOf(null)))
  };
}

/**
 * 逐块量横向溢出（按 `VIDEO_MOBILE_TARGETS`）。
 * 返回的行是 data 层 `videoOverflowReport()` 的入参形状：`{id,label,scrollWidth,clientWidth,rectWidth,viewport,missing}`。
 * 页面整体那一块（`viewport:true`）只给 `scrollWidth`（`<html>` 的滚动宽），客户宽交给判定函数用视口宽。
 */
export function measureVideoOverflow(targets = VIDEO_MOBILE_TARGETS, { doc = null, win = null } = {}) {
  const target = docOf(doc);
  const view = winOf(win);
  const list = Array.isArray(targets) ? targets : [];
  if (!target) return [];
  return list.map(entry => {
    const selector = String((entry && entry.selector) || '');
    const element = selector === ':root' ? target.documentElement : (selector ? target.querySelector(selector) : null);
    if (!element) {
      return { id: String((entry && entry.id) || ''), label: String((entry && entry.label) || ''), viewport: Boolean(entry && entry.viewport), missing: true, scrollWidth: 0, clientWidth: 0, rectWidth: 0 };
    }
    const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
    return {
      id: String((entry && entry.id) || ''),
      label: String((entry && entry.label) || ''),
      viewport: Boolean(entry && entry.viewport),
      missing: false,
      scrollWidth: Math.round(element.scrollWidth || 0),
      clientWidth: Math.round(element.clientWidth || 0),
      rectWidth: rect ? Math.round(rect.width) : 0,
      viewportWidth: view ? Math.round(view.innerWidth) : 0
    };
  });
}

/** 视口变化（resize / 转屏）时通知调用方重量一次；返回取消订阅的函数。 */
export function attachVideoLayoutWatch(onChange, { win = null, doc = null } = {}) {
  const view = winOf(win);
  const target = docOf(doc);
  if (!view || typeof onChange !== 'function' || typeof view.addEventListener !== 'function') return () => {};
  const handler = () => onChange();
  view.addEventListener('resize', handler);
  view.addEventListener('orientationchange', handler);
  return () => {
    view.removeEventListener('resize', handler);
    view.removeEventListener('orientationchange', handler);
  };
}
