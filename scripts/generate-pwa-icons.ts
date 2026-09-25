/**
 * Cirkle PWA Icon Generator — Premium Design System
 *
 * Generates the three PNG icons referenced by /public/manifest.json:
 *   - icon-192.png            (192×192, purpose=any)
 *   - icon-512.png            (512×512, purpose=any)
 *   - icon-512-maskable.png   (512×512, purpose=maskable — has 20% safe-zone padding)
 *
 * Uses @napi-rs/canvas (already in package.json). The icon is the official
 * Cirkle CircleMark: three overlapping circles with a gold→rose→teal gradient
 * stroke and a small filled gradient dot in the center.
 *
 * Brand colors (from fortleem/cirkle-ac8fabe4):
 *   --gold:   39 45% 57%  → #C2A060
 *   --rose:   351 41% 56% → #C06070
 *   --teal:   195 56% 23% → #1A4A5A
 *   --cream:  40 50% 98%  → #FDFCF9 (background)
 *   --charcoal: 60 8% 9%  → #1A1A14 (dark background for dark mode)
 *
 * Usage:
 *   bun run scripts/generate-pwa-icons.ts
 */

import { createCanvas, GlobalPixelFormat } from "@napi-rs/canvas";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = resolve(__dirname, "..", "public");

// Cirkle brand colors (HSL → hex)
const GOLD = "#C2A060";
const ROSE = "#C06070";
const TEAL = "#1A4A5A";
const CREAM = "#FDFCF9";
const CHARCOAL = "#1A1A14";

/**
 * Draw the Cirkle CircleMark — three overlapping circles in a triangular
 * formation with a gold→rose→teal gradient stroke and a filled center dot.
 *
 * Matches the SVG in src/components/brand/cirkle-logo.tsx exactly:
 *   <circle cx="50" cy="32" r="22" />   (top)
 *   <circle cx="32" cy="60" r="22" />   (bottom-left)
 *   <circle cx="68" cy="60" r="22" />   (bottom-right)
 *   <circle cx="50" cy="50" r="6" fill /> (center dot)
 */
function drawCirkleIcon(size: number, maskable = false): Buffer {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Scale factor: viewBox is 100×100, canvas is size×size
  const scale = size / 100;
  // For maskable, scale down to 80% to leave safe zone
  const drawScale = maskable ? scale * 0.8 : scale;
  const offset = maskable ? size * 0.1 : 0;

  // Background
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, size, size);

  // Create gradient: gold → rose → teal (135deg)
  const grad = ctx.createLinearGradient(
    offset,
    offset,
    offset + 100 * drawScale,
    offset + 100 * drawScale
  );
  grad.addColorStop(0, GOLD);
  grad.addColorStop(0.5, ROSE);
  grad.addColorStop(1, TEAL);

  ctx.save();
  ctx.translate(offset, offset);
  ctx.scale(drawScale, drawScale);

  // Three overlapping circles (stroke only, semi-transparent)
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.9;

  // Top circle (cx=50, cy=32, r=22)
  ctx.beginPath();
  ctx.arc(50, 32, 22, 0, Math.PI * 2);
  ctx.stroke();

  // Bottom-left circle (cx=32, cy=60, r=22)
  ctx.beginPath();
  ctx.arc(32, 60, 22, 0, Math.PI * 2);
  ctx.stroke();

  // Bottom-right circle (cx=68, cy=60, r=22)
  ctx.beginPath();
  ctx.arc(68, 60, 22, 0, Math.PI * 2);
  ctx.stroke();

  // Center dot (cx=50, cy=50, r=6, filled)
  ctx.globalAlpha = 1;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(50, 50, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  return canvas.toBuffer("image/png");
}

// Generate all three icons
const icons = [
  { name: "icon-192.png", size: 192, maskable: false },
  { name: "icon-512.png", size: 512, maskable: false },
  { name: "icon-512-maskable.png", size: 512, maskable: true },
];

console.log("[INFO] Generating Cirkle PWA icons (premium design system)…");
console.log(`[INFO] Brand colors: gold=${GOLD}, rose=${ROSE}, teal=${TEAL}, bg=${CREAM}`);

for (const icon of icons) {
  const buf = drawCirkleIcon(icon.size, icon.maskable);
  const path = resolve(PUBLIC_DIR, icon.name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  console.log(`[OK] ${icon.name} (${icon.size}×${icon.size}${icon.maskable ? ", maskable" : ""}) — ${(buf.length / 1024).toFixed(1)} KB`);
}

console.log("[DONE] All 3 PWA icons generated with the official Cirkle CircleMark.");
