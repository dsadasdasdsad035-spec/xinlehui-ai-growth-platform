import { cloud, unwrap } from '../cloud';
import { loadRemoteStudentManagement } from './studentManagementApi';

// 课后反馈（成长记录）改为云端持久化，替换原先指向 http://127.0.0.1:8791 的本地服务。
// 数据按「一所机构共享一份工作区」组织：老师在教师端归档、家长端读取、管理员端审计，
// 三方看的是同一份数据，所以不按 owner 隔离，而是按 record_key 幂等写入。
const TABLE = 'feedback_records';

// blob: / data: 这类只在当前浏览器会话有效的地址不入库，避免云端存下失效素材。
const httpOnly = value => (/^https?:\/\//.test(String(value || '')) ? String(value) : '');

const toRow = record => ({
  record_key: String(record.id),
  student: String(record.student || ''),
  class_name: String(record.className || ''),
  record_date: String(record.date || ''),
  title: String(record.title || '未命名作品'),
  status: String(record.status || '已归档'),
  payload: {
    ...record,
    artworkUrl: httpOnly(record.artworkUrl),
    photoUrl: httpOnly(record.photoUrl),
    videoUrl: httpOnly(record.videoUrl)
  }
});

export async function loadRemoteFeedbackRecords() {
  const rows = unwrap(
    await cloud.database
      .from(TABLE)
      .select('record_key, payload')
      .order('record_date', { ascending: false })
  );
  return (rows || []).map(row => row.payload).filter(Boolean);
}

export async function saveRemoteFeedbackRecords(records) {
  const list = Array.isArray(records) ? records : [];
  const keys = list.map(record => String(record.id));

  if (list.length) {
    unwrap(
      await cloud.database
        .from(TABLE)
        .upsert(list.map(toRow), { onConflict: 'record_key' })
    );
  }

  // 本地删除的记录要同步清理，否则云端会留下孤儿行。
  const existing = unwrap(await cloud.database.from(TABLE).select('record_key'));
  const removed = (existing || [])
    .map(row => row.record_key)
    .filter(key => key && !keys.includes(key));
  if (removed.length) {
    unwrap(await cloud.database.from(TABLE).delete().in('record_key', removed));
  }

  return { records: list };
}

// 家长端会话：按监护人手机号在云端学员档案里匹配已绑定的孩子。
// 原型阶段未接入短信服务商，验证码仍沿用本地约定值，与工作区数据口径保持一致。
const parentSessions = new Map();

export async function createParentSession(phone, code) {
  if (!/^1\d{10}$/.test(String(phone || ''))) throw new Error('请输入正确的 11 位手机号。');
  if (String(code || '') !== '123456') throw new Error('验证码不正确。');
  const management = await loadRemoteStudentManagement();
  const studentNames = (management.students || [])
    .filter(item => item.guardianPhone === phone)
    .map(item => item.name);
  if (!studentNames.length) throw new Error('该手机号尚未绑定孩子档案，请联系老师完成家长端绑定。');
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const token = `parent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  parentSessions.set(token, { studentNames, expiresAt });
  return { token, studentNames, expiresAt: new Date(expiresAt).toISOString() };
}

export async function loadParentFeedbackRecords(token) {
  const session = parentSessions.get(token);
  if (!session || session.expiresAt < Date.now()) throw new Error('家长登录状态已过期，请重新登录。');
  const records = await loadRemoteFeedbackRecords();
  return records.filter(record => session.studentNames.includes(record.student));
}
