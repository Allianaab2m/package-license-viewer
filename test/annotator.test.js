// Load the vscode stub first, because the modules under test require it
const { fakeDocument, fakeEditor, setVisibleEditors } = require("./vscode-stub");

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const OUT = path.join(__dirname, "..", "out");
const { Annotator } = require(OUT + "/annotator.js");

const MANIFEST = `{
  "name": "demo",
  "dependencies": {
    "alpha": "^1.0.0",
    "bravo": "^2.0.0",
    "charlie": "^3.0.0",
    "delta": "^4.0.0",
    "echo": "^5.0.0"
  }
}`;

const DEPENDENCY_COUNT = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A provider that answers after a delay, so resolution really is still in flight */
class SlowProvider {
  constructor(delayMs) {
    this.id = "fake";
    this.delayMs = delayMs;
    this.resolveCalls = 0;
  }
  supports() {
    return true;
  }
  isEnabled() {
    return true;
  }
  parse(document) {
    const entries = [];
    const lines = document.getText().split("\n");
    lines.forEach((text, line) => {
      const match = /^\s+"([a-z]+)":\s*"(\^[\d.]+)"/.exec(text);
      if (match) {
        entries.push({ name: match[1], spec: match[2], section: "dependencies", line });
      }
    });
    return entries;
  }
  cacheKey(entry) {
    return `${this.id}:${entry.name}@${entry.spec}`;
  }
  async resolve(entry) {
    this.resolveCalls++;
    await sleep(this.delayMs);
    return { license: "MIT", version: "1.0.0", source: "local", name: entry.name };
  }
}

function setup(provider) {
  const document = fakeDocument(MANIFEST);
  const editor = fakeEditor(document);
  setVisibleEditors([editor]);
  return { document, editor, annotator: new Annotator([provider]) };
}

/**
 * The regression this file exists for.

 * Opening a manifest fires activation, onDidChangeActiveTextEditor and onDidChangeVisibleTextEditors in quick succession. Each update used to cancel the previous one, and because in-flight resolutions are shared by cache key, a newer update would end up awaiting a promise created by an older, now-cancelled one. The answer arrived correctly and was then discarded purely because the *first* caller's token had been cancelled, so those dependencies showed no license until some later event happened to redraw them. That looked like "only some packages get a license, and they take a while to show up".
 */
test("a burst of refreshes still annotates every dependency", async () => {
  const provider = new SlowProvider(40);
  const { editor, annotator } = setup(provider);

  // Three refreshes back to back, exactly like opening a package.json
  annotator.refreshAll();
  annotator.refreshAll();
  annotator.refreshAll();

  await sleep(400);

  assert.ok(editor.lastDecorations, "the editor should have been decorated");
  assert.equal(
    editor.lastDecorations.length,
    DEPENDENCY_COUNT,
    "every dependency should end up annotated after a burst of refreshes"
  );
  annotator.dispose();
});

test("each dependency is resolved only once across a burst of refreshes", async () => {
  const provider = new SlowProvider(10);
  const { annotator } = setup(provider);

  annotator.refreshAll();
  annotator.refreshAll();
  annotator.refreshAll();

  await sleep(300);

  assert.equal(
    provider.resolveCalls,
    DEPENDENCY_COUNT,
    "each dependency should be resolved once, not once per refresh"
  );
  annotator.dispose();
});

test("annotations land on the line of their dependency", async () => {
  const provider = new SlowProvider(0);
  const { document, editor, annotator } = setup(provider);

  annotator.refreshAll();
  await sleep(300);

  const decorations = editor.lastDecorations ?? [];
  assert.equal(decorations.length, DEPENDENCY_COUNT);
  for (const decoration of decorations) {
    const line = decoration.range.startLine;
    const text = document.lineAt(line).text;
    assert.match(text, /"(alpha|bravo|charlie|delta|echo)"/);
    // The annotation is drawn at the end of the line
    assert.equal(decoration.range.startCharacter, text.length);
    assert.equal(decoration.renderOptions.after.contentText, "MIT");
  }
  annotator.dispose();
});

test("results are reused on a later refresh rather than resolved again", async () => {
  const provider = new SlowProvider(0);
  const { annotator } = setup(provider);

  annotator.refreshAll();
  await sleep(200);
  assert.equal(provider.resolveCalls, DEPENDENCY_COUNT);

  annotator.refreshAll();
  await sleep(200);
  assert.equal(provider.resolveCalls, DEPENDENCY_COUNT, "cached results should be reused");

  // invalidate() drops them, so the next pass has to resolve again
  annotator.invalidate();
  annotator.refreshAll();
  await sleep(200);
  assert.equal(provider.resolveCalls, DEPENDENCY_COUNT * 2);

  annotator.dispose();
});

test("a provider that throws does not stop the other dependencies", async () => {
  const provider = new SlowProvider(0);
  provider.resolve = async (entry) => {
    provider.resolveCalls++;
    if (entry.name === "charlie") {
      throw new Error("boom");
    }
    return { license: "MIT", version: "1.0.0", source: "local" };
  };
  const { editor, annotator } = setup(provider);

  annotator.refreshAll();
  await sleep(300);

  assert.equal(
    (editor.lastDecorations ?? []).length,
    DEPENDENCY_COUNT - 1,
    "the failing dependency is skipped, the rest are still annotated"
  );
  annotator.dispose();
});
