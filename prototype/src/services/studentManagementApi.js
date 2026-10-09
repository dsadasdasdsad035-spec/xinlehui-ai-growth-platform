import { cloud, unwrap } from '../cloud';

// 学员与班级档案改为云端持久化，替换原先指向 http://127.0.0.1:8788 的本地服务。
// 整个机构共用一份工作区数据，因此按 workspace 维度存一行，而不是按用户隔离。
const TABLE = 'student_management';
const WORKSPACE_ID = 'xinlehui-demo';

export async function loadRemoteStudentManagement() {
  const row = unwrap(
    await cloud.database
      .from(TABLE)
      .select('payload')
      .eq('workspace', WORKSPACE_ID)
      .maybeSingle()
  );
  if (!row?.payload) throw new Error('学员档案工作区尚未初始化。');
  return row.payload;
}

export async function saveRemoteStudentManagement(data) {
  unwrap(
    await cloud.database
      .from(TABLE)
      .upsert({ workspace: WORKSPACE_ID, payload: data }, { onConflict: 'workspace' })
  );
  return data;
}
