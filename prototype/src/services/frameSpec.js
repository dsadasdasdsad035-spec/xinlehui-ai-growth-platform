import { cloud } from '../cloud';
import { ELEMENT_POSITIONS, clampOverlayOffset, normalizeOverlayFont, OVERLAY_FONT_WHITELIST } from './overlayLayout';
import { FRAMING_ASSET_DATA_URL_MAX_CHARS } from '../data/framingAssets';

// 装裱方案由大模型「设计参数」，再由前端 canvas「精确绘制」。
//
// 为什么不用大模型直接生图：云端 SDK 只有 chat / models / database / storage 四个模块，
// 没有生图端点；模型目录里虽有 hunyuan-image-alpha，但通过 chat 调用一律返回
// request_invalid_parameter。因此这里让大模型输出可绘制的几何与色彩参数，
// 既保住了「绝不重绘孩子作品」的核心承诺，也把结果变成可复现、可微调的确定值。
const SPEC_MODEL = 'glm-5.3-flash';

// 文本类元素（展签 / 水印 / 落款）的字体白名单的**唯一真源在 overlayLayout.js**
// （`OVERLAY_FONT_WHITELIST` + `normalizeOverlayFont`）：v1 收敛器、v2 收敛器与绘制层都读同一份，
// 后台/老师端的字体下拉（US-007）也从这里取选项 —— 别在任何一侧再抄一份列表。

export const DEFAULT_FRAME_SPEC = {
  outer: '#cfa52e',
  outerWidthRatio: 0.0412,
  mat: '#f3ede2',
  matWidthRatio: 0.0647,
  innerLine: null,
  plaqueBg: '#2b271f',
  plaqueText: '#fbf8f2',
  plaqueFontFamily: 'serif',
  plaqueLetterSpacing: 1,
  artRotateDeg: 0,
  atmosphere: '',
  rationale: ''
};

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const hex = (value, fallback) => {
  const text = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : fallback;
};

const hexOrNull = (value) => {
  const text = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : null;
};

// v2 归一化用的小工具。全部是「永不抛错」的收敛：拿到脏数据就退回 fallback。
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const group = (value) => (isPlainObject(value) ? value : {});

const bool = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback);

/** 把比例型参数收敛到 `{min,max}`；脏值（NaN / 字符串 / null）返回 fallback。 */
export const clampRatio = (value, range, fallback) => clamp(value, range.min, range.max, fallback);

const text = (value, fallback, max = 120) => {
  const raw = String(value ?? '').trim();
  return (raw || fallback).slice(0, max);
};

/**
 * 叠加元素的图片地址：只接受 http(s) / data:image / blob，避免把任意 URL 印到孩子作品上。
 *
 * **长度上限按 FR-22 的素材上限推**（`data/framingAssets.js` 的 `FRAMING_ASSET_DATA_URL_MAX_CHARS`）：
 * 合规的 200KB Logo 转成 data URL 约 273KB 字符，所以上限不能小。超长的一律**丢弃**而不是截断 ——
 * 截断的 data URL 能被 PNG 解码器「部分解出来」，画面上就是一张下半截消失的 Logo，且不报任何错
 * （US-003b 真踩到：旧的 2048 字符截断让一张 100×400 的测试图只画出上面 73%）。
 */
const imageUrl = (value) => {
  const raw = String(value ?? '').trim();
  if (!/^(https?:\/\/|data:image\/|blob:)/i.test(raw)) return '';
  return raw.length <= FRAMING_ASSET_DATA_URL_MAX_CHARS ? raw : '';
};

/**
 * v1 收敛器：把（大模型）输出收敛成一定能被 canvas 安全绘制的**平面**参数。
 *
 * 这是历史形状，**冻结不再扩展**——`data/framingPresets.js` 的 4 套内置预设与后台
 * 「装裱设置」的大模型入口仍在用它，改动它等于改动老模板的渲染结果。
 * 新能力一律加到 v2（`DEFAULT_FRAME_SPEC_V2` / `normalizeFrameSpecV2`），
 * 需要平面参数的地方用 `frameSpecView()` 取 v1 视图。
 */
