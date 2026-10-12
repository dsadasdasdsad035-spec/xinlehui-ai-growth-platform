import { cloud, unwrap } from '../cloud';
import {
  ARCHIVE_REPORT_FIELDS,
  ARCHIVE_REPORT_STATUSES,
  normalizeArchiveReport,
  setArchiveReportStatus
} from '../data/archiveReports';

// 阶段报告的云端读写（[第四步 US-207a] / FR-236）。
// 与课后反馈记录同一套共享工作区模型：一所机构一份账，按 `report_key` 幂等写入
// （同一个「学员 + 周期 + 类型」永远只有一行 —— 更新报告是**就地改那一行**，不是插新行）。
//
// 云端 `archive_reports` 表还没建立时，写入会被 PostgREST 拒掉（DATABASE_PGRST204 的老坑），
// 调用方按「已保存到本机镜像」处理 —— 与审计日志 / 装裱模板同一套兜底口径：
// `data/archiveReports.js` 的 `loadArchiveReports` / `persistArchiveReports` 先落本机镜像，
// 这里只负责把它推上云（失败不抛给界面，返回可读原因让界面如实标注）。
const TABLE = 'archive_reports';

/** 行 → 应用对象：snake_case 只在这里出现（业务代码永远不碰 snake_case）。 */
export function rowToArchiveReport(row) {
  const source = row && typeof row === 'object' ? row : {};
  const payload = source.payload && typeof source.payload === 'object' ? source.payload : {};
  return normalizeArchiveReport({
    ...payload,
    id: source.report_id || payload.id,
    reportKey: source.report_key || payload.reportKey,
    period: source.period || payload.period,
    type: source.type || payload.type,
    snapshot: source.snapshot || payload.snapshot,
    version: source.version || payload.version,
    generatedBy: source.generated_by || payload.generatedBy,
    generatedAt: source.generated_at || payload.generatedAt,
    status: source.status || payload.status
  });
}

/**
 * 应用对象 → 行：检索用的几列独立成列（与 PRD 的表结构一致），整条按白名单进 `payload`
 * —— 与 `auditLogApi` 同一套写法，新字段只加进白名单、不动云表结构。
 * `status` 写 `synced`：**云端的行只可能是已同步的那一版** —— 写失败（含表还没建）不会留下任何行，
 * 所以「行存在」本身就等于「这份报告在云端」。翻状态是在 here 做的，界面不必再传一遍。
 */
export function archiveReportToRow(report) {
  const item = setArchiveReportStatus(report, ARCHIVE_REPORT_STATUSES.synced);
  if (!item) throw new Error('阶段报告为空，未写入云端。');
  const payload = {};
  ARCHIVE_REPORT_FIELDS.forEach(key => { payload[key] = item[key]; });
  return {
    report_key: item.reportKey,
    report_id: item.id,
    period: item.period,
    type: item.type,
    snapshot: item.snapshot,
    version: item.version,
    generated_by: item.generatedBy,
    generated_at: item.generatedAt,
    status: item.status,
    payload
  };
}

export async function loadRemoteArchiveReports() {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  return (rows || []).map(rowToArchiveReport).filter(Boolean);
}

/** 幂等 upsert：同 `report_key` 覆盖那一行（更新报告 = 就地改，云端不会多出孤儿行）。 */
export async function saveRemoteArchiveReport(report) {
  const row = archiveReportToRow(report);
  unwrap(await cloud.database.from(TABLE).upsert(row, { onConflict: 'report_key' }));
  return report;
}

export async function deleteRemoteArchiveReport(reportKey) {
  const key = String(reportKey || '').trim();
  if (!key) throw new Error('缺少报告键，未从云端删除。');
  unwrap(await cloud.database.from(TABLE).delete().eq('report_key', key));
  return key;
}
