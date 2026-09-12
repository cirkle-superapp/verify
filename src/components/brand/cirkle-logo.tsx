"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface CirkleLogoProps {
  size?: number;
  animated?: boolean;
  className?: string;
  showWordmark?: boolean;
}

/**
 * Cirkle official logo — CircleMark.
 *
 * Source: copied verbatim from the CIRKLE repo at
 * github.com/fortleem/CIRKLE/blob/main/src/components/brand/circle-mark.tsx
 *
 * The mark is THREE OVERLAPPING CIRCLES arranged in a triangular formation
 * with a gold→rose→teal gradient stroke and a small filled gradient dot
 * in the center.
 *
 * Animation: the real Cirkle site uses framer-motion with a continuous
 * 360° rotation over 30 seconds (linear, infinite). This is a slow, gentle
 * rotation — NOT a translateY float.
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
 * Animation: continuous 360° rotation, 30s linear infinite (via framer-motion),
 * exactly matching src/components/brand/circle-mark.tsx from the CIRKLE repo.
 */
export function CirkleMark({ size = 40, animated = true }: { size?: number; animated?: boolean }) {
  const Wrap = animated ? motion.svg : "svg";
  const props = animated
    ? { animate: { rotate: 360 }, transition: { duration: 30, repeat: Infinity, ease: "linear" as const } }
    : {};
  return (
    <Wrap
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Cirkle logo"
      {...(props as any)}
    >
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d1b685" />
          <stop offset="50%" stopColor="#bd616f" />
          <stop offset="100%" stopColor="#1a4b5b" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="32" r="22" stroke="url(#cg)" strokeWidth="1.5" opacity="0.9" />
      <circle cx="32" cy="60" r="22" stroke="url(#cg)" strokeWidth="1.5" opacity="0.9" />
      <circle cx="68" cy="60" r="22" stroke="url(#cg)" strokeWidth="1.5" opacity="0.9" />
      <circle cx="50" cy="50" r="6" fill="url(#cg)" />
    </Wrap>
  );
}

/**
 * Hero logo for the intro screen — replicates the CIRKLE splash entrance:
 *   initial: scale(0.4), opacity(0), blur(30px)
 *   animate: scale(1), opacity(1), blur(0px)
 *   transition: duration 1.1s, ease [0.16, 1, 0.3, 1] (Cirkle's ease-out-expo)
 *
 * The mark itself continues its 30s rotation after the entrance.
 */
export function CirkleHeroLogo({ size = 120, animated = true }: { size?: number; animated?: boolean }) {
  return (
    <motion.div
      initial={{ scale: 0.4, opacity: 0, filter: "blur(30px)" }}
      animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
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
    </motion.div>
  );
}

/**
 * Cirkle CircleLogo — the alternate quadrant-ring mark (from circle-logo.tsx).
 * A golden ring containing four quadrant icons (chat, play, camera, square).
 * Uses the orbFloat animation (translateY + scale).
 *
 * Included for completeness; the primary mark used in the app is CirkleMark.
 */
export function CirkleCircleLogo({
  size = 40,
  animated = false,
  className,
  withWordmark = false,
}: {
  size?: number;
  animated?: boolean;
  className?: string;
  withWordmark?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("shrink-0", animated && "cirkle-orb-float")}
        aria-label="Cirkle logo"
        role="img"
      >
        <defs>
          <linearGradient id="circle-gold" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop stopColor="#E5C98A" />
            <stop offset="0.5" stopColor="#C2A060" />
            <stop offset="1" stopColor="#9A7A3E" />
          </linearGradient>
          <linearGradient id="circle-gold-shine" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffffff" stopOpacity="0.45" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="circle-inner-glow" cx="0.5" cy="0.5" r="0.5" gradientUnits="objectBoundingBox">
            <stop stopColor="#C2A060" stopOpacity="0.18" />
            <stop offset="1" stopColor="#C2A060" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx="32" cy="32" r="29" stroke="url(#circle-gold)" strokeWidth="3.5" fill="none" />
        <circle cx="32" cy="32" r="26" fill="url(#circle-inner-glow)" />
        <path d="M10 22 A 26 26 0 0 1 22 10" stroke="url(#circle-gold-shine)" strokeWidth="3.5" fill="none" strokeLinecap="round" />

        <line x1="32" y1="9" x2="32" y2="55" stroke="#C2A060" strokeWidth="0.6" strokeOpacity="0.25" />
        <line x1="9" y1="32" x2="55" y2="32" stroke="#C2A060" strokeWidth="0.6" strokeOpacity="0.25" />

        {/* Quadrant 1 — Wasl (chat) */}
        <g transform="translate(16 14)">
          <path d="M0 4.5C0 2.01 2.01 0 4.5 0h7C13.99 0 16 2.01 16 4.5v4c0 2.49-2.01 4.5-4.5 4.5H7l-4 3v-3H4.5C2.01 13 0 10.99 0 8.5v-4Z" fill="#1A4A5A" />
          <circle cx="5" cy="6.5" r="1" fill="#FDFCF9" />
          <circle cx="8" cy="6.5" r="1" fill="#FDFCF9" />
          <circle cx="11" cy="6.5" r="1" fill="#FDFCF9" />
        </g>

        {/* Quadrant 2 — Mashahd (play) */}
        <g transform="translate(36 16)">
          <rect x="0" y="0" width="16" height="12" rx="2.5" fill="#1A4A5A" />
          <path d="M6 3.5v5l4-2.5-4-2.5Z" fill="#FDFCF9" />
        </g>

        {/* Quadrant 3 — Lamahat (camera) */}
        <g transform="translate(16 36)">
          <rect x="0" y="2" width="16" height="11" rx="2.5" fill="#1A4A5A" />
          <rect x="4.5" y="0" width="5" height="2.5" rx="1" fill="#1A4A5A" />
          <circle cx="8" cy="7.5" r="3" fill="#FDFCF9" />
          <circle cx="8" cy="7.5" r="1.6" fill="#1A4A5A" />
          <circle cx="13" cy="4.5" r="0.8" fill="#C2A060" />
        </g>

        {/* Quadrant 4 — Midan (public square) */}
        <g transform="translate(36 36)">
          <rect x="0" y="0" width="16" height="12" rx="2" fill="#1A4A5A" />
          <rect x="2" y="2" width="5" height="5" rx="0.8" fill="#FDFCF9" />
          <rect x="9" y="2" width="5" height="5" rx="0.8" fill="#FDFCF9" opacity="0.6" />
          <rect x="2" y="9" width="12" height="1.6" rx="0.8" fill="#C2A060" />
        </g>
      </svg>
      {withWordmark && (
        <div className="flex flex-col leading-none">
          <span className="font-semibold tracking-tight text-primary">Cirkle</span>
          <span className="font-arabic text-[0.7em] text-muted-foreground -mt-0.5">دواير</span>
        </div>
      )}
    </div>
  );
}
