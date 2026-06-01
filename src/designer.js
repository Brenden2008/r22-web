import {
  mmToR22Dots,
} from "./protocol.js";
import qrcode from "./vendor/qrcode-generator.mjs";

const CODE39 = {
  0: "nnnwwnwnn",
  1: "wnnwnnnnw",
  2: "nnwwnnnnw",
  3: "wnwwnnnnn",
  4: "nnnwwnnnw",
  5: "wnnwwnnnn",
  6: "nnwwwnnnn",
  7: "nnnwnnwnw",
  8: "wnnwnnwnn",
  9: "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  "$": "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn",
};

const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeEnabled(value) {
  return value === undefined ? true : value;
}

export function normalizeRotation(value) {
  const degrees = Number(value) || 0;
  return ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
}

function jsonClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getPathValue(source, path) {
  return String(path).split(".").reduce((current, key) => (
    current && Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined
  ), source);
}

export function resolveLabelTemplate(value, data = {}) {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key) => {
      const replacement = getPathValue(data, key);
      return replacement === undefined || replacement === null ? match : String(replacement);
    });
  }
  if (Array.isArray(value)) return value.map((item) => resolveLabelTemplate(item, data));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveLabelTemplate(item, data)]));
  }
  return value;
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function loadImage(source) {
  if (
    (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) ||
    (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap)
  ) {
    return Promise.resolve(source);
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${source}`));
    image.src = source;
  });
}

function drawWrappedText(context, text, rect, style) {
  const availableWidth = Math.max(1, rect.width - rect.padding * 2);
  const lines = [];

  function pushWrappedParagraph(paragraph) {
    if (!paragraph) {
      lines.push("");
      return;
    }

    const words = paragraph.split(/(\s+)/);
    let current = "";
    for (const word of words) {
      if (!word) continue;
      const next = `${current}${word}`;
      if (current && context.measureText(next).width > availableWidth) {
        lines.push(current.trimEnd());
        current = word.trimStart();
      } else {
        current = next;
      }
    }
    if (current) lines.push(current.trimEnd());
  }

  String(text).replace(/\r\n?/g, "\n").split("\n").forEach((paragraph) => {
    pushWrappedParagraph(paragraph);
  });

  if (!lines.length) lines.push("");

  function drawLine(line, x, y) {
    if (context.measureText(line).width <= availableWidth || line.length <= 1) {
      context.fillText(line, x, y, availableWidth);
      return [line];
    }

    const chunks = [];
    let current = "";
    for (const char of line) {
      const next = `${current}${char}`;
      if (current && context.measureText(next).width > availableWidth) {
        chunks.push(current);
        current = char;
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);

    let nextY = y;
    for (const chunk of chunks) {
      context.fillText(chunk, x, nextY, availableWidth);
      nextY += style.lineHeight ?? Math.round(style.fontSize * 1.18);
    }
    return chunks;
  }

  const lineHeight = style.lineHeight ?? Math.round(style.fontSize * 1.18);
  const totalHeight = lines.length * lineHeight;
  let y = rect.y + rect.padding + lineHeight / 2;
  if (style.valign === "middle") y = rect.y + rect.height / 2 - totalHeight / 2 + lineHeight / 2;
  if (style.valign === "bottom") y = rect.y + rect.height - rect.padding - totalHeight + lineHeight / 2;

  context.textAlign = style.align;
  context.textBaseline = "middle";
  const x = style.align === "right"
    ? rect.x + rect.width - rect.padding
    : style.align === "center"
      ? rect.x + rect.width / 2
      : rect.x + rect.padding;

  for (const line of lines) {
    const drawnLines = drawLine(line, x, y);
    if (style.underline) {
      drawnLines.forEach((drawnLine, index) => {
        const lineY = y + index * lineHeight;
        const metrics = context.measureText(drawnLine);
        const textWidth = Math.min(metrics.width, availableWidth);
        const ux = style.align === "right" ? x - textWidth : style.align === "center" ? x - textWidth / 2 : x;
        context.fillRect(ux, lineY + lineHeight * 0.34, textWidth, Math.max(1, Math.round(style.fontSize / 14)));
      });
    }
    y += lineHeight * drawnLines.length;
  }
}

function barcodeTextHeight(style) {
  return style.showText === false ? 0 : Math.max(8, style.fontSize) + 4;
}

function drawBarcodeText(context, data, rect, style) {
  if (style.showText === false) return;
  context.font = `${Math.max(8, style.fontSize)}px ${style.fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "bottom";
  context.fillText(String(data), rect.x + rect.width / 2, rect.y + rect.height - rect.padding, rect.width - rect.padding * 2);
}

function drawBarcodeUnits(context, units, rect, style) {
  const totalUnits = units.reduce((sum, unit) => sum + unit.width, 0);
  if (totalUnits <= 0) return;
  const innerWidth = Math.max(1, rect.width - rect.padding * 2);
  const module = Math.max(1, Math.floor(innerWidth / totalUnits));
  const actualWidth = module * totalUnits;
  const x0 = Math.round(rect.x + rect.padding + (innerWidth - actualWidth) / 2);
  const y = rect.y + rect.padding;
  const barHeight = Math.max(1, rect.height - rect.padding * 2 - barcodeTextHeight(style));
  let consumed = 0;

  context.fillStyle = "#fff";
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.fillStyle = "#000";
  for (const unit of units) {
    const start = x0 + consumed * module;
    consumed += unit.width;
    const end = x0 + consumed * module;
    if (unit.black && end > start) context.fillRect(start, y, end - start, barHeight);
  }
}

function drawCode39(context, data, rect, style) {
  const text = `*${String(data).toUpperCase().replace(/[^0-9A-Z $./+%-]/g, "-")}*`;
  const quiet = style.quietModules ?? 10;
  const units = [];
  if (quiet > 0) units.push({ width: quiet, black: false });
  for (const char of text) {
    const pattern = CODE39[char] ?? CODE39["-"];
    [...pattern].forEach((item, index) => {
      units.push({ width: item === "w" ? 3 : 1, black: index % 2 === 0 });
    });
    units.push({ width: 1, black: false });
  }
  if (quiet > 0) units.push({ width: quiet, black: false });

  drawBarcodeUnits(context, units, rect, style);
  drawBarcodeText(context, data, rect, style);
}

function encodeCode128B(data) {
  const text = String(data);
  const values = [];
  for (const char of text) {
    const code = char.charCodeAt(0);
    values.push(code >= 32 && code <= 127 ? code - 32 : 31);
  }
  let checksum = 104;
  values.forEach((value, index) => {
    checksum += value * (index + 1);
  });
  return [104, ...values, checksum % 103, 106];
}

function encodeCode128C(data) {
  const text = String(data).replace(/\D/g, "") || "0";
  const values = [];

  if (text.length % 2) {
    values.push(text.charCodeAt(0) - 32);
    if (text.length > 1) values.push(99);
  }

  const start = text.length % 2 ? 1 : 0;
  for (let index = start; index < text.length; index += 2) {
    values.push(Number(text.slice(index, index + 2)));
  }
  let checksum = text.length % 2 ? 104 : 105;
  values.forEach((value, index) => {
    checksum += value * (index + 1);
  });
  return {
    symbols: [text.length % 2 ? 104 : 105, ...values, checksum % 103, 106],
    text,
  };
}

function drawCode128Symbols(context, data, symbols, rect, style) {
  const quiet = style.quietModules ?? 10;
  const units = [];
  if (quiet > 0) units.push({ width: quiet, black: false });
  for (const symbol of symbols) {
    const pattern = CODE128_PATTERNS[symbol];
    [...pattern].forEach((width, index) => {
      units.push({ width: Number(width), black: index % 2 === 0 });
    });
  }
  if (quiet > 0) units.push({ width: quiet, black: false });

  drawBarcodeUnits(context, units, rect, style);
  drawBarcodeText(context, data, rect, style);
}

function drawCode128(context, data, rect, style) {
  drawCode128Symbols(context, data, encodeCode128B(data), rect, style);
}

function drawCode128C(context, data, rect, style) {
  const { symbols, text } = encodeCode128C(data);
  drawCode128Symbols(context, text, symbols, rect, style);
}

export function drawBarcode(context, type, data, rect, style = {}) {
  const normalized = String(type || "CODE128").replace(/[-_\s]/g, "").toUpperCase();
  if (normalized === "CODE128C" || normalized === "CODE128SETC" || normalized === "GS1128") {
    drawCode128C(context, data, rect, style);
    return;
  }
  if (normalized === "CODE39") {
    drawCode39(context, data, rect, style);
    return;
  }
  drawCode128(context, data, rect, style);
}

export function drawQrCode(context, data, rect, style = {}) {
  const qr = qrcode(0, "M");
  qr.addData(String(data));
  qr.make();
  const cells = qr.getModuleCount();
  const quiet = style.quietModules ?? 0;
  const modules = cells + quiet * 2;
  const size = Math.max(1, Math.floor(Math.min(rect.width, rect.height) - rect.padding * 2));
  const x0 = rect.x + rect.padding;
  const y0 = rect.y + rect.padding;

  context.fillStyle = "#fff";
  context.fillRect(x0, y0, size, size);
  context.fillStyle = "#000";

  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      if (!qr.isDark(row, col)) continue;
      const x = Math.round(x0 + ((col + quiet) / modules) * size);
      const y = Math.round(y0 + ((row + quiet) / modules) * size);
      const nextX = Math.round(x0 + ((col + quiet + 1) / modules) * size);
      const nextY = Math.round(y0 + ((row + quiet + 1) / modules) * size);
      if (nextX > x && nextY > y) context.fillRect(x, y, nextX - x, nextY - y);
    }
  }

  if (style.showText) {
    context.font = `${Math.max(8, style.fontSize)}px ${style.fontFamily}`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(String(data), rect.x + rect.width / 2, y0 + size + 4, rect.width);
  }
}

