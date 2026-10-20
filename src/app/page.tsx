import { Studio } from "@/components/Studio";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ course?: string; open?: string; sample?: string }>;
}) {
  const params = await searchParams;
  const openKey = params.open || params.course || params.sample || "studio";
  return <Studio key={openKey} courseId={params.course} sample={params.sample === "1"} />;
}
