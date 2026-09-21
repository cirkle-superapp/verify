"use client";

/**
 * Document Template Overlay — visual layout comparison UI.
 *
 * Two components live in this file:
 *
 *   1. `TemplateOverlay` — renders the user's uploaded document image
 *      with semi-transparent rectangles overlaid on top, color-coded
 *      by match state:
 *        - green  → expected template field position (reference)
 *        - yellow → detected field that roughly matches the expected
 *                   position (IoU >= 0.30 or center distance < 0.10)
 *        - red    → detected field that does NOT match (wrong place)
 *      Plus a legend, a match score (0-100%), and field-by-field
 *      breakdown.
 *
 *   2. `TemplateComparison` — side-by-side view: the uploaded image
 *      on the left, an SVG "reference template" diagram on the right
 *      (drawn from the template's field positions), and a list of
 *      matched / mismatched fields below. Includes a "Print" button
 *      so the user can keep a paper copy of the comparison.
 *
 * Both components are responsive (work on mobile and desktop). The
 * uploaded image is the base layer; overlays use absolute positioning
 * with percentage-based coordinates (matching the 0-1 relative
 * coordinate convention used by `DocumentTemplate`).
 */

import { useMemo, useCallback } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Printer,
  LayoutTemplate,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type DocumentTemplate,
  type DetectedField,
  type BoundingBox,
  matchDocumentToTemplate,
  computeIoU,
  computeCenterDistance,
} from "@/lib/document-templates";

// ─── Shared helpers ─────────────────────────────────────────────────

/**
 * Comparison verdict for a single detected field vs the closest
 * expected template field. Drives the overlay color and the row in
 * the field table.
 */
interface FieldVerdict {
  /** Detected field name (as supplied by the caller). */
  detectedName: string;
  /** Closest expected template field name (or "—" if none). */
  expectedName: string | null;
  /** IoU between detected and expected positions. */
  iou: number;
  /** Center distance between detected and expected positions. */
  centerDistance: number;
  /** "match" | "mismatch" | "no-expected" */
  status: "match" | "mismatch" | "no-expected";
}

/**
 * Compute per-detected-field verdicts against the closest expected
 * template field. A detected field is a "match" if it has an expected
 * counterpart AND (IoU >= 0.30 OR center distance < 0.10). Otherwise
 * it's a "mismatch" (or "no-expected" if there's no counterpart).
 */
function computeFieldVerdicts(
  detectedFields: DetectedField[] | undefined,
  template: DocumentTemplate,
): FieldVerdict[] {
  if (!detectedFields || detectedFields.length === 0) return [];

  return detectedFields.map((df) => {
    // Find the closest expected field by name match (loose: contains).
    // If multiple match, take the one with the highest IoU.
    let best = {
      expectedName: null as string | null,
      iou: 0,
      centerDistance: 1,
    };

    for (const expected of template.fields) {
      const dLower = df.name.toLowerCase();
      const eLower = expected.name.toLowerCase();
      const nameMatches =
        dLower === eLower ||
        dLower.includes(eLower) ||
        eLower.includes(dLower);
      if (!nameMatches) continue;

      const iou = computeIoU(df.position, expected.position);
      const dist = computeCenterDistance(df.position, expected.position);
      if (iou > best.iou || best.expectedName === null) {
        best = {
          expectedName: expected.name,
          iou,
          centerDistance: dist,
        };
      }
    }

    if (!best.expectedName) {
      return {
        detectedName: df.name,
        expectedName: null,
        iou: 0,
        centerDistance: 1,
        status: "no-expected",
      };
    }

    const isMatch = best.iou >= 0.30 || best.centerDistance < 0.10;
    return {
      detectedName: df.name,
      expectedName: best.expectedName,
      iou: best.iou,
      centerDistance: best.centerDistance,
      status: isMatch ? "match" : "mismatch",
    } satisfies FieldVerdict;
  });
}

/**
 * Compute the overall match score (0-100). Uses the existing
 * `matchDocumentToTemplate` algorithm if detected fields are present;
 * otherwise returns 0 (no detections to score yet).
 */
function computeOverallScore(
  detectedFields: DetectedField[] | undefined,
  template: DocumentTemplate,
): number {
  if (!detectedFields || detectedFields.length === 0) return 0;
  // matchDocumentToTemplate expects imageWidth/Height for the
  // diagnostic explanation; we pass 0 since we only care about the
  // score (which is computed in relative coordinates).
  const result = matchDocumentToTemplate(0, 0, detectedFields, template);
  return Math.round(result.matchScore * 100);
}

