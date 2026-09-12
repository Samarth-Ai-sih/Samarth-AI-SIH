"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface SamarthLogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  showSubtitle?: boolean;
  subtitle?: string;
  href?: string;
  variant?: "light" | "dark";
  className?: string;
}

export function SamarthLogo({
  size = "md",
  showSubtitle = false,
  subtitle = "MPLADS Digital Governance",
  href,
  variant = "light",
  className,
}: SamarthLogoProps) {
  // Dimensions based on size
  const emblemSizes = {
    sm: "h-7 w-7",
    md: "h-9 w-9",
    lg: "h-11 w-11",
    xl: "h-14 w-14",
  };

  const textSizes = {
    sm: "text-base tracking-tight",
    md: "text-lg tracking-tight",
    lg: "text-xl tracking-tight",
    xl: "text-2xl tracking-tight",
  };

  const badgeSizes = {
    sm: "text-[10px] px-1.5 py-0.2 rounded-sm",
    md: "text-xs px-1.5 py-0.5 rounded",
    lg: "text-xs px-2 py-0.5 rounded-md",
    xl: "text-sm px-2.5 py-0.5 rounded-md",
  };

  const isDark = variant === "dark";

  const content = (
    <div className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      {/* ── Official Emblem / Insignia ── */}
      <div
        className={cn(
          "relative shrink-0 rounded-xl flex items-center justify-center shadow-xs transition-transform duration-200 group-hover:scale-105",
          emblemSizes[size],
          isDark
            ? "bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 border border-blue-500/30 shadow-blue-950/50"
            : "bg-gradient-to-br from-blue-700 via-indigo-700 to-blue-900 border border-blue-600/40 shadow-blue-900/20"
        )}
        aria-hidden="true"
      >
        {/* Tricolor Subtle Corner Accents (Saffron Top-Left, Green Bottom-Right) */}
        <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full bg-amber-500/80 blur-[0.5px]" />
        <div className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500/80 blur-[0.5px]" />

        {/* Vector Emblem: Ashoka Chakra / Neural AI Concentric Geometry + Stylized 'S' */}
        <svg
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full p-1.5 text-white"
        >
          {/* Outer Ring with 12 subtle spoke notches */}
          <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" strokeDasharray="2 3" />
          
          {/* Inner Chakra Geometry Ring */}
          <circle cx="24" cy="24" r="15" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.6" />
          
          {/* 8 Radial Directional Spokes (representing nation-wide governance oversight) */}
          <line x1="24" y1="9" x2="24" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.8" />
          <line x1="24" y1="35" x2="24" y2="39" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.8" />
          <line x1="9" y1="24" x2="13" y2="24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.8" />
          <line x1="35" y1="24" x2="39" y2="24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.8" />
          <line x1="13.5" y1="13.5" x2="16.5" y2="16.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.6" />
          <line x1="31.5" y1="31.5" x2="34.5" y2="34.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.6" />
          <line x1="34.5" y1="13.5" x2="31.5" y2="16.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.6" />
          <line x1="13.5" y1="34.5" x2="16.5" y2="31.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.6" />

          {/* Central Stylized 'S' Monogram & Core Node */}
          <path
            d="M27.5 18.5C27 17.5 25.8 17 24.2 17C21.8 17 20 18.3 20 20.2C20 23.4 28 22.8 28 26.6C28 28.8 26.1 30.5 23.5 30.5C21.2 30.5 19.8 29.5 19.2 28.2M22.5 17.5L25.5 17.5M21.5 30.5L25 30.5"
            stroke="#FFFFFF"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* AI Connectivity Sparkle Node */}
          <circle cx="28" cy="18" r="1.5" fill="#38BDF8" />
          <circle cx="20" cy="29" r="1.5" fill="#34D399" />
        </svg>
      </div>

      {/* ── Brand Typography ── */}
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5 leading-none">
          <span
            className={cn(
              "font-extrabold font-sans tracking-tight",
              textSizes[size],
              isDark ? "text-white" : "text-slate-950"
            )}
          >
            SAMARTH
          </span>
          <span
            className={cn(
              "font-black uppercase tracking-wider bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-2xs",
              badgeSizes[size]
            )}
          >
            AI
          </span>
        </div>

        {showSubtitle && (
          <span
            className={cn(
              "text-[10px] font-semibold tracking-wider uppercase mt-1 truncate",
              isDark ? "text-slate-400" : "text-slate-500"
            )}
          >
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="group inline-flex focus:outline-hidden">
        {content}
      </Link>
    );
  }

  return content;
}
