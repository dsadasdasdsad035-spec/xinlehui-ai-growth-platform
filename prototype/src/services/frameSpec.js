import { cloud } from '../cloud';
import {
  ELEMENT_POSITIONS,
  clampOverlayOffset,
  normalizeOverlayFont,
  overlayPositionLabel,
  OVERLAY_FONT_WHITELIST,
  DATE_SOURCES,
  DATE_FORMATS,
  SIGNATURE_MODES,
  SEAL_SHAPES
} from './overlayLayout';
import { FRAMING_ASSET_DATA_URL_MAX_CHARS } from '../data/framingAssets';
import { frameShapeLabel } from '../data/frameStyles';
import { normalizeQrTarget } from '../data/qrTargets';

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
// 时间来源 / 日期格式 / 落款模式 / 印章形状的枚举真源都在 `overlayLayout.js`
// （时间与落款的实际绘制在那一边），这里重新导出，保持既有 import 路径不变。
export { DATE_SOURCES, DATE_FORMATS, SIGNATURE_MODES, SEAL_SHAPES };

/** 签名图宽度比例（相对画布短边）的生效范围：面板可调，收敛器与渲染层共用。 */
export const SIGNATURE_IMAGE_WIDTH_RATIO_RANGE = { min: 0.02, max: 0.4 };

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
    // 签名图宽度比例（相对画布短边）：签名图只有「宽度」一个尺寸来源，高度按图片自身比例算。
    imageWidthRatio: 0.12,
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
        // 二维码内容由后台配置（FR-23）：这里存的是**目标键**，白名单之外一律回落默认目标 ——
        // 老师端即便把 target 写成一条外链，渲染层也拿不到任何非白名单地址。
        target: normalizeQrTarget(qr.target),
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
      imageWidthRatio: clampRatio(signature.imageWidthRatio, SIGNATURE_IMAGE_WIDTH_RATIO_RANGE, base.signature.imageWidthRatio),
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
 *   4. 展签也一样：`plaqueVisible` / `plaquePosition`（US-011a）由 `buildFramingLayout` 消费 ——
 *      关掉展签时那条带子整条还给作品区，位置为 `top` 时带子挪到开口顶部（作品区跟着下移）。
 */
