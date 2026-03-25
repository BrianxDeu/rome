# Rome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Rome, a graph-based project management web app with real-time collaboration, three views (Graph, Gantt, Budget), and a CLI for agent access.

**Architecture:** TypeScript monorepo with Express + SQLite backend serving a React + React Flow frontend on a single port. Real-time sync via Socket.io. All mutations broadcast deltas to connected clients. CLI wraps the REST API for programmatic access.

**Tech Stack:** TypeScript, Express, Drizzle ORM, SQLite, Socket.io, React 18, Vite, React Flow, Zustand, Commander.js, Docker

**Design Spec:** `rome/crew/brian/docs/specs/2026-03-23-rome-design.md`

---

## Parallelization Map

```
Phase 1: Foundation ──> Phase 2: Auth ──> Phase 3: Node CRUD ──> Phase 4: Edge CRUD ──> Phase 5: Graph+Budget API ──> Phase 6: WebSocket
                                                                                              |
                                                                                              v
                                                                              Phase 7: Frontend Shell
                                                                                     |
                                                                    +------------------+------------------+
                                                                    |                  |                  |
                                                              Phase 8: Graph    Phase 9: Gantt    Phase 10: Budget
                                                                    |                  |                  |
                                                                    +------------------+------------------+
                                                                                       |
                                                                                 Phase 12: Docker
Phase 2 complete ──> Phase 11: CLI (parallel with frontend work)
```

Phases 8, 9, 10 can run as parallel polecats. Phase 11 (CLI) can parallelize with all frontend work.

---

## File Structure

```
rome/
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   └── types.ts                  # Shared TypeScript types (Node, Edge, User, enums)
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── server/
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── schema.ts             # Drizzle schema definitions
│   │   │   │   ├── index.ts              # DB connection + export
│   │   │   │   ├── migrate.ts            # Push schema to SQLite
│   │   │   │   └── seed.ts               # Optional seed data
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts               # POST /api/auth/register, /api/auth/login
│   │   │   │   ├── nodes.ts              # GET/POST/PATCH/DELETE /api/nodes
│   │   │   │   ├── edges.ts              # POST/DELETE /api/edges + constraint checks
│   │   │   │   ├── graph.ts              # GET /api/graph (full graph)
│   │   │   │   └── budget.ts             # GET /api/budget (rollup)
│   │   │   ├── ws/
│   │   │   │   └── sync.ts               # Socket.io setup + broadcast helpers
│   │   │   ├── middleware/
│   │   │   │   └── auth.ts               # JWT verification middleware
│   │   │   └── index.ts                  # Express + Socket.io bootstrap
│   │   ├── test/
│   │   │   ├── helpers.ts                # Test DB setup, auth helpers
│   │   │   ├── auth.test.ts
│   │   │   ├── nodes.test.ts
│   │   │   ├── edges.test.ts
│   │   │   ├── graph.test.ts
│   │   │   └── budget.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── client/
│   │   ├── src/
│   │   │   ├── views/
│   │   │   │   ├── GraphView.tsx          # React Flow canvas (primary view)
│   │   │   │   ├── GanttView.tsx          # Horizontal bar timeline
│   │   │   │   └── BudgetView.tsx         # Dashboard with rollups
│   │   │   ├── components/
│   │   │   │   ├── NodePanel.tsx          # Side panel for editing node fields
│   │   │   │   ├── TopBar.tsx             # View tabs, search, filter bar
│   │   │   │   ├── NodeDot.tsx            # Custom React Flow node renderer
│   │   │   │   ├── ContextMenu.tsx        # Right-click menu (status, priority, set parent, delete)
│   │   │   │   ├── FilterBar.tsx          # Workstream/status/priority/responsible filters
│   │   │   │   └── LoginPage.tsx          # Login/register form
│   │   │   ├── hooks/
│   │   │   │   ├── useGraph.ts            # Fetch + cache graph state
│   │   │   │   └── useSync.ts             # WebSocket connection + delta application
│   │   │   ├── store/
│   │   │   │   └── graphStore.ts          # Zustand store for nodes/edges/UI state
│   │   │   ├── lib/
│   │   │   │   ├── api.ts                 # REST client (fetch wrapper with auth)
│   │   │   │   └── gravity.ts             # Gravity layout algorithm
│   │   │   ├── App.tsx                    # Root component with routing
│   │   │   ├── main.tsx                   # Vite entry point
│   │   │   └── index.css                  # Global styles + DxD brand
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   └── cli/
│       ├── src/
│       │   ├── index.ts                   # CLI entry point (Commander.js)
│       │   ├── commands/
│       │   │   ├── auth.ts                # login command
│       │   │   ├── node.ts                # node create/list/get/update/delete
│       │   │   ├── edge.ts                # edge create/delete
│       │   │   └── views.ts               # graph, budget table output
│       │   └── config.ts                  # Read/write ~/.rome/config.json
│       ├── package.json
│       └── tsconfig.json
├── docker-compose.yml
├── Dockerfile
├── package.json                           # Workspace root
├── tsconfig.base.json                     # Shared TS config
└── README.md
```

---

## Phase 1: Foundation

### Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types.ts`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/client/package.json`
- Create: `packages/client/tsconfig.json`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`

- [ ] **Step 1: Create workspace root package.json**

```json
{
  "name": "rome",
  "private": true,
  "workspaces": [
    "packages/shared",
    "packages/server",
    "packages/client",
    "packages/cli"
  ],
  "scripts": {
    "dev": "npm run dev --workspace=packages/server",
    "build": "npm run build --workspace=packages/shared && npm run build --workspace=packages/server && npm run build --workspace=packages/client",
    "test": "npm test --workspace=packages/server"
  }
}
```

- [ ] **Step 2: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Create packages/shared**

`packages/shared/package.json`:
```json
{
  "name": "@rome/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "src/types.ts",
  "types": "src/types.ts",
  "scripts": {
    "build": "tsc"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create packages/server scaffold**

`packages/server/package.json`:
```json
{
  "name": "@rome/server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@rome/shared": "*",
    "bcrypt": "^5.1.1",
    "better-sqlite3": "^11.7.0",
    "cors": "^2.8.5",
    "drizzle-orm": "^0.38.0",
    "express": "^4.21.0",
    "jsonwebtoken": "^9.0.2",
    "socket.io": "^4.8.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/bcrypt": "^5.0.2",
    "@types/better-sqlite3": "^7.6.12",
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/jsonwebtoken": "^9.0.7",
    "drizzle-kit": "^0.30.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 5: Create packages/client scaffold**

`packages/client/package.json`:
```json
{
  "name": "@rome/client",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@rome/shared": "*",
    "@xyflow/react": "^12.4.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "socket.io-client": "^4.8.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

`packages/client/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Create packages/cli scaffold**

`packages/cli/package.json`:
```json
{
  "name": "@rome/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "rome": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "commander": "^13.0.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

`packages/cli/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Run npm install and verify**

Run: `npm install`
Expected: All packages install successfully, `node_modules` created, workspace links established.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.base.json packages/*/package.json packages/*/tsconfig.json
git commit -m "scaffold: monorepo with shared, server, client, cli packages"
```

---

### Task 2: Shared Types

**Files:**
- Create: `packages/shared/src/types.ts`

- [ ] **Step 1: Write shared types**

```typescript
// Node statuses
export type NodeStatus = 'not_started' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

// Priority levels
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

// Edge types
export type EdgeType = 'blocks' | 'parent_of';

// User roles
export type UserRole = 'admin' | 'member';

// RACI structure
export interface RACI {
  responsible: string[];
  accountable: string | null;
  consulted: string[];
  informed: string[];
}

// Attachment
export interface Attachment {
  name: string;
  url: string;
}

// Core data types
export interface RomeNode {
  id: string;
  name: string;
  status: NodeStatus;
  priority: Priority;
  start_date: string | null;
  end_date: string | null;
  budget: number | null;
  deliverable: string | null;
  notes: string | null;
  raci: RACI | null;
  workstream: string | null;
  x: number | null;
  y: number | null;
  position_pinned: boolean;
  attachments: Attachment[];
  created_at: string;
  updated_at: string;
}

export interface RomeEdge {
  id: string;
  source_id: string;
  target_id: string;
  type: EdgeType;
  created_at: string;
}

export interface RomeUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

// API types
export interface GraphResponse {
  nodes: RomeNode[];
  edges: RomeEdge[];
}

export interface BudgetItem {
  name: string;
  total: number;
  items: Array<{
    id: string;
    name: string;
    budget: number | null;
    status: NodeStatus;
    priority: Priority;
  }>;
}

export interface BudgetResponse {
  workstreams: BudgetItem[];
}

export interface ApiError {
  error: string;
  code: string;
}

// WebSocket event types
export type WsEvent =
  | { event: 'node:created'; data: RomeNode }
  | { event: 'node:updated'; data: { id: string; changes: Partial<RomeNode> } }
  | { event: 'node:deleted'; data: { id: string } }
  | { event: 'edge:created'; data: RomeEdge }
  | { event: 'edge:deleted'; data: { id: string } };
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: add shared TypeScript types for nodes, edges, users, API"
```

---

### Task 3: Database Schema

**Files:**
- Create: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/db/index.ts`
- Create: `packages/server/src/db/migrate.ts`

- [ ] **Step 1: Write Drizzle schema**

`packages/server/src/db/schema.ts`:
```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  status: text('status', { enum: ['not_started', 'in_progress', 'blocked', 'done', 'cancelled'] }).notNull().default('not_started'),
  priority: text('priority', { enum: ['P0', 'P1', 'P2', 'P3'] }).notNull().default('P2'),
  start_date: text('start_date'),
  end_date: text('end_date'),
  budget: real('budget'),
  deliverable: text('deliverable'),
  notes: text('notes'),
  raci: text('raci', { mode: 'json' }),
  workstream: text('workstream'),
  x: real('x'),
  y: real('y'),
  position_pinned: integer('position_pinned', { mode: 'boolean' }).notNull().default(false),
  attachments: text('attachments', { mode: 'json' }).notNull().$default(() => []),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const edges = sqliteTable('edges', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  source_id: text('source_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  target_id: text('target_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['blocks', 'parent_of'] }).notNull(),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

- [ ] **Step 2: Write DB connection module**

`packages/server/src/db/index.ts`:
```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const DB_PATH = process.env.DB_PATH || './data/rome.db';

export function createDb(path: string = DB_PATH) {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { schema };
```

- [ ] **Step 3: Write migration runner**

`packages/server/src/db/migrate.ts`:
```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

const DB_PATH = process.env.DB_PATH || './data/rome.db';
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const db = drizzle(sqlite, { schema });

// Use drizzle-kit push for development, migrate for production
console.log('Database ready at', DB_PATH);
```

- [ ] **Step 4: Add drizzle.config.ts**

`packages/server/drizzle.config.ts`:
```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH || './data/rome.db',
  },
});
```

- [ ] **Step 5: Verify schema compiles**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/db/ packages/server/drizzle.config.ts
git commit -m "feat: add Drizzle schema for users, nodes, edges with SQLite"
```

---

### Task 4: Express Server Bootstrap

**Files:**
- Create: `packages/server/src/index.ts`

- [ ] **Step 1: Write server bootstrap**

```typescript
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createDb } from './db/index.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());

const db = createDb();

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Make db and io available to routes
app.locals.db = db;
app.locals.io = io;

const PORT = parseInt(process.env.PORT || '3000', 10);

httpServer.listen(PORT, () => {
  console.log(`Rome server listening on port ${PORT}`);
});

export { app, httpServer, io, db };
```

- [ ] **Step 2: Write test helpers**

`packages/server/test/helpers.ts`:
```typescript
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/db/schema.js';
import { users } from '../src/db/schema.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret';

export function createTestApp() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  // Push schema to in-memory DB
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      priority TEXT NOT NULL DEFAULT 'P2',
      start_date TEXT,
      end_date TEXT,
      budget REAL,
      deliverable TEXT,
      notes TEXT,
      raci TEXT,
      workstream TEXT,
      x REAL,
      y REAL,
      position_pinned INTEGER NOT NULL DEFAULT 0,
      attachments TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);

  app.use(express.json());
  app.locals.db = db;
  app.locals.io = io;
  app.locals.jwtSecret = JWT_SECRET;

  return { app, db, io, httpServer, sqlite };
}

export async function createTestUser(db: any, overrides: { role?: string; email?: string } = {}) {
  const hash = await bcrypt.hash('password123', 10);
  const id = crypto.randomUUID();
  const email = overrides.email || `user-${id.slice(0, 8)}@test.com`;
  const role = overrides.role || 'member';

  db.insert(users).values({
    id,
    name: 'Test User',
    email,
    password_hash: hash,
    role,
  }).run();

  const token = jwt.sign({ userId: id, role }, JWT_SECRET, { expiresIn: '1h' });
  return { id, email, token, role };
}
```

- [ ] **Step 3: Write a basic health check test**

`packages/server/test/health.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers.js';

describe('GET /api/health', () => {
  let app: any;

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  it('returns ok status', async () => {
    // Route needs to be registered on app
    app.get('/api/health', (_req: any, res: any) => {
      res.json({ status: 'ok' });
    });

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 4: Run test to verify setup works**

Run: `cd packages/server && npx vitest run`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts packages/server/test/
git commit -m "feat: add Express server bootstrap with test helpers"
```

---

## Phase 2: Auth

### Task 5: Auth Routes (Register + Login)

**Files:**
- Create: `packages/server/src/routes/auth.ts`
- Create: `packages/server/src/middleware/auth.ts`
- Create: `packages/server/test/auth.test.ts`

- [ ] **Step 1: Write failing auth tests**

`packages/server/test/auth.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers.js';
import { authRouter } from '../src/routes/auth.js';

describe('Auth', () => {
  let app: any;

  beforeEach(() => {
    const ctx = createTestApp();
    app = ctx.app;
    app.use('/api/auth', authRouter);
  });

  describe('POST /api/auth/register', () => {
    it('registers first user as admin', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Brian', email: 'brian@dxd.com', password: 'secret123' });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('admin');
      expect(res.body.user.name).toBe('Brian');
      expect(res.body.token).toBeDefined();
      expect(res.body.user.password_hash).toBeUndefined();
    });

    it('registers subsequent users as member', async () => {
      // Register first (admin)
      await request(app)
        .post('/api/auth/register')
        .send({ name: 'Brian', email: 'brian@dxd.com', password: 'secret123' });

      // Register second (member)
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Serge', email: 'serge@dxd.com', password: 'secret456' });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('member');
    });

    it('rejects duplicate email', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ name: 'Brian', email: 'brian@dxd.com', password: 'secret123' });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Brian2', email: 'brian@dxd.com', password: 'secret456' });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('EMAIL_EXISTS');
    });

    it('rejects missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Brian' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns token on valid credentials', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ name: 'Brian', email: 'brian@dxd.com', password: 'secret123' });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'brian@dxd.com', password: 'secret123' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('brian@dxd.com');
    });

    it('rejects invalid password', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ name: 'Brian', email: 'brian@dxd.com', password: 'secret123' });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'brian@dxd.com', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects unknown email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@dxd.com', password: 'secret123' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run test/auth.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement auth routes**

`packages/server/src/routes/auth.ts`:
```typescript
import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { z } from 'zod';
import type { Db } from '../db/index.js';

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const authRouter = Router();

function getJwtSecret(req: any): string {
  return req.app.locals.jwtSecret || process.env.JWT_SECRET || 'dev-secret';
}

function getDb(req: any): Db {
  return req.app.locals.db;
}

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid fields', code: 'VALIDATION_ERROR' });
    return;
  }

  const { name, email, password } = parsed.data;
  const db = getDb(req);
  const secret = getJwtSecret(req);

  // Check for duplicate email
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) {
    res.status(422).json({ error: 'Email already registered', code: 'EMAIL_EXISTS' });
    return;
  }

  // First user is admin
  const userCount = db.select().from(users).all().length;
  const role = userCount === 0 ? 'admin' : 'member';

  const password_hash = await bcrypt.hash(password, 10);
  const id = crypto.randomUUID();

  db.insert(users).values({ id, name, email, password_hash, role }).run();

  const token = jwt.sign({ userId: id, role }, secret, { expiresIn: '7d' });

  res.status(201).json({
    token,
    user: { id, name, email, role },
  });
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Missing or invalid fields', code: 'VALIDATION_ERROR' });
    return;
  }

  const { email, password } = parsed.data;
  const db = getDb(req);
  const secret = getJwtSecret(req);

  const user = db.select().from(users).where(eq(users.email, email)).get();
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    return;
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, secret, { expiresIn: '7d' });

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run test/auth.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 5: Implement JWT middleware**

`packages/server/src/middleware/auth.ts`:
```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided', code: 'UNAUTHORIZED' });
    return;
  }

  const token = header.slice(7);
  const secret = req.app.locals.jwtSecret || process.env.JWT_SECRET || 'dev-secret';

  try {
    const payload = jwt.verify(token, secret) as { userId: string; role: string };
    req.userId = payload.userId;
    req.userRole = payload.role;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token', code: 'UNAUTHORIZED' });
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/auth.ts packages/server/src/middleware/auth.ts packages/server/test/auth.test.ts
git commit -m "feat: add auth routes (register/login) with JWT middleware"
```

---

## Phase 3: Node CRUD

### Task 6: Node Routes

**Files:**
- Create: `packages/server/src/routes/nodes.ts`
- Create: `packages/server/test/nodes.test.ts`

- [ ] **Step 1: Write failing node tests**

`packages/server/test/nodes.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, createTestUser } from './helpers.js';
import { authRouter } from '../src/routes/auth.js';
import { nodesRouter } from '../src/routes/nodes.js';
import { edgesRouter } from '../src/routes/edges.js';
import { requireAuth } from '../src/middleware/auth.js';

describe('Nodes', () => {
  let app: any;
  let db: any;
  let token: string;

  beforeEach(async () => {
    const ctx = createTestApp();
    app = ctx.app;
    db = ctx.db;
    app.use('/api/auth', authRouter);
    app.use('/api/nodes', requireAuth, nodesRouter);
    app.use('/api/edges', requireAuth, edgesRouter);
    const user = await createTestUser(db, { role: 'admin' });
    token = user.token;
  });

  describe('POST /api/nodes', () => {
    it('creates a node with just a name', async () => {
      const res = await request(app)
        .post('/api/nodes')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Sensor integration' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Sensor integration');
      expect(res.body.status).toBe('not_started');
      expect(res.body.priority).toBe('P2');
      expect(res.body.id).toBeDefined();
    });

    it('creates a node with all optional fields', async () => {
      const res = await request(app)
        .post('/api/nodes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Halo MVP',
          status: 'in_progress',
          priority: 'P0',
          budget: 100000,
          workstream: 'Halo',
          deliverable: 'Working prototype',
        });

      expect(res.status).toBe(201);
      expect(res.body.priority).toBe('P0');
      expect(res.body.budget).toBe(100000);
      expect(res.body.workstream).toBe('Halo');
    });

    it('rejects missing name', async () => {
      const res = await request(app)
        .post('/api/nodes')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request(app)
        .post('/api/nodes')
        .send({ name: 'Test' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/nodes', () => {
    it('lists all nodes', async () => {
      await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'A' });
      await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'B' });

      const res = await request(app).get('/api/nodes').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('filters by workstream', async () => {
      await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'A', workstream: 'Halo' });
      await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'B', workstream: 'Orcrest' });

      const res = await request(app).get('/api/nodes?workstream=Halo').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('A');
    });

    it('filters by status and priority', async () => {
      await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'A', status: 'blocked', priority: 'P0' });
      await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'B', status: 'done', priority: 'P1' });

      const res = await request(app).get('/api/nodes?status=blocked').set('Authorization', `Bearer ${token}`);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('A');
    });
  });

  describe('GET /api/nodes/:id', () => {
    it('returns node with its edges', async () => {
      const a = await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'A' });
      const b = await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'B' });
      await request(app).post('/api/edges').set('Authorization', `Bearer ${token}`)
        .send({ source_id: a.body.id, target_id: b.body.id, type: 'blocks' });

      const res = await request(app).get(`/api/nodes/${a.body.id}`).set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('A');
      expect(res.body.edges).toHaveLength(1);
      expect(res.body.edges[0].type).toBe('blocks');
    });

    it('returns 404 for unknown id', async () => {
      const res = await request(app).get('/api/nodes/nonexistent').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/nodes/:id', () => {
    it('updates partial fields', async () => {
      const create = await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'A' });

      const res = await request(app)
        .patch(`/api/nodes/${create.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'in_progress', budget: 50000 });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_progress');
      expect(res.body.budget).toBe(50000);
      expect(res.body.name).toBe('A');
    });
  });

  describe('DELETE /api/nodes/:id', () => {
    it('deletes node and returns 204', async () => {
      const create = await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'A' });
      const res = await request(app).delete(`/api/nodes/${create.body.id}`).set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(204);

      const get = await request(app).get(`/api/nodes/${create.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(get.status).toBe(404);
    });

    it('orphans children when parent is deleted (does not cascade delete child nodes)', async () => {
      const parent = await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'Parent' });
      const child = await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'Child' });
      await request(app).post('/api/edges').set('Authorization', `Bearer ${token}`)
        .send({ source_id: parent.body.id, target_id: child.body.id, type: 'parent_of' });

      // Delete parent
      await request(app).delete(`/api/nodes/${parent.body.id}`).set('Authorization', `Bearer ${token}`);

      // Child still exists
      const childGet = await request(app).get(`/api/nodes/${child.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(childGet.status).toBe(200);
      expect(childGet.body.name).toBe('Child');

      // But the parent_of edge is gone (cascaded edge delete)
      expect(childGet.body.edges).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run test/nodes.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement node routes**

`packages/server/src/routes/nodes.ts`:
```typescript
import { Router } from 'express';
import { eq, and, or, SQL } from 'drizzle-orm';
import { nodes, edges } from '../db/schema.js';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import type { AuthRequest } from '../middleware/auth.js';

const createSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['not_started', 'in_progress', 'blocked', 'done', 'cancelled']).optional(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  budget: z.number().nullable().optional(),
  deliverable: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  raci: z.any().nullable().optional(),
  workstream: z.string().nullable().optional(),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
  position_pinned: z.boolean().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
});

const updateSchema = createSchema.partial().omit({ name: true }).extend({
  name: z.string().min(1).optional(),
});

export const nodesRouter = Router();

function getDb(req: AuthRequest): Db {
  return req.app.locals.db;
}

function broadcast(req: AuthRequest, event: string, data: any) {
  req.app.locals.io?.emit(event, data);
}

nodesRouter.get('/', (req: AuthRequest, res) => {
  const db = getDb(req);
  const { workstream, status, priority } = req.query;

  const conditions: SQL[] = [];
  if (workstream) conditions.push(eq(nodes.workstream, workstream as string));
  if (status) conditions.push(eq(nodes.status, status as any));
  if (priority) conditions.push(eq(nodes.priority, priority as any));

  let query = db.select().from(nodes);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  const result = query.all();
  res.json(result);
});

nodesRouter.get('/:id', (req: AuthRequest, res) => {
  const db = getDb(req);
  const node = db.select().from(nodes).where(eq(nodes.id, req.params.id)).get();

  if (!node) {
    res.status(404).json({ error: 'Node not found', code: 'NOT_FOUND' });
    return;
  }

  // Include edges where this node is source or target (spec: "Node with edges")
  const nodeEdges = db.select().from(edges)
    .where(or(eq(edges.source_id, req.params.id), eq(edges.target_id, req.params.id)))
    .all();

  res.json({ ...node, edges: nodeEdges });
});

nodesRouter.post('/', (req: AuthRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', code: 'VALIDATION_ERROR' });
    return;
  }

  const db = getDb(req);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const values = {
    id,
    ...parsed.data,
    attachments: parsed.data.attachments || [],
    created_at: now,
    updated_at: now,
  };

  db.insert(nodes).values(values).run();
  const node = db.select().from(nodes).where(eq(nodes.id, id)).get();

  broadcast(req, 'node:created', node);
  res.status(201).json(node);
});

