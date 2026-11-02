import "server-only";
import { cache } from "react";
import { db } from "./db";

/** Linha única de configurações globais (SPEC 3). Nunca hardcode texto de marca. */
export const getSettings = cache(async () => db.settings.findUnique({ where: { id: 1 } }));
