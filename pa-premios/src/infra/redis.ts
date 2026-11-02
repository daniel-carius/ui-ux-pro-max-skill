import "server-only";
import { Redis } from "@upstash/redis";
import { env } from "@/env/server";

let client: Redis | undefined;

export function redis(): Redis {
  client ??= new Redis({ url: env().UPSTASH_REDIS_REST_URL, token: env().UPSTASH_REDIS_REST_TOKEN });
  return client;
}
