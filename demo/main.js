import {
  DEFAULT_BLE_CANDIDATES,
  R22GridDesign,
  R22Printer,
  R22Protocol,
  bytesToHex,
  drawBarcode,
  drawQrCode,
  normalizeRotation,
} from "../src/index.js";

const $ = (id) => document.querySelector(`#${id}`);

const stage = $("stage");
const stageWrap = document.querySelector(".stage-wrap");
const logEl = $("log");
const connectButton = $("connect");
const printButton = $("print");
const printCopiesInput = $("printCopies");
const importJsonButton = $("importJson");
const downloadJsonButton = $("downloadJson");
const jsonUpload = $("jsonUpload");
const imageUpload = $("imageUpload");
const emptyInspector = $("emptyInspector");
const itemInspector = $("itemInspector");
const duplicateButton = $("duplicate");
const deleteButton = $("delete");
const layersList = $("layersList");
const layerButtons = {
  back: $("sendToBack"),
  backward: $("sendBackward"),
  forward: $("bringForward"),
  front: $("bringToFront"),
};
const rotateButtons = {
  left: $("rotateLeft"),
  right: $("rotateRight"),
};
const WORKING_PRINTER = {
  printerType: 0x1c,
  candidate: DEFAULT_BLE_CANDIDATES[0],
  chunkSize: 244,
  language: "rt",
  writeWithResponse: false,
  threshold: 160,
};
const EDITOR_MIN_POSITION = -200;
const EDITOR_MAX_POSITION = 200;
const EDITOR_MIN_SIZE = 1;
const EDITOR_MAX_SIZE = 300;

let printer;
let selectedId = null;
let dragState = null;
let stageScale = 1;
let nextId = 1;
let snapToGrid = false;
let isPrinting = false;
let previewRenderId = 0;
let previewFrame = 0;
let previewRendering = false;
let previewNeedsRender = false;
let activePreviewCanvas = null;
let lastPreviewCanvas = null;

const state = {
  widthMm: 50,
  heightMm: 30,
  columns: 12,
  rows: 6,
  paddingMm: 1.8,
  gapMm: 0.8,
  printLabelBorder: true,
  elements: [
    {
      id: makeId(),
      type: "rect",
      role: "labelBorder",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      lineWidth: 3,
      rotation: 0,
    },
    {
      id: makeId(),
      type: "text",
      text: "GARAGE SHELF A3",
      x: 6,
      y: 5,
      width: 88,
      height: 30,
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: 34,
      bold: true,
      underline: false,
      inverse: false,
      align: "center",
      valign: "middle",
      rotation: 0,
    },
    {
      id: makeId(),
      type: "barcode",
      barcodeType: "CODE128",
      text: "R22-751D",
      x: 3,
      y: 40,
      width: 73,
      height: 42,
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: 12,
      showText: true,
      rotation: 0,
    },
    {
      id: makeId(),
      type: "qr",
      text: "GARAGE SHELF A3",
      x: 78,
      y: 38,
      width: 20,
      height: 40,
      rotation: 0,
    },
    {
      id: makeId(),
      type: "text",
      text: new Date().toLocaleDateString(),
      x: 6,
      y: 83,
      width: 88,
      height: 12,
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: 13,
      bold: false,
      underline: false,
      inverse: false,
      align: "center",
      valign: "middle",
      rotation: 0,
    },
  ],
};

function makeId() {
  return `item-${nextId++}`;
}

function resetIds() {
  nextId = 1;
}

function log(message) {
  logEl.textContent = `${new Date().toLocaleTimeString()}  ${message}\n${logEl.textContent}`;
}

function selectedElement() {
  return state.elements.find((item) => item.id === selectedId);
}

function selectedElementIndex() {
  return state.elements.findIndex((item) => item.id === selectedId);
}

function printableElements() {
  return state.elements.filter((item) => item.role !== "labelBorder" || state.printLabelBorder);
}

function selectedVisibleLayerIndex() {
  return printableElements().findIndex((item) => item.id === selectedId);
}

function value(id) {
  return $(id).value;
}

function numberValue(id) {
  return Number(value(id));
}

function makePrinter() {
  return new R22Printer({
    protocol: new R22Protocol({ printerType: WORKING_PRINTER.printerType }),
    candidates: [WORKING_PRINTER.candidate],
    chunkSize: WORKING_PRINTER.chunkSize,
    language: WORKING_PRINTER.language,
    writeWithResponse: WORKING_PRINTER.writeWithResponse,
  });
}

