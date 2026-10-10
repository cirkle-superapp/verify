"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Lock, ChevronRight, Shield, FileCheck, ScanFace, ShieldCheck, Gauge, BadgeCheck, Eye, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const ICONS = { Eye, UserCheck, FileCheck, ScanFace, ShieldCheck, Gauge, BadgeCheck };

interface TierData {
  level: number;
  name: string;
  arabicName: string;
  description: string;
  color: string;
  icon: string;
  requirements: string[];
  unlocks: string[];
}

interface TierResponse {
  current_tier: number;
  tier_name: string;
  arabic_name: string;
  progress: number;
  unlocked_features: string[];
  next_tier: { level: number; name: string; requirements: string[] } | null;
  all_tiers: TierData[];
}

export function TierLadder({ onBack }: { onBack?: () => void }) {
  const [data, setData] = useState<TierResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const userId = "demo-user";

  useEffect(() => {
    fetch(`/api/v1/verify/tier?user_id=${userId}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const upgrade = async (tier: number, reason: string) => {
    setUpgrading(true);
    try {
      const res = await fetch("/api/v1/verify/tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, tier, reason }),
      });
      const d = await res.json();
      if (d.to > d.from) {
        // Refresh data
        const refresh = await fetch(`/api/v1/verify/tier?user_id=${userId}`).then((r) => r.json());
        setData(refresh);
      }
    } finally {
      setUpgrading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-pulse text-muted-foreground">Loading tier system…</div>
      </div>
    );
  }

  if (!data) return null;

  const currentTier = data.current_tier;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Verification Tiers</h2>
          <p className="text-sm text-muted-foreground">Progressive feature unlock — 7 layers of verification</p>
        </div>
        {onBack && <Button variant="ghost" onClick={onBack}>Back</Button>}
      </div>

      {/* Current tier summary */}
      <Card className="border-2" style={{ borderColor: data.all_tiers?.[currentTier]?.color + "55" }}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm text-muted-foreground">Current Tier</div>
              <div className="text-2xl font-bold" style={{ color: data.all_tiers?.[currentTier]?.color }}>
                Tier {currentTier} — {data.tier_name}
              </div>
              <div className="text-sm font-arabic" dir="rtl">{data.arabic_name}</div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold">{data.progress}%</div>
              <div className="text-xs text-muted-foreground">Complete</div>
            </div>
          </div>
          <Progress value={data.progress} className="h-2" />
          <div className="mt-3 text-xs text-muted-foreground">
            {data.unlocked_features.length} features unlocked
          </div>
        </CardContent>
      </Card>

      {/* Tier ladder */}
      <div className="space-y-3">
        {data.all_tiers?.map((tier) => {
          const Icon = ICONS[tier.icon as keyof typeof ICONS] || Shield;
          const isUnlocked = tier.level <= currentTier;
          const isCurrent = tier.level === currentTier;
          const isNext = tier.level === currentTier + 1;
          const Icon2 = isUnlocked ? Check : Lock;

          return (
            <motion.div
              key={tier.level}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: tier.level * 0.08 }}
            >
              <Card
                className={`relative overflow-hidden ${isCurrent ? "border-2" : ""} ${isUnlocked ? "" : "opacity-60"}`}
                style={isCurrent ? { borderColor: tier.color } : {}}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Icon circle */}
                    <div
                      className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center"
                      style={{ background: isUnlocked ? tier.color + "22" : "#6b728022" }}
                    >
                      <Icon className="w-6 h-6" style={{ color: isUnlocked ? tier.color : "#6b7280" }} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-base">Tier {tier.level}</span>
                        <span style={{ color: tier.color }} className="font-semibold">{tier.name}</span>
                        <span className="font-arabic text-sm text-muted-foreground" dir="rtl">{tier.arabicName}</span>
                        {isCurrent && <Badge variant="default">Current</Badge>}
                        {isNext && <Badge variant="outline">Next</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{tier.description}</p>

                      {/* Requirements (only show if not unlocked) */}
                      {!isUnlocked && tier.requirements.length > 0 && (
                        <div className="mt-2">
                          <div className="text-xs font-semibold text-muted-foreground mb-1">Requirements:</div>
                          <ul className="text-xs space-y-0.5">
                            {tier.requirements.map((r, i) => (
                              <li key={i} className="flex items-center gap-1">
                                <ChevronRight className="w-3 h-3" /> {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Unlocked features (only show if unlocked) */}
                      {isUnlocked && tier.unlocks.length > 0 && (
                        <div className="mt-2">
                          <div className="text-xs font-semibold text-muted-foreground mb-1">Unlocks:</div>
                          <div className="flex flex-wrap gap-1">
                            {tier.unlocks.map((u, i) => (
                              <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded">
                                {u}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Upgrade button (only for next tier) */}
                      {isNext && (
                        <Button
                          size="sm"
                          className="mt-3"
                          disabled={upgrading}
                          onClick={() => upgrade(tier.level, `Completed tier ${tier.level} requirements`)}
                          style={{ background: tier.color, borderColor: tier.color }}
                        >
                          {upgrading ? "Upgrading…" : `Upgrade to Tier ${tier.level}`}
                        </Button>
                      )}
                    </div>

                    {/* Status icon */}
                    <div className="flex-shrink-0">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ background: isUnlocked ? tier.color : "#6b728033" }}
                      >
                        <Icon2 className="w-4 h-4 text-white" />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Platform stats */}
      {data.platform_stats && data.platform_stats.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Platform Verification Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2 text-center">
              {data.all_tiers?.map((t) => (
                <div key={t.level}>
                  <div className="text-lg font-bold" style={{ color: t.color }}>
                    {data.platform_stats.byTier[t.level] || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">T{t.level}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-muted-foreground text-center">
              {data.platform_stats.total} total users
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
