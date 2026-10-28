import { build } from "vite";

const entries = ["content", "background", "popup"];
const watch = process.argv.includes("--watch");

for (const [index, entry] of entries.entries()) {
  process.env.EXT_ENTRY = entry;
  process.env.EXT_CLEAN = index === 0 ? "1" : "0";
  process.env.EXT_LAST_ENTRY = index === entries.length - 1 ? "1" : "0";

  await build({
    mode: watch ? "development" : "production",
    build: watch ? { watch: {} } : undefined
  });
}
