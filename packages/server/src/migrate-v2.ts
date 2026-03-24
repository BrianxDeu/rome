/**
 * V2 Migration: Strip number prefixes, add dates/budgets, clean up
 * Usage: npx tsx packages/server/src/migrate-v2.ts
 */
import Database from "better-sqlite3";

const dbPath = process.env["DATABASE_PATH"] || "rome.db";
const db = new Database(dbPath);

// 1. Strip number prefixes (1.1, 2.3, etc.) from node names
const stripNumbers = db.prepare(`
  UPDATE nodes SET name = TRIM(SUBSTR(name, INSTR(name, ' ') + 1))
  WHERE name GLOB '[0-9]*.[0-9]* *'
`);
const stripped = stripNumbers.run();
console.log(`Stripped number prefixes from ${stripped.changes} nodes`);

// 2. Delete stray test nodes
const deleteJunk = db.prepare(`DELETE FROM nodes WHERE name IN ('fdsf', 'test', 'asdf')`);
const deleted = deleteJunk.run();
console.log(`Deleted ${deleted.changes} junk nodes`);

// 3. Add dates and budgets to all DxD nodes
const updates: [string, string, string, number | null][] = [
  // Halo MVP nodes: [name pattern, startDate, endDate, budget]
  ["Build PM Software",              "2026-03-01", "2026-04-15", 0],
  ["Flannery%Meeting%",              "2026-03-24", "2026-03-28", 0],
  ["Serge Picks Sensors%",           "2026-03-25", "2026-04-05", 0],
  ["Build Hardware Budget%",         "2026-04-01", "2026-04-15", 500000],
  ["Serge Sends Ukraine%",           "2026-03-15", "2026-03-30", 0],
  ["Serge Delivers Pat%",            "2026-03-20", "2026-04-01", 0],
  ["Distill Transcript%",            "2026-03-25", "2026-04-10", 0],
  ["Mind-Meld Week%",                "2026-03-24", "2026-03-31", 0],
  ["Wispr Flow%",                    "2026-03-20", "2026-04-30", 27],
  ["Warhead Meeting",                "2026-04-01", "2026-04-05", 0],
  ["%Georgia%Cobb%",                 "2026-04-07", "2026-04-11", 2000],
  ["%Group Chat%Jeremy%",            "2026-03-25", "2026-03-28", 0],
  ["%Videographer%",                 "2026-03-28", "2026-04-10", 1000],
  ["%April Testing%North Carolina%", "2026-04-14", "2026-04-18", 15000],
  ["%April Testing%Ranch%",          "2026-04-21", "2026-04-25", 10000],
  ["Hire 2 Engineers%",              "2026-04-01", "2026-06-30", 200000],
  ["Ukraine Forward%",               "2026-06-01", "2026-08-31", 250000],
  ["%CEP Hardware%",                 "2026-05-01", "2026-07-31", 50000],
  ["%Warhead Integration%",          "2026-05-15", "2026-09-30", 100000],
  // Orcrest nodes
  ["Scott Updates TRLs%",            "2026-03-10", "2026-03-20", 0],
  ["%Defeat Footage%Statistical%",   "2026-04-14", "2026-05-15", 5000],
  ["Pause Contract%",                "2026-03-15", "2026-03-22", 0],
  ["%Orcrest Integration%Halo%",     "2026-05-01", "2026-07-31", 50000],
  ["%Florida Lab%",                  "2026-04-15", "2026-06-30", 30000],
  // LAPD nodes
  ["%Flannery Meeting%API Architecture%", "2026-03-24", "2026-04-05", 0],
  ["%Georgia%Cobb%Shared%",          "2026-04-07", "2026-04-11", 0],
  ["%LAPD White-Label%",             "2026-05-01", "2026-08-31", 0],
  ["%Accenture%",                    "2026-04-01", "2026-06-30", 0],
  // Workstream headers
  ["HALO MVP",                       "2026-03-01", "2026-09-30", 1000000],
  ["ORCREST",                        "2026-03-10", "2026-07-31", 85000],
  ["LAPD",                           "2026-03-24", "2026-08-31", 0],
];

const updateStmt = db.prepare(`
  UPDATE nodes SET
    start_date = ?,
    end_date = ?,
    budget = CASE WHEN ? IS NOT NULL THEN ? ELSE budget END,
    updated_at = datetime('now')
  WHERE name LIKE ?
`);

let updated = 0;
for (const [namePattern, startDate, endDate, budget] of updates) {
  const r = updateStmt.run(startDate, endDate, budget, budget, namePattern);
  if (r.changes > 0) updated += r.changes;
}
console.log(`Updated dates/budgets on ${updated} nodes`);

// 4. Fix RACI to use full-word keys where still using short keys
const raciNodes = db.prepare(`SELECT id, raci FROM nodes WHERE raci IS NOT NULL`).all() as { id: string; raci: string }[];
const raciUpdate = db.prepare(`UPDATE nodes SET raci = ? WHERE id = ?`);
let raciFixed = 0;
for (const n of raciNodes) {
  try {
    let parsed = JSON.parse(n.raci);
    // Handle double-escaped
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (parsed.R || parsed.A || parsed.C || parsed.I) {
      const fixed = JSON.stringify({
        responsible: parsed.responsible || parsed.R || "",
        accountable: parsed.accountable || parsed.A || "",
        consulted: parsed.consulted || parsed.C || "",
        informed: parsed.informed || parsed.I || "",
      });
      raciUpdate.run(fixed, n.id);
      raciFixed++;
    }
  } catch { /* skip malformed */ }
}
console.log(`Fixed RACI format on ${raciFixed} nodes`);

// 5. Summary
const total = (db.prepare(`SELECT COUNT(*) as c FROM nodes`).get() as { c: number }).c;
const withDates = (db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE start_date IS NOT NULL`).get() as { c: number }).c;
const withBudget = (db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE budget > 0`).get() as { c: number }).c;
console.log(`\nSummary: ${total} nodes, ${withDates} with dates, ${withBudget} with budget > 0`);
