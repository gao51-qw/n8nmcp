import { fileURLToPath } from "node:url";
import { createOfficialTemplateClient } from "../src/template-ingestion/official-client.js";
import { stageOfficialTemplates } from "../src/template-ingestion/template-publication.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const targetDirectory = fileURLToPath(new URL("../.tmp/templates/", import.meta.url));
const curatedDirectory = fileURLToPath(new URL("../data/curated-templates/", import.meta.url));

const manifest = await stageOfficialTemplates({
  client: createOfficialTemplateClient(),
  curatedDirectory,
  targetDirectory,
});

console.log(`Staged ${manifest.acceptedCount} official templates.`);
console.log(`Manifest: ${targetDirectory.slice(packageRoot.length + 1)}/official-manifest.json`);