export function frameSpecRenderView(spec) {
  const flat = frameSpecView(spec);
  if (!isFrameSpecV2(spec)) {
    return { ...flat, shape: 'square', cornerRadiusRatio: 0, lighting: null, matVisible: true, plaqueVisible: true, plaquePosition: 'bottom', overlays: null };
  }
  const v2 = normalizeFrameSpecV2(spec);
  return {
    ...flat,
    shape: v2.frame.shape,
    cornerRadiusRatio: v2.frame.cornerRadiusRatio,
    lighting: hasExplicitFrameLighting(spec) ? { ...v2.frame.lighting } : null,
    matVisible: v2.mat.visible,
    // 展签开关与位置（US-011a 把这两支接进绘制层）：v1 平面 spec 没有展签分组，
    // 回落「显示 + 贴底」—— 与升级前逐像素一致。
    plaqueVisible: v2.plaque.visible,
    plaquePosition: v2.plaque.position,
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

// ---------------------------------------------------------------------------
// 大模型入口（[第二步 US-011c]）：自然语言 → **v2** 装裱参数
//
// 老入口（US-001 时期）只让模型吐 v1 平面字段，形状与水印位置这些 v2 新字段在界面上只能手点。
// 现在提示词直接要求 v2 分组结构 ——「形状建议」（`frame.shape`）与「水印位置建议」
// （`watermark.text.position` / `watermark.logo.position`）是硬要求，其余 v2 分组一并给。
//
// 三条口径：
//   1. 提示词只描述参数与枚举取值（形状四选一、位置走九宫格）；模型**不产图片地址**
//      （Logo / 签名图是管理员上传的素材），也不允许出现相框外的桌面 / 墙面 / 手。
//   2. 输出一律过 `normalizeFrameSpecV2`：未知形状、越界比例、非法位置、脏类型逐字段回落默认，
//      **永不抛错**；`generateFrameSpecV2` 返回信封而不是抛异常 —— 生成失败（云端不通 / 模型没吐
//      JSON）只是 `ok: false` + 一句可读的话，草稿的 spec 一个字不动，「保存到云端」也不被阻塞。
//   3. `mergeGeneratedFrameSpec` 把生成结果并进当前 spec 时**保留素材地址**（Logo / 签名图）：
//      「先生成参数、再上传 Logo」是最自然的操作顺序，不能因为生成把上传结果冲掉。
//
// 回执（`report`）是给管理员看的：建议清单（形状 + 六类位置）说明模型给到了哪些 v2 字段，
// 收敛清单说明模型给的哪些枚举值不合法、被收敛成了什么 —— 界面上与浏览器断言读同一份。
// ---------------------------------------------------------------------------

const SPEC_SYSTEM_V2 = `你是一位展览级装裱设计师。你把老师用自然语言描述的装裱需求，翻译成可由 canvas 精确绘制的几何与色彩参数（v2 分组结构）。

规则：
- 只输出纯色几何构成，不使用任何位图素材：机构 Logo、手写签名图由管理员另行上传，禁止编造图片地址。
- 不要出现相框外的桌面、墙面、影子、手。
- 配色要能托住儿童画：孩子的作品是主角，装裱只负责收边与承托，不能抢色。
- 必须给出**形状建议**：frame.shape 从 square（直角）/ rounded（圆角）/ arch（顶部半圆拱形）/ bevel（四角斜切）中选一个。
- 必须给出**水印位置建议**：watermark.text.position（文字水印）与 watermark.logo.position（机构 Logo）都要给，
  位置只能是九宫格之一：top-left / top-center / top-right / middle-left / middle-center / middle-right / bottom-left / bottom-center / bottom-right。
- 建议显示的水印 / 落款 / 时间要把 visible 写成 true；不显示的元素写 visible: false（此时位置可以省略）。
- 只输出一个 JSON 对象，不要 Markdown、不要代码块、不要解释文字。`;

const SPEC_USER_V2 = (description) => `装裱需求：${description || '安静克制的儿童作品展览装裱，暖白卡纸，浅木外框。'}

请输出这个 JSON 对象（括号里是字段含义与取值范围）：
{
  "canvas": { "background": "画布底色 #RRGGBB" },
  "frame": {
    "shape": "square | rounded | arch | bevel（形状建议，必填）",
    "color": "外框材质色 #RRGGBB",
    "widthRatio": "外框宽度占画布短边的比例，0.012-0.06 之间的小数",
    "cornerRadiusRatio": "圆角半径占画布短边的比例，0-0.5；shape 不是 rounded 时写 0",
    "lighting": { "highlight": "受光面 #RRGGBB", "shadow": "暗部 #RRGGBB", "angle": "光照角度 0-360" }
  },
  "mat": { "visible": true/false, "color": "卡纸颜色 #RRGGBB", "widthRatio": "卡纸宽度比例 0.02-0.12", "innerLine": "卡纸细分隔线 #RRGGBB 或 null" },
  "plaque": { "visible": true/false, "position": "bottom | top", "bg": "展签底色 #RRGGBB", "text": "展签文字色 #RRGGBB", "fontFamily": "serif / sans-serif / Songti SC / STSong / Kaiti SC / STKaiti / Noto Serif SC", "letterSpacing": "0-8 之间的数字" },
  "watermark": {
    "logo": { "visible": true/false, "position": "九宫格位置（必填）", "widthRatio": "0.02-0.4", "opacity": "0-1" },
    "text": { "visible": true/false, "content": "水印文字（可用 {机构名} 占位符）", "position": "九宫格位置（必填）", "fontFamily": "同上字体白名单", "fontSize": "8-200", "color": "#RRGGBB", "opacity": "0-1", "rotateDeg": "-180-180" },
    "qr": { "visible": true/false, "position": "九宫格位置", "sizeRatio": "0.03-0.25" }
  },
  "signature": { "visible": true/false, "mode": "text | image", "position": "九宫格位置", "fontFamily": "同上字体白名单", "fontSize": "8-200", "color": "#RRGGBB" },
  "date": { "visible": true/false, "source": "lesson | today | manual", "format": "YYYY.MM.DD | YYYY-MM-DD | YYYY年MM月DD日", "prefix": "日期前缀", "position": "九宫格位置", "fontSize": "8-200", "color": "#RRGGBB" },
  "atmosphere": "一句话描述这个装裱的氛围，不超过 40 字",
  "rationale": "为什么这样配色与定位，不超过 40 字"
}`;

const readPath = (value, path) => String(path ?? '')
  .split('.')
  .reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), value);

