import qrcode from "qrcode-generator";
import { encodeGrayscalePng } from "./png";

/**
 * Rasterises text into a QR code PNG without a canvas.
 *
 * @param text — payload to encode, usually a share link.
 * @param scale — pixels per QR module. Defaults to 8.
 * @param quietZone — blank modules added on every side; the QR spec requires
 *   at least 4. Defaults to 4.
 * @returns the QR code as grayscale PNG bytes.
 */
export async function qrPng(text: string, scale = 8, quietZone = 4): Promise<Uint8Array> {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();

  const modules = qr.getModuleCount();
  const size = (modules + quietZone * 2) * scale;
  const pixels = new Uint8Array(size * size).fill(255);

  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (!qr.isDark(row, col)) continue;
      const startX = (col + quietZone) * scale;
      const startY = (row + quietZone) * scale;
      for (let y = 0; y < scale; y += 1) {
        pixels.fill(0, (startY + y) * size + startX, (startY + y) * size + startX + scale);
      }
    }
  }

  return encodeGrayscalePng(pixels, size, size);
}
