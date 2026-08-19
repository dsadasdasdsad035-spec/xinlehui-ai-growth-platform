// 学员与家长绑定使用独立的数据服务，避免影响正在运行的媒体处理服务。
const API_BASE = 'http://127.0.0.1:8788';
const headers = { 'X-Actor-Role': 'teacher', 'Content-Type': 'application/json' };

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '学员数据服务暂时不可用。');
  return data;
}

export async function loadRemoteStudentManagement() {
  return readResponse(await fetch(`${API_BASE}/api/management`, { headers }));
}

export async function saveRemoteStudentManagement(data) {
  return readResponse(await fetch(`${API_BASE}/api/management`, { method: 'PUT', headers, body: JSON.stringify(data) }));
}
