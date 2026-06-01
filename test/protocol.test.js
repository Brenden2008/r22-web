import assert from "node:assert/strict";
import {
  R22Protocol,
  R22Printer,
  bytesToHex,
  concatBytes,
  crc16Ccitt,
  crc32Rt,
  crc32RtSdk,
  md5Hex,
  parseBatteryStatus,
  r22AuthDigest,
  r22OdmDigest,
  R22GridDesign,
  drawBarcode,
  drawQrCode,
  normalizeRotation,
  resolveLabelTemplate,
  readRtPackets,
  textToBytes,
} from "../src/index.js";

assert.equal(crc32Rt(Uint8Array.from([0x01, 0x01, 0x01, 0x00, 0x00])), 0xf30deae0);
assert.equal(crc32RtSdk(Uint8Array.from([0x11, 0x05, 0x0b, 0x07, 0x00, 0x80, 0x01, 0xa0, 0x00, 0x01, 0x00, 0x01])), 0x3a8428db);
assert.equal(md5Hex("abc"), "900150983cd24fb0d6963f7d28e17f72");
assert.equal(r22AuthDigest("abc"), "4713ae66b2b6bc98");
assert.equal(r22OdmDigest(""), "838198f2acb95c87");

const protocol = new R22Protocol({ printerType: 0x1c });
const connectPackets = protocol.connectProtocolPackets();
const connect = connectPackets[0];
assert.equal(connectPackets.length, 2);
assert.equal(bytesToHex(connectPackets[0]), "a3 1e 1c 00 05 00 01 01 01 00 00 e0 ea 0d f3");
assert.equal(bytesToHex(connectPackets[1]), "a3 1e 1c 00 05 00 01 01 06 00 00 65 fc 42 f6");

const start = protocol.imageStartPacket(400, 240, { paperType: 1, paperGap: 0 });
assert.equal(start.length, 22);
assert.deepEqual([...start.slice(0, 11)], [0xa3, 0x1e, 0x1c, 0x00, 0x0c, 0x00, 0x11, 0x05, 0x0b, 0x07, 0x00]);

const mono = new Uint8Array(50 * 4);
mono.fill(0xff);
const packets = protocol.printBitmapPackets(mono, 400, 4, { maxPayloadBytes: 80 });
const payload = concatBytes(packets);
assert.ok(packets.length > 2);
assert.ok(payload.length > mono.length);

const parsed = readRtPackets(concatBytes([connect, start]));
assert.equal(parsed.packets.length, 2);
assert.equal(parsed.packets[0].command, 0x010101);
assert.equal(parsed.remainder.length, 0);

const completionBytes = Uint8Array.from([
  0xa3, 0x1e, 0x1c, 0x00, 0x10, 0x00, 0x10, 0x01, 0x12, 0x0b, 0x00,
  0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x01, 0x00, 0x00,
  0x4b, 0xdf, 0xd8, 0x8d,
]);
const completionPrinter = new R22Printer({ protocol: new R22Protocol({ printerType: 0x1c }), language: "rt" });
const completionWait = completionPrinter.waitForPrintComplete({ timeoutMs: 100, settleMs: 0 });
completionPrinter.handleIncomingData(completionBytes);
const completionPacket = await completionWait;
assert.equal(completionPacket.command, 0x101201);
assert.ok(completionPrinter.isPrintCompletePacket(completionPacket));

const selfTest = protocol.selfTestPacket();
assert.deepEqual([...selfTest.slice(6, 9)], [0x01, 0x05, 0x09]);
assert.equal(bytesToHex(protocol.batteryStatusPacket()), "a3 1e 1c 00 05 00 01 01 0e 00 00 dd ad 51 f8");

const handshake = protocol.r22AuthHandshakePackets("abc");
assert.equal(handshake.length, 5);
assert.equal(readRtPackets(handshake[0]).packets[0].text, "4713ae66b2b6bc98");
assert.deepEqual([...readRtPackets(handshake[1]).packets[0].payload.slice(0, 3)], [1, 16, 0]);

assert.equal(crc16Ccitt(textToBytes("123456789")), 0x31c3);
assert.deepEqual(parseBatteryStatus({ batteryPercent: "87", batteryState: "1" }), {
  percent: 87,
  charging: true,
  state: "1",
  raw: { batteryPercent: "87", batteryState: "1" },
});

