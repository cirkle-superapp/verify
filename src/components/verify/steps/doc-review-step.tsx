"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ArrowLeft, User, Hash, MapPin, Calendar, Briefcase, Heart, RotateCcw, FileText, ImageIcon, ShieldCheck, AlertTriangle, CheckCircle2, Wand2, Loader2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useVerificationStore } from "@/lib/verification-store";
import { DOC_TYPES } from "@/lib/verification-types";
import { ScoreBadge } from "@/components/verify/score-badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { enhanceImage } from "@/lib/image-enhance";
import { toast } from "sonner";

function FieldRow({
  icon: Icon,
  label,
  labelAr,
  value,
  confidence,
}: {
  icon: any;
  label: string;
  labelAr?: string;
  value?: string | null;
  confidence?: number;
}) {
  if (!value) return null;
  const confPct = typeof confidence === "number" ? Math.round(confidence * 100) : null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b last:border-0">
      <div className="mt-0.5 rounded-md bg-muted p-1.5 text-muted-foreground shrink-0">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          {labelAr && (
            <span className="text-xs text-teal-700 font-arabic" dir="rtl" lang="ar">{labelAr}</span>
          )}
          {confPct !== null && (
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${confPct >= 70 ? "bg-teal-100 text-teal-700" : confPct >= 40 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
              {confPct}%
            </span>
          )}
        </div>
        <div className="text-sm font-medium break-words" dir="auto">{value}</div>
      </div>
    </div>
  );
}

