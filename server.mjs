// Puts the generated app on a port. Forma owns this file; see kit.mjs for what the app can use.
import http from "node:http";
import { MAX_BODY, boot } from "./kit.mjs";

const PORT = Number(process.env.PORT) || 8080;

let app;
try {
  app = await boot();
} catch (error) {
  console.error("The app could not start:", error instanceof Error ? error.stack : error);
  process.exit(1);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    request.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        // Stop keeping the data and answer 413. The connection is closed after the answer is sent.
        tooLarge = true;
        chunks.length = 0;
        reject(Object.assign(new Error("Request too large"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const body = await readBody(request);
    const result = await app.dispatch({ method: request.method, url: request.url, headers: request.headers, body });
    response.writeHead(result.status, result.headers);
    response.end(request.method === "HEAD" ? undefined : result.body);
  } catch (error) {
    const tooLarge = error?.status === 413;
    if (!tooLarge) console.error(error);
    if (!response.headersSent) {
      response.writeHead(tooLarge ? 413 : 500, { "content-type": "text/plain", connection: "close" });
    }
    response.end(tooLarge ? "Request too large" : "Something went wrong", () => {
      if (tooLarge) request.destroy();
    });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
