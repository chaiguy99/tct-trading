import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function listRouteHandlers(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => listRouteHandlers(path.join(directory, entry.name))),
  );
  const routes = entries
    .filter((entry) => entry.isFile() && entry.name === "route.ts")
    .map((entry) => path.relative("src/app", path.join(directory, entry.name)));

  return [...routes, ...nested.flat()];
}

test("the API surface has no broker or exchange order-submission routes", async () => {
  const routes = (await listRouteHandlers("src/app/api")).sort();

  assert.deepEqual(routes, [
    "api/auth/[...nextauth]/route.ts",
    "api/journal/ask/route.ts",
    "api/journal/export/route.ts",
    "api/journal/settings/route.ts",
    "api/journal/trades/[id]/fills/route.ts",
    "api/journal/trades/import/route.ts",
    "api/journal/trades/route.ts",
    "api/market/bybit/route.ts",
  ]);
  assert.equal(routes.some((route) => /order/i.test(route)), false);
});
