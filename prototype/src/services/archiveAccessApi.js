// 归档访问的服务端通道（[第四步 US-211] / F-ARCHIVE-PERM-01）。
//
// 三件事（都走开发适配器 `http://127.0.0.1:8787`，与素材 / 轨迹同一套通道）：
//  ① `GET /api/compliance/archive-policy`：服务端**声明**归档的保留期默认与访问规则
//     （客户端拿它对表：默认保留期是否与平台隐私策略一致、分享链接失效规则是否被声明）；
//  ② `POST /api/archive/share-access`：**服务端强制校验**一次访问 —— 老师是否只能访问自己班级、
//     家长是否只能看自己孩子（按监护人手机号匹配的会话）、授权是否已撤回。
//     家长的记录列表还有另一条服务端路径（`/api/parent/feedback-records`，按会话里的孩子名过滤）；
//     这一条是分享链接 / 转发动作的那道闸门，前端隐藏不算数。
//  ③ `GET/PUT /api/archive/consents`：授权状态落到服务端（撤回之后服务端就知道这条链接要失效）。
//
// 与 `services/reviewTraceApi.js` 同一套写法：超时 / 连不上返回 `{ok:false, status:0}`，
// **永不抛错**（家长页、转发面板都不该因为巡检通道没开而崩）；HTTP 403 单独报出来（`denied`）。

import { CHILD_MEDIA_API_BASE } from './mediaStorage';

/** 服务端归档策略（与儿童素材策略同一个端点的 `archive` 段）。 */
export async function fetchRemoteArchivePolicy({ baseUrl = CHILD_MEDIA_API_BASE, timeoutMs = 2500 } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${baseUrl}/api/compliance/archive-policy`, { signal: controller ? controller.signal : undefined });
    if (!response.ok) return { ok: false, status: response.status, policy: null, message: `服务端返回 ${response.status}` };
    const payload = await response.json();
    return { ok: true, status: response.status, policy: payload && typeof payload === 'object' ? payload : null, message: '' };
  } catch (error) {
    return { ok: false, status: 0, policy: null, message: `归档策略未取到：${String((error && error.message) || error || '网络不可用')}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 服务端访问判定（唯一权威）：`{student, className, token, action, page}` +
 * 身份头（`X-Actor-Role` / `X-Actor-Id`）+ 可选的家长会话令牌（`Authorization: Bearer …`）。
 * 返回 `{ok, status, allowed, reason, scope, denied, message}` —— 403 时 `denied: true`。
 *
 * `page: 'share-link'` 是家长分享页那条路径：没有身份时服务端按「链接即凭据」放行只读查看
 * （授权撤回仍然拦下），有家长会话时按监护人手机号匹配的范围判 —— 前端隐藏不算数。
 */
export async function queryRemoteArchiveAccess({ student = '', className = '', token = '', action = 'forward', page = '', role = '', actorId = '', parentSession = '', baseUrl = CHILD_MEDIA_API_BASE, timeoutMs = 2500 } = {}) {
  const idValue = String(actorId || '');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const headers = { 'Content-Type': 'application/json' };
  if (role) headers['X-Actor-Role'] = String(role);
  if (idValue) {
    // 身份串可能是中文姓名：头里只安全承载 ASCII，所以按 `reviewTraceApi` 同一口径做百分号编码。
    try { headers['X-Actor-Id'] = encodeURIComponent(idValue); } catch { headers['X-Actor-Id'] = idValue; }
  }
  if (parentSession) headers.Authorization = `Bearer ${parentSession}`;
  try {
    const response = await fetch(`${baseUrl}/api/archive/share-access`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ student: String(student || ''), className: String(className || ''), token: String(token || ''), action: String(action || ''), page: String(page || '') }),
      signal: controller ? controller.signal : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 403) {
      return { ok: false, status: 403, allowed: false, denied: true, reason: String(payload.error || '服务端拒绝了这次访问。'), scope: '', message: String(payload.error || '服务端拒绝了这次访问。') };
    }
    if (!response.ok) return { ok: false, status: response.status, allowed: null, denied: false, reason: '', scope: '', message: `服务端返回 ${response.status}` };
    return {
      ok: true,
      status: response.status,
      allowed: payload.allowed !== false,
      denied: false,
      reason: String(payload.reason || ''),
      scope: String(payload.scope || ''),
      message: ''
    };
  } catch (error) {
    return { ok: false, status: 0, allowed: null, denied: false, reason: '', scope: '', message: `服务端校验未完成：${String((error && error.message) || error || '网络不可用')}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 授权状态落到服务端（撤回之后服务端就知道这条链接要失效）。返回 `{ok, status, message}`。 */
export async function saveRemoteArchiveConsents(consents, { role = 'teacher', actorId = '', baseUrl = CHILD_MEDIA_API_BASE, timeoutMs = 2500 } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const headers = { 'Content-Type': 'application/json', 'X-Actor-Role': String(role || '') };
  if (actorId) {
    try { headers['X-Actor-Id'] = encodeURIComponent(String(actorId)); } catch { headers['X-Actor-Id'] = String(actorId); }
  }
  try {
    const response = await fetch(`${baseUrl}/api/archive/consents`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ consents: Array.isArray(consents) ? consents : [] }),
      signal: controller ? controller.signal : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status, message: `服务端返回 ${response.status}` };
    return { ok: true, status: response.status, message: '', consents: Array.isArray(payload.consents) ? payload.consents : [] };
  } catch (error) {
    return { ok: false, status: 0, message: `授权状态未同步到服务端：${String((error && error.message) || error || '网络不可用')}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 读服务端上的授权状态（巡检 / 对表用；表没数据时返回空列表）。 */
export async function loadRemoteArchiveConsents({ role = 'teacher', actorId = '', baseUrl = CHILD_MEDIA_API_BASE, timeoutMs = 2500 } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const headers = {};
  if (role) headers['X-Actor-Role'] = String(role);
  if (actorId) {
    try { headers['X-Actor-Id'] = encodeURIComponent(String(actorId)); } catch { headers['X-Actor-Id'] = String(actorId); }
  }
  try {
    const response = await fetch(`${baseUrl}/api/archive/consents`, { headers, signal: controller ? controller.signal : undefined });
    if (!response.ok) return { ok: false, status: response.status, consents: [], message: `服务端返回 ${response.status}` };
    const payload = await response.json();
    return { ok: true, status: response.status, consents: Array.isArray(payload.consents) ? payload.consents : [], message: '' };
  } catch (error) {
    return { ok: false, status: 0, consents: [], message: `服务端授权状态未取到：${String((error && error.message) || error || '网络不可用')}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
