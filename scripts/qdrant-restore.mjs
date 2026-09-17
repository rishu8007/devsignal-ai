import { readFile } from "node:fs/promises";

const argumentsList = process.argv.slice(2);
const collection = argumentsList[argumentsList.indexOf("--collection") + 1];
const input = argumentsList[argumentsList.indexOf("--input") + 1];
if (!collection || !input) throw new Error("Collection and input are required.");

const baseUrl = process.env.QDRANT_URL ?? "http://qdrant:6333";
const encodedCollection = encodeURIComponent(collection);
const headers = process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {};
const existing = await fetch(`${baseUrl}/collections/${encodedCollection}`, { headers });
if (existing.ok) throw new Error("Qdrant target collection already exists; refusing to overwrite it.");
if (existing.status !== 404) throw new Error(`Qdrant collection check failed: ${existing.status}`);

const bytes = await readFile(input);
const form = new FormData();
form.append("snapshot", new Blob([bytes]), "qdrant-collection.snapshot");
const response = await fetch(
  `${baseUrl}/collections/${encodedCollection}/snapshots/recover`,
  { method: "PUT", headers, body: form },
);
if (!response.ok) throw new Error(`Qdrant snapshot restore failed: ${response.status}`);
