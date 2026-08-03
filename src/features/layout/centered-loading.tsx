import CenteredLayout from "./centered-layout";

export default function CenteredLoading() {
  return (
    <CenteredLayout>
      <div className="h-14 w-14 animate-spin rounded-full border-6 border-primary border-t-transparent" />
    </CenteredLayout>
  );
}
