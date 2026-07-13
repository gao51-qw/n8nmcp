import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyProductionArtifacts } from "../src/production-artifact-verifier.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

try {
  const result = verifyProductionArtifacts(
    {
      dbPath: process.env.DB_PATH ?? join(packageRoot, "data/nodes.db"),
      statsPath: process.env.STATS_PATH ?? join(packageRoot, "data/stats.json"),
      reportPath:
        process.env.QUALITY_REPORT_PATH
        ?? join(packageRoot, "data/knowledge-quality-report.json"),
    },
    {
      nodesDb: process.env.EXPECTED_NODES_DB_SHA256,
      stats: process.env.EXPECTED_STATS_SHA256,
      qualityReport: process.env.EXPECTED_KNOWLEDGE_QUALITY_REPORT_SHA256,
    },
  );
  console.log(
    `Production knowledge artifacts verified: templates=${result.templateCount} fts=${result.ftsCount}`,
  );
  console.log(`nodes.db sha256=${result.hashes.nodesDb}`);
  console.log(`stats.json sha256=${result.hashes.stats}`);
  console.log(`knowledge-quality-report.json sha256=${result.hashes.qualityReport}`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