export function normalizeFrameSpec(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = DEFAULT_FRAME_SPEC;
  const font = String(source.plaqueFontFamily ?? '').trim();
  return {
    outer: hex(source.outer, base.outer),
    // 下限定在 0.012：更细的框在 1800px 画布上会看不见，视觉上等同于没有装裱。
    outerWidthRatio: clamp(source.outerWidthRatio, 0.012, 0.06, base.outerWidthRatio),
    mat: hex(source.mat, base.mat),
    matWidthRatio: clamp(source.matWidthRatio, 0.02, 0.12, base.matWidthRatio),
    innerLine: hexOrNull(source.innerLine),
    plaqueBg: hex(source.plaqueBg, base.plaqueBg),
    plaqueText: hex(source.plaqueText, base.plaqueText),
    plaqueFontFamily: normalizeOverlayFont(font, base.plaqueFontFamily),
    plaqueLetterSpacing: clamp(source.plaqueLetterSpacing, 0, 8, base.plaqueLetterSpacing),
    artRotateDeg: Number(source.artRotateDeg) === 90 ? 90 : 0,
    atmosphere: String(source.atmosphere ?? '').slice(0, 120),
    rationale: String(source.rationale ?? '').slice(0, 120)
  };
}

// ---------------------------------------------------------------------------
// spec v2 —— 形状化相框 + 卡纸光影 + 叠加元素（水印 / 落款 / 时间 / 二维码）
//
// 三条硬约束（[第二步 US-001a] 的验收）：
//   1. **v1 是 v2 的子集**。v1 的平面字段（outer / outerWidthRatio / mat / matWidthRatio /
//      innerLine / plaque* / artRotateDeg / atmosphere / rationale）仍被读取，normalizeFrameSpecV2
//      会把它们搬进对应分组。老预设、老的大模型输出不改一行也能继续渲染。
//   2. **所有新字段可选**。缺失或非法一律回落到 v1 行为（直角实色外框 + 卡纸 + 展签，
//      不绘制任何叠加元素），且**永不抛错** —— 参数来自大模型与后台手填，脏数据不能把渲染打挂。
//   3. 叠加元素默认 `visible: false`。v1 本来就不画水印/落款/时间，默认 true 会让
//      「迁移过来的一份老模板」凭空多出 `{机构名}` 水印 —— 那就不是向后兼容了。
//      面板里显式开启即可（US-003a/003b/003c）。
//
// 位置与尺寸一律用「相对画布短边的比例」，这样同一份模板在 1800px 合成画布与 4000px 导出图上位置一致。
// ---------------------------------------------------------------------------

/** v2 结构版本号。v1 的平面 spec 没有 version 字段。 */
export const FRAME_SPEC_V2 = 2;

export const FRAME_SHAPES = ['square', 'rounded', 'arch', 'bevel'];
export const FRAME_TEXTURES = ['solid'];

/**
 * 比例型参数的生效范围（相对画布短边）。**收敛器与渲染层共用这一份**：
 * 越界值一律收敛到边界，而不是把画面画崩（US-002a 的验收原文）。
 * 渲染层单独再收敛一次是必要的 —— v1 平面 spec 是**原样**进渲染层的（frameSpecView 不重新收敛）。
 */
export const FRAME_WIDTH_RATIO_RANGE = { min: 0.008, max: 0.08 };
export const MAT_WIDTH_RATIO_RANGE = { min: 0.02, max: 0.12 };
export const CORNER_RADIUS_RATIO_RANGE = { min: 0, max: 0.5 };
// 九宫格位置枚举（含 `custom`）与 offset 范围（-0.5~0.5）的**唯一真源在 overlayLayout.js**：
// 定位层、这里的收敛器与后台的九宫格控件必须读同一份，别在任一侧再抄一遍。
// 这里重新导出，保持 `frameSpec.js` 既有调用方的 import 路径不变。
export { ELEMENT_POSITIONS };

