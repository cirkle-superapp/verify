"use client";

import { cn } from "@/lib/utils";

interface CirkleLogoProps {
  size?: number;
  animated?: boolean;
  className?: string;
  showWordmark?: boolean;
  /** Use the official dark rounded-square logo, or a teal variant for light backgrounds */
  variant?: "dark" | "teal";
}

/**
 * Cirkle official logo.
 *
 * Source: https://cirkleapp.vercel.app/logo.svg
 * The mark is a rounded square with a white angular "Z/C" shape inside,
 * composed of 3 geometric paths. The official version uses a dark (#2D2D2D)
 * background with a breathing opacity animation on the inner shapes.
 *
 * Brand theme color: #1A4A5A (deep teal) — used for the teal variant
 * and as the browser chrome color.
 */
export function CirkleLogo({
  size = 40,
  animated = true,
  className,
  showWordmark = false,
  variant = "dark",
}: CirkleLogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <CirkleMark size={size} animated={animated} variant={variant} />
      {showWordmark && (
        <div className="flex flex-col leading-tight">
          <span className="font-bold tracking-tight text-base text-[#1A4A5A]">
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

export function CirkleMark({
  size = 40,
  animated = true,
  variant = "dark",
}: {
  size?: number;
  animated?: boolean;
  variant?: "dark" | "teal";
}) {
  // Official Cirkle logo paths (from cirkleapp.vercel.app/logo.svg)
  // ViewBox is 0 0 30 30
  const bgFill = variant === "dark" ? "#2D2D2D" : "#1A4A5A";
  const strokeColor = "#FFFFFF";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 30 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Cirkle logo"
    >
      {/* Rounded square background */}
      <path
        d="M24.51,28.51H5.49c-2.21,0-4-1.79-4-4V5.49c0-2.21,1.79-4,4-4h19.03c2.21,0,4,1.79,4,4v19.03
          C28.51,26.72,26.72,28.51,24.51,28.51z"
        fill={bgFill}
        stroke={strokeColor}
        strokeWidth="0.6317"
        strokeMiterlimit="10"
      />
      {/* Inner white geometric shape (3 paths) with breathing animation */}
      <g className={animated ? "cirkle-breathe" : ""}>
        {/* Top-left horizontal stroke */}
        <path
          d="M15.47,7.1l-1.3,1.85c-0.2,0.29-0.54,0.47-0.9,0.47h-7.1V7.09C6.16,7.1,15.47,7.1,15.47,7.1z"
          fill="#FFFFFF"
        />
        {/* Diagonal parallelogram crossing through */}
        <polygon
          points="24.3,7.1 13.14,22.91 5.7,22.91 16.86,7.1"
          fill="#FFFFFF"
        />
        {/* Bottom-right horizontal stroke */}
        <path
          d="M14.53,22.91l1.31-1.86c0.2-0.29,0.54-0.47,0.9-0.47h7.09v2.33H14.53z"
          fill="#FFFFFF"
        />
      </g>
    </svg>
  );
}

/**
 * A larger animated hero logo for the intro screen — with a soft teal glow.
 */
export function CirkleHeroLogo({ size = 96, animated = true }: { size?: number; animated?: boolean }) {
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* Glow */}
      <div
        className="absolute inset-0 rounded-2xl blur-2xl opacity-30"
        style={{ background: "radial-gradient(circle, #1A4A5A 0%, transparent 70%)" }}
      />
      <CirkleMark size={size} animated={animated} variant="dark" />
    </div>
  );
}