/**
 * 从模型返回的文本里掐出第一个**括号配平**的 JSON 对象。
 *
 * 比「第一个 `{` 到最后一个 `}`」稳：模型在 JSON 前后各写一句解释（解释里又带一个 `}`）时，
 * 后者会把两段拼成一个非法 JSON。字符串里的括号与转义引号要跳过，否则 `{"content":"{机构名}"}`
 * 会在第一个 `}` 就提前收尾。
 */
export function extractFrameSpecJsonText(text) {
  const raw = String(text ?? '');
  const start = raw.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, index + 1);
    }
  }
  return '';
}

/**
 * 模型输出 → JSON 对象。完全取不出可解析对象时返回 `null`（调用方给可读文案），**不抛错**：
 * 解析失败是模型的问题，不该变成页面上的一个异常。
 */
export function parseFrameSpecModelOutput(text) {
  const jsonText = extractFrameSpecJsonText(text);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    return isPlainObject(parsed) ? parsed : null;
  } catch { return null; }
}

/**
 * 生成回执关注的字段（点分路径 + 中文名）。`suggest: true` 的就是界面上的**建议清单** ——
 * 形状与水印位置是 US-011c 验收点名的两项，其余位置/字体/来源/格式是同一批枚举参数的收敛点名。
 */
export const FRAME_SPEC_GENERATION_FIELDS = [
  { path: 'frame.shape', label: '形状', suggest: true },
  { path: 'frame.texture', label: '纹理', suggest: false },
  { path: 'plaque.position', label: '展签位置', suggest: true },
  { path: 'plaque.fontFamily', label: '展签字体', suggest: false },
  { path: 'watermark.logo.position', label: '机构 Logo 位置', suggest: true },
  { path: 'watermark.text.position', label: '文字水印位置', suggest: true },
  { path: 'watermark.text.fontFamily', label: '文字水印字体', suggest: false },
  { path: 'watermark.qr.position', label: '二维码位置', suggest: true },
  { path: 'watermark.qr.target', label: '二维码目标', suggest: false },
  { path: 'signature.mode', label: '落款形式', suggest: false },
  { path: 'signature.position', label: '落款位置', suggest: true },
  { path: 'signature.fontFamily', label: '落款字体', suggest: false },
  { path: 'signature.seal.shape', label: '印章形状', suggest: false },
  { path: 'date.source', label: '时间来源', suggest: false },
  { path: 'date.format', label: '时间格式', suggest: false },
  { path: 'date.position', label: '时间位置', suggest: true }
];

const PLAQUE_POSITION_LABELS = { bottom: '贴在作品区下方', top: '贴在作品区上方' };

/** 枚举值的中文展示名：形状与九宫格位置走各自的**真源标签**，其余原样显示。 */
export function frameSpecFieldValueLabel(path, value) {
  const raw = String(value ?? '');
  if (path === 'frame.shape') return frameShapeLabel(raw) || raw;
  if (path === 'plaque.position') return PLAQUE_POSITION_LABELS[raw] || raw;
  if (path.endsWith('.position')) return overlayPositionLabel(raw);
  return raw;
}

/**
 * 生成回执：`{ suggestions, converged }`。
 *
 * - `suggestions`：**实际生效**的 v2 字段值（形状 + 六类位置）——说「填充到了 v2 新字段」要有据可查，
 *   所以读的是收敛后的 spec，而不是模型的原始 JSON（模型给了非法形状时这里显示的是收敛结果）。
 * - `converged`：模型给了、但因非法被收敛掉的枚举值（原值 → 生效值）。只点名枚举类路径：
 *   数字类的「0.0412 → 0.0412」之类的比对只会产生噪声。
 */
