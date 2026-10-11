/**
 * 儿童素材上传的**受控通道**（[第二步 US-013] / FR-46）。
 *
 * 规则在 `data/mediaStoragePolicy.js`（零依赖纯函数）；这里做规则之外必须有网络能力的部分：
 *   1. `childMediaUploadHeaders`：**带鉴权** —— 老师身份 + 监护人授权两件齐了才给头，
 *      缺一件直接抛错（不发请求）。原来这份头是写死的常量，谁调都带；
 *   2. `assertChildMediaStorage`：复核服务端声明的存储落点 —— 落点是本地磁盘 / 公开地址 /
 *      没登记的值，一律按「不合格」抛错（宁可不收素材，也不把儿童素材落到不该落的地方）；
 *   3. `probeChildMediaSink`：探测开发适配器（`GET /health` 的 `storage` 字段），
 *      给「合规」面板一个真实读数；探测失败不抛错，如实回报「未连接」。
 *
 * 上传接口本身（`services/reviewApi.js`）只做编排：头从这里取、响应的落点从这里复核。
 */

import {
  CHILD_MEDIA_API_BASE,
  CHILD_MEDIA_UPLOAD_AUTH,
  childMediaStorageIssue,
  childMediaStorageLabel,
  childMediaStorageSink,
  childMediaUploadAuthIssue
} from '../data/mediaStoragePolicy';

export { CHILD_MEDIA_API_BASE };

/** 受控通道的错误（带状态码，与「服务端 403」同口径）。 */
export class ChildMediaStorageError extends Error {
  constructor(message, { status = 403, code = 'child-media-storage' } = {}) {
    super(message);
    this.name = 'ChildMediaStorageError';
    this.status = status;
    this.code = code;
  }
}

/**
 * 上传头：带鉴权的那两个头由这里统一给出。
 * 缺身份或授权时**抛错**（调用方按「未连接 / 未授权」处理，绝不静默降级成不带鉴权的请求）。
 */
export function childMediaUploadHeaders({ role = CHILD_MEDIA_UPLOAD_AUTH.requiredRole, consent = CHILD_MEDIA_UPLOAD_AUTH.requiredConsent, extra = {} } = {}) {
  const issue = childMediaUploadAuthIssue({ role, consent });
  if (issue) throw new ChildMediaStorageError(issue, { status: 403, code: 'child-media-auth' });
  return {
    [CHILD_MEDIA_UPLOAD_AUTH.roleHeader]: role,
    [CHILD_MEDIA_UPLOAD_AUTH.consentHeader]: consent,
    ...extra
  };
}

/** 服务端响应里声明的落点（`storage` 字段；没有就返回空串，不猜）。 */
export function childMediaStorageFromResponse(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const id = String(source.storage || source.storageSink || '').trim();
  const sink = childMediaStorageSink(id);
  return {
    id,
    ok: Boolean(sink && sink.allowed),
    label: childMediaStorageLabel(id),
    sinkId: sink ? sink.id : '',
    issue: childMediaStorageIssue(id)
  };
}

/** 复核服务端声明的落点：不合格抛错（把落点与原因一起带出去）。 */
export function assertChildMediaStorage(payload = {}) {
  const declared = childMediaStorageFromResponse(payload);
  if (!declared.ok) {
    throw new ChildMediaStorageError(`儿童素材的上传落点不合格：${declared.issue}`, { status: 502, code: 'child-media-sink' });
  }
  return declared;
}

/**
 * 探测开发适配器声明的存储落点（合规面板的实时读数）。
 * **永不抛错**：服务未启动、超时、返回体不是 JSON 都回报 `ok:false` 与可读原因。
 */
export async function probeChildMediaSink({ baseUrl = CHILD_MEDIA_API_BASE, timeoutMs = 1500 } = {}) {
  const checkedAt = new Date().toISOString();
  if (typeof fetch !== 'function') {
    return { ok: false, reachable: false, sinkId: '', sinkLabel: '', declared: '', note: '当前环境没有 fetch，无法探测开发适配器。', checkedAt };
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: controller ? controller.signal : undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, reachable: true, sinkId: '', sinkLabel: '', declared: '', note: `开发适配器返回 ${response.status}。`, checkedAt };
    }
    const declared = childMediaStorageFromResponse(payload);
    return {
      ok: declared.ok,
      reachable: true,
      sinkId: declared.sinkId,
      sinkLabel: declared.label,
      declared: declared.id,
      note: declared.ok ? '开发适配器声明的落点合格：素材只在内存里，不落本地磁盘。' : declared.issue,
      checkedAt
    };
  } catch (error) {
    const reason = String(error?.name === 'AbortError' ? '探测超时' : (error?.message || '连接失败'));
    return { ok: false, reachable: false, sinkId: '', sinkLabel: '', declared: '', note: `开发适配器未连接（${reason}）：启动 pnpm run dev:api 后可复核，未连接时上传会如实降级为「仅本地预览」。`, checkedAt };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
