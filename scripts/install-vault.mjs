// Copies the built plugin (from dist/) into a vault: node scripts/install-vault.mjs "/path/to/vault"
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const vault = process.argv[2];
if (!vault || !existsSync(join(vault, ".obsidian"))) {
  console.error("Usage: node scripts/install-vault.mjs <vault path containing .obsidian>");
  process.exit(1);
}
const dest = join(vault, ".obsidian", "plugins", "critique");
mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) cpSync(join("dist", f), join(dest, f));
console.log("Installed to", dest);
