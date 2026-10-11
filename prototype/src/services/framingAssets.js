import { screenFramingAssetFile, validateFramingAsset, validateFramingAssetDimensions } from '../data/framingAssets';

/**
 * 装裱素材的浏览器侧读取入口（[第二步 US-003b]，FR-22）。
 *
 * 分工与 `services/mediaIntake.js` 同一口径：**规则在 data 层（零依赖、可 Node 断言），
 * 这里只保留「必须有 DOM 能力」的部分** —— 把文件读成 data URL、解码拿到真实宽高。
 *
 * 为什么 Logo 存 data URL 进模板 spec：`frameSpec` 的 `imageUrl()` 白名单放行
 * `http(s)` / `data:image` / `blob:`；原型阶段没有私有对象存储（FR-22 的「私有存储 + 鉴权」
 * 属于合规故事 US-013/US-037），data URL 是**可持久、可复现**的那一种（blob: 刷新即失效、
 * 带不上云端模板）。机构 Logo 是机构自己的资产，不是儿童素材，因此不受「素材不进浏览器存储」
 * 那条限制约束（那条只管课上拍的儿童作品与照片）。
 */

/** 读文件成 data URL。失败不抛错，由调用方给可读文案。 */
function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (typeof FileReader !== 'function') { resolve({ ok: false }); return; }
    try {
      const reader = new FileReader();
      reader.onload = () => resolve({ ok: true, url: String(reader.result || '') });
      reader.onerror = () => resolve({ ok: false });
      reader.readAsDataURL(file);
    } catch {
      resolve({ ok: false });
    }
  });
}

/** 解码：拿真实宽高（尺寸校验必须用解码值，不能信文件名或 MIME）。 */
function decodeImage(url) {
  return new Promise((resolve) => {
    if (typeof Image !== 'function' || !url) { resolve(null); return; }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * 读取并校验一份装裱素材（Logo / 签名 / 二维码底图）。
 *
 * 顺序即验收要求的「上传前校验」：**格式与体积先判（不读文件）→ 解码 → 带尺寸再判一遍**，
 * 任何一项不合格都**不产生可用的 asset**，只返回可读文案。
 *
 * 返回 `{ ok, asset, message }`：
 *   - `asset` = `{ url, name, type, size, width, height }`，`url` 是 data URL（可直接进 spec）；
 *   - `message` 不合格时的**可读错误文案**（含文件名、实际值、上限与怎么办），ok 时为 `''`。
 * 永不抛错：读文件失败、图片损坏都收敛成 `ok: false` + 文案。
 */
export async function readFramingAsset(file) {
  const name = String((file && file.name) || '').trim() || '未命名文件';
  const screened = screenFramingAssetFile(file);
  if (!screened.ok) return { ok: false, asset: null, message: screened.message };

  const read = await readFileAsDataUrl(file);
  if (!read.ok || !read.url) {
    return {
      ok: false,
      asset: null,
      message: `「${name}」读取失败，请重新选择文件后再试（若仍失败，换一张 ${screened.limits.formats} 图片）。`
    };
  }
  const image = await decodeImage(read.url);
  if (!image || !image.naturalWidth || !image.naturalHeight) {
    return {
      ok: false,
      asset: null,
      message: `「${name}」无法解析为图片，请确认它不是被改过后缀的其它格式。`
    };
  }
  // 解码后的尺寸才算数：文件名与 MIME 都可能骗人（改后缀的图很常见）。
  const checked = validateFramingAsset({ name, type: screened.type, size: file?.size, width: image.naturalWidth, height: image.naturalHeight });
  if (!checked.ok) return { ok: false, asset: null, message: checked.message };

  return {
    ok: true,
    message: '',
    asset: {
      url: read.url,
      name,
      type: checked.type,
      size: Number(file?.size) || 0,
      width: image.naturalWidth,
      height: image.naturalHeight
    }
  };
}

/**
 * 复核一个**已经存进模板**的素材地址（打开面板时用）：
 * 解码成功且尺寸合规 → `ok`；地址失效 / 尺寸超限 → 明确文案（界面上提示重新上传）。
 *
 * 这里**只判尺寸、不判格式**：`name` 是给老师看的标签（「机构 Logo」）而不是文件名，按扩展名判格式
 * 会一律误报「格式不支持」；而 data URL 能解码本身就说明格式可用。`http(s)` 地址解码失败时
 * 可能是网络问题，文案与「损坏文件」区分开。
 */
export async function inspectFramingAssetUrl(url, name = '已保存的素材') {
  const image = await decodeImage(url);
  if (!image || !image.naturalWidth || !image.naturalHeight) {
    return { ok: false, width: 0, height: 0, message: `「${name}」暂时读不出来（地址失效或网络不通），请重新上传。` };
  }
  const checked = validateFramingAssetDimensions({ name, width: image.naturalWidth, height: image.naturalHeight });
  if (!checked.ok) return { ok: false, width: image.naturalWidth, height: image.naturalHeight, message: checked.message };
  return { ok: true, width: image.naturalWidth, height: image.naturalHeight, message: '' };
}