nodesRouter.patch('/:id', (req: AuthRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', code: 'VALIDATION_ERROR' });
    return;
  }

  const db = getDb(req);
  const existing = db.select().from(nodes).where(eq(nodes.id, req.params.id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Node not found', code: 'NOT_FOUND' });
    return;
  }

  const changes = { ...parsed.data, updated_at: new Date().toISOString() };
  db.update(nodes).set(changes).where(eq(nodes.id, req.params.id)).run();
  const updated = db.select().from(nodes).where(eq(nodes.id, req.params.id)).get();

  broadcast(req, 'node:updated', { id: req.params.id, changes });
  res.json(updated);
});

nodesRouter.delete('/:id', (req: AuthRequest, res) => {
  const db = getDb(req);
  const existing = db.select().from(nodes).where(eq(nodes.id, req.params.id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Node not found', code: 'NOT_FOUND' });
    return;
  }

  db.delete(nodes).where(eq(nodes.id, req.params.id)).run();

  broadcast(req, 'node:deleted', { id: req.params.id });
  res.status(204).send();
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run test/nodes.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/nodes.ts packages/server/test/nodes.test.ts
git commit -m "feat: add node CRUD routes with filtering"
```

---

## Phase 4: Edge CRUD + Constraints

### Task 7: Edge Routes with DAG Validation

**Files:**
- Create: `packages/server/src/routes/edges.ts`
- Create: `packages/server/test/edges.test.ts`

- [ ] **Step 1: Write failing edge tests**

`packages/server/test/edges.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, createTestUser } from './helpers.js';
import { nodesRouter } from '../src/routes/nodes.js';
import { edgesRouter } from '../src/routes/edges.js';
import { requireAuth } from '../src/middleware/auth.js';

describe('Edges', () => {
  let app: any;
  let db: any;
  let token: string;

  beforeEach(async () => {
    const ctx = createTestApp();
    app = ctx.app;
    db = ctx.db;
    app.use('/api/nodes', requireAuth, nodesRouter);
    app.use('/api/edges', requireAuth, edgesRouter);
    const user = await createTestUser(db, { role: 'admin' });
    token = user.token;
  });

  async function createNode(name: string) {
    const res = await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name });
    return res.body;
  }

  describe('POST /api/edges', () => {
    it('creates a blocks edge', async () => {
      const a = await createNode('A');
      const b = await createNode('B');

      const res = await request(app)
        .post('/api/edges')
        .set('Authorization', `Bearer ${token}`)
        .send({ source_id: a.id, target_id: b.id, type: 'blocks' });

      expect(res.status).toBe(201);
      expect(res.body.source_id).toBe(a.id);
      expect(res.body.target_id).toBe(b.id);
      expect(res.body.type).toBe('blocks');
    });

    it('creates a parent_of edge', async () => {
      const parent = await createNode('Goal');
      const child = await createNode('Sub-task');

      const res = await request(app)
        .post('/api/edges')
        .set('Authorization', `Bearer ${token}`)
        .send({ source_id: parent.id, target_id: child.id, type: 'parent_of' });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe('parent_of');
    });

    it('rejects self-referencing edge', async () => {
      const a = await createNode('A');

      const res = await request(app)
        .post('/api/edges')
        .set('Authorization', `Bearer ${token}`)
        .send({ source_id: a.id, target_id: a.id, type: 'blocks' });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('SELF_REFERENCE');
    });

    it('rejects cycle in blocks edges (A->B->C->A)', async () => {
      const a = await createNode('A');
      const b = await createNode('B');
      const c = await createNode('C');

      await request(app).post('/api/edges').set('Authorization', `Bearer ${token}`)
        .send({ source_id: a.id, target_id: b.id, type: 'blocks' });
      await request(app).post('/api/edges').set('Authorization', `Bearer ${token}`)
        .send({ source_id: b.id, target_id: c.id, type: 'blocks' });

      const res = await request(app).post('/api/edges').set('Authorization', `Bearer ${token}`)
        .send({ source_id: c.id, target_id: a.id, type: 'blocks' });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('CYCLE_DETECTED');
    });

    it('rejects second parent for same child', async () => {
      const parent1 = await createNode('Parent 1');
      const parent2 = await createNode('Parent 2');
      const child = await createNode('Child');

      await request(app).post('/api/edges').set('Authorization', `Bearer ${token}`)
        .send({ source_id: parent1.id, target_id: child.id, type: 'parent_of' });

      const res = await request(app).post('/api/edges').set('Authorization', `Bearer ${token}`)
        .send({ source_id: parent2.id, target_id: child.id, type: 'parent_of' });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('MULTIPLE_PARENTS');
    });

    it('rejects edge with nonexistent node', async () => {
      const a = await createNode('A');

      const res = await request(app)
        .post('/api/edges')
        .set('Authorization', `Bearer ${token}`)
        .send({ source_id: a.id, target_id: 'nonexistent', type: 'blocks' });

      expect(res.status).toBe(404);
    });
  });

  describe('Edge immutability', () => {
    it('has no PATCH endpoint for edges (type is immutable per spec)', async () => {
      const a = await createNode('A');
      const b = await createNode('B');

      const create = await request(app).post('/api/edges').set('Authorization', `Bearer ${token}`)
        .send({ source_id: a.id, target_id: b.id, type: 'blocks' });

      // PATCH should not exist — returns 404 (no route matched)
      const res = await request(app).patch(`/api/edges/${create.body.id}`).set('Authorization', `Bearer ${token}`)
        .send({ type: 'parent_of' });

      expect([404, 405]).toContain(res.status);
    });
  });

  describe('DELETE /api/edges/:id', () => {
    it('deletes an edge', async () => {
      const a = await createNode('A');
      const b = await createNode('B');

      const create = await request(app).post('/api/edges').set('Authorization', `Bearer ${token}`)
        .send({ source_id: a.id, target_id: b.id, type: 'blocks' });

      const res = await request(app).delete(`/api/edges/${create.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(204);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run test/edges.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement edge routes with constraint validation**

`packages/server/src/routes/edges.ts`:
```typescript
import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { edges, nodes } from '../db/schema.js';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import type { AuthRequest } from '../middleware/auth.js';

const createSchema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  type: z.enum(['blocks', 'parent_of']),
});

export const edgesRouter = Router();

function getDb(req: AuthRequest): Db {
  return req.app.locals.db;
}

function broadcast(req: AuthRequest, event: string, data: any) {
  req.app.locals.io?.emit(event, data);
}

/** DFS cycle detection for blocks edges. Returns true if adding source->target would create a cycle. */
function wouldCreateCycle(db: Db, sourceId: string, targetId: string): boolean {
  // If target can reach source via existing blocks edges, adding source->target creates a cycle
  const visited = new Set<string>();
  const stack = [targetId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    // Follow outgoing blocks edges from current
    const outgoing = db.select().from(edges)
      .where(and(eq(edges.source_id, current), eq(edges.type, 'blocks')))
      .all();

    for (const edge of outgoing) {
      stack.push(edge.target_id);
    }
  }

  return false;
}

edgesRouter.post('/', (req: AuthRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', code: 'VALIDATION_ERROR' });
    return;
  }

  const { source_id, target_id, type } = parsed.data;
  const db = getDb(req);

  // Self-reference check
  if (source_id === target_id) {
    res.status(422).json({ error: 'Self-referencing edges are not allowed', code: 'SELF_REFERENCE' });
    return;
  }

  // Verify both nodes exist
  const source = db.select().from(nodes).where(eq(nodes.id, source_id)).get();
  const target = db.select().from(nodes).where(eq(nodes.id, target_id)).get();
  if (!source || !target) {
    res.status(404).json({ error: 'Node not found', code: 'NOT_FOUND' });
    return;
  }

  // Cycle detection for blocks edges
  if (type === 'blocks') {
    if (wouldCreateCycle(db, source_id, target_id)) {
      res.status(422).json({ error: 'Edge would create a cycle', code: 'CYCLE_DETECTED' });
      return;
    }
  }

  // Single-parent enforcement for parent_of edges
  if (type === 'parent_of') {
    const existingParent = db.select().from(edges)
      .where(and(eq(edges.target_id, target_id), eq(edges.type, 'parent_of')))
      .get();

    if (existingParent) {
      res.status(422).json({ error: 'Node already has a parent', code: 'MULTIPLE_PARENTS' });
      return;
    }
  }

  const id = crypto.randomUUID();
  db.insert(edges).values({ id, source_id, target_id, type }).run();
  const edge = db.select().from(edges).where(eq(edges.id, id)).get();

  broadcast(req, 'edge:created', edge);
  res.status(201).json(edge);
});

edgesRouter.delete('/:id', (req: AuthRequest, res) => {
  const db = getDb(req);
  const existing = db.select().from(edges).where(eq(edges.id, req.params.id)).get();

  if (!existing) {
    res.status(404).json({ error: 'Edge not found', code: 'NOT_FOUND' });
    return;
  }

  db.delete(edges).where(eq(edges.id, req.params.id)).run();

  broadcast(req, 'edge:deleted', { id: req.params.id });
  res.status(204).send();
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run test/edges.test.ts`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/edges.ts packages/server/test/edges.test.ts
git commit -m "feat: add edge CRUD with DAG cycle detection and single-parent enforcement"
```

---

## Phase 5: Graph + Budget Endpoints

### Task 8: Graph Endpoint

**Files:**
- Create: `packages/server/src/routes/graph.ts`
- Create: `packages/server/test/graph.test.ts`

- [ ] **Step 1: Write failing test**

`packages/server/test/graph.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, createTestUser } from './helpers.js';
import { nodesRouter } from '../src/routes/nodes.js';
import { edgesRouter } from '../src/routes/edges.js';
import { graphRouter } from '../src/routes/graph.js';
import { requireAuth } from '../src/middleware/auth.js';

describe('GET /api/graph', () => {
  let app: any;
  let db: any;
  let token: string;

  beforeEach(async () => {
    const ctx = createTestApp();
    app = ctx.app;
    db = ctx.db;
    app.use('/api/nodes', requireAuth, nodesRouter);
    app.use('/api/edges', requireAuth, edgesRouter);
    app.use('/api/graph', requireAuth, graphRouter);
    const user = await createTestUser(db, { role: 'admin' });
    token = user.token;
  });

  it('returns all nodes and edges', async () => {
    const a = await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'A' });
    const b = await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`).send({ name: 'B' });
    await request(app).post('/api/edges').set('Authorization', `Bearer ${token}`)
      .send({ source_id: a.body.id, target_id: b.body.id, type: 'blocks' });

    const res = await request(app).get('/api/graph').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(2);
    expect(res.body.edges).toHaveLength(1);
  });

  it('returns empty graph when no data', async () => {
    const res = await request(app).get('/api/graph').set('Authorization', `Bearer ${token}`);
    expect(res.body).toEqual({ nodes: [], edges: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run test/graph.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement graph route**

`packages/server/src/routes/graph.ts`:
```typescript
import { Router } from 'express';
import { nodes, edges } from '../db/schema.js';
import type { Db } from '../db/index.js';
import type { AuthRequest } from '../middleware/auth.js';

export const graphRouter = Router();

graphRouter.get('/', (req: AuthRequest, res) => {
  const db: Db = req.app.locals.db;
  const allNodes = db.select().from(nodes).all();
  const allEdges = db.select().from(edges).all();

  res.json({ nodes: allNodes, edges: allEdges });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run test/graph.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/graph.ts packages/server/test/graph.test.ts
git commit -m "feat: add graph endpoint returning all nodes and edges"
```

---

### Task 9: Budget Rollup Endpoint

**Files:**
- Create: `packages/server/src/routes/budget.ts`
- Create: `packages/server/test/budget.test.ts`

- [ ] **Step 1: Write failing budget tests**

`packages/server/test/budget.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, createTestUser } from './helpers.js';
import { nodesRouter } from '../src/routes/nodes.js';
import { edgesRouter } from '../src/routes/edges.js';
import { budgetRouter } from '../src/routes/budget.js';
import { requireAuth } from '../src/middleware/auth.js';

describe('GET /api/budget', () => {
  let app: any;
  let db: any;
  let token: string;

  beforeEach(async () => {
    const ctx = createTestApp();
    app = ctx.app;
    db = ctx.db;
    app.use('/api/nodes', requireAuth, nodesRouter);
    app.use('/api/edges', requireAuth, edgesRouter);
    app.use('/api/budget', requireAuth, budgetRouter);
    const user = await createTestUser(db, { role: 'admin' });
    token = user.token;
  });

  it('returns budget grouped by workstream', async () => {
    await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`)
      .send({ name: 'A', workstream: 'Halo', budget: 50000 });
    await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`)
      .send({ name: 'B', workstream: 'Halo', budget: 30000 });
    await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`)
      .send({ name: 'C', workstream: 'Orcrest', budget: 20000 });

    const res = await request(app).get('/api/budget').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.workstreams).toHaveLength(2);

    const halo = res.body.workstreams.find((w: any) => w.name === 'Halo');
    expect(halo.total).toBe(80000);
    expect(halo.items).toHaveLength(2);
  });

  it('filters by workstream query param', async () => {
    await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`)
      .send({ name: 'A', workstream: 'Halo', budget: 50000 });
    await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`)
      .send({ name: 'B', workstream: 'Orcrest', budget: 20000 });

    const res = await request(app).get('/api/budget?workstream=Halo').set('Authorization', `Bearer ${token}`);
    expect(res.body.workstreams).toHaveLength(1);
    expect(res.body.workstreams[0].name).toBe('Halo');
  });

  it('rolls up child budgets to parent', async () => {
    const parent = await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Goal', workstream: 'Halo', budget: 10000 });
    const child1 = await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sub 1', workstream: 'Halo', budget: 5000 });
    const child2 = await request(app).post('/api/nodes').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sub 2', workstream: 'Halo', budget: 3000 });

    // Create parent_of edges
    await request(app).post('/api/edges').set('Authorization', `Bearer ${token}`)
      .send({ source_id: parent.body.id, target_id: child1.body.id, type: 'parent_of' });
    await request(app).post('/api/edges').set('Authorization', `Bearer ${token}`)
      .send({ source_id: parent.body.id, target_id: child2.body.id, type: 'parent_of' });

    const res = await request(app).get('/api/budget').set('Authorization', `Bearer ${token}`);
    const halo = res.body.workstreams.find((w: any) => w.name === 'Halo');

    // Parent node's rolled-up budget = own (10000) + children (5000 + 3000) = 18000
    const goalItem = halo.items.find((i: any) => i.name === 'Goal');
    expect(goalItem.budget).toBe(18000);

    // Workstream total should NOT double-count: only root nodes count toward total
    // Goal (18000 rolled up) is the only root node; Sub 1 and Sub 2 have parents
    expect(halo.total).toBe(18000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run test/budget.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement budget route**

`packages/server/src/routes/budget.ts`:
```typescript
import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { nodes, edges } from '../db/schema.js';
import type { Db } from '../db/index.js';
import type { AuthRequest } from '../middleware/auth.js';

export const budgetRouter = Router();

budgetRouter.get('/', (req: AuthRequest, res) => {
  const db: Db = req.app.locals.db;
  const workstreamFilter = req.query.workstream as string | undefined;

  const allNodes = db.select().from(nodes).all();
  const allEdges = db.select().from(edges).all();

  // Build parent->children map and track which nodes have parents
  const childrenMap = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of allEdges) {
    if (edge.type === 'parent_of') {
      const children = childrenMap.get(edge.source_id) || [];
      children.push(edge.target_id);
      childrenMap.set(edge.source_id, children);
      hasParent.add(edge.target_id);
    }
  }

  // Calculate rolled-up budgets (own + sum of children, recursive)
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));
  const rolledUp = new Map<string, number>();

  function getRolledUpBudget(id: string): number {
    if (rolledUp.has(id)) return rolledUp.get(id)!;
    const node = nodeMap.get(id);
    const own = node?.budget || 0;
    const children = childrenMap.get(id) || [];
    const childTotal = children.reduce((sum, cid) => sum + getRolledUpBudget(cid), 0);
    const total = own + childTotal;
    rolledUp.set(id, total);
    return total;
  }

  // Compute all rolled-up budgets
  for (const node of allNodes) {
    getRolledUpBudget(node.id);
  }

  // Group by workstream
  const workstreams = new Map<string, typeof allNodes>();
  for (const node of allNodes) {
    const ws = node.workstream || '(none)';
    if (workstreamFilter && ws !== workstreamFilter) continue;
    const group = workstreams.get(ws) || [];
    group.push(node);
    workstreams.set(ws, group);
  }

  // Workstream total: only sum root nodes (no parent) to avoid double-counting
  // Child budgets are already included in their parent's rolled-up budget
  const result = Array.from(workstreams.entries()).map(([name, items]) => ({
    name,
    total: items
      .filter(n => !hasParent.has(n.id))
      .reduce((sum, n) => sum + (rolledUp.get(n.id) || 0), 0),
    items: items.map(n => ({
      id: n.id,
      name: n.name,
      budget: rolledUp.get(n.id) || null,
      status: n.status,
      priority: n.priority,
    })),
  }));

  res.json({ workstreams: result });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run test/budget.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/budget.ts packages/server/test/budget.test.ts
git commit -m "feat: add budget endpoint with rollup from parent_of hierarchy"
```

---

## Phase 6: WebSocket

### Task 10: Socket.io Setup with Auth

**Files:**
- Create: `packages/server/src/ws/sync.ts`
- Modify: `packages/server/src/index.ts` (wire up routes + WebSocket)

- [ ] **Step 1: Write WebSocket auth module**

`packages/server/src/ws/sync.ts`:
```typescript
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

export function setupWebSocket(io: Server, jwtSecret?: string) {
  const secret = jwtSecret || process.env.JWT_SECRET || 'dev-secret';

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const payload = jwt.verify(token, secret) as { userId: string; role: string };
      socket.data.userId = payload.userId;
      socket.data.role = payload.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.data.userId}`);

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.data.userId}`);
    });
  });
}
```

- [ ] **Step 2: Wire up all routes in server index**

Update `packages/server/src/index.ts` to mount all routes and WebSocket:

```typescript
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDb } from './db/index.js';
import { authRouter } from './routes/auth.js';
import { nodesRouter } from './routes/nodes.js';
import { edgesRouter } from './routes/edges.js';
import { graphRouter } from './routes/graph.js';
import { budgetRouter } from './routes/budget.js';
import { requireAuth } from './middleware/auth.js';
import { setupWebSocket } from './ws/sync.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());

const db = createDb();
app.locals.db = db;
app.locals.io = io;

// Routes
app.use('/api/auth', authRouter);
app.use('/api/nodes', requireAuth, nodesRouter);
app.use('/api/edges', requireAuth, edgesRouter);
app.use('/api/graph', requireAuth, graphRouter);
app.use('/api/budget', requireAuth, budgetRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Serve static client build in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// WebSocket (pass secret so tests can use app.locals.jwtSecret)
const jwtSecret = process.env.JWT_SECRET || 'dev-secret';
app.locals.jwtSecret = jwtSecret;
setupWebSocket(io, jwtSecret);

const PORT = parseInt(process.env.PORT || '3000', 10);
httpServer.listen(PORT, () => {
  console.log(`Rome server listening on port ${PORT}`);
});

export { app, httpServer, io, db };
```

- [ ] **Step 3: Run all server tests**

Run: `cd packages/server && npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/ws/sync.ts packages/server/src/index.ts
git commit -m "feat: add WebSocket auth and wire up all backend routes"
```

---

## Phase 7: Frontend Shell

### Task 11: Vite + React Scaffold

**Files:**
- Create: `packages/client/index.html`
- Create: `packages/client/src/main.tsx`
- Create: `packages/client/src/App.tsx`
- Create: `packages/client/src/index.css`
- Create: `packages/client/vite.config.ts`

- [ ] **Step 1: Create Vite config with API proxy**

`packages/client/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
```

- [ ] **Step 2: Create entry point HTML**

`packages/client/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Rome</title>
  <link href="https://fonts.googleapis.com/css2?family=Tomorrow:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 3: Create global styles with DxD brand**

`packages/client/src/index.css`:
```css
:root {
  --red: #B81917;
  --bg: #FFFFFF;
  --text: #1A1A1A;
  --gray: #414042;
  --status-not-started: #999;
  --status-in-progress: #2563eb;
  --status-blocked: #dc2626;
  --status-done: #16a34a;
  --status-cancelled: #9ca3af;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Tomorrow', sans-serif;
  background: var(--bg);
  color: var(--text);
}

#root {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 4: Create main.tsx and App.tsx**

`packages/client/src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`packages/client/src/App.tsx`:
```tsx
import { useState } from 'react';
import TopBar from './components/TopBar';
import GraphView from './views/GraphView';
import GanttView from './views/GanttView';
import BudgetView from './views/BudgetView';

export type ViewType = 'graph' | 'gantt' | 'budget';

export default function App() {
  const [view, setView] = useState<ViewType>('graph');

  return (
    <>
      <TopBar activeView={view} onViewChange={setView} />
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {view === 'graph' && <GraphView />}
        {view === 'gantt' && <GanttView />}
        {view === 'budget' && <BudgetView />}
      </main>
    </>
  );
}
```

- [ ] **Step 5: Create placeholder views and TopBar**

`packages/client/src/components/TopBar.tsx`:
```tsx
import type { ViewType } from '../App';

interface TopBarProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

const views: { key: ViewType; label: string }[] = [
  { key: 'graph', label: 'Graph' },
  { key: 'gantt', label: 'Gantt' },
  { key: 'budget', label: 'Budget' },
];

export default function TopBar({ activeView, onViewChange }: TopBarProps) {
  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      height: 48,
      borderBottom: '1px solid #e5e5e5',
      gap: 16,
    }}>
      <div style={{
        width: 24,
        height: 24,
        background: '#B81917',
        transform: 'rotate(45deg)',
        flexShrink: 0,
      }} />
      <span style={{ fontWeight: 600, fontSize: 18, marginRight: 24 }}>Rome</span>
      <nav style={{ display: 'flex', gap: 4 }}>
        {views.map(v => (
          <button
            key={v.key}
            onClick={() => onViewChange(v.key)}
            style={{
              padding: '6px 14px',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'Tomorrow, sans-serif',
              fontSize: 14,
              fontWeight: activeView === v.key ? 600 : 400,
              background: activeView === v.key ? '#B81917' : 'transparent',
              color: activeView === v.key ? '#fff' : '#1A1A1A',
            }}
          >
            {v.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
```

`packages/client/src/views/GraphView.tsx`:
```tsx
export default function GraphView() {
  return <div style={{ padding: 24 }}>Graph View (placeholder)</div>;
}
```

`packages/client/src/views/GanttView.tsx`:
```tsx
export default function GanttView() {
  return <div style={{ padding: 24 }}>Gantt View (placeholder)</div>;
}
```

`packages/client/src/views/BudgetView.tsx`:
```tsx
export default function BudgetView() {
  return <div style={{ padding: 24 }}>Budget View (placeholder)</div>;
}
```

- [ ] **Step 6: Verify client builds**

Run: `cd packages/client && npx vite build`
Expected: Build completes successfully.

- [ ] **Step 7: Commit**

```bash
git add packages/client/
git commit -m "feat: add React client scaffold with TopBar and view routing"
```

---

### Task 12: Zustand Store + API Client + WebSocket Sync

**Files:**
- Create: `packages/client/src/store/graphStore.ts`
- Create: `packages/client/src/lib/api.ts`
- Create: `packages/client/src/hooks/useGraph.ts`
- Create: `packages/client/src/hooks/useSync.ts`

- [ ] **Step 1: Create API client**

`packages/client/src/lib/api.ts`:
```typescript
const BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('rome_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error', code: 'UNKNOWN' }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (name: string, email: string, password: string) =>
    request<{ token: string; user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),

  // Graph
  getGraph: () => request<{ nodes: any[]; edges: any[] }>('/graph'),

  // Nodes
  createNode: (data: { name: string; [key: string]: any }) =>
    request<any>('/nodes', { method: 'POST', body: JSON.stringify(data) }),
  updateNode: (id: string, changes: Record<string, any>) =>
    request<any>(`/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  deleteNode: (id: string) =>
    request<void>(`/nodes/${id}`, { method: 'DELETE' }),

  // Edges
  createEdge: (source_id: string, target_id: string, type: 'blocks' | 'parent_of') =>
    request<any>('/edges', { method: 'POST', body: JSON.stringify({ source_id, target_id, type }) }),
  deleteEdge: (id: string) =>
    request<void>(`/edges/${id}`, { method: 'DELETE' }),

  // Budget
  getBudget: (workstream?: string) =>
    request<any>(`/budget${workstream ? `?workstream=${encodeURIComponent(workstream)}` : ''}`),
};
```

- [ ] **Step 2: Create Zustand store**

`packages/client/src/store/graphStore.ts`:
```typescript
import { create } from 'zustand';
import type { RomeNode, RomeEdge } from '@rome/shared/src/types';

interface GraphState {
  nodes: RomeNode[];
  edges: RomeEdge[];
  selectedNodeId: string | null;
  filters: {
    workstream: string | null;
    status: string | null;
    priority: string | null;
    responsible: string | null;
  };

  // Actions
  setGraph: (nodes: RomeNode[], edges: RomeEdge[]) => void;
  addNode: (node: RomeNode) => void;
  updateNode: (id: string, changes: Partial<RomeNode>) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: RomeEdge) => void;
  removeEdge: (id: string) => void;
  selectNode: (id: string | null) => void;
  setFilter: (key: string, value: string | null) => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  filters: { workstream: null, status: null, priority: null, responsible: null },

  setGraph: (nodes, edges) => set({ nodes, edges }),

  addNode: (node) => set((s) => ({ nodes: [...s.nodes, node] })),

  updateNode: (id, changes) => set((s) => ({
    nodes: s.nodes.map(n => n.id === id ? { ...n, ...changes } : n),
  })),

  removeNode: (id) => set((s) => ({
    nodes: s.nodes.filter(n => n.id !== id),
    edges: s.edges.filter(e => e.source_id !== id && e.target_id !== id),
    selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
  })),

  addEdge: (edge) => set((s) => ({ edges: [...s.edges, edge] })),

  removeEdge: (id) => set((s) => ({
    edges: s.edges.filter(e => e.id !== id),
  })),

  selectNode: (id) => set({ selectedNodeId: id }),

  setFilter: (key, value) => set((s) => ({
    filters: { ...s.filters, [key]: value },
  })),
}));
```

- [ ] **Step 3: Create useGraph hook**

`packages/client/src/hooks/useGraph.ts`:
```typescript
import { useEffect } from 'react';
import { api } from '../lib/api';
import { useGraphStore } from '../store/graphStore';

export function useGraph() {
  const setGraph = useGraphStore(s => s.setGraph);

  useEffect(() => {
    api.getGraph().then(({ nodes, edges }) => {
      setGraph(nodes, edges);
    }).catch(console.error);
  }, [setGraph]);
}
```

- [ ] **Step 4: Create useSync hook for WebSocket**

`packages/client/src/hooks/useSync.ts`:
```typescript
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useGraphStore } from '../store/graphStore';

export function useSync() {
  const { addNode, updateNode, removeNode, addEdge, removeEdge } = useGraphStore();

  useEffect(() => {
    const token = localStorage.getItem('rome_token');
    if (!token) return;

    const socket = io({ auth: { token } });

    socket.on('node:created', (node) => addNode(node));
    socket.on('node:updated', ({ id, changes }) => updateNode(id, changes));
    socket.on('node:deleted', ({ id }) => removeNode(id));
    socket.on('edge:created', (edge) => addEdge(edge));
    socket.on('edge:deleted', ({ id }) => removeEdge(id));

    return () => { socket.disconnect(); };
  }, [addNode, updateNode, removeNode, addEdge, removeEdge]);
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/store/ packages/client/src/lib/api.ts packages/client/src/hooks/
git commit -m "feat: add Zustand store, API client, and WebSocket sync hook"
```

---

### Task 13: Node Side Panel

**Files:**
- Create: `packages/client/src/components/NodePanel.tsx`
- Modify: `packages/client/src/App.tsx` (add panel)

- [ ] **Step 1: Create NodePanel component**

`packages/client/src/components/NodePanel.tsx`:
```tsx
import { useState, useEffect } from 'react';
import { useGraphStore } from '../store/graphStore';
import { api } from '../lib/api';
import type { RomeNode, NodeStatus, Priority } from '@rome/shared/src/types';

const statuses: NodeStatus[] = ['not_started', 'in_progress', 'blocked', 'done', 'cancelled'];
const priorities: Priority[] = ['P0', 'P1', 'P2', 'P3'];

export default function NodePanel() {
  const selectedId = useGraphStore(s => s.selectedNodeId);
  const nodes = useGraphStore(s => s.nodes);
  const selectNode = useGraphStore(s => s.selectNode);
  const node = nodes.find(n => n.id === selectedId);

  const [form, setForm] = useState<Partial<RomeNode>>({});

  useEffect(() => {
    if (node) setForm(node);
  }, [node]);

  if (!node) return null;

  async function save(field: string, value: any) {
    if (!selectedId) return;
    try {
      await api.updateNode(selectedId, { [field]: value });
    } catch (e) {
      console.error('Failed to update:', e);
    }
  }

  return (
    <aside style={{
      width: 360,
      borderLeft: '1px solid #e5e5e5',
      padding: 20,
      overflowY: 'auto',
      position: 'absolute',
      right: 0,
      top: 48,
      bottom: 0,
      background: '#fff',
      zIndex: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600 }}>Edit Node</h3>
        <button onClick={() => selectNode(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18 }}>
          ×
        </button>
      </div>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#414042' }}>Name</span>
        <input
          value={form.name || ''}
          onChange={e => setForm({ ...form, name: e.target.value })}
          onBlur={e => save('name', e.target.value)}
          style={{ display: 'block', width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 14 }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#414042' }}>Status</span>
        <select
          value={form.status || 'not_started'}
          onChange={e => { setForm({ ...form, status: e.target.value as NodeStatus }); save('status', e.target.value); }}
          style={{ display: 'block', width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 14 }}
        >
          {statuses.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#414042' }}>Priority</span>
        <select
          value={form.priority || 'P2'}
          onChange={e => { setForm({ ...form, priority: e.target.value as Priority }); save('priority', e.target.value); }}
          style={{ display: 'block', width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 14 }}
        >
          {priorities.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#414042' }}>Workstream</span>
        <input
          value={form.workstream || ''}
          onChange={e => setForm({ ...form, workstream: e.target.value })}
          onBlur={e => save('workstream', e.target.value || null)}
          style={{ display: 'block', width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 14 }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#414042' }}>Budget (USD)</span>
        <input
          type="number"
          value={form.budget ?? ''}
          onChange={e => setForm({ ...form, budget: e.target.value ? Number(e.target.value) : null })}
          onBlur={e => save('budget', e.target.value ? Number(e.target.value) : null)}
          style={{ display: 'block', width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 14 }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#414042' }}>Start Date</span>
        <input
          type="date"
          value={form.start_date || ''}
          onChange={e => { setForm({ ...form, start_date: e.target.value || null }); save('start_date', e.target.value || null); }}
          style={{ display: 'block', width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 14 }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#414042' }}>End Date</span>
        <input
          type="date"
          value={form.end_date || ''}
          onChange={e => { setForm({ ...form, end_date: e.target.value || null }); save('end_date', e.target.value || null); }}
          style={{ display: 'block', width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 14 }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#414042' }}>Deliverable</span>
        <textarea
          value={form.deliverable || ''}
          onChange={e => setForm({ ...form, deliverable: e.target.value })}
          onBlur={e => save('deliverable', e.target.value || null)}
          rows={3}
          style={{ display: 'block', width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 14, resize: 'vertical' }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#414042' }}>Notes (Markdown)</span>
        <textarea
          value={form.notes || ''}
          onChange={e => setForm({ ...form, notes: e.target.value })}
          onBlur={e => save('notes', e.target.value || null)}
          rows={5}
          style={{ display: 'block', width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 14, resize: 'vertical' }}
        />
      </label>

      <button
        onClick={async () => {
          if (!selectedId) return;
          await api.deleteNode(selectedId);
          selectNode(null);
        }}
        style={{
          marginTop: 16,
          padding: '8px 16px',
          background: '#dc2626',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontFamily: 'Tomorrow',
        }}
      >
        Delete Node
      </button>
    </aside>
  );
}
```

- [ ] **Step 2: Wire NodePanel into App.tsx**

Update `App.tsx` to include `NodePanel`, `useGraph`, `useSync`, login gate, and budget->graph navigation:

```tsx
import { useState } from 'react';
import TopBar from './components/TopBar';
import NodePanel from './components/NodePanel';
import LoginPage from './components/LoginPage';
import GraphView from './views/GraphView';
import GanttView from './views/GanttView';
import BudgetView from './views/BudgetView';
import { useGraph } from './hooks/useGraph';
import { useSync } from './hooks/useSync';
import { useGraphStore } from './store/graphStore';

export type ViewType = 'graph' | 'gantt' | 'budget';

export default function App() {
  const [view, setView] = useState<ViewType>('graph');
  const [loggedIn, setLoggedIn] = useState(() => !!localStorage.getItem('rome_token'));
  const selectNode = useGraphStore(s => s.selectNode);

  // Only fetch graph + sync when logged in
  if (loggedIn) {
    useGraph();
    useSync();
  }

  if (!loggedIn) {
    return <LoginPage onLogin={() => setLoggedIn(true)} />;
  }

  // Budget view row click: select node and switch to graph view
  function handleNavigateToNode(nodeId: string) {
    selectNode(nodeId);
    setView('graph');
  }

  return (
    <>
      <TopBar activeView={view} onViewChange={setView} />
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {view === 'graph' && <GraphView />}
        {view === 'gantt' && <GanttView />}
        {view === 'budget' && <BudgetView onNavigateToNode={handleNavigateToNode} />}
        <NodePanel />
      </main>
    </>
  );
}
```

- [ ] **Step 3: Create LoginPage component**

`packages/client/src/components/LoginPage.tsx`:
```tsx
import { useState } from 'react';
import { api } from '../lib/api';

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const result = mode === 'login'
        ? await api.login(email, password)
        : await api.register(name, email, password);
      localStorage.setItem('rome_token', result.token);
      onLogin();
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', fontFamily: 'Tomorrow',
    }}>
      <form onSubmit={handleSubmit} style={{
        width: 320, padding: 32, border: '1px solid #e5e5e5', borderRadius: 8,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 32, height: 32, background: '#B81917',
            transform: 'rotate(45deg)', margin: '0 auto 12px',
          }} />
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Rome</h1>
        </div>

        {mode === 'register' && (
          <input
            placeholder="Name"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ display: 'block', width: '100%', padding: '8px 12px', marginBottom: 8, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 14 }}
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ display: 'block', width: '100%', padding: '8px 12px', marginBottom: 8, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 14 }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ display: 'block', width: '100%', padding: '8px 12px', marginBottom: 16, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 14 }}
        />

        {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <button type="submit" style={{
          width: '100%', padding: '10px', background: '#B81917', color: '#fff',
          border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'Tomorrow',
          fontSize: 14, fontWeight: 600,
        }}>
          {mode === 'login' ? 'Log In' : 'Register'}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          style={{
            width: '100%', marginTop: 8, padding: '8px', background: 'transparent',
            border: 'none', cursor: 'pointer', fontFamily: 'Tomorrow', fontSize: 13,
            color: '#414042',
          }}
        >
          {mode === 'login' ? 'Need an account? Register' : 'Have an account? Log in'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `cd packages/client && npx vite build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/NodePanel.tsx packages/client/src/components/LoginPage.tsx packages/client/src/App.tsx
git commit -m "feat: add NodePanel, LoginPage, and budget->graph navigation"
```

---

## Phase 8: Graph View (can parallelize with Phases 9, 10)

### Task 14: React Flow Canvas with Custom Nodes

**Files:**
- Create: `packages/client/src/components/NodeDot.tsx`
- Create: `packages/client/src/components/ContextMenu.tsx`
- Create: `packages/client/src/components/FilterBar.tsx`
- Modify: `packages/client/src/views/GraphView.tsx`

- [ ] **Step 1: Create NodeDot (custom React Flow node)**

`packages/client/src/components/NodeDot.tsx`:
```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { NodeStatus } from '@rome/shared/src/types';

const statusColors: Record<NodeStatus, string> = {
  not_started: '#999',
  in_progress: '#2563eb',
  blocked: '#dc2626',
  done: '#16a34a',
  cancelled: '#9ca3af',
};

export default function NodeDot({ data }: NodeProps) {
  const color = statusColors[data.status as NodeStatus] || '#999';
  const size = data.budget
    ? Math.min(24, Math.max(8, 8 + Math.log10(data.budget + 1) * 3))
    : 10;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        cursor: 'pointer',
      }} />
      <span style={{
        fontSize: 11,
        marginTop: 4,
        whiteSpace: 'nowrap',
        color: '#1A1A1A',
        textDecoration: data.status === 'cancelled' ? 'line-through' : 'none',
        fontFamily: 'Tomorrow',
      }}>
        {data.label}
      </span>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
```

- [ ] **Step 2: Create ContextMenu**

`packages/client/src/components/ContextMenu.tsx`:
```tsx
import { api } from '../lib/api';
import type { NodeStatus, Priority } from '@rome/shared/src/types';

interface ContextMenuProps {
  x: number;
  y: number;
  nodeId: string;
  allNodes: Array<{ id: string; name: string }>;
  onClose: () => void;
}

const statuses: NodeStatus[] = ['not_started', 'in_progress', 'blocked', 'done', 'cancelled'];
const priorities: Priority[] = ['P0', 'P1', 'P2', 'P3'];

export default function ContextMenu({ x, y, nodeId, allNodes, onClose }: ContextMenuProps) {
  return (
    <div
      style={{
        position: 'fixed',
        left: x,
        top: y,
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: 6,
        padding: 4,
        zIndex: 100,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        minWidth: 160,
        fontFamily: 'Tomorrow',
        fontSize: 13,
      }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{ padding: '4px 8px', fontWeight: 600, color: '#414042', fontSize: 11 }}>Status</div>
      {statuses.map(s => (
        <button
          key={s}
          onClick={() => { api.updateNode(nodeId, { status: s }); onClose(); }}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'Tomorrow' }}
        >
          {s.replace(/_/g, ' ')}
        </button>
      ))}
      <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid #eee' }} />
      <div style={{ padding: '4px 8px', fontWeight: 600, color: '#414042', fontSize: 11 }}>Priority</div>
      {priorities.map(p => (
        <button
          key={p}
          onClick={() => { api.updateNode(nodeId, { priority: p }); onClose(); }}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'Tomorrow' }}
        >
          {p}
        </button>
      ))}
      <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid #eee' }} />
      <div style={{ padding: '4px 8px', fontWeight: 600, color: '#414042', fontSize: 11 }}>Set Parent</div>
      <button
        key="no-parent"
        onClick={() => { /* Would need to find and delete existing parent_of edge */ onClose(); }}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'Tomorrow' }}
      >
        (none)
      </button>
      {allNodes.filter(n => n.id !== nodeId).map(n => (
        <button
          key={n.id}
          onClick={() => { api.createEdge(n.id, nodeId, 'parent_of').catch(console.error); onClose(); }}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'Tomorrow' }}
        >
          {n.name}
        </button>
      ))}
      <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid #eee' }} />
      <button
        onClick={() => { api.deleteNode(nodeId); onClose(); }}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'Tomorrow', color: '#dc2626' }}
      >
        Delete
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create FilterBar**

