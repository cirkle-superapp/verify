"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ScanFace, FileText, Hand, ArrowRight, Sparkles, Zap, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useVerificationStore } from "@/lib/verification-store";
import { CirkleHeroLogo } from "@/components/brand/cirkle-logo";

const FEATURES = [
  {
    icon: FileText,
    title: "Arabic Document Reading",
    titleAr: "قراءة المستندات العربية",
    desc: "3-pass OCR reads Arabic & English from Egyptian ID, passport, driver license, residence card. Validates national ID checksum + MRZ.",
  },
  {
    icon: ScanFace,
    title: "Live Face Capture",
    titleAr: "التقاط الوجه الحي",
    desc: "Captures a high-quality selfie and matches it to the document photo using VLM face comparison.",
  },
  {
    icon: Hand,
    title: "Live Movement Check",
    titleAr: "فحص الحركة الحية",
    desc: "Random head movements (turn left/right, look up, blink, smile) prove you are real — anti-spoofing.",
  },
  {
    icon: ShieldCheck,
    title: "Verified Record",
    titleAr: "سجل موثق",
    desc: "Each verification is stored with per-field confidence scores you can review and audit later.",
  },
];

export function IntroStep() {
  const goNext = useVerificationStore((s) => s.goNext);
  const [providerCount, setProviderCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/verify/consensus-status")
      .then((r) => r.json())
      .then((j) => setProviderCount(j.totalProviders ?? 0))
      .catch(() => setProviderCount(0));
  }, []);

  const consensusLabel = providerCount === null
    ? "AI providers consensus"
    : providerCount === 0
      ? "Self-hosted AI consensus ready"
      : `${providerCount} AI providers consensus`;

  return (
    <div className="space-y-8">
      {/* Hero with animated logo */}
      <div className="text-center space-y-5">
        <div className="flex justify-center">
          <CirkleHeroLogo size={96} />
        </div>
        <div className="space-y-2">
          <Badge variant="outline" className="bg-muted text-primary border-border">
            <Sparkles className="h-3 w-3 mr-1" /> Zero-cost · Self-hosted KYC
          </Badge>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Cirkle Identity Verification
            <span className="block text-primary text-2xl sm:text-3xl mt-1 font-arabic" dir="rtl" lang="ar">
              دواير للتحقق من الهوية
            </span>
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Read Egyptian and Arabic identity documents, capture a live selfie, and prove
            you&apos;re real with random movement challenges — all powered by on-device AI vision.
            No per-check billing, no third-party API calls to KYC vendors.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2 text-xs">
          <Badge variant="secondary" className="gap-1"><Users className="h-3 w-3" /> {consensusLabel}</Badge>
          <Badge variant="secondary" className="gap-1"><Zap className="h-3 w-3" /> 3-pass Arabic OCR</Badge>
          <Badge variant="secondary" className="gap-1"><ScanFace className="h-3 w-3" /> VLM face match</Badge>
          <Badge variant="secondary" className="gap-1"><Hand className="h-3 w-3" /> Liveness anti-spoof</Badge>
          <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" /> ID checksum validation</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FEATURES.map((f) => (
          <Card key={f.title} className="overflow-hidden hover:shadow-md transition border-border">
            <CardContent className="p-5 flex items-start gap-4">
              <div className="rounded-xl bg-muted p-3 text-primary shrink-0">
                <f.icon className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="font-semibold">{f.title}</h3>
                  <span className="text-sm text-primary font-arabic" dir="rtl" lang="ar">{f.titleAr}</span>
                </div>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-center">
        <Button size="lg" onClick={goNext} className="px-8 bg-primary hover:bg-primary/90">
          Start Verification <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground max-w-xl mx-auto">
        Zero-cost: runs entirely on free open-source tooling + the included Z.ai VLM.
        Your images are processed securely and stored only in the local demo database.
      </p>
    </div>
  );
}
