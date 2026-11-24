/**
 * Printable QR SVG for waiver signage.
 * Vendored MIT encoder so print does not wait on a package install.
 */
import { createRequire } from "module";
import path from "path";

type QrCode = {
  addData: (data: string) => void;
  make: () => void;
  createSvgTag: (opts?: {
    cellSize?: number;
    margin?: number;
    scalable?: boolean;
  }) => string;
};

type QrFactory = (typeNumber: number, level: string) => QrCode;

export function waiverQrSvg(text: string): string {
  const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));
  const file = path.join(process.cwd(), "src/lib/waivers/vendor/qrcode-generator.js");
  const qrcode = nodeRequire(file) as QrFactory;
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