const design = new R22GridDesign({ widthMm: 50, heightMm: 30, columns: 10, rows: 6, paddingMm: 0, gapMm: 0 });
const box = design.cell(1, 2, 2, 3).elementBox();
const rect = design.rectFor(box);
assert.deepEqual(
  { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  { x: 80, y: 40, width: 120, height: 80 },
);

const template = new R22GridDesign({ widthMm: 50, heightMm: 30, columns: 12, rows: 6 })
  .cell(0, 0, 1, 12)
  .text("Shelf {{shelf}}")
  .cell(1, 0, 2, 8)
  .barcode("CODE128", "{{sku}}", { showText: false })
  .toJSON();
assert.equal(template.schema, "rlabel.grid.v1");
assert.equal(template.elements.length, 2);
assert.equal(template.elements[1].style.padding, 0);
const filled = R22GridDesign.fromJSON(template, { shelf: "A3", sku: "R22-751D" });
assert.equal(filled.elements[0].text, "Shelf A3");
assert.equal(filled.elements[1].data, "R22-751D");
assert.deepEqual(resolveLabelTemplate({ text: "{{user.name}}", missing: "{{nope}}" }, { user: { name: "Brenden" } }), {
  text: "Brenden",
  missing: "{{nope}}",
});
assert.equal(normalizeRotation(44), 0);
assert.equal(normalizeRotation(46), 90);
assert.equal(normalizeRotation(-90), 270);
const rotated = new R22GridDesign().rotate(90).text("Sideways").toJSON();
assert.equal(rotated.elements[0].style.rotation, 90);

function fakeContext() {
  return {
    fillStyle: "#000",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    ops: [],
    fillRect(x, y, width, height) {
      this.ops.push({ type: "rect", fill: this.fillStyle, x, y, width, height });
    },
    fillText(text, x, y, maxWidth) {
      this.ops.push({ type: "text", text, x, y, maxWidth });
    },
  };
}

const barcodeContext = fakeContext();
drawBarcode(
  barcodeContext,
  "CODE128",
  "R22-751D",
  { x: 0, y: 0, width: 320, height: 80, padding: 0 },
  { fontFamily: "sans-serif", fontSize: 12, showText: false },
);
const barcodeBars = barcodeContext.ops.filter((op) => op.type === "rect" && op.fill === "#000");
assert.ok(barcodeBars.length > 20);
assert.ok(Math.min(...barcodeBars.map((op) => op.x)) >= 20);
assert.ok(Math.max(...barcodeBars.map((op) => op.x + op.width)) <= 300);
assert.ok(barcodeBars.every((op) => Number.isInteger(op.x) && Number.isInteger(op.width)));
assert.ok(barcodeBars.some((op) => op.width >= 4));

const qrContext = fakeContext();
drawQrCode(
  qrContext,
  "GARAGE SHELF A3",
  { x: 0, y: 0, width: 160, height: 160, padding: 0 },
  { fontFamily: "sans-serif", fontSize: 10, showText: false },
);
const qrDots = qrContext.ops.filter((op) => op.type === "rect" && op.fill === "#000");
assert.ok(qrDots.length > 0);
assert.equal(Math.min(...qrDots.map((op) => op.x)), 0);
assert.equal(Math.min(...qrDots.map((op) => op.y)), 0);

const copyPrinter = new R22Printer({ protocol: new R22Protocol({ printerType: 0x1c }), language: "rt" });
const copyWrites = [];
const copyEvents = [];
copyPrinter.writePackets = async (writtenPackets) => {
  copyWrites.push(writtenPackets.length);
};
copyPrinter.waitForPrintComplete = async () => {
  copyEvents.push("complete-status");
};
await copyPrinter.printCanvas({
  width: 8,
  height: 1,
  getContext() {
    return {
      getImageData() {
        const data = new Uint8ClampedArray(8 * 1 * 4);
        data.fill(255);
        return { data };
      },
    };
  },
}, {
  copies: 3,
  compressed: false,
  maxPayloadBytes: 64,
  copyDelayMs: 0,
  onCopyStart: ({ copy }) => copyEvents.push(`start-${copy}`),
  onCopyWritten: ({ copy }) => copyEvents.push(`written-${copy}`),
  onCopyComplete: ({ copy }) => copyEvents.push(`complete-${copy}`),
});
assert.deepEqual(copyWrites, [3, 3, 3]);
assert.deepEqual(copyEvents, [
  "start-1", "written-1", "complete-status", "complete-1",
  "start-2", "written-2", "complete-status", "complete-2",
  "start-3", "written-3", "complete-status", "complete-3",
]);

console.log("ok");
