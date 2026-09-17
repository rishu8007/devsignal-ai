const argumentsList = process.argv.slice(2);
const collection = argumentsList[argumentsList.indexOf("--collection") + 1];
const location = argumentsList[argumentsList.indexOf("--location") + 1];
if (!collection || !location) throw new Error("Collection and location are required.");

const baseUrl = process.env.QDRANT_URL ?? "http://qdrant:6333";
const encodedCollection = encodeURIComponent(collection);
const headers = process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {};
const existing = await fetch(`${baseUrl}/collections/${encodedCollection}`, { headers });
if (existing.ok) throw new Error("Qdrant target collection already exists; refusing to overwrite it.");
if (existing.status !== 404) throw new Error(`Qdrant collection check failed: ${existing.status}`);

const response = await fetch(
  `${baseUrl}/collections/${encodedCollection}/snapshots/recover`,
  {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ location }),
  },
);
if (!response.ok) throw new Error(`Qdrant snapshot restore failed: ${response.status}`);