function printCopies() {
  const copies = Math.floor(Number(printCopiesInput.value));
  return Number.isFinite(copies) ? clamp(copies, 1, 99) : 1;
}

function setPrinting(active, label = "Printing...") {
  isPrinting = active;
  connectButton.disabled = active;
  printCopiesInput.disabled = active;
  printButton.disabled = active || !printer;
  printButton.textContent = active ? label : "Print";
}

function setPrintProgress(label) {
  if (isPrinting) printButton.textContent = label;
}

function percentToDotsX(valuePercent) {
  return Math.round((valuePercent / 100) * state.widthMm * 8);
}

function percentToDotsY(valuePercent) {
  return Math.round((valuePercent / 100) * state.heightMm * 8);
}

function dotsToPercentX(dots) {
  return (dots / (state.widthMm * 8)) * 100;
}

function dotsToPercentY(dots) {
  return (dots / (state.heightMm * 8)) * 100;
}

function snapPercentX(value) {
  const step = 100 / Math.max(1, state.columns);
  return Math.round(value / step) * step;
}

function snapPercentY(value) {
  const step = 100 / Math.max(1, state.rows);
  return Math.round(value / step) * step;
}

function snapBox(box) {
  if (!snapToGrid) return box;
  const snapped = {
    ...box,
    x: snapPercentX(box.x),
    y: snapPercentY(box.y),
    width: snapPercentX(box.width),
    height: snapPercentY(box.height),
  };
  snapped.width = clamp(snapped.width, 100 / Math.max(1, state.columns), EDITOR_MAX_SIZE);
  snapped.height = clamp(snapped.height, 100 / Math.max(1, state.rows), EDITOR_MAX_SIZE);
  snapped.x = clamp(snapped.x, EDITOR_MIN_POSITION, EDITOR_MAX_POSITION);
  snapped.y = clamp(snapped.y, EDITOR_MIN_POSITION, EDITOR_MAX_POSITION);
  return snapped;
}

function makeQrSquare(box, sizeMode = "max") {
  const widthDots = percentToDotsX(box.width);
  const heightDots = percentToDotsY(box.height);
  const requestedDots = sizeMode === "width"
    ? widthDots
    : sizeMode === "height"
      ? heightDots
      : Math.max(widthDots, heightDots);
  const maxDots = Math.max(1, Math.min(requestedDots, percentToDotsX(EDITOR_MAX_SIZE), percentToDotsY(EDITOR_MAX_SIZE)));
  return {
    ...box,
    width: dotsToPercentX(maxDots),
    height: dotsToPercentY(maxDots),
  };
}

function elementRect(item) {
  return {
    xMm: (item.x / 100) * state.widthMm,
    yMm: (item.y / 100) * state.heightMm,
    widthMm: (item.width / 100) * state.widthMm,
    heightMm: (item.height / 100) * state.heightMm,
  };
}

function percentBoxFromDesignRect(design, rect) {
  return {
    x: (rect.x / design.widthDots()) * 100,
    y: (rect.y / design.heightDots()) * 100,
    width: (rect.width / design.widthDots()) * 100,
    height: (rect.height / design.heightDots()) * 100,
  };
}

function elementFromDesignElement(design, element) {
  const rect = design.rectFor(element.box, element.style);
  const box = percentBoxFromDesignRect(design, rect);
  const style = element.style ?? {};
  const base = {
    id: makeId(),
    type: element.kind,
    ...box,
    rotation: normalizeRotation(style.rotation),
  };
  if (element.kind === "text") {
    return {
      ...base,
      text: element.text ?? "",
      fontFamily: style.fontFamily ?? textDefaults().fontFamily,
      fontSize: style.fontSize ?? 22,
      bold: Boolean(style.bold),
      underline: Boolean(style.underline),
      inverse: Boolean(style.inverse),
      align: style.align ?? "left",
      valign: style.valign ?? "middle",
    };
  }
  if (element.kind === "barcode") {
    return {
      ...base,
      text: element.data ?? "",
      barcodeType: element.type ?? "CODE128",
      fontFamily: style.fontFamily ?? textDefaults().fontFamily,
      fontSize: style.fontSize ?? 12,
      showText: style.showText !== false,
    };
  }
  if (element.kind === "qr") return makeQrSquare({ ...base, text: element.data ?? "" });
  if (element.kind === "image") return { ...base, src: element.source };
  if (element.kind === "rect") return { ...base, lineWidth: style.lineWidth ?? 3 };
  if (element.kind === "line") return { ...base, lineWidth: style.lineWidth ?? 3 };
  return null;
}

