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
 * in the page HTML).
 *
 * The mark is THREE OVERLAPPING CIRCLES arranged in a triangular formation,
 * with a gold→rose→teal gradient stroke and a small filled gradient dot
 * in the center.
 *
 * Animation: the live site uses two animations:
 *  1. Entrance: fade-in + unblur + scale-up (one-time, on mount)
 *  2. Continuous: orbFloat — translateY(-12px) + scale(1.05), 6s ease-in-out infinite
 *
 * Brand colors (from :root CSS variables):
 *   --gold:   #d1b685   --rose: #bd616f   --teal: #1a4b5b
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
          <span className="font-bold tracking-tight text-base text-primary">
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
 * Uses the orbFloat animation from the live site (6s ease-in-out infinite,
 * translateY(-12px) + scale(1.05)).
 */
export function CirkleMark({
  size = 40,
  animated = true,
}: {
  size?: number;
  animated?: boolean;
}) {
  return (
    <div
      className={animated ? "cirkle-orb-float" : ""}
      style={{ width: size, height: size, display: "inline-flex" }}
    >
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
        <circle cx="50" cy="32" r="22" stroke="url(#cirkle-grad)" strokeWidth="1.5" opacity="0.9" />
        <circle cx="32" cy="60" r="22" stroke="url(#cirkle-grad)" strokeWidth="1.5" opacity="0.9" />
        <circle cx="68" cy="60" r="22" stroke="url(#cirkle-grad)" strokeWidth="1.5" opacity="0.9" />
        {/* Center dot */}
        <circle cx="50" cy="50" r="6" fill="url(#cirkle-grad)" />
      </svg>
    </div>
  );
}

/**
 * A larger animated hero logo for the intro screen.
 *
 * Plays the Cirkle splash entrance (fade-in + unblur + scale-up) on mount,
 * then continuously floats using orbFloat. Includes a soft gold glow.
 */
export function CirkleHeroLogo({ size = 120, animated = true }: { size?: number; animated?: boolean }) {
  return (
    <div
      className="relative inline-flex items-center justify-center cirkle-splash-in"
      style={{ width: size, height: size }}
    >
      {/* Soft glow using the brand gradient colors */}
      <div
        className="absolute inset-0 rounded-full blur-2xl cirkle-orb-float"
        style={{
          background:
            "radial-gradient(circle, #d1b68555 0%, #bd616f33 40%, #1a4b5b22 70%, transparent 100%)",
        }}
      />
      <CirkleMark size={size} animated={animated} />
    </div>
  );
}
