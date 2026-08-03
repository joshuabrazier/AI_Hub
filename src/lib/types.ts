// -------------------------------------------------------------------
// Server API response
// -------------------------------------------------------------------
export type ServerApiResponse<T> =
  | {
      success: true;
      data: T;
      formError?: never;
      fieldErrors?: never;
    }
  | {
      success: false;
      data?: never;
      fieldErrors?: Record<string, string[]>;
      formError?: string;
    };
