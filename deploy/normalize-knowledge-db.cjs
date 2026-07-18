const Database = require("/app/node_modules/better-sqlite3");

const db = new Database("/source-data/nodes.db");
const mode = db.pragma("journal_mode = DELETE", { simple: true });
db.close();

if (mode !== "delete") {
  throw new Error(`Expected delete journal mode, received ${String(mode)}`);
}

console.log("journal=delete");
