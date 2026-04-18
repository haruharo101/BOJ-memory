import { handleApiOptions, handleBackupImportRequest } from "../../server.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    handleApiOptions(req, res);
    return;
  }

  await handleBackupImportRequest(req, res);
}
