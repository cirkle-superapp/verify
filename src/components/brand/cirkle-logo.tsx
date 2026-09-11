"use client";

import { cn } from "@/lib/utils";

interface CirkleLogoProps {
  size?: number;
  animated?: boolean;
  className?: string;
  showWordmark?: boolean;
}

/**
 * Cirkle official logo.
 *
 * Source: extracted directly from the rendered inline SVG at
 * https://cirkleapp.vercel.app (the <svg width="140" height="140"> element
 * in the page HTML — NOT the /logo.svg file which is a different, older mark).
 *
 * The mark is THREE OVERLAPPING CIRCLES arranged like a Venn diagram /
 * triangular ring formation, with a gradient stroke (gold → rose → teal)
 * and a small filled gradient dot in the center.
 *
 * Brand colors (from :root CSS variables at cirkleapp.vercel.app):
 *   --gold:   39 45% 57%  → #d1b685 (warm gold/tan)
 *   --rose:   351 41% 56% → #bd616f (dusty rose)
 *   --teal:   195 56% 23% → #1a4b5b (deep teal)  ← also --primary
 *   --cream:  40 50% 98%  → warm cream background
 */
export function CirkleLogo({
  size = 40,
  animated = true,
  className,
  showWordmark = false,
}: CirkleLogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <CirkleMark size={size} animated={animated} />
      {showWordmark && (
        <div className="flex flex-col leading-tight">
          <span className="font-bold tracking-tight text-base text-[#1a4b5b]">
            Cirkle
          </span>
          <span className="text-[10px] text-muted-foreground -mt-0.5">
            Identity Verification
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The official Cirkle mark — three overlapping circles with a
 * gold→rose→teal gradient stroke + a center dot.
 *
 * viewBox 0 0 100 100, exact paths from the live site.
 */
export function CirkleMark({
  size = 40,
  animated = true,
}: {
  size?: number;
  animated?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Cirkle logo"
    >
      <defs>
        <linearGradient id="cirkle-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d1b685" />
          <stop offset="50%" stopColor="#bd616f" />
          <stop offset="100%" stopColor="#1a4b5b" />
        </linearGradient>
      </defs>
      {/* Three overlapping circles — top, bottom-left, bottom-right */}
      <g className={animated ? "cirkle-breathe" : ""}>
        <circle cx="50" cy="32" r="22" stroke="url(#cirkle-grad)" strokeWidth="1.5" opacity="0.9" />
        <circle cx="32" cy="60" r="22" stroke="url(#cirkle-grad)" strokeWidth="1.5" opacity="0.9" />
        <circle cx="68" cy="60" r="22" stroke="url(#cirkle-grad)" strokeWidth="1.5" opacity="0.9" />
        {/* Center dot */}
        <circle cx="50" cy="50" r="6" fill="url(#cirkle-grad)" />
      </g>
    </svg>
  );
}

/**
 * A larger animated hero logo for the intro screen — with a soft gold glow.
 */
export function CirkleHeroLogo({ size = 120, animated = true }: { size?: number; animated?: boolean }) {
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* Soft glow using the brand gradient colors */}
      <div
        className="absolute inset-0 rounded-full blur-2xl opacity-40"
        style={{
          background:
            "radial-gradient(circle, #d1b68555 0%, #bd616f33 40%, #1a4b5b22 70%, transparent 100%)",
        }}
      />
      <CirkleMark size={size} animated={animated} />
    </div>
  );
}
