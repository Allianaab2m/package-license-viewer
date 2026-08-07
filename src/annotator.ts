import * as vscode from "vscode";
import { getConfig } from "./config";
import { buildHover, formatAnnotation } from "./format";
import { log } from "./log";
import { runWithConcurrency } from "./net";
import {
  findProvider,
  type DependencyEntry,
  type LicenseInfo,
  type LicenseProvider,
} from "./providers";

/** How long to wait after the last keystroke before re-resolving */
const DEBOUNCE_MS = 300;
/**
 * Even an "immediate" refresh waits this long.
 *
 * Opening a manifest fires activation, onDidChangeActiveTextEditor and
 * onDidChangeVisibleTextEditors in a burst. Without coalescing, each one starts an update
 * that cancels the previous, which is both wasteful and a source of dropped work.
 */
const COALESCE_MS = 25;
/** Paint partial results at this interval while resolution is still running */
const PROGRESS_FLUSH_MS = 50;
/**
 * How long a resolved result stays fresh in memory.
 *
 * Past this we resolve again, but the old value keeps being drawn in the meantime, so nothing
 * flickers. It is also what makes annotations follow along after an `npm install`.
 */
const RESULT_TTL_MS = 60_000;

interface StoredResult {
  at: number;
  info: LicenseInfo;
}

