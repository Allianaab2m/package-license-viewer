import * as vscode from "vscode";
import semver from "semver";
import type { LicenseCache } from "../../cache";
import { getSetting } from "../../config";
import { log } from "../../log";
import { JsrClient, parseJsrNpmCompatName, resolveViaNpmRegistry } from "../jsr";
import type { DependencyEntry, LicenseInfo, LicenseProvider } from "../types";
import { InstalledPackageLookup } from "./installed";
import { LockfileResolver } from "./lockfile";
import { normalizeLicense } from "./manifest";
import { parsePackageJson } from "./parse";
import { NpmRegistryClient } from "./registry";
import { parseSpec } from "./spec";

const DEFAULT_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/**
 * Provider for package.json.
 *
 * Resolution order:
 *  1. node_modules — what is actually installed. Offline, instant, and the most trustworthy.
 *  2. the lockfile — the pinned version even under PnP or before installing. npm's lockfile
 *     carries the license too.
 *  3. the registry — resolve the specifier's range as a last resort.
 */
export class NpmLicenseProvider implements LicenseProvider {
  readonly id = "npm";

  private readonly installed = new InstalledPackageLookup();
  private readonly lockfiles = new LockfileResolver();
  private readonly registry: NpmRegistryClient;
  private readonly jsr: JsrClient;

  constructor(cache: LicenseCache) {
    this.registry = new NpmRegistryClient(cache);
    this.jsr = new JsrClient(cache);
  }

  supports(document: vscode.TextDocument): boolean {
    const path = document.uri.path;
    // Never annotate a package.json that lives inside node_modules
    return path.endsWith("/package.json") && !path.includes("/node_modules/");
  }

  isEnabled(): boolean {
    return getSetting("npm.enabled", true);
  }

  parse(document: vscode.TextDocument): DependencyEntry[] {
    return parsePackageJson(document, {
      sections: getSetting<string[]>("npm.sections", DEFAULT_SECTIONS),
      autoDetectSections: getSetting("npm.autoDetectSections", true),
    });
  }

  cacheKey(entry: DependencyEntry): string {
    return `${this.id}:${entry.name}@${entry.spec}`;
  }

  invalidate(): void {
    this.installed.invalidate();
    this.lockfiles.invalidate();
  }

  async resolve(
    entry: DependencyEntry,
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<LicenseInfo> {
    const parsed = parseSpec(entry.name, entry.spec);

    // 1. Whatever is installed wins
    const local = await this.installed.find(document.uri, entry.name);
    if (local) {
      const version = local.manifest.version;
      const satisfies =
        parsed.kind !== "range" ||
        !version ||
        semver.satisfies(version, parsed.spec, { loose: true, includePrerelease: true });
      if (satisfies) {
        const license = normalizeLicense(local.manifest);
        return {
          license,
          version,
          source: "local",
          homepage: local.manifest.homepage,
          detail: license ? undefined : "no license field in the installed package.json",
        };
      }
      log.debug(`npm: installed ${entry.name}@${version} does not satisfy ${entry.spec}`);
    }

    // JSR packages appear under their npm-compatibility name (`@jsr/std__fs`), which does not
    // exist on npmjs.org, so they have to be asked of JSR instead
    const jsrId = parseJsrNpmCompatName(parsed.name);
    if (jsrId) {
      return this.jsr.resolve(jsrId, parsed.spec, token);
    }

    if (parsed.kind === "unresolvable") {
      return { source: "skipped", detail: parsed.reason };
    }

    // 2. Ask the lockfile for the pinned version
    if (getSetting("npm.useLockfiles", true)) {
      const locked = await this.lockfiles.lookup(document.uri, parsed.name, parsed.spec);
      if (locked) {
        // npm's lockfile has the license, so this can be answered outright
        if (locked.license) {
          return {
            license: locked.license,
            version: locked.version,
            source: "lockfile",
            via: `\`${lockfileName(locked.kind)}\``,
          };
        }
        if (getSetting("npm.useRegistry", true)) {
          const info = await this.fetchExactVersion(parsed.name, locked.version, token);
          if (info) {
            return { ...info, via: `\`${lockfileName(locked.kind)}\` + registry` };
          }
        }
        return {
          version: locked.version,
          source: "lockfile",
          via: `\`${lockfileName(locked.kind)}\``,
          detail: "the lockfile pins a version but carries no license",
        };
      }
    }

    if (!getSetting("npm.useRegistry", true)) {
      return { source: "unknown", detail: "not installed and registry lookups are disabled" };
    }

    // 3. Resolve the range against the registry
    return resolveViaNpmRegistry(this.registry, parsed.name, parsed.spec, token);
  }

  /** Fetch just the license of the version the lockfile pinned */
  private async fetchExactVersion(
    name: string,
    version: string,
    token: vscode.CancellationToken
  ): Promise<LicenseInfo | undefined> {
    try {
      const { license, homepage } = await this.registry.fetchLicense(name, version, token);
      return {
        license,
        version,
        source: license ? "registry" : "lockfile",
        homepage,
        detail: license ? undefined : "the published package declares no license",
      };
    } catch (error) {
      log.warn(`npm: failed to fetch ${name}@${version}: ${String(error)}`);
      return undefined;
    }
  }
}

function lockfileName(kind: string): string {
  switch (kind) {
    case "npm":
      return "package-lock.json";
    case "pnpm":
      return "pnpm-lock.yaml";
    case "yarn":
    case "yarn-berry":
      return "yarn.lock";
    case "bun":
      return "bun.lock";
    default:
      return kind;
  }
}
