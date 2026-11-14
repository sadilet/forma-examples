// Starts the generated app in memory and asks it for its pages. Forma runs this before anything is shipped,
// as `node --permission --allow-fs-read=<folder> smoke.mjs`, so the app cannot touch the network or write files.
// The last line it prints is one JSON object: { ok, error, results: [{ path, status, error, bytes }] }.
import { boot } from "./kit.mjs";

const report = { ok: false, error: null, results: [] };

try {
  const app = await boot();
  // Pages the app promised (and the two it must have) have to open. Any other page just must not crash.
  const required = new Set(["/", "/about", ...app.smoke]);
  const paths = [...new Set([...required, "/api/health", ...app.staticGets])];
  for (const path of paths) {
    const response = await app.dispatch({ method: "GET", url: path, headers: {}, body: "" });
    report.results.push({
      path,
      required: required.has(path),
      status: response.status,
      error: response.error ? String(response.error).slice(0, 600) : null,
      bytes: typeof response.body === "string" ? response.body.length : (response.body?.length ?? 0),
    });
  }
  report.ok = true;
} catch (error) {
  report.error = (error instanceof Error ? error.stack || error.message : String(error)).split("\n").slice(0, 6).join(" | ").slice(0, 900);
}

process.stdout.write(`\n@@SMOKE@@${JSON.stringify(report)}\n`);
process.exit(0);
