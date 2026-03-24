# Rome

In-house project management software.

## Architecture

npm workspaces monorepo:
- `packages/shared` — TypeScript types and Drizzle ORM schema
- `packages/server` — Express API server with SQLite
- `packages/client` — Frontend (placeholder)
- `packages/cli` — CLI tool (placeholder)

## Development

```bash
npm install                          # Install all dependencies
npm run build --workspace=packages/shared  # Build shared types first
npm run typecheck                    # Typecheck all packages
npm run test                         # Run all tests
```

## Definition of Done

```bash
npm run build --workspace=packages/shared
npm run typecheck --workspace=packages/server
npm run test --workspace=packages/server
```
