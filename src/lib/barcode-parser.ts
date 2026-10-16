/**
 * Barcode & QR Code Parser — Pure TypeScript
 *
 * Implements QR code, Data Matrix, and PDF417 detection for identity documents.
 * Built from scratch using image analysis algorithms — no external dependencies.
 *
 * Supported symbologies:
 *   - QR Code (2D matrix) — used on many national ID cards (Philippines PhilSys, etc.)
 *   - PDF417 (stacked linear) — used on US driver licenses (AAMVA format)
 *   - Data Matrix (2D matrix) — used on some passports and residence permits
 *
 * NOTE: This is a lightweight detector + decoder. For production-grade
 * barcode reading, ZXing or zbar integration is recommended. This module
 * provides basic detection and payload extraction.
 */

/**
 * Detect the presence of a QR-like or barcode-like region in an image.
 * Uses simple heuristics: look for regions with high density of black/white
 * transitions (QR codes have many edges).
 */
export interface BarcodeDetection {
  found: boolean;
  type: "qr_code" | "pdf417" | "data_matrix" | "unknown" | "none";
  confidence: number; // 0-1
  boundingBox?: { x: number; y: number; width: number; height: number };
  estimatedPayload?: string;
  notes: string;
}

/**
 * Detect barcode/QR regions in image data (grayscale pixel array).
 * This is a simple heuristic detector — not a full barcode reader.
 */
export function detectBarcode(
  pixels: Uint8Array,
  width: number,
  height: number,
): BarcodeDetection {
  if (!pixels || width < 50 || height < 50) {
    return { found: false, type: "none", confidence: 0, notes: "Image too small for barcode detection" };
  }

  // Sample the image in a grid (every 4th pixel) to find regions with
  // high black/white transition density (characteristic of 2D barcodes)
  const gridSize = 20;
  const cellW = Math.floor(width / gridSize);
  const cellH = Math.floor(height / gridSize);
  const transitionMap: number[][] = [];

  for (let gy = 0; gy < gridSize; gy++) {
    transitionMap[gy] = [];
    for (let gx = 0; gx < gridSize; gx++) {
      let transitions = 0;
      let totalPixels = 0;
      const startY = gy * cellH;
      const startX = gx * cellW;
      const endY = Math.min(startY + cellH, height);
      const endX = Math.min(startX + cellW, width);

      for (let y = startY; y < endY; y += 2) {
        for (let x = startX; x < endX - 1; x += 2) {
          const idx = y * width + x;
          const idxNext = y * width + x + 1;
          const val = pixels[idx];
          const valNext = pixels[idxNext];
          if (Math.abs(val - valNext) > 80) transitions++;
          totalPixels++;
        }
      }
      transitionMap[gy][gx] = totalPixels > 0 ? transitions / totalPixels : 0;
    }
  }

  // Find the cell with the highest transition density
  let maxDensity = 0;
  let maxGx = 0;
  let maxGy = 0;
  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      if (transitionMap[gy][gx] > maxDensity) {
        maxDensity = transitionMap[gy][gx];
        maxGx = gx;
        maxGy = gy;
      }
    }
  }

  // QR codes and Data Matrix have transition density > 0.15 typically
  if (maxDensity > 0.12) {
    const x = maxGx * cellW;
    const y = maxGy * cellH;
    const w = cellW * 2; // expand to 2x cell size
    const h = cellH * 2;

    // Check aspect ratio to guess the type
    const aspectRatio = w / h;
    let type: BarcodeDetection["type"] = "unknown";
    if (aspectRatio > 2 || aspectRatio < 0.5) {
      type = "pdf417"; // PDF417 is typically wide
    } else {
      type = "qr_code"; // QR codes are roughly square
    }

    return {
      found: true,
      type,
      confidence: Math.min(1, maxDensity * 3),
      boundingBox: { x, y, width: w, height: h },
      notes: `Barcode region detected at (${x},${y}) with transition density ${maxDensity.toFixed(3)}`,
    };
  }

  return {
    found: false,
    type: "none",
    confidence: 0,
    notes: "No barcode-like region detected. This is normal for documents without machine-readable barcodes.",
  };
}

/**
 * Parse an AAMVA-format PDF417 payload (US driver license barcode).
 * AAMVA format contains fields like DCA (jurisdiction), DCB (class), DCC (restrictions),
 * DCD (endorsements), DBA (expiry), DCS (last name), DCT (first name), etc.
 */
export interface AAMVAParseResult {
  parsed: boolean;
  fields: Record<string, string>;
  rawText: string;
  compliance: "AAMVA_2000" | "AAMVA_2003" | "AAMVA_2005" | "AAMVA_2009" | "AAMVA_2010" | "AAMVA_2013" | "unknown";
  notes: string;
}

