import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { EnquiryCategory, NewEnquiryCategory, UpdateEnquiryCategory } from "../kysely-database-types";

// -------------------------------------------------------------------
// Get all enquiry categories (any status), ordered for display.
//
// orderBy is not unique, so name breaks ties - otherwise categories sharing a
// position would shuffle between renders of the admin table.
// -------------------------------------------------------------------
export async function getAllEnquiryCategoriesRepo(): Promise<EnquiryCategory[]> {
  try {
    return await database.selectFrom("enquiryCategories").selectAll().orderBy("orderBy").orderBy("name").execute();
  } catch (error) {
    throw handleError("getAllEnquiryCategoriesRepo", error);
  }
}

// -------------------------------------------------------------------
// Get active enquiry categories only (what the public enquiry form shows).
// -------------------------------------------------------------------
export async function getActiveEnquiryCategoriesRepo(): Promise<EnquiryCategory[]> {
  try {
    return await database
      .selectFrom("enquiryCategories")
      .where("isActive", "=", true)
      .selectAll()
      .orderBy("orderBy")
      .orderBy("name")
      .execute();
  } catch (error) {
    throw handleError("getActiveEnquiryCategoriesRepo", error);
  }
}

// -------------------------------------------------------------------
// Update an enquiry category. Deactivating is how a category is retired -
// there is no delete, so past enquiries keep referring to a name that existed.
// -------------------------------------------------------------------
export async function updateEnquiryCategoryRepo(
  id: string,
  updateEnquiryCategory: UpdateEnquiryCategory,
  db: DBClient = database,
): Promise<EnquiryCategory | undefined> {
  try {
    return await db
      .updateTable("enquiryCategories")
      .set(updateEnquiryCategory)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateEnquiryCategoryRepo", error);
  }
}

// -------------------------------------------------------------------
// Create an enquiry category.
// -------------------------------------------------------------------
export async function createEnquiryCategoryRepo(
  newEnquiryCategory: NewEnquiryCategory,
  db: DBClient = database,
): Promise<EnquiryCategory> {
  try {
    return await db
      .insertInto("enquiryCategories")
      .values(newEnquiryCategory)
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("createEnquiryCategoryRepo", error);
  }
}
