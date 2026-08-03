import { getActiveEnquiryCategoryOptionsService } from "@/features/admin-enquiry-categories/admin-enquiry-categories.service";
import PublicLayout from "@/features/landing/public-layout";

import { EnquiryForm } from "./enquiry-form";
import type { EnquiryCategoryOptionDTO } from "@/features/admin-enquiry-categories/admin-enquiry-categories.types";

export default async function ContactPage() {
  // Options for the category dropdown, admin-managed. Loaded here (a server
  // component) and passed into the form.
  //
  // Guarded so a database hiccup can never break the public enquiry page: the
  // category is optional on the schema too, so the form still submits without
  // a dropdown. Losing a lead over a lookup table would be the worse failure.
  let categoryOptions: EnquiryCategoryOptionDTO[] = [];
  try {
    categoryOptions = await getActiveEnquiryCategoryOptionsService();
  } catch {
    categoryOptions = [];
  }

  return (
    <PublicLayout title="Get in touch" subtitle="Send us a message and we'll come back to you.">
      <div className="mx-auto max-w-3xl">
        <EnquiryForm categoryOptions={categoryOptions} />
      </div>
    </PublicLayout>
  );
}
