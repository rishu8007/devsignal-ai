import { createServer } from "node:http";

const port = Number(process.env.BROWSER_AI_PORT ?? 8100);
const longText = (angle) =>
  `${angle} deterministic browser integration draft. This synthetic provider response is deliberately long enough to satisfy the production draft contract and gives the browser suite stable content without contacting an external AI provider.`;

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/api/v1/generations") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ success: false }));
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    success: true,
    data: {
      model: "browser-test-model",
      variations: [
        { angle: "technical_depth", content: longText("Technical depth"), citations: [] },
        { angle: "learning_story", content: longText("Learning story"), citations: [] },
        { angle: "professional_impact", content: longText("Professional impact"), citations: [] },
      ],
    },
    usage: { model: "browser-test-model", inputTokens: 12, outputTokens: 90, embeddingTokens: null },
  }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Browser test AI adapter listening on ${port}`);
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