export function DocReviewStep() {
  const { docType, docFront, docBack, docExtracted, setStep, goNext, setDocFront, setDocBack, setDocExtracted, setDocLoading } =
    useVerificationStore();
  const meta = DOC_TYPES.find((d) => d.id === docType)!;
  const extracted = docExtracted;
  const [enhancing, setEnhancing] = useState(false);

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

  const reEnhanceAndReExtract = async () => {
    if (!docFront) return;
    setEnhancing(true);
    setDocLoading(true);
    try {
      const enhanced = await enhanceImage(docFront, { contrast: 25, sharpness: 45, autoContrast: true });
      setDocFront(enhanced);
      // re-run extraction
      const res = await fetch("/api/verify/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frontImage: enhanced, backImage: docBack, docType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDocExtracted(json.data);
      toast.success("Re-extracted with enhanced image");
    } catch (e: any) {
      toast.error(e?.message || "Enhancement failed");
    } finally {
      setEnhancing(false);
      setDocLoading(false);
    }
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
          <span className="text-teal-700 font-arabic ml-2" dir="rtl" lang="ar">{meta.labelAr}</span>
          {extracted?.passes && (
            <Badge variant="outline" className="ml-2 text-[10px]">{extracted.passes}-pass OCR</Badge>
          )}
          {extracted?.mrzParsed && (
            <Badge variant="outline" className="ml-1 text-[10px] bg-teal-50 text-teal-700">MRZ parsed</Badge>
          )}
          {extracted?.extraFields?._detectedCountry && (
            <Badge variant="outline" className="ml-1 text-[10px] bg-blue-50 text-blue-700 border-blue-200">
              <Globe className="h-2.5 w-2.5 mr-0.5 inline" />
              {extracted.extraFields._detectedCountryName || extracted.extraFields._detectedCountry}
            </Badge>
          )}
          {extracted?.extraFields?._nameEn_fromArabic && (
            <Badge variant="outline" className="ml-1 text-[10px] bg-purple-50 text-purple-700 border-purple-200">
              Translated
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {extracted && (
            <ScoreBadge
              score={Math.round((extracted.confidence || 0) * 100)}
              label="OCR confidence"
              threshold={60}
            />
          )}
          <Button variant="outline" size="sm" onClick={reEnhanceAndReExtract} disabled={enhancing}>
            {enhancing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
            Enhance & re-extract
          </Button>
        </div>
      </div>

      {/* Image quality assessment panel */}
      {extracted?.imageQuality && (
        <Card className={extracted.imageQuality.overallQuality < 0.5 ? "border-amber-300 bg-amber-50/30" : "border-teal-100"}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className={`rounded-md p-2 ${extracted.imageQuality.overallQuality >= 0.7 ? "bg-teal-100 text-teal-700" : extracted.imageQuality.overallQuality >= 0.4 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
                {extracted.imageQuality.overallQuality >= 0.7 ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-semibold text-sm">Image quality: {Math.round(extracted.imageQuality.overallQuality * 100)}%</div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                      <span>Blurry: {extracted.imageQuality.isBlurry ? "Yes" : "No"}</span>
                      <span>Glare: {extracted.imageQuality.hasGlare ? "Yes" : "No"}</span>
                      <span>Framed: {extracted.imageQuality.isFramedWell ? "Well" : "Poorly"}</span>
                      <span>Rotation: {extracted.imageQuality.rotation}</span>
                      <span>Lighting: {extracted.imageQuality.lighting}</span>
                    </div>
                  </div>
                </div>
                {extracted.imageQuality.issues.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {extracted.imageQuality.issues.map((iss, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">{iss}</Badge>
                    ))}
                  </div>
                )}
                {extracted.imageQuality.suggestions.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">Suggestions: </span>
                    {extracted.imageQuality.suggestions.join(" · ")}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Validation flags panel */}
      {extracted?.validationFlags && (extracted.validationFlags.nationalIdValid !== undefined || extracted.validationFlags.genderInferred) && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="h-4 w-4 text-teal-600" />
              <span className="font-semibold text-sm">Field validation</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              {extracted.validationFlags.nationalIdValid !== undefined && (
                <div className="flex items-center gap-2">
                  {extracted.validationFlags.nationalIdValid ?
                    <CheckCircle2 className="h-4 w-4 text-teal-600" /> :
                    <AlertTriangle className="h-4 w-4 text-amber-500" />}
                  <span>National ID: {extracted.validationFlags.nationalIdChecksumValid ? "valid checksum ✓" : extracted.validationFlags.nationalIdValid ? "format valid, checksum weak" : "invalid format"}</span>
                </div>
              )}
              {extracted.validationFlags.genderInferred && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-teal-600" />
                  <span>Gender inferred from NID: {extracted.validationFlags.genderInferred}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Images */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-teal-600" /> Document image
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
              <FileText className="h-4 w-4 text-teal-600" /> Extracted fields
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
                <FieldRow icon={User} label="Name (Ar)" labelAr="الاسم" value={extracted.fullNameAr} confidence={extracted.fieldConfidence?.fullNameAr} />
                <FieldRow icon={User} label="Name (En)" labelAr="الاسم بالإنجليزية" value={extracted.fullNameEn} confidence={extracted.fieldConfidence?.fullNameEn} />
                <FieldRow icon={Hash} label="National ID" labelAr="الرقم القومي" value={extracted.nationalId} confidence={extracted.fieldConfidence?.nationalId} />
                <FieldRow icon={Hash} label="Document No" labelAr="رقم المستند" value={extracted.documentNo} confidence={extracted.fieldConfidence?.documentNo} />
                <FieldRow icon={Calendar} label="Date of birth" labelAr="تاريخ الميلاد" value={extracted.birthDate} confidence={extracted.fieldConfidence?.birthDate} />
                <FieldRow icon={Calendar} label="Expiry" labelAr="الانتهاء" value={extracted.expiryDate} confidence={extracted.fieldConfidence?.expiryDate} />
                <FieldRow icon={User} label="Gender" labelAr="النوع" value={extracted.gender} confidence={extracted.fieldConfidence?.gender} />
                <FieldRow icon={MapPin} label="Address" labelAr="العنوان" value={extracted.address} confidence={extracted.fieldConfidence?.address} />
                <FieldRow icon={MapPin} label="Nationality" labelAr="الجنسية" value={extracted.nationality} confidence={extracted.fieldConfidence?.nationality} />
                <FieldRow icon={Briefcase} label="Profession" labelAr="الوظيفة" value={extracted.job} confidence={extracted.fieldConfidence?.job} />
                <FieldRow icon={Heart} label="Religion" labelAr="الديانة" value={extracted.religion} confidence={extracted.fieldConfidence?.religion} />
                <FieldRow icon={Heart} label="Marital status" labelAr="الحالة الاجتماعية" value={extracted.maritalStatus} confidence={extracted.fieldConfidence?.maritalStatus} />
                {extraEntries.map(([k, v]) => (
                  <FieldRow key={k} icon={FileText} label={k} value={String(v)} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {extracted?.arabicText && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-teal-600" /> Arabic OCR pass (raw)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-40 overflow-y-auto rounded-md bg-teal-50/40 p-3 text-xs whitespace-pre-wrap break-words font-arabic" dir="auto" lang="ar">
              {extracted.arabicText}
            </pre>
          </CardContent>
        </Card>
      )}

      {extracted?.rawText && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Raw OCR text dump (Arabic + English)</CardTitle>
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
