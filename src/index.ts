#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Vault } from "./vault.js";
import { VectorStore } from "./vectordb.js";
import { startWatcher } from "./watcher.js";

const VAULT_PATH = process.env.VAULT_PATH || process.argv[2];
const DB_PATH = process.env.DB_PATH || process.argv[3];

if (!VAULT_PATH || !DB_PATH) {
  console.error("Usage: memory-server <vault-path> <db-path>");
  console.error("  or set VAULT_PATH and DB_PATH env vars");
  process.exit(1);
}

const vault = new Vault(VAULT_PATH);
const vectorStore = new VectorStore(DB_PATH);

// Schemas
const WriteSchema = z.object({
  path: z.string().describe("Note path relative to vault root, e.g. 'projects/my-project.md'"),
  content: z.string().describe("Markdown content of the note (without frontmatter)"),
  title: z.string().optional().describe("Note title"),
  type: z.enum(["conversation", "project", "reference", "decision", "person", "inbox"]).optional().describe("Note type"),
  tags: z.array(z.string()).optional().describe("Tags for the note"),
  related: z.array(z.string()).optional().describe("Related note links, e.g. ['[[Other Note]]']"),
});

const ReadSchema = z.object({
  path: z.string().describe("Note path relative to vault root"),
});

const DeleteSchema = z.object({
  path: z.string().describe("Note path relative to vault root"),
});

const SearchSchema = z.object({
  query: z.string().describe("Keyword search query"),
});

const SemanticSearchSchema = z.object({
  query: z.string().describe("Natural language query for semantic search"),
  limit: z.number().optional().default(10).describe("Max results to return"),
});

const ListSchema = z.object({
  folder: z.string().optional().describe("Filter by folder, e.g. 'projects'"),
  type: z.string().optional().describe("Filter by note type"),
  tag: z.string().optional().describe("Filter by tag"),
});

const IndexSchema = z.object({});

// Server
const server = new Server(
  { name: "memory-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "memory_write",
      description:
        "Create or update a note in the Obsidian vault. Provide a path relative to the vault root (e.g. 'projects/my-project.md'). Frontmatter is auto-generated.",
      inputSchema: zodToJsonSchema(WriteSchema),
    },
    {
      name: "memory_read",
      description: "Read a note from the Obsidian vault by its path.",
      inputSchema: zodToJsonSchema(ReadSchema),
    },
    {
      name: "memory_delete",
      description: "Delete a note from the Obsidian vault.",
      inputSchema: zodToJsonSchema(DeleteSchema),
    },
    {
      name: "memory_search",
      description:
        "Full-text keyword search across all notes in the vault. Searches content, titles, and tags.",
      inputSchema: zodToJsonSchema(SearchSchema),
    },
    {
      name: "memory_semantic_search",
      description:
        "Semantic similarity search using vector embeddings. Use natural language queries to find conceptually related notes.",
      inputSchema: zodToJsonSchema(SemanticSearchSchema),
    },
    {
      name: "memory_list",
      description:
        "List notes in the vault. Optionally filter by folder, type, or tag.",
      inputSchema: zodToJsonSchema(ListSchema),
    },
    {
      name: "memory_index",
      description:
        "Re-index all notes into the vector database for semantic search. Run this after bulk changes.",
      inputSchema: zodToJsonSchema(IndexSchema),
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "memory_write": {
        const parsed = WriteSchema.parse(args);
        const relPath = await vault.write(
          parsed.path,
          {
            title: parsed.title,
            type: parsed.type,
            tags: parsed.tags,
            related: parsed.related,
          },
          parsed.content
        );
        return {
          content: [{ type: "text", text: `Note written: ${relPath}` }],
        };
      }

      case "memory_read": {
        const parsed = ReadSchema.parse(args);
        const note = await vault.read(parsed.path);
        return {
          content: [
            {
              type: "text",
              text: `# ${note.frontmatter.title || note.path}\n\nType: ${note.frontmatter.type}\nTags: ${(note.frontmatter.tags || []).join(", ")}\nCreated: ${note.frontmatter.created}\nUpdated: ${note.frontmatter.updated}\n\n---\n\n${note.content}`,
            },
          ],
        };
      }

      case "memory_delete": {
        const parsed = DeleteSchema.parse(args);
        await vault.delete(parsed.path);
        return {
          content: [{ type: "text", text: `Deleted: ${parsed.path}` }],
        };
      }

      case "memory_search": {
        const parsed = SearchSchema.parse(args);
        const results = await vault.search(parsed.query);
        if (results.length === 0) {
          return { content: [{ type: "text", text: "No results found." }] };
        }
        const text = results
          .map(
            (n) =>
              `- **${n.frontmatter.title || n.path}** (${n.frontmatter.type || "unknown"})\n  Path: ${n.path}\n  Tags: ${(n.frontmatter.tags || []).join(", ")}`
          )
          .join("\n");
        return {
          content: [{ type: "text", text: `Found ${results.length} notes:\n\n${text}` }],
        };
      }

      case "memory_semantic_search": {
        const parsed = SemanticSearchSchema.parse(args);
        const results = await vectorStore.search(parsed.query, parsed.limit);
        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No results found. You may need to run memory_index first.",
              },
            ],
          };
        }
        const text = results
          .map(
            (r) =>
              `- **${r.title || r.path}** (score: ${r.score.toFixed(3)})\n  Path: ${r.path}\n  Preview: ${r.text.slice(0, 200)}...`
          )
          .join("\n");
        return {
          content: [{ type: "text", text: `Found ${results.length} results:\n\n${text}` }],
        };
      }

      case "memory_list": {
        const parsed = ListSchema.parse(args);
        const notes = await vault.list(parsed.folder, parsed.type, parsed.tag);
        if (notes.length === 0) {
          return { content: [{ type: "text", text: "No notes found." }] };
        }
        const text = notes
          .map(
            (n) =>
              `- **${n.frontmatter.title || n.path}** [${n.frontmatter.type || "?"}] — ${n.path}`
          )
          .join("\n");
        return {
          content: [{ type: "text", text: `${notes.length} notes:\n\n${text}` }],
        };
      }

      case "memory_index": {
        const notes = await vault.getAllForIndexing();
        const count = await vectorStore.index(notes);
        return {
          content: [
            { type: "text", text: `Indexed ${count} notes into vector database.` },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// Start
async function main() {
  await vectorStore.init();

  // Initial index
  try {
    const notes = await vault.getAllForIndexing();
    if (notes.length > 0) {
      await vectorStore.index(notes);
      console.error(`[init] Indexed ${notes.length} notes`);
    }
  } catch (err) {
    console.error("[init] Initial indexing skipped:", err);
  }

  // Watch for changes
  startWatcher(VAULT_PATH, vault, vectorStore);

  // Connect MCP
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Memory MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