`packages/client/src/components/FilterBar.tsx`:
```tsx
import { useGraphStore } from '../store/graphStore';

export default function FilterBar() {
  const nodes = useGraphStore(s => s.nodes);
  const filters = useGraphStore(s => s.filters);
  const setFilter = useGraphStore(s => s.setFilter);

  const workstreams = [...new Set(nodes.map(n => n.workstream).filter(Boolean))] as string[];
  const responsibles = [...new Set(
    nodes.flatMap(n => (n.raci as any)?.responsible || []).filter(Boolean)
  )] as string[];

  return (
    <div style={{
      display: 'flex',
      gap: 8,
      padding: '6px 12px',
      borderBottom: '1px solid #e5e5e5',
      fontSize: 13,
      fontFamily: 'Tomorrow',
    }}>
      <select
        value={filters.workstream || ''}
        onChange={e => setFilter('workstream', e.target.value || null)}
        style={{ padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 13 }}
      >
        <option value="">All workstreams</option>
        {workstreams.map(w => <option key={w} value={w}>{w}</option>)}
      </select>
      <select
        value={filters.status || ''}
        onChange={e => setFilter('status', e.target.value || null)}
        style={{ padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 13 }}
      >
        <option value="">All statuses</option>
        <option value="not_started">Not started</option>
        <option value="in_progress">In progress</option>
        <option value="blocked">Blocked</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <select
        value={filters.priority || ''}
        onChange={e => setFilter('priority', e.target.value || null)}
        style={{ padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 13 }}
      >
        <option value="">All priorities</option>
        <option value="P0">P0</option>
        <option value="P1">P1</option>
        <option value="P2">P2</option>
        <option value="P3">P3</option>
      </select>
      <select
        value={filters.responsible || ''}
        onChange={e => setFilter('responsible', e.target.value || null)}
        style={{ padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4, fontFamily: 'Tomorrow', fontSize: 13 }}
      >
        <option value="">All responsible</option>
        {responsibles.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
    </div>
  );
}
```

