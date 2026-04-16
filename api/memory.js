import { handleMemoryRequest } from "../server.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    });
    res.end();
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405, {
      "access-control-allow-origin": "*",
      "allow": "GET, OPTIONS",
    });
    res.end("Method not allowed");
    return;
  }

  await handleMemoryRequest(req, res);
}
