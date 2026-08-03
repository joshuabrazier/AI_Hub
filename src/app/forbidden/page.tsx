import type { Metadata } from "next";

import ForbiddenPage from "@/features/forbidden/forbidden-page";

export const metadata: Metadata = {
  title: "Access denied",
  // This page is only ever reached by a failed authorization check, so there is
  // nothing here worth indexing.
  robots: { index: false, follow: false },
};

export default function Forbidden() {
  return <ForbiddenPage />;
}
