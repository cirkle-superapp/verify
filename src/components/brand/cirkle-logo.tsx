"use client";

import { cn } from "@/lib/utils";

interface CirkleLogoProps {
  size?: number;
  animated?: boolean;
  className?: string;
  showWordmark?: boolean;
  variant?: "full" | "mark";
}

/**
 * Cirkle animated logo.
 *
 * Brand identity (from cirkleapp.vercel.app):
 *   - Name: Cirkle (دواير) — "circles"
 *   - Primary: #1A4A5A (deep teal)
 *   - Light bg: #FDFCF9 (warm cream)
 *   - Dark bg: #0a0a0a
 *
 * The mark is three concentric rotating rings, evoking the "Cirkle/دواير"
 * name (دواير = circles). The rings rotate at different speeds and directions
 * to suggest a living, active verification process.
 */
export function CirkleLogo({
  size = 40,
  animated = true,
  className,
  showWordmark = false,
  variant = "mark",
}: CirkleLogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <CirkleMark size={size} animated={animated} />
      {showWordmark && (
        <div className="flex flex-col leading-tight">
          <span className="font-bold tracking-tight text-base">
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

export function CirkleMark({ size = 40, animated = true }: { size?: number; animated?: boolean }) {
  // Three concentric rings with different rotation speeds + a center pulse
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-label="Cirkle logo"
      role="img"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer ring — slowest rotation */}
        <g
          className={animated ? "cirkle-spin-slow" : ""}
          style={{ transformOrigin: "24px 24px" }}
        >
          <circle
            cx="24"
            cy="24"
            r="22"
            stroke="url(#cirkle-grad)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="6 4"
            opacity="0.9"
          />
        </g>
        {/* Middle ring — medium rotation, opposite direction */}
        <g
          className={animated ? "cirkle-spin-rev" : ""}
          style={{ transformOrigin: "24px 24px" }}
        >
          <circle
            cx="24"
            cy="24"
            r="15"
            stroke="#1A4A5A"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="10 6"
            opacity="0.7"
          />
        </g>
        {/* Inner ring — fastest rotation */}
        <g
          className={animated ? "cirkle-spin-fast" : ""}
          style={{ transformOrigin: "24px 24px" }}
        >
          <circle
            cx="24"
            cy="24"
            r="8"
            stroke="#2BB3A5"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="5 3"
            opacity="0.95"
          />
        </g>
        {/* Center pulse — a small filled dot that pulses */}
        <circle cx="24" cy="24" r="3" fill="#1A4A5A" className={animated ? "cirkle-pulse" : ""} />
        <defs>
          <linearGradient id="cirkle-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#1A4A5A" />
            <stop offset="0.5" stopColor="#2BB3A5" />
            <stop offset="1" stopColor="#1A4A5A" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

/**
 * A larger animated hero logo for the intro screen — bigger rings + glow.
 */
export function CirkleHeroLogo({ size = 120, animated = true }: { size?: number; animated?: boolean }) {
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* Glow */}
      <div
        className="absolute inset-0 rounded-full blur-2xl opacity-40"
        style={{ background: "radial-gradient(circle, #2BB3A5 0%, transparent 70%)" }}
      />
      <CirkleMark size={size} animated={animated} />
    </div>
  );
}
