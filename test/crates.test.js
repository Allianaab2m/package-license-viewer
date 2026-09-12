require("./vscode-stub");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseManifest, dependencySpec } = require("../out/providers/crates/parse");
const {
  parseRequirement,
  matchesRequirement,
  compareVersions,
} = require("../out/providers/crates/spec");

test("Cargo TOML forms preserve aliases, sections and declaration start lines", () => {
  const text = `[dependencies]
a = "1"
"quoted-name" = { package = "real", version = "2", optional = true }
b.version = "3"
[dev-dependencies.c]
version = "4"
features = [
 "one",
]
[target.'cfg(unix)'.build-dependencies]
d = "5"
[workspace.dependencies]
e = "6"
[package.metadata.dependencies]
hidden = "7"`;
  const parsed = parseManifest(text, "file:///Cargo.toml");
  assert.ok(parsed);
  assert.deepEqual(
    parsed.entries.map((e) => [e.name, e.line]),
    [
      ["a", 1],
      ["quoted-name", 2],
      ["b", 3],
      ["c", 4],
      ["d", 10],
      ["e", 12],
    ]
  );
  assert.equal(parsed.entries[1].declaration.name, "real");
  assert.equal(parsed.entries[4].section, "target.cfg(unix).build-dependencies");
});

test("Cargo inline sections and multiline strings use the start line", () => {
  const parsed = parseManifest('dependencies = { a = "1", b = { version = "2" } }\n', "a");
  assert.deepEqual(
    parsed.entries.map((e) => e.name),
    ["a", "b"]
  );
  assert.equal(parseManifest('[dependencies]\na = """1\n"""', "a").entries[0].line, 1);
  for (const text of ['[dependencies\na="1"', '[dependencies]\na="1"\na="2"'])
    assert.equal(parseManifest(text, "a"), undefined);
});

test("Cargo sources, inheritance and conflicts are explicit", () => {
  for (const source of ["path", "git", "registry", "registry-index"]) {
    assert.equal(dependencySpec("private", { version: "1", [source]: "secret" }).kind, "skipped");
  }
  assert.equal(dependencySpec("a", { workspace: true }).kind, "workspace");
  for (const value of [
    { workspace: false },
    { workspace: true, version: "1" },
    { package: 3, version: "1" },
    {},
  ])
    assert.equal(dependencySpec("a", value).kind, "unknown");
  const parsed = parseManifest(
    '[workspace]\n[patch.crates-io]\nalias={package="real",path="local"}\n[replace]\n"other:1.0.0"={path="other"}',
    "a"
  );
  assert.deepEqual(parsed.overrides, ["other", "real"]);
});

test("Cargo requirement semantics differ from npm and match Rust VersionReq", () => {
  const cases = [
    ["1.2.3", "1.9.0", true],
    ["=1.2.3", "1.9.0", false],
    ["0.2", "0.3.0", false],
    ["0.0", "0.0.9", true],
    ["0", "0.9.0", true],
    ["0.0.3", "0.0.4", false],
    ["^0.2.3", "0.2.9", true],
    ["~1.2", "1.3.0", false],
    ["~1", "1.9.0", true],
    [">1.2", "1.2.99", false],
    [">1.2", "1.3.0", true],
    ["<=1.2", "1.2.99", true],
    ["<1.2", "1.2.0-alpha", false],
    [">=1.2, <2", "1.8.0", true],
    ["1.*", "1.9.0", true],
    ["1.x.*", "2.0.0", false],
    ["=1.2", "1.2.99", true],
    ["*", "1.0.0-alpha", false],
    ["1.0.0-alpha", "1.0.0-beta", true],
    ["1.0.0-alpha", "1.0.1-alpha", false],
    ["1.0.0-alpha", "1.1.0", true],
    [">=1.0.0-alpha, <1.1", "1.0.0-alpha.2", true],
    ["=1.0.0+build", "1.0.0+other", true],
    ["1.0.0-exp", "1.0.0", true],
    ["18446744073709551615", "18446744073709551615.0.0", true],
  ];
  for (const [req, v, expected] of cases)
    assert.equal(matchesRequirement(parseRequirement(req), v), expected, `${req}: ${v}`);
  for (const req of [
    "",
    "latest",
    "1 || 2",
    "1 - 2",
    "1.2.3 2",
    "01",
    "1.02",
    "1.0.0-01",
    "1.0-alpha",
    "1.*.2",
    "*,1",
    "1,",
    "1\t",
    "18446744073709551616",
  ])
    assert.equal(parseRequirement(req).kind, "invalid", req);
  assert.equal(compareVersions("1.0.0-alpha.9", "1.0.0-alpha.10"), -1);
  assert.equal(compareVersions("1.0.0+a", "1.0.0+b"), 0);
});
