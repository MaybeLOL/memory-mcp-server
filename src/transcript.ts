import fs from "fs/promises";
import path from "path";
import { glob } from "glob";

const PROJECTS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".claude",
  "projects"
);

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
}

export interface TranscriptRecord {
  type: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
  };
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
}

export interface Turn {
  user: string;
  assistant: string;
  tools: string[];
}

export interface ParsedTranscript {
  turns: Turn[];
  sessionId: string;
  cwd: string;
  timestamp: string;
}

export async function findLatestTranscript(): Promise<string | null> {
  const pattern = PROJECTS_DIR.replace(/\\/g, "/") + "/*/*.jsonl";
  const files = await glob(pattern);
  if (files.length === 0) return null;

  let latest = "";
  let latestTime = 0;

  for (const f of files) {
    const stat = await fs.stat(f);
    if (stat.mtimeMs > latestTime) {
      latestTime = stat.mtimeMs;
      latest = f;
    }
  }
  return latest;
}

export function extractUserText(record: TranscriptRecord): string | null {
  if (record.type !== "user") return null;
  const content = record.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const hasToolResult = content.some((b) => b.type === "tool_result");
    if (hasToolResult) return null;
    return content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return null;
}

export function extractAssistantText(record: TranscriptRecord): string | null {
  if (record.type !== "assistant") return null;
  const content = record.message?.content;
  if (!Array.isArray(content)) return null;
  const texts = content
    .filter((b: ContentBlock) => b.type === "text")
    .map((b: ContentBlock) => b.text || "");
  return texts.length > 0 ? texts.join("\n") : null;
}

export function extractToolCalls(record: TranscriptRecord): string[] {
  if (record.type !== "assistant") return [];
  const content = record.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: ContentBlock) => b.type === "tool_use")
    .map((b: ContentBlock) => b.name || "unknown");
}

export function parseTranscriptLines(
  lines: string[],
  startLine: number = 0
): ParsedTranscript {
  const records: TranscriptRecord[] = [];
  let sessionId = "";
  let cwd = "";
  let timestamp = "";

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as TranscriptRecord;
      if (rec.type === "file-history-snapshot") continue;
      records.push(rec);
      if (!sessionId && rec.sessionId) sessionId = rec.sessionId;
      if (!cwd && rec.cwd) cwd = rec.cwd;
      if (!timestamp && rec.timestamp) timestamp = rec.timestamp;
    } catch {
      continue;
    }
  }
  const turns: Turn[] = [];
  let currentUser = "";
  let currentAssistant = "";
  let currentTools: string[] = [];

  for (const rec of records) {
    const userText = extractUserText(rec);
    if (userText) {
      if (currentUser) {
        turns.push({
          user: currentUser,
          assistant: currentAssistant,
          tools: currentTools,
        });
      }
      currentUser = userText;
      currentAssistant = "";
      currentTools = [];
      continue;
    }

    const assistantText = extractAssistantText(rec);
    if (assistantText) {
      currentAssistant += (currentAssistant ? "\n" : "") + assistantText;
    }

    const tools = extractToolCalls(rec);
    currentTools.push(...tools);
  }

  if (currentUser) {
    turns.push({
      user: currentUser,
      assistant: currentAssistant,
      tools: currentTools,
    });
  }

  return { turns, sessionId, cwd, timestamp };
}

export function makeSlug(text: string): string {
  return (
    text
      .slice(0, 50)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+$/, "") || "session"
  );
}

// --- Counter state (shared by mid-capture and capture) ---

export const COUNTER_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".claude",
  "session-turn-count.json"
);

export interface CounterState {
  sessionId: string;
  count: number;
  lastSnapshotLine: number;
  snapshotCount: number;
  slug: string;
}

export function emptyCounter(sessionId: string, slug: string): CounterState {
  return {
    sessionId,
    count: 0,
    lastSnapshotLine: 0,
    snapshotCount: 0,
    slug,
  };
}

export async function readCounter(): Promise<CounterState | null> {
  try {
    const raw = await fs.readFile(COUNTER_PATH, "utf-8");
    return JSON.parse(raw) as CounterState;
  } catch {
    return null;
  }
}

export async function writeCounter(state: CounterState): Promise<void> {
  await fs.writeFile(COUNTER_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
