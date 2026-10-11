// 二维码编码（[第二步 US-003c] 的「二维码绘制」）。
//
// 为什么自己写：成品图要把二维码**印在孩子的作品上**，而这是纯计算（输入文本 → 模块矩阵），
// 引第三方库会把这个零依赖的原型拉进一个新的运行时依赖（package.json 现在只有
// react / react-dom / three / lucide-react + 构建工具）。所以这里按 ISO/IEC 18004
// 实现 QR Code Model 2 的编码路径：**byte 模式 + 版本 1–10 + 纠错等级 L / M / Q / H**。
//
// 分工：本模块只产出「哪些格子是黑的」这个布尔矩阵（外加版本 / 等级 / 模块数），
// **不碰 DOM、不碰 canvas** —— 绘制是 `framing.js` 的画笔（那里才有画布）。
// 因此本模块**零依赖**，可以直接 `node xxx.mjs` 跑断言（与 `frameShapes.js` /
// `overlayLayout.js` 同一个口径）。
//
// 正确性口径（别凭印象改表）：矩阵用 OpenCV 的参考实现对照 + 用 OpenCV 的识别器回读验证。
// 表里的 RS 分块结构一旦写错，矩阵看起来仍然「像个二维码」，但扫不出来 ——
// 这正是必须靠独立识别器验证、而不能只看「画面上有个方块」的原因。

/** 支持的纠错等级。 */
export const QR_ECC_LEVELS = ['L', 'M', 'Q', 'H'];

/** 默认纠错等级：M（约 15% 冗余，印刷 / 拍照场景的常规选择）。 */
export const QR_DEFAULT_ECC = 'M';

/** 支持的最大版本（版本 N 的边长 = 4N + 17；10 版是 57×57，足以放下一条分享链接）。 */
export const QR_MAX_VERSION = 10;

/**
 * 纠错等级在**格式信息**里的两位编码（ISO/IEC 18004 表 25）。
 * 注意不是 0/1/2/3 —— M 是 00、L 是 01、H 是 10、Q 是 11（按纠错能力排的名，不是按字母序）。
 */
const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

/**
 * Reed-Solomon 分块结构（ISO/IEC 18004 表 9）：`[每块纠错码字数, [[块数, 每块数据码字数], …]]`。
 *
 * 一个版本的「总码字数」= 各块数据码字之和 + 每块纠错码字 × 块数，所以不必另存一份总数表。
 * 高版本的数据码字会在块间差 1（`[2,15],[2,16]` 这种写法），**顺序不能颠倒**：
 * 交错放置时先放所有块的第 0 个数据码字、再放第 1 个……差 1 的那几块在末尾自然对齐。
 */
const RS_TABLE = {
  1: { L: [7, [[1, 19]]], M: [10, [[1, 16]]], Q: [13, [[1, 13]]], H: [17, [[1, 9]]] },
  2: { L: [10, [[1, 34]]], M: [16, [[1, 28]]], Q: [22, [[1, 22]]], H: [28, [[1, 16]]] },
  3: { L: [15, [[1, 55]]], M: [26, [[1, 44]]], Q: [18, [[2, 17]]], H: [22, [[2, 13]]] },
  4: { L: [20, [[1, 80]]], M: [18, [[2, 32]]], Q: [26, [[2, 24]]], H: [16, [[4, 9]]] },
  5: { L: [26, [[1, 108]]], M: [24, [[2, 43]]], Q: [18, [[2, 15], [2, 16]]], H: [22, [[2, 11], [2, 12]]] },
  6: { L: [18, [[2, 68]]], M: [16, [[4, 27]]], Q: [24, [[4, 19]]], H: [28, [[4, 15]]] },
  7: { L: [20, [[2, 78]]], M: [18, [[4, 31]]], Q: [18, [[2, 14], [4, 15]]], H: [26, [[4, 13], [1, 14]]] },
  8: { L: [24, [[2, 97]]], M: [22, [[2, 38], [2, 39]]], Q: [22, [[4, 18], [2, 19]]], H: [26, [[4, 14], [2, 15]]] },
  9: { L: [30, [[2, 116]]], M: [22, [[3, 36], [2, 37]]], Q: [20, [[4, 16], [4, 17]]], H: [24, [[4, 12], [4, 13]]] },
  10: { L: [18, [[2, 68], [2, 69]]], M: [26, [[4, 43], [1, 44]]], Q: [24, [[6, 19], [2, 20]]], H: [28, [[6, 15], [2, 16]]] }
};

/** 校正图形（alignment pattern）的中心坐标（ISO/IEC 18004 附录 E，版本 1–10）。 */
const ALIGNMENT_CENTERS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50]
};