- [ ] **Step 4: Implement GraphView with React Flow**

`packages/client/src/views/GraphView.tsx`:
```tsx
import { useCallback, useState, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphStore } from '../store/graphStore';
import { api } from '../lib/api';
import NodeDot from '../components/NodeDot';
import ContextMenu from '../components/ContextMenu';
import FilterBar from '../components/FilterBar';
import { useEffect } from 'react';

const nodeTypes = { nodeDot: NodeDot };

function matchesFilter(node: any, filters: any): boolean {
  if (filters.workstream && node.workstream !== filters.workstream) return false;
  if (filters.status && node.status !== filters.status) return false;
  if (filters.priority && node.priority !== filters.priority) return false;
  if (filters.responsible && !(node.raci?.responsible || []).includes(filters.responsible)) return false;
  return true;
}

export default function GraphView() {
  const storeNodes = useGraphStore(s => s.nodes);
  const storeEdges = useGraphStore(s => s.edges);
  const selectNode = useGraphStore(s => s.selectNode);
  const filters = useGraphStore(s => s.filters);
  const hasActiveFilter = filters.workstream || filters.status || filters.priority || filters.responsible;

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Convert store data to React Flow format
  const flowNodes: FlowNode[] = storeNodes.map(n => ({
    id: n.id,
    type: 'nodeDot',
    position: { x: n.x ?? Math.random() * 800, y: n.y ?? Math.random() * 600 },
    data: {
      label: n.name,
      status: n.status,
      budget: n.budget,
    },
    style: {
      opacity: hasActiveFilter && !matchesFilter(n, filters) ? 0.1 : 1,
    },
  }));

  const flowEdges: FlowEdge[] = storeEdges.map(e => ({
    id: e.id,
    source: e.source_id,
    target: e.target_id,
    type: 'default',
    style: {
      stroke: e.type === 'blocks' ? '#dc2626' : '#999',
      strokeWidth: e.type === 'blocks' ? 2 : 1,
    },
    animated: e.type === 'blocks',
  }));

  const onNodeClick = useCallback((_: any, node: FlowNode) => {
    selectNode(node.id);
    setContextMenu(null);
  }, [selectNode]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: FlowNode) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }, []);

  const onPaneClick = useCallback(() => {
    setContextMenu(null);
  }, []);

  const onDoubleClick = useCallback(async (event: React.MouseEvent) => {
    const name = prompt('Node name:');
    if (!name) return;

    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    const x = event.clientX - (bounds?.left || 0);
    const y = event.clientY - (bounds?.top || 0);

    await api.createNode({ name, x, y });
  }, []);

  const onConnect = useCallback(async (connection: Connection) => {
    if (connection.source && connection.target) {
      try {
        await api.createEdge(connection.source, connection.target, 'blocks');
      } catch (e) {
        console.error('Failed to create edge:', e);
      }
    }
  }, []);

  const onNodeDragStop = useCallback(async (_: any, node: FlowNode) => {
    await api.updateNode(node.id, {
      x: node.position.x,
      y: node.position.y,
      position_pinned: true,
    });
  }, []);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <FilterBar />
      <div ref={reactFlowWrapper} style={{ flex: 1 }} onDoubleClick={onDoubleClick}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeId={contextMenu.nodeId}
          allNodes={storeNodes.map(n => ({ id: n.id, name: n.name }))}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

Run: `cd packages/client && npx vite build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/views/GraphView.tsx packages/client/src/components/NodeDot.tsx packages/client/src/components/ContextMenu.tsx packages/client/src/components/FilterBar.tsx
git commit -m "feat: add Graph view with React Flow, custom nodes, context menu, filters"
```

---

### Task 15: Gravity Layout Algorithm

**Files:**
- Create: `packages/client/src/lib/gravity.ts`

- [ ] **Step 1: Implement gravity layout**

`packages/client/src/lib/gravity.ts`:
```typescript
import type { RomeNode, RomeEdge } from '@rome/shared/src/types';

