import * as vscode from "vscode";

/**
 * One dependency taken from a manifest.
 *
 * The shape is deliberately ecosystem-agnostic: adding support for PyPI, crates.io and
 * friends should only mean writing a new provider, never touching the code that renders,
 * schedules or caches.
 */
export interface DependencyEntry {
  /** Package name, e.g. "typescript" or "@types/node" */
  readonly name: string;
  /** The version specifier as written in the manifest, e.g. "^5.7.2" */
  readonly spec: string;
  /** Which group it came from, e.g. "dependencies" or "devDependencies" */
  readonly section: string;
  /** Zero-based line the annotation is drawn on */
  readonly line: number;
}

/** Where a license was read from */
export type LicenseSource =
  /** From a package installed on disk */
  | "local"
  /** From a lockfile — npm's lockfile carries licenses, the others only pin versions */
  | "lockfile"
  /** From a remote registry */
  | "registry"
  /** Deliberately not resolved (git dependency, local path, …) */
  | "skipped"
  /** Resolution was attempted but produced nothing */
  | "unknown";

/** What we managed to find out about one dependency */
export interface LicenseInfo {
  /** An SPDX expression, or undefined when it could not be determined */
  readonly license?: string;
  /** The version the specifier actually resolved to */
  readonly version?: string;
  /** Where the answer came from */
  readonly source: LicenseSource;
  /** Extra context for the hover, typically why nothing was found */
  readonly detail?: string;
  /** Overrides how the hover describes the resolution path, e.g. "pnpm-lock.yaml + registry" */
  readonly via?: string;
  /** URL to link from the hover */
  readonly homepage?: string;
}

/**
 * Resolves licenses for one ecosystem.
 *
 * To support a new language, implement this interface and add the class to
 * `createProviders()` in `providers/index.ts`. Nothing else needs to change.
 */
export interface LicenseProvider {
  /** Unique id, also used to namespace cache keys */
  readonly id: string;

  /** Whether this provider handles the given document (package.json, Cargo.toml, …) */
  supports(document: vscode.TextDocument): boolean;

  /** Whether the user has this provider turned on */
  isEnabled(): boolean;

  /** Extract the dependencies from the manifest text */
  parse(document: vscode.TextDocument): DependencyEntry[];

  /**
   * A cache key that uniquely identifies this entry.
   * Return undefined when the result must not be cached.
   */
  cacheKey(entry: DependencyEntry): string | undefined;

  /** Resolve the license. May hit the network. */
  resolve(
    entry: DependencyEntry,
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<LicenseInfo>;
}
