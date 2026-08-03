import { MESSAGES } from "@/lib/constants";

type CenteredPageErrorProps = {
  message?: string;
};

export function CenteredPageError({ message }: CenteredPageErrorProps) {
  return (
    <main className="flex min-h-[calc(100vh-5rem)] items-center justify-center">
      <p className="text-destructive text-4xl font-bold">{message ?? MESSAGES.SOMETHING_WENT_WRONG}</p>
    </main>
  );
}
