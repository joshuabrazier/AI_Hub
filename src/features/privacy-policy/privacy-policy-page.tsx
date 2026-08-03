import PublicLayout from "@/features/landing/public-layout";
import RichText from "@/components/content/rich-text";
import { getPageContent } from "@/features/site-content/site-content.service";
import { SITE_CONTENT_KEYS } from "@/lib/data/kysely-database-types";

export default async function PrivacyPolicyPage() {
  const content = await getPageContent(SITE_CONTENT_KEYS.PRIVACY_POLICY);

  return (
    <PublicLayout title="Privacy Policy">
      <div className="mx-auto max-w-5xl">
        <RichText html={content} />
      </div>
    </PublicLayout>
  );
}