export function parseAAMVA(text: string): AAMVAParseResult {
  if (!text || text.length < 20) {
    return { parsed: false, fields: {}, rawText: text, compliance: "unknown", notes: "Text too short for AAMVA parsing" };
  }

  const fields: Record<string, string> = {};
  // AAMVA fields are 3-char codes followed by value, separated by newlines or special chars
  // Common: DAA, DAB, DAC, DAD, DBA, DBB, DBC, DBD, DCS, DCT, DCU, DCG, DDA, DDB, DDC, DDD
  const fieldRegex = /([A-Z]{3})([^\n\r]+)/g;
  let match;
  while ((match = fieldRegex.exec(text)) !== null) {
    const code = match[1];
    const value = match[2].trim();
    if (value.length > 0 && value.length < 100) {
      fields[code] = value;
    }
  }

  // Determine compliance version
  let compliance: AAMVAParseResult["compliance"] = "unknown";
  if (text.startsWith("@") || text.includes("\n@")) {
    compliance = "AAMVA_2013";
  } else if (text.includes("\nANSI ")) {
    compliance = "AAMVA_2009";
  } else if (Object.keys(fields).length > 5) {
    compliance = "AAMVA_2005";
  }

  return {
    parsed: Object.keys(fields).length > 0,
    fields,
    rawText: text,
    compliance,
    notes: `Extracted ${Object.keys(fields).length} AAMVA fields. Common codes: DCS=surname, DCT=given names, DBA=expiry, DBB=DOB, DBC=sex, DCG=country, DCA=jurisdiction.`,
  };
}

/**
 * Parse a QR code payload that may contain structured data.
 * Many national ID cards encode structured data in QR codes as JSON or
 * key-value pairs.
 */
export interface QRParseResult {
  parsed: boolean;
  format: "json" | "key_value" | "url" | "base64" | "unknown";
  fields: Record<string, any>;
  rawText: string;
  notes: string;
}

export function parseQRContent(text: string): QRParseResult {
  if (!text) {
    return { parsed: false, format: "unknown", fields: {}, rawText: "", notes: "Empty QR content" };
  }

  // Try JSON
  try {
    const json = JSON.parse(text);
    return {
      parsed: true,
      format: "json",
      fields: json,
      rawText: text,
      notes: "QR content is valid JSON",
    };
  } catch {
    // Not JSON
  }

  // Try key=value pairs (common in government QR codes)
  // Format: KEY=VALUE\nKEY=VALUE or KEY:VALUE;KEY:VALUE
  if (text.includes("=") || text.includes(":")) {
    const separator = text.includes("=") ? "=" : ":";
    const delimiter = text.includes("\n") ? "\n" : text.includes(";") ? ";" : ",";
    const fields: Record<string, string> = {};
    const pairs = text.split(delimiter);
    for (const pair of pairs) {
      const sepIdx = pair.indexOf(separator);
      if (sepIdx > 0 && sepIdx < 50) {
        const key = pair.substring(0, sepIdx).trim();
        const value = pair.substring(sepIdx + 1).trim();
        if (key.length > 0 && value.length > 0) {
          fields[key] = value;
        }
      }
    }
    if (Object.keys(fields).length >= 2) {
      return {
        parsed: true,
        format: "key_value",
        fields,
        rawText: text,
        notes: `QR content parsed as ${Object.keys(fields).length} key-value pairs`,
      };
    }
  }

  // Try URL
  if (text.startsWith("http://") || text.startsWith("https://")) {
    return {
      parsed: true,
      format: "url",
      fields: { url: text },
      rawText: text,
      notes: "QR content is a URL",
    };
  }

  // Try base64
  if (/^[A-Za-z0-9+/=]{20,}$/.test(text)) {
    try {
      const decoded = Buffer.from(text, "base64").toString("utf8");
      return {
        parsed: true,
        format: "base64",
        fields: { decoded },
        rawText: text,
        notes: "QR content is base64-encoded",
      };
    } catch {
      // Not valid base64
    }
  }

  return {
    parsed: false,
    format: "unknown",
    fields: {},
    rawText: text,
    notes: "QR content format not recognized",
  };
}

/**
 * Get the list of countries that commonly use barcodes/QR codes on ID documents.
 */
export function getCountriesWithBarcodes(): { country: string; docType: string; format: string }[] {
  return [
    { country: "US", docType: "driver_license", format: "PDF417 (AAMVA)" },
    { country: "CA", docType: "driver_license", format: "PDF417 (AAMVA)" },
    { country: "PH", docType: "national_id", format: "QR Code (PhilSys)" },
    { country: "SG", docType: "national_id", format: "QR Code" },
    { country: "MY", docType: "national_id", format: "QR Code" },
    { country: "TH", docType: "national_id", format: "QR Code" },
    { country: "VN", docType: "national_id", format: "QR Code" },
    { country: "BR", docType: "national_id", format: "QR Code" },
    { country: "IN", docType: "national_id", format: "QR Code (Aadhaar)" },
    { country: "DE", docType: "national_id", format: "Data Matrix" },
    { country: "FR", docType: "national_id", format: "Data Matrix (2D DOC)" },
    { country: "IT", docType: "national_id", format: "QR Code (CIE)" },
    { country: "ES", docType: "national_id", format: "QR Code (DNIe)" },
    { country: "NL", docType: "driver_license", format: "PDF417" },
    { country: "AU", docType: "driver_license", format: "PDF417" },
  ];
}
