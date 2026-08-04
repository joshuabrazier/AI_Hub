"use client";

import { CheckboxPicker, type PickerOption } from "@/components/checkbox-picker";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  NOTIFICATION_AUDIENCE_LABELS,
  NOTIFICATION_AUDIENCE_TYPES,
  type NotificationAudienceType,
} from "@/lib/data/kysely-database-types";

import type { AudienceOptionDTO, NotificationAudienceDTO, NotificationAudienceOptionsDTO } from "../notifications.types";

// -------------------------------------------------------------------
// The composer's working copy of an audience.
//
// It keeps a selection per audience type rather than one shared list, so
// switching from teams to people and back does not silently discard what was
// already chosen - and so the value handed to the server is only ever the ids
// belonging to the type that is actually selected.
// -------------------------------------------------------------------
export type AudienceDraft = {
  audienceType: NotificationAudienceType;
  teamIds: Set<string>;
  userIds: Set<string>;
};

export function emptyAudienceDraft(audienceType: NotificationAudienceType): AudienceDraft {
  return {
    audienceType,
    teamIds: new Set(),
    userIds: new Set(),
  };
}

// Whether the draft names anybody. "Everyone" needs no ids; the rest need at
// least one, which is the same rule the schema enforces server-side.
export function isAudienceDraftComplete(draft: AudienceDraft): boolean {
  switch (draft.audienceType) {
    case NOTIFICATION_AUDIENCE_TYPES.EVERYONE:
      return true;
    case NOTIFICATION_AUDIENCE_TYPES.TEAMS:
      return draft.teamIds.size > 0;
    case NOTIFICATION_AUDIENCE_TYPES.USERS:
      return draft.userIds.size > 0;
  }
}

// -------------------------------------------------------------------
// Narrow the draft to the request the server accepts: the discriminated union
// carries only the ids for the chosen type, so nothing from another tab can
// travel with it.
// -------------------------------------------------------------------
export function toAudienceRequest(draft: AudienceDraft): NotificationAudienceDTO {
  switch (draft.audienceType) {
    case NOTIFICATION_AUDIENCE_TYPES.EVERYONE:
      return { audienceType: NOTIFICATION_AUDIENCE_TYPES.EVERYONE };
    case NOTIFICATION_AUDIENCE_TYPES.TEAMS:
      return { audienceType: NOTIFICATION_AUDIENCE_TYPES.TEAMS, teamIds: [...draft.teamIds] };
    case NOTIFICATION_AUDIENCE_TYPES.USERS:
      return { audienceType: NOTIFICATION_AUDIENCE_TYPES.USERS, userIds: [...draft.userIds] };
  }
}

function toPickerOptions(options: AudienceOptionDTO[]): PickerOption[] {
  return options.map((option) => ({ id: option.id, label: option.name, sublabel: option.subtitle }));
}

function toggleIn(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// -------------------------------------------------------------------
// AudiencePicker
//
// Choose who a notification goes to: everyone, whole teams, or named people.
//
// The lists it offers are already narrowed server-side to what the signed-in
// sender may address, and "Everyone" is absent entirely for a manager. None of
// that is the control though - the service re-derives the sender's scope and
// re-checks every id - so this component only has to be honest, not careful.
// -------------------------------------------------------------------
export function AudiencePicker({
  options,
  value,
  onChange,
  disabled,
}: {
  options: NotificationAudienceOptionsDTO;
  value: AudienceDraft;
  onChange: (next: AudienceDraft) => void;
  disabled?: boolean;
}) {
  const audienceTypes: NotificationAudienceType[] = [
    ...(options.canAddressEveryone ? [NOTIFICATION_AUDIENCE_TYPES.EVERYONE] : []),
    NOTIFICATION_AUDIENCE_TYPES.TEAMS,
    NOTIFICATION_AUDIENCE_TYPES.USERS,
  ];

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
      <div className="space-y-2">
        <Label htmlFor="composer-audience-type">Send to</Label>
        <Select
          value={value.audienceType}
          onValueChange={(next) => onChange({ ...value, audienceType: next as NotificationAudienceType })}
          disabled={disabled}
        >
          <SelectTrigger id="composer-audience-type" className="w-full bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {audienceTypes.map((audienceType) => (
              <SelectItem key={audienceType} value={audienceType}>
                {NOTIFICATION_AUDIENCE_LABELS[audienceType]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.audienceType === NOTIFICATION_AUDIENCE_TYPES.EVERYONE && (
        <p className="text-xs text-muted-foreground">
          Goes to every active member account, including people who are in no team.
        </p>
      )}

      {value.audienceType === NOTIFICATION_AUDIENCE_TYPES.TEAMS && (
        <div className="space-y-2" role="group" aria-labelledby="composer-teams-label">
          <Label id="composer-teams-label">Teams</Label>
          <CheckboxPicker
            idPrefix="audience-team"
            options={toPickerOptions(options.teams)}
            selected={value.teamIds}
            onToggle={(id) => onChange({ ...value, teamIds: toggleIn(value.teamIds, id) })}
            searchable={options.teams.length > 8}
            emptyMessage="No teams available to you."
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            Everybody in the chosen teams. Somebody in two of them still gets one message.
          </p>
        </div>
      )}

      {value.audienceType === NOTIFICATION_AUDIENCE_TYPES.USERS && (
        <div className="space-y-2" role="group" aria-labelledby="composer-users-label">
          <Label id="composer-users-label">People</Label>
          <CheckboxPicker
            idPrefix="audience-user"
            options={toPickerOptions(options.users)}
            selected={value.userIds}
            onToggle={(id) => onChange({ ...value, userIds: toggleIn(value.userIds, id) })}
            searchable
            emptyMessage="No people available to you."
            disabled={disabled}
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Anybody who has turned this notification type off in their settings is left out.
      </p>
    </div>
  );
}
