import * as vscode from "vscode";
import type { ViewerConfig } from "./config";
import type { DependencyEntry, LicenseInfo } from "./providers";

/**
 * Build the dimmed text drawn at the end of the line.
 * Returns undefined when nothing should be shown.
 */
export function formatAnnotation(
  config: ViewerConfig,
  entry: DependencyEntry,
  info: LicenseInfo
): string | undefined {
  if (!info.license) {
    // Things we never meant to resolve (git dependencies and the like) stay quiet
    if (info.source === "skipped") {
      return undefined;
    }
    return config.unknownText.trim().length > 0 ? config.unknownText : undefined;
  }

  let text = config.format
    .replace(/\$\{license\}/g, info.license)
    .replace(/\$\{version\}/g, info.version ?? "")
    .replace(/\$\{name\}/g, entry.name)
    .replace(/\$\{source\}/g, info.source)
    .trim();

  if (text.length === 0) {
    return undefined;
  }

  if (config.showResolvedVersion && info.version && !config.format.includes("${version}")) {
    text = `${text} · ${info.version}`;
  }

  // Decoration text cannot contain line breaks
  return text.replace(/\s*\r?\n\s*/g, " ");
}

/** The detail shown when hovering an annotation */
export function buildHover(
  entry: DependencyEntry,
  info: LicenseInfo
): vscode.MarkdownString | undefined {
  const lines: string[] = [];
  // Backticks, not just bold: "name@1.2.3" is a syntactically valid GFM extended email autolink (numeric domain labels are allowed), so VS Code's hover renderer turns "lodash@4.17.21" into a mailto: link unless it sits inside a code span. Nesting the code span inside a real link (when we know the npmjs.org package name) still renders fine and doesn't reopen the autolink issue — verified against `marked`, the renderer VS Code uses.
  const label = info.version ? `\`${entry.name}@${info.version}\`` : `\`${entry.name}\``;
  // A genuine npm package (registryPackageName) always wins over a generic packagePageUrl — an npm alias could in principle collide with something else setting the latter.
  const titleUrl =
    info.registryPackageName && info.version
      ? npmPackageUrl(info.registryPackageName, info.version)
      : info.packagePageUrl;
  lines.push(titleUrl ? `**[${label}](${titleUrl})**` : `**${label}**`);

  if (info.license) {
    lines.push(`License: \`${info.license}\``);
  } else if (info.detail) {
    lines.push(`License: _unknown_ — ${info.detail}`);
  } else {
    lines.push("License: _unknown_");
  }

  if (info.nodeEngine) {
    lines.push(`Node: \`${info.nodeEngine}\``);
  }

  lines.push(`Resolved from: ${describeSource(info)}`);

  // Skip a "Homepage" line that would just repeat the link the title already has (JSR has no separately declared homepage, so its package page serves as both).
  if (info.homepage && /^https?:\/\//i.test(info.homepage) && info.homepage !== titleUrl) {
    lines.push(`[Homepage](${info.homepage})`);
  }

  const markdown = new vscode.MarkdownString(lines.join("\n\n"));
  markdown.isTrusted = false;
  return markdown;
}

/**
 * Build the npmjs.org package page URL, e.g. `https://www.npmjs.com/package/@babel/core/v/7.24.0`.
 * The scope's `@` and `/` are left as-is — npm's own site uses them unencoded in this path.
 */
function npmPackageUrl(name: string, version: string): string {
  return `https://www.npmjs.com/package/${name}/v/${encodeURIComponent(version)}`;
}

function describeSource(info: LicenseInfo): string {
  switch (info.source) {
    case "local":
      return info.via ?? "installed package (`node_modules`)";
    case "lockfile":
      return info.via ?? "lockfile";
    case "registry":
      return info.via ?? "registry";
    case "skipped":
      return info.detail ?? "not applicable";
    default:
      return info.detail ?? "not resolved";
  }
}
