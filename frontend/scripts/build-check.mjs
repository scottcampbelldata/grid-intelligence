// Verify the production/static-export build without disturbing a running dev
// server. `next build` and `next dev` share a distDir (.next); building while
// dev is live rewrites those chunks and the browser then 404s on stale ones.
// This runs the same build into an isolated distDir (.next-check) instead, so
// it's safe to run anytime - including while `npm run dev` is up.
//
// (The static export still writes to ./out, which the dev server never serves,
// so that's harmless to regenerate.)
import { spawnSync } from "node:child_process";
import path from "node:path";

const nextBin = path.join("node_modules", "next", "dist", "bin", "next");

const result = spawnSync(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_DIST_DIR: ".next-check" },
});

process.exit(result.status ?? 1);
