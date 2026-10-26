import { Studio } from "@/components/Studio";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ course?: string; open?: string; sample?: string; new?: string }>;
}) {
  const params = await searchParams;
  const fresh = params.new === "1";
  const openKey = params.open || (fresh ? "new" : "") || params.course || params.sample || "studio";
  return <Studio key={openKey} courseId={params.course} sample={params.sample === "1"} fresh={fresh} />;
}