/** 字体白名单（后台/老师端面板的字体下拉直接用它；真源仍是 `overlayLayout.js`）。 */
export const FRAMING_FONT_WHITELIST = OVERLAY_FONT_WHITELIST;
export const PLAQUE_POSITIONS = ['bottom', 'top'];
export const DATE_SOURCES = ['lesson', 'today', 'manual'];
export const DATE_FORMATS = ['YYYY.MM.DD', 'YYYY-MM-DD', 'YYYY年MM月DD日'];
export const SIGNATURE_MODES = ['text', 'image'];
export const SEAL_SHAPES = ['square', 'round'];

/** v2 默认值：除叠加元素外，逐字段等于 v1 的默认行为。 */
export const DEFAULT_FRAME_SPEC_V2 = {
  version: FRAME_SPEC_V2,
  canvas: { width: 1800, height: 1360, background: '#F3EDE2', wallRatio: 0.025 },
  frame: {
    shape: 'square',
    color: '#CFA52E',
    widthRatio: 0.0412,
    cornerRadiusRatio: 0.06,
    texture: 'solid',
    lighting: { highlight: '#E8C766', shadow: '#8A6B1C', angle: 135 }
  },
  mat: { visible: true, color: '#F3EDE2', widthRatio: 0.0647, innerLine: null },
  plaque: { visible: true, bg: '#2B271F', text: '#FBF8F2', fontFamily: 'serif', letterSpacing: 1, position: 'bottom' },
  watermark: {
    logo: { visible: false, url: '', position: 'bottom-right', offsetX: 0.03, offsetY: 0.03, widthRatio: 0.1, opacity: 0.85 },
    text: {
      visible: false, content: '{机构名}', position: 'bottom-right', offsetX: 0.03, offsetY: 0.1,
      fontFamily: 'sans-serif', fontSize: 22, color: '#6D6559', opacity: 0.7, rotateDeg: 0
    },
    qr: {
      visible: false, target: 'growth-archive', position: 'bottom-left', offsetX: 0.03, offsetY: 0.03,
      sizeRatio: 0.07, caption: '扫码看成长档案'
    }
  },
  signature: {
    visible: false,
    mode: 'text',
    teacherName: '{老师姓名}',
    message: '',
    imageUrl: '',
    seal: { visible: false, text: '昕乐绘', color: '#B33A2B', shape: 'square' },
    position: 'bottom-left',
    offsetX: 0.03,
    offsetY: 0.12,
    fontFamily: 'Kaiti SC',
    fontSize: 24,
    color: '#2B271F'
  },
  date: {
    visible: false,
    source: 'lesson',
    format: 'YYYY.MM.DD',
    prefix: '创作于 ',
    manualValue: '',
    position: 'bottom-center',
    offsetX: 0,
    offsetY: 0.03,
    fontSize: 21,
    color: '#6D6559'
  },
  art: { rotateDeg: 0 },
  atmosphere: '',
  rationale: ''
};

/**
 * 判断一份 spec 是不是 v2 结构。
 *
 * 不能只看 `version`：老数据里没有 version，新数据里大模型也可能漏填。
 * 所以「version >= 2」或「出现任何一个 v2 独有的对象分组」都算 v2。
 * 注意 v1 的 `mat` 是颜色字符串、v2 的 `mat` 是对象，typeof 就能区分（null 已被真值判断挡掉）。
 */
export function isFrameSpecV2(spec) {
  if (!isPlainObject(spec)) return false;
  if (Number(spec.version) >= FRAME_SPEC_V2) return true;
  return ['canvas', 'frame', 'plaque', 'watermark', 'signature', 'date'].some((key) => isPlainObject(spec[key]))
    || isPlainObject(spec.mat) || isPlainObject(spec.art);
}