/** Draws the dimmed license at the end of each dependency line. */
export class Annotator implements vscode.Disposable {
  private decorationType: vscode.TextEditorDecorationType;
  private readonly results = new Map<string, StoredResult>();
  private readonly inflight = new Map<string, Promise<LicenseInfo>>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly cancellations = new Map<string, vscode.CancellationTokenSource>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly providers: readonly LicenseProvider[]) {
    this.decorationType = createDecorationType();

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.schedule(editor.document, true);
        }
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) {
          this.schedule(editor.document, true);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.schedule(event.document, false);
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.schedule(document, true);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.cancel(document.uri.toString());
      })
    );
  }

  /** Redraw every visible editor */
  refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.schedule(editor.document, true);
    }
  }

  /** Throw away resolved results so the next pass fetches them again */
  invalidate(): void {
    this.results.clear();
    for (const provider of this.providers) {
      (provider as { invalidate?: () => void }).invalidate?.();
    }
  }

  /** Rebuild the decoration style after a colour or spacing setting changed */
  recreateDecorationType(): void {
    this.decorationType.dispose();
    this.decorationType = createDecorationType();
  }

  private schedule(document: vscode.TextDocument, immediate: boolean): void {
    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const run = () => {
      this.debounceTimers.delete(key);
      void this.update(document).catch((error) => log.error(`update failed: ${String(error)}`));
    };
    this.debounceTimers.set(key, setTimeout(run, immediate ? COALESCE_MS : DEBOUNCE_MS));
  }

  private async update(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.toString();
    const editors = vscode.window.visibleTextEditors.filter(
      (editor) => editor.document.uri.toString() === key
    );
    if (editors.length === 0) {
      return;
    }

    const config = getConfig(document);
    const provider = config.enabled ? findProvider(this.providers, document) : undefined;
    if (!provider) {
      this.setDecorations(editors, []);
      return;
    }

    this.cancel(key);
    const cts = new vscode.CancellationTokenSource();
    this.cancellations.set(key, cts);

    let entries: DependencyEntry[];
    try {
      entries = provider.parse(document);
    } catch (error) {
      log.warn(`parse failed for ${key}: ${String(error)}`);
      this.setDecorations(editors, []);
      return;
    }

    // Draw what we already know first, so typing does not make annotations blink
    this.render(document, editors, provider, entries);

    const now = Date.now();
    const pending = entries.filter((entry) => {
      const stored = this.results.get(this.keyOf(provider, entry));
      return !stored || now - stored.at > RESULT_TTL_MS;
    });
    if (pending.length === 0) {
      return;
    }

    let flushTimer: NodeJS.Timeout | undefined;
    const scheduleFlush = () => {
      if (flushTimer || cts.token.isCancellationRequested) {
        return;
      }
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        if (!cts.token.isCancellationRequested) {
          this.render(document, editors, provider, entries);
        }
      }, PROGRESS_FLUSH_MS);
    };

    const tasks = pending.map((entry) => async () => {
      if (cts.token.isCancellationRequested) {
        return;
      }
      await this.resolveEntry(provider, entry, document, cts.token);
      scheduleFlush();
    });

    try {
      await runWithConcurrency(tasks, config.maxConcurrentRequests);
    } finally {
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
      if (this.cancellations.get(key) === cts) {
        this.cancellations.delete(key);
      }
      cts.dispose();
    }

    if (!cts.token.isCancellationRequested) {
      this.render(document, editors, provider, entries);
    }
  }

  /** Resolve one entry, making sure the same package is never fetched twice at once */
  private async resolveEntry(
    provider: LicenseProvider,
    entry: DependencyEntry,
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<LicenseInfo> {
    const key = this.keyOf(provider, entry);
    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const promise = provider
      .resolve(entry, document, token)
      .catch((error): LicenseInfo => {
        log.warn(`resolve failed for ${key}: ${String(error)}`);
        return { source: "unknown", detail: String(error) };
      })
      .then((info) => {
        // Never throw away a good answer. This promise is shared, so the token belongs to
        // whichever update asked first — and that update may since have been superseded and
        // cancelled while a newer one was already waiting on the very same promise. Only a
        // cancelled *failure* is discarded, so that it gets retried instead of being
        // remembered as "unknown" for the whole TTL.
        const cancelledFailure = info.source === "unknown" && token.isCancellationRequested;
        if (!cancelledFailure) {
          this.results.set(key, { at: Date.now(), info });
        }
        return info;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  private render(
    document: vscode.TextDocument,
    editors: readonly vscode.TextEditor[],
    provider: LicenseProvider,
    entries: readonly DependencyEntry[]
  ): void {
    const config = getConfig(document);
    const options: vscode.DecorationOptions[] = [];

    for (const entry of entries) {
      const stored = this.results.get(this.keyOf(provider, entry));
      if (!stored) {
        continue;
      }
      const text = formatAnnotation(config, entry, stored.info);
      if (!text) {
        continue;
      }
      if (entry.line < 0 || entry.line >= document.lineCount) {
        continue;
      }
      const endColumn = document.lineAt(entry.line).text.length;
      options.push({
        range: new vscode.Range(entry.line, endColumn, entry.line, endColumn),
        renderOptions: { after: { contentText: text } },
        hoverMessage: buildHover(entry, stored.info),
      });
    }

    this.setDecorations(editors, options);
  }

  private setDecorations(
    editors: readonly vscode.TextEditor[],
    options: vscode.DecorationOptions[]
  ): void {
    for (const editor of editors) {
      editor.setDecorations(this.decorationType, options);
    }
  }

  private keyOf(provider: LicenseProvider, entry: DependencyEntry): string {
    return (
      provider.cacheKey(entry) ?? `${provider.id}:${entry.section}:${entry.name}@${entry.spec}`
    );
  }

  private cancel(documentKey: string): void {
    const cts = this.cancellations.get(documentKey);
    if (cts) {
      cts.cancel();
      cts.dispose();
      this.cancellations.delete(documentKey);
    }
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const key of [...this.cancellations.keys()]) {
      this.cancel(key);
    }
    this.decorationType.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

function createDecorationType(): vscode.TextEditorDecorationType {
  const config = getConfig();
  return vscode.window.createTextEditorDecorationType({
    isWholeLine: false,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    after: {
      margin: config.margin,
      color: resolveColor(config.annotationColor),
      fontStyle: "italic",
    },
  });
}

/** Accepts either a theme colour id or a plain CSS colour */
function resolveColor(value: string): vscode.ThemeColor | string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return new vscode.ThemeColor("editorCodeLens.foreground");
  }
  if (/^(#|rgba?\(|hsla?\(|var\()/i.test(trimmed)) {
    return trimmed;
  }
  return new vscode.ThemeColor(trimmed);
}
