"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Database, Plus, Trash2, RefreshCw, ArrowLeft, Beaker, IdCard, Sparkles, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileUpload } from "@/components/verify/file-upload";
import { SYNTHETIC_SAMPLES, renderSyntheticDoc } from "@/lib/synthetic-doc";
import type { DocType, TrainingSample } from "@/lib/verification-types";
import { toast } from "sonner";

const DOC_OPTIONS: { value: DocType; label: string }[] = [
  { value: "national_id", label: "National ID" },
  { value: "passport", label: "Passport" },
  { value: "driver_license", label: "Driver License" },
  { value: "residence", label: "Residence" },
];

export function TrainingData({ onBack }: { onBack: () => void }) {
  const [samples, setSamples] = useState<TrainingSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/verify/samples?withImage=1");
      const json = await res.json();
      setSamples(json.samples || []);
    } catch {
      toast.error("Failed to load samples");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const seedSynthetic = async () => {
    setSeeding(true);
    try {
      // render each synthetic sample client-side (canvas), then upload
      const rendered = SYNTHETIC_SAMPLES.map((spec) => {
        const front = renderSyntheticDoc(spec, "front");
        const back = renderSyntheticDoc(spec, "back");
        return { ...spec, imageData: front, backImageData: back };
      });
      const res = await fetch("/api/verify/samples/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samples: rendered }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast.success(`Seeded ${json.created} synthetic samples`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Seed failed");
    } finally {
      setSeeding(false);
    }
  };

  const clearSynthetic = async () => {
    if (!confirm("Delete ALL synthetic samples from the training database?")) return;
    try {
      const res = await fetch("/api/verify/samples/seed", { method: "DELETE" });
      const json = await res.json();
      toast.success(`Deleted ${json.deleted} synthetic samples`);
      await load();
    } catch {
      toast.error("Clear failed");
    }
  };

  const del = async (id: string) => {
    if (!confirm("Delete this training sample?")) return;
    try {
      await fetch(`/api/verify/samples/${id}`, { method: "DELETE" });
      setSamples((s) => s.filter((x) => x.id !== id));
      toast.success("Sample deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  const syntheticCount = samples.filter((s) => s.source === "synthetic").length;
  const manualCount = samples.length - syntheticCount;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Database className="h-5 w-5 text-emerald-600" /> Training Data
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> Add sample
              </Button>
            </DialogTrigger>
            <AddSampleDialog
              onClose={() => setAddOpen(false)}
              onSaved={() => { setAddOpen(false); load(); }}
            />
          </Dialog>
        </div>
      </div>

      {/* Seed control panel */}
      <Card className="border-emerald-100 bg-emerald-50/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Beaker className="h-4 w-4 text-emerald-600" /> Synthetic sample bank
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Seed the database with <strong>{SYNTHETIC_SAMPLES.length} deterministic synthetic
            documents</strong> rendered on a canvas with known ground-truth text. Because we know
            exactly what text is on each card, OCR accuracy is measured meaningfully. These are
            MOCK documents (not real IDs) — safe for testing the pipeline.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={seedSynthetic} disabled={seeding}>
              {seeding ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Seeding…</> : <><Sparkles className="h-4 w-4 mr-2" /> Seed synthetic samples</>}
            </Button>
            {syntheticCount > 0 && (
              <Button variant="outline" onClick={clearSynthetic} disabled={seeding}>
                <Trash2 className="h-4 w-4 mr-2 text-rose-500" /> Clear synthetic ({syntheticCount})
              </Button>
            )}
            <Badge variant="outline"><IdCard className="h-3 w-3 mr-1" /> {SYNTHETIC_SAMPLES.length} available</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total samples" value={samples.length} />
        <StatCard label="Synthetic" value={syntheticCount} accent="emerald" />
        <StatCard label="Manual" value={manualCount} accent="amber" />
      </div>

      {/* Sample grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : samples.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Database className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No training samples yet</p>
            <p className="text-sm">Seed synthetic samples or upload your own to start stress testing.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {samples.map((s) => (
            <Card key={s.id} className="overflow-hidden flex flex-col">
              <div className="relative aspect-[4/3] bg-muted">
                {s.imageData ? (
                  <img src={s.imageData} alt={s.name} className="absolute inset-0 h-full w-full object-contain bg-black/5" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <IdCard className="h-8 w-8" />
                  </div>
                )}
                <div className="absolute top-2 right-2">
                  <Badge variant={s.source === "synthetic" ? "default" : "secondary"}
                    className={s.source === "synthetic" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>
                    {s.source}
                  </Badge>
                </div>
              </div>
              <CardContent className="p-4 flex-1 space-y-2">
                <div>
                  <div className="font-semibold text-sm truncate" title={s.name}>{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.docType.replace("_", " ")}</div>
                </div>
                <div className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                  {s.fullNameAr && <Field k="Name (Ar)" v={s.fullNameAr} ar />}
                  {s.fullNameEn && <Field k="Name (En)" v={s.fullNameEn} />}
                  {s.nationalId && <Field k="NID" v={s.nationalId} mono />}
                  {s.documentNo && <Field k="Doc No" v={s.documentNo} mono />}
                  {s.birthDate && <Field k="DOB" v={s.birthDate} mono />}
                  {s.gender && <Field k="Gender" v={s.gender} />}
                </div>
                <div className="flex justify-end pt-2 border-t">
                  <Button size="sm" variant="ghost" onClick={() => del(s.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: "emerald" | "amber" }) {
  const color = accent === "emerald" ? "text-emerald-700" : accent === "amber" ? "text-amber-700" : "";
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Field({ k, v, ar, mono }: { k: string; v: string; ar?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{k}:</span>
      <span className={`font-medium text-right truncate ${mono ? "font-mono" : ""}`} dir={ar ? "rtl" : "auto"} title={v}>{v}</span>
    </div>
  );
}

function AddSampleDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: "", docType: "national_id" as DocType,
    fullNameAr: "", fullNameEn: "", nationalId: "", birthDate: "", address: "",
    gender: "Male", documentNo: "", expiryDate: "", nationality: "مصري",
    job: "", religion: "مسلم", maritalStatus: "أعزب",
  });
  const [image, setImage] = useState<string>("");
  const [backImage, setBackImage] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!image) { toast.warning("Please upload a document image"); return; }
    if (!form.name) { toast.warning("Please give the sample a name"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/verify/samples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, imageData: image, backImageData: backImage || undefined, source: "manual" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast.success("Sample saved");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Add labeled training sample</DialogTitle>
        <DialogDescription>
          Upload a document image and fill in the GROUND TRUTH fields exactly as printed.
          This sample will be used to measure OCR accuracy during stress tests.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Sample name</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. My Test ID #1" />
          </div>
          <div className="space-y-2">
            <Label>Document type</Label>
            <Select value={form.docType} onValueChange={(v) => set("docType", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FileUpload onUpload={setImage} uploadedImage={image} aspect="4/3" title="Front image" captureLabel="Upload front" />
          <FileUpload onUpload={setBackImage} uploadedImage={backImage} aspect="4/3" title="Back image (optional)" captureLabel="Upload back" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldInput label="Full name (Arabic)" value={form.fullNameAr} onChange={(v) => set("fullNameAr", v)} ar placeholder="الاسم بالعربية" />
          <FieldInput label="Full name (English)" value={form.fullNameEn} onChange={(v) => set("fullNameEn", v)} placeholder="Name in English" />
          <FieldInput label="National ID" value={form.nationalId} onChange={(v) => set("nationalId", v)} mono placeholder="14 digits" />
          <FieldInput label="Document No" value={form.documentNo} onChange={(v) => set("documentNo", v)} mono placeholder="Document serial" />
          <FieldInput label="Birth date" value={form.birthDate} onChange={(v) => set("birthDate", v)} mono placeholder="YYYY-MM-DD" />
          <div className="space-y-2">
            <Label>Gender</Label>
            <Select value={form.gender} onValueChange={(v) => set("gender", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Male">Male</SelectItem>
                <SelectItem value="Female">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <FieldInput label="Expiry date" value={form.expiryDate} onChange={(v) => set("expiryDate", v)} mono placeholder="YYYY-MM-DD" />
          <FieldInput label="Nationality" value={form.nationality} onChange={(v) => set("nationality", v)} ar placeholder="الجنسية" />
          <FieldInput label="Profession" value={form.job} onChange={(v) => set("job", v)} ar placeholder="الوظيفة" />
          <FieldInput label="Religion" value={form.religion} onChange={(v) => set("religion", v)} ar placeholder="الديانة" />
          <FieldInput label="Marital status" value={form.maritalStatus} onChange={(v) => set("maritalStatus", v)} ar placeholder="الحالة الاجتماعية" />
        </div>
        <FieldInput label="Address" value={form.address} onChange={(v) => set("address", v)} ar placeholder="العنوان" />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : "Save sample"}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

function FieldInput({ label, value, onChange, ar, mono, placeholder }: { label: string; value: string; onChange: (v: string) => void; ar?: boolean; mono?: boolean; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} dir={ar ? "rtl" : "auto"} className={mono ? "font-mono" : ""} placeholder={placeholder} />
    </div>
  );
}
