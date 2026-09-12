"use client";

import { useEffect, useState, useMemo } from "react";
import { ArrowLeft, Globe, FileText, CreditCard, Plane, Car, IdCard, Search, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface FieldSpec {
  key: string;
  labelNative?: string;
  labelEn: string;
  pos?: number[];
  present: boolean;
}

interface DocSpec {
  country: string;
  countryName: string;
  countryNameNative?: string;
  docType: string;
  name: string;
  mrzFormat?: string;
  language: string;
  hasPhoto: boolean;
  nationalIdPattern?: string;
  nationalIdLength?: number;
  notes?: string;
  fields: FieldSpec[];
}

const DOC_TYPE_ICONS: Record<string, any> = {
  national_id: IdCard,
  passport: Plane,
  driver_license: Car,
  residence: CreditCard,
};

export function SpecsBrowser({ onBack }: { onBack: () => void }) {
  const [specs, setSpecs] = useState<DocSpec[]>([]);
  const [countries, setCountries] = useState<{ code: string; name: string; native?: string }[]>([]);
  const [stats, setStats] = useState({ totalSpecs: 0, countries: 0, byType: {} as Record<string, number> });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [docTypeFilter, setDocTypeFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [selected, setSelected] = useState<DocSpec | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/verify/specs");
        const json = await res.json();
        setSpecs(json.specs || []);
        setCountries(json.countries || []);
        setStats(json.stats || { totalSpecs: 0, countries: 0, byType: {} });
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    let out = specs;
    if (docTypeFilter !== "all") out = out.filter((s) => s.docType === docTypeFilter);
    if (countryFilter !== "all") out = out.filter((s) => s.country === countryFilter);
    if (search) {
      const q = search.toLowerCase();
      out = out.filter(
        (s) =>
          s.countryName.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.country.toLowerCase().includes(q) ||
          (s.countryNameNative || "").includes(search)
      );
    }
    return out;
  }, [specs, docTypeFilter, countryFilter, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" /> Document Specs Database
          </h2>
        </div>
        <Badge variant="outline">
          {stats.totalSpecs} specs · {stats.countries} countries
        </Badge>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Globe} label="Countries" value={stats.countries} />
        <StatCard icon={FileText} label="Total specs" value={stats.totalSpecs} />
        <StatCard icon={IdCard} label="National IDs" value={stats.byType?.national_id || 0} />
        <StatCard icon={Plane} label="Passports" value={stats.byType?.passport || 0} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px] space-y-1">
          <label className="text-xs text-muted-foreground">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search country or document..."
              className="pl-9"
            />
          </div>
        </div>
        <div className="w-[160px] space-y-1">
          <label className="text-xs text-muted-foreground">Country</label>
          <Select value={countryFilter} onValueChange={setCountryFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All countries</SelectItem>
              {countries.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name} {c.native ? `(${c.native})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-[160px] space-y-1">
          <label className="text-xs text-muted-foreground">Type</label>
          <Select value={docTypeFilter} onValueChange={setDocTypeFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="national_id">National ID</SelectItem>
              <SelectItem value="passport">Passport</SelectItem>
              <SelectItem value="driver_license">Driver License</SelectItem>
              <SelectItem value="residence">Residence</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Spec cards grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Globe className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p>No specs match your filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((spec) => {
            const Icon = DOC_TYPE_ICONS[spec.docType] || FileText;
            return (
              <Card
                key={`${spec.country}-${spec.docType}`}
                className="cursor-pointer hover:shadow-md transition border-border"
                onClick={() => setSelected(spec)}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-muted p-2 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm">{spec.countryName}</div>
                        {spec.countryNameNative && (
                          <div className="text-xs text-muted-foreground font-arabic" dir="rtl">
                            {spec.countryNameNative}
                          </div>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{spec.country}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{spec.name}</div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {spec.mrzFormat && spec.mrzFormat !== "none" && (
                      <Badge variant="secondary" className="text-[10px]">MRZ: {spec.mrzFormat}</Badge>
                    )}
                    {spec.nationalIdLength && (
                      <Badge variant="secondary" className="text-[10px]">ID: {spec.nationalIdLength} digits</Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">Lang: {spec.language}</Badge>
                    {spec.hasPhoto && <Badge variant="secondary" className="text-[10px]">Photo</Badge>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {spec.fields.filter((f) => f.present).length} fields mapped
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {selected && (
                <>
                  <span>{selected.countryName}</span>
                  {selected.countryNameNative && (
                    <span className="text-muted-foreground font-arabic" dir="rtl">
                      {selected.countryNameNative}
                    </span>
                  )}
                  <Badge variant="outline">{selected.country}</Badge>
                </>
              )}
            </DialogTitle>
            <DialogDescription>{selected?.name}</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <KV label="Type" value={selected.docType.replace("_", " ")} />
                <KV label="MRZ" value={selected.mrzFormat || "none"} />
                <KV label="Language" value={selected.language} />
                <KV label="Photo" value={selected.hasPhoto ? "Yes" : "No"} />
              </div>
              {selected.nationalIdPattern && (
                <div className="rounded-md border p-3 text-sm">
                  <span className="font-semibold">National ID pattern: </span>
                  <code className="text-xs">{selected.nationalIdPattern}</code>
                  {selected.nationalIdLength && (
                    <span className="ml-2 text-muted-foreground">({selected.nationalIdLength} chars)</span>
                  )}
                </div>
              )}
              {selected.notes && (
                <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  {selected.notes}
                </div>
              )}
              <div>
                <h4 className="text-sm font-semibold mb-2">Field locations</h4>
                <div className="space-y-1">
                  {selected.fields.filter((f) => f.present).map((f) => (
                    <div
                      key={f.key}
                      className="flex items-center justify-between border-b border-dashed py-1.5 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium">{f.labelEn}</span>
                        {f.labelNative && (
                          <span className="text-muted-foreground font-arabic" dir="rtl">{f.labelNative}</span>
                        )}
                      </div>
                      {f.pos && (
                        <code className="text-[10px] text-muted-foreground">
                          x:{f.pos[0]}% y:{f.pos[1]}%
                        </code>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="rounded-lg bg-muted p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-lg font-bold">{value}</div>
          <div className="text-[10px] text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="text-sm font-medium capitalize">{value}</div>
    </div>
  );
}
