"use client";

import { useState } from "react";
import { History, Home as HomeIcon, FlaskConical, Database, Globe, Gauge, Radio } from "lucide-react";
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
import { SpecsBrowser } from "@/components/verify/specs-browser";
import { InfraDashboard } from "@/components/verify/infra-dashboard";
import { RealtimeDashboard } from "@/components/verify/realtime-dashboard";
import { ApiDocsModal } from "@/components/verify/api-docs-modal";
import { CirkleLogo } from "@/components/brand/cirkle-logo";
import { ChatWidget } from "@/components/chatbot/chat-widget";
import { LocaleToggle } from "@/components/i18n/locale-toggle";
import { useI18n } from "@/components/i18n/use-i18n";
import { InstallPrompt } from "@/components/pwa/install-prompt";

type View = "wizard" | "history" | "eval" | "training" | "specs" | "infra" | "live";

export default function Home() {
  const step = useVerificationStore((s) => s.step);
  const setStep = useVerificationStore((s) => s.setStep);
  const reset = useVerificationStore((s) => s.reset);
  const [view, setView] = useState<View>("wizard");
  const { t } = useI18n();

  return (
    <div className="min-h-screen flex flex-col bg-gradient-aurora">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border glass shadow-soft">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3">
          <button
            onClick={() => {
              setView("wizard");
              setStep("intro");
              reset();
            }}
            className="group"
            aria-label="Cirkle home"
          >
            <CirkleLogo size={36} animated showWordmark />
          </button>

          <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end">
            <NavButton active={view === "wizard"} onClick={() => setView("wizard")} icon={HomeIcon} label={t("nav.verify")} />
            <NavButton active={view === "history"} onClick={() => setView("history")} icon={History} label={t("nav.history")} />
            <NavButton active={view === "training"} onClick={() => setView("training")} icon={Database} label={t("nav.training")} />
            <NavButton active={view === "specs"} onClick={() => setView("specs")} icon={Globe} label={t("nav.specs")} />
            <NavButton active={view === "infra"} onClick={() => setView("infra")} icon={Gauge} label={t("nav.infra")} />
            <NavButton active={view === "live"} onClick={() => setView("live")} icon={Radio} label="Live" />
            <NavButton active={view === "eval"} onClick={() => setView("eval")} icon={FlaskConical} label={t("nav.lab")} />
            <ApiDocsModal />
            <LocaleToggle />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
        {view === "history" ? (
          <HistoryView onBack={() => setView("wizard")} />
        ) : view === "training" ? (
          <TrainingData onBack={() => setView("wizard")} />
        ) : view === "specs" ? (
          <SpecsBrowser onBack={() => setView("wizard")} />
        ) : view === "infra" ? (
          <InfraDashboard onBack={() => setView("wizard")} />
        ) : view === "live" ? (
          <RealtimeDashboard onBack={() => setView("wizard")} />
        ) : view === "eval" ? (
          <EvaluationLab onBack={() => setView("wizard")} />
        ) : (
          <div className="space-y-6">
            {step !== "intro" && (
              <Card className="border-border">
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
      <footer className="mt-auto border-t border-border glass shadow-soft">
        <div className="mx-auto max-w-6xl px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <CirkleLogo size={18} animated={false} />
            <span>{t("footer.tagline")}</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline font-arabic" dir="rtl" lang="ar">دواير للتحقق من الهوية</span>
          </div>
          <div className="flex items-center gap-3">
            <span>{t("footer.zeroCost")}</span>
            <span className="hidden md:inline">·</span>
            <span className="hidden md:inline">{t("footer.egyptianId")}</span>
          </div>
        </div>
      </footer>

      {/* Floating chatbot assistant — RAG-powered, answers KYC / MRZ / liveness questions */}
      <ChatWidget />

      {/* PWA install prompt — only visible when the browser fires beforeinstallprompt */}
      <InstallPrompt />
    </div>
  );
}

function NavButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
    >
      <Icon className="h-4 w-4 mr-1" /> <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
