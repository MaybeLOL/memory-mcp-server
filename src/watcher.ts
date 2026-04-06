import { watch } from "chokidar";
import path from "path";
import { Vault } from "./vault.js";
import { VectorStore } from "./vectordb.js";

export function startWatcher(
  vaultPath: string,
  vault: Vault,
  vectorStore: VectorStore,
  onReindex?: () => void
): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(path.join(vaultPath, "**/*.md"), {
    ignored: [/(^|[\/\\])\../, /templates/],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
  });

  const reindex = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const notes = await vault.getAllForIndexing();
        await vectorStore.index(notes);
        console.error(`[watcher] Reindexed ${notes.length} notes`);
        onReindex?.();
      } catch (err) {
        console.error("[watcher] Reindex error:", err);
      }
    }, 2000);
  };

  watcher
    .on("add", reindex)
    .on("change", reindex)
    .on("unlink", reindex);

  console.error("[watcher] Watching vault for changes");
}
