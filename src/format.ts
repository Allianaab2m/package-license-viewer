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
export function buildHover(entry: DependencyEntry, info: LicenseInfo): vscode.MarkdownString | undefined {
  const lines: string[] = [];
  const title = info.version ? `**${entry.name}@${info.version}**` : `**${entry.name}**`;
  lines.push(title);

  if (info.license) {
    lines.push(`License: \`${info.license}\``);
  } else if (info.detail) {
    lines.push(`License: _unknown_ — ${info.detail}`);
  } else {
    lines.push("License: _unknown_");
  }

  lines.push(`Resolved from: ${describeSource(info)}`);

  if (info.homepage && /^https?:\/\//i.test(info.homepage)) {
    lines.push(`[Homepage](${info.homepage})`);
  }

  const markdown = new vscode.MarkdownString(lines.join("\n\n"));
  markdown.isTrusted = false;
  return markdown;
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
