# Change Log

## [0.1.0]

Initial release.

### Inline license annotations

- Dimmed license at the end of each dependency line, with a hover showing the resolved version,
  the source of the information and the package homepage.
- `package.json`: `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`
  and any other `*Dependencies` section.
- `deno.json`, `deno.jsonc`, `jsr.json`, `import_map.json`: `imports`, for both `jsr:` and
  `npm:` specifiers.

### Resolution

- `node_modules` first — offline, hoisting and monorepo aware. Verified against npm, pnpm,
  yarn classic, yarn berry (`nodeLinker: node-modules`) and bun.
- Lockfiles second, for the exact pinned version: `package-lock.json` (v1/v2/v3, workspaces),
  `npm-shrinkwrap.json`, `pnpm-lock.yaml` (v5/v6/v9), `yarn.lock` (classic and berry), `bun.lock`.
  This is what makes Yarn PnP and not-yet-installed workspaces work. `package-lock.json` carries
  the license itself, so npm projects resolve with no network access at all.
- Registries last: `registry.npmjs.org` and `jsr.io`. `npm:` aliases are followed, and
  `@jsr/scope__name` is routed to JSR.
- Unresolvable specifiers (`file:`, `link:`, `workspace:`, git, tarball URLs) are left
  un-annotated instead of being marked unknown.

### Infrastructure

- Two-level cache (in-memory + on-disk) with a configurable TTL, request cancellation, a
  concurrency limit, and flicker-free redrawing while typing.
- Provider-based architecture so other ecosystems can be added by implementing one interface.
- CI, an integration suite that runs the extension inside a real VS Code, and a manually
  triggered release workflow that publishes to the VS Code Marketplace.

### Fixed before the first release

- Only some dependencies were annotated, and they took a while to appear. Opening a manifest
  fires activation and two editor events in a burst; each update cancelled the previous one,
  and because in-flight resolutions are shared by cache key, a newer update ended up waiting on
  a promise created by an older, now-cancelled one. The answer arrived correctly and was then
  discarded purely because the first caller's token had been cancelled. On this repository's own
  `package.json` that meant 4 of 12 licenses were drawn and the rest never were; now all 12 are
  drawn within about 55ms of opening the file.
- The bundled extension failed to load at all: `jsonc-parser`'s `main` is a UMD file whose inner
  `require()` calls esbuild cannot follow, so they survived into the bundle and threw inside the
  extension host. esbuild now prefers the `module` entry point, and both the unit and integration
  suites load the real bundle so this cannot regress silently.

### Known limitations

- JSR reports a license only for packages that declared one; the API returns `null` otherwise.
- `deno.lock` is not read, so `jsr:` ranges resolve against the registry.
- `bun.lockb` (the binary lockfile) is not parsed; bun's `node_modules` covers that case.
