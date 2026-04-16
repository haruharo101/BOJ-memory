import { corsHeaders, handleApiOptions, handleMemoryRequest, validateFrontendRequest } from "../server.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    handleApiOptions(req, res);
    return;
  }

  if (!validateFrontendRequest(req, res)) return;

  if (req.method !== "GET") {
    res.writeHead(405, corsHeaders(req, {
      "allow": "GET, OPTIONS",
      "content-type": "text/plain; charset=utf-8",
    }));
    res.end("Method not allowed");
    return;
  }

  await handleMemoryRequest(req, res);
}
