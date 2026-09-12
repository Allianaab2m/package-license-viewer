import * as vscode from "vscode";
import { parseManifest, type CargoManifest } from "./parse";

type ReadResult = { kind: "found"; text: string } | { kind: "missing" } | { kind: "failed" };
export type RootResult =
  { kind: "found"; uri: vscode.Uri; manifest: CargoManifest } | { kind: "unknown"; reason: string };

/** Resolve manifest paths in the document's filesystem, preserving its URI identity. */
export function workspaceManifestUri(
  directory: vscode.Uri,
  reference: string
): vscode.Uri | undefined {
  const drive = /^\/[A-Za-z]:/.exec(directory.path)?.[0];
  const absoluteDrive = /^[A-Za-z]:[\\/]/.test(reference);
  // Drive-relative and UNC/device paths need filesystem context we do not infer.
  if ((/^[A-Za-z]:/.test(reference) && !absoluteDrive) || reference.startsWith("\\\\"))
    return undefined;
  const path = drive || absoluteDrive ? reference.replace(/\\/g, "/") : reference;
  const root = absoluteDrive
    ? directory.with({ path: `/${path}` })
    : path.startsWith("/")
      ? directory.with({ path: `${drive ?? ""}${path}` })
      : vscode.Uri.joinPath(directory, path);
  return vscode.Uri.joinPath(root, "Cargo.toml");
}

/** Short-lived auxiliary reads. Refresh invalidates promises without letting old reads repopulate them. */
export class CargoWorkspace {
  private readonly files = new Map<string, { at: number; result: Promise<ReadResult> }>();

  invalidate(): void {
    this.files.clear();
  }

  read(uri: vscode.Uri): Promise<ReadResult> {
    const key = uri.toString();
    const cached = this.files.get(key);
    if (cached && Date.now() - cached.at < 5000) return cached.result;
    const result = vscode.workspace.fs
      .readFile(uri)
      .then(
        (bytes): ReadResult => ({
          kind: "found",
          text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        }),
        (error: unknown): ReadResult => ({
          kind:
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "FileNotFound"
              ? "missing"
              : "failed",
        })
      )
      .then(
        (value) => value,
        (): ReadResult => ({ kind: "failed" })
      );
    this.files.set(key, { at: Date.now(), result: Promise.resolve(result) });
    return Promise.resolve(result);
  }

  async root(uri: vscode.Uri, current: CargoManifest): Promise<RootResult> {
    if (current.invalidWorkspace) return { kind: "unknown", reason: "invalid workspace reference" };
    if (current.workspace) return { kind: "found", uri, manifest: current };
    const directory = vscode.Uri.joinPath(uri, "..");
    if (current.workspacePath !== undefined) {
      const target = workspaceManifestUri(directory, current.workspacePath);
      if (!target) return { kind: "unknown", reason: "unsupported workspace path" };
      const read = await this.read(target);
      const manifest =
        read.kind === "found" ? parseManifest(read.text, target.toString()) : undefined;
      return manifest?.workspace && !manifest.invalidWorkspace
        ? { kind: "found", uri: target, manifest }
        : { kind: "unknown", reason: "explicit workspace root could not be read" };
    }
    let dir = vscode.Uri.joinPath(directory, "..");
    if (dir.path === directory.path) return { kind: "found", uri, manifest: current };
    for (let depth = 0; depth < 64 && dir.path !== directory.path; depth++) {
      const target = vscode.Uri.joinPath(dir, "Cargo.toml");
      const read = await this.read(target);
      if (read.kind === "failed")
        return { kind: "unknown", reason: "workspace ancestor could not be read" };
      if (read.kind === "found") {
        const manifest = parseManifest(read.text, target.toString());
        if (!manifest || manifest.invalidWorkspace)
          return { kind: "unknown", reason: "invalid ancestor manifest" };
        if (manifest.workspace) return { kind: "found", uri: target, manifest };
      }
      const parent = vscode.Uri.joinPath(dir, "..");
      if (parent.path === dir.path) return { kind: "found", uri, manifest: current };
      dir = parent;
    }
    return { kind: "unknown", reason: "workspace ancestor search limit reached" };
  }
}
