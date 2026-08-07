import semver from "semver";

export type NpmSpecKind =
  /** A semver range, resolvable against the registry */
  | "range"
  /** A dist-tag such as `latest` or `next` */
  | "tag"
  /** A local path, workspace link, git or tarball reference — not resolvable this way */
  | "unresolvable";

export interface ParsedSpec {
  readonly kind: NpmSpecKind;
  /** The package to actually ask about — for an alias, the alias target */
  readonly name: string;
  /** The specifier to actually resolve */
  readonly spec: string;
  /** Why it is unresolvable */
  readonly reason?: string;
}

const PROTOCOL_REASONS: ReadonlyArray<readonly [string, string]> = [
  ["file:", "local path dependency"],
  ["link:", "linked dependency"],
  ["portal:", "portal dependency"],
  ["workspace:", "workspace dependency"],
  ["patch:", "patched dependency"],
  ["git:", "git dependency"],
  ["git+", "git dependency"],
  ["github:", "git dependency"],
  ["gitlab:", "git dependency"],
  ["bitbucket:", "git dependency"],
  ["http:", "remote tarball"],
  ["https:", "remote tarball"],
];

/**
 * Classify a package.json version specifier, so specifiers that the registry could never
 * answer are ruled out before any request is made.
 */
export function parseSpec(name: string, rawSpec: string): ParsedSpec {
  const spec = rawSpec.trim();

  // An alias (`npm:other-pkg@^1.0.0`) is resolved as its target
  if (spec.startsWith("npm:")) {
    const rest = spec.slice("npm:".length);
    const at = rest.lastIndexOf("@");
    // Do not mistake the leading `@` of a scoped name for the separator
    const aliasName = at > 0 ? rest.slice(0, at) : rest;
    const aliasSpec = at > 0 ? rest.slice(at + 1) : "*";
    return classify(aliasName, aliasSpec);
  }

  for (const [prefix, reason] of PROTOCOL_REASONS) {
    if (spec.toLowerCase().startsWith(prefix)) {
      return { kind: "unresolvable", name, spec, reason };
    }
  }

  // The `user/repo` GitHub shorthand
  if (/^[\w.-]+\/[\w.-]+(#.+)?$/.test(spec) && !spec.startsWith("@")) {
    return { kind: "unresolvable", name, spec, reason: "git dependency" };
  }

  return classify(name, spec);
}

function classify(name: string, spec: string): ParsedSpec {
  if (spec === "" || spec === "*" || spec === "x" || spec === "latest") {
    return { kind: "tag", name, spec: "latest" };
  }
  if (semver.validRange(spec, { loose: true })) {
    return { kind: "range", name, spec };
  }
  // Anything left that looks like a word is treated as a dist-tag (`next`, `beta`, …)
  if (/^[a-z][\w.-]*$/i.test(spec)) {
    return { kind: "tag", name, spec };
  }
  return { kind: "unresolvable", name, spec, reason: "unsupported version specifier" };
}

/** Encode a package name for a registry URL (`@scope/name` becomes `@scope%2fname`) */
export function encodePackageName(name: string): string {
  return name.startsWith("@") ? name.replace("/", "%2f") : encodeURIComponent(name);
}
