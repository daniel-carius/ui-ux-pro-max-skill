import { getSettings } from "@/infra/settings";

/** Home provisória da F0. O conteúdo real (SPEC 4.1) entra na F1. */
export default async function HomePage() {
  const settings = await getSettings();
  return (
    <main className="mx-auto max-w-screen-sm px-4 py-10">
      <h1 className="text-brand text-2xl font-bold">{settings?.brandName}</h1>
      <p className="text-muted mt-2">Plataforma em construção.</p>
    </main>
  );
}