/** 版本 N 的边长（模块数）。非法版本返回 0。 */
export function qrModuleCount(version) {
  const v = Math.round(Number(version));
  return v >= 1 && v <= 40 ? v * 4 + 17 : 0;
}

/** 该版本 + 等级的**数据码字**容量；版本或等级不认识时返回 0。 */
export function qrDataCodewords(version, ecc = QR_DEFAULT_ECC) {
  const row = RS_TABLE[Math.round(Number(version))];
  if (!row) return 0;
  const entry = row[String(ecc).toUpperCase()] || row[QR_DEFAULT_ECC];
  if (!entry) return 0;
  return entry[1].reduce((sum, [count, data]) => sum + count * data, 0);
}

const utf8Bytes = (text) => {
  const bytes = [];
  for (const char of String(text ?? '')) {
    const code = char.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
};

/** UTF-8 字节数（byte 模式的容量按字节算：中文 1 字 = 3 字节，面板提示长度时用它）。 */
export function qrByteLength(text) {
  return utf8Bytes(text).length;
}

/** 该版本 + 等级下 byte 模式能放的**字节数**（模式指示符 4 bit 与字符数字段也要占位）。 */
export function qrByteCapacity(version, ecc = QR_DEFAULT_ECC) {
  const codewords = qrDataCodewords(version, ecc);
  if (!codewords) return 0;
  const lengthBits = Math.round(Number(version)) <= 9 ? 8 : 16;
  return Math.max(0, Math.floor((codewords * 8 - 4 - lengthBits) / 8));
}

/** 自动选版本：装得下这段文本的最小版本；超出 `QR_MAX_VERSION` 的容量返回 0（调用方不绘制）。 */
export function qrVersionFor(text, ecc = QR_DEFAULT_ECC) {
  const bytes = utf8Bytes(text).length;
  for (let version = 1; version <= QR_MAX_VERSION; version += 1) {
    if (qrByteCapacity(version, ecc) >= bytes) return version;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// GF(256) 与 Reed-Solomon
// ---------------------------------------------------------------------------

/** 本原多项式 x^8 + x^4 + x^3 + x^2 + 1（0x11D），QR 规范指定。 */
const GF_PRIMITIVE = 0x11d;
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= GF_PRIMITIVE;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

/** 生成多项式 `(x-α^0)(x-α^1)…(x-α^(n-1))`，系数按**最高次在前**排列，首项恒为 1。 */
function rsGeneratorPoly(ecCount) {
  let poly = [1];
  for (let i = 0; i < ecCount; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** 对一块数据码字求纠错码字（综合除法取余；除数首项为 1，所以不需要真除法）。 */
function rsEncode(data, ecCount) {
  const generator = rsGeneratorPoly(ecCount);
  const buffer = data.concat(new Array(generator.length - 1).fill(0));
  for (let i = 0; i < data.length; i += 1) {
    const coefficient = buffer[i];
    if (coefficient === 0) continue;
    for (let j = 0; j < generator.length; j += 1) {
      buffer[i + j] ^= gfMul(generator[j], coefficient);
    }
  }
  return buffer.slice(data.length);
}

// ---------------------------------------------------------------------------
// 码字
// ---------------------------------------------------------------------------

/** 模式指示符 + 字符数 + 数据字节 → 定长的数据码字（含终止符与 0xEC / 0x11 补位）。 */
function buildDataCodewords(bytes, version, ecc) {
  const capacity = qrDataCodewords(version, ecc);
  if (!capacity) return null;
  const lengthBits = version <= 9 ? 8 : 16;
  const bits = [];
  const push = (value, count) => { for (let i = count - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
  push(0b0100, 4); // byte 模式
  push(bytes.length, lengthBits);
  for (const byte of bytes) push(byte, 8);
  if (bits.length > capacity * 8) return null;

  const terminator = Math.min(4, capacity * 8 - bits.length);
  push(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < capacity) {
    codewords.push(pads[padIndex % 2]);
    padIndex += 1;
  }
  return codewords;
}

/** 按分块结构切块、各自求纠错，再按 QR 的规矩**交错**排成最终码字序列。 */
function interleaveCodewords(dataCodewords, version, ecc) {
  const [ecCount, groups] = RS_TABLE[version][ecc];
  const blocks = [];
  let offset = 0;
  for (const [count, dataCount] of groups) {
    for (let i = 0; i < count; i += 1) {
      const data = dataCodewords.slice(offset, offset + dataCount);
      offset += dataCount;
      blocks.push({ data, ec: rsEncode(data, ecCount) });
    }
  }
  const out = [];
  const maxData = blocks.reduce((max, block) => Math.max(max, block.data.length), 0);
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  for (let i = 0; i < ecCount; i += 1) {
    for (const block of blocks) out.push(block.ec[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 矩阵
// ---------------------------------------------------------------------------

/** 掩码公式（ISO/IEC 18004 表 10）：`i` = 行、`j` = 列。 */
const MASK_PATTERNS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0
];

/** 格式信息的 BCH(15,5)：生成多项式 0x537，结果再与 0x5412 异或（规范硬性要求）。 */
function formatInfoBits(dataBits) {
  let remainder = dataBits << 10;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if (remainder & (1 << bit)) remainder ^= 0x537 << (bit - 10);
  }
  return ((dataBits << 10) | remainder) ^ 0x5412;
}

/** 版本信息的 BCH(18,6)：生成多项式 0x1F25（只用于版本 ≥ 7）。 */
function versionInfoBits(version) {
  let remainder = version << 12;
  for (let bit = 17; bit >= 12; bit -= 1) {
    if (remainder & (1 << bit)) remainder ^= 0x1f25 << (bit - 12);
  }
  return (version << 12) | remainder;
}

/** 定位图案（三个角上的回字）+ 它四周的 1 模块分隔带（用 `-1` 起止把它一起划进功能模块区）。 */
function setupFinder(modules, row, col) {
  const size = modules.length;
  for (let r = -1; r <= 7; r += 1) {
    if (row + r < 0 || row + r >= size) continue;
    for (let c = -1; c <= 7; c += 1) {
      if (col + c < 0 || col + c >= size) continue;
      modules[row + r][col + c] = (r >= 0 && r <= 6 && (c === 0 || c === 6))
        || (c >= 0 && c <= 6 && (r === 0 || r === 6))
        || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
    }
  }
}

/** 定时图案：第 6 行 / 第 6 列上的交替深浅。 */
function setupTiming(modules) {
  const size = modules.length;
  for (let i = 8; i < size - 8; i += 1) {
    if (modules[i][6] === null) modules[i][6] = i % 2 === 0;
    if (modules[6][i] === null) modules[6][i] = i % 2 === 0;
  }
}

/** 校正图案：5×5 的回字，画在「两个定位带之间」的坐标上（与定位图案重叠的跳过）。 */
function setupAlignment(modules, version) {
  for (const row of ALIGNMENT_CENTERS[version] || []) {
    for (const col of ALIGNMENT_CENTERS[version] || []) {
      if (modules[row][col] !== null) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          modules[row + r][col + c] = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
        }
      }
    }
  }
}

/** 写入格式信息（左上竖列 + 左上横排两段 + 右上横排一段）与 (size-8, 8) 的固定亮模块。 */
function setupFormatInfo(modules, isFunction, ecc, mask) {
  const size = modules.length;
  const bits = formatInfoBits((ECC_FORMAT_BITS[ecc] << 3) | mask);
  const put = (row, col, dark) => { modules[row][col] = dark; isFunction[row][col] = true; };
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >> i) & 1) === 1;
    if (i < 6) put(i, 8, dark);
    else if (i < 8) put(i + 1, 8, dark);
    else put(size - 15 + i, 8, dark);

    if (i < 8) put(8, size - i - 1, dark);
    else if (i < 9) put(8, 15 - i - 1 + 1, dark);
    else put(8, 15 - i - 1, dark);
  }
  put(size - 8, 8, true);
}

/** 写入版本信息（右上与左下两份，只用于版本 ≥ 7）。 */
function setupVersionInfo(modules, isFunction, version) {
  const size = modules.length;
  const bits = versionInfoBits(version);
  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = (i % 3) + size - 8 - 3;
    modules[row][col] = dark; isFunction[row][col] = true;
    modules[col][row] = dark; isFunction[col][row] = true;
  }
}

/**
 * 把最终码字按 QR 的顺序放进数据模块：**从右下角起、两列一组、上下蛇形**，
 * 每个码字高位在前；遇到功能模块跳过；码字用完后剩余的模块填浅色（remainder bits）。
 */
function mapData(modules, isFunction, codewords) {
  const size = modules.length;
  let direction = -1;
  let row = size - 1;
  let bitIndex = 7;
  let byteIndex = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1; // 第 6 列是竖向定时图案，整列跳过
    for (;;) {
      for (let offset = 0; offset < 2; offset += 1) {
        if (isFunction[row][col - offset]) continue;
        let dark = false;
        if (byteIndex < codewords.length) dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
        modules[row][col - offset] = dark;
        bitIndex -= 1;
        if (bitIndex === -1) { byteIndex += 1; bitIndex = 7; }
      }
      row += direction;
      if (row < 0 || row >= size) { row -= direction; direction = -direction; break; }
    }
  }
}

/** 掩码惩罚分（ISO/IEC 18004 表 11 的四条规则，越低越好）。 */
function maskPenalty(modules) {
  const size = modules.length;
  const runScore = (run) => (run >= 5 ? 3 + (run - 5) : 0);
  let penalty = 0;

  // 规则 1：行 / 列上同色连续 ≥5 个模块
  const scanLine = (line) => {
    let score = 0;
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) { run += 1; continue; }
      score += runScore(run);
      run = 1;
    }
    return score + runScore(run);
  };
  for (let i = 0; i < size; i += 1) {
    penalty += scanLine(modules[i]);
    penalty += scanLine(modules.map((row) => row[i]));
  }

  // 规则 2：2×2 同色方块
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const value = modules[row][col];
      if (value === modules[row][col + 1] && value === modules[row + 1][col] && value === modules[row + 1][col + 1]) {
        penalty += 3;
      }
    }
  }

  // 规则 3：行 / 列上出现 1:1:3:1:1 且一侧带 4 个浅色模块的图案
  const patternA = [true, false, true, true, true, false, true, false, false, false, false];
  const patternB = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (line, start, pattern) => pattern.every((value, index) => line[start + index] === value);
  for (let i = 0; i < size; i += 1) {
    const row = modules[i];
    const col = modules.map((line) => line[i]);
    for (let j = 0; j + 11 <= size; j += 1) {
      if (matches(row, j, patternA) || matches(row, j, patternB)) penalty += 40;
      if (matches(col, j, patternA) || matches(col, j, patternB)) penalty += 40;
    }
  }

  // 规则 4：暗模块占比偏离 50% 的幅度（每 5% 扣 10 分）
  let dark = 0;
  for (const row of modules) for (const value of row) if (value) dark += 1;
  penalty += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return penalty;
}