function applyTemplate(template) {
  const design = R22GridDesign.fromJSON(template);
  const imported = design.elements.map((element) => elementFromDesignElement(design, element)).filter(Boolean);
  const border = imported.find((item) => (
    item.type === "rect" &&
    Math.abs(item.x) < 0.01 &&
    Math.abs(item.y) < 0.01 &&
    Math.abs(item.width - 100) < 0.01 &&
    Math.abs(item.height - 100) < 0.01
  ));
  if (border) border.role = "labelBorder";

  state.widthMm = design.widthMm;
  state.heightMm = design.heightMm;
  state.columns = design.columns;
  state.rows = design.rows;
  state.paddingMm = design.paddingMm;
  state.gapMm = design.gapMm;
  state.printLabelBorder = Boolean(border);
  state.elements = imported;
  selectedId = state.elements.find((item) => item.role !== "labelBorder")?.id ?? state.elements[0]?.id ?? null;

  $("widthMm").value = state.widthMm;
  $("heightMm").value = state.heightMm;
  $("columns").value = state.columns;
  $("rows").value = state.rows;
  $("paddingMm").value = state.paddingMm;
  $("gapMm").value = state.gapMm;
  $("printLabelBorder").checked = state.printLabelBorder;
  render();
}

function buildDesign() {
  const design = new R22GridDesign({
    widthMm: state.widthMm,
    heightMm: state.heightMm,
    columns: state.columns,
    rows: state.rows,
    paddingMm: state.paddingMm,
    gapMm: state.gapMm,
  });

  for (const item of printableElements()) {
    const box = elementRect(item);
    if (item.type === "text") {
      design
        .align(item.align ?? "left")
        .valign(item.valign ?? "middle")
        .fontSize(item.fontSize ?? 22);
      design.styleState.fontFamily = item.fontFamily ?? design.styleState.fontFamily;
      design.styleState.bold = Boolean(item.bold);
      design.styleState.underline = Boolean(item.underline);
      design.styleState.inverse = Boolean(item.inverse);
      design.styleState.rotation = normalizeRotation(item.rotation);
      design.text(item.text ?? "", { ...box, padding: 0 }).clearFormatting();
    } else if (item.type === "barcode") {
      design.styleState.fontSize = item.fontSize ?? 12;
      design.styleState.fontFamily = item.fontFamily ?? design.styleState.fontFamily;
      design.barcode(item.barcodeType ?? "CODE128", item.text ?? "", { ...box, rotation: item.rotation ?? 0, padding: 0, quietModules: 10, showText: item.showText !== false }).clearFormatting();
    } else if (item.type === "qr") {
      design.qr(item.text ?? "", { ...box, rotation: item.rotation ?? 0, padding: 0, quietModules: 0, showText: false });
    } else if (item.type === "image") {
      design.image(item.src, { ...box, rotation: item.rotation ?? 0, padding: 0 });
    } else if (item.type === "rect") {
      design.rect({ ...box, rotation: item.rotation ?? 0, lineWidth: item.lineWidth ?? 3 });
    } else if (item.type === "line") {
      design.line({ ...box, rotation: item.rotation ?? 0, lineWidth: item.lineWidth ?? 3 });
    }
  }

  return design;
}

function render() {
  state.widthMm = numberValue("widthMm");
  state.heightMm = numberValue("heightMm");
  state.columns = numberValue("columns");
  state.rows = numberValue("rows");
  state.paddingMm = numberValue("paddingMm");
  state.gapMm = numberValue("gapMm");

  const widthDots = state.widthMm * 8;
  const heightDots = state.heightMm * 8;
  const maxWidth = Math.max(360, stageWrap.clientWidth - 80);
  const maxHeight = Math.max(260, stageWrap.clientHeight - 90);
  stageScale = Math.max(0.7, Math.min(3, maxWidth / widthDots, maxHeight / heightDots));

  stage.style.width = `${widthDots * stageScale}px`;
  stage.style.height = `${heightDots * stageScale}px`;
  stage.style.setProperty("--grid-x", `${(widthDots * stageScale) / state.columns}px`);
  stage.style.setProperty("--grid-y", `${(heightDots * stageScale) / state.rows}px`);
  stage.innerHTML = "";
  stage.classList.add("exact-preview");

  const previewCanvas = document.createElement("canvas");
  previewCanvas.className = "print-preview-canvas";
  previewCanvas.width = widthDots;
  previewCanvas.height = heightDots;
  paintCachedPreview(previewCanvas);
  stage.appendChild(previewCanvas);
  scheduleExactPreview(previewCanvas);

  for (const item of printableElements()) {
    stage.appendChild(renderElement(item, state.elements.indexOf(item)));
  }

  renderInspector();
  renderLayers();
}

