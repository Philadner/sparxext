import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const entry = process.env.EXT_ENTRY || "content";
const isLastEntry = process.env.EXT_LAST_ENTRY === "1";
const shouldClean = process.env.EXT_CLEAN === "1";

function copyExtensionStatic(): Plugin {
  return {
    name: "copy-extension-static",
    closeBundle() {
      if (!isLastEntry) return;

      const outDir = resolve("dist");
      mkdirSync(outDir, { recursive: true });

      const manifest = JSON.parse(readFileSync(resolve("manifest.json"), "utf8"));
      manifest.content_scripts = manifest.content_scripts.map((script: any) => ({
        ...script,
        run_at: "document_start",
        js: ["content.js"],
        css: ["content.css"]
      }));
      manifest.background = { scripts: ["background.js"] };
      manifest.browser_action = {
        ...manifest.browser_action,
        default_popup: "popup.html"
      };
      writeFileSync(resolve(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

      for (const [from, to] of [
        ["src/content.css", "content.css"],
        ["src/popup.css", "popup.css"],
        ["src/popup.html", "popup.html"]
      ] as const) {
        const target = resolve(outDir, to);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(resolve(from), target);
      }
    }
  };
}

export default defineConfig(({ mode }) => ({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    minify: mode === "production",
    sourcemap: true,
    rollupOptions: {
      input: resolve(`src/${entry}.ts`),
      output: {
        entryFileNames: `${entry}.js`,
        format: "iife",
        inlineDynamicImports: true
      }
    }
  },
  plugins: [
    {
      name: "clean-dist",
      buildStart() {
        if (shouldClean) rmSync(resolve("dist"), { recursive: true, force: true });
      }
    },
    copyExtensionStatic()
  ]
}));
