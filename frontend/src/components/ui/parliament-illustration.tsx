"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface ParliamentIllustrationProps {
  variant?: "blueprint" | "outline" | "gold" | "tricolor";
  className?: string;
  showCaption?: boolean;
  captionTitle?: string;
  captionSubtitle?: string;
}

export function ParliamentIllustration({
  variant = "outline",
  className,
  showCaption = true,
  captionTitle = "संसद भवन · Parliament of India",
  captionSubtitle = "Apex Legislative Custodian of MPLADS Development Works",
}: ParliamentIllustrationProps) {
  const isBlueprint = variant === "blueprint";
  const isGold = variant === "gold";
  const isTricolor = variant === "tricolor";

  const strokeColor = isBlueprint
    ? "rgba(147, 197, 253, 0.85)" // blue-300
    : isGold
    ? "rgba(245, 158, 11, 0.9)" // amber-500
    : "rgba(71, 85, 105, 0.85)"; // slate-600

  const fillAccent = isBlueprint
    ? "rgba(30, 58, 138, 0.4)" // blue-900/40
    : isGold
    ? "rgba(254, 243, 199, 0.5)" // amber-100
    : "rgba(241, 245, 249, 0.6)"; // slate-100

  return (
    <div className={cn("relative flex flex-col items-center select-none", className)}>
      {/* ── Architectural SVG Drawing of Parliament of India (Sansad Bhavan) ── */}
      <div className="w-full max-w-xl relative">
        {/* Subtle Ambient Radial Glow for Blueprint & Gold modes */}
        {isBlueprint && (
          <div className="absolute inset-0 -top-6 bg-gradient-to-t from-blue-600/10 via-indigo-500/15 to-transparent blur-2xl rounded-full pointer-events-none" />
        )}
        {isTricolor && (
          <div className="absolute -top-10 inset-x-0 h-16 bg-gradient-to-r from-amber-500/10 via-blue-500/10 to-emerald-500/10 blur-xl rounded-full pointer-events-none" />
        )}

        <svg
          viewBox="0 0 800 420"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-auto drop-shadow-xs"
        >
          <defs>
            <linearGradient id="flagTricolor" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#FF9933" />
              <stop offset="50%" stopColor="#FFFFFF" />
              <stop offset="100%" stopColor="#138808" />
            </linearGradient>

            <linearGradient id="domeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={isBlueprint ? "#60A5FA" : isGold ? "#FBBF24" : "#94A3B8"} stopOpacity="0.4" />
              <stop offset="100%" stopColor={isBlueprint ? "#1E3A8A" : isGold ? "#D97706" : "#475569"} stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* ── 1. Sky & Celestial Grid Guides (Architectural Blueprint Style) ── */}
          {isBlueprint && (
            <g opacity="0.15" stroke="#93C5FD" strokeWidth="0.75" strokeDasharray="4 8">
              <line x1="50" y1="60" x2="750" y2="60" />
              <line x1="50" y1="120" x2="750" y2="120" />
              <line x1="50" y1="180" x2="750" y2="180" />
              <line x1="50" y1="240" x2="750" y2="240" />
              <circle cx="400" cy="190" r="140" />
              <circle cx="400" cy="190" r="220" />
            </g>
          )}

          {/* ── 2. The Central Grand Dome (Sansad Central Hall Dome) ── */}
          {/* Flagstaff & Indian Tricolor at the Apex */}
          <line x1="400" y1="35" x2="400" y2="85" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" />
          <path d="M400 38 L432 45 L400 52 Z" fill="url(#flagTricolor)" stroke={strokeColor} strokeWidth="0.75" />
          <circle cx="400" cy="35" r="3" fill={isGold ? "#F59E0B" : "#38BDF8"} />

          {/* Kalash / Spire Finial */}
          <path
            d="M394 85 C394 75 406 75 406 85 Z"
            fill={fillAccent}
            stroke={strokeColor}
            strokeWidth="1.75"
          />
          <rect x="388" y="85" width="24" height="6" rx="2" fill={fillAccent} stroke={strokeColor} strokeWidth="1.5" />

          {/* High Ribbed Dome Profile */}
          <path
            d="M310 185 C310 110 350 91 400 91 C450 91 490 110 490 185 Z"
            fill="url(#domeGrad)"
            stroke={strokeColor}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />

          {/* Vertical Rib Lines on the Dome */}
          <path d="M332 185 C336 130 365 102 400 91" stroke={strokeColor} strokeWidth="1.2" strokeOpacity="0.65" fill="none" />
          <path d="M468 185 C464 130 435 102 400 91" stroke={strokeColor} strokeWidth="1.2" strokeOpacity="0.65" fill="none" />
          <path d="M362 185 C366 142 382 108 400 91" stroke={strokeColor} strokeWidth="1.2" strokeOpacity="0.65" fill="none" />
          <path d="M438 185 C434 142 418 108 400 91" stroke={strokeColor} strokeWidth="1.2" strokeOpacity="0.65" fill="none" />
          <line x1="400" y1="91" x2="400" y2="185" stroke={strokeColor} strokeWidth="1.5" strokeOpacity="0.8" />

          {/* Dome Drum / Clerestory Ring with Arched Windows */}
          <rect x="300" y="185" width="200" height="24" rx="2" fill={fillAccent} stroke={strokeColor} strokeWidth="2" />
          {[320, 345, 370, 395, 420, 445, 470].map((x, i) => (
            <g key={`drum-win-${i}`}>
              <rect x={x} y="190" width="12" height="14" rx="3" stroke={strokeColor} strokeWidth="1.2" fill="none" />
              <line x1={x + 6} y1="190" x2={x + 6} y2="204" stroke={strokeColor} strokeWidth="0.8" strokeOpacity="0.7" />
            </g>
          ))}

          {/* ── 3. The Grand Upper Entablature & Parapet ── */}
          {/* Continuous upper cornice spanning the circular colonnade */}
          <rect x="70" y="209" width="660" height="8" rx="1.5" fill={fillAccent} stroke={strokeColor} strokeWidth="2" />
          <line x1="60" y1="217" x2="740" y2="217" stroke={strokeColor} strokeWidth="2.5" />
          <rect x="75" y="217" width="650" height="14" fill={fillAccent} stroke={strokeColor} strokeWidth="1.75" />

          {/* Frieze decorative medallions */}
          {Array.from({ length: 27 }).map((_, i) => (
            <circle
              key={`medallion-${i}`}
              cx={95 + i * 23.5}
              cy="224"
              r="2.5"
              fill="none"
              stroke={strokeColor}
              strokeWidth="0.9"
            />
          ))}

          {/* Lower Architrave Beam */}
          <rect x="70" y="231" width="660" height="6" fill={fillAccent} stroke={strokeColor} strokeWidth="1.75" />

          {/* ── 4. The 144 Iconic Pillars / Circular Colonnade ── */}
          {/* Render 28 representative front-elevation classical columns */}
          {Array.from({ length: 29 }).map((_, i) => {
            const cx = 88 + i * 22.3;
            return (
              <g key={`col-${i}`}>
                {/* Column Capital */}
                <path
                  d={`M${cx - 5} 237 L${cx + 5} 237 L${cx + 4} 242 L${cx - 4} 242 Z`}
                  stroke={strokeColor}
                  strokeWidth="1.2"
                  fill={fillAccent}
                />
                {/* Fluted Column Shaft */}
                <rect
                  x={cx - 3}
                  y="242"
                  width="6"
                  height="82"
                  stroke={strokeColor}
                  strokeWidth="1.2"
                  fill={fillAccent}
                />
                {/* Vertical fluting groove inside column */}
                <line x1={cx} y1="244" x2={cx} y2="322" stroke={strokeColor} strokeWidth="0.6" strokeOpacity="0.5" />
                {/* Column Base / Plinth */}
                <rect
                  x={cx - 5}
                  y="324"
                  width="10"
                  height="5"
                  rx="1"
                  stroke={strokeColor}
                  strokeWidth="1.2"
                  fill={fillAccent}
                />
              </g>
            );
          })}

          {/* Background Wall & Central Grand Entrance Archways behind columns */}
          <rect x="80" y="237" width="640" height="87" stroke={strokeColor} strokeWidth="0.75" strokeDasharray="3 4" opacity="0.3" fill="none" />
          {/* Grand Ceremonial Portico Entrance (Center Columns) */}
          <g>
            {/* Center Pediment Accent */}
            <path
              d="M370 209 L400 193 L430 209 Z"
              fill={fillAccent}
              stroke={strokeColor}
              strokeWidth="2"
            />
            {/* Ashoka Emblem Silhouette in center pediment */}
            <circle cx="400" cy="202" r="3.5" stroke={strokeColor} strokeWidth="1" fill="none" />

            {/* Main Entrance Archway */}
            <path
              d="M382 324 L382 278 C382 268 418 268 418 278 L418 324 Z"
              stroke={strokeColor}
              strokeWidth="2"
              fill={fillAccent}
            />
            <path
              d="M388 324 L388 284 C388 276 412 276 412 284 L412 324 Z"
              stroke={strokeColor}
              strokeWidth="1.2"
              fill="none"
              strokeDasharray="2 2"
            />
          </g>

          {/* ── 5. Continuous Lower Stylobate & Podium Terrace ── */}
          <rect x="55" y="329" width="690" height="9" rx="1.5" fill={fillAccent} stroke={strokeColor} strokeWidth="2.2" />
          <rect x="45" y="338" width="710" height="12" fill={fillAccent} stroke={strokeColor} strokeWidth="2.2" />

          {/* ── 6. Ceremonial Monumental Staircases & Base Plinth ── */}
          {/* Central Ceremonial Approach Steps */}
          <polygon
            points="320,380 480,380 495,350 305,350"
            fill={fillAccent}
            stroke={strokeColor}
            strokeWidth="1.5"
          />
          {/* Individual step lines */}
          <line x1="316" y1="356" x2="484" y2="356" stroke={strokeColor} strokeWidth="1.2" />
          <line x1="319" y1="362" x2="481" y2="362" stroke={strokeColor} strokeWidth="1.2" />
          <line x1="322" y1="368" x2="478" y2="368" stroke={strokeColor} strokeWidth="1.2" />
          <line x1="325" y1="374" x2="475" y2="374" stroke={strokeColor} strokeWidth="1.2" />

          {/* Monumental Ground Line */}
          <line x1="30" y1="380" x2="770" y2="380" stroke={strokeColor} strokeWidth="3" strokeLinecap="round" />
          <line x1="20" y1="385" x2="780" y2="385" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.6" />
          <line x1="40" y1="390" x2="760" y2="390" stroke={strokeColor} strokeWidth="0.8" strokeLinecap="round" strokeOpacity="0.4" />

          {/* Side Sentry Balustrades */}
          <rect x="55" y="350" width="235" height="24" rx="2" fill={fillAccent} stroke={strokeColor} strokeWidth="1.2" />
          <rect x="510" y="350" width="235" height="24" rx="2" fill={fillAccent} stroke={strokeColor} strokeWidth="1.2" />
          {/* Baluster slats */}
          {Array.from({ length: 9 }).map((_, i) => (
            <React.Fragment key={`bal-${i}`}>
              <line x1={75 + i * 24} y1="353" x2={75 + i * 24} y2="371" stroke={strokeColor} strokeWidth="1" strokeOpacity="0.7" />
              <line x1={530 + i * 24} y1="353" x2={530 + i * 24} y2="371" stroke={strokeColor} strokeWidth="1" strokeOpacity="0.7" />
            </React.Fragment>
          ))}
        </svg>
      </div>

      {/* ── Architectural Inscription & Reference Label ── */}
      {showCaption && (
        <div className="mt-3 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-200/80 bg-white/80 backdrop-blur-xs shadow-2xs">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span
              className={cn(
                "text-xs font-bold tracking-wide uppercase",
                isBlueprint ? "text-blue-200" : isGold ? "text-amber-800" : "text-slate-800"
              )}
            >
              {captionTitle}
            </span>
          </div>
          {captionSubtitle && (
            <p
              className={cn(
                "text-[11px] font-medium mt-1 max-w-sm tracking-tight",
                isBlueprint ? "text-blue-300/80" : isGold ? "text-amber-700/80" : "text-slate-500"
              )}
            >
              {captionSubtitle}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