function renderElement(item, layerIndex) {
  const node = document.createElement("div");
  node.className = `element element-${item.type}${item.id === selectedId ? " selected" : ""}`;
  node.dataset.id = item.id;
  node.tabIndex = 0;
  node.style.zIndex = String(layerIndex + 3);
  node.style.left = `${percentToDotsX(item.x) * stageScale}px`;
  node.style.top = `${percentToDotsY(item.y) * stageScale}px`;
  node.style.width = `${Math.max(1, percentToDotsX(item.width) * stageScale)}px`;
  node.style.height = `${Math.max(1, percentToDotsY(item.height) * stageScale)}px`;
  node.style.alignItems = alignItems(item.valign);
  node.style.justifyContent = justifyContent(item.align);
  node.style.transform = `rotate(${normalizeRotation(item.rotation)}deg)`;
  node.style.transformOrigin = "center";

  if (item.type === "text") {
    const text = document.createElement("div");
    text.className = "element-text";
    text.textContent = item.text;
    text.style.fontFamily = item.fontFamily;
    text.style.fontSize = `${(item.fontSize ?? 22) * stageScale}px`;
    text.style.fontWeight = item.bold ? "800" : "500";
    text.style.textDecoration = item.underline ? "underline" : "none";
    text.style.textAlign = item.align ?? "left";
    node.style.background = item.inverse ? "#000" : "transparent";
    node.style.color = item.inverse ? "#fff" : "#000";
    node.appendChild(text);
  } else if (item.type === "barcode") {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, percentToDotsX(item.width));
    canvas.height = Math.max(1, percentToDotsY(item.height));
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    drawPreviewBarcode(canvas, item);
    node.appendChild(canvas);
  } else if (item.type === "qr") {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, percentToDotsX(item.width));
    canvas.height = Math.max(1, percentToDotsY(item.height));
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    drawPreviewQr(canvas, item);
    node.appendChild(canvas);
  } else if (item.type === "image") {
    const image = document.createElement("img");
    image.src = item.src;
    image.draggable = false;
    image.addEventListener("dragstart", (event) => event.preventDefault());
    node.appendChild(image);
    const shield = document.createElement("div");
    shield.className = "image-shield";
    shield.draggable = false;
    shield.addEventListener("dragstart", (event) => event.preventDefault());
    node.appendChild(shield);
  }

  if (item.id === selectedId) {
    const handle = document.createElement("div");
    handle.className = "resize-handle";
    handle.dataset.resize = "true";
    node.appendChild(handle);
  }

  node.addEventListener("pointerdown", onElementPointerDown);
  return node;
}

function drawPreviewBarcode(canvas, item) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawBarcode(ctx, item.barcodeType ?? "CODE128", item.text || "123456", {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
    padding: 0,
  }, {
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: item.fontSize ?? 12,
    quietModules: 10,
    showText: item.showText !== false,
  });
}

function drawPreviewQr(canvas, item) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawQrCode(ctx, item.text || "https://example.com", {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
    padding: 0,
  }, {
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 10,
    showText: false,
  });
}

function alignItems(value) {
  if (value === "top") return "flex-start";
  if (value === "bottom") return "flex-end";
  return "center";
}

function justifyContent(value) {
  if (value === "right") return "flex-end";
  if (value === "center") return "center";
  return "flex-start";
}

