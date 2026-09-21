/**
 * Cirkle PWA Icon Generator
 *
 * Generates the three PNG icons referenced by /public/manifest.json:
 *   - icon-192.png            (192×192, purpose=any)
 *   - icon-512.png            (512×512, purpose=any)
 *   - icon-512-maskable.png   (512×512, purpose=maskable — has 20% safe-zone padding)
 *
 * Uses @napi-rs/canvas (already in package.json). The icon is a simple
 * Cirkle brand mark: dark background (#0d1117) with a green ring (#1a6b3a)
 * and a centered white "C" glyph.
 *
 * Usage:
 *   bun run scripts/generate-pwa-icons.ts
 */

import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = resolve(__dirname, "..", "public");

const BG = "#0d1117";
const RING = "#1a6b3a";
const RING_HIGHLIGHT = "#2ea563";
const GLYPH = "#ffffff";

/**
 * Draw the Cirkle brand mark — a green ring + a centered "C" glyph.
 *
 * @param size      side length of the canvas in px
 * @param maskable  if true, scale the mark down to ~80% of the canvas to
 *                  leave the safe zone required by maskable icons (so the
 *                  OS doesn't clip into the ring when applying a mask)
 */
function drawCirkleIcon(size: number, maskable = false): Buffer {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // ─── Background ───────────────────────────────────────────────
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, size, size);

  // Subtle radial vignette for depth
  const vgrad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.7);
  vgrad.addColorStop(0, "rgba(46,165,99,0.20)");
  vgrad.addColorStop(1, "rgba(13,17,23,0)");
  ctx.fillStyle = vgrad;
  ctx.fillRect(0, 0, size, size);

  // For maskable icons, the safe zone is the inner 80% — so scale the mark
  // down to 0.7 to leave comfortable padding.
  const scale = maskable ? 0.7 : 0.92;
  const markSize = size * scale;
  const offset = (size - markSize) / 2;

  // ─── Outer ring ────────────────────────────────────────────────
  const ringCenterX = size / 2;
  const ringCenterY = size / 2;
  const outerRadius = markSize / 2;
  const innerRadius = outerRadius * 0.78;
  const ringWidth = outerRadius - innerRadius;

  // Soft outer glow
  ctx.shadowColor = RING_HIGHLIGHT;
  ctx.shadowBlur = size * 0.04;
  ctx.fillStyle = RING;
  ctx.beginPath();
  ctx.arc(ringCenterX, ringCenterY, outerRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Cut out the inner hole to make it a ring
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(ringCenterX, ringCenterY, innerRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  // Add a subtle highlight on the top-left of the ring
  ctx.strokeStyle = RING_HIGHLIGHT;
  ctx.lineWidth = ringWidth * 0.18;
  ctx.beginPath();
  ctx.arc(ringCenterX, ringCenterY, (outerRadius + innerRadius) / 2, Math.PI * 1.1, Math.PI * 1.6);
  ctx.stroke();

  // ─── "C" glyph (centered) ──────────────────────────────────────
  ctx.fillStyle = GLYPH;
  // Font size ~ 50% of the inner diameter
  const fontSize = innerRadius * 1.05;
  ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Nudge y down a hair because "C" has no ascender/descender to center visually
  ctx.fillText("C", ringCenterX, ringCenterY + size * 0.015);

  // ─── Save ──────────────────────────────────────────────────────
  return canvas.toBuffer("image/png");
}

function main() {
  mkdirSync(PUBLIC_DIR, { recursive: true });

  const targets = [
    { file: "icon-192.png", size: 192, maskable: false },
    { file: "icon-512.png", size: 512, maskable: false },
    { file: "icon-512-maskable.png", size: 512, maskable: true },
  ];

  for (const t of targets) {
    const buf = drawCirkleIcon(t.size, t.maskable);
    const out = resolve(PUBLIC_DIR, t.file);
    writeFileSync(out, buf);
    console.log(`✓ wrote ${out} (${buf.length.toLocaleString()} bytes)`);
  }
}

main();
