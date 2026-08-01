import { createServer } from "node:http";

const host = "0.0.0.0";
const port = 8787;

const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/deploy") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const idempotencyKey = request.headers["idempotency-key"] ?? null;
  const jobId = `mock_${Date.now()}`;

  console.log("Mock deploy hook accepted", {
    job_id: jobId,
    idempotency_key: idempotencyKey,
  });

  response.writeHead(201, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ job: { id: jobId } }));
});

server.listen(port, host, () => {
  console.log(`Mock deploy hook listening on http://127.0.0.1:${port}/deploy`);
});

const shutdown = () => {
  server.close((error) => {
    if (error) {
      console.error("Mock deploy hook shutdown failed");
      process.exitCode = 1;
    }
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