const BASE_DISTANCE = 120;
const PRIORITY_WEIGHT = 30;
const TIME_WEIGHT = 0.5;
const REPULSION = 80;
const WORKSTREAM_ATTRACTION = 0.3;

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  pinned: boolean;
}

const priorityValue: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function gravityLayout(
  nodes: RomeNode[],
  edges: RomeEdge[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Build parent->children map
  const parentOf = new Map<string, string[]>();
  const childToParent = new Map<string, string>();
  for (const edge of edges) {
    if (edge.type === 'parent_of') {
      const children = parentOf.get(edge.source_id) || [];
      children.push(edge.target_id);
      parentOf.set(edge.source_id, children);
      childToParent.set(edge.target_id, edge.source_id);
    }
  }

  // Workstream grouping
  const workstreamCenters = new Map<string, { x: number; y: number }>();
  const wsNodes = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.workstream) {
      const group = wsNodes.get(node.workstream) || [];
      group.push(node.id);
      wsNodes.set(node.workstream, group);
    }
  }

  // Assign workstream centers
  let wsIndex = 0;
  for (const [ws] of wsNodes) {
    const angle = (wsIndex / wsNodes.size) * 2 * Math.PI;
    workstreamCenters.set(ws, {
      x: 400 + Math.cos(angle) * 300,
      y: 400 + Math.sin(angle) * 300,
    });
    wsIndex++;
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const layoutNodes: LayoutNode[] = [];

  // Initialize positions
  for (const node of nodes) {
    if (node.position_pinned && node.x != null && node.y != null) {
      layoutNodes.push({ id: node.id, x: node.x, y: node.y, pinned: true });
    } else if (node.x != null && node.y != null) {
      layoutNodes.push({ id: node.id, x: node.x, y: node.y, pinned: false });
    } else {
      // Initial position: near workstream center or random
      const wsCenter = node.workstream ? workstreamCenters.get(node.workstream) : null;
      layoutNodes.push({
        id: node.id,
        x: (wsCenter?.x ?? 400) + (Math.random() - 0.5) * 200,
        y: (wsCenter?.y ?? 400) + (Math.random() - 0.5) * 200,
        pinned: false,
      });
    }
  }

  const layoutMap = new Map(layoutNodes.map(n => [n.id, n]));

  // Run simulation iterations
  for (let iter = 0; iter < 50; iter++) {
    for (const ln of layoutNodes) {
      if (ln.pinned) continue;

      const node = nodeMap.get(ln.id);
      if (!node) continue;

      let fx = 0, fy = 0;

      // 1. Gravity toward parent
      const parentId = childToParent.get(ln.id);
      if (parentId) {
        const parent = layoutMap.get(parentId);
        if (parent) {
          const pVal = priorityValue[node.priority] ?? 2;
          const daysUntil = node.end_date
            ? Math.max(0, (new Date(node.end_date).getTime() - Date.now()) / 86400000)
            : 30;
          const targetDist = BASE_DISTANCE + pVal * PRIORITY_WEIGHT + daysUntil * TIME_WEIGHT;

          const dx = parent.x - ln.x;
          const dy = parent.y - ln.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (dist - targetDist) * 0.1;
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }
      }

      // 2. Repulsion from siblings
      const siblings = parentId ? (parentOf.get(parentId) || []) : [];
      for (const sibId of siblings) {
        if (sibId === ln.id) continue;
        const sib = layoutMap.get(sibId);
        if (!sib) continue;
        const dx = ln.x - sib.x;
        const dy = ln.y - sib.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < REPULSION * 2) {
          const force = REPULSION / (dist * dist);
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }
      }

      // 3. Workstream attraction
      if (node.workstream) {
        const center = workstreamCenters.get(node.workstream);
        if (center) {
          fx += (center.x - ln.x) * WORKSTREAM_ATTRACTION * 0.01;
          fy += (center.y - ln.y) * WORKSTREAM_ATTRACTION * 0.01;
        }
      }

      ln.x += fx;
      ln.y += fy;
    }
  }

  for (const ln of layoutNodes) {
    positions.set(ln.id, { x: ln.x, y: ln.y });
  }

  return positions;
}
```

- [ ] **Step 2: Integrate gravity layout into GraphView**

Add to `GraphView.tsx` — call `gravityLayout` when nodes lack positions, use the results to place nodes. Add an import of `gravityLayout` and apply it when building `flowNodes`:

```typescript
// At top of GraphView.tsx
import { gravityLayout } from '../lib/gravity';

