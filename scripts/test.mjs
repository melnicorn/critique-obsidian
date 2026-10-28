// Bundles test/*.test.ts with esbuild (so extensionless TS imports resolve) and runs node --test.
import esbuild from "esbuild";
import { readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const out = ".test-build";
rmSync(out, { recursive: true, force: true });
const entries = readdirSync("test").filter((f) => f.endsWith(".test.ts")).map((f) => `test/${f}`);
await esbuild.build({ entryPoints: entries, bundle: true, format: "esm", platform: "node", outdir: out, outExtension: { ".js": ".mjs" }, logLevel: "error" });
const r = spawnSync(process.execPath, ["--test", ...readdirSync(out).map((f) => `${out}/${f}`)], { stdio: "inherit" });
process.exit(r.status ?? 1);