export class R22GridDesign {
  constructor({
    widthMm = 50,
    heightMm = 30,
    columns = 12,
    rows = 6,
    paddingMm = 2,
    gapMm = 1,
    dotsPerMm = 8,
    background = "#fff",
  } = {}) {
    this.widthMm = widthMm;
    this.heightMm = heightMm;
    this.columns = columns;
    this.rows = rows;
    this.paddingMm = paddingMm;
    this.gapMm = gapMm;
    this.dotsPerMm = dotsPerMm;
    this.background = background;
    this.elements = [];
    this.cursor = { row: 0, column: 0, rowSpan: 1, columnSpan: 1 };
    this.styleState = this.defaultStyle();
  }

  defaultStyle() {
    return {
      align: "left",
      valign: "middle",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      fontSize: 22,
      font: "A",
      bold: false,
      underline: false,
      inverse: false,
      lineHeight: undefined,
      padding: Math.max(1, Math.round(0.8 * this.dotsPerMm)),
      showText: true,
    };
  }

  cloneStyle(overrides = {}) {
    return { ...this.styleState, ...overrides };
  }

  grid({ columns = this.columns, rows = this.rows, paddingMm = this.paddingMm, gapMm = this.gapMm } = {}) {
    this.columns = columns;
    this.rows = rows;
    this.paddingMm = paddingMm;
    this.gapMm = gapMm;
    return this;
  }

