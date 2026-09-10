# Package License Viewer

Shows the license of every dependency inline, dimmed at the end of the line.

```jsonc
// package.json
{
  "dependencies": {
    "lodash": "^4.17.21",        // MIT
    "@babel/core": "^7.0.0",     // MIT
    "left-pad": "1.3.0",         // WTFPL
    "axios": "^1.1.1"            // MIT (Node: >=20)
  },
  "devDependencies": {
    "typescript": "^5.7.2"       // Apache-2.0
  }
}
```

```jsonc
// deno.json
{
  "imports": {
    "@std/fs": "jsr:@std/fs@^1.0.0",   // MIT
    "chalk": "npm:chalk@^5.3.0"        // MIT
  }
}
```

When a package declares an `engines.node` range, it's appended to the annotation too, as shown for `axios` above. Hover an annotation to see the resolved version, where the information came from, and a link to the package homepage.

| Manifest | Sections read |
| --- | --- |
| `package.json` | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, and any other `*Dependencies` section |
| `deno.json`, `deno.jsonc`, `jsr.json`, `import_map.json` | `imports` — both `jsr:` and `npm:` specifiers |
| `pnpm-workspace.yaml` | `catalog:` and `catalogs:` — the actual ranges a workspace catalog resolves to |

## How a license is resolved

1. **The installed package, first.** `node_modules/<name>/package.json`, walking up parent directories. Instant, works offline, and reflects the version that is actually installed.
2. **The lockfile.** Gives the exact pinned version even when nothing is installed yet. `package-lock.json` carries the license itself, so npm projects can resolve with **no network access at all**.
3. **The registry.** `registry.npmjs.org` for npm, `jsr.io` for JSR. Results are cached on disk for a week.

Specifiers that cannot be resolved — `file:`, `link:`, `workspace:`, `git+…`, `user/repo`, tarball URLs, `https://` imports — are left un-annotated rather than marked unknown. A pnpm workspace catalog reference (`catalog:`, `catalog:<name>`) has no version of its own in `package.json` to resolve against the registry, but `pnpm-lock.yaml` records what it resolved to, so it works wherever the lockfile is readable — and `pnpm-workspace.yaml` itself is annotated too, so the actual range behind a catalog entry is visible right where it's declared. `npm:` aliases are followed to their target. JSR packages inside `package.json` are recognized either way they show up — the npm-compatibility alias `@jsr/scope__name`, or the native `jsr:<range>` / `jsr:@scope/name@<range>` specifier pnpm ≥10.9 and Yarn ≥4.9 write directly — and routed to JSR automatically, since the npm-compatibility registry never publishes a license for them, installed or not.

The hover title links to the npmjs.org package page for dependencies that really are npm registry packages (following an `npm:` alias to its actual target), and to the matching JSR page for JSR packages — never to npmjs.org for those, since they aren't published there under their JSR or npm-compatibility name.

### Package managers

Every layout below was verified by actually installing with that package manager.

| | Layout | How it resolves |
| --- | --- | --- |
| **npm** | hoisted real directories | `node_modules` |
| **yarn classic** | hoisted real directories | `node_modules` |
| **bun** | hoisted real directories | `node_modules` |
| **pnpm** | `node_modules/<name>` symlinks into `node_modules/.pnpm/…` | `node_modules` — reads follow the symlink, and pnpm links exactly the direct dependencies, which is what gets annotated |
| **yarn berry** (`nodeLinker: node-modules`) | real directories | `node_modules` |
| **yarn berry** (PnP) | **no `node_modules` at all** | `yarn.lock` for the pinned version, then the registry for its license |

So no per-package-manager branching is needed for the common case — the only real gap is Yarn PnP, which the lockfile layer covers. The same layer also handles a freshly cloned repository where `npm install` has not run yet.

Lockfile formats understood: `package-lock.json` (v1/v2/v3, including workspaces), `npm-shrinkwrap.json`, `pnpm-lock.yaml` (v5/v6/v9), `yarn.lock` (classic and berry), and `bun.lock`. `bun.lockb` is binary and is skipped — bun installs into `node_modules`, so that path covers it.

