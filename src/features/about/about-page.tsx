import RichText from "@/components/content/rich-text";
import PublicLayout from "@/features/landing/public-layout";
import { getPageContent } from "@/features/site-content/site-content.service";
import { SITE_CONTENT_KEYS } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// About
//
// The whole page is admin-editable rich text from site_content, with no
// hardcoded copy. An earlier version carried a fixed "our values" grid in
// code, which meant half the page could not be changed without a deploy - and
// it is exactly the half a new project would want to change first.
//
// The page is dynamic so an edit appears immediately.
// -------------------------------------------------------------------
export default async function AboutPage() {
  const content = await getPageContent(SITE_CONTENT_KEYS.ABOUT);

  return (
    <PublicLayout title="About">
      <div className="max-w-3xl">
        <RichText html={content} />
      </div>
    </PublicLayout>
  );
}