/**
 * 把任意 spec（v2 / v1 平面 / 两者混写 / 脏数据）收敛成完整的 v2 结构。
 *
 * 取值优先级：v2 分组字段 → v1 平面字段（迁移兼容）→ 默认值。
 * 任何一层拿到非法值都退回下一层，最终一定有值，且**永不抛错**。
 */
export function normalizeFrameSpecV2(raw) {
  const source = group(raw);
  const base = DEFAULT_FRAME_SPEC_V2;

  const canvas = group(source.canvas);
  const frame = group(source.frame);
  const mat = group(source.mat);
  const plaque = group(source.plaque);
  const watermark = group(source.watermark);
  const logo = group(watermark.logo);
  const watermarkText = group(watermark.text);
  const qr = group(watermark.qr);
  const signature = group(source.signature);
  const seal = group(signature.seal);
  const date = group(source.date);
  const art = group(source.art);
  const lighting = group(frame.lighting);

  // v1 平面字段：`source.mat` / `source.innerLine` / `source.plaqueBg` / `source.artRotateDeg` …
  const legacyMat = typeof source.mat === 'string' ? source.mat : undefined;
  const legacyInnerLine = typeof source.innerLine === 'string' ? source.innerLine : undefined;
  const legacyFont = String(source.plaqueFontFamily ?? '').trim();

  return {
    version: FRAME_SPEC_V2,
    canvas: {
      width: Math.round(clamp(canvas.width, 600, 6000, base.canvas.width)),
      height: Math.round(clamp(canvas.height, 600, 6000, base.canvas.height)),
      background: hex(canvas.background, base.canvas.background),
      wallRatio: clamp(canvas.wallRatio, 0, 0.1, base.canvas.wallRatio)
    },
    frame: {
      shape: oneOf(frame.shape, FRAME_SHAPES, base.frame.shape),
      color: hex(frame.color ?? source.outer, base.frame.color),
      // 0.008-0.08 是 US-002 的生效范围，越界收敛而不是画崩；下限定在 0.008 以下会看不见。
      widthRatio: clampRatio(frame.widthRatio ?? source.outerWidthRatio, FRAME_WIDTH_RATIO_RANGE, base.frame.widthRatio),
      cornerRadiusRatio: clampRatio(frame.cornerRadiusRatio, CORNER_RADIUS_RATIO_RANGE, base.frame.cornerRadiusRatio),
      texture: oneOf(frame.texture, FRAME_TEXTURES, base.frame.texture),
      lighting: {
        highlight: hex(lighting.highlight, base.frame.lighting.highlight),
        shadow: hex(lighting.shadow, base.frame.lighting.shadow),
        angle: clamp(lighting.angle, 0, 360, base.frame.lighting.angle)
      }
    },
    mat: {
      visible: bool(mat.visible, base.mat.visible),
      color: hex(mat.color ?? legacyMat, base.mat.color),
      widthRatio: clampRatio(mat.widthRatio ?? source.matWidthRatio, MAT_WIDTH_RATIO_RANGE, base.mat.widthRatio),
      innerLine: hexOrNull(mat.innerLine !== undefined ? mat.innerLine : legacyInnerLine)
    },
    plaque: {
      visible: bool(plaque.visible, base.plaque.visible),
      bg: hex(plaque.bg ?? source.plaqueBg, base.plaque.bg),
      text: hex(plaque.text ?? source.plaqueText, base.plaque.text),
      fontFamily: normalizeOverlayFont(plaque.fontFamily ?? legacyFont, base.plaque.fontFamily),
      letterSpacing: clamp(plaque.letterSpacing ?? source.plaqueLetterSpacing, 0, 8, base.plaque.letterSpacing),
      position: oneOf(plaque.position, PLAQUE_POSITIONS, base.plaque.position)
    },
    watermark: {
      logo: {
        visible: bool(logo.visible, base.watermark.logo.visible),
        url: imageUrl(logo.url),
        position: oneOf(logo.position, ELEMENT_POSITIONS, base.watermark.logo.position),
        offsetX: clampOverlayOffset(logo.offsetX, base.watermark.logo.offsetX),
        offsetY: clampOverlayOffset(logo.offsetY, base.watermark.logo.offsetY),
        widthRatio: clamp(logo.widthRatio, 0.02, 0.4, base.watermark.logo.widthRatio),
        opacity: clamp(logo.opacity, 0, 1, base.watermark.logo.opacity)
      },
      text: {
        visible: bool(watermarkText.visible, base.watermark.text.visible),
        content: text(watermarkText.content, base.watermark.text.content, 80),
        position: oneOf(watermarkText.position, ELEMENT_POSITIONS, base.watermark.text.position),
        offsetX: clampOverlayOffset(watermarkText.offsetX, base.watermark.text.offsetX),
        offsetY: clampOverlayOffset(watermarkText.offsetY, base.watermark.text.offsetY),
        fontFamily: normalizeOverlayFont(watermarkText.fontFamily, base.watermark.text.fontFamily),
        fontSize: clamp(watermarkText.fontSize, 8, 200, base.watermark.text.fontSize),
        color: hex(watermarkText.color, base.watermark.text.color),
        opacity: clamp(watermarkText.opacity, 0, 1, base.watermark.text.opacity),
        rotateDeg: clamp(watermarkText.rotateDeg, -180, 180, base.watermark.text.rotateDeg)
      },
      qr: {
        visible: bool(qr.visible, base.watermark.qr.visible),
        // 二维码内容由后台配置，老师端不可自由填 URL。
        target: text(qr.target, base.watermark.qr.target, 60),
        position: oneOf(qr.position, ELEMENT_POSITIONS, base.watermark.qr.position),
        offsetX: clampOverlayOffset(qr.offsetX, base.watermark.qr.offsetX),
        offsetY: clampOverlayOffset(qr.offsetY, base.watermark.qr.offsetY),
        sizeRatio: clamp(qr.sizeRatio, 0.03, 0.25, base.watermark.qr.sizeRatio),
        caption: text(qr.caption, base.watermark.qr.caption, 40)
      }
    },
    signature: {
      visible: bool(signature.visible, base.signature.visible),
      mode: oneOf(signature.mode, SIGNATURE_MODES, base.signature.mode),
      teacherName: text(signature.teacherName, base.signature.teacherName, 40),
      message: String(signature.message ?? '').trim().slice(0, 80),
      imageUrl: imageUrl(signature.imageUrl),
      seal: {
        visible: bool(seal.visible, base.signature.seal.visible),
        text: text(seal.text, base.signature.seal.text, 20),
        color: hex(seal.color, base.signature.seal.color),
        shape: oneOf(seal.shape, SEAL_SHAPES, base.signature.seal.shape)
      },
      position: oneOf(signature.position, ELEMENT_POSITIONS, base.signature.position),
      offsetX: clampOverlayOffset(signature.offsetX, base.signature.offsetX),
      offsetY: clampOverlayOffset(signature.offsetY, base.signature.offsetY),
      fontFamily: normalizeOverlayFont(signature.fontFamily, base.signature.fontFamily),
      fontSize: clamp(signature.fontSize, 8, 200, base.signature.fontSize),
      color: hex(signature.color, base.signature.color)
    },
    date: {
      visible: bool(date.visible, base.date.visible),
      source: oneOf(date.source, DATE_SOURCES, base.date.source),
      format: oneOf(date.format, DATE_FORMATS, base.date.format),
      prefix: String(date.prefix ?? base.date.prefix).slice(0, 20),
      manualValue: String(date.manualValue ?? '').trim().slice(0, 40),
      position: oneOf(date.position, ELEMENT_POSITIONS, base.date.position),
      offsetX: clampOverlayOffset(date.offsetX, base.date.offsetX),
      offsetY: clampOverlayOffset(date.offsetY, base.date.offsetY),
      fontSize: clamp(date.fontSize, 8, 200, base.date.fontSize),
      color: hex(date.color, base.date.color)
    },
    // v1 只允许 0 / 90；任意角度微调属于单幅作品的 artworkEdit（US-004），不进模板。
    art: { rotateDeg: Number(art.rotateDeg ?? source.artRotateDeg) === 90 ? 90 : 0 },
    atmosphere: String(source.atmosphere ?? '').slice(0, 120),
    rationale: String(source.rationale ?? '').slice(0, 120)
  };
}

