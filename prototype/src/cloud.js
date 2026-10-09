import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk';

// 云服务开通结果中对外公开的四个字段，是唯一可以进入前端代码的凭据。
// publishableKey 只标识「哪个应用」，本身不带权限；服务端仍按 Origin 精确校验。
export const cloudPublicConfig = {
  resourceId: 'wbcs_el5GPp3oGbkOVI60fnisjT',
  endpoint: 'https://xinlehui-feedback-prototype.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_S5qyZOVxXtfPOVqAmXP0y5_IzK4CS40jVu4AY6ylB6Iocr471WAWIyT'
};

// 全应用只初始化一次，Auth / Database / Storage / LLM 共用这一个客户端。
export const cloud = createWorkBuddyCloud({
  endpoint: cloudPublicConfig.endpoint,
  oauthRelayBaseUrl: cloudPublicConfig.oauthRelayBaseUrl,
  publishableKey: cloudPublicConfig.publishableKey
});

// 把 { data, error } 信封转成抛错式，保持调用点简洁。
export function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}
