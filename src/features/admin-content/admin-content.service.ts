import "server-only";

import { revalidatePath } from "next/cache";

import { contactDetailsSchema, parseContactDetails } from "@/features/site-content/contact-content";
import { SITE_CONTENT_DEFAULTS } from "@/features/site-content/site-content-defaults";
import { getLandingContent } from "@/features/site-content/site-content.service";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { SITE_CONTENT_KEYS, SiteContentKey, USER_ROLES } from "@/lib/data/kysely-database-types";
import {
  getSiteContentByKeysRepo,
  updateSiteContentByKeyRepo,
} from "@/lib/data/repositories/site-content.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { sanitizeRichText } from "@/lib/sanitize-rich-text";

import {
  ContactDetailsResponseDTO,
  isLandingContentKey,
  LANDING_CONTENT_KEYS,
  LandingContentResponseDTO,
  RICH_TEXT_CONTENT_KEYS,
  RichTextContentKey,
  SiteContentEditorDTO,
  SiteContentResponseDTO,
  STRUCTURED_CONTENT_KEYS,
  UpdateContactDetailsRequestDTO,
  UpdateLandingBlockRequestDTO,
  UpdateSiteContentRequestDTO,
} from "./admin-content.types";

// Shown when a write reports no row back. Vague on purpose: the admin only
// needs to know their change is not stored, and the cause is in the log.
const SAVE_FAILED_MESSAGE = "That change could not be saved. Please try again.";

// Public route each rich-text key drives - used to revalidate the live page
// after an edit so changes appear immediately. Keyed on RichTextContentKey
// because its only reader is the rich-text save; the JSON keys revalidate their
// own routes directly. Not every rich-text key has a public page (the media
// consent is a signed document, resolved live), so this is partial.
const KEY_TO_PUBLIC_ROUTE: Partial<Record<RichTextContentKey, string>> = {
  [SITE_CONTENT_KEYS.ABOUT]: ROUTES.PUBLIC_ABOUT,
  [SITE_CONTENT_KEYS.PRIVACY_POLICY]: ROUTES.PUBLIC_PRIVACY_POLICY,
  [SITE_CONTENT_KEYS.TERMS_AND_CONDITIONS]: ROUTES.PUBLIC_TERMS_AND_CONDITIONS,
};

// The keys the Site Content screen owns: the rich-text pages plus the
// structured contact block. Both sets are derived (see admin-content.types.ts)
// so a key added later cannot end up with no editor at all - which is how the
// contact address, where public enquiries land, became changeable only by
// direct SQL. The landing_* blocks are excluded because the Home page screen
// owns them, and reading them here would fetch JSON this screen never uses.
const SITE_CONTENT_SCREEN_KEYS: SiteContentKey[] = [...RICH_TEXT_CONTENT_KEYS, ...STRUCTURED_CONTENT_KEYS];

// -------------------------------------------------------------------
// Was the stored contact row thrown away on read?
//
// parseContactDetails is deliberately forgiving - it substitutes the default
// field by field so the public page still renders - which means a corrupt row
// looks exactly like a healthy one from the outside, including the address
// public enquiries are delivered to. Checking the raw value against the full
// schema is how the editor can tell the admin their saved value is not the one
// in use, the same way the landing blocks report `invalidKeys`.
//
// An absent or empty value is NOT ignored: that is a key with no row yet, which
// the editor already shows as "Not yet edited".
// -------------------------------------------------------------------
function contactValueWasIgnored(rawValue: string | undefined): boolean {
  if (!rawValue?.trim()) return false;

  try {
    return !contactDetailsSchema.safeParse(JSON.parse(rawValue)).success;
  } catch {
    return true;
  }
}

// -------------------------------------------------------------------
// Everything the Site Content screen edits. Builds an entry for every key it
// owns (not only keys that already have a saved row), so a newly-added key
// appears with its default before its first save.
// -------------------------------------------------------------------
export async function getSiteContentService(): Promise<SiteContentEditorDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const rows = await getSiteContentByKeysRepo(SITE_CONTENT_SCREEN_KEYS);
    const rowByKey = new Map(rows.map((row) => [row.contentName, row]));

    const pages = RICH_TEXT_CONTENT_KEYS.map((key) => {
      const row = rowByKey.get(key);
      return {
        contentName: key,
        // Pre-fill with the default copy when nothing is saved yet.
        contentValue: row?.contentValue?.trim() ? row.contentValue : SITE_CONTENT_DEFAULTS[key],
        // Empty when never saved - the editor shows "Not yet edited".
        updatedAt: row ? row.updatedAt.toISOString() : "",
      } satisfies SiteContentResponseDTO;
    });

    const contactRow = rowByKey.get(SITE_CONTENT_KEYS.CONTACT);
    const contactValue = contactRow?.contentValue?.trim()
      ? contactRow.contentValue
      : SITE_CONTENT_DEFAULTS[SITE_CONTENT_KEYS.CONTACT];

    const contact = {
      details: parseContactDetails(contactValue),
      updatedAt: contactRow ? contactRow.updatedAt.toISOString() : "",
      isIgnored: contactValueWasIgnored(contactRow?.contentValue),
    } satisfies ContactDetailsResponseDTO;

    return { pages, contact };
  } catch (error) {
    throw handleError("getSiteContentService", error);
  }
}

