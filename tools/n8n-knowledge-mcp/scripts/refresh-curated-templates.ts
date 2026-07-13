import { fileURLToPath } from "node:url";
import { createOfficialTemplateClient } from "../src/template-ingestion/official-client.js";
import { refreshCuratedTemplates } from "../src/template-ingestion/template-publication.js";

const targetDirectory = fileURLToPath(new URL("../data/curated-templates/", import.meta.url));
const snapshots = await refreshCuratedTemplates({
  client: createOfficialTemplateClient(),
  targetDirectory,
});

console.log(`Refreshed ${snapshots.length} curated template snapshots.`);