  cell(row, column, rowSpan = 1, columnSpan = 1) {
    this.cursor = { row, column, rowSpan, columnSpan };
    return this;
  }

  at(options = {}) {
    this.cursor = {
      row: options.row ?? this.cursor.row,
      column: options.column ?? this.cursor.column,
      rowSpan: options.rowSpan ?? this.cursor.rowSpan,
      columnSpan: options.columnSpan ?? this.cursor.columnSpan,
    };
    return this;
  }

  align(alignment = "left") {
    this.styleState.align = alignment;
    return this;
  }

  valign(alignment = "middle") {
    this.styleState.valign = alignment;
    return this;
  }

  font(font = "A") {
    this.styleState.font = font;
    this.styleState.fontFamily = font === "B" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : this.defaultStyle().fontFamily;
    return this;
  }

  fontSize(size) {
    this.styleState.fontSize = size;
    return this;
  }

  lineSpacing(lineSpacingMm) {
    this.styleState.lineHeight = Math.max(1, Math.round(lineSpacingMm * this.dotsPerMm));
    return this;
  }

  charSpacing(charSpacingMm) {
    this.styleState.letterSpacing = Math.max(0, Math.round(charSpacingMm * this.dotsPerMm));
    return this;
  }

  bold(enabled) {
    this.styleState.bold = normalizeEnabled(enabled);
    return this;
  }

  underline(enabled) {
    this.styleState.underline = normalizeEnabled(enabled);
    return this;
  }

  doubleWidth(enabled) {
    this.styleState.doubleWidth = normalizeEnabled(enabled);
    return this;
  }

  doubleHeight(enabled) {
    this.styleState.doubleHeight = normalizeEnabled(enabled);
    return this;
  }

  rotate(degrees = 0) {
    this.styleState.rotation = normalizeRotation(degrees);
    return this;
  }

  inverse(enabled) {
    this.styleState.inverse = normalizeEnabled(enabled);
    return this;
  }

  clearFormatting() {
    this.styleState = this.defaultStyle();
    return this;
  }

  text(text, options = {}) {
    this.elements.push({ kind: "text", text, box: this.elementBox(options), style: this.cloneStyle(options) });
    return this;
  }

  image(source, options = {}) {
    this.elements.push({ kind: "image", source, box: this.elementBox(options), style: this.cloneStyle(options) });
    return this;
  }