// Replace the flowNodes mapping with:
const layoutPositions = gravityLayout(storeNodes, storeEdges);

const flowNodes: FlowNode[] = storeNodes.map(n => {
  const pos = (n.position_pinned && n.x != null && n.y != null)
    ? { x: n.x, y: n.y }
    : layoutPositions.get(n.id) || { x: Math.random() * 800, y: Math.random() * 600 };

  return {
    id: n.id,
    type: 'nodeDot',
    position: pos,
    data: { label: n.name, status: n.status, budget: n.budget },
    style: {
      opacity: hasActiveFilter && !matchesFilter(n, filters) ? 0.1 : 1,
    },
  };
});
```

- [ ] **Step 3: Verify build**

Run: `cd packages/client && npx vite build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/lib/gravity.ts packages/client/src/views/GraphView.tsx
git commit -m "feat: add gravity layout algorithm for automatic node positioning"
```

---

## Phase 9: Gantt View (can parallelize with Phases 8, 10)

### Task 16: Gantt Chart

**Files:**
- Modify: `packages/client/src/views/GanttView.tsx`

- [ ] **Step 1: Implement Gantt view**

`packages/client/src/views/GanttView.tsx`:
```tsx
import { useMemo, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import type { RomeNode } from '@rome/shared/src/types';

type TimeScale = 'week' | 'month' | 'quarter';

const statusColors: Record<string, string> = {
  not_started: '#999',
  in_progress: '#2563eb',
  blocked: '#dc2626',
  done: '#16a34a',
  cancelled: '#9ca3af',
};

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86400000;
}

