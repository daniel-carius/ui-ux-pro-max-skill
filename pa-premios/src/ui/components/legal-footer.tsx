import { RESPONSIBLE_PLAY_NOTICE } from "@/ui/copy";

type LegalFooterProps = {
  brandName: string;
  legalName: string | null;
  cnpj: string | null;
  address: string | null;
  sacEmail: string | null;
  dpoName: string | null;
  dpoEmail: string | null;
};

/** Rodapé legal de TODAS as páginas (SPEC 3). Campos vazios são omitidos fora de production. */
export function LegalFooter(props: LegalFooterProps) {
  const lines = [
    props.legalName && props.cnpj ? `${props.legalName} — CNPJ ${props.cnpj}` : props.legalName,
    props.address,
    props.sacEmail ? `SAC: ${props.sacEmail}` : null,
    props.dpoName || props.dpoEmail
      ? `Encarregado LGPD: ${[props.dpoName, props.dpoEmail].filter(Boolean).join(" — ")}`
      : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <footer className="text-muted mt-auto border-t border-slate-200 px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-sm">
      <p className="text-foreground font-semibold">{props.brandName}</p>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <p className="text-foreground mt-3 font-semibold">{RESPONSIBLE_PLAY_NOTICE}</p>
    </footer>
  );
}