function renderInspector() {
  const item = selectedElement();
  const visible = printableElements();
  const index = selectedVisibleLayerIndex();
  duplicateButton.disabled = !item;
  deleteButton.disabled = !item;
  layerButtons.back.disabled = !item || index <= 0;
  layerButtons.backward.disabled = !item || index <= 0;
  layerButtons.forward.disabled = !item || index < 0 || index >= visible.length - 1;
  layerButtons.front.disabled = !item || index < 0 || index >= visible.length - 1;
  rotateButtons.left.disabled = !item;
  rotateButtons.right.disabled = !item;
  emptyInspector.classList.toggle("hidden", Boolean(item));
  itemInspector.classList.toggle("hidden", !item);
  if (!item) return;

  $("itemX").value = Math.round(item.x);
  $("itemY").value = Math.round(item.y);
  $("itemW").value = Math.round(item.width);
  $("itemH").value = Math.round(item.height);
  $("itemRotation").value = String(normalizeRotation(item.rotation));
  $("itemText").value = item.text ?? "";
  $("fontFamily").value = item.fontFamily ?? $("fontFamily").options[0].value;
  $("fontSize").value = item.fontSize ?? 22;
  $("align").value = item.align ?? "left";
  $("valign").value = item.valign ?? "middle";
  $("bold").checked = Boolean(item.bold);
  $("underline").checked = Boolean(item.underline);
  $("inverse").checked = Boolean(item.inverse);
  $("barcodeType").value = item.barcodeType ?? "CODE128";
  $("showBarcodeText").value = item.showText === false ? "false" : "true";

  const hasText = ["text", "barcode", "qr"].includes(item.type);
  $("textControl").classList.toggle("hidden", !hasText);
  $("textOptions").classList.toggle("hidden", item.type !== "text");
  $("barcodeOptions").classList.toggle("hidden", item.type !== "barcode");
}

function layerName(item) {
  if (item.role === "labelBorder") return "Label border";
  if (item.type === "text") return item.text || "Text";
  if (item.type === "barcode") return item.text ? `Barcode: ${item.text}` : "Barcode";
  if (item.type === "qr") return item.text ? `QR: ${item.text}` : "QR";
  if (item.type === "image") return "Image";
  if (item.type === "rect") return "Box";
  if (item.type === "line") return "Line";
  return item.type;
}

function renderLayers() {
  layersList.innerHTML = "";
  const visible = printableElements();
  [...visible].reverse().forEach((item, visualIndex) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `layer-item${item.id === selectedId ? " selected" : ""}`;
    button.dataset.layerId = item.id;
    const topLabel = visualIndex === 0 ? "Top" : `Layer ${visible.length - visualIndex}`;
    const name = document.createElement("span");
    name.textContent = layerName(item);
    const type = document.createElement("span");
    type.className = "layer-type";
    type.textContent = topLabel;
    button.append(name, type);
    button.addEventListener("click", () => {
      selectedId = item.id;
      render();
    });
    layersList.appendChild(button);
  });
}

function addElement(type, src, position = {}) {
  const base = {
    id: makeId(),
    type,
    x: position.x ?? 12,
    y: position.y ?? 12,
    rotation: 0,
    width: type === "line" ? 50 : 34,
    height: type === "line" ? 8 : 22,
  };
  if (type === "text") Object.assign(base, textDefaults(), { text: "Text" });
  if (type === "barcode") Object.assign(base, { barcodeType: "CODE128", text: "ABC-123", width: 73, height: 30, fontSize: 12, showText: true });
  if (type === "qr") Object.assign(base, makeQrSquare({ ...base, text: "https://example.com", width: 24, height: 24 }));
  if (type === "image") Object.assign(base, { src, width: 30, height: 30 });
  if (type === "rect") Object.assign(base, { width: 36, height: 22, lineWidth: 3 });
  if (type === "line") Object.assign(base, { lineWidth: 3 });
  state.elements.push(base);
  selectedId = base.id;
  render();
}

function textDefaults() {
  return {
    fontFamily: $("fontFamily")?.value ?? "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 24,
    bold: false,
    underline: false,
    inverse: false,
    align: "left",
    valign: "middle",
  };
}

function onElementPointerDown(event) {
  const node = event.currentTarget;
  const item = state.elements.find((entry) => entry.id === node.dataset.id);
  if (!item) return;
  selectedId = item.id;
  const resize = event.target.dataset.resize === "true";
  dragState = {
    id: item.id,
    resize,
    startX: event.clientX,
    startY: event.clientY,
    item: { ...item },
  };
  node.setPointerCapture(event.pointerId);
  node.focus({ preventScroll: true });
  node.classList.add("dragging");
  render();
}

function nudgeSelected(event) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  const item = selectedElement();
  if (!item) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  event.preventDefault();
  const dx = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
  const dy = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
  item.x = clamp(item.x + dotsToPercentX(dx / stageScale), EDITOR_MIN_POSITION, EDITOR_MAX_POSITION);
  item.y = clamp(item.y + dotsToPercentY(dy / stageScale), EDITOR_MIN_POSITION, EDITOR_MAX_POSITION);
  render();
  requestAnimationFrame(() => {
    document.querySelector(`.element[data-id="${item.id}"]`)?.focus({ preventScroll: true });
  });
}

