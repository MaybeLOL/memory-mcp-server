import * as lancedb from "@lancedb/lancedb";
import { getEmbedding, getEmbeddings, getEmbeddingDimension } from "./embeddings.js";
import type { NoteFrontmatter } from "./vault.js";

interface MemoryRecord {
  path: string;
  text: string;
  title: string;
  type: string;
  tags: string;
  vector: number[];
}

export class VectorStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);
    const tables = await this.db.tableNames();
    if (tables.includes("memories")) {
      this.table = await this.db.openTable("memories");
    }
  }

  async index(
    notes: { path: string; text: string; frontmatter: NoteFrontmatter }[]
  ): Promise<number> {
    if (!this.db) await this.init();

    if (notes.length === 0) return 0;

    const texts = notes.map((n) => n.text);
    const vectors = await getEmbeddings(texts);

    const records: MemoryRecord[] = notes.map((n, i) => ({
      path: n.path,
      text: n.text.slice(0, 2000), // truncate for storage
      title: n.frontmatter.title || "",
      type: n.frontmatter.type || "",
      tags: (n.frontmatter.tags || []).join(","),
      vector: vectors[i],
    }));

    // Drop and recreate table for full reindex
    const tables = await this.db!.tableNames();
    if (tables.includes("memories")) {
      await this.db!.dropTable("memories");
    }
    this.table = await this.db!.createTable("memories", records as unknown as Record<string, unknown>[]);

    return records.length;
  }

  async search(query: string, limit: number = 10): Promise<{ path: string; text: string; title: string; score: number }[]> {
    if (!this.db) await this.init();
    if (!this.table) return [];

    const queryVector = await getEmbedding(query);

    const results = await this.table
      .vectorSearch(queryVector)
      .limit(limit)
      .toArray();

    return results.map((r: any) => ({
      path: r.path,
      text: r.text,
      title: r.title,
      score: r._distance != null ? 1 - r._distance : 0,
    }));
  }
}
