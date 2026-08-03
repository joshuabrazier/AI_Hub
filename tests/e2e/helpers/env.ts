import { readFileSync } from "node:fs";
import path from "node:path";

// -------------------------------------------------------------------
// .env access for E2E tests
//
// Playwright runs in a plain Node process and does NOT load .env the way
// Next.js does for the app. So values like NEXT_PUBLIC_APP_URL and
// DATABASE_URL are not available on process.env here - we read them from the
// .env file directly rather than hardcoding them in the tests or config.
// -------------------------------------------------------------------
export function readEnvVar(name: string): string {
  const value = readEnvVarOptional(name);

  if (value === undefined) {
    throw new Error(`${name} not found in .env`);
  }

  return value;
}

// -------------------------------------------------------------------
// Optional variant - returns undefined instead of throwing when the
// variable isn't set (for values that have a sensible default).
// -------------------------------------------------------------------
export function readEnvVarOptional(name: string): string | undefined {
  const env = readFileSync(path.resolve(process.cwd(), ".env"), "utf8");
  const line = env.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));

  if (!line) {
    return undefined;
  }

  return line.slice(`${name}=`.length).trim();
}
