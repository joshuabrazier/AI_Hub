// -------------------------------------------------------------------
// Helpers for recording what actually changed in a mutation, so the audit
// trail can show "before -> after". Only fields whose value changed are kept.
//
// Everything here renders values as PLAIN TEXT and is stored unencrypted, so
// only pass fields that are safe to read back in the admin activity viewer
// (names, roles, flags). For anything sensitive, record which field changed
// and not its value - see RecordAuditEventInput.changes.
// -------------------------------------------------------------------

export type AuditFieldChange = { field: string; label: string; from: string; to: string };

// Render any scalar as display text: booleans as Yes/No, null/undefined as "".
function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

// Keep only the fields whose value actually changed, as { label, from, to }.
export function diffFields(
  specs: Array<{ field: string; label: string; from: unknown; to: unknown }>,
): AuditFieldChange[] {
  const changes: AuditFieldChange[] = [];
  for (const spec of specs) {
    const from = toText(spec.from);
    const to = toText(spec.to);
    if (from !== to) changes.push({ field: spec.field, label: spec.label, from, to });
  }
  return changes;
}
