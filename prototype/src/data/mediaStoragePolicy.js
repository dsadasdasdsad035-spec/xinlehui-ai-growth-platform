/**
 * 儿童素材的**存储策略**（[第二步 US-013] / PRD FR-46 与 9.5 节「隐私与安全」）。
 *
 * 三条口径：
 *   1. **儿童素材不写入服务端本地磁盘** —— 允许的落地只有「服务端内存（开发适配器）」
 *      与「私有对象存储（生产口径，带鉴权）」；本地磁盘与公开可猜测地址被点名禁止；
 *   2. **上传必须带鉴权** —— 老师身份（`X-Actor-Role: teacher`）与监护人授权
 *      （`X-Media-Consent: granted`）两件缺一不发请求（服务端也各校验一遍，见 `server/index.mjs`）；
 *   3. **密钥不下发前端** —— 客户端只拿 publishableKey 一类的公开标识，写入/读出的签名在服务端签。
 *
 * 这是「规则」层（零依赖纯函数 + 常量，可 Node 直跑）；做网络动作的部分在
 * `services/mediaStorage.js`（带鉴权头、复核服务端声明的存储落点、探测开发适配器）。
 */

/** 允许 / 禁止的存储落点（服务端 `GET /health` 的 `storage` 字段按别名映射到这里）。 */
export const CHILD_MEDIA_STORAGE_SINKS = [
  {
    id: 'session-memory',
    label: '服务端内存（开发适配器）',
    allowed: true,
    aliases: ['memory-development-only', 'memory'],
    note: '开发适配器只在内存里持有素材，进程重启即清空 —— 不落服务端本地磁盘。'
  },
  {
    id: 'private-object-storage',
    label: '私有对象存储（带鉴权）',
    allowed: true,
    aliases: ['private-object-storage', 'private-bucket'],
    note: '生产口径：私有桶 + 服务端签名 URL；不做公开可猜测的地址，密钥不下发前端。'
  },
  {
    id: 'server-local-disk',
    label: '服务端本地磁盘',
    allowed: false,
    aliases: ['local-disk', 'filesystem', 'fs'],
    note: '儿童素材禁止写入服务端本地磁盘（FR-46）。'
  },
  {
    id: 'public-bucket',
    label: '公开可猜测的地址',
    allowed: false,
    aliases: ['public-bucket', 'public'],
    note: '不做公开可猜测的 URL（FR-46）。'
  }
];

/** 上传鉴权的两件套（服务端 `requireTeacherWithConsent` 读的就是这两个头）。 */
export const CHILD_MEDIA_UPLOAD_AUTH = {
  roleHeader: 'X-Actor-Role',
  consentHeader: 'X-Media-Consent',
  requiredRole: 'teacher',
  requiredConsent: 'granted',
  roleLabel: '老师身份',
  consentLabel: '监护人授权'
};

/** 开发适配器的地址（`pnpm run dev:api`）。 */
export const CHILD_MEDIA_API_BASE = 'http://127.0.0.1:8787';

const str = (value) => (value === null || value === undefined ? '' : String(value).trim());

/** 按 id 或服务端别名找存储落点（认不出返回 null）。 */
export function childMediaStorageSink(id) {
  const key = str(id).toLowerCase();
  if (!key) return null;
  return CHILD_MEDIA_STORAGE_SINKS.find(item => item.id === key || item.aliases.includes(key)) || null;
}

/** 存储落点的可读标签（认不出时把原值带出来，别谎报成已知落点）。 */
export function childMediaStorageLabel(id) {
  const sink = childMediaStorageSink(id);
  return sink ? sink.label : (str(id) ? `未知存储落点（${str(id)}）` : '未声明存储落点');
}

/**
 * 落点判定：允许返回空串，禁止 / 认不出返回可读原因。
 * 「认不出」也算不合格 —— 服务端换了一个没登记的落点时，宁可拒绝也不要放过。
 */
export function childMediaStorageIssue(id) {
  const sink = childMediaStorageSink(id);
  if (!sink) return `未登记的存储落点「${str(id) || '（空）'}」：儿童素材只允许服务端内存或私有对象存储。`;
  if (!sink.allowed) return `该存储落点被禁止：${sink.label}。${sink.note}`;
  return '';
}

/** 上传鉴权判定：两个头都对才放行（缺一返回可读原因）。 */
export function childMediaUploadAuthIssue({ role = '', consent = '' } = {}) {
  const source = { role: str(role), consent: str(consent) };
  const missing = [];
  if (source.role !== CHILD_MEDIA_UPLOAD_AUTH.requiredRole) missing.push(CHILD_MEDIA_UPLOAD_AUTH.roleLabel);
  if (source.consent !== CHILD_MEDIA_UPLOAD_AUTH.requiredConsent) missing.push(CHILD_MEDIA_UPLOAD_AUTH.consentLabel);
  if (!missing.length) return '';
  return `儿童素材上传必须带鉴权：缺少 ${missing.join(' + ')}（${CHILD_MEDIA_UPLOAD_AUTH.roleHeader} / ${CHILD_MEDIA_UPLOAD_AUTH.consentHeader}）。`;
}

/** 面板三行：允许 / 禁止的落点清单（界面与断言读同一份）。 */
export function mediaStoragePolicyRows() {
  return CHILD_MEDIA_STORAGE_SINKS.map(item => ({
    id: item.id,
    label: item.label,
    allowed: item.allowed,
    note: item.note
  }));
}

/** 一句话策略（面板副标题）。 */
export const MEDIA_STORAGE_POLICY_SUMMARY = '儿童素材不写入服务端本地磁盘：上传必须带鉴权（老师身份 + 监护人授权），服务端只把素材放在内存 / 私有对象存储里，密钥不下发前端。';

/** 客户端拿到的凭据只有公开标识这一句（与 `cloud.js` 的注释同一口径）。 */
export const MEDIA_STORAGE_CREDENTIAL_NOTE = '前端只持有公开标识（publishableKey 一类）；读写签名在服务端签，密钥不下发前端。';