  barcode(type, data, options = {}) {
    this.elements.push({ kind: "barcode", type, data, box: this.elementBox(options), style: this.cloneStyle({ ...options, padding: options.padding ?? 0, quietModules: options.quietModules ?? 10 }) });
    return this;
  }

  qr(data, options = {}) {
    this.elements.push({ kind: "qr", data, box: this.elementBox(options), style: this.cloneStyle({ ...options, padding: options.padding ?? 0, quietModules: options.quietModules ?? 0 }) });
    return this;
  }

  rect(options = {}) {
    this.elements.push({ kind: "rect", box: this.elementBox(options), style: this.cloneStyle(options) });
    return this;
  }

  line(options = {}) {
    this.elements.push({ kind: "line", box: this.elementBox(options), style: this.cloneStyle(options) });
    return this;
  }

  raw(draw, options = {}) {
    this.elements.push({ kind: "raw", draw, box: this.elementBox(options), style: this.cloneStyle(options) });
    return this;
  }

  toJSON() {
    return {
      schema: "rlabel.grid.v1",
      label: {
        widthMm: this.widthMm,
        heightMm: this.heightMm,
        columns: this.columns,
        rows: this.rows,
        paddingMm: this.paddingMm,
        gapMm: this.gapMm,
        dotsPerMm: this.dotsPerMm,
        background: this.background,
      },
      elements: this.elements.map((element) => {
        if (element.kind === "raw") throw new Error("Raw draw callbacks cannot be serialized to JSON");
        return jsonClone(element);
      }),
    };
  }

  static fromJSON(template, data = {}) {
    const source = typeof template === "string" ? JSON.parse(template) : template;
    const label = source.label ?? source;
    const design = new R22GridDesign({
      widthMm: label.widthMm,
      heightMm: label.heightMm,
      columns: label.columns,
      rows: label.rows,
      paddingMm: label.paddingMm,
      gapMm: label.gapMm,
      dotsPerMm: label.dotsPerMm,
      background: label.background,
    });
    design.elements = resolveLabelTemplate(source.elements ?? [], data);
    return design;
  }

  withData(data = {}) {
    return R22GridDesign.fromJSON(this.toJSON(), data);
  }

  elementBox(options = {}) {
    return {
      row: options.row ?? this.cursor.row,
      column: options.column ?? this.cursor.column,
      rowSpan: options.rowSpan ?? this.cursor.rowSpan,
      columnSpan: options.columnSpan ?? this.cursor.columnSpan,
      xMm: options.xMm,
      yMm: options.yMm,
      widthMm: options.widthMm,
      heightMm: options.heightMm,
    };
  }

  widthDots() {
    return mmToR22Dots(this.widthMm);
  }

  heightDots() {
    return mmToR22Dots(this.heightMm);
  }

  rectFor(box, style = {}) {
    if (box.xMm !== undefined || box.yMm !== undefined || box.widthMm !== undefined || box.heightMm !== undefined) {
      return {
        x: Math.round((box.xMm ?? 0) * this.dotsPerMm),
        y: Math.round((box.yMm ?? 0) * this.dotsPerMm),
        width: Math.round((box.widthMm ?? this.widthMm) * this.dotsPerMm),
        height: Math.round((box.heightMm ?? this.heightMm) * this.dotsPerMm),
        padding: style.padding ?? this.defaultStyle().padding,
      };
    }

    const pad = this.paddingMm * this.dotsPerMm;
    const gap = this.gapMm * this.dotsPerMm;
    const contentWidth = Math.max(1, this.widthDots() - pad * 2 - gap * (this.columns - 1));
    const contentHeight = Math.max(1, this.heightDots() - pad * 2 - gap * (this.rows - 1));
    const cellWidth = contentWidth / this.columns;
    const cellHeight = contentHeight / this.rows;
    const column = clamp(box.column, 0, this.columns - 1);
    const row = clamp(box.row, 0, this.rows - 1);
    const columnSpan = clamp(box.columnSpan, 1, this.columns - column);
    const rowSpan = clamp(box.rowSpan, 1, this.rows - row);

    return {
      x: Math.round(pad + column * (cellWidth + gap)),
      y: Math.round(pad + row * (cellHeight + gap)),
      width: Math.max(1, Math.round(cellWidth * columnSpan + gap * (columnSpan - 1))),
      height: Math.max(1, Math.round(cellHeight * rowSpan + gap * (rowSpan - 1))),
      padding: style.padding ?? this.defaultStyle().padding,
    };
  }

