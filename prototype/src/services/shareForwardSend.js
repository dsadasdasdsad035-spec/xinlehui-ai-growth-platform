// 记一次转发的编排（[第四步 US-209] 的口径，唯一一份实现；[海报 US-311b] 的海报弹窗复用同一支）。
//
// 「复制微信文案 / 复制链接 = 一次转发」这件事由三步组成，符号全在别处：
//   ① 底账先跟**本机镜像**并一次（`mergeShareTokens`）：家长在另一标签打开过（打开次数在镜像里更大）时，
//      老师这一侧的旧快照不会把那个数字写小（与落盘那条路径同一条纪律）；
//   ② 记一次发送（`applyShareSend`：渠道 / 时刻 / 第几次 / 发送时的档案版本）；
//   ③ 把改过的那一条推云端（`share_tokens` 表还没建时会被拒 —— 只影响跨设备可见，本机这条照常成立）。
//
// **复制失败不记发送**（不谎报「已转发」）：调用方只在复制成功之后调这里；令牌不存在 / 空令牌时返回 null，
// 一个字节都不动。返回 `{ tokens, record, changed }`（与 `applyShareSend` 同形）或 null。
import { applyShareSend } from '../data/shareForward';
import { loadShareTokens, mergeShareTokens } from '../data/shareTokens';
import { saveRemoteShareToken } from './shareTokensApi';

const text = (value) => String(value === null || value === undefined ? '' : value).trim();

/**
 * @param {object} input
 * @param {Array} input.tokens 老师这一侧的令牌账（可显式传入「刚并进新令牌的那一份」）
 * @param {string} input.tokenText 记到哪一条令牌上（空串 = 什么都不做）
 * @param {string} input.channel 渠道（`SHARE_FORWARD_CHANNELS` 的 id：微信 / 复制链接）
 * @param {string} [input.at] 发送时刻（缺省「现在」；断言用固定值）
 * @param {string} [input.by] 操作人（老师姓名）
 * @param {number} [input.version] 发送那一刻的档案版本
 * @returns {{tokens:Array, record:object, changed:boolean}|null}
 */
export function recordShareForwardSend({ tokens = [], tokenText = '', channel = '', at = '', by = '', version = 0 } = {}) {
  const target = text(tokenText);
  if (!target) return null;
  const ledger = mergeShareTokens(Array.isArray(tokens) ? tokens : [], loadShareTokens());
  const result = applyShareSend(ledger, target, {
    channel,
    at: text(at) || new Date().toISOString(),
    by,
    version
  });
  if (!result.changed || !result.record) return null;
  void saveRemoteShareToken(result.record).catch(() => {});
  return result;
}
