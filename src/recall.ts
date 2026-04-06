#!/usr/bin/env node

/**
 * UserPromptSubmit hook: semantic memory recall.
 * Reads the user's prompt from stdin, searches the vault via Voyage embeddings,
 * and outputs relevant notes as a systemMessage for Claude's context.
 */

import fs from "fs/promises";
import path from "path";
import { glob } from "glob";
import matter from "gray-matter";

const VAULT_PATH = process.env.VAULT_PATH!;
if (!process.env.VAULT_PATH) {
  console.error("[recall] VAULT_PATH env var is required");
  process.exit(1);
}
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-4-large";
const VOYAGE_DIMENSIONS = 1024;
const MAX_RESULTS = 5;
const MIN_SCORE = 0.1; // Minimum similarity to include

interface Note {
  path: string;
  title: string;
  type: string;
  tags: string[];
  content: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function getEmbedding(text: string, inputType: "query" | "document"): Promise<number[]> {
  if (!VOYAGE_API_KEY) throw new Error("No VOYAGE_API_KEY");
  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [text],
      input_type: inputType,
      output_dimension: VOYAGE_DIMENSIONS,
    }),
  });
  if (!res.ok) throw new Error(`Voyage API error: ${res.status}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getAllNotes(): Promise<Note[]> {
  const pattern = VAULT_PATH.replace(/\\/g, "/") + "/**/*.md";
  const files = await glob(pattern, { ignore: ["**/templates/**", "**/.obsidian/**"] });
  const notes: Note[] = [];

  for (const file of files) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const { data, content } = matter(raw);
      notes.push({
        path: path.relative(VAULT_PATH, file),
        title: (data.title as string) || path.basename(file, ".md"),
        type: (data.type as string) || "unknown",
        tags: (data.tags as string[]) || [],
        content: content.trim(),
      });
    } catch {
      continue;
    }
  }
  return notes;
}

async function main() {
  try {
    // Read hook input from stdin
    const input = await readStdin();
    let userPrompt = "";
    try {
      const parsed = JSON.parse(input);
      userPrompt = parsed.user_prompt || parsed.query || "";
    } catch {
      userPrompt = input.trim();
    }

    if (!userPrompt || !VOYAGE_API_KEY) {
      // No prompt or no API key — output nothing
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // Skip very short prompts (like ".", "ok", "yes")
    if (userPrompt.length < 10) {
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // Get all notes and embed them + the query
    const notes = await getAllNotes();
    if (notes.length === 0) {
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // Embed the query
    const queryEmbedding = await getEmbedding(userPrompt, "query");

    // Embed all notes (batch)
    const noteTexts = notes.map(
      (n) => `${n.title}\n${n.tags.join(" ")}\n${n.content}`.slice(0, 2000)
    );

    // Batch embed documents
    const batchSize = 128;
    const allDocEmbeddings: number[][] = [];
    for (let i = 0; i < noteTexts.length; i += batchSize) {
      const batch = noteTexts.slice(i, i + batchSize);
      const res = await fetch(VOYAGE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VOYAGE_API_KEY}`,
        },
        body: JSON.stringify({
          model: VOYAGE_MODEL,
          input: batch,
          input_type: "document",
          output_dimension: VOYAGE_DIMENSIONS,
        }),
      });
      if (!res.ok) throw new Error(`Voyage API error: ${res.status}`);
      const json = (await res.json()) as { data: { embedding: number[] }[] };
      allDocEmbeddings.push(...json.data.map((d) => d.embedding));
    }

    // Score and rank
    const scored = notes.map((note, i) => ({
      note,
      score: cosineSimilarity(queryEmbedding, allDocEmbeddings[i]),
    }));

    scored.sort((a, b) => b.score - a.score);
    const relevant = scored.filter((s) => s.score >= MIN_SCORE).slice(0, MAX_RESULTS);

    if (relevant.length === 0) {
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // Build context message
    const contextParts = relevant.map((r) => {
      const preview = r.note.content.slice(0, 500);
      return `**${r.note.title}** (${r.note.type}) [score: ${r.score.toFixed(2)}]\nPath: ${r.note.path}\n${preview}`;
    });

    const systemMessage = `[Memory Recall] Found ${relevant.length} relevant notes for this conversation:\n\n${contextParts.join("\n\n---\n\n")}`;

    console.log(JSON.stringify({
      continue: true,
      suppressOutput: false,
      systemMessage,
    }));
  } catch (err) {
    // Don't block the user's prompt on failure
    console.error("[recall] Error:", err);
    console.log(JSON.stringify({ continue: true }));
  }
}

main();
