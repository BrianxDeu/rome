/**
 * V3 Migration: Create cluster parent nodes and rewire parent_of edges
 * to match the reference dxd-halo-ops.html data model.
 *
 * Usage: npx tsx packages/server/src/migrate-v3-clusters.ts
 */
import Database from "better-sqlite3";

const dbPath = process.env["DATABASE_PATH"] || "rome.db";
const db = new Database(dbPath);

const now = new Date().toISOString();

// Get the user ID for created_by
const user = db.prepare(`SELECT id FROM users LIMIT 1`).get() as { id: string };
const userId = user?.id ?? "system";

// Get existing HALO MVP header node ID
const haloHeader = db.prepare(`SELECT id FROM nodes WHERE name = 'HALO MVP'`).get() as { id: string } | undefined;
if (!haloHeader) { console.log("HALO MVP header not found, aborting"); process.exit(1); }
const haloId = haloHeader.id;

// Define the 6 cluster parent nodes
const clusters = [
  { name: "Hardware Tech Stack", x: -310, y: -170 },
  { name: "Warhead Program", x: -315, y: 15 },
  { name: "Ukraine Ops", x: -130, y: -20 },
  { name: "Testing Campaign", x: -277, y: 247 },
  { name: "Ops & PM", x: 87, y: -77 },
  { name: "BD & Relationships", x: 30, y: 170 },
];

// Map: child node name patterns -> cluster parent name
const childToCluster: Record<string, string[]> = {
  "Hardware Tech Stack": ["Serge Picks Sensors%", "Build Hardware Budget%", "CEP Hardware Upgrade%"],
  "Warhead Program": ["Warhead Meeting", "Warhead Integration%"],
  "Ukraine Ops": ["%Ukraine Trip Plan%", "Mind-Meld Week%", "%Ukraine Forward%", "Hire 2 Engineers%", "%Serge Delivers Pat%"],
  "Testing Campaign": ["%Videographer%", "%April Testing%North Carolina%", "%April Testing%Ranch%"],
  "Ops & PM": ["Build PM Software", "Distill Transcript%", "Wispr Flow%"],
  "BD & Relationships": ["Georgia%Cobb%D Drone%", "%Group Chat%Jeremy%"],
};

// Create cluster nodes
const insertNode = db.prepare(`
  INSERT OR IGNORE INTO nodes (id, name, status, priority, start_date, end_date, budget, workstream, x, y, position_pinned, created_by, created_at, updated_at)
  VALUES (?, ?, 'in_progress', 'P1', '2026-03-23', '2026-09-30', 0, 'Halo MVP', ?, ?, 0, ?, ?, ?)
`);

const insertEdge = db.prepare(`
  INSERT OR IGNORE INTO edges (id, source_id, target_id, type, created_by, created_at, updated_at)
  VALUES (?, ?, ?, 'parent_of', ?, ?, ?)
`);

const deleteEdge = db.prepare(`DELETE FROM edges WHERE target_id = ? AND type = 'parent_of'`);

const findNodes = (pattern: string) => {
  return db.prepare(`SELECT id, name FROM nodes WHERE name LIKE ?`).all(pattern) as { id: string; name: string }[];
};

let clustersCreated = 0;
let edgesRewired = 0;

for (const cluster of clusters) {
  // Check if cluster already exists
  const existing = db.prepare(`SELECT id FROM nodes WHERE name = ?`).get(cluster.name) as { id: string } | undefined;
  let clusterId: string;

  if (existing) {
    clusterId = existing.id;
    console.log(`  Cluster "${cluster.name}" already exists: ${clusterId}`);
  } else {
    clusterId = crypto.randomUUID();
    insertNode.run(clusterId, cluster.name, cluster.x, cluster.y, userId, now, now);
    clustersCreated++;
    console.log(`  Created cluster "${cluster.name}": ${clusterId}`);

    // Make HALO MVP parent of this cluster
    insertEdge.run(crypto.randomUUID(), haloId, clusterId, userId, now, now);
  }

  // Rewire child nodes: remove old parent_of edge to HALO MVP, add new one to cluster
  const patterns = childToCluster[cluster.name];
  for (const pattern of patterns) {
    const children = findNodes(pattern);
    for (const child of children) {
      // Delete existing parent_of edge (from HALO MVP to this child)
      deleteEdge.run(child.id);
      // Create new parent_of edge (from cluster to this child)
      insertEdge.run(crypto.randomUUID(), clusterId, child.id, userId, now, now);
      edgesRewired++;
      console.log(`    Rewired "${child.name}" -> "${cluster.name}"`);
    }
  }
}

// Summary
const totalNodes = (db.prepare(`SELECT COUNT(*) as c FROM nodes`).get() as { c: number }).c;
const totalEdges = (db.prepare(`SELECT COUNT(*) as c FROM edges WHERE type = 'parent_of'`).get() as { c: number }).c;
console.log(`\nDone: ${clustersCreated} clusters created, ${edgesRewired} edges rewired`);
console.log(`Total: ${totalNodes} nodes, ${totalEdges} parent_of edges`);
