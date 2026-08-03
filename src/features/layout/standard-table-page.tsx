import { ServerApiResponse } from "@/lib/types";
import { CenteredPageError } from "./centered-page-error";

type StandardTablePageProps<T> = {
  response: ServerApiResponse<T>;
  children: (data: T) => React.ReactNode;
};

export function StandardTablePage<T>({ response, children }: StandardTablePageProps<T>) {
  if (!response.success) {
    return <CenteredPageError message={response.formError} />;
  }

  return children(response.data);
}
