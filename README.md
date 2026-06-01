# r22-web

Web Bluetooth printing and browser-based label design for R22/Rongta-style label printers.

`r22-web` renders labels to a monochrome bitmap and sends them over the RT packet protocol used by the tested `R22_751D` printer. It includes a small JavaScript SDK, a drag-and-drop label designer, JSON template import/export, Code 128 / Code 39 barcodes, QR codes, images, layers, rotation, and direct printing from Chrome or Edge.

> Experimental hardware project: this currently targets the observed `R22_751D` BLE behavior. Firmware variants that only expose Classic Bluetooth SPP cannot be reached from Web Bluetooth.

## Hosted Designer

Open the hosted designer at:

```text
https://brenden2008.github.io/r22-web/
```

The hosted page is served over HTTPS, so Web Bluetooth can request printer access directly from compatible Chromium browsers.

## Features

- Web Bluetooth connection to the tested R22 BLE GATT print path.
- RT bitmap packet generation with compressed image chunks.
- Browser designer for text, barcodes, QR codes, images, boxes, lines, layers, and 90-degree rotation.
- Exact print-preview canvas so the editor shows the bitmap that will be sent to the printer.
- JSON template import/export with `{{field}}` substitution for programmatic printing.
- Scanner-friendly Code 128 C, Code 128, and Code 39 rendering with quiet zones.
- QR codes constrained to square object bounds.
- Optional printed label border, snap-to-grid, hidden grid/workspace background, and one-pixel arrow-key nudging.
- Sequential multi-copy printing from the web UI and SDK.

## Browser Support

Web Bluetooth is available in Chromium-based browsers such as Chrome and Edge. The page must be served from HTTPS or `localhost`.

Safari and Firefox do not currently support the Web Bluetooth API needed by this project.

## Quick Start

Clone and serve the project:

```bash
git clone https://github.com/Brenden2008/r22-web.git
cd r22-web
python3 -m http.server 8080
```

Open the designer:

```text
http://localhost:8080/demo/
```

Click **Connect**, choose the printer, then click **Print**.

Set **Copies** before printing to send multiple labels. The designer disables the print controls while a job is active and waits for the printer's print-complete status before sending the next bitmap. If the printer only acknowledges the image-end packet, the designer waits up to 3 more seconds for the later completion status, then proceeds.

The demo is hard-coded to the working `R22_751D` setup:

- RT bitmap packets
- printer type `0x1c`
- BLE service `0000ff00-0000-1000-8000-00805f9b34fb`
- write characteristic `0000ff02-0000-1000-8000-00805f9b34fb`
- flow/status characteristic `0000ff03-0000-1000-8000-00805f9b34fb`
- 244-byte chunks
- write without response
- threshold `160`

## SDK Usage

```js
import { R22Printer, R22Protocol } from "./src/index.js";

const printer = new R22Printer({
  protocol: new R22Protocol({ printerType: 0x1c }),
  language: "rt",
});

await printer.connect();

await printer.printText("GARAGE SHELF A3", {
  widthMm: 50,
  heightMm: 30,
});
```

## Grid Label API

The high-level API composes a fixed-size label canvas using millimeters and grid cells, then prints that canvas through the R22 RT bitmap path.

```js
await printer
  .begin({
    widthMm: 50,
    heightMm: 30,
    columns: 12,
    rows: 6,
    paddingMm: 1.8,
    gapMm: 0.8,
  })
  .cell(0, 0, 6, 12)
    .rect({ lineWidth: 3 })
  .cell(0, 0, 2, 12)
    .align("center")
    .bold()
    .fontSize(34)
    .text("GARAGE SHELF A3")
  .clearFormatting()
  .cell(2, 0, 3, 7)
    .barcode("CODE128C", "1234567890", { showText: true, fontSize: 12 })
  .cell(2, 7, 3, 5)
    .qr("GARAGE SHELF A3")
  .cell(5, 0, 1, 12)
    .align("center")
    .fontSize(13)
    .text(new Date().toLocaleString())
  .write();
```

Drawing calls:

- `text(value, options)`
- `image(urlOrImageOrCanvas, options)`
- `barcode(type, data, options)` where `type` is `CODE128C`, `CODE128`, or `CODE39`
- `qr(data, options)`
- `rect(options)`
- `line(options)`
- `raw((ctx, rect, style, design) => void, options)`

Formatting calls affect following elements:

- `align`, `valign`, `font`, `fontSize`, `bold`, `underline`, `inverse`
- `doubleWidth`, `doubleHeight`, `rotate`, `lineSpacing`, `charSpacing`
- `clearFormatting`

Positioning uses `.cell(row, column, rowSpan, columnSpan)`. Any element can also use absolute millimeter coordinates:

```js
.text("Fixed position", {
  xMm: 2,
  yMm: 4,
  widthMm: 24,
  heightMm: 6,
})
```

Render a preview before printing:

```js
const job = printer
  .begin({ widthMm: 50, heightMm: 30 })
  .cell(0, 0, 1, 12)
  .text("Preview");

await job.preview(document.querySelector("canvas"));
```

## JSON Templates

The designer exports JSON templates that can be printed by the SDK. Template strings support `{{fieldName}}` and dotted paths such as `{{device.imei}}`.

```js
import { R22GridDesign, R22Printer, R22Protocol } from "./src/index.js";

const template = await fetch("./rlabel-template.json").then((response) => response.json());
const data = {
  shelf: "GARAGE SHELF A3",
  sku: "R22-751D",
  device: { imei: "351211104533516" },
};

const printer = new R22Printer({
  protocol: new R22Protocol({ printerType: 0x1c }),
  language: "rt",
});

await printer.connect();
await printer.printTemplate(template, data);

const design = R22GridDesign.fromJSON(template, data);
await printer.printDesign(design);
```

The JSON schema name remains `rlabel.grid.v1` for compatibility with earlier exported templates.

## Battery Status

```js
const battery = await printer.getBatteryStatus();
console.log(battery.percent, battery.charging, battery.raw);
```

The tested printer did not reliably return a battery notification on the Web Bluetooth print path, so callers should handle timeout errors.

## Hardware Notes

The tested printer advertised as `R22_751D` and exposed a writable BLE service after connection. The normal mobile-app path appears to use Classic Bluetooth SPP for some operations; browsers cannot access SPP directly. This library works only when the printer exposes a Web Bluetooth-compatible GATT write path.

## Development

Run the small protocol test suite:

```bash
npm test
```

Serve the demo during development:

```bash
python3 -m http.server 8080
```

## License

MIT
