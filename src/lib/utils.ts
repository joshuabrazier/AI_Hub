import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// -----------------------------------------------------------------
// Class name utility (clsx + tailwind-merge)
// Combines conditional class joining with Tailwind conflict resolution
// -----------------------------------------------------------------
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