## Commands

| Command | Description |
| --- | --- |
| `Package License Viewer: Refresh License Annotations` | Re-read `node_modules` and lockfiles, then redraw. Use after `npm install`. |
| `Package License Viewer: Clear License Cache` | Drop everything cached from the registries. |
| `Package License Viewer: Toggle Inline License Annotations` | Turn the annotations on or off. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `packageLicenseViewer.enabled` | `true` | Show inline license annotations. |
| `packageLicenseViewer.format` | `${license}` | Annotation template. Placeholders: `${license}`, `${version}`, `${name}`, `${source}`, `${nodeEngine}`. |
| `packageLicenseViewer.showResolvedVersion` | `false` | Append the resolved version, e.g. `MIT · 4.17.21`. |
| `packageLicenseViewer.showNodeEngine` | `true` | Append the package's `engines.node` range, when it has one, e.g. `MIT (Node: >=20)`. |
| `packageLicenseViewer.unknownText` | `""` | Text shown when the license is unknown. Empty means show nothing. |
| `packageLicenseViewer.annotationColor` | `editorCodeLens.foreground` | Theme color id, or a CSS color such as `#88888899`. |
| `packageLicenseViewer.margin` | `0 0 0 1.5em` | CSS margin before the annotation. |
| `packageLicenseViewer.cacheTtlHours` | `168` | Lifetime of cached registry results. `0` disables the on-disk cache. |
| `packageLicenseViewer.requestTimeoutMs` | `8000` | Timeout of a single registry request. |
| `packageLicenseViewer.maxConcurrentRequests` | `8` | Parallel registry requests. |
| `packageLicenseViewer.npm.enabled` | `true` | Enable annotations for `package.json`. |
| `packageLicenseViewer.npm.registry` | `https://registry.npmjs.org` | Registry base URL. |
| `packageLicenseViewer.npm.useRegistry` | `true` | Allow registry lookups. Set to `false` to stay fully offline. |
| `packageLicenseViewer.npm.useLockfiles` | `true` | Read lockfiles for exact pinned versions. |
| `packageLicenseViewer.npm.sections` | 4 standard sections | Sections that are always annotated. |
| `packageLicenseViewer.npm.autoDetectSections` | `true` | Also annotate other top-level objects whose key ends with `dependencies`. |
| `packageLicenseViewer.npm.pnpmWorkspaceCatalogs` | `true` | Also annotate the `catalog:` and `catalogs:` sections of `pnpm-workspace.yaml`. |
| `packageLicenseViewer.jsr.enabled` | `true` | Enable annotations for Deno / import map manifests. |
| `packageLicenseViewer.jsr.registry` | `https://jsr.io` | JSR registry base URL. |
| `packageLicenseViewer.jsr.apiUrl` | `https://api.jsr.io` | JSR API base URL, where the license lives. |

### A note on JSR licenses

JSR only exposes a license for a version if the package declared one in its `deno.json` / `jsr.json`. Many packages have not, and for those the API returns `null` — the hover then says _"the package declares no license on JSR"_. This is a gap in the published metadata, not in the lookup; nothing else in JSR's API carries the information (the npm-compatibility endpoint at `npm.jsr.io` does not include a `license` field either).

`deno.lock` is not read yet, so a `jsr:` range resolves against the registry rather than the version pinned in the lockfile.

## Other languages

npm and JSR are covered today. Python (PyPI), Rust (crates.io) and Go are planned — the extension is built around a provider interface specifically so an ecosystem is one class away, without touching rendering, caching or scheduling. Every ecosystem is expected to link the hover title to its own registry page too, the same way npm and JSR already do. See [CONTRIBUTING.md](CONTRIBUTING.md) if you'd like to add one, or just want to see how it's structured.

## Author

otoneko. https://github.com/otnc

## License

[MIT](LICENSE)
