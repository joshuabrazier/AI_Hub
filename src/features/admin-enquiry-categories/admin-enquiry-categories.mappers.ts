import { EnquiryCategory } from "@/lib/data/kysely-database-types";

import { EnquiryCategoryResponseDTO } from "./admin-enquiry-categories.types";

// -------------------------------------------------------------------
// Map DB EnquiryCategory to EnquiryCategoryResponseDTO
// -------------------------------------------------------------------
export function mapDBEnquiryCategoryToResponseDTO(enquiryCategory: EnquiryCategory): EnquiryCategoryResponseDTO {
  return {
    id: enquiryCategory.id,
    name: enquiryCategory.name,
    isActive: enquiryCategory.isActive,
    orderBy: enquiryCategory.orderBy,
  };
}
