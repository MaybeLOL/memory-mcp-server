# Memory MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io/)

Claude Code silently compresses older conversation turns to stay within its context window. You have seen it: "111 turns omitted." Every decision, every file path, every nuance from earlier in the session -- gone. This server captures live conversation snapshots every 5 prompts so that context is never lost.

---

## Why This Exists

Claude Code's context compression is aggressive and invisible. Mid-conversation, it drops the exact turns where you discussed architecture, debugged a tricky issue, or agreed on a design. By the time you need that context, it is already gone.

Existing memory solutions bolt on basic RAG -- they index static documents and retrieve them on demand. That helps with long-term recall, but it does nothing for the conversation you are in right now.

This server solves both problems:

- **Live mid-conversation capture.** A hook fires every 5 prompts and writes a snapshot of recent turns to your vault. When Claude compresses old turns, the snapshots survive intact.
- **Session-end summaries.** When a session ends, a lightweight summary is written with wikilinks back to every snapshot, so you can trace the full conversation later.
- **Semantic recall.** On each new prompt, the most relevant memories from your vault are injected into context automatically. Past sessions inform current ones.

The result: Claude Code with a persistent, searchable memory that captures context as it happens, not after the fact.

---

## Features

- **Snapshot capture** -- saves conversation turns to markdown every 5 prompts
- **Session summaries** -- end-of-session notes with topic, tools used, and links to snapshots
- **Semantic search** -- find related memories using Voyage AI embeddings and LanceDB
- **Full-text search** -- keyword search across all notes
- **Obsidian-native** -- writes standard markdown with frontmatter, works with any vault
- **Auto-recall** -- injects relevant memories into context on every prompt
- **File watcher** -- auto-reindexes when vault files change on disk

---

## Quick Start

```bash
git clone https://github.com/MaybeLOL/memory-mcp-server.git
cd memory-mcp-server
npm install && npm run build
```

Then add the server to `~/.claude/mcp.json` and the hooks to `~/.claude/settings.json` (see Configuration below).

---

## How It's Different

| | Basic RAG Memory | This Server |
|---|---|---|
| **When it captures** | Manual or end-of-session | Live, every 5 prompts |
| **What it captures** | Static documents | Actual conversation turns |
| **Compression recovery** | None | Snapshots preserve compressed turns |
| **Session continuity** | Keyword lookup | Semantic search + auto-recall |
| **Obsidian integration** | Rarely | Native markdown with wikilinks |

Most memory tools treat recall as a lookup problem. This server treats it as a continuity problem -- making sure context from 50 turns ago is still available even after Claude Code compresses it away.

---

## Configuration

### 1. MCP Server

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/path/to/memory-mcp-server/dist/index.js"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault",
        "DB_PATH": "/path/to/lancedb-data",
        "VOYAGE_API_KEY": "your-voyage-api-key"
      }
    }
  }
}
```

`DB_PATH` is where LanceDB stores its vector index. The directory is created automatically.

### 2. Hooks

Add these hooks to `~/.claude/settings.json`. If you already have a `settings.json`, merge the `hooks` section into your existing config.

**macOS / Linux / Git Bash on Windows:**

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "VAULT_PATH=\"/path/to/vault\" VOYAGE_API_KEY=\"your-key\" node \"/path/to/memory-mcp-server/dist/recall.js\"",
            "timeout": 15
          },
          {
            "type": "command",
            "command": "VAULT_PATH=\"/path/to/vault\" node \"/path/to/memory-mcp-server/dist/mid-capture.js\"",
            "timeout": 15
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "VAULT_PATH=\"/path/to/vault\" node \"/path/to/memory-mcp-server/dist/capture.js\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

**Windows (cmd/PowerShell):** The inline `VAR=value command` syntax does not work. Use wrapper scripts or set environment variables in your system settings. If Claude Code uses Git Bash as its shell, the above syntax works as-is.

Replace `/path/to/vault` and `/path/to/memory-mcp-server` with your actual paths.

### 3. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VAULT_PATH` | Yes | Absolute path to your Obsidian vault (or any markdown folder) |
| `VOYAGE_API_KEY` | Yes | [Voyage AI](https://voyageai.com) API key for embeddings |
| `DB_PATH` | MCP server only | Path to LanceDB vector index directory |

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `memory_write` | Create or update a note |
| `memory_read` | Read a note by path |
| `memory_delete` | Delete a note |
| `memory_search` | Full-text keyword search across all notes |
| `memory_semantic_search` | Semantic similarity search via Voyage AI embeddings |
| `memory_list` | List notes, optionally filtered by folder, type, or tag |
| `memory_index` | Re-index all notes into the vector database |

---

## How It Works

### Mid-Conversation Capture

The `mid-capture` hook runs on every `UserPromptSubmit`. It maintains a counter at `~/.claude/session-turn-count.json` and every 5th prompt:

1. Reads the conversation transcript JSONL
2. Extracts all turns since the last snapshot
3. Writes them to `<vault>/conversations/YYYY-MM-DD-session-<slug>-<id>-snap-N.md`

Non-capture prompts exit in under 500ms (just a counter increment).

### Session-End Summary

When a session ends, the `capture` hook writes a lightweight summary containing:

- Topic, tools used, and working directory
- First and last turn for context
- Wikilinks to all mid-session snapshots

### Recall

On each prompt, the `recall` hook embeds the user's message via Voyage AI and compares it against all vault notes, then injects the top semantic matches as a system message.

**Note:** The recall hook re-embeds all notes on every prompt. For large vaults (500+ notes), this may be slow or exceed the 15s timeout. Consider increasing the timeout or reducing vault size if needed.

---

## Prerequisites

- Node.js 20+
- A [Voyage AI](https://voyageai.com) API key (for embeddings)
- An Obsidian vault or any folder of markdown files

---

## Troubleshooting

**MCP server not connecting:** Check that `VAULT_PATH`, `DB_PATH`, and `VOYAGE_API_KEY` are all set. Run manually to see errors:

```bash
VAULT_PATH=/path/to/vault DB_PATH=/path/to/db VOYAGE_API_KEY=your-key node dist/index.js
```

**Hooks not firing:** Verify your `~/.claude/settings.json` is valid JSON. Check that file paths in hook commands are correct and absolute.

**`npm install` fails on LanceDB:** The `@lancedb/lancedb` package includes native binaries. If you are behind a proxy or on an unsupported platform, the download may fail. See [LanceDB docs](https://lancedb.github.io/lancedb/) for platform support.

**Recall is slow:** For vaults with many notes, the recall hook may time out. Increase the `timeout` value in your hook config, or reduce the number of notes in your vault.

---

## License

MIT
