import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const docsDir = path.join(root, "docs");
const output = path.join(root, "public", "docs-manifest.json");
const files = (await readdir(docsDir)).filter((file) => file.endsWith(".md"));
const entries = [];
for (const fileName of files) {
  const markdown = await readFile(path.join(docsDir, fileName), "utf8");
  if (!markdown.startsWith("---\n") || !markdown.includes("\n---")) throw new Error(`Frontmatter faltante en ${fileName}`);
  const frontmatter = markdown.slice(4, markdown.indexOf("\n---", 4));
  const values = Object.fromEntries(frontmatter.split("\n").map((line) => line.split(/:(.*)/s)).filter((parts) => parts.length === 2).map(([key, value]) => [key.trim(), value.trim().replace(/^['"]|['"]$/g, "")]));
  const slug = fileName.replace(/\.md$/i, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  entries.push({ slug, title: values.title || fileName, description: values.description || "", category: values.category || "Referencia", order: Number(values.order || 999), fileName });
}
entries.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
console.log(`Documentación validada: ${entries.length} archivos`);
