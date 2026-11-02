import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // A camada de domínio é pura: não pode importar infraestrutura.
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/infra/*", "@prisma/*", "next/*"], message: "domain/ não importa I/O." }] },
      ],
    },
  },
];

export default config;