/**
 * 编码：文本 → 二维码矩阵。
 *
 * 返回 `{ text, ecc, version, size, modules }`，`modules` 是 `size × size` 的布尔数组
 * （`true` = 深色模块）。**编码不出来的输入返回 `null`**（空文本 / 超长 / 非法等级），
 * 调用方按「这一支不画」处理 —— 绝不能画一个扫不出来的假二维码印在孩子的作品上。
 */
export function qrMatrix(text, { ecc = QR_DEFAULT_ECC, version = 0 } = {}) {
  const content = String(text ?? '');
  if (!content) return null;
  const level = QR_ECC_LEVELS.includes(String(ecc).toUpperCase()) ? String(ecc).toUpperCase() : QR_DEFAULT_ECC;
  const requested = Math.round(Number(version)) || 0;
  const target = requested >= 1 && requested <= QR_MAX_VERSION ? requested : qrVersionFor(content, level);
  if (!target) return null;

  const codewords = buildDataCodewords(utf8Bytes(content), target, level);
  if (!codewords) return null;
  const finalCodewords = interleaveCodewords(codewords, target, level);

  // 功能图案落位（`isFunction` 与矩阵同步维护：数据填充与掩码都按它跳过）。
  const size = qrModuleCount(target);
  const base = Array.from({ length: size }, () => new Array(size).fill(null));
  setupFinder(base, 0, 0);
  setupFinder(base, size - 7, 0);
  setupFinder(base, 0, size - 7);
  // **校正图案必须画在定时图案之前**：版本 ≥ 7 时校正图案的中心会落在第 6 行 / 第 6 列上
  // （如 v7 的 (6,22)、(22,6)），定时图案只能补空位，顺序反了这些校正图案就整块消失 ——
  // 矩阵看着没变样，但 v7–v10 全部扫不出来（本轮真踩到：v1–v6 正常、v7 起全灭）。
  setupAlignment(base, target);
  setupTiming(base);

  // 挑掩码：每个掩码都算一份完整矩阵，按规范的四条惩罚规则取最低分
  // （同一份内容必须永远挑到同一个掩码 —— 否则「同 spec 只渲染一次」的缓存与
  // 参考实现对照都会失去意义）。
  let best = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = base.map((row) => row.slice());
    const isFunction = base.map((row) => row.map((value) => value !== null));
    setupFormatInfo(candidate, isFunction, level, mask);
    if (target >= 7) setupVersionInfo(candidate, isFunction, target);
    mapData(candidate, isFunction, finalCodewords);
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (isFunction[row][col]) continue;
        if (MASK_PATTERNS[mask](row, col)) candidate[row][col] = !candidate[row][col];
      }
    }
    const penalty = maskPenalty(candidate);
    if (penalty < bestPenalty) { bestPenalty = penalty; best = candidate; }
  }
  if (!best) return null;

  return {
    text: content,
    ecc: level,
    version: target,
    size,
    modules: best.map((row) => row.map((value) => value === true))
  };
}
