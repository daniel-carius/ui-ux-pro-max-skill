/**
 * Seed (SPEC 16). Na F0 só existe a tabela settings; owner, modalidade, campanha exemplo
 * e regulamento modelo entram junto com os respectivos modelos (F1/F2).
 * Roda como dono do schema (DIRECT_URL). Idempotente.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

export const defaultSettings = {
  brandName: "P.A PRÊMIOS",
  primaryColor: "#0B5FFF",
  secondaryColor: "#FFB800",
  supportWhatsapp: "5598981729418",
  supportMessage: "Olá! Preciso de ajuda com minha compra na {brand_name}",
  timezone: "America/Fortaleza",
  showAuthorizationBadge: false,
  authorizedState: "MA", // confirmar com o termo de autorização
  territorialRule: "PHYSICAL_LOCATION",
  geoEnforcement: true,
  antiScamEnabled: true,
  antiScamText: "Nunca pedimos PIX, senha ou código para liberar prêmio. Único canal oficial: {support}.",
} as const;

async function main() {
  await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1, ...defaultSettings },
    update: {}, // nunca sobrescreve o que foi editado no admin
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