/**
 * v2 → v1 平面视图：只保留 `renderFramedArtwork` 当前能画的那几项（外框 / 卡纸 / 展签 / 旋转）。
 * 形状、光影、水印、落款、时间等新字段交给 US-002a 之后的渲染层消费，这里不丢也不猜。
 */
export function frameSpecV2ToLegacy(spec) {
  const v2 = normalizeFrameSpecV2(spec);
  return {
    outer: v2.frame.color,
    outerWidthRatio: v2.frame.widthRatio,
    mat: v2.mat.color,
    matWidthRatio: v2.mat.widthRatio,
    innerLine: v2.mat.innerLine,
    plaqueBg: v2.plaque.bg,
    plaqueText: v2.plaque.text,
    plaqueFontFamily: v2.plaque.fontFamily,
    plaqueLetterSpacing: v2.plaque.letterSpacing,
    artRotateDeg: v2.art.rotateDeg,
    atmosphere: v2.atmosphere,
    rationale: v2.rationale
  };
}

/**
 * 统一入口：拿一份「渲染层/后台面板能直接读」的 v1 平面参数。
 * v1 平面 spec **原样返回**（不重新收敛，保证老模板的渲染逐像素不变）；v2 走 `frameSpecV2ToLegacy`。
 */
export function frameSpecView(spec) {
  if (isFrameSpecV2(spec)) return frameSpecV2ToLegacy(spec);
  return isPlainObject(spec) ? spec : {};
}

