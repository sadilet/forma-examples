// Forma's runtime for generated apps. Forma owns this file; a generated app never replaces it.
//
// The generated app lives in app/ (server code) and public/ (static files). app/index.mjs exports a
// default function that receives the kit and returns the routes:
//
//   export default function setup({ db, esc, html, json, text, redirect }) {
//     return { routes: [{ method: "GET", path: "/", handler: (ctx) => html("<h1>Hi</h1>") }], smoke: ["/"] };
//   }
//
// This file has no network access of its own. server.mjs puts it on a port; smoke.mjs calls it directly.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const MAX_BODY = 64 * 1024;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Escapes text for HTML, including attribute values. null and undefined become an empty string.
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

const reply = (status, type, body, headers = {}) => ({ status, headers: { "content-type": type, ...headers }, body });
export const html = (body, status = 200) => reply(status, "text/html; charset=utf-8", String(body ?? ""), {});
export const json = (data, status = 200) => reply(status, "application/json; charset=utf-8", JSON.stringify(data ?? null), {});
export const text = (body, status = 200) => reply(status, "text/plain; charset=utf-8", String(body ?? ""), {});
export const redirect = (location, status = 303) => ({ status, headers: { location: String(location) }, body: "" });

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function compilePattern(pattern) {
  return pattern.split("/").filter(Boolean);
}

function matchPattern(parts, segments) {
  if (parts.length !== segments.length) return null;
  const params = {};
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.startsWith(":")) {
      try {
        params[part.slice(1)] = decodeURIComponent(segments[index]);
      } catch {
        return null;
      }
    } else if (part !== segments[index]) {
      return null;
    }
  }
  return params;
}

function toResponse(result) {
  if (typeof result === "string") return html(result);
  if (result && typeof result === "object" && typeof result.status === "number" && "body" in result) {
    return {
      status: result.status,
      headers: { ...(result.headers ?? {}) },
      body: result.body instanceof Uint8Array ? result.body : String(result.body ?? ""),
    };
  }
  if (result && typeof result === "object") return json(result);
  throw new Error("A route handler returned nothing. Return html(...), json(...), text(...) or redirect(...).");
}

function readStatic(pathname) {
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (relative.includes("\0")) return null;
  const base = path.join(ROOT, "public");
  const file = path.resolve(base, `.${relative}`);
  if (!file.startsWith(base + path.sep)) return null;
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return null;
  try {
    if (!fs.statSync(file).isFile()) return null;
    return reply(200, type, fs.readFileSync(file), { "cache-control": "no-cache" });
  } catch {
    return null;
  }
}

function checkApp(app) {
  if (!app || !Array.isArray(app.routes)) throw new Error("The setup function must return { routes: [...] }.");
  const routes = app.routes.map((route, index) => {
    const method = String(route?.method ?? "").toUpperCase();
    if (!METHODS.has(method)) throw new Error(`Route ${index} has an unsupported method "${route?.method}". Use GET, POST, PUT, PATCH or DELETE.`);
    if (typeof route.path !== "string" || !route.path.startsWith("/")) throw new Error(`Route ${index} needs a path that starts with "/".`);
    if (typeof route.handler !== "function") throw new Error(`Route ${method} ${route.path} needs a handler function.`);
    return { method, path: route.path, parts: compilePattern(route.path), handler: route.handler };
  });
  const smoke = Array.isArray(app.smoke) ? app.smoke.filter((item) => typeof item === "string" && item.startsWith("/")) : [];
  return { routes, smoke };
}

// Loads app/index.mjs against a fresh in-memory database. Anything the app throws while setting up is thrown from here.
export async function boot() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const entry = path.join(ROOT, "app", "index.mjs");
  const module = await import(pathToFileURL(entry).href);
  if (typeof module.default !== "function") throw new Error("app/index.mjs must export a default function.");
  const { routes, smoke } = checkApp(await module.default({ db, esc, html, json, text, redirect }));

  async function dispatch(request) {
    const method = String(request.method ?? "GET").toUpperCase();
    const target = new URL(request.url ?? "/", "http://localhost");
    const pathname = target.pathname;
    const segments = pathname.split("/").filter(Boolean);
    const wantsGet = method === "GET" || method === "HEAD";
    const finish = (response) => ({
      ...response,
      headers: { "x-content-type-options": "nosniff", "referrer-policy": "same-origin", ...response.headers },
    });
    try {
      if (pathname === "/api/health" && wantsGet) return finish(json({ ok: true }));
      for (const route of routes) {
        if (route.method !== (wantsGet ? "GET" : method)) continue;
        const params = matchPattern(route.parts, segments);
        if (!params) continue;
        const body = String(request.body ?? "");
        const headers = request.headers ?? {};
        const context = {
          method,
          path: pathname,
          params,
          query: Object.fromEntries(target.searchParams),
          headers,
          body,
          form() {
            if (String(headers["content-type"] ?? "").includes("application/json")) return this.json();
            return Object.fromEntries(new URLSearchParams(body));
          },
          json() {
            try {
              return JSON.parse(body || "null");
            } catch {
              throw httpError(400, "The request body is not valid JSON.");
            }
          },
        };
        return finish(toResponse(await route.handler(context)));
      }
      if (wantsGet) {
        const file = readStatic(pathname);
        if (file) return finish(file);
      }
      return finish(text("Not found", 404));
    } catch (error) {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
      const detail = error instanceof Error ? error.stack || error.message : String(error);
      if (status === 500) console.error(detail);
      const response = finish(text(status === 500 ? "Something went wrong." : error.message, status));
      return status === 500 ? { ...response, error: detail.split("\n").slice(0, 4).join(" | ") } : response;
    }
  }

  const staticGets = routes.filter((route) => route.method === "GET" && !route.parts.some((part) => part.startsWith(":"))).map((route) => route.path);
  return { dispatch, smoke, staticGets };
}
