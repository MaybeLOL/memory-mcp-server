import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";

export interface NoteFrontmatter {
  title: string;
  type: string;
  tags: string[];
  created: string;
  updated: string;
  related: string[];
  [key: string]: unknown;
}

export interface Note {
  path: string;
  frontmatter: NoteFrontmatter;
  content: string;
  raw: string;
}

export class Vault {
  constructor(private vaultPath: string) {}

  private resolve(notePath: string): string {
    const resolved = path.resolve(this.vaultPath, notePath);
    if (!resolved.startsWith(path.resolve(this.vaultPath))) {
      throw new Error("Path traversal not allowed");
    }
    return resolved;
  }

  async write(notePath: string, frontmatter: Partial<NoteFrontmatter>, content: string): Promise<string> {
    const fullPath = this.resolve(notePath.endsWith(".md") ? notePath : `${notePath}.md`);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    const now = new Date().toISOString().split("T")[0];
    const existing = await this.read(notePath).catch(() => null);

    const defined = Object.fromEntries(
      Object.entries(frontmatter).filter(([, v]) => v !== undefined)
    );
    const fm: NoteFrontmatter = {
      title: frontmatter.title || path.basename(notePath, ".md"),
      type: frontmatter.type || "inbox",
      tags: frontmatter.tags || [],
      created: existing?.frontmatter.created || frontmatter.created || now,
      updated: now,
      related: frontmatter.related || existing?.frontmatter.related || [],
      ...defined,
    };

    const output = matter.stringify(content, fm);
    await fs.writeFile(fullPath, output, "utf-8");
    return path.relative(this.vaultPath, fullPath);
  }

  async read(notePath: string): Promise<Note> {
    const fullPath = this.resolve(notePath.endsWith(".md") ? notePath : `${notePath}.md`);
    const raw = await fs.readFile(fullPath, "utf-8");
    const { data, content } = matter(raw);
    return {
      path: path.relative(this.vaultPath, fullPath),
      frontmatter: data as NoteFrontmatter,
      content: content.trim(),
      raw,
    };
  }

  async delete(notePath: string): Promise<void> {
    const fullPath = this.resolve(notePath.endsWith(".md") ? notePath : `${notePath}.md`);
    await fs.unlink(fullPath);
  }

  async list(folder?: string, type?: string, tag?: string): Promise<Note[]> {
    const base = folder
      ? path.join(this.vaultPath, folder)
      : this.vaultPath;
    const pattern = base.replace(/\\/g, "/") + "/**/*.md";

    const files = await glob(pattern, { ignore: ["**/templates/**", "**/.obsidian/**"] });
    const notes: Note[] = [];

    for (const file of files) {
      try {
        const raw = await fs.readFile(file, "utf-8");
        const { data, content } = matter(raw);
        const fm = data as NoteFrontmatter;

        if (type && fm.type !== type) continue;
        if (tag && (!fm.tags || !fm.tags.includes(tag))) continue;

        notes.push({
          path: path.relative(this.vaultPath, file),
          frontmatter: fm,
          content: content.trim(),
          raw,
        });
      } catch {
        continue;
      }
    }
    return notes;
  }

  async search(query: string): Promise<Note[]> {
    const allNotes = await this.list();
    const lower = query.toLowerCase();
    return allNotes.filter(
      (n) =>
        n.content.toLowerCase().includes(lower) ||
        n.frontmatter.title?.toLowerCase().includes(lower) ||
        n.frontmatter.tags?.some((t) => t.toLowerCase().includes(lower))
    );
  }

  async getAllForIndexing(): Promise<{ path: string; text: string; frontmatter: NoteFrontmatter }[]> {
    const notes = await this.list();
    return notes.map((n) => ({
      path: n.path,
      text: `${n.frontmatter.title || ""}\n${n.frontmatter.tags?.join(" ") || ""}\n${n.content}`,
      frontmatter: n.frontmatter,
    }));
  }
}
