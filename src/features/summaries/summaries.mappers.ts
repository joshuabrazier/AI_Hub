import type { TextSummary } from "@/lib/data/kysely-database-types";
import type { TextSummaryListRow } from "@/lib/data/repositories/text-summaries.repository";

import type { SavedSummaryDetailDTO, SavedSummaryDTO } from "./summaries.types";

// -------------------------------------------------------------------
// Row to DTO.
//
// TWO MAPPERS RATHER THAN ONE, and the split is the point: the list mapper
// takes a row that CANNOT carry `sourceText` or `summary`, because the list
// query does not select them. A single mapper over the full row would
// compile against a list row only if those columns were optional, and then
// nothing would stop a list query quietly starting to fetch 400,000
// characters per row.
//
// `title` is the person's own pasted material, so it is untrusted text and
// renders as a text node - never as markup.
// -------------------------------------------------------------------
export function mapDBTextSummaryToListDTO(row: TextSummaryListRow): SavedSummaryDTO {
  return {
    id: row.id,
    title: row.title,
    style: row.style,
    inputChars: row.inputChars,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export function mapDBTextSummaryToDetailDTO(row: TextSummary): SavedSummaryDetailDTO {
  return {
    ...mapDBTextSummaryToListDTO(row),
    sourceText: row.sourceText,
    summary: row.summary,
  };
}
