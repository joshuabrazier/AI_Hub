import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";

// -------------------------------------------------------------------
// Resolve a form against a shared content schema.
//
// The content schemas mark their optional copy with `.default("")`, so zod's
// INPUT type has those fields optional while its OUTPUT type has them
// required. react-hook-form wants one shape for both. Every form here is
// seeded from already-parsed content and keeps all of its inputs mounted, so
// its values are always the OUTPUT shape - the form is typed on that and the
// resolver is narrowed to match.
//
// This is a typing bridge and nothing more: the schema passed in still does
// all of the validating, which is the point of reusing it rather than writing
// a second, looser set of rules for the editor.
// -------------------------------------------------------------------
export function schemaResolver<TValues extends FieldValues>(schema: z.ZodType<TValues>): Resolver<TValues> {
  return zodResolver(schema as z.ZodType<TValues, TValues>) as Resolver<TValues>;
}