export default function GanttView() {
  const nodes = useGraphStore(s => s.nodes);
  const edges = useGraphStore(s => s.edges);
  const selectNode = useGraphStore(s => s.selectNode);
  const [timeScale, setTimeScale] = useState<TimeScale>('month');

  const { scheduled, unscheduled, timeRange } = useMemo(() => {
    const scheduled: RomeNode[] = [];
    const unscheduled: RomeNode[] = [];

    for (const node of nodes) {
      if (node.start_date && node.end_date) {
        scheduled.push(node);
      } else {
        unscheduled.push(node);
      }
    }

    // Build dependency order (topological sort of blocks edges)
    const blocksEdges = edges.filter(e => e.type === 'blocks');
    const depOrder = new Map<string, number>();
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const n of nodes) {
      inDegree.set(n.id, 0);
      adj.set(n.id, []);
    }
    for (const e of blocksEdges) {
      adj.get(e.source_id)?.push(e.target_id);
      inDegree.set(e.target_id, (inDegree.get(e.target_id) || 0) + 1);
    }
    const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    let order = 0;
    while (queue.length > 0) {
      const id = queue.shift()!;
      depOrder.set(id, order++);
      for (const next of adj.get(id) || []) {
        const d = (inDegree.get(next) || 1) - 1;
        inDegree.set(next, d);
        if (d === 0) queue.push(next);
      }
    }

    // Sort by workstream group -> dependency order -> start_date
    scheduled.sort((a, b) => {
      const ws = (a.workstream || '').localeCompare(b.workstream || '');
      if (ws !== 0) return ws;
      const depA = depOrder.get(a.id) ?? 999;
      const depB = depOrder.get(b.id) ?? 999;
      if (depA !== depB) return depA - depB;
      return (a.start_date || '').localeCompare(b.start_date || '');
    });

    // Determine time range
    const dates = scheduled
      .flatMap(n => [n.start_date, n.end_date])
      .filter(Boolean)
      .map(d => new Date(d!).getTime());

    const min = dates.length > 0 ? new Date(Math.min(...dates)) : new Date();
    const max = dates.length > 0 ? new Date(Math.max(...dates)) : new Date(Date.now() + 90 * 86400000);

    // Pad by 7 days
    min.setDate(min.getDate() - 7);
    max.setDate(max.getDate() + 7);

    return { scheduled, unscheduled, timeRange: { min, max } };
  }, [nodes, edges]);

  const totalDays = daysBetween(timeRange.min, timeRange.max);
  const pxPerDay = timeScale === 'week' ? 20 : timeScale === 'month' ? 8 : 3;
  const totalWidth = totalDays * pxPerDay;
  const now = new Date();
  const ROW_HEIGHT = 32;

  // Build row index map for arrow rendering
  const rowIndex = new Map(scheduled.map((n, i) => [n.id, i]));
  const ganttBlocksEdges = edges.filter(e => e.type === 'blocks');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #e5e5e5', display: 'flex', gap: 8 }}>
        {(['week', 'month', 'quarter'] as TimeScale[]).map(s => (
          <button
            key={s}
            onClick={() => setTimeScale(s)}
            style={{
              padding: '4px 10px',
              border: '1px solid #ddd',
              borderRadius: 4,
              background: timeScale === s ? '#B81917' : '#fff',
              color: timeScale === s ? '#fff' : '#1A1A1A',
              cursor: 'pointer',
              fontFamily: 'Tomorrow',
              fontSize: 12,
            }}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'flex', minWidth: totalWidth + 250 }}>
          {/* Label column */}
          <div style={{ width: 250, flexShrink: 0, borderRight: '1px solid #e5e5e5' }}>
            <div style={{ height: 28, borderBottom: '1px solid #e5e5e5', padding: '4px 8px', fontWeight: 600, fontSize: 12 }}>
              Task
            </div>
            {scheduled.map((node, i) => (
              <div
                key={node.id}
                onClick={() => selectNode(node.id)}
                style={{
                  height: ROW_HEIGHT,
                  padding: '4px 8px',
                  fontSize: 12,
                  cursor: 'pointer',
                  borderBottom: '1px solid #f0f0f0',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: 'Tomorrow',
                }}
              >
                {node.name}
              </div>
            ))}
            {unscheduled.length > 0 && (
              <>
                <div style={{ height: ROW_HEIGHT, padding: '8px 8px 4px', fontWeight: 600, fontSize: 11, color: '#414042' }}>
                  Unscheduled
                </div>
                {unscheduled.map(node => (
                  <div
                    key={node.id}
                    onClick={() => selectNode(node.id)}
                    style={{
                      height: ROW_HEIGHT,
                      padding: '4px 8px',
                      fontSize: 12,
                      cursor: 'pointer',
                      color: '#999',
                      fontFamily: 'Tomorrow',
                    }}
                  >
                    {node.name}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Timeline area */}
          <div style={{ flex: 1, position: 'relative' }}>
            {/* Header with dates */}
            <div style={{ height: 28, borderBottom: '1px solid #e5e5e5', position: 'relative' }}>
              {/* Date markers would go here - simplified for V1 */}
            </div>

            {/* Today line */}
            {now >= timeRange.min && now <= timeRange.max && (
              <div style={{
                position: 'absolute',
                left: daysBetween(timeRange.min, now) * pxPerDay,
                top: 0,
                bottom: 0,
                width: 2,
                background: '#B81917',
                zIndex: 5,
                opacity: 0.5,
              }} />
            )}

            {/* Bars */}
            {scheduled.map((node, i) => {
              if (!node.start_date || !node.end_date) return null;
              const start = daysBetween(timeRange.min, new Date(node.start_date));
              const duration = daysBetween(new Date(node.start_date), new Date(node.end_date));
              const isOverdue = new Date(node.end_date) < now && node.status !== 'done';

              return (
                <div
                  key={node.id}
                  onClick={() => selectNode(node.id)}
                  style={{
                    position: 'absolute',
                    left: start * pxPerDay,
                    top: 28 + i * ROW_HEIGHT + 6,
                    width: Math.max(duration * pxPerDay, 4),
                    height: ROW_HEIGHT - 12,
                    background: statusColors[node.status] || '#999',
                    borderRadius: 3,
                    cursor: 'pointer',
                    border: isOverdue ? '2px solid #dc2626' : 'none',
                    opacity: 0.85,
                  }}
                />
              );
            })}

            {/* Dependency arrows between bars */}
            <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 4 }}>
              <defs>
                <marker id="gantt-arrow" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
                  <path d="M0,0 L6,2 L0,4" fill="#dc2626" />
                </marker>
              </defs>
              {ganttBlocksEdges.map(e => {
                const srcIdx = rowIndex.get(e.source_id);
                const tgtIdx = rowIndex.get(e.target_id);
                const srcNode = scheduled.find(n => n.id === e.source_id);
                const tgtNode = scheduled.find(n => n.id === e.target_id);
                if (srcIdx == null || tgtIdx == null || !srcNode?.end_date || !tgtNode?.start_date) return null;

                const x1 = daysBetween(timeRange.min, new Date(srcNode.end_date)) * pxPerDay;
                const y1 = 28 + srcIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
                const x2 = daysBetween(timeRange.min, new Date(tgtNode.start_date)) * pxPerDay;
                const y2 = 28 + tgtIdx * ROW_HEIGHT + ROW_HEIGHT / 2;

                return (
                  <line
                    key={e.id}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="#dc2626" strokeWidth={1.5}
                    markerEnd="url(#gantt-arrow)"
                  />
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd packages/client && npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/views/GanttView.tsx
git commit -m "feat: add Gantt view with timeline bars, dependency arrows, time scale toggle"
```

---

## Phase 10: Budget View (can parallelize with Phases 8, 9)

### Task 17: Budget Dashboard

**Files:**
- Modify: `packages/client/src/views/BudgetView.tsx`

- [ ] **Step 1: Implement Budget view**

`packages/client/src/views/BudgetView.tsx`:
```tsx
import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useGraphStore } from '../store/graphStore';
import type { BudgetResponse } from '@rome/shared/src/types';

interface BudgetViewProps {
  onNavigateToNode?: (nodeId: string) => void;
}

export default function BudgetView({ onNavigateToNode }: BudgetViewProps) {
  const [budget, setBudget] = useState<BudgetResponse | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<'name' | 'budget' | 'status' | 'priority'>('budget');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const selectNode = useGraphStore(s => s.selectNode);

  useEffect(() => {
    api.getBudget().then(setBudget).catch(console.error);
  }, []);

  if (!budget) return <div style={{ padding: 24 }}>Loading...</div>;

  const grandTotal = budget.workstreams.reduce((sum, ws) => sum + ws.total, 0);

  function toggleExpand(name: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function sortItems(items: BudgetResponse['workstreams'][0]['items']) {
    return [...items].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'budget') cmp = (a.budget || 0) - (b.budget || 0);
      else if (sortField === 'status') cmp = a.status.localeCompare(b.status);
      else if (sortField === 'priority') cmp = a.priority.localeCompare(b.priority);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  const fmt = (n: number) => '$' + n.toLocaleString();

  return (
    <div style={{ padding: 24, overflow: 'auto', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 14, color: '#414042', fontFamily: 'Tomorrow' }}>Total Budget</div>
        <div style={{ fontSize: 48, fontWeight: 700, color: '#1A1A1A', fontFamily: 'Tomorrow' }}>
          {fmt(grandTotal)}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 16 }}>
        {budget.workstreams.map(ws => (
          <div
            key={ws.name}
            style={{
              border: '1px solid #e5e5e5',
              borderRadius: 8,
              padding: 16,
              fontFamily: 'Tomorrow',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>{ws.name}</h3>
              <span style={{ fontSize: 20, fontWeight: 600 }}>{fmt(ws.total)}</span>
            </div>

            {/* Allocated bar */}
            <div style={{
              height: 8,
              background: '#e5e5e5',
              borderRadius: 4,
              overflow: 'hidden',
              marginBottom: 12,
            }}>
              <div style={{
                height: '100%',
                width: grandTotal > 0 ? `${(ws.total / grandTotal) * 100}%` : '0%',
                background: '#B81917',
                borderRadius: 4,
              }} />
            </div>

            <button
              onClick={() => toggleExpand(ws.name)}
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: '#414042',
                fontFamily: 'Tomorrow',
                padding: 0,
              }}
            >
              {expanded.has(ws.name) ? '- Collapse' : '+ Expand'} ({ws.items.length} items)
            </button>

            {expanded.has(ws.name) && (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 12 }}>
                <thead>
                  <tr>
                    {(['name', 'budget', 'status', 'priority'] as const).map(col => (
                      <th
                        key={col}
                        onClick={() => toggleSort(col)}
                        style={{
                          textAlign: 'left',
                          padding: '4px 8px',
                          borderBottom: '1px solid #e5e5e5',
                          cursor: 'pointer',
                          fontWeight: 600,
                          color: '#414042',
                        }}
                      >
                        {col.charAt(0).toUpperCase() + col.slice(1)}
                        {sortField === col && (sortDir === 'asc' ? ' ^' : ' v')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortItems(ws.items).map(item => (
                    <tr
                      key={item.id}
                      onClick={() => { selectNode(item.id); onNavigateToNode?.(item.id); }}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>{item.name}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>{item.budget != null ? fmt(item.budget) : '-'}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>{item.status.replace(/_/g, ' ')}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>{item.priority}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd packages/client && npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/views/BudgetView.tsx
git commit -m "feat: add Budget dashboard with workstream cards and sortable tables"
```

---

## Phase 11: CLI (can parallelize with frontend work)

### Task 18: CLI Tool

**Files:**
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/config.ts`
- Create: `packages/cli/src/commands/auth.ts`
- Create: `packages/cli/src/commands/node.ts`
- Create: `packages/cli/src/commands/edge.ts`
- Create: `packages/cli/src/commands/views.ts`

- [ ] **Step 1: Create config module**

`packages/cli/src/config.ts`:
```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.rome');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface Config {
  server: string;
  token: string | null;
}

export function getConfig(): Config {
  if (!existsSync(CONFIG_FILE)) {
    return { server: 'http://localhost:3000', token: null };
  }
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
}

export function saveConfig(config: Partial<Config>) {
  const current = getConfig();
  const merged = { ...current, ...config };
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}
```

- [ ] **Step 2: Create auth command**

`packages/cli/src/commands/auth.ts`:
```typescript
import { Command } from 'commander';
import { getConfig, saveConfig } from '../config.js';

export const authCommand = new Command('login')
  .requiredOption('--email <email>', 'Email address')
  .requiredOption('--password <password>', 'Password')
  .action(async (opts) => {
    const config = getConfig();
    const res = await fetch(`${config.server}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: opts.email, password: opts.password }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error(`Login failed: ${err.error}`);
      process.exit(1);
    }

    const data = await res.json();
    saveConfig({ token: data.token });
    console.log(`Logged in as ${data.user.name} (${data.user.role})`);
  });
```

- [ ] **Step 3: Create node commands**

`packages/cli/src/commands/node.ts`:
```typescript
import { Command } from 'commander';
import { getConfig } from '../config.js';

function authHeaders() {
  const config = getConfig();
  if (!config.token) { console.error('Not logged in. Run: rome login'); process.exit(1); }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` };
}

function serverUrl() { return getConfig().server; }

export const nodeCommand = new Command('node');

nodeCommand
  .command('create <name>')
  .option('--priority <priority>', 'P0-P3')
  .option('--workstream <workstream>')
  .option('--status <status>')
  .option('--budget <budget>')
  .action(async (name, opts) => {
    const body: any = { name };
    if (opts.priority) body.priority = opts.priority;
    if (opts.workstream) body.workstream = opts.workstream;
    if (opts.status) body.status = opts.status;
    if (opts.budget) body.budget = Number(opts.budget);

    const res = await fetch(`${serverUrl()}/api/nodes`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
    });
    const node = await res.json();
    if (!res.ok) { console.error(node.error); process.exit(1); }
    console.log(`Created: ${node.id} "${node.name}" [${node.priority}]`);
  });

nodeCommand
  .command('list')
  .option('--workstream <workstream>')
  .option('--status <status>')
  .option('--priority <priority>')
  .action(async (opts) => {
    const params = new URLSearchParams();
    if (opts.workstream) params.set('workstream', opts.workstream);
    if (opts.status) params.set('status', opts.status);
    if (opts.priority) params.set('priority', opts.priority);

    const res = await fetch(`${serverUrl()}/api/nodes?${params}`, { headers: authHeaders() });
    const nodes = await res.json();
    if (!res.ok) { console.error(nodes.error); process.exit(1); }

    if (nodes.length === 0) { console.log('No nodes found.'); return; }
    for (const n of nodes) {
      console.log(`${n.id.slice(0, 8)}  [${n.priority}] ${n.status.padEnd(12)} ${n.name}`);
    }
  });

nodeCommand
  .command('get <id>')
  .action(async (id) => {
    const res = await fetch(`${serverUrl()}/api/nodes/${id}`, { headers: authHeaders() });
    const node = await res.json();
    if (!res.ok) { console.error(node.error); process.exit(1); }
    console.log(JSON.stringify(node, null, 2));
  });

nodeCommand
  .command('update <id>')
  .option('--name <name>')
  .option('--status <status>')
  .option('--priority <priority>')
  .option('--budget <budget>')
  .option('--workstream <workstream>')
  .action(async (id, opts) => {
    const body: any = {};
    if (opts.name) body.name = opts.name;
    if (opts.status) body.status = opts.status;
    if (opts.priority) body.priority = opts.priority;
    if (opts.budget) body.budget = Number(opts.budget);
    if (opts.workstream) body.workstream = opts.workstream;

    const res = await fetch(`${serverUrl()}/api/nodes/${id}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
    });
    const node = await res.json();
    if (!res.ok) { console.error(node.error); process.exit(1); }
    console.log(`Updated: ${node.id} "${node.name}"`);
  });

nodeCommand
  .command('delete <id>')
  .action(async (id) => {
    const res = await fetch(`${serverUrl()}/api/nodes/${id}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    if (!res.ok) { const err = await res.json(); console.error(err.error); process.exit(1); }
    console.log('Deleted.');
  });
```

- [ ] **Step 4: Create edge commands**

`packages/cli/src/commands/edge.ts`:
```typescript
import { Command } from 'commander';
import { getConfig } from '../config.js';

function authHeaders() {
  const config = getConfig();
  if (!config.token) { console.error('Not logged in.'); process.exit(1); }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` };
}

function serverUrl() { return getConfig().server; }

export const edgeCommand = new Command('edge');

edgeCommand
  .command('create <source> <target>')
  .option('--type <type>', 'blocks or parent_of', 'blocks')
  .action(async (source, target, opts) => {
    const res = await fetch(`${serverUrl()}/api/edges`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ source_id: source, target_id: target, type: opts.type }),
    });
    const edge = await res.json();
    if (!res.ok) { console.error(edge.error); process.exit(1); }
    console.log(`Created edge: ${edge.id} (${edge.type})`);
  });

edgeCommand
  .command('delete <id>')
  .action(async (id) => {
    const res = await fetch(`${serverUrl()}/api/edges/${id}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    if (!res.ok) { const err = await res.json(); console.error(err.error); process.exit(1); }
    console.log('Deleted.');
  });
```

- [ ] **Step 5: Create view commands (graph, budget)**

`packages/cli/src/commands/views.ts`:
```typescript
import { Command } from 'commander';
import { getConfig } from '../config.js';

function authHeaders() {
  const config = getConfig();
  if (!config.token) { console.error('Not logged in.'); process.exit(1); }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` };
}

function serverUrl() { return getConfig().server; }

export const graphCommand = new Command('graph')
  .action(async () => {
    const res = await fetch(`${serverUrl()}/api/graph`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) { console.error(data.error); process.exit(1); }

    console.log(`Nodes: ${data.nodes.length}  Edges: ${data.edges.length}\n`);
    for (const n of data.nodes) {
      console.log(`  ${n.id.slice(0, 8)}  [${n.priority}] ${n.status.padEnd(12)} ${n.name}`);
    }
    if (data.edges.length > 0) {
      console.log('\nEdges:');
      for (const e of data.edges) {
        console.log(`  ${e.source_id.slice(0, 8)} --(${e.type})--> ${e.target_id.slice(0, 8)}`);
      }
    }
  });

export const budgetCommand = new Command('budget')
  .option('--workstream <workstream>')
  .action(async (opts) => {
    const params = opts.workstream ? `?workstream=${encodeURIComponent(opts.workstream)}` : '';
    const res = await fetch(`${serverUrl()}/api/budget${params}`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) { console.error(data.error); process.exit(1); }

    for (const ws of data.workstreams) {
      console.log(`\n${ws.name}: $${ws.total.toLocaleString()}`);
      console.log('  ' + '-'.repeat(50));
      for (const item of ws.items) {
        const budget = item.budget != null ? `$${item.budget.toLocaleString()}` : '-';
        console.log(`  ${item.name.padEnd(30)} ${budget.padStart(12)}  ${item.status}`);
      }
    }
  });
```

- [ ] **Step 6: Wire up CLI entry point**

`packages/cli/src/index.ts`:
```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { authCommand } from './commands/auth.js';
import { nodeCommand } from './commands/node.js';
import { edgeCommand } from './commands/edge.js';
import { graphCommand, budgetCommand } from './commands/views.js';

const program = new Command('rome')
  .description('Rome CLI — project management from the terminal')
  .version('0.1.0');

program.addCommand(authCommand);
program.addCommand(nodeCommand);
program.addCommand(edgeCommand);
program.addCommand(graphCommand);
program.addCommand(budgetCommand);

program.parse();
```

- [ ] **Step 7: Verify CLI compiles**

Run: `cd packages/cli && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/
git commit -m "feat: add CLI with auth, node, edge, graph, and budget commands"
```

---

## Phase 12: Docker

### Task 19: Dockerfile + Docker Compose

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 1: Create Dockerfile**

`Dockerfile`:
```dockerfile
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

RUN npm install

COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/client/ packages/client/

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/client
RUN npm run build --workspace=packages/server

FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/server/package.json packages/server/

RUN npm install --omit=dev

COPY --from=builder /app/packages/shared/dist/ packages/shared/dist/
COPY --from=builder /app/packages/server/dist/ packages/server/dist/
COPY --from=builder /app/packages/client/dist/ packages/client/dist/

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
```

- [ ] **Step 2: Create docker-compose.yml**

`docker-compose.yml`:
```yaml
services:
  rome:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - rome-data:/app/data
    environment:
      - JWT_SECRET=${JWT_SECRET:-change-me-in-production}
      - PORT=3000
      - DB_PATH=/app/data/rome.db

volumes:
  rome-data:
```

- [ ] **Step 3: Add .dockerignore**

`.dockerignore`:
```
node_modules
*/node_modules
*.db
data/
.git
```

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "feat: add Docker single-container deployment"
```

---

## Post-Build Verification Checklist

After all phases are complete, run these checks:

- [ ] `cd packages/server && npx vitest run` — all backend tests pass
- [ ] `cd packages/client && npx vite build` — frontend builds cleanly
- [ ] `cd packages/cli && npx tsc --noEmit` — CLI compiles
- [ ] Start server: `npm run dev` → register first user → create nodes → verify graph view
- [ ] Test WebSocket: open two browser tabs, edit in one, see update in other
- [ ] Test CLI: `rome login`, `rome node create`, `rome graph`
- [ ] `docker compose build` — container builds successfully