/** Return the color (hex) for a given verdict status. */
function statusColor(status: FieldVerdict["status"]): string {
  switch (status) {
    case "match":
      return "#16a34a"; // green-600
    case "mismatch":
      return "#dc2626"; // red-600
    case "no-expected":
      return "#dc2626"; // red-600 (unexpected field on the document)
  }
}

/** Inline style helper for an absolute-positioned overlay rect. */
function positionStyle(pos: BoundingBox): React.CSSProperties {
  return {
    position: "absolute",
    left: `${(pos.x * 100).toFixed(2)}%`,
    top: `${(pos.y * 100).toFixed(2)}%`,
    width: `${(pos.w * 100).toFixed(2)}%`,
    height: `${(pos.h * 100).toFixed(2)}%`,
  };
}

// ─── TemplateOverlay ───────────────────────────────────────────────

export interface TemplateOverlayProps {
  /** Base-layer image as a data: URL (or any img src). */
  imageDataUrl: string;
  /** Reference template — defines expected field positions. */
  template: DocumentTemplate;
  /** Optional detected fields with bounding boxes (0-1 relative). */
  detectedFields?: DetectedField[];
  /** Show the legend + match score (default true). */
  showLegend?: boolean;
  /** Show the per-field table (default true). */
  showFieldTable?: boolean;
  /** Override the title in the card header. */
  title?: string;
}

/**
 * Render the uploaded document image with semi-transparent overlay
 * rectangles for each template field position (green) and each
 * detected field (yellow = match, red = mismatch). Includes a legend,
 * a 0-100% match score, and a per-field breakdown table.
 */
