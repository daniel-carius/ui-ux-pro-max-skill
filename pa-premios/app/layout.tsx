import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import "./globals.css";
import { env } from "@/env/server";
import { showStagingBanner } from "@/domain/app-env";
import { getSettings } from "@/infra/settings";
import { LegalFooter } from "@/ui/components/legal-footer";
import { StagingBanner } from "@/ui/components/staging-banner";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: settings?.brandName ?? "",
    robots: env().APP_ENV === "production" ? undefined : { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const settings = await getSettings();
  const style = {
    "--brand-primary": settings?.primaryColor,
    "--brand-secondary": settings?.secondaryColor,
  } as CSSProperties;

  return (
    <html lang="pt-BR" style={style}>
      <body className="flex min-h-dvh flex-col antialiased">
        {showStagingBanner(env().APP_ENV) && <StagingBanner />}
        <div className="flex-1">{children}</div>
        {settings && (
          <LegalFooter
            brandName={settings.brandName}
            legalName={settings.legalName}
            cnpj={settings.cnpj}
            address={settings.address}
            sacEmail={settings.sacEmail}
            dpoName={settings.dpoName}
            dpoEmail={settings.dpoEmail}
          />
        )}
      </body>
    </html>
  );
}
