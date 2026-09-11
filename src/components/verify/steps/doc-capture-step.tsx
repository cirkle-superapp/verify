"use client";

import { useEffect, useState } from "react";
import { Camera, Upload, Loader2, ArrowRight, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useVerificationStore } from "@/lib/verification-store";
import { DOC_TYPES } from "@/lib/verification-types";
import { WebcamCapture } from "@/components/verify/webcam-capture";
import { FileUpload } from "@/components/verify/file-upload";
import { toast } from "sonner";

export function DocCaptureStep() {
  const { docType, docFront, docBack, setDocFront, setDocBack, setDocExtracted, setDocLoading, docLoading, goNext } =
    useVerificationStore();
  const meta = DOC_TYPES.find((d) => d.id === docType)!;
  const needsBack = meta.needsBack;
  const [tab, setTab] = useState<"camera" | "upload">("camera");
  const [error, setError] = useState<string | null>(null);

  const frontReady = !!docFront;
  const backReady = !needsBack || !!docBack;
  const allReady = frontReady && backReady;

  // run extraction once both sides are ready
  useEffect(() => {
    if (!allReady) return;
    if (docLoading) return;
    let cancelled = false;
    (async () => {
      setDocLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/verify/document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frontImage: docFront,
            backImage: needsBack ? docBack : null,
            docType,
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || "Extraction failed");
        setDocExtracted(json.data as any);
        toast.success("Document data extracted");
        goNext();
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to read document");
          toast.error("Could not read document. Try retaking.");
        }
      } finally {
        if (!cancelled) setDocLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allReady]);

  const handleFront = (img: string) => {
    if (img === "") setDocFront(null);
    else setDocFront(img);
  };
  const handleBack = (img: string) => {
    if (img === "") setDocBack(null);
    else setDocBack(img);
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Capture your {meta.label.toLowerCase()}</h2>
        <p className="text-emerald-700 font-arabic" dir="rtl" lang="ar">{meta.labelAr} — التقط صورة واضحة</p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Tips for a clear capture</AlertTitle>
        <AlertDescription>
          Place the document on a dark, flat surface in good lighting. Fill the frame with the
          document and make sure all text is sharp and readable. Avoid glare and shadows.
        </AlertDescription>
      </Alert>

      {needsBack ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <CapturePane
            label="Front side"
            labelAr="الوجه الأمامي"
            value={docFront}
            onChange={handleFront}
            tab={tab}
            setTab={setTab}
          />
          <CapturePane
            label="Back side"
            labelAr="الوجه الخلفي"
            value={docBack}
            onChange={handleBack}
            tab={tab}
            setTab={setTab}
          />
        </div>
      ) : (
        <div className="max-w-md mx-auto">
          <CapturePane
            label={`${meta.label} page`}
            labelAr="صفحة المستند"
            value={docFront}
            onChange={handleFront}
            tab={tab}
            setTab={setTab}
          />
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Extraction failed</AlertTitle>
          <AlertDescription>
            {error} — please retake the photo and try again.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {docLoading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
              Reading document with AI…
            </span>
          ) : (
            <span>
              Front: {docFront ? "✓" : "—"} {needsBack && `· Back: ${docBack ? "✓" : "—"}`}
            </span>
          )}
        </div>
        {docLoading && (
          <Button disabled>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…
          </Button>
        )}
      </div>
    </div>
  );
}

function CapturePane({
  label,
  labelAr,
  value,
  onChange,
  tab,
  setTab,
}: {
  label: string;
  labelAr: string;
  value: string | null;
  onChange: (img: string) => void;
  tab: "camera" | "upload";
  setTab: (t: "camera" | "upload") => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{label}</h3>
          <p className="text-xs text-emerald-700 font-arabic" dir="rtl" lang="ar">{labelAr}</p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="camera">
            <Camera className="h-4 w-4 mr-1.5" /> Camera
          </TabsTrigger>
          <TabsTrigger value="upload">
            <Upload className="h-4 w-4 mr-1.5" /> Upload
          </TabsTrigger>
        </TabsList>
        <TabsContent value="camera" className="mt-3">
          <WebcamCapture
            onCapture={onChange}
            capturedImage={value}
            aspect="4/3"
            facingMode="environment"
            captureLabel="Capture Photo"
          />
        </TabsContent>
        <TabsContent value="upload" className="mt-3">
          <FileUpload
            onUpload={onChange}
            uploadedImage={value}
            aspect="4/3"
            captureLabel="Upload Photo"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
