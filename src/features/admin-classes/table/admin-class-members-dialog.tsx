"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { AppDialog } from "@/components/app-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CheckboxPicker } from "@/components/checkbox-picker";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { addClassMembersAction, getClassMembershipAction, removeClassMemberAction } from "../admin-classes.actions";
import { ClassMembershipData } from "../admin-classes.types";

type Props = {
  classId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// -------------------------------------------------------------------
// Who is in a class. Rosters are users now, so this adds and removes people
// directly - there is no swimmer between a person and their place.
// -------------------------------------------------------------------
export function AdminClassMembersDialog({ classId, open, onOpenChange }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ClassMembershipData | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !classId) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch the class's membership when the dialog opens
    setLoading(true);
    setSelected(new Set());
    (async () => {
      const response = await getClassMembershipAction({ classId });
      if (!active) return;
      if (response.success) setData(response.data);
      else toast.error(response.formError ?? "Could not load who is in this class");
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [open, classId]);

  const refresh = async () => {
    if (!classId) return;
    const response = await getClassMembershipAction({ classId });
    if (response.success) setData(response.data);
  };

  const remaining = data ? data.capacity - data.members.length : 0;
  const atCapacity = remaining <= 0;
  const overRemaining = selected.size > remaining;

  const available = data?.assignable ?? [];

  const pickerEmptyMessage = loading
    ? "Loading…"
    : data?.teamName
      ? `Everyone in ${data.teamName} is already in this class.`
      : "No one available to add.";

  const toggleSelected = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    if (!classId || selected.size === 0 || overRemaining) return;
    startTransition(async () => {
      try {
        const response = await addClassMembersAction({ classId, userIds: Array.from(selected) });
        if (!response.success) {
          toast.error(response.formError ?? "Could not add them to the class");
          return;
        }
        toast.success(selected.size === 1 ? "Added to the class" : `${selected.size} people added`);
        setSelected(new Set());
        await refresh();
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  const handleRemove = (userId: string, name: string) => {
    if (!classId) return;
    startTransition(async () => {
      try {
        const response = await removeClassMemberAction({ classId, userId });
        if (!response.success) {
          toast.error(response.formError ?? "Could not remove them");
          return;
        }
        toast.success(`${name} removed`);
        await refresh();
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Who is in this class"
      description={data ? `${data.className} - ${data.members.length} / ${data.capacity}` : "Loading…"}
    >
      {/* Add people - searchable, multi-select */}
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Add people</Label>
          <span className="text-xs text-muted-foreground">
            {atCapacity ? "Class is full" : `${remaining} place${remaining === 1 ? "" : "s"} left`}
          </span>
        </div>

        {data && (
          <p className="text-xs text-muted-foreground">
            {data.teamName
              ? `Anyone in ${data.teamName} can be added to this class.`
              : "This class has no team, so anyone with a member account can be added."}
          </p>
        )}

        <CheckboxPicker
          idPrefix="class-member"
          options={available.map((user) => ({ id: user.id, label: user.name, sublabel: user.email }))}
          selected={selected}
          onToggle={toggleSelected}
          searchable
          emptyMessage={pickerEmptyMessage}
          disabled={isPending || atCapacity}
        />

        {overRemaining && (
          <p className="text-xs text-destructive">
            You selected {selected.size} but only {remaining} place{remaining === 1 ? "" : "s"} remain.
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {selected.size > 0 ? `${selected.size} selected` : "None selected"}
          </span>
          <Button
            type="button"
            onClick={handleAdd}
            loading={isPending}
            disabled={selected.size === 0 || isPending || atCapacity || overRemaining}
          >
            {selected.size > 1 ? `Add ${selected.size} people` : "Add to class"}
          </Button>
        </div>
      </div>

      {/* Current members */}
      <div className="grid gap-2">
        <Label>In this class ({data?.members.length ?? 0})</Label>
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
          {loading ? (
            <p className="p-2 text-sm text-muted-foreground">Loading…</p>
          ) : data && data.members.length > 0 ? (
            data.members.map((member) => (
              <div
                key={member.userId}
                className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{member.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${member.name}`}
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleRemove(member.userId, member.name)}
                  disabled={isPending}
                >
                  <X size={16} />
                </Button>
              </div>
            ))
          ) : (
            <p className="p-2 text-sm text-muted-foreground">Nobody in this class yet.</p>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </div>
    </AppDialog>
  );
}
