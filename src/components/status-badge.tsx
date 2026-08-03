import { Badge } from "@/components/ui/badge";

// -------------------------------------------------------------------
// StatusBadge
// The active/inactive pill used in admin table "Status" columns. Kept
// in one place so every table renders the status identically.
// -------------------------------------------------------------------
export function StatusBadge({
  active,
  activeLabel = "Active",
  inactiveLabel = "Inactive",
}: {
  active: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
  return (
    <Badge variant={active ? "success" : "destructive"} className="w-20 justify-center">
      {active ? activeLabel : inactiveLabel}
    </Badge>
  );
}
