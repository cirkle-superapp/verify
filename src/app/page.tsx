"use client";

import { useState } from "react";
import { ShieldCheck, History, Home as HomeIcon, FlaskConical, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useVerificationStore } from "@/lib/verification-store";
import { StepIndicator } from "@/components/verify/step-indicator";
import { IntroStep } from "@/components/verify/steps/intro-step";
import { DocTypeStep } from "@/components/verify/steps/doc-type-step";
import { DocCaptureStep } from "@/components/verify/steps/doc-capture-step";
import { DocReviewStep } from "@/components/verify/steps/doc-review-step";
import { SelfieStep } from "@/components/verify/steps/selfie-step";
import { LivenessStep } from "@/components/verify/steps/liveness-step";
import { ResultStep } from "@/components/verify/steps/result-step";
import { HistoryView } from "@/components/verify/history-view";
import { EvaluationLab } from "@/components/verify/evaluation-lab";
import { TrainingData } from "@/components/verify/training-data";

type View = "wizard" | "history" | "eval" | "training";

export default function Home() {
  const step = useVerificationStore((s) => s.step);
  const setStep = useVerificationStore((s) => s.setStep);
  const reset = useVerificationStore((s) => s.reset);
  const [view, setView] = useState<View>("wizard");

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-emerald-50/40 via-background to-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3">
          <button
            onClick={() => {
              setView("wizard");
              setStep("intro");
              reset();
            }}
            className="flex items-center gap-2.5 group"
          >
            <div className="rounded-xl bg-emerald-600 p-1.5 text-white shadow-sm group-hover:shadow-md transition">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="text-left">
              <div className="font-bold text-sm sm:text-base leading-tight">Identity Verify</div>
              <div className="text-[11px] text-muted-foreground leading-tight" dir="rtl" lang="ar">
                التحقق من الهوية
              </div>
            </div>
          </button>

          <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end">
            <NavButton active={view === "wizard"} onClick={() => setView("wizard")} icon={HomeIcon} label="Verify" />
            <NavButton active={view === "history"} onClick={() => setView("history")} icon={History} label="History" />
            <NavButton active={view === "training"} onClick={() => setView("training")} icon={Database} label="Training" />
            <NavButton active={view === "eval"} onClick={() => setView("eval")} icon={FlaskConical} label="Lab" />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
        {view === "history" ? (
          <HistoryView onBack={() => setView("wizard")} />
        ) : view === "training" ? (
          <TrainingData onBack={() => setView("wizard")} />
        ) : view === "eval" ? (
          <EvaluationLab onBack={() => setView("wizard")} />
        ) : (
          <div className="space-y-6">
            {step !== "intro" && (
              <Card className="border-emerald-100">
                <CardContent className="p-3">
                  <StepIndicator current={step} onJump={setStep} />
                </CardContent>
              </Card>
            )}

            <div className="animate-in fade-in-50 duration-300">
              {step === "intro" && <IntroStep />}
              {step === "doc_type" && <DocTypeStep />}
              {step === "doc_capture" && <DocCaptureStep />}
              {step === "doc_review" && <DocReviewStep />}
              {step === "selfie" && <SelfieStep />}
              {step === "liveness" && <LivenessStep />}
              {step === "result" && <ResultStep onViewHistory={() => setView("history")} />}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>AI-powered live identity verification</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline font-arabic" dir="rtl" lang="ar">تحقق هوية حي بالذكاء الاصطناعي</span>
          </div>
          <div className="flex items-center gap-3">
            <span>Documents: Egyptian ID · Passport · License</span>
            <span className="hidden md:inline">·</span>
            <span className="hidden md:inline">Live face + movement liveness</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function NavButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <Button variant={active ? "default" : "outline"} size="sm" onClick={onClick} className={active ? "bg-emerald-600 hover:bg-emerald-700" : ""}>
      <Icon className="h-4 w-4 mr-1" /> <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
