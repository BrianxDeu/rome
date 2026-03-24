import { createDb, initTables } from "./db.js";
import { createApp } from "./app.js";

const PORT = parseInt(process.env["PORT"] || "3000", 10);

const { db, sqlite } = createDb();
initTables(sqlite);

const app = createApp(db);

app.listen(PORT, () => {
  console.log(`Rome server listening on port ${PORT}`);
});
