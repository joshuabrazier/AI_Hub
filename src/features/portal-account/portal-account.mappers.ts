import type { NotificationTypeRecord, User } from "@/lib/data/kysely-database-types";

import type { NotificationPreferenceOptionDTO, PortalAccountResponseDTO } from "./portal-account.types";

// -------------------------------------------------------------------
// Map an admin-managed notification type to the toggle the member sees.
// -------------------------------------------------------------------
export function mapDBNotificationTypeToPreferenceOptionDTO(
  notificationType: NotificationTypeRecord,
): NotificationPreferenceOptionDTO {
  return {
    key: notificationType.key,
    name: notificationType.name,
    description: notificationType.description,
  };
}

// -------------------------------------------------------------------
// Map the signed-in member's own user row to the account DTO.
//
// The nullable profile columns become empty strings because the form binds
// them to text inputs: a null there makes the input uncontrolled on first
// render and React then warns when the first keystroke arrives.
//
// Only the profile block crosses this boundary. Role, isActive, ban state and
// the auth columns stay on the server - none of them is editable here, so
// sending them would only invite a client to try.
// -------------------------------------------------------------------
export function mapDBUserToPortalAccountResponseDTO(
  user: User,
  notificationTypes: NotificationTypeRecord[],
): PortalAccountResponseDTO {
  return {
    name: user.name,
    preferredName: user.preferredName ?? "",
    email: user.email,
    phoneNumber: user.phoneNumber ?? "",
    notificationPreferences: user.notificationPreferences ?? {},
    notificationTypes: notificationTypes.map(mapDBNotificationTypeToPreferenceOptionDTO),
  };
}
