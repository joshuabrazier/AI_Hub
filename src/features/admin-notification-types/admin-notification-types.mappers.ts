import { NotificationTypeRecord } from "@/lib/data/kysely-database-types";
import { NotificationTypeResponseDTO } from "./admin-notification-types.types";

export function mapDBNotificationTypeToResponseDTO(record: NotificationTypeRecord): NotificationTypeResponseDTO {
  return {
    id: record.id,
    key: record.key,
    name: record.name,
    description: record.description,
    isActive: record.isActive,
    orderBy: record.orderBy,
  };
}
