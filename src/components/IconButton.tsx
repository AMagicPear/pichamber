import type { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

export function IconButton({ label, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button type="button" className={clsx("icon-button", className)} title={label} aria-label={label} {...props}>{children}</button>;
}