// -------------------------------------------------------------------
// Update a single rich-text page.
//
// Returns the STORED page, not the submitted one: sanitising happens on write,
// so these can differ, and the editor needs the stored text as its baseline to
// be honest about what is saved.
// -------------------------------------------------------------------
export async function updateSiteContentService(
  requestDTO: UpdateSiteContentRequestDTO,
): Promise<SiteContentResponseDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    // Sanitised on the way IN as well as on render. What arrives is HTML built
    // in a browser we do not control, and storing it clean means every later
    // reader of the row - emails, signed-document snapshots - is safe too, not
    // just the components that remember to sanitise.
    const row = await updateSiteContentByKeyRepo(requestDTO.contentName, sanitizeRichText(requestDTO.contentValue));

    // No row back means nothing was written. Say so - reporting success here
    // would clear the editor's unsaved-changes flag over an edit that is gone.
    if (!row) throw new DisplayErrorMessage(SAVE_FAILED_MESSAGE);

    revalidatePath(ROUTES.ADMIN_CONTENT);
    // Only some keys drive a public page (the media consent doesn't).
    const publicRoute = KEY_TO_PUBLIC_ROUTE[requestDTO.contentName];
    if (publicRoute) revalidatePath(publicRoute);

    return {
      // The key is taken from the validated request rather than the row so it
      // stays narrowed to the rich-text keys the editor renders.
      contentName: requestDTO.contentName,
      contentValue: row.contentValue,
      updatedAt: row.updatedAt.toISOString(),
    } satisfies SiteContentResponseDTO;
  } catch (error) {
    throw handleError("updateSiteContentService", error);
  }
}

// -------------------------------------------------------------------
// Update the structured contact details.
//
// The email here is the delivery address for public enquiries, so it is stored
// only after passing the same schema the enquiry service parses it back with.
// -------------------------------------------------------------------
export async function updateContactDetailsService(
  requestDTO: UpdateContactDetailsRequestDTO,
): Promise<SiteContentKey> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const row = await updateSiteContentByKeyRepo(SITE_CONTENT_KEYS.CONTACT, JSON.stringify(requestDTO));

    // Nothing written. The address public enquiries are delivered to is the
    // last thing to report as saved when it is not.
    if (!row) throw new DisplayErrorMessage(SAVE_FAILED_MESSAGE);

    revalidatePath(ROUTES.ADMIN_CONTENT);
    revalidatePath(ROUTES.PUBLIC_CONTACT);

    return row.contentName;
  } catch (error) {
    throw handleError("updateContactDetailsService", error);
  }
}

// -------------------------------------------------------------------
// Everything the Home page screen edits.
//
// Reads through the SAME parser the public page uses, so the editor is filled
// with exactly what a visitor is being shown. `invalidKeys` carries the blocks
// whose stored value failed validation and fell back to the shipped default -
// the editor surfaces that, because otherwise an admin sees their own saved
// text nowhere on the site and has no way to find out why.
// -------------------------------------------------------------------
export async function getLandingContentService(): Promise<LandingContentResponseDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const { hero, highlights, features, cta, invalidKeys } = await getLandingContent();

    return {
      hero,
      highlights,
      features,
      cta,
      // Narrowed to the keys this screen can actually fix.
      invalidKeys: invalidKeys.filter(isLandingContentKey),
    };
  } catch (error) {
    throw handleError("getLandingContentService", error);
  }
}

// -------------------------------------------------------------------
// Update one home page block.
//
// The value has already been through the block's own schema, so what is stored
// is renderable by construction. Both the editor and the public page are
// revalidated: without the second one an admin saves, looks at the site and
// still sees the old copy.
// -------------------------------------------------------------------
export async function updateLandingBlockService(
  requestDTO: UpdateLandingBlockRequestDTO,
): Promise<SiteContentKey> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    // Defensive: the schema already constrains this, but the write must never
    // be able to reach a non-landing key with a JSON payload. Refusing loudly,
    // because a block the admin was told was saved and was not is worse than an
    // error they can act on.
    if (!LANDING_CONTENT_KEYS.includes(requestDTO.contentName)) {
      throw new DisplayErrorMessage(SAVE_FAILED_MESSAGE);
    }

    const row = await updateSiteContentByKeyRepo(requestDTO.contentName, JSON.stringify(requestDTO.value));

    // No row back means nothing was written.
    if (!row) throw new DisplayErrorMessage(SAVE_FAILED_MESSAGE);

    revalidatePath(ROUTES.ADMIN_HOME_PAGE);
    revalidatePath(ROUTES.PUBLIC_HOME);

    return row.contentName;
  } catch (error) {
    throw handleError("updateLandingBlockService", error);
  }
}
