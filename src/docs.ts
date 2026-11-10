import { promises as fs } from "node:fs";
import path from "node:path";

export interface DocEntry {
  slug: string;
  title: string;
  description: string;
  category: string;
  order: number;
  fileName: string;
}

const docsDir = path.resolve(process.env.DOCS_PATH || path.join(process.cwd(), "docs"));
const safeSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");

function parseFrontmatter(markdown: string, fileName: string): DocEntry {
  const lines = markdown.startsWith("---\n") ? markdown.slice(4, markdown.indexOf("\n---", 4)).split("\n") : [];
  const values = new Map<string, string>();
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index > -1) values.set(line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ""));
  }
  return {
    slug: safeSlug(fileName.replace(/\.md$/i, "")),
    title: values.get("title") || fileName.replace(/\.md$/i, ""),
    description: values.get("description") || "Guía de Souls In Xtinction.",
    category: values.get("category") || "Referencia",
    order: Number(values.get("order") || 999),
    fileName,
  };
}

export async function listDocs(): Promise<DocEntry[]> {
  const names = await fs.readdir(docsDir).catch(() => [] as string[]);
  const entries = await Promise.all(names.filter((name) => name.toLowerCase().endsWith(".md")).map(async (fileName) => parseFrontmatter(await fs.readFile(path.join(docsDir, fileName), "utf8"), fileName)));
  return entries.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export async function readDoc(slug: string) {
  const docs = await listDocs();
  const entry = docs.find((item) => item.slug === safeSlug(slug));
  if (!entry) return null;
  const markdown = await fs.readFile(path.join(docsDir, entry.fileName), "utf8").catch(() => null);
  return markdown === null ? null : { ...entry, markdown };
}

export function docsRoot() { return docsDir; }
