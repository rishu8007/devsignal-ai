import assert from "node:assert/strict";
import test from "node:test";
import {
  BlobWriter,
  TextReader,
  Uint8ArrayReader,
  ZipWriter,
} from "@zip.js/zip.js";
import {
  assembleRepositoryDocuments,
  inspectRepositoryZip,
  validateRepositoryNote,
} from "../src/lib/knowledge/repository-zip-import";

async function makeZip(entries: Record<string, string>): Promise<Blob> {
  const writer = new BlobWriter("application/zip");
  const zip = new ZipWriter(writer, { useWebWorkers: false });
  for (const [path, text] of Object.entries(entries)) {
    await zip.add(path, new TextReader(text));
  }
  await zip.close();
  return writer.getData();
}

test("selects supported documents and assembles them in path order", async () => {
  const result = await inspectRepositoryZip(
    await makeZip({
      "docs/z.txt": "Zeta document.",
      "README.MD": "Readme document.",
      "src/app.ts": "not imported",
      "node_modules/dependency.md": "excluded",
    }),
  );

  assert.deepEqual(result.files.map((file) => file.path), ["docs/z.txt", "README.MD"]);
  assert.equal(
    assembleRepositoryDocuments(result.files),
    "## docs/z.txt\n\nZeta document.\n\n## README.MD\n\nReadme document.",
  );
  assert.equal(result.skipped.length, 2);
});

test("rejects unsafe and duplicate paths", async () => {
  await assert.rejects(
    async () => inspectRepositoryZip(await makeZip({ "../notes.md": "unsafe path" })),
    /Unsafe (archive path|filename)/,
  );
  const writer = new BlobWriter("application/zip");
  const zip = new ZipWriter(writer, { useWebWorkers: false });
  await zip.add("notes.md", new TextReader("one"));
  await zip.add("NOTES.md", new TextReader("two"));
  await zip.close();
  const duplicateArchive = await writer.getData();
  await assert.rejects(() => inspectRepositoryZip(duplicateArchive), /duplicate|ambiguous/);
});

test("skips invalid UTF-8 and NUL-containing documentation", async () => {
  const invalid = new Uint8Array([0xc3, 0x28]);
  const writer = new BlobWriter("application/zip");
  const zip = new ZipWriter(writer, { useWebWorkers: false });
  await zip.add("invalid.md", new Uint8ArrayReader(invalid));
  await zip.add("nul.txt", new TextReader("valid\0text"));
  await zip.add("valid.md", new TextReader("A valid document."));
  await zip.close();

  const result = await inspectRepositoryZip(await writer.getData());
  assert.deepEqual(result.files.map((file) => file.path), ["valid.md"]);
  assert.match(result.skipped.find((item) => item.path === "invalid.md")?.reason ?? "", /UTF-8/);
  assert.match(result.skipped.find((item) => item.path === "nul.txt")?.reason ?? "", /NUL/);
});

test("skips files over the per-file limit and rejects empty documentation archives", async () => {
  const oversized = await makeZip({ "large.md": "x".repeat(100 * 1024 + 1) });
  await assert.rejects(() => inspectRepositoryZip(oversized), /no supported documentation/);

  const onlyCode = await makeZip({ "src/index.ts": "const value = 1;" });
  await assert.rejects(() => inspectRepositoryZip(onlyCode), /no supported documentation/);
});

test("enforces aggregate and final note limits, and honors cancellation", async () => {
  const entries: Record<string, string> = {};
  for (let index = 0; index < 11; index += 1) {
    entries[`docs/${index}.md`] = "x".repeat(100 * 1024);
  }
  await assert.rejects(
    async () => inspectRepositoryZip(await makeZip(entries)),
    /1 MiB total extraction limit/,
  );
  assert.match(validateRepositoryNote("title", "short") ?? "", /10–20,000/);
  assert.match(validateRepositoryNote("title", "x".repeat(20_001)) ?? "", /10–20,000/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    async () => inspectRepositoryZip(await makeZip({ "notes.md": "some notes" }), controller.signal),
    /Abort/,
  );
});