/** `frame.lighting` 是否被**显式**给出（缺省即「不画光影」= v1 行为）。 */
const hasExplicitFrameLighting = (spec) => isPlainObject(group(group(spec).frame).lighting);

/**
 * 渲染层的**唯一读入口**：v1 平面视图 + 形状 / 圆角 / 光影 / 卡纸开关 + 叠加元素。
 *
 * 这是 `renderFramedArtwork` 读 spec 的入口（不要再直接 `spec.frame.shape` / `spec.watermark`），
 * 也是「同 spec 只渲染一次」的缓存键原料（`frameSpecRenderKey`）。
 * 三条硬口径：
 *   1. **v1 平面结构**（含老预设、老的大模型输出）没有形状 / 光影 / 叠加元素字段，回落 v1 行为：
 *      直角、无光影、画卡纸、**不画任何水印落款**（`overlays: null`）—— 与升级前逐像素一致。
 *   2. **v2 的 `frame.lighting` 只在显式给出时绘制**。US-001a 规定「缺失字段回落 v1 行为」，
 *      而 v1 本来就不画光影；如果按 DEFAULT 补一份默认光影，一份只写了 `frame.shape` 的
 *      v2 spec 会凭空多出渐变。老模板不迁移、不管，新模板由面板显式带上 lighting
 *      （内置 4 套预设与 DEFAULT_FRAME_SPEC_V2 都已显式带值，所以它们有体积感）。
 *   3. **叠加元素整组进渲染视图**（v2 才给，v1 是 `null`）。字段本身已经是
 *      `normalizeFrameSpecV2` 的产物（位置 / 偏移 / 字号都收敛过），所以：
 *      `visible: false` 的元素照样带着完整的类型化占位，但绘制层**只画 visible 为真的**
 *      （US-003a 的验收：完全不绘制、不留空白占位）；同时它们自动进 `frameSpecRenderKey`，
 *      两套只有水印位置不同的模板不会共用同一份画展缓存。
 */
