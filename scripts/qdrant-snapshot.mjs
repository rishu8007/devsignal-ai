import { writeFile } from "node:fs/promises";

const argumentsList = process.argv.slice(2);
const collection = argumentsList[argumentsList.indexOf("--collection") + 1];
const output = argumentsList[argumentsList.indexOf("--output") + 1];
if (!collection || !output) throw new Error("Collection and output are required.");

const encodedCollection = encodeURIComponent(collection);
const baseUrl = process.env.QDRANT_URL ?? "http://qdrant:6333";
const headers = process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {};
const createResponse = await fetch(`${baseUrl}/collections/${encodedCollection}/snapshots`, {
  method: "POST",
  headers,
});
if (!createResponse.ok) throw new Error(`Qdrant snapshot creation failed: ${createResponse.status}`);
const created = await createResponse.json();
const snapshotName = created?.result?.name;
if (typeof snapshotName !== "string" || snapshotName.length === 0) {
  throw new Error("Qdrant returned no snapshot name.");
}
const snapshotResponse = await fetch(
  `${baseUrl}/collections/${encodedCollection}/snapshots/${encodeURIComponent(snapshotName)}`,
  { headers },
);
if (!snapshotResponse.ok) throw new Error(`Qdrant snapshot download failed: ${snapshotResponse.status}`);
await writeFile(output, Buffer.from(await snapshotResponse.arrayBuffer()));
