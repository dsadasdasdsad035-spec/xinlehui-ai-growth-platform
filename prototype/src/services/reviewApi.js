import { CHILD_MEDIA_API_BASE, assertChildMediaStorage, childMediaUploadHeaders } from './mediaStorage';

// 受控调用通道（与 dev 适配器 `server/index.mjs` 成对）。
//
// [第二步 US-013] 起这里的「受控」二字是**强制**的，不再只是约定：
//   - 鉴权头（老师身份 + 监护人授权）由 `childMediaUploadHeaders` 给出，缺一**抛错**、
//     不发请求 —— 原来它是写死的常量，谁调都带；
//   - 上传响应里服务端声明的存储落点由 `assertChildMediaStorage` 复核，
//     落到本地磁盘 / 公开地址 / 没登记的值一律按不合格抛错。
const API_BASE = CHILD_MEDIA_API_BASE;

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '服务暂时不可用，请稍后重试。');
  return data;
}

/** 上传儿童素材：带鉴权 + 落点复核（两条都由 `services/mediaStorage.js` 把关）。 */
export async function uploadControlledMedia(kind, file) {
  const response = await fetch(`${API_BASE}/api/media`, {
    method: 'POST',
    headers: childMediaUploadHeaders({ extra: { 'Content-Type': file.type, 'X-Media-Kind': kind, 'X-Media-Name': encodeURIComponent(file.name) } }),
    body: file
  });
  const payload = await readResponse(response);
  assertChildMediaStorage(payload);
  return payload;
}

export async function requestAiReview(payload) {
  const response = await fetch(`${API_BASE}/api/reviews/generate`, {
    method: 'POST',
    headers: childMediaUploadHeaders({ extra: { 'Content-Type': 'application/json' } }),
    body: JSON.stringify(payload)
  });
  return readResponse(response);
}

export async function createMediaTask(type, mediaId) {
  const response = await fetch(`${API_BASE}/api/tasks`, {
    method: 'POST',
    headers: childMediaUploadHeaders({ extra: { 'Content-Type': 'application/json' } }),
    body: JSON.stringify({ type, mediaId })
  });
  return readResponse(response);
}

export async function requestDoubaoArtworkGeneration(artworkId) {
  const response = await fetch(`${API_BASE}/api/artwork/generate`, {
    method: 'POST',
    headers: childMediaUploadHeaders({ extra: { 'Content-Type': 'application/json' } }),
    body: JSON.stringify({ artworkId })
  });
  return readResponse(response);
}
