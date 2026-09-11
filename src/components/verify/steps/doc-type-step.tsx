"use client";

import { CreditCard, Plane, Car, IdCard, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useVerificationStore } from "@/lib/verification-store";
import { DOC_TYPES, type DocType } from "@/lib/verification-types";

const ICONS: Record<DocType, any> = {
  national_id: IdCard,
  passport: Plane,
  driver_license: Car,
  residence: CreditCard,
};

export function DocTypeStep() {
  const docType = useVerificationStore((s) => s.docType);
  const setDocType = useVerificationStore((s) => s.setDocType);
  const goNext = useVerificationStore((s) => s.goNext);

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Select document type</h2>
        <p className="text-muted-foreground" dir="rtl" lang="ar">اختر نوع المستند</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {DOC_TYPES.map((d) => {
          const Icon = ICONS[d.id];
          const selected = docType === d.id;
          return (
            <Card
              key={d.id}
              role="button"
              tabIndex={0}
              onClick={() => setDocType(d.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDocType(d.id);
                }
              }}
              className={cn(
                "cursor-pointer transition-all hover:border-teal-400 hover:shadow-md",
                selected && "border-teal-500 ring-2 ring-teal-500/30"
              )}
            >
              <CardContent className="p-5 flex items-start gap-4">
                <div
                  className={cn(
                    "rounded-xl p-3 shrink-0 transition",
                    selected ? "bg-teal-600 text-white" : "bg-teal-50 text-teal-600"
                  )}
                >
                  <Icon className="h-7 w-7" />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{d.label}</h3>
                    {selected && <Check className="h-5 w-5 text-teal-600" />}
                  </div>
                  <div className="text-sm text-teal-700 font-arabic" dir="rtl" lang="ar">{d.labelAr}</div>
                  <p className="text-xs text-muted-foreground">{d.description}</p>
                  <div className="text-[11px] text-muted-foreground pt-1">
                    {d.needsBack ? "Requires front & back" : "Single side"}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button size="lg" onClick={goNext}>
          Continue <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