export function frameSpecRenderView(spec) {
  const flat = frameSpecView(spec);
  if (!isFrameSpecV2(spec)) {
    return { ...flat, shape: 'square', cornerRadiusRatio: 0, lighting: null, matVisible: true, overlays: null };
  }
  const v2 = normalizeFrameSpecV2(spec);
  return {
    ...flat,
    shape: v2.frame.shape,
    cornerRadiusRatio: v2.frame.cornerRadiusRatio,
    lighting: hasExplicitFrameLighting(spec) ? { ...v2.frame.lighting } : null,
    matVisible: v2.mat.visible,
    overlays: {
      watermark: {
        logo: { ...v2.watermark.logo },
        text: { ...v2.watermark.text },
        qr: { ...v2.watermark.qr }
      },
      signature: { ...v2.signature, seal: { ...v2.signature.seal } },
      date: { ...v2.date }
    }
  };
}

/**
 * 装裱渲染的缓存键：`JSON.stringify(frameSpecRenderView(spec))`。
 *
 * 取**整个渲染视图**而不是手挑几个字段 —— 缓存键漏字段的后果是「两套不同的模板共用一份渲染结果」
 * （画展里互相串图），比多渲染一次严重得多。v2 新增任何影响渲染的字段都会自动进键。
 */
export function frameSpecRenderKey(spec) {
  return JSON.stringify(frameSpecRenderView(spec));
}

const SPEC_SYSTEM = `你是一位展览级装裱设计师。你把老师用自然语言描述的装裱需求，翻译成可由 canvas 精确绘制的几何与色彩参数。

规则：
- 只输出纯色几何构成，不使用任何位图素材、纹理图片、渐变以外的复杂效果。
- 配色要能托住儿童画：孩子的作品是主角，装裱只负责收边与承托，不能抢色。
- 不要出现相框外的桌面、墙面、影子、手、水印或文字覆盖。
- 只输出一个 JSON 对象，不要 Markdown、不要代码块、不要解释文字。`;

const SPEC_USER = (description) => `装裱需求：${description || '安静克制的儿童作品展览装裱，暖白卡纸，浅木外框。'}

请输出这个 JSON 对象（字段含义见括号）：
{
  "outer": "外框颜色，#RRGGBB",
  "outerWidthRatio": "外框宽度占画布短边的比例，0.012-0.06 之间的小数",
  "mat": "卡纸颜色，#RRGGBB",
  "matWidthRatio": "卡纸宽度占画布短边的比例，0.02-0.12 之间的小数",
  "innerLine": "卡纸内细分隔线颜色 #RRGGBB，或 null 表示不要",
  "plaqueBg": "展签底色 #RRGGBB",
  "plaqueText": "展签文字色 #RRGGBB",
  "plaqueFontFamily": "字体族，只能从 serif / sans-serif / Songti SC / Kaiti SC / Noto Serif SC 中选一个",
  "plaqueLetterSpacing": "展签字距，0-8 之间的数字",
  "artRotateDeg": "作品是否旋转，只能是 0 或 90",
  "atmosphere": "一句话描述这个装裱的氛围，不超过 40 字",
  "rationale": "为什么这样配色，不超过 40 字"
}`;

/** 调用大模型把自然语言需求翻译成装裱参数。 */
export async function generateFrameSpec(description, { signal } = {}) {
  let text = '';
  for await (const chunk of cloud.llm.chat.completions.create({
    model: SPEC_MODEL,
    messages: [
      { role: 'system', content: SPEC_SYSTEM },
      { role: 'user', content: SPEC_USER(description) }
    ],
    stream: true,
    response_format: { type: 'json_object' },
    temperature: 0.5,
    signal
  })) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) text += delta.content;
  }

  const cleaned = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回可用的装裱参数。');
  return normalizeFrameSpec(JSON.parse(cleaned.slice(start, end + 1)));
}
