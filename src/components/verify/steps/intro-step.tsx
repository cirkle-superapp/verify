"use client";

import { ShieldCheck, ScanFace, FileText, Hand, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useVerificationStore } from "@/lib/verification-store";

const FEATURES = [
  {
    icon: FileText,
    title: "Arabic Document Reading",
    titleAr: "قراءة المستندات العربية",
    desc: "Extracts Arabic & English text from Egyptian ID, passport, driver license, residence card.",
  },
  {
    icon: ScanFace,
    title: "Live Face Capture",
    titleAr: "التقاط الوجه الحي",
    desc: "Captures a high-quality selfie and matches it to the document photo.",
  },
  {
    icon: Hand,
    title: "Live Movement Check",
    titleAr: "فحص الحركة الحية",
    desc: "Random head movements (turn left/right, look up, blink, smile) prove you are real.",
  },
  {
    icon: ShieldCheck,
    title: "Verified Record",
    titleAr: "سجل موثق",
    desc: "Each verification is stored with confidence scores you can review later.",
  },
];

export function IntroStep() {
  const goNext = useVerificationStore((s) => s.goNext);
  return (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
          <Sparkles className="h-3 w-3 mr-1" /> AI-Powered KYC
        </Badge>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Live Identity Verification
          <span className="block text-emerald-600 text-2xl sm:text-3xl mt-1" dir="rtl" lang="ar">
            التحقق من الهوية الحي
          </span>
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Verify Egyptian and Arabic identity documents, capture a live selfie, and prove
          you&apos;re real with random movement challenges — all in your browser, powered by
          on-device AI vision.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FEATURES.map((f) => (
          <Card key={f.title} className="overflow-hidden">
            <CardContent className="p-5 flex items-start gap-4">
              <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600 shrink-0">
                <f.icon className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="font-semibold">{f.title}</h3>
                  <span className="text-sm text-emerald-700 font-arabic" dir="rtl" lang="ar">{f.titleAr}</span>
                </div>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-center">
        <Button size="lg" onClick={goNext} className="px-8">
          Start Verification <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground max-w-xl mx-auto">
        Your images are processed securely and only stored locally in this demo database to
        display your verification history. Nothing is sent to third parties.
      </p>
    </div>
  );
}
