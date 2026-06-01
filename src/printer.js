import {
  R22Protocol,
  buildR22ZplFromCanvas,
  concatBytes,
  mmToDots,
  parseBatteryStatus,
  readRtPackets,
  renderLabelToMonoBytes,
} from "./protocol.js";
import { R22GridDesign, R22PrintJob } from "./designer.js";

export const DEFAULT_UUIDS = {
  firmwareService: "0000ff00-0000-1000-8000-00805f9b34fb",
  firmwareNotify: "0000ff01-0000-1000-8000-00805f9b34fb",
  firmwareWrite: "0000ff02-0000-1000-8000-00805f9b34fb",
  firmwareFlow: "0000ff03-0000-1000-8000-00805f9b34fb",
  isscService: "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  isscNotify: "49535343-1e4d-4bd9-ba61-23c647249616",
  isscWrite: "49535343-8841-43f4-a8d4-ecbe34729bb3",
  isscNotifyWrite: "49535343-aca3-481c-91ec-d85e28a60318",
  hm10Service: "0000ffe0-0000-1000-8000-00805f9b34fb",
  hm10WriteNotify: "0000ffe1-0000-1000-8000-00805f9b34fb",
  nordicService: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  nordicRx: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
  nordicTx: "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
};

export const DEFAULT_BLE_CANDIDATES = [
  {
    serviceUuid: DEFAULT_UUIDS.firmwareService,
    writeUuid: DEFAULT_UUIDS.firmwareWrite,
    notifyUuid: DEFAULT_UUIDS.firmwareNotify,
    flowUuid: DEFAULT_UUIDS.firmwareFlow,
  },
  {
    serviceUuid: DEFAULT_UUIDS.isscService,
    writeUuid: DEFAULT_UUIDS.isscWrite,
    notifyUuid: DEFAULT_UUIDS.isscNotify,
  },
  {
    serviceUuid: DEFAULT_UUIDS.isscService,
    writeUuid: DEFAULT_UUIDS.isscNotifyWrite,
    notifyUuid: DEFAULT_UUIDS.isscNotifyWrite,
  },
  {
    serviceUuid: DEFAULT_UUIDS.hm10Service,
    writeUuid: DEFAULT_UUIDS.hm10WriteNotify,
    notifyUuid: DEFAULT_UUIDS.hm10WriteNotify,
  },
  {
    serviceUuid: DEFAULT_UUIDS.nordicService,
    writeUuid: DEFAULT_UUIDS.nordicRx,
    notifyUuid: DEFAULT_UUIDS.nordicTx,
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCopies(value) {
  const copies = Number(value ?? 1);
  if (!Number.isFinite(copies)) return 1;
  return Math.max(1, Math.floor(copies));
}

async function getCharacteristic(service, uuid) {
  if (!uuid) return undefined;
  try {
    return await service.getCharacteristic(uuid);
  } catch {
    return undefined;
  }
}

export class R22Printer extends EventTarget {
  constructor({
    protocol = new R22Protocol(),
    candidates = DEFAULT_BLE_CANDIDATES,
    chunkSize = 244,
    chunkDelayMs = 50,
    writeWithResponse = true,
    language = "r22-zpl",
  } = {}) {
    super();
    this.protocol = protocol;
    this.candidates = candidates;
    this.chunkSize = chunkSize;
    this.chunkDelayMs = chunkDelayMs;
    this.writeWithResponse = writeWithResponse;
    this.language = language;
    this.device = undefined;
    this.server = undefined;
    this.service = undefined;
    this.writeCharacteristic = undefined;
    this.notifyCharacteristic = undefined;
    this.flowCharacteristic = undefined;
    this.rxBuffer = new Uint8Array();
    this.protocolPackets = [];
    this.flowCredits = 0;
    this.flowMtu = 20;
    this.flowWaiters = [];
  }

  async connect({
    requestOptions,
    initialize = true,
  } = {}) {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not available in this browser");
    }

    const optionalServices = [...new Set(this.candidates.map((item) => item.serviceUuid))];
    const defaultRequestOptions = {
      acceptAllDevices: true,
      optionalServices,
    };

    this.device = await navigator.bluetooth.requestDevice(
      requestOptions ?? defaultRequestOptions,
    );
    this.device.addEventListener("gattserverdisconnected", () => {
      this.dispatchEvent(new Event("disconnect"));
    });

    this.server = await this.device.gatt.connect();
    await this.findWritablePipe();

    if (initialize) {
      await this.initialize();
    }

    this.dispatchEvent(new Event("connect"));
    return this;
  }

  async findWritablePipe() {
    if (!this.server) {
      throw new Error("Not connected");
    }

    for (const candidate of this.candidates) {
      let service;
      try {
        service = await this.server.getPrimaryService(candidate.serviceUuid);
      } catch {
        continue;
      }

      const write = await getCharacteristic(service, candidate.writeUuid);
      const notify = await getCharacteristic(service, candidate.notifyUuid);
      const flow = await getCharacteristic(service, candidate.flowUuid);

      if (write?.properties?.write || write?.properties?.writeWithoutResponse) {
        this.service = service;
        this.writeCharacteristic = write;
        this.notifyCharacteristic = notify;
        this.flowCharacteristic = flow;
        await this.startNotifications();
        return;
      }
    }

    throw new Error("No known writable BLE printer characteristic was found");
  }

  async startNotifications() {
    if (this.notifyCharacteristic?.properties?.notify) {
      await this.notifyCharacteristic.startNotifications();
      this.notifyCharacteristic.addEventListener("characteristicvaluechanged", (event) => {
        const data = new Uint8Array(event.target.value.buffer.slice(0));
        this.handleIncomingData(data);
        this.dispatchEvent(new CustomEvent("data", { detail: data }));
      });
    }

    if (this.flowCharacteristic?.properties?.notify) {
      await this.flowCharacteristic.startNotifications();
      this.flowCharacteristic.addEventListener("characteristicvaluechanged", (event) => {
        const data = new Uint8Array(event.target.value.buffer.slice(0));
        this.handleFlowData(data);
        this.dispatchEvent(new CustomEvent("flow", { detail: data }));
      });
    }
  }

  handleFlowData(data) {
    if (data[0] === 0x02 && data.length >= 3) {
      this.flowMtu = data[1] | (data[2] << 8);
      if (this.flowMtu >= 0xf5) this.flowMtu = 0xf4;
    } else if (data[0] === 0x01 && data.length >= 2) {
      this.flowCredits += data[1];
      while (this.flowCredits > 0 && this.flowWaiters.length) {
        this.flowWaiters.shift()();
      }
    }
  }

  handleIncomingData(data) {
    this.rxBuffer = concatBytes([this.rxBuffer, data]);
    const { packets, remainder } = readRtPackets(this.rxBuffer);
    this.rxBuffer = remainder;
    for (const packet of packets) {
      this.protocolPackets.push(packet);
      this.dispatchEvent(new CustomEvent("protocol", { detail: packet }));
    }
  }

  waitForProtocolPacket(predicate, timeoutMs = 1800) {
    const existing = this.protocolPackets.find(predicate);
    if (existing) return Promise.resolve(existing);

    return this.waitForNewProtocolPacket(predicate, timeoutMs);
  }

  waitForNewProtocolPacket(predicate, timeoutMs = 1800, timeoutMessage = "Timed out waiting for R22 protocol response") {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeEventListener("protocol", onProtocol);
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      const onProtocol = (event) => {
        if (!predicate(event.detail)) return;
        clearTimeout(timeout);
        this.removeEventListener("protocol", onProtocol);
        resolve(event.detail);
      };

      this.addEventListener("protocol", onProtocol);
    });
  }

  isPrintCompletePacket(packet) {
    const payload = packet?.payload ?? [];
    return packet?.command === 0x100107 &&
      payload.length >= 28 &&
      payload[0] === 0x01 &&
      payload[1] === 0x01 &&
      payload[4] === 0x02 &&
      payload[5] === 0x0e &&
      payload[6] === 0x00 &&
      payload[21] === 0x03 &&
      payload[22] === 0x04;
  }

  async waitForPrintComplete({ timeoutMs = 30000, settleMs = 400 } = {}) {
    const packet = await this.waitForNewProtocolPacket(
      (item) => this.isPrintCompletePacket(item),
      timeoutMs,
      "Timed out waiting for R22 print-complete status",
    );
    if (settleMs) await sleep(settleMs);
    return packet;
  }

  async waitForAuthCode() {
    const packet = await this.waitForProtocolPacket((item) => {
      const data = item.json ?? {};
      return Boolean(data.authCode || data.shakeHandAuthCode);
    });
    return packet.json.authCode || packet.json.shakeHandAuthCode;
  }

  waitForBatteryStatus(timeoutMs = 3500) {
    const existing = this.protocolPackets.find((item) => this.isBatteryPacket(item));
    if (existing) return Promise.resolve(parseBatteryStatus(existing));

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.removeEventListener("protocol", onProtocol);
        this.removeEventListener("data", onData);
      };
      const done = (status) => {
        cleanup();
        resolve(status);
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for battery status"));
      }, timeoutMs);
      const onProtocol = (event) => {
        if (this.isBatteryPacket(event.detail)) done(parseBatteryStatus(event.detail));
      };
      const onData = (event) => {
        const text = new TextDecoder().decode(event.detail);
        const match = text.match(/\{.*\}/s);
        if (!match) return;
        try {
          const json = JSON.parse(match[0]);
          if (this.isBatteryJson(json)) done(parseBatteryStatus(json));
        } catch {
          // Ignore non-JSON notification fragments.
        }
      };
      this.addEventListener("protocol", onProtocol);
      this.addEventListener("data", onData);
    });
  }

  isBatteryPacket(packet) {
    return this.isBatteryJson(packet?.json);
  }

  isBatteryJson(data = {}) {
    return Boolean(
      data.batteryPercent !== undefined ||
      data.batteryState !== undefined ||
      data.powerPercent !== undefined ||
      data.charging !== undefined ||
      data.percent !== undefined ||
      data.battery !== undefined,
    );
  }

  async initialize() {
    if (this.language === "r22-zpl") {
      return;
    }

    await this.writePackets(this.protocol.connectProtocolPackets());
    if (this.protocol.printerType === 0x1c || this.protocol.printerType === 0x21) {
      try {
        const authCode = await this.waitForAuthCode();
        await this.writePackets(this.protocol.r22AuthHandshakePackets(authCode));
      } catch {
        await this.writePackets(this.protocol.r22HandshakePackets());
      }
      return;
    }

    const handshakePackets = this.protocol.handshakePackets();
    if (handshakePackets.length) {
      await sleep(80);
      await this.writePackets(handshakePackets);
    }
  }

  async disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }

  async writePackets(packets) {
    for (const packet of packets) {
      await this.write(packet);
    }
  }

  async getBatteryStatus({ timeoutMs = 3500 } = {}) {
    const waitForBattery = this.waitForBatteryStatus(timeoutMs);
    await this.write(this.protocol.batteryStatusPacket());
    return waitForBattery;
  }

  async write(bytes) {
    if (!this.writeCharacteristic) {
      throw new Error("No write characteristic is available");
    }

    for (let offset = 0; offset < bytes.length;) {
      const chunkLimit = this.flowCharacteristic ? Math.min(this.chunkSize, this.flowMtu) : this.chunkSize;
      const chunk = bytes.slice(offset, offset + chunkLimit);
      if (this.flowCharacteristic) {
        await this.waitForFlowCredit();
      }
      if (this.writeWithResponse && this.writeCharacteristic.writeValueWithResponse) {
        await this.writeCharacteristic.writeValueWithResponse(chunk);
      } else if (this.writeCharacteristic.writeValueWithoutResponse) {
        await this.writeCharacteristic.writeValueWithoutResponse(chunk);
      } else {
        await this.writeCharacteristic.writeValue(chunk);
      }
      if (this.flowCharacteristic) {
        this.flowCredits = Math.max(0, this.flowCredits - 1);
      }
      offset += chunk.length;
      if (this.chunkDelayMs) await sleep(this.chunkDelayMs);
    }
  }

  waitForFlowCredit(timeoutMs = 5000) {
    if (this.flowCredits > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.flowWaiters.indexOf(done);
        if (index >= 0) this.flowWaiters.splice(index, 1);
        reject(new Error("Timed out waiting for BLE flow-control credit"));
      }, timeoutMs);
      const done = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.flowWaiters.push(done);
    });
  }

  async printCanvas(canvas, options = {}) {
    const {
      copies = 1,
      copyDelayMs = 4500,
      waitForPrintComplete = true,
      printCompleteTimeoutMs = 30000,
      printCompleteSettleMs = 400,
      onCopyStart,
      onCopyWritten,
      onCopyComplete,
      onCopyWaitTimeout,
      ...printOptions
    } = options;
    const normalizedCopies = normalizeCopies(copies);

    if (this.language === "r22-zpl") {
      const payload = await buildR22ZplFromCanvas(canvas, { ...printOptions, copies: normalizedCopies });
      if (onCopyStart) onCopyStart({ copy: 1, copies: normalizedCopies });
      await this.write(payload);
      if (onCopyWritten) onCopyWritten({ copy: normalizedCopies, copies: normalizedCopies });
      return [payload];
    }

    const monoBytes = renderLabelToMonoBytes(canvas, printOptions);
    const packets = this.protocol.printBitmapPackets(
      monoBytes,
      canvas.width,
      canvas.height,
      printOptions,
    );
    const writtenPackets = [];
    for (let copy = 0; copy < normalizedCopies; copy += 1) {
      if (onCopyStart) onCopyStart({ copy: copy + 1, copies: normalizedCopies });
      await this.writePackets(packets);
      if (onCopyWritten) onCopyWritten({ copy: copy + 1, copies: normalizedCopies });
      writtenPackets.push(...packets);
      if (waitForPrintComplete) {
        try {
          await this.waitForPrintComplete({
            timeoutMs: printCompleteTimeoutMs,
            settleMs: printCompleteSettleMs,
          });
          if (onCopyComplete) onCopyComplete({ copy: copy + 1, copies: normalizedCopies });
          continue;
        } catch (error) {
          if (onCopyWaitTimeout) onCopyWaitTimeout({ copy: copy + 1, copies: normalizedCopies, error });
        }
      }
      if (copyDelayMs) await sleep(copyDelayMs);
    }
    return writtenPackets;
  }

  begin(options = {}) {
    return new R22PrintJob(this, options);
  }

  async printDesign(design, options = {}) {
    const { data = {}, ...printOptions } = options;
    const canvas = await design.toCanvas(data);
    return this.printCanvas(canvas, {
      widthMm: design.widthMm,
      heightMm: design.heightMm,
      compressed: true,
      maxBagBytes: 1000,
      ...printOptions,
    });
  }

  async printTemplate(template, data = {}, options = {}) {
    const design = R22GridDesign.fromJSON(template, data);
    return this.printDesign(design, options);
  }

  async printText(text, {
    widthMm = 50,
    heightMm = 30,
    dpi = 203,
    font = "bold 42px system-ui, sans-serif",
    align = "center",
    threshold = 160,
    ...packetOptions
  } = {}) {
    const canvas = document.createElement("canvas");
    canvas.width = mmToDots(widthMm, dpi);
    canvas.height = mmToDots(heightMm, dpi);
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000";
    context.font = font;
    context.textAlign = align;
    context.textBaseline = "middle";

    const x = align === "left" ? 16 : align === "right" ? canvas.width - 16 : canvas.width / 2;
    context.fillText(text, x, canvas.height / 2, canvas.width - 32);

    return this.printCanvas(canvas, {
      threshold,
      ...packetOptions,
    });
  }

  buildPrintPayload(canvas, options = {}) {
    if (this.language === "r22-zpl") {
      throw new Error("Use buildPrintPayloadAsync for R22 ZPL payloads");
    }

    const monoBytes = renderLabelToMonoBytes(canvas, options);
    return concatBytes(this.protocol.printBitmapPackets(
      monoBytes,
      canvas.width,
      canvas.height,
      options,
    ));
  }

  async buildPrintPayloadAsync(canvas, options = {}) {
    if (this.language === "r22-zpl") {
      return buildR22ZplFromCanvas(canvas, options);
    }

    return this.buildPrintPayload(canvas, options);
  }
}
