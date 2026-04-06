#!/usr/bin/env node

/**
 * Auto-capture hook for Claude Code SessionEnd.
 * Reads the session transcript, produces a lightweight summary,
 * and links to any mid-session snapshots written by mid-capture.
 */

import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { findLatestTranscript, parseTranscriptLines, makeSlug, readCounter, type CounterState, type Turn } from "./transcript.js";

const VAULT_PATH = process.env.VAULT_PATH!;
if (!process.env.VAULT_PATH) {
  console.error("[capture] VAULT_PATH env var is required");
  process.exit(1);
}
const MIN_TURNS = 2; // Skip trivial sessions

function generateSummary(
  turns: Turn[],
  cwd: string,
  snapshotCount: number,
  slug: string,
  dateStr: string,
  sessionIdFragment: string
): string {
  const lines: string[] = [];

  // First user message is usually the main topic
  const topic = turns[0]?.user?.slice(0, 200) || "Unknown topic";
  lines.push(`## Topic\n${topic}\n`);

  // Collect all unique tools used
  const allTools = [...new Set(turns.flatMap((t) => t.tools))];
  if (allTools.length > 0) {
    lines.push(`## Tools Used\n${allTools.join(", ")}\n`);
  }

  // Working directory
  if (cwd) {
    lines.push(`## Working Directory\n\`${cwd}\`\n`);
  }

  // Stats
  lines.push(`## Stats\n- Turns: ${turns.length}\n- Snapshots: ${snapshotCount}\n`);

  // Links to mid-session snapshots
  if (snapshotCount > 0) {
    lines.push("## Snapshots");
    for (let i = 1; i <= snapshotCount; i++) {
      const snapFile = `${dateStr}-session-${slug}-${sessionIdFragment}-snap-${i}`;
      lines.push(`- [[${snapFile}]]`);
    }
    lines.push("");
  }

  // Opening and closing turns only — detail lives in snapshots
  lines.push("## Opening");
  const opener = turns[0];
  if (opener) {
    lines.push(`**User:** ${opener.user.slice(0, 300)}`);
    if (opener.assistant) {
      lines.push(`**Assistant:** ${opener.assistant.slice(0, 500)}`);
    }
    lines.push("");
  }

  if (turns.length > 1) {
    const closer = turns[turns.length - 1];
    lines.push("## Closing");
    lines.push(`**User:** ${closer.user.slice(0, 300)}`);
    if (closer.assistant) {
      lines.push(`**Assistant:** ${closer.assistant.slice(0, 500)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  try {
    const transcriptPath = await findLatestTranscript();
    if (!transcriptPath) {
      process.exit(0);
    }

    const raw = await fs.readFile(transcriptPath, "utf-8");
    const lines = raw.split("\n");
    const { turns, sessionId, cwd } = parseTranscriptLines(lines);

    // Skip trivial sessions
    if (turns.length < MIN_TURNS) {
      process.exit(0);
    }

    // Generate note
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const slug = makeSlug(turns[0]?.user || "");

    const transcriptSessionId = path.basename(transcriptPath, ".jsonl");
    const sessionIdFragment = transcriptSessionId.slice(0, 6);
    const filename = `${dateStr}-${slug}-${sessionIdFragment}.md`;
    const notePath = path.join(VAULT_PATH, "conversations", filename);

    // Don't overwrite if already exists
    try {
      await fs.access(notePath);
      process.exit(0); // Already captured
    } catch {
      // File doesn't exist, proceed
    }

    // Read counter to find snapshot count for this session
    const counter = await readCounter();
    const snapshotCount =
      counter && counter.sessionId === transcriptSessionId
        ? counter.snapshotCount
        : 0;
    const counterSlug =
      counter && counter.sessionId === transcriptSessionId
        ? counter.slug
        : slug;

    const summary = generateSummary(turns, cwd, snapshotCount, counterSlug, dateStr, sessionIdFragment);

    // Build related links to snapshots
    const related: string[] = [];
    for (let i = 1; i <= snapshotCount; i++) {
      related.push(`[[${dateStr}-session-${counterSlug}-${sessionIdFragment}-snap-${i}]]`);
    }

    const frontmatter = {
      title: turns[0]?.user?.slice(0, 100) || "Session",
      type: "conversation",
      tags: ["auto-capture", "session-summary"],
      created: dateStr,
      updated: dateStr,
      related,
      sessionId: sessionId || undefined,
      turns: turns.length,
      snapshots: snapshotCount,
    };

    const output = matter.stringify(summary, frontmatter);
    await fs.mkdir(path.dirname(notePath), { recursive: true });
    await fs.writeFile(notePath, output, "utf-8");

    console.error(`[capture] Saved session summary to ${filename}`);
  } catch (err) {
    console.error("[capture] Error:", err);
    process.exit(0); // Don't block session end
  }
}

main();