function onPointerMove(event) {
  if (!dragState) return;
  const item = selectedElement();
  if (!item) return;
  const dx = dotsToPercentX((event.clientX - dragState.startX) / stageScale);
  const dy = dotsToPercentY((event.clientY - dragState.startY) / stageScale);
  if (dragState.resize) {
    const next = snapBox({
      ...item,
      width: clamp(dragState.item.width + dx, EDITOR_MIN_SIZE, EDITOR_MAX_SIZE),
      height: clamp(dragState.item.height + dy, EDITOR_MIN_SIZE, EDITOR_MAX_SIZE),
    });
    const sized = item.type === "qr" ? makeQrSquare(next) : next;
    item.width = sized.width;
    item.height = sized.height;
  } else {
    const next = snapBox({
      ...item,
      x: clamp(dragState.item.x + dx, EDITOR_MIN_POSITION, EDITOR_MAX_POSITION),
      y: clamp(dragState.item.y + dy, EDITOR_MIN_POSITION, EDITOR_MAX_POSITION),
    });
    item.x = next.x;
    item.y = next.y;
  }
  render();
}

function onPointerUp() {
  dragState = null;
  document.querySelectorAll(".dragging").forEach((item) => item.classList.remove("dragging"));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateSelectedFromInspector() {
  const item = selectedElement();
  if (!item) return;
  const oldWidth = item.width;
  const oldHeight = item.height;
  item.x = clamp(numberValue("itemX"), EDITOR_MIN_POSITION, EDITOR_MAX_POSITION);
  item.y = clamp(numberValue("itemY"), EDITOR_MIN_POSITION, EDITOR_MAX_POSITION);
  item.width = clamp(numberValue("itemW"), EDITOR_MIN_SIZE, EDITOR_MAX_SIZE);
  item.height = clamp(numberValue("itemH"), EDITOR_MIN_SIZE, EDITOR_MAX_SIZE);
  if (item.type === "qr") {
    const sizeMode = item.width !== oldWidth && item.height === oldHeight ? "width" : item.height !== oldHeight && item.width === oldWidth ? "height" : "max";
    Object.assign(item, makeQrSquare(item, sizeMode));
  }
  if (["text", "barcode", "qr"].includes(item.type)) item.text = value("itemText");
  item.rotation = normalizeRotation(value("itemRotation"));
  if (item.type === "text") {
    item.fontFamily = value("fontFamily");
    item.fontSize = numberValue("fontSize");
    item.align = value("align");
    item.valign = value("valign");
    item.bold = $("bold").checked;
    item.underline = $("underline").checked;
    item.inverse = $("inverse").checked;
  }
  if (item.type === "barcode") {
    item.barcodeType = value("barcodeType");
    item.showText = value("showBarcodeText") === "true";
  }
  render();
}

function rotateSelected(delta) {
  const item = selectedElement();
  if (!item) return;
  item.rotation = normalizeRotation((item.rotation ?? 0) + delta);
  render();
}

function moveSelectedLayer(mode) {
  const item = selectedElement();
  const visible = printableElements();
  const index = selectedVisibleLayerIndex();
  if (!item || index < 0) return;

  const movingDown = mode === "back" || mode === "backward";
  const target = mode === "back"
    ? visible[0]
    : mode === "backward"
      ? visible[index - 1]
      : mode === "forward"
        ? visible[index + 1]
        : visible[visible.length - 1];
  if (!target || target.id === item.id) return;

  state.elements.splice(selectedElementIndex(), 1);
  const targetIndex = state.elements.findIndex((entry) => entry.id === target.id);
  const nextIndex = movingDown ? targetIndex : targetIndex + 1;
  state.elements.splice(clamp(nextIndex, 0, state.elements.length), 0, item);
  render();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function renderPrintCanvas() {
  return buildDesign().toCanvas();
}

function paintCachedPreview(canvas) {
  if (!lastPreviewCanvas) return;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(lastPreviewCanvas, 0, 0, canvas.width, canvas.height);
}

function paintExactPreview(canvas, rendered) {
  canvas.width = rendered.width;
  canvas.height = rendered.height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(rendered, 0, 0);
}

function scheduleExactPreview(canvas) {
  activePreviewCanvas = canvas;
  previewNeedsRender = true;
  if (previewFrame) cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(() => {
    previewFrame = 0;
    renderExactPreview();
  });
}

async function renderExactPreview() {
  if (previewRendering) return;
  const renderId = ++previewRenderId;
  const canvas = activePreviewCanvas;
  previewNeedsRender = false;
  previewRendering = true;
  try {
    const rendered = await renderPrintCanvas();
    lastPreviewCanvas = rendered;
    if (renderId === previewRenderId && canvas?.isConnected) {
      paintExactPreview(canvas, rendered);
    }
  } catch (error) {
    console.warn("Unable to render exact label preview", error);
  } finally {
    previewRendering = false;
    if (previewNeedsRender && activePreviewCanvas?.isConnected) {
      scheduleExactPreview(activePreviewCanvas);
    }
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function stageDropPosition(event, width = 34, height = 22) {
  const rect = stage.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  return snapBox({
    x: clamp(x - width / 2, EDITOR_MIN_POSITION, EDITOR_MAX_POSITION),
    y: clamp(y - height / 2, EDITOR_MIN_POSITION, EDITOR_MAX_POSITION),
    width,
    height,
  });
}

async function connectPrinter() {
  printer = makePrinter();
  printer.addEventListener("data", (event) => log(`RX ${bytesToHex(event.detail)}`));
  printer.addEventListener("flow", (event) => log(`FLOW ${bytesToHex(event.detail)}`));
  printer.addEventListener("protocol", (event) => {
    const { command, text, json } = event.detail;
    const suffix = json ? ` ${JSON.stringify(json)}` : (text ? ` ${text}` : "");
    log(`PROTO 0x${command.toString(16).padStart(6, "0")}${suffix}`);
  });
  await printer.connect({ initialize: true });
  setPrinting(false);
  log(`Connected to ${printer.device.name || "printer"}`);
}

document.addEventListener("pointermove", onPointerMove);
document.addEventListener("pointerup", onPointerUp);
document.addEventListener("keydown", nudgeSelected);

stage.addEventListener("pointerdown", (event) => {
  if (event.target === stage) {
    selectedId = null;
    render();
  }
});

document.querySelectorAll("[data-add]").forEach((button) => {
  button.addEventListener("click", () => addElement(button.dataset.add));
  button.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("application/x-r22-web-add", button.dataset.add);
    event.dataTransfer.effectAllowed = "copy";
  });
});

$("addImage").addEventListener("click", () => imageUpload.click());
imageUpload.addEventListener("change", async () => {
  const file = imageUpload.files?.[0];
  if (!file) return;
  addElement("image", await fileToDataUrl(file));
  imageUpload.value = "";
});

importJsonButton.addEventListener("click", () => jsonUpload.click());
jsonUpload.addEventListener("change", async () => {
  const file = jsonUpload.files?.[0];
  if (!file) return;
  try {
    resetIds();
    applyTemplate(JSON.parse(await file.text()));
    log(`Imported JSON template: ${file.name}`);
  } catch (error) {
    log(`JSON import failed: ${error.message}`);
  } finally {
    jsonUpload.value = "";
  }
});

stage.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});

