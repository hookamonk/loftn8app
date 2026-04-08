import { redirect } from "next/navigation";

export default function Home({
  searchParams,
}: {
  searchParams: { table?: string };
}) {
  const t = (searchParams.table ?? "").trim();

  if (t) redirect(`/t/${encodeURIComponent(t)}`);

  redirect("/auth");
}