export function TemplateOverlay({
  imageDataUrl,
  template,
  detectedFields,
  showLegend = true,
  showFieldTable = true,
  title,
}: TemplateOverlayProps) {
  const verdicts = useMemo(
    () => computeFieldVerdicts(detectedFields, template),
    [detectedFields, template],
  );
  const score = useMemo(
    () => computeOverallScore(detectedFields, template),
    [detectedFields, template],
  );

  const scoreBadgeClass =
    score >= 70
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : score >= 40
        ? "bg-amber-100 text-amber-700 border-amber-200"
        : "bg-rose-100 text-rose-700 border-rose-200";

  const scoreLabel =
    score >= 70 ? "Strong match" : score >= 40 ? "Partial match" : "Weak match";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <LayoutTemplate className="h-4 w-4 text-teal-600" />
          {title ||
            `Template overlay — ${template.country} ${template.docType.replace(/_/g, " ")}`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Image + overlays */}
        <div
          className="relative w-full overflow-hidden rounded-lg border bg-muted/30"
          style={{ aspectRatio: "1.585" }}
        >
          <img
            src={imageDataUrl}
            alt={`Uploaded ${template.docType} for ${template.country}`}
            className="absolute inset-0 h-full w-full object-contain"
          />

          {/* Green: expected template field positions */}
          {template.fields.map((field, i) => (
            <div
              key={`exp-${i}-${field.name}`}
              title={`Expected: ${field.name}`}
              style={{
                ...positionStyle(field.position),
                border: "2px solid #16a34a",
                backgroundColor: "rgba(22, 163, 74, 0.15)",
              }}
              className="pointer-events-none"
            >
              <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {field.name}
              </span>
            </div>
          ))}

          {/* Detected fields: yellow (match) / red (mismatch / no-expected) */}
          {detectedFields?.map((field, i) => {
            const verdict = verdicts[i];
            if (!verdict) return null;
            const color = statusColor(verdict.status);
            return (
              <div
                key={`det-${i}-${field.name}`}
                title={`Detected: ${field.name} → ${verdict.status}`}
                style={{
                  ...positionStyle(field.position),
                  border: `2px dashed ${color}`,
                  backgroundColor: `${color}25`,
                }}
                className="pointer-events-none"
              >
                <span
                  className="absolute -bottom-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                  style={{ backgroundColor: color }}
                >
                  {field.name}
                </span>
              </div>
            );
          })}
        </div>

        {/* Legend + score */}
        {showLegend && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-sm border-2"
                  style={{
                    borderColor: "#16a34a",
                    backgroundColor: "rgba(22, 163, 74, 0.15)",
                  }}
                />
                <span className="text-muted-foreground">Expected position</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-sm border-2 border-dashed"
                  style={{
                    borderColor: "#16a34a",
                    backgroundColor: "rgba(22, 163, 74, 0.15)",
                  }}
                />
                <span className="text-muted-foreground">Detected — match</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-sm border-2 border-dashed"
                  style={{
                    borderColor: "#dc2626",
                    backgroundColor: "rgba(220, 38, 38, 0.15)",
                  }}
                />
                <span className="text-muted-foreground">Detected — mismatch</span>
              </span>
            </div>
            <Badge
              variant="outline"
              className={`text-xs font-mono ${scoreBadgeClass}`}
            >
              Match: {score}% · {scoreLabel}
            </Badge>
          </div>
        )}

        {/* Score progress bar */}
        <div className="space-y-1">
          <Progress value={score} className="h-2" />
          <p className="text-[11px] text-muted-foreground">
            Score is computed in relative (0-1) coordinates — resolution-independent.
            Threshold for a positional match: IoU ≥ 0.30 or center distance &lt; 0.10.
          </p>
        </div>

        {/* Per-field breakdown */}
        {showFieldTable && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Detected field</TableHead>
                <TableHead>Expected field</TableHead>
                <TableHead>IoU</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {verdicts.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-xs text-muted-foreground"
                  >
                    No detected fields supplied — only expected template
                    positions are shown (green overlays).
                  </TableCell>
                </TableRow>
              ) : (
                verdicts.map((v, i) => (
                  <TableRow key={`row-${i}-${v.detectedName}`}>
                    <TableCell className="font-medium">
                      {v.detectedName}
                    </TableCell>
                    <TableCell>{v.expectedName || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {v.expectedName ? v.iou.toFixed(2) : "—"}
                    </TableCell>
                    <TableCell>
                      {v.status === "match" && (
                        <span className="flex items-center gap-1 text-xs text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Match
                        </span>
                      )}
                      {v.status === "mismatch" && (
                        <span className="flex items-center gap-1 text-xs text-rose-700">
                          <XCircle className="h-3.5 w-3.5" /> Mismatch
                        </span>
                      )}
                      {v.status === "no-expected" && (
                        <span className="flex items-center gap-1 text-xs text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5" /> Unexpected
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── TemplateComparison ───────────────────────────────────────────

export interface TemplateComparisonProps {
  /** Base-layer image as a data: URL (or any img src). */
  imageDataUrl: string;
  /** Reference template to render as an SVG diagram. */
  template: DocumentTemplate;
  /** Optional detected fields (drives match/mismatch list). */
  detectedFields?: DetectedField[];
}

/**
 * Side-by-side comparison view of the uploaded image and a reference
 * template diagram (rendered as an SVG). Below the images, lists the
 * matched and mismatched fields. Includes a "Print" button so the
 * user can keep a paper record of the comparison.
 */
export function TemplateComparison({
  imageDataUrl,
  template,
  detectedFields,
}: TemplateComparisonProps) {
  const verdicts = useMemo(
    () => computeFieldVerdicts(detectedFields, template),
    [detectedFields, template],
  );
  const score = useMemo(
    () => computeOverallScore(detectedFields, template),
    [detectedFields, template],
  );

  const matchedFields = verdicts.filter((v) => v.status === "match");
  const mismatchedFields = verdicts.filter((v) => v.status === "mismatch");
  const unexpectedFields = verdicts.filter((v) => v.status === "no-expected");

  const handlePrint = useCallback(() => {
    if (typeof window !== "undefined") {
      window.print();
    }
  }, []);

  // The SVG reference diagram: a card outline with field rects labeled.
  // We render in viewBox coordinates 0..100 × 0..63 (aspect ~1.585) so
  // the SVG scales responsively.
  const VB_W = 100;
  const VB_H = Math.round(100 / 1.585); // ≈ 63

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4 text-teal-600" />
            Comparison — {template.country} {template.docType.replace(/_/g, " ")}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="print:hidden"
          >
            <Printer className="h-4 w-4 mr-1" />
            Print
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Uploaded image */}
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Uploaded document
            </div>
            <div
              className="relative w-full overflow-hidden rounded-lg border bg-muted/30"
              style={{ aspectRatio: "1.585" }}
            >
              <img
                src={imageDataUrl}
                alt="Uploaded document"
                className="absolute inset-0 h-full w-full object-contain"
              />
            </div>
          </div>

          {/* SVG reference template */}
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Reference template diagram
            </div>
            <svg
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              className="w-full rounded-lg border bg-muted/30"
              style={{ aspectRatio: "1.585" }}
              role="img"
              aria-label={`Reference template diagram for ${template.country} ${template.docType}`}
            >
              {/* Card outline */}
              <rect
                x={0}
                y={0}
                width={VB_W}
                height={VB_H}
                rx={2}
                ry={2}
                fill={template.colors.background}
                stroke={template.colors.accent}
                strokeWidth={0.6}
              />
              {/* Photo position (if defined) */}
              {template.layout.photoPosition && (
                <rect
                  x={template.layout.photoPosition.x * VB_W}
                  y={template.layout.photoPosition.y * VB_H}
                  width={template.layout.photoPosition.w * VB_W}
                  height={template.layout.photoPosition.h * VB_H}
                  fill="rgba(255,255,255,0.25)"
                  stroke={template.colors.accent}
                  strokeWidth={0.4}
                  strokeDasharray="1,1"
                />
              )}
              {/* Field positions */}
              {template.fields.map((f, i) => {
                const x = f.position.x * VB_W;
                const y = f.position.y * VB_H;
                const w = f.position.w * VB_W;
                const h = f.position.h * VB_H;
                return (
                  <g key={`tpl-${i}-${f.name}`}>
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      fill="rgba(22, 163, 74, 0.20)"
                      stroke="#16a34a"
                      strokeWidth={0.4}
                    />
                    {w > 14 && h > 3 && (
                      <text
                        x={x + w / 2}
                        y={y + h / 2 + 0.5}
                        fontSize={1.6}
                        textAnchor="middle"
                        fill="#0f172a"
                        fontFamily="monospace"
                      >
                        {f.name.length > 14
                          ? f.name.slice(0, 12) + "…"
                          : f.name}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* MRZ position (if defined) */}
              {template.layout.mrzPosition && (
                <rect
                  x={template.layout.mrzPosition.x * VB_W}
                  y={template.layout.mrzPosition.y * VB_H}
                  width={template.layout.mrzPosition.w * VB_W}
                  height={template.layout.mrzPosition.h * VB_H}
                  fill="rgba(0,0,0,0.05)"
                  stroke={template.colors.text}
                  strokeWidth={0.3}
                />
              )}
            </svg>
            <p className="text-[11px] text-muted-foreground">
              {template.notes}
            </p>
          </div>
        </div>

        {/* Match score */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Overall match</span>
            <Badge variant="outline" className="text-xs font-mono">
              {score}%
            </Badge>
          </div>
          <Progress value={score} className="h-2" />
        </div>

        {/* Matched / mismatched lists */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Matched ({matchedFields.length})
            </div>
            <ul className="mt-1 space-y-0.5 text-xs">
              {matchedFields.length === 0 ? (
                <li className="text-muted-foreground">—</li>
              ) : (
                matchedFields.map((v, i) => (
                  <li key={i} className="font-mono">
                    {v.detectedName} → {v.expectedName}
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="rounded-md border border-rose-200 bg-rose-50/50 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-rose-700">
              <XCircle className="h-3.5 w-3.5" />
              Mismatched ({mismatchedFields.length})
            </div>
            <ul className="mt-1 space-y-0.5 text-xs">
              {mismatchedFields.length === 0 ? (
                <li className="text-muted-foreground">—</li>
              ) : (
                mismatchedFields.map((v, i) => (
                  <li key={i} className="font-mono">
                    {v.detectedName} ≠ {v.expectedName}
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              Unexpected ({unexpectedFields.length})
            </div>
            <ul className="mt-1 space-y-0.5 text-xs">
              {unexpectedFields.length === 0 ? (
                <li className="text-muted-foreground">—</li>
              ) : (
                unexpectedFields.map((v, i) => (
                  <li key={i} className="font-mono">
                    {v.detectedName} (not in template)
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Convenience exports ───────────────────────────────────────────

export type { DocumentTemplate, DetectedField, BoundingBox } from "@/lib/document-templates";
