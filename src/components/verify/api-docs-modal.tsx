"use client";

import * as React from "react";
import { ExternalLink, BookOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n/use-i18n";

/**
 * ApiDocsModal — renders a "API Docs" button that opens a full-screen
 * modal containing an iframe to the hosted Swagger UI petstore
 * (https://petstore.swagger.io) with the Cirkle OpenAPI spec URL.
 *
 * Why an iframe instead of importing `swagger-ui-react`?
 *   1. The hosted petstore Swagger UI is up-to-date and zero-bundle.
 *   2. Saves ~400 KB on the home page bundle (swagger-ui-react pulls
 *      in react-syntax-highlighter + numerous vendors).
 *   3. The petstore UI fetches our /api/openapi.json directly, so it
 *      always reflects the deployed spec without a rebuild.
 *
 * The spec URL is computed once (production or local) so the modal
 * works on both `localhost:3000` and `cirkle-verify.vercel.app`.
 */
export function ApiDocsModal() {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);

  // Compute the spec URL based on the current origin so it works
  // on both localhost and production vercel.
  const [specUrl, setSpecUrl] = React.useState(
    "https://cirkle-verify.vercel.app/api/openapi.json",
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const origin = window.location.origin;
    // Only use the local origin if it's localhost or a vercel.app preview.
    if (origin.includes("localhost") || origin.includes("vercel.app")) {
      setSpecUrl(`${origin}/api/openapi.json`);
    }
  }, []);

  // Encode the URL for embedding in the petstore query param.
  const petstoreUrl = React.useMemo(() => {
    return `https://petstore.swagger.io/?url=${encodeURIComponent(specUrl)}`;
  }, [specUrl]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t("nav.apiDocs")}>
          <BookOpen className="h-4 w-4 mr-1" />
          <span className="hidden sm:inline">{t("nav.apiDocs")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-[95vw] w-[95vw] max-h-[95vh] h-[95vh] p-0 gap-0 overflow-hidden"
        showCloseButton
      >
        <DialogHeader className="px-4 py-3 border-b border-border bg-muted/30 flex-row items-center justify-between space-y-0">
          <div className="flex flex-col gap-1 text-left">
            <DialogTitle className="text-base">{t("nav.apiDocs")}</DialogTitle>
            <DialogDescription>{t("nav.apiDocsDesc")}</DialogDescription>
          </div>
          <a
            href={petstoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Open in new tab <ExternalLink className="h-3 w-3" />
          </a>
        </DialogHeader>
        <iframe
          src={petstoreUrl}
          title="Cirkle API — Swagger UI"
          className="w-full flex-1 border-0"
          style={{ height: "calc(95vh - 80px)" }}
          loading="lazy"
        />
      </DialogContent>
    </Dialog>
  );
}
