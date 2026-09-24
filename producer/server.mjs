import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./env.mjs";
import { SyncInputError, syncVideos } from "./youtube-sync-core.mjs";

loadLocalEnv();
const producerRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const host = process.env.PRODUCER_HOST || "127.0.0.1";
const port = Number(process.env.PRODUCER_PORT || 4174);
const contentTypes = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 32_000) reject(new Error("请求体过大"));
    });
    request.on("end", () => resolveBody(body));
    request.on("error", reject);
  });
}

function resolveStaticPath(pathname) {
  const relative = normalize(pathname === "/" ? "index.html" : pathname).replace(/^[/\\]+/, "");
  const filePath = resolve(producerRoot, relative);
  return filePath === producerRoot || filePath.startsWith(`${producerRoot}${sep}`) ? filePath : null;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.pathname === "/api/sync") {
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" });
      response.end("Method Not Allowed");
      return;
    }
    try {
      const body = JSON.parse(await readBody(request));
      const result = await syncVideos(Array.isArray(body.videos) ? body.videos : []);
      sendJson(response, 200, result);
    } catch (error) {
      const status = error instanceof SyncInputError ? 400 : 502;
      sendJson(response, status, { error: error.message || "同步失败" });
    }
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }
  const filePath = resolveStaticPath(url.pathname);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end("Not Found");
    return;
  }
  response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => console.log(`本地数据生产端：http://${host}:${port}`));
