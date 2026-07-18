import { resolve } from "node:path";
import { importTemplates } from "../src/template-ingestion/template-importer.js";

const dbPath = resolve(process.cwd(), process.env.DB_PATH ?? "data/nodes.db");
const sourceDir = resolve(
  process.cwd(),
  process.env.TEMPLATES_DIR ?? ".tmp/templates/merged",
);

importTemplates({ dbPath, sourceDir })
  .then((result) => {
    console.log(`[templates] imported=${result.imported} skipped=${result.skipped}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
