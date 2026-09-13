/**
 * Server-side document image renderer using @napi-rs/canvas.
 *
 * Generates actual JPEG images for training samples (not text data URLs).
 * This fixes the Training tab showing broken images — samples now render
 * as real document card images with visible text.
 *
 * Used by:
 *  - scripts/seed-training-images.ts — regenerate all training sample images
 *  - The seed API endpoint — when creating new synthetic samples
 */

import { createCanvas, registerFont } from "@napi-rs/canvas";

export interface RenderParams {
  fullNameAr?: string;
  fullNameEn?: string;
  nationalId?: string;
  birthDate?: string;
  gender?: string;
  address?: string;
  job?: string;
  religion?: string;
  maritalStatus?: string;
  documentNo?: string;
  expiryDate?: string;
  nationality?: string;
  docType: string;
  country?: string;
  countryName?: string;
}

/**
 * Render a document card as a JPEG data URL.
 * Produces a realistic-looking ID card image with visible text fields.
 */
export function renderDocImage(params: RenderParams): string {
  const W = 800;
  const H = 500;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#f8f5e9";
  ctx.fillRect(0, 0, W, H);

  // Border
  ctx.strokeStyle = "#1a4b5b";
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, W - 16, H - 16);

  // Header bar
  ctx.fillStyle = "#1a4b5b";
  ctx.fillRect(8, 8, W - 16, 50);

  // Header text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px Arial";
  ctx.textAlign = "center";
  const headerText = params.countryName || params.country || "Document";
  ctx.fillText(headerText, W / 2, 40);

  // Subheader
  ctx.fillStyle = "#1a4b5b";
  ctx.font = "16px Arial";
  const docLabel = params.docType === "national_id" ? "National ID Card"
    : params.docType === "passport" ? "Passport"
    : params.docType === "driver_license" ? "Driver License"
    : "Residence Permit";
  ctx.fillText(docLabel, W / 2, 78);

  // Photo placeholder box
  ctx.strokeStyle = "#1a4b5b";
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 100, 140, 180);
  ctx.fillStyle = "#d4d0c0";
  ctx.fillRect(42, 102, 136, 176);
  ctx.fillStyle = "#888888";
  ctx.font = "12px Arial";
  ctx.textAlign = "center";
  ctx.fillText("PHOTO", 110, 195);

  // Fields (right side)
  let y = 130;
  const x = 210;
  ctx.textAlign = "left";

  const drawField = (label: string, value?: string) => {
    if (!value) return;
    ctx.fillStyle = "#666666";
    ctx.font = "11px Arial";
    ctx.fillText(label + ":", x, y);
    ctx.fillStyle = "#222222";
    ctx.font = "14px Arial";
    ctx.fillText(value, x + 80, y);
    y += 28;
  };

  if (params.fullNameAr) drawField("Name (Ar)", params.fullNameAr);
  if (params.fullNameEn) drawField("Name (En)", params.fullNameEn);
  if (params.nationalId) drawField("ID Number", params.nationalId);
  if (params.birthDate) drawField("Date of Birth", params.birthDate);
  if (params.gender) drawField("Gender", params.gender);
  if (params.nationality) drawField("Nationality", params.nationality);
  if (params.religion) drawField("Religion", params.religion);
  if (params.job) drawField("Profession", params.job);
  if (params.maritalStatus) drawField("Marital Status", params.maritalStatus);
  if (params.address) {
    ctx.fillStyle = "#666666";
    ctx.font = "11px Arial";
    ctx.fillText("Address:", x, y);
    ctx.fillStyle = "#222222";
    ctx.font = "13px Arial";
    // Wrap address if long
    const addr = params.address.length > 40 ? params.address.slice(0, 40) + "..." : params.address;
    ctx.fillText(addr, x + 80, y);
    y += 28;
  }

  // Document number (bottom left)
  if (params.documentNo) {
    ctx.fillStyle = "#888888";
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Doc No: " + params.documentNo, 40, H - 30);
  }

  // Expiry date (bottom right)
  if (params.expiryDate) {
    ctx.fillStyle = "#888888";
    ctx.font = "12px Arial";
    ctx.textAlign = "right";
    ctx.fillText("Expiry: " + params.expiryDate, W - 40, H - 30);
  }

  // Convert to JPEG data URL
  const buf = canvas.toBuffer("image/jpeg", { quality: 0.85 });
  return "data:image/jpeg;base64," + buf.toString("base64");
}
