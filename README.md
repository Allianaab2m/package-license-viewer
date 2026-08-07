# Package License Viewer

Shows the license of every dependency inline, dimmed at the end of the line.

```jsonc
// package.json
{
  "dependencies": {
    "lodash": "^4.17.21",        // MIT
    "@babel/core": "^7.0.0",     // MIT
    "left-pad": "1.3.0"          // WTFPL
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

Hover an annotation to see the resolved version, where the information came from, and a link to
the package homepage.

| Manifest | Sections read |
| --- | --- |
| `package.json` | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, and any other `*Dependencies` section |
| `deno.json`, `deno.jsonc`, `jsr.json`, `import_map.json` | `imports` — both `jsr:` and `npm:` specifiers |

## How a license is resolved

1. **The installed package, first.** `node_modules/<name>/package.json`, walking up parent
   directories. Instant, works offline, and reflects the version that is actually installed.
2. **The lockfile.** Gives the exact pinned version even when nothing is installed yet.
   `package-lock.json` carries the license itself, so npm projects can resolve with **no network
   access at all**.
3. **The registry.** `registry.npmjs.org` for npm, `jsr.io` for JSR. Results are cached on disk
   for a week.

Specifiers that cannot be resolved — `file:`, `link:`, `workspace:`, `git+…`, `user/repo`,
tarball URLs, `https://` imports — are left un-annotated rather than marked unknown.
`npm:` aliases are followed to their target, and `@jsr/scope__name` (the npm-compatibility name
for a JSR package) is routed to JSR automatically.

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

So no per-package-manager branching is needed for the common case — the only real gap is Yarn
PnP, which the lockfile layer covers. The same layer also handles a freshly cloned repository
where `npm install` has not run yet.

Lockfile formats understood: `package-lock.json` (v1/v2/v3, including workspaces),
`npm-shrinkwrap.json`, `pnpm-lock.yaml` (v5/v6/v9), `yarn.lock` (classic and berry), and
`bun.lock`. `bun.lockb` is binary and is skipped — bun installs into `node_modules`, so that
path covers it.

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
| `packageLicenseViewer.format` | `${license}` | Annotation template. Placeholders: `${license}`, `${version}`, `${name}`, `${source}`. |
| `packageLicenseViewer.showResolvedVersion` | `false` | Append the resolved version, e.g. `MIT · 4.17.21`. |
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
| `packageLicenseViewer.jsr.enabled` | `true` | Enable annotations for Deno / import map manifests. |
| `packageLicenseViewer.jsr.registry` | `https://jsr.io` | JSR registry base URL. |
| `packageLicenseViewer.jsr.apiUrl` | `https://api.jsr.io` | JSR API base URL, where the license lives. |

### A note on JSR licenses

JSR only exposes a license for a version if the package declared one in its `deno.json` /
`jsr.json`. Many packages have not, and for those the API returns `null` — the hover then says
_"the package declares no license on JSR"_. This is a gap in the published metadata, not in the
lookup; nothing else in JSR's API carries the information (the npm-compatibility endpoint at
`npm.jsr.io` does not include a `license` field either).

`deno.lock` is not read yet, so a `jsr:` range resolves against the registry rather than the
version pinned in the lockfile.

## Adding another ecosystem

The extension is built around one interface, so Python, Rust, Go and friends can be added
without touching the rendering, caching or scheduling code.
See [`src/providers/types.ts`](src/providers/types.ts).

```ts
export class CratesLicenseProvider implements LicenseProvider {
  readonly id = "crates";
  supports(document) { return document.uri.path.endsWith("/Cargo.toml"); }
  isEnabled() { return getSetting("crates.enabled", true); }
  parse(document) { /* → DependencyEntry[] (name, spec, section, line) */ }
  cacheKey(entry) { return `crates:${entry.name}@${entry.spec}`; }
  async resolve(entry, document, token) { /* → LicenseInfo */ }
}
```

Register it in [`src/providers/index.ts`](src/providers/index.ts) and add the language to
`activationEvents` in `package.json`. Everything else — debouncing, cancellation, concurrency
limits, the two-level cache, decoration rendering and hovers — is shared.

Metadata endpoints for likely next providers:

- PyPI: `https://pypi.org/pypi/<name>/<version>/json` → `info.license` / `info.classifiers`
- crates.io: `https://crates.io/api/v1/crates/<name>/<version>` → `version.license`
- Go: `https://pkg.go.dev/<module>?tab=licenses` (no JSON API; needs the module proxy or scraping)

## Development

```sh
npm install
npm run watch      # esbuild in watch mode
# press F5 in VS Code to launch the Extension Development Host
```

```sh
npm run check-types      # tsc --noEmit
npm test                 # unit tests, against real lockfile fixtures
npm run test:integration # runs the extension inside a real VS Code
npm run package          # build a .vsix
```

The lockfiles in [`test/fixtures/lockfiles/`](test/fixtures/lockfiles/) were produced by really
running `npm`, `pnpm`, `yarn` (classic and berry) and `bun` against the same manifest, so the
parsers are tested against the real thing rather than hand-written samples.

`npm test` also loads the bundled `dist/extension.js`, because bundling can break the extension
on its own: a dependency whose entry point defers its `require()` calls to runtime resolves
fine under `tsc` and then fails inside the extension host.

## Releasing

[`.github/workflows/release.yml`](.github/workflows/release.yml) is run by hand from the Actions
tab. Give it a version — a bump keyword (`patch`, `minor`, `major`, `prerelease`) or an explicit
version like `0.2.0` — and it does the rest:

1. type-check, unit tests, and the integration suite in a real VS Code
2. bump `package.json` and build the `.vsix`
3. publish to the VS Code Marketplace
4. commit, tag and push, then create the GitHub Release with the `.vsix` attached

Publishing is skipped automatically when `VSCE_PAT` is absent, so the workflow is usable before
you have a token. Get one from <https://marketplace.visualstudio.com/manage> — an Azure DevOps
PAT with the Marketplace → Manage scope — and add it as a repository secret.

Tagging happens only after publishing succeeded, so a failed release leaves no dangling tag.
Tick `dry_run` to rehearse the whole pipeline without publishing, committing or tagging.

---

## 日本語

依存パッケージのライセンスを、行末に薄く表示します。

- 対象は `package.json` の `dependencies` / `devDependencies` / `peerDependencies` /
  `optionalDependencies` と `*Dependencies` で終わるその他のセクション、および
  `deno.json` などの `imports` (`jsr:` と `npm:`)。
- 解決は **`node_modules` → ロックファイル → レジストリ** の順です。
  インストール済みならオフラインかつ即座に、`package-lock.json` がある場合は
  ライセンスまでロックファイルに入っているため**ネットワークアクセスなしで**表示できます。
- **パッケージマネージャごとの分岐は不要でした。** npm / yarn classic / bun は実ディレクトリ、
  pnpm は `.pnpm` へのシンボリックリンクですが読み取りは透過的に辿られ、
  しかも pnpm が最上位にリンクを張るのは直接依存だけ (=注釈を付けたい対象そのもの) です。
  唯一 `node_modules` が存在しない Yarn PnP だけがロックファイル経由になります。
  この挙動は実際に各パッケージマネージャで install して確認済みです。
- `file:` / `workspace:` / git 依存などレジストリで解決できないものは、何も表示しません。
- `npm install` 直後に反映したいときは
  `Package License Viewer: Refresh License Annotations` を実行してください（60 秒で自動追従もします）。

Python (PyPI) や Rust (crates.io) は、`LicenseProvider` を 1 つ実装して
`src/providers/index.ts` に登録するだけで追加できます。