stage.addEventListener("drop", async (event) => {
  event.preventDefault();
  const type = event.dataTransfer.getData("application/x-r22-web-add");
  if (type) {
    addElement(type, undefined, stageDropPosition(event));
    return;
  }

  const file = [...event.dataTransfer.files].find((item) => /^image\/(png|jpeg|svg\+xml)$/.test(item.type));
  if (file) {
    addElement("image", await fileToDataUrl(file), stageDropPosition(event, 30, 30));
  }
});

["widthMm", "heightMm", "columns", "rows", "paddingMm", "gapMm"].forEach((id) => {
  $(id).addEventListener("input", render);
});

["itemX", "itemY", "itemW", "itemH", "itemRotation", "itemText", "fontFamily", "fontSize", "align", "valign", "barcodeType", "showBarcodeText"].forEach((id) => {
  $(id).addEventListener("input", updateSelectedFromInspector);
});

["bold", "underline", "inverse"].forEach((id) => {
  $(id).addEventListener("change", updateSelectedFromInspector);
});

$("toggleGrid").addEventListener("click", () => stage.classList.toggle("show-grid"));
$("hideBackground").addEventListener("change", () => {
  stageWrap.classList.toggle("hide-background", $("hideBackground").checked);
});
$("hideLabelBorder").addEventListener("change", () => {
  stage.classList.toggle("hide-label-border", $("hideLabelBorder").checked);
});
$("printLabelBorder").addEventListener("change", () => {
  state.printLabelBorder = $("printLabelBorder").checked;
  if (!state.printLabelBorder && selectedElement()?.role === "labelBorder") selectedId = null;
  render();
});
$("snapToGrid").addEventListener("change", () => {
  snapToGrid = $("snapToGrid").checked;
});
$("fit").addEventListener("click", render);

