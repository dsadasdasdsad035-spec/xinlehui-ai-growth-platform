const API_BASE = 'http://127.0.0.1:8787';

const protectedHeaders = {
  'X-Actor-Role': 'teacher',
  'X-Media-Consent': 'granted'
};

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '服务暂时不可用，请稍后重试。');
  return data;
}

export async function uploadControlledMedia(kind, file) {
  const response = await fetch(`${API_BASE}/api/media`, {
    method: 'POST',
    headers: { ...protectedHeaders, 'Content-Type': file.type, 'X-Media-Kind': kind, 'X-Media-Name': encodeURIComponent(file.name) },
    body: file
  });
  return readResponse(response);
}

export async function requestAiReview(payload) {
  const response = await fetch(`${API_BASE}/api/reviews/generate`, {
    method: 'POST',
    headers: { ...protectedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return readResponse(response);
}

export async function createMediaTask(type, mediaId) {
  const response = await fetch(`${API_BASE}/api/tasks`, {
    method: 'POST', headers: { ...protectedHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ type, mediaId })
  });
  return readResponse(response);
}

export async function requestDoubaoArtworkGeneration(artworkId) {
  const response = await fetch(`${API_BASE}/api/artwork/generate`, {
    method: 'POST',
    headers: { ...protectedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ artworkId })
  });
  return readResponse(response);
}
