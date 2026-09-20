"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Printer, Download, Link as LinkIcon, ShieldCheck } from "lucide-react";
import { useI18n } from "@/components/i18n/use-i18n";
import { toast } from "sonner";

interface VerificationReportModalProps {
  /** Verification record ID (database row id). */
  verificationId: string | null;
  /** Open state. */
  open: boolean;
  /** Called when the user closes the modal. */
  onOpenChange: (open: boolean) => void;
}

interface ReportMeta {
  verification_id: string;
  signature: string;
  algorithm: string;
  keyId: string;
  short: string;
  status: string;
  report_url: string;
}

type VerifyState = "idle" | "verifying" | "valid" | "invalid";

/**
 * Modal that shows the verification report HTML in an iframe.
 * Provides:
 *  - "Print" button → triggers window.print() inside the iframe
 *  - "Download as PDF" button → same (browser shows "Save as PDF" option)
 *  - "Copy verification link" button
 *  - "Verify signature" button → calls /api/v1/verify/report?signature=…
 */
export function VerificationReportModal({
  verificationId,
  open,
  onOpenChange,
}: VerificationReportModalProps) {
  const { t } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const reportUrl = verificationId
    ? `/api/v1/verify/report?verification_id=${encodeURIComponent(verificationId)}`
    : null;

  // Fetch the report metadata (signature, keyId, short) when modal opens.
  useEffect(() => {
    if (!open || !verificationId) {
      setMeta(null);
      setVerifyState("idle");
      return;
    }
    let cancelled = false;
    setLoadingMeta(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/v1/verify/report?verification_id=${encodeURIComponent(
            verificationId,
          )}&format=json`,
        );
        const json = await res.json();
        if (!cancelled) {
          if (res.ok) setMeta(json);
          else toast.error(json.error || "Could not load report");
        }
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message || "Network error");
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, verificationId]);

  // Trigger print inside the iframe.
  const handlePrint = useCallback(() => {
    try {
      const iframe = iframeRef.current;
      if (!iframe) return;
      // Cross-origin: same-origin (same Next.js server) so this works.
      const win = iframe.contentWindow;
      if (!win) return;
      win.focus();
      win.print();
    } catch (e) {
      // Fallback: open the report URL in a new tab and let the user print from there.
      if (reportUrl) window.open(reportUrl, "_blank");
    }
  }, [reportUrl]);

  // Copy verification link (with embedded signature) to clipboard.
  const handleCopyLink = useCallback(async () => {
    if (!reportUrl || !meta) return;
    const link = `${window.location.origin}${reportUrl}&signature=${encodeURIComponent(
      meta.signature,
    )}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("report.copied"));
    } catch {
      // Fallback for older browsers
      const el = document.createElement("textarea");
      el.value = link;
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
        toast.success(t("report.copied"));
      } catch {
        toast.error("Copy failed — please copy manually");
      }
      document.body.removeChild(el);
    }
  }, [reportUrl, meta, t]);

  // Verify the HMAC signature by calling the API with ?signature=…
  const handleVerify = useCallback(async () => {
    if (!verificationId || !meta) return;
    setVerifyState("verifying");
    try {
      const res = await fetch(
        `/api/v1/verify/report?verification_id=${encodeURIComponent(
          verificationId,
        )}&signature=${encodeURIComponent(meta.signature)}`,
      );
      const json = await res.json();
      if (res.ok && json.valid === true) {
        setVerifyState("valid");
        toast.success(t("report.signatureValid"));
      } else {
        setVerifyState("invalid");
        toast.error(t("report.signatureInvalid"));
      }
    } catch (e: any) {
      setVerifyState("invalid");
      toast.error(e?.message || "Verification failed");
    }
  }, [verificationId, meta, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileTextIcon className="h-5 w-5 text-teal-600" />
            {t("report.title")}
          </DialogTitle>
          <DialogDescription>
            {verificationId ? (
              <span className="font-mono text-xs">{verificationId}</span>
            ) : null}
            {" — "}
            <span>{t("report.printHint")}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Signature meta strip */}
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted/50 px-3 py-2 text-xs">
          {loadingMeta ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("common.loading")}
            </span>
          ) : meta ? (
            <>
              <span className="font-mono">
                {t("report.signature")}: <span className="text-teal-700">{meta.short}…</span>
              </span>
              <span className="text-muted-foreground">·</span>
              <span>{meta.algorithm}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono">{t("report.signatureKey")}: {meta.keyId}</span>
              <span className="ml-auto inline-flex items-center gap-1">
                {verifyState === "valid" && (
                  <span className="inline-flex items-center gap-1 text-teal-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {t("report.signatureValid")}
                  </span>
                )}
                {verifyState === "invalid" && (
                  <span className="inline-flex items-center gap-1 text-rose-700">
                    <XCircle className="h-3.5 w-3.5" /> {t("report.signatureInvalid")}
                  </span>
                )}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{t("common.error")}</span>
          )}
        </div>

        {/* Iframe with the rendered report HTML */}
        <div className="flex-1 min-h-0 rounded-md border bg-white">
          {reportUrl ? (
            <iframe
              ref={iframeRef}
              src={reportUrl}
              title="Verification report"
              className="w-full h-full min-h-[400px] rounded-md"
            />
          ) : (
            <div className="p-6 text-center text-muted-foreground text-sm">
              {t("common.loading")}
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-wrap gap-2 sm:justify-between sm:gap-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1.5" /> {t("report.print")}
            </Button>
            <Button size="sm" variant="outline" onClick={handlePrint}>
              <Download className="h-4 w-4 mr-1.5" /> {t("report.downloadPdf")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopyLink}
              disabled={!meta}
            >
              <LinkIcon className="h-4 w-4 mr-1.5" /> {t("report.copyLink")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleVerify}
              disabled={!meta || verifyState === "verifying"}
            >
              {verifyState === "verifying" ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4 mr-1.5" />
              )}
              {t("report.verifySig")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tiny inline file-text icon to avoid an extra lucide import collision with `FileText`. */
function FileTextIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
}
