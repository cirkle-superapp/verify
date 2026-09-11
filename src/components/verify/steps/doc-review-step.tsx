"use client";

import { useMemo } from "react";
import { ArrowRight, ArrowLeft, User, Hash, MapPin, Calendar, Briefcase, Heart, RotateCcw, FileText, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useVerificationStore } from "@/lib/verification-store";
import { DOC_TYPES } from "@/lib/verification-types";
import { ScoreBadge } from "@/components/verify/score-badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

function FieldRow({
  icon: Icon,
  label,
  labelAr,
  value,
}: {
  icon: any;
  label: string;
  labelAr?: string;
  value?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b last:border-0">
      <div className="mt-0.5 rounded-md bg-muted p-1.5 text-muted-foreground shrink-0">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          {labelAr && (
            <span className="text-xs text-emerald-700 font-arabic" dir="rtl" lang="ar">{labelAr}</span>
          )}
        </div>
        <div className="text-sm font-medium break-words" dir="auto">{value}</div>
      </div>
    </div>
  );
}

export function DocReviewStep() {
  const { docType, docFront, docBack, docExtracted, setStep, goNext, setDocFront, setDocBack, setDocExtracted } =
    useVerificationStore();
  const meta = DOC_TYPES.find((d) => d.id === docType)!;
  const extracted = docExtracted;

  const extraEntries = useMemo(() => {
    if (!extracted?.extraFields) return [];
    return Object.entries(extracted.extraFields).filter(([, v]) => v && String(v).trim());
  }, [extracted]);

  const hasAnyField = !!(
    extracted?.fullNameAr ||
    extracted?.fullNameEn ||
    extracted?.nationalId ||
    extracted?.birthDate ||
    extracted?.address ||
    extracted?.documentNo ||
    extracted?.nationality ||
    extracted?.job ||
    extracted?.religion ||
    extracted?.maritalStatus ||
    extraEntries.length
  );

  const retake = () => {
    setDocFront(null);
    setDocBack(null);
    setDocExtracted(null);
    setStep("doc_capture");
    toast.info("Please retake the document photos");
  };

  // Allow continuing as long as we have a document image — face match uses the image, not the text.
  const canContinue = !!docFront;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Review extracted data</h2>
        <p className="text-muted-foreground" dir="rtl" lang="ar">راجع البيانات المستخرجة</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="text-muted-foreground">Document:</span>{" "}
          <span className="font-medium">{meta.label}</span>
          <span className="text-emerald-700 font-arabic ml-2" dir="rtl" lang="ar">{meta.labelAr}</span>
        </div>
        {extracted && (
          <ScoreBadge
            score={Math.round((extracted.confidence || 0) * 100)}
            label="OCR confidence"
            threshold={60}
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Images */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-emerald-600" /> Document image
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Tabs defaultValue="front">
              <TabsList className={(docBack ? "grid grid-cols-2" : "") + " w-full"}>
                <TabsTrigger value="front">Front</TabsTrigger>
                {docBack && <TabsTrigger value="back">Back</TabsTrigger>}
              </TabsList>
              <TabsContent value="front">
                {docFront ? (
                  <img src={docFront} alt="Document front" className="w-full rounded-lg border" />
                ) : (
                  <p className="text-sm text-muted-foreground">No front image</p>
                )}
              </TabsContent>
              {docBack && (
                <TabsContent value="back">
                  <img src={docBack} alt="Document back" className="w-full rounded-lg border" />
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>

        {/* Extracted data */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-emerald-600" /> Extracted fields
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!extracted || !hasAnyField ? (
              <Alert variant="destructive">
                <AlertTitle>No fields could be read</AlertTitle>
                <AlertDescription>
                  The image may be blurry, dark, or not a valid {meta.label}. Please retake.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="divide-y">
                <FieldRow icon={User} label="Name (Ar)" labelAr="الاسم" value={extracted.fullNameAr} />
                <FieldRow icon={User} label="Name (En)" labelAr="الاسم بالإنجليزية" value={extracted.fullNameEn} />
                <FieldRow icon={Hash} label="National ID" labelAr="الرقم القومي" value={extracted.nationalId} />
                <FieldRow icon={Hash} label="Document No" labelAr="رقم المستند" value={extracted.documentNo} />
                <FieldRow icon={Calendar} label="Date of birth" labelAr="تاريخ الميلاد" value={extracted.birthDate} />
                <FieldRow icon={Calendar} label="Expiry" labelAr="الانتهاء" value={extracted.expiryDate} />
                <FieldRow icon={User} label="Gender" labelAr="النوع" value={extracted.gender} />
                <FieldRow icon={MapPin} label="Address" labelAr="العنوان" value={extracted.address} />
                <FieldRow icon={MapPin} label="Nationality" labelAr="الجنسية" value={extracted.nationality} />
                <FieldRow icon={Briefcase} label="Profession" labelAr="الوظيفة" value={extracted.job} />
                <FieldRow icon={Heart} label="Religion" labelAr="الديانة" value={extracted.religion} />
                <FieldRow icon={Heart} label="Marital status" labelAr="الحالة الاجتماعية" value={extracted.maritalStatus} />
                {extraEntries.map(([k, v]) => (
                  <FieldRow key={k} icon={FileText} label={k} value={String(v)} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {extracted?.rawText && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Raw OCR text dump</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-48 overflow-y-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-words" dir="auto">
              {extracted.rawText}
            </pre>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={retake}>
          <RotateCcw className="h-4 w-4 mr-2" /> Retake photos
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setStep("doc_capture")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button onClick={goNext} disabled={!canContinue}>
            Continue to selfie <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
