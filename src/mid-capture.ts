#!/usr/bin/env node

/**
 * Mid-conversation capture hook for Claude Code UserPromptSubmit.
 * Tracks a counter and writes snapshot files every 5th user prompt.
 */

import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import {
  findLatestTranscript,
  parseTranscriptLines,
  makeSlug,
  readStdin,
  COUNTER_PATH,
  emptyCounter,
  readCounter,
  writeCounter,
  type CounterState,
  type Turn,
} from "./transcript.js";

const VAULT_PATH = process.env.VAULT_PATH!;
if (!process.env.VAULT_PATH) {
  console.error("[mid-capture] VAULT_PATH env var is required");
  process.exit(1);
}
const CAPTURE_EVERY = 5;
const USER_CHAR_LIMIT = 3000;
const ASSISTANT_CHAR_LIMIT = 3000;

function formatTurns(turns: Turn[]): string {
  const lines: string[] = [];
  for (const t of turns) {
    const userSnippet = t.user.slice(0, USER_CHAR_LIMIT);
    const assistantSnippet = t.assistant.slice(0, ASSISTANT_CHAR_LIMIT);
    lines.push(`**User:** ${userSnippet}`);
    if (assistantSnippet) {
      lines.push(`**Assistant:** ${assistantSnippet}`);
    }
    if (t.tools.length > 0) {
      lines.push(`*Tools: ${t.tools.join(", ")}*`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  try {
    // Read stdin (required by hook protocol)
    await readStdin();

    // Find the current transcript
    const transcriptPath = await findLatestTranscript();
    if (!transcriptPath) {
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    const raw = await fs.readFile(transcriptPath, "utf-8");
    const allLines = raw.split("\n");

    // Derive sessionId from transcript filename
    const transcriptSessionId = path.basename(
      transcriptPath,
      ".jsonl"
    );

    // Read or initialize counter
    let counter = await readCounter();
    if (!counter || counter.sessionId !== transcriptSessionId) {
      // New session -- parse from start to get slug
      const { turns } = parseTranscriptLines(allLines, 0);
      const slug = makeSlug(turns[0]?.user || "");
      counter = emptyCounter(transcriptSessionId, slug);
    }

    // Increment count
    counter.count++;

    // Check if it's time to capture
    if (counter.count % CAPTURE_EVERY !== 0) {
      await writeCounter(counter);
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // Time to capture -- parse turns since last snapshot
    const { turns } = parseTranscriptLines(
      allLines,
      counter.lastSnapshotLine
    );

    if (turns.length === 0) {
      await writeCounter(counter);
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    // Build snapshot file
    counter.snapshotCount++;
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const filename = `${dateStr}-session-${counter.slug}-${transcriptSessionId.slice(0, 6)}-snap-${counter.snapshotCount}.md`;
    const notePath = path.join(VAULT_PATH, "conversations", filename);

    const body = formatTurns(turns);

    const frontmatter = {
      title: `Snapshot ${counter.snapshotCount}: ${counter.slug}`,
      type: "conversation",
      tags: ["auto-capture", "mid-session"],
      created: dateStr,
      updated: dateStr,
      related: [] as string[],
      sessionId: transcriptSessionId,
      snapshotNumber: counter.snapshotCount,
      turnsInSnapshot: turns.length,
      totalTurnsSoFar: counter.count,
    };

    const output = matter.stringify(body, frontmatter);
    await fs.mkdir(path.dirname(notePath), { recursive: true });
    await fs.writeFile(notePath, output, "utf-8");

    // Update counter
    counter.lastSnapshotLine = allLines.length;
    await writeCounter(counter);

    console.error(
      `[mid-capture] Saved snapshot ${counter.snapshotCount} (${turns.length} turns) to ${filename}`
    );
    console.log(JSON.stringify({ continue: true }));
  } catch (err) {
    console.error("[mid-capture] Error:", err);
    console.log(JSON.stringify({ continue: true }));
  }
}

main();