export function frameSpecGenerationReport(rawJson, spec) {
  const v2 = normalizeFrameSpecV2(spec);
  const suggestions = FRAME_SPEC_GENERATION_FIELDS
    .filter((entry) => entry.suggest)
    .map((entry) => {
      const value = String(readPath(v2, entry.path) ?? '');
      return { path: entry.path, label: entry.label, value, text: frameSpecFieldValueLabel(entry.path, value) };
    });
  const converged = FRAME_SPEC_GENERATION_FIELDS
    .map((entry) => {
      const given = readPath(rawJson, entry.path);
      if (typeof given !== 'string') return null;
      const trimmed = given.trim();
      const applied = String(readPath(v2, entry.path) ?? '');
      if (!trimmed || trimmed === applied) return null;
      return {
        path: entry.path,
        label: entry.label,
        from: trimmed,
        to: applied,
        text: frameSpecFieldValueLabel(entry.path, applied)
      };
    })
    .filter(Boolean);
  return { suggestions, converged };
}

/**
 * 把生成结果并进当前 spec：模型产出的分组覆盖旧的，**素材地址保留**（Logo / 签名图是上传来的）。
 * 顺带修一个「模式与素材打架」的边界：模型建议 `image` 落款模式但模板上没有任何签名图时回落文字模式 ——
 * 否则落款整块在成品图上直接消失（`planOverlaySignature` 对「图片模式 + 空地址」返回 null）。
 */
export function mergeGeneratedFrameSpec(current, generated) {
  const next = normalizeFrameSpecV2(generated);
  const logoUrl = next.watermark.logo.url || imageUrl(readPath(current, 'watermark.logo.url'));
  const signatureImage = next.signature.imageUrl || imageUrl(readPath(current, 'signature.imageUrl'));
  return normalizeFrameSpecV2({
    ...next,
    watermark: { ...next.watermark, logo: { ...next.watermark.logo, url: logoUrl } },
    signature: {
      ...next.signature,
      imageUrl: signatureImage,
      mode: next.signature.mode === 'image' && !signatureImage ? 'text' : next.signature.mode
    }
  });
}

/**
 * 调用大模型把自然语言需求翻译成 **v2** 装裱参数（形状建议 + 水印位置建议是硬要求）。
 *
 * 返回信封 `{ ok, model, spec, raw, report, message }`：
 * - `ok: true` 时 `spec` 是收敛后的 v2 结构，`report` 是建议 / 收敛清单；
 * - `ok: false` 时 `spec` 为 `null`、`message` 是一句可读的话（云端不通 / 模型没吐 JSON 对象）。
 * **任何失败都不抛错**：生成只是一次参数填充，草稿与「保存到云端」都不受它影响。
 */
export async function generateFrameSpecV2(description, { signal } = {}) {
  let text = '';
  try {
    for await (const chunk of cloud.llm.chat.completions.create({
      model: SPEC_MODEL,
      messages: [
        { role: 'system', content: SPEC_SYSTEM_V2 },
        { role: 'user', content: SPEC_USER_V2(description) }
      ],
      stream: true,
      response_format: { type: 'json_object' },
      temperature: 0.5,
      signal
    })) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) text += delta.content;
    }
  } catch (error) {
    return {
      ok: false,
      model: SPEC_MODEL,
      spec: null,
      raw: null,
      report: null,
      message: `装裱参数生成失败：${error?.message || '模型服务暂时不可用'}；可稍后重试，或直接用下面的参数面板手动调整。`
    };
  }
  const raw = parseFrameSpecModelOutput(text);
  if (!raw) {
    return {
      ok: false,
      model: SPEC_MODEL,
      spec: null,
      raw: null,
      report: null,
      message: '模型没有返回可解析的装裱参数（不是一个 JSON 对象），请调整描述后重试。'
    };
  }
  const spec = normalizeFrameSpecV2(raw);
  return { ok: true, model: SPEC_MODEL, spec, raw, report: frameSpecGenerationReport(raw, spec), message: '' };
}
