# Memory MCP Server

An MCP server for Claude Code that provides persistent memory via an Obsidian vault with vector semantic search. Includes mid-conversation capture hooks that save conversation snapshots every 5 prompts, so context survives Claude Code's automatic compression.

## Features

- Read/write/search notes in an Obsidian vault via MCP tools
- Semantic search using Voyage AI embeddings + LanceDB
- Mid-conversation capture — saves snapshots every 5 user prompts
- Session-end summary — lightweight summary linking to snapshots
- Automatic recall — injects relevant memories on each prompt
- File watcher — auto-reindexes when vault files change

## Prerequisites

- Node.js 20+
- A [Voyage AI](https://voyageai.com) API key (for embeddings — used by both the MCP server and recall hook)
- An Obsidian vault (or any folder of markdown files)

## Installation

```bash
git clone https://github.com/MaybeLOL/memory-mcp-server.git
cd memory-mcp-server
npm install
npm run build
```

Verify the build: `ls dist/` should contain `index.js`, `recall.js`, `mid-capture.js`, `capture.js`, and other `.js` files.

## Configuration

### 1. MCP Server

Add to your Claude Code MCP config (`~/.claude/mcp.json`):

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

**Windows (cmd/PowerShell):** The inline `VAR=value command` syntax doesn't work. Use wrapper scripts or set environment variables in your system settings. Alternatively, if Claude Code is configured to use Git Bash as its shell, the above syntax works as-is.

Replace `/path/to/vault` and `/path/to/memory-mcp-server` with your actual paths.

### 3. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VAULT_PATH` | Yes | Absolute path to your Obsidian vault |
| `VOYAGE_API_KEY` | Yes | Voyage AI API key — needed by MCP server and recall hook |
| `DB_PATH` | For MCP server | Path to LanceDB database directory |

## MCP Tools

| Tool | Description |
|------|-------------|
| `memory_write` | Create or update a note |
| `memory_read` | Read a note by path |
| `memory_delete` | Delete a note |
| `memory_search` | Full-text keyword search |
| `memory_semantic_search` | Semantic similarity search via embeddings |
| `memory_list` | List notes with optional filters |
| `memory_index` | Re-index all notes into vector DB |

## How It Works

### Mid-Conversation Capture

The `mid-capture` hook runs on every `UserPromptSubmit`. It maintains a counter at `~/.claude/session-turn-count.json` and every 5th prompt:

1. Reads the conversation transcript JSONL
2. Extracts all turns since the last snapshot
3. Writes them to `<vault>/conversations/YYYY-MM-DD-session-<slug>-<id>-snap-N.md`

Non-capture prompts exit in under 500ms (just counter increment).

### Session-End Summary

When a session ends, `capture` writes a lightweight summary with:
- Topic, tools used, working directory
- First and last turn for context
- Links to all mid-session snapshots

### Recall

On each prompt, `recall` embeds the user's message and all vault notes via Voyage AI, then injects the top semantic matches as a system message.

**Note:** The recall hook re-embeds all notes on every prompt. For large vaults (500+ notes), this may be slow or exceed the 15s timeout. Consider increasing the timeout or reducing vault size if you experience issues.

## Troubleshooting

**MCP server not connecting:** Check that `VAULT_PATH`, `DB_PATH`, and `VOYAGE_API_KEY` are all set. Run manually to see errors:
```bash
VAULT_PATH=/path/to/vault DB_PATH=/path/to/db VOYAGE_API_KEY=your-key node dist/index.js
```

**Hooks not firing:** Verify your `~/.claude/settings.json` is valid JSON. Check that file paths in hook commands are correct and absolute.

**`npm install` fails on LanceDB:** The `@lancedb/lancedb` package includes native binaries. If you're behind a proxy or on an unsupported platform, the download may fail. Check [LanceDB docs](https://lancedb.github.io/lancedb/) for platform support.

**Recall is slow:** For vaults with many notes, the recall hook may time out. Increase the `timeout` value in your hook config, or reduce the number of notes in your vault.

## License

MIT
