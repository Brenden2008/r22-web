const CRC32_TABLE = new Uint32Array(256);

for (let i = 0; i < 256; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  CRC32_TABLE[i] = value >>> 0;
}

export function bytesToHex(bytes, separator = " ") {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(separator);
}

export function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function textToBytes(text) {
  return new TextEncoder().encode(text);
}

export function mmToDots(mm, dpi = 203) {
  return Math.round((mm / 25.4) * dpi);
}

export function mmToR22Dots(mm) {
  return Math.round(mm * 8);
}

export function crc32Rt(bytes, seed = 0x008967ca) {
  let crc = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (index === 0) {
      crc = (CRC32_TABLE[(byte ^ 0xde) & 0xff] ^ seed) >>> 0;
    } else {
      crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
    }
  }
  return (~crc) >>> 0;
}

export function crc32RtSdk(bytes, seed = 0x76953521) {
  let crc = (~seed) >>> 0;
  for (const byte of bytes) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (~crc) >>> 0;
}

export function crc16Ccitt(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc;
}

export function bytesToBase64(bytes) {
  let binary = "";
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + blockSize));
  }
  return btoa(binary);
}

function leftRotate(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

export function md5Hex(inputBytes) {
  const bytes = inputBytes instanceof Uint8Array ? inputBytes : textToBytes(String(inputBytes));
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;

  for (let index = 0; index < 8; index += 1) {
    data[paddedLength - 8 + index] = (bitLength / (2 ** (8 * index))) & 0xff;
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const constants = new Uint32Array(64);
  for (let i = 0; i < 64; i += 1) {
    constants[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  }

  for (let offset = 0; offset < data.length; offset += 64) {
    const words = new Uint32Array(16);
    for (let i = 0; i < 16; i += 1) {
      const base = offset + i * 4;
      words[i] = (
        data[base] |
        (data[base + 1] << 8) |
        (data[base + 2] << 16) |
        (data[base + 3] << 24)
      ) >>> 0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const nextD = c;
      const nextC = b;
      const sum = (a + f + constants[i] + words[g]) >>> 0;
      b = (b + leftRotate(sum, shifts[i])) >>> 0;
      a = d;
      d = nextD;
      c = nextC;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const digest = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((word, wordIndex) => {
    digest[wordIndex * 4] = word & 0xff;
    digest[wordIndex * 4 + 1] = (word >>> 8) & 0xff;
    digest[wordIndex * 4 + 2] = (word >>> 16) & 0xff;
    digest[wordIndex * 4 + 3] = (word >>> 24) & 0xff;
  });
  return bytesToHex(digest, "");
}

export function r22AuthDigest(authCode) {
  const salt = "D932A43C3084B1D3";
  const digest = md5Hex(`${authCode}${salt}`);
  return digest.slice(8, 24);
}

export function r22OdmDigest(odmCode = "") {
  const digest = md5Hex(`${odmCode}D932A43C3084B1D3`);
  return `${digest.slice(8, 16)}${digest.slice(22, 24)}${digest.slice(20, 22)}${digest.slice(18, 20)}${digest.slice(16, 18)}`;
}

export function readRtPackets(bytes) {
  const packets = [];
  const source = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let offset = 0;

  while (offset + 15 <= source.length) {
    if (source[offset] !== 0xa3 || source[offset + 1] !== 0x1e) {
      offset += 1;
      continue;
    }

    const headerOffset = offset + 2;
    const payloadLength = source[headerOffset + 7] | (source[headerOffset + 8] << 8);
    const totalLength = 2 + 9 + payloadLength + 4;
    if (offset + totalLength > source.length) break;

    const packetBytes = source.slice(offset, offset + totalLength);
    const header = packetBytes.slice(2, 11);
    const payload = packetBytes.slice(11, 11 + payloadLength);
    const command = (header[4] << 16) | header[5] | (header[6] << 8);
    const text = new TextDecoder().decode(payload).replace(/\0+$/g, "");
    let json;
    if (text.trim().startsWith("{")) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    packets.push({
      bytes: packetBytes,
      command,
      header,
      payload,
      text,
      json,
    });
    offset += totalLength;
  }

  return {
    packets,
    remainder: source.slice(offset),
  };
}

export function parseBatteryStatus(packetOrJson) {
  const json = packetOrJson?.json ?? packetOrJson ?? {};
  const rawPercent = json.batteryPercent ?? json.powerPercent ?? json.percent ?? json.battery;
  const rawState = json.batteryState ?? json.powerState ?? json.state ?? json.charging;
  const percent = rawPercent === undefined || rawPercent === null || rawPercent === ""
    ? undefined
    : Number.parseInt(String(rawPercent), 10);
  const stateText = rawState === undefined || rawState === null ? undefined : String(rawState);
  const charging = stateText === undefined
    ? undefined
    : /^(1|true|charging|charge)$/i.test(stateText);

  return {
    percent: Number.isFinite(percent) ? percent : undefined,
    charging,
    state: stateText,
    raw: json,
  };
}

async function deflateBase64(bytes) {
  if (typeof CompressionStream !== "function") {
    return undefined;
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return bytesToBase64(compressed);
}

function bytesToZplHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function le16(value) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function le32(value) {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

function hexPair(byte) {
  return byte.toString(16).padStart(2, "0");
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

function buildHuffmanTree(bytes) {
  const counts = new Array(256).fill(0);
  for (const byte of bytes) counts[byte] += 1;

  const symbols = [];
  const weights = [];
  for (let symbol = 0; symbol < 256; symbol += 1) {
    if (counts[symbol] > 0) {
      symbols.push(symbol);
      weights.push(counts[symbol]);
    }
  }

  if (symbols.length === 1) {
    symbols.push(symbols[0] >= 0x80 ? symbols[0] - 1 : symbols[0] + 1);
    weights.push(1);
  }

  const leafCount = symbols.length;
  const totalCount = leafCount * 2 - 1;
  const nodes = Array.from({ length: totalCount }, (_, index) => ({
    weight: index < leafCount ? weights[index] : 0,
    left: -1,
    right: -1,
    parent: -1,
    symbol: index < leafCount ? symbols[index] : 0x100 + index - leafCount,
    bits: [],
  }));

  for (let index = leafCount; index < totalCount; index += 1) {
    const first = minParentlessNode(nodes, index);
    nodes[first].parent = index;
    const second = minParentlessNode(nodes, index);
    nodes[second].parent = index;
    nodes[index].left = first;
    nodes[index].right = second;
    nodes[index].weight = nodes[first].weight + nodes[second].weight;
  }

  for (let index = 0; index < leafCount; index += 1) {
    const bits = [];
    let cursor = index;
    let parent = nodes[cursor].parent;
    while (parent !== -1) {
      bits.push(nodes[parent].left === cursor ? 0 : 1);
      cursor = parent;
      parent = nodes[cursor].parent;
    }
    nodes[index].bits = bits.reverse();
  }

  const symbolToBits = new Map();
  for (let index = 0; index < leafCount; index += 1) {
    symbolToBits.set(nodes[index].symbol, nodes[index].bits);
  }
  return { nodes, leafCount, symbolToBits };
}

function minParentlessNode(nodes, limit) {
  let best = -1;
  for (let index = 0; index < limit; index += 1) {
    if (nodes[index].parent !== -1) continue;
    if (best === -1 || nodes[index].weight < nodes[best].weight) best = index;
  }
  return best;
}

function huffmanTreePayload(bytes) {
  const { nodes } = buildHuffmanTree(bytes);
  const values = [];
  const root = nodes.length - 1;

  function preorder(index) {
    values.push(nodes[index].symbol);
    if (nodes[index].left !== -1) preorder(nodes[index].left);
    if (nodes[index].right !== -1) preorder(nodes[index].right);
  }

  function inorder(index) {
    if (nodes[index].left !== -1) inorder(nodes[index].left);
    values.push(nodes[index].symbol);
    if (nodes[index].right !== -1) inorder(nodes[index].right);
  }

  preorder(root);
  inorder(root);

  const payload = new Uint8Array(values.length * 2);
  values.forEach((value, index) => {
    payload[index * 2] = value & 0xff;
    payload[index * 2 + 1] = (value >>> 8) & 0xff;
  });
  return payload;
}

function huffmanDataBags(bytes, widthBytes, maxBagBytes) {
  const { symbolToBits } = buildHuffmanTree(bytes);
  const rowCount = Math.floor(bytes.length / widthBytes);
  const rowBitCounts = [];
  const bitStream = [];

  for (let row = 0; row < rowCount; row += 1) {
    let rowBits = 0;
    const rowOffset = row * widthBytes;
    for (let index = 0; index < widthBytes; index += 1) {
      const bits = symbolToBits.get(bytes[rowOffset + index]) ?? [];
      rowBits += bits.length;
      bitStream.push(...bits);
    }
    rowBitCounts.push(rowBits);
  }

  const maxBits = Math.max(1, maxBagBytes * 8 - 8);
  const bagBitCounts = [];
  let running = 0;
  for (const rowBits of rowBitCounts) {
    if (running > 0 && running + rowBits >= maxBits) {
      bagBitCounts.push(running);
      running = rowBits;
    } else {
      running += rowBits;
    }
  }
  bagBitCounts.push(running);

  const bags = [];
  let offset = 0;
  for (const bitCount of bagBitCounts) {
    const padding = (8 - (bitCount % 8)) % 8;
    const packed = new Uint8Array(1 + Math.ceil(bitCount / 8));
    packed[0] = padding;
    for (let index = 0; index < bitCount + padding; index += 1) {
      const bit = index < bitCount ? bitStream[offset + index] : 0;
      if (bit) packed[1 + Math.floor(index / 8)] |= 0x80 >>> (index % 8);
    }
    offset += bitCount;
    bags.push(packed);
  }
  return bags;
}

export class R22Protocol {
  constructor({
    printerType = 0x1c,
    printerHeader = [0xa3, 0x1e],
    crcSeed = 0x008967ca,
    encrypted = false,
  } = {}) {
    this.printerType = printerType;
    this.printerHeader = Uint8Array.from(printerHeader);
    this.crcSeed = crcSeed >>> 0;
    this.encrypted = encrypted;
  }

  commandId(superCode, subCode, type = 0x01) {
    return ((type & 0xff) << 16) | ((subCode & 0xff) << 8) | (superCode & 0xff);
  }

  commandPacket(superCode, subCode, payload = new Uint8Array(), options = {}) {
    return this.packet(this.commandId(superCode, subCode, options.type ?? 0x01), payload, options);
  }

  packet(command, payload = new Uint8Array(), { encrypted = this.encrypted } = {}) {
    const body = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
    if (body.length > 0xffff) {
      throw new RangeError("R22 payloads are limited to 65535 bytes");
    }

    const commandType = (command >>> 16) & 0xff;
    const commandWord = command & 0xffff;
    const flagByte = encrypted ? 0x20 : 0x00;
    const header = new Uint8Array(9);
    const lengthWithCommand = body.length + 5;

    header[0] = this.printerType & 0xff;
    header[1] = flagByte;
    header[2] = lengthWithCommand & 0xff;
    header[3] = (lengthWithCommand >>> 8) & 0xff;
    header[4] = commandType;
    header[5] = commandWord & 0xff;
    header[6] = (commandWord >>> 8) & 0xff;
    header[7] = body.length & 0xff;
    header[8] = (body.length >>> 8) & 0xff;

    const crcInput = concatBytes([header.slice(4), body]);
    const crcValue = commandType >= 0x10 ? crc32RtSdk(crcInput) : crc32Rt(crcInput, this.crcSeed);
    const crc = Uint8Array.from(le32(crcValue));
    return concatBytes([this.printerHeader, header, body, crc]);
  }

  connectProtocolPackets() {
    if (this.printerType !== 0xa3 && this.printerType !== 0x1e) {
      return [
        this.commandPacket(0x01, 0x01),
        this.commandPacket(0x01, 0x06),
      ];
    }
    return [this.commandPacket(0x00, 0x01)];
  }

  handshakePackets(date = new Date()) {
    const unixSeconds = Math.floor(date.getTime() / 1000);
    const timezoneOffsetSeconds = -date.getTimezoneOffset() * 60;
    const localEpochSeconds = (unixSeconds + timezoneOffsetSeconds) >>> 0;

    return [
      this.commandPacket(0x00, 0x01),
      this.commandPacket(0x01, 0x03),
      this.commandPacket(0x01, 0x04),
      this.commandPacket(0x01, 0x19, Uint8Array.from(le32(localEpochSeconds))),
    ];
  }

  r22AuthHandshakePackets(authCode) {
    const digest = r22AuthDigest(authCode);
    return this.r22HandshakePackets({ digest });
  }

  r22HandshakePackets({
    digest = r22OdmDigest(""),
  } = {}) {
    const nonce = [...randomBytes(8)].map(hexPair).join("");
    const noncePayload = textToBytes(nonce);
    const authPayload = textToBytes(digest);
    const shakePayload = new Uint8Array(3 + noncePayload.length);
    shakePayload[0] = 0x01;
    shakePayload[1] = 0x10;
    shakePayload[2] = 0x00;
    shakePayload.set(noncePayload, 3);

    return [
      this.packet(0x010201, authPayload),
      this.packet(0x011701, shakePayload),
      this.packet(0x010301),
      this.packet(0x010401),
      this.packet(this.printerType === 0xa3 ? 0x01020e01 : 0x010e01),
    ];
  }

  memoryQueryPacket() {
    return this.commandPacket(0x01, 0x1f);
  }

  batteryStatusPacket() {
    return this.commandPacket(0x01, 0x0e);
  }

  selfTestPacket() {
    return this.commandPacket(0x05, 0x09);
  }

  imageCommandPacket(superCode, subCode, payload = new Uint8Array()) {
    return this.commandPacket(superCode, subCode, payload, { type: 0x11 });
  }

  imageDataCommandPacket(superCode, subCode, payload = new Uint8Array()) {
    return this.commandPacket(superCode, subCode, payload, { type: 0x10 });
  }

  imageStartPacket(widthDots, heightDots, {
    paperType = 1,
    paperGap = 0,
    isLast = true,
  } = {}) {
    const normalizedPaperType = paperType === 1 || paperType === 3 ? paperType : 0;
    const payload = Uint8Array.from([
      ...le16(widthDots),
      ...le16(heightDots),
      normalizedPaperType,
      paperGap & 0xff,
      isLast ? 1 : 0,
    ]);
    return this.imageCommandPacket(0x05, 0x0b, payload);
  }

  imageDataPackets(monoBytes, widthDots, {
    maxPayloadBytes = 480,
  } = {}) {
    const widthBytes = Math.ceil(widthDots / 8);
    const bytes = monoBytes instanceof Uint8Array ? monoBytes : Uint8Array.from(monoBytes);
    const lineCount = Math.max(1, Math.floor((maxPayloadBytes - 11) / widthBytes));
    const chunkDataSize = lineCount * widthBytes;
    const packets = [];

    let chunkIndex = 0;
    let byteOffset = 0;
    let rowOffset = 0;

    while (byteOffset < bytes.length) {
      const data = bytes.slice(byteOffset, byteOffset + chunkDataSize);
      const dataLengthPlus7 = data.length + 7;
      const payload = new Uint8Array(11 + data.length);

      payload[0] = chunkIndex & 0xff;
      payload[1] = (chunkIndex >>> 8) & 0xff;
      payload[2] = dataLengthPlus7 & 0xff;
      payload[3] = (dataLengthPlus7 >>> 8) & 0xff;
      payload[4] = 1;
      payload[5] = widthBytes & 0xff;
      payload[6] = (widthBytes >>> 8) & 0xff;
      payload[7] = rowOffset & 0xff;
      payload[8] = (rowOffset >>> 8) & 0xff;
      payload[9] = 0;
      payload[10] = 0;
      payload.set(data, 11);

      packets.push(this.imageDataCommandPacket(0x05, 0x0d, payload));
      byteOffset += data.length;
      rowOffset += Math.floor(data.length / widthBytes);
      chunkIndex += 1;
    }

    return packets;
  }

  imageEndPacket() {
    return this.imageCommandPacket(0x05, 0x0c);
  }

  compressedImagePackets(monoBytes, widthDots, {
    maxBagBytes = 1000,
  } = {}) {
    const widthBytes = Math.ceil(widthDots / 8);
    const bytes = monoBytes instanceof Uint8Array ? monoBytes : Uint8Array.from(monoBytes);
    const treePayload = huffmanTreePayload(bytes);
    const packets = [this.imageCommandPacket(0x05, 0x0e, treePayload)];

    huffmanDataBags(bytes, widthBytes, maxBagBytes).forEach((bag, chunkIndex) => {
      const payload = new Uint8Array(11 + bag.length);
      const encodedSize = bag.length + 7;
      payload[0] = chunkIndex & 0xff;
      payload[1] = (chunkIndex >>> 8) & 0xff;
      payload[2] = encodedSize & 0xff;
      payload[3] = (encodedSize >>> 8) & 0xff;
      payload[4] = 0x11;
      payload[5] = widthBytes & 0xff;
      payload[6] = (widthBytes >>> 8) & 0xff;
      payload.set(bag, 11);
      packets.push(this.imageDataCommandPacket(0x05, 0x0d, payload));
    });

    return packets;
  }

  printBitmapPackets(monoBytes, widthDots, heightDots, options = {}) {
    if (options.compressed) {
      return [
        this.imageStartPacket(widthDots, heightDots, options),
        ...this.compressedImagePackets(monoBytes, widthDots, options),
        this.imageEndPacket(),
      ];
    }

    return [
      this.imageStartPacket(widthDots, heightDots, options),
      ...this.imageDataPackets(monoBytes, widthDots, options),
      this.imageEndPacket(),
    ];
  }
}

export function renderLabelToMonoBytes(canvas, {
  threshold = 160,
  invert = false,
} = {}) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height);
  const widthBytes = Math.ceil(width / 8);
  const out = new Uint8Array(widthBytes * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = image.data[index + 3] / 255;
      const luminance = (
        image.data[index] * 0.299 +
        image.data[index + 1] * 0.587 +
        image.data[index + 2] * 0.114
      ) * alpha + 255 * (1 - alpha);
      const black = invert ? luminance > threshold : luminance < threshold;

      if (black) {
        out[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return out;
}

export async function buildR22ZplFromCanvas(canvas, {
  widthMm = 50,
  heightMm = 30,
  density = 15,
  copies = 1,
  threshold = 160,
  invert = false,
  compressed = true,
  maxChunkBytes = 0x5000,
} = {}) {
  const widthDots = mmToR22Dots(widthMm);
  const heightDots = mmToR22Dots(heightMm);

  const source = canvas;
  let printCanvas = source;
  if (source.width !== widthDots || source.height !== heightDots) {
    printCanvas = document.createElement("canvas");
    printCanvas.width = widthDots;
    printCanvas.height = heightDots;
    const context = printCanvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, widthDots, heightDots);
    context.imageSmoothingEnabled = true;
    context.drawImage(source, 0, 0, widthDots, heightDots);
  }

  const monoBytes = renderLabelToMonoBytes(printCanvas, { threshold, invert });
  const widthBytes = Math.ceil(widthDots / 8);
  const rowsPerChunk = Math.max(1, Math.floor(maxChunkBytes / widthBytes));
  const chunks = [
    `^XA ^PW${widthDots}\n\r^LL${heightDots}\n\r~SD${density}\r\n`,
  ];

  for (let row = 0; row < heightDots; row += rowsPerChunk) {
    const rows = Math.min(rowsPerChunk, heightDots - row);
    const imageBytes = monoBytes.slice(row * widthBytes, (row + rows) * widthBytes);

    if (compressed) {
      const z64 = await deflateBase64(imageBytes);
      if (z64) {
        const crc = crc16Ccitt(textToBytes(z64)).toString(16).padStart(4, "0").toUpperCase();
        chunks.push(`^FO0,${row}\n^GFA,${imageBytes.length},${imageBytes.length},${widthBytes},:Z64:${z64}:${crc}\n`);
        continue;
      }
    }

    chunks.push(`^FO0,${row}\n^GFA,${imageBytes.length},${imageBytes.length},${widthBytes},${bytesToZplHex(imageBytes)}\n`);
  }

  const normalizedCopies = Math.max(1, Math.floor(copies));
  chunks.push(`^RTPQ${normalizedCopies}^PQ${normalizedCopies}\n\r\n\r^XZ\r\n`);
  return textToBytes(chunks.join(""));
}
