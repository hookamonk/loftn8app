import { redirect } from "next/navigation";

export default function Home({
  searchParams,
}: {
  searchParams: { table?: string };
}) {
  const t = (searchParams.table ?? "").trim();

  // пришли по QR: /?table=T12
  if (t) redirect(`/t/${encodeURIComponent(t)}`);

  // обычный заход на домен -> регистрация/вход
  redirect("/auth");
} 