  async toCanvas(data = {}) {
    const canvas = createCanvas(this.widthDots(), this.heightDots());
    const context = canvas.getContext("2d");
    context.fillStyle = this.background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const elements = data && Object.keys(data).length ? resolveLabelTemplate(this.elements, data) : this.elements;
    for (const element of elements) {
      await this.drawElement(context, element);
    }

    return canvas;
  }

  async drawElement(context, element) {
    const rect = this.rectFor(element.box, element.style);
    const style = element.style;
    const rotation = normalizeRotation(style.rotation);

    context.save();
    if (rotation) {
      context.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
      context.rotate((rotation * Math.PI) / 180);
      context.translate(-(rect.x + rect.width / 2), -(rect.y + rect.height / 2));
    }
    context.beginPath();
    context.rect(rect.x, rect.y, rect.width, rect.height);
    context.clip();

    if (style.inverse) {
      context.fillStyle = "#000";
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      context.fillStyle = "#fff";
      context.strokeStyle = "#fff";
    } else {
      context.fillStyle = "#000";
      context.strokeStyle = "#000";
    }

    const fontSize = Math.round(style.fontSize * (style.doubleHeight ? 1.8 : 1));
    const weight = style.bold ? 800 : 500;
    context.font = `${weight} ${fontSize}px ${style.fontFamily}`;

    if (element.kind === "text") {
      drawWrappedText(context, element.text, rect, { ...style, fontSize });
    } else if (element.kind === "image") {
      const image = await loadImage(element.source);
      context.drawImage(image, rect.x + rect.padding, rect.y + rect.padding, rect.width - rect.padding * 2, rect.height - rect.padding * 2);
    } else if (element.kind === "barcode") {
      drawBarcode(context, element.type, element.data, rect, { ...style, fontSize });
    } else if (element.kind === "qr") {
      drawQrCode(context, element.data, rect, { ...style, fontSize });
    } else if (element.kind === "rect") {
      context.lineWidth = element.style.lineWidth ?? 2;
      context.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
    } else if (element.kind === "line") {
      context.lineWidth = element.style.lineWidth ?? 2;
      context.beginPath();
      context.moveTo(rect.x, rect.y + rect.height / 2);
      context.lineTo(rect.x + rect.width, rect.y + rect.height / 2);
      context.stroke();
    } else if (element.kind === "raw") {
      await element.draw(context, rect, style, this);
    }

    context.restore();
  }
}

export class R22PrintJob {
  constructor(printer, options = {}) {
    this.printer = printer;
    this.design = new R22GridDesign(options);
  }

  grid(...args) { this.design.grid(...args); return this; }
  cell(...args) { this.design.cell(...args); return this; }
  at(...args) { this.design.at(...args); return this; }
  align(...args) { this.design.align(...args); return this; }
  valign(...args) { this.design.valign(...args); return this; }
  font(...args) { this.design.font(...args); return this; }
  fontSize(...args) { this.design.fontSize(...args); return this; }
  lineSpacing(...args) { this.design.lineSpacing(...args); return this; }
  charSpacing(...args) { this.design.charSpacing(...args); return this; }
  bold(...args) { this.design.bold(...args); return this; }
  underline(...args) { this.design.underline(...args); return this; }
  doubleWidth(...args) { this.design.doubleWidth(...args); return this; }
  doubleHeight(...args) { this.design.doubleHeight(...args); return this; }
  rotate(...args) { this.design.rotate(...args); return this; }
  inverse(...args) { this.design.inverse(...args); return this; }
  clearFormatting(...args) { this.design.clearFormatting(...args); return this; }
  text(...args) { this.design.text(...args); return this; }
  image(...args) { this.design.image(...args); return this; }
  barcode(...args) { this.design.barcode(...args); return this; }
  qr(...args) { this.design.qr(...args); return this; }
  rect(...args) { this.design.rect(...args); return this; }
  line(...args) { this.design.line(...args); return this; }
  raw(...args) { this.design.raw(...args); return this; }
  toJSON() { return this.design.toJSON(); }
  withData(...args) { this.design = this.design.withData(...args); return this; }

  async toCanvas(data = {}) {
    return this.design.toCanvas(data);
  }

  async preview(canvas, data = {}) {
    const rendered = await this.toCanvas(data);
    canvas.width = rendered.width;
    canvas.height = rendered.height;
    canvas.getContext("2d").drawImage(rendered, 0, 0);
    return rendered;
  }

  async write(options = {}) {
    const { data = {}, ...printOptions } = options;
    const canvas = await this.toCanvas(data);
    return this.printer.printCanvas(canvas, {
      widthMm: this.design.widthMm,
      heightMm: this.design.heightMm,
      compressed: true,
      maxBagBytes: 1000,
      ...printOptions,
    });
  }
}
