"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ArrowLeft, Loader2, ScanFace, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useVerificationStore } from "@/lib/verification-store";
import { LIVENESS_ACTIONS, type LivenessAction } from "@/lib/verification-types";
import { WebcamCapture } from "@/components/verify/webcam-capture";
import { FileUpload } from "@/components/verify/file-upload";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScoreBadge } from "@/components/verify/score-badge";
import { toast } from "sonner";
import { Camera, Upload } from "lucide-react";

export function SelfieStep() {
  const { selfie, docFront, setSelfie, setFaceMatch, faceMatch, setLivenessActions, goNext, setStep } =
    useVerificationStore();
  const [tab, setTab] = useState<"camera" | "upload">("camera");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When a selfie is captured, run face match against the document front
  useEffect(() => {
    if (!selfie) return;
    if (loading) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/verify/face-match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selfie, docImage: docFront }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || "Face match failed");
        setFaceMatch(json.result);
        if (json.result?.isMatch) {
          toast.success(`Face matched (${Math.round(json.result.similarity)}% similarity)`);
        } else {
          toast.warning(`Low face match (${Math.round(json.result?.similarity ?? 0)}%)`);
        }
        // pre-pick random liveness actions (3 random, distinct)
        const pool: LivenessAction[] = ["turn_left", "turn_right", "look_up", "blink", "smile"];
        const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
        setLivenessActions(shuffled);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Could not compare face");
          toast.error("Face match failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selfie]);

  const handleSelfie = (img: string) => {
    if (img === "") {
      setSelfie(null);
      setFaceMatch(null);
    } else {
      setSelfie(img);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Capture your selfie</h2>
        <p className="text-muted-foreground" dir="rtl" lang="ar">التقط صورة شخصية حية</p>
      </div>

      <Alert>
        <ScanFace className="h-4 w-4" />
        <AlertTitle>How to take a good selfie</AlertTitle>
        <AlertDescription>
          Look straight at the camera, remove glasses or masks, and make sure your face is well
          lit and fills the oval guide. We will compare this with the photo on your document.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
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
                onCapture={handleSelfie}
                capturedImage={selfie}
                mirror
                aspect="3/4"
                faceGuide
                facingMode="user"
                captureLabel="Capture Selfie"
              />
            </TabsContent>
            <TabsContent value="upload" className="mt-3">
              <FileUpload
                onUpload={handleSelfie}
                uploadedImage={selfie}
                aspect="3/4"
                captureLabel="Upload Selfie"
              />
            </TabsContent>
          </Tabs>
        </div>

        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <ScanFace className="h-4 w-4 text-teal-600" /> Face match result
            </h3>
            {!selfie && <p className="text-sm text-muted-foreground">Capture a selfie to run the comparison.</p>}

            {selfie && loading && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-teal-600" /> Comparing face to document…
                </div>
                <Progress value={70} className="h-1.5" />
              </div>
            )}

            {faceMatch && !loading && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {faceMatch.isMatch ? (
                    <CheckCircle2 className="h-10 w-10 text-teal-600" />
                  ) : (
                    <XCircle className="h-10 w-10 text-rose-600" />
                  )}
                  <div className="space-y-1">
                    <div className="font-semibold">
                      {faceMatch.isMatch ? "Faces match" : "Faces do not match"}
                    </div>
                    <ScoreBadge score={faceMatch.similarity} label="Similarity" threshold={70} />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{faceMatch.reasoning}</p>
              </div>
            )}

            {error && !loading && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Comparison failed</AlertTitle>
                <AlertDescription>{error}. Please retake the selfie.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => setStep("doc_review")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button onClick={goNext} disabled={!selfie || loading || !faceMatch}>
          Continue to liveness <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
