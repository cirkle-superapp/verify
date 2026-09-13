"use client";

import { CheckCircle2, AlertTriangle, Users, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ConsensusInfo } from "@/lib/verification-types";

interface Props {
  consensus?: ConsensusInfo | null;
  label: string;
  labelAr?: string;
}

/**
 * Renders a "Cross-checked by N AI providers" badge with agreement %.
 * Surfaces the consensus verdict (unanimous / majority / split) to the user.
 */
export function ConsensusBadge({ consensus, label, labelAr }: Props) {
  if (!consensus || consensus.total === 0) {
    return null;
  }

  const agreementPct = Math.round(consensus.agreement * 100);
  const verdictColor =
    consensus.verdict === "unanimous" ? "text-teal-700 bg-teal-50 border-teal-200" :
    consensus.verdict === "majority" ? "text-amber-700 bg-amber-50 border-amber-200" :
    "text-rose-700 bg-rose-50 border-rose-200";

  const VerdictIcon = consensus.verdict === "split" ? AlertTriangle : CheckCircle2;

  const successfulLatencies = consensus.outcomes.filter((o) => o.success && o.latencyMs > 0);
  const avgLatency = successfulLatencies.length > 0
    ? Math.round(successfulLatencies.reduce((sum, o) => sum + o.latencyMs, 0) / successfulLatencies.length)
    : 0;

  return (
    <Card className="border-border">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-teal-600" />
            <div>
              <div className="text-sm font-semibold">{label}</div>
              {labelAr && (
                <div className="text-xs text-muted-foreground font-arabic" dir="rtl" lang="ar">
                  {labelAr}
                </div>
              )}
            </div>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${verdictColor}`}>
            <VerdictIcon className="h-3 w-3" />
            {consensus.verdict}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs">
          <Stat label="Providers" value={`${consensus.successful}/${consensus.total}`} />
          <Stat label="Agreement" value={`${agreementPct}%`} />
          <Stat label="Avg latency" value={avgLatency > 0 ? `${avgLatency}ms` : "—"} />
        </div>

        <div className="space-y-1">
          <Progress
            value={agreementPct}
            className={`h-1.5 ${
              consensus.verdict === "unanimous" ? "[&>div]:bg-teal-500" :
              consensus.verdict === "majority" ? "[&>div]:bg-amber-500" :
              "[&>div]:bg-rose-500"
            }`}
          />
          <div className="flex flex-wrap gap-1.5">
            {consensus.providerNames.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium"
              >
                <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                {p}
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
