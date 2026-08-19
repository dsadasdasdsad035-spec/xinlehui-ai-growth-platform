const API_BASE = 'http://127.0.0.1:8791';
const headers = { 'X-Actor-Role': 'teacher', 'Content-Type': 'application/json' };

const portableRecords = records => records.map(record => ({
  ...record,
  artworkUrl: /^https?:\/\//.test(record.artworkUrl || '') ? record.artworkUrl : '',
  photoUrl: /^https?:\/\//.test(record.photoUrl || '') ? record.photoUrl : '',
  videoUrl: /^https?:\/\//.test(record.videoUrl || '') ? record.videoUrl : ''
}));

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '成长记录服务暂时不可用。');
  return data;
}

export async function loadRemoteFeedbackRecords() {
  const data = await readResponse(await fetch(`${API_BASE}/api/feedback-records`, { headers }));
  return data.records || [];
}

export async function saveRemoteFeedbackRecords(records) {
  return readResponse(await fetch(`${API_BASE}/api/feedback-records`, { method: 'PUT', headers, body: JSON.stringify({ records: portableRecords(records) }) }));
}

export async function createParentSession(phone, code) {
  return readResponse(await fetch(`${API_BASE}/api/auth/parent-session`, { method: 'POST', headers, body: JSON.stringify({ phone, code }) }));
}

export async function loadParentFeedbackRecords(token) {
  const data = await readResponse(await fetch(`${API_BASE}/api/parent/feedback-records`, { headers: { Authorization: `Bearer ${token}` } }));
  return data.records || [];
}
