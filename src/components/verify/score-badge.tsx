"use client";

import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";

interface ScoreBadgeProps {
  score: number; // 0-100
  label?: string;
  className?: string;
  /** threshold above which we treat as pass (default 70) */
  threshold?: number;
}

export function ScoreBadge({ score, label, className, threshold = 70 }: ScoreBadgeProps) {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  const pass = pct >= threshold;
  const warn = pct >= threshold - 20 && !pass;
  const color = pass
    ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : warn
    ? "text-amber-700 bg-amber-50 border-amber-200"
    : "text-rose-700 bg-rose-50 border-rose-200";
  const Icon = pass ? CheckCircle2 : warn ? AlertCircle : XCircle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        color,
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label ? `${label}: ` : ""}
      {pct}%
    </span>
  );
}

interface StatusBadgeProps {
  status: "pending" | "verified" | "failed" | "rejected" | string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    pending: { label: "Pending", cls: "text-amber-700 bg-amber-50 border-amber-200", Icon: AlertCircle },
    verified: { label: "Verified", cls: "text-emerald-700 bg-emerald-50 border-emerald-200", Icon: CheckCircle2 },
    failed: { label: "Failed", cls: "text-rose-700 bg-rose-50 border-rose-200", Icon: XCircle },
    rejected: { label: "Rejected", cls: "text-rose-700 bg-rose-50 border-rose-200", Icon: XCircle },
  };
  const v = map[status] ?? map.pending;
  const Icon = v.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        v.cls,
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {v.label}
    </span>
  );
}
