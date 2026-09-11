"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEP_ORDER, STEP_LABELS, type StepId } from "@/lib/verification-store";

interface StepIndicatorProps {
  current: StepId;
  onJump?: (s: StepId) => void;
}

export function StepIndicator({ current, onJump }: StepIndicatorProps) {
  const currentIdx = STEP_ORDER.indexOf(current);
  return (
    <div className="w-full overflow-x-auto">
      <ol className="flex items-center gap-1 min-w-max px-1">
        {STEP_ORDER.map((s, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          const reachable = i <= currentIdx;
          const labels = STEP_LABELS[s];
          return (
            <li key={s} className="flex items-center">
              <button
                type="button"
                disabled={!reachable || !onJump}
                onClick={() => reachable && onJump?.(s)}
                className={cn(
                  "flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium transition",
                  active && "bg-primary text-primary-foreground",
                  done && "bg-emerald-50 text-emerald-700 border border-emerald-200",
                  !active && !done && "text-muted-foreground",
                  reachable && onJump ? "cursor-pointer hover:opacity-80" : "cursor-default"
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                    active && "bg-primary-foreground/20",
                    done && "bg-emerald-600 text-white",
                    !active && !done && "bg-muted text-muted-foreground"
                  )}
                >
                  {done ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{labels.en}</span>
                <span className="sm:hidden font-arabic">{labels.ar}</span>
              </button>
              {i < STEP_ORDER.length - 1 && (
                <div
                  className={cn(
                    "mx-0.5 h-px w-4 sm:w-8",
                    done ? "bg-emerald-400" : "bg-border"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
