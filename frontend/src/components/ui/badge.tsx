import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", { variants: { variant: { neutral: "border-slate-200 bg-slate-50 text-slate-700", info: "border-blue-200 bg-blue-50 text-blue-800", success: "border-emerald-200 bg-emerald-50 text-emerald-800", warning: "border-amber-200 bg-amber-50 text-amber-900", danger: "border-red-200 bg-red-50 text-red-800", secondary: "border-slate-200 bg-slate-100 text-slate-600", outline: "border-slate-300 bg-white text-slate-700" } }, defaultVariants: { variant: "neutral" } });
export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) { return <span className={cn(badgeVariants({ variant }), className)} {...props} />; }