layerButtons.back.addEventListener("click", () => moveSelectedLayer("back"));
layerButtons.backward.addEventListener("click", () => moveSelectedLayer("backward"));
layerButtons.forward.addEventListener("click", () => moveSelectedLayer("forward"));
layerButtons.front.addEventListener("click", () => moveSelectedLayer("front"));
rotateButtons.left.addEventListener("click", () => rotateSelected(-90));
rotateButtons.right.addEventListener("click", () => rotateSelected(90));

duplicateButton.addEventListener("click", () => {
  const item = selectedElement();
  if (!item) return;
  const copy = { ...item, id: makeId(), x: clamp(item.x + 4, EDITOR_MIN_POSITION, EDITOR_MAX_POSITION), y: clamp(item.y + 4, EDITOR_MIN_POSITION, EDITOR_MAX_POSITION) };
  state.elements.splice(selectedElementIndex() + 1, 0, copy);
  selectedId = copy.id;
  render();
});

deleteButton.addEventListener("click", () => {
  state.elements = state.elements.filter((item) => item.id !== selectedId);
  selectedId = null;
  render();
});

connectButton.addEventListener("click", async () => {
  try {
    await connectPrinter();
  } catch (error) {
    log(`Connect failed: ${error.message}`);
  }
});

printButton.addEventListener("click", async () => {
  if (isPrinting) return;
  if (!printer) {
    log("Connect to the printer before printing.");
    return;
  }
  const copies = printCopies();
  printCopiesInput.value = String(copies);
  setPrinting(true);
  try {
    const canvas = await renderPrintCanvas();
    const packets = await printer.printCanvas(canvas, {
      widthMm: state.widthMm,
      heightMm: state.heightMm,
      threshold: WORKING_PRINTER.threshold,
      compressed: true,
      maxBagBytes: 1000,
      copies,
      copyDelayMs: 4500,
      waitForPrintComplete: true,
      printCompleteTimeoutMs: 30000,
      printCompleteSettleMs: 400,
      onCopyStart: ({ copy, copies: totalCopies }) => {
        setPrintProgress(`Printing ${copy}/${totalCopies}`);
        log(`Sending copy ${copy}/${totalCopies}`);
      },
      onCopyWritten: ({ copy, copies: totalCopies }) => {
        if (copy < totalCopies) {
          setPrintProgress(`Waiting ${copy}/${totalCopies}`);
          log(`Copy ${copy}/${totalCopies} sent; waiting for printer to finish before next copy`);
        } else {
          setPrintProgress("Finishing...");
          log(`Copy ${copy}/${totalCopies} sent; waiting for printer to finish`);
        }
      },
      onCopyComplete: ({ copy, copies: totalCopies }) => {
        log(`Printer reported copy ${copy}/${totalCopies} complete`);
      },
      onCopyWaitTimeout: ({ copy, copies: totalCopies }) => {
        log(`No print-complete status for copy ${copy}/${totalCopies}; using fallback delay`);
      },
    });
    log(`Printed ${copies} ${copies === 1 ? "copy" : "copies"} (${packets.length} packets)`);
  } catch (error) {
    log(`Print failed: ${error.message}`);
  } finally {
    setPrinting(false);
  }
});

downloadJsonButton.addEventListener("click", () => {
  try {
    const template = buildDesign().toJSON();
    const json = `${JSON.stringify(template, null, 2)}\n`;
    downloadBlob(new Blob([json], { type: "application/json" }), "rlabel-template.json");
    log("Downloaded JSON template. Use {{fieldName}} placeholders in Text / Data fields for substitution.");
  } catch (error) {
    log(`JSON export failed: ${error.message}`);
  }
});

window.addEventListener("resize", render);

render();
window.r22WebDesigner = {
  state,
  render,
  buildDesign,
  renderPrintCanvas,
  exportTemplate: () => buildDesign().toJSON(),
  importTemplate: applyTemplate,
  addElement,
};
log("Ready");
