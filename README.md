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
- A [Voyage AI](https://voyageai.com) API key (for embeddings)
- An Obsidian vault (or any folder of markdown files)

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/memory-mcp-server.git
cd memory-mcp-server
npm install
npm run build
```

## Configuration

### 1. MCP Server

Add to your Claude Code MCP config (`~/.claude/mcp.json` or project-level):

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/path/to/memory-mcp-server/dist/index.js", "/path/to/vault", "/path/to/db"],
      "env": {
        "VOYAGE_API_KEY": "your-voyage-api-key"
      }
    }
  }
}
```

### 2. Hooks

Add these hooks to `~/.claude/settings.json`:

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

Replace `/path/to/vault` with your Obsidian vault path and `/path/to/memory-mcp-server` with where you cloned this repo.

### 3. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VAULT_PATH` | Yes | Absolute path to your Obsidian vault |
| `VOYAGE_API_KEY` | For recall/search | Voyage AI API key for embeddings |
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

On each prompt, `recall` embeds the user's message via Voyage AI, searches the vault for semantically similar notes, and injects the top matches as a system message.

## License

MIT
