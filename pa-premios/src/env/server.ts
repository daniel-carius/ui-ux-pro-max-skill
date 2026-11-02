import "server-only";
import { parseServerEnv, type ServerEnv } from "./schema";

let cached: ServerEnv | undefined;

/** Lê e valida o ambiente uma única vez. Falha cedo se faltar algo. */
export function env(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
