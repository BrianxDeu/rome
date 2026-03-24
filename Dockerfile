# Stage 1: Install dependencies
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/cli/package.json packages/cli/
RUN npm ci

# Stage 2: Build shared types, client, and server
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/client packages/client
# Build shared first (server and client depend on it)
RUN npm run build --workspace=packages/shared
# Build client (produces static assets)
RUN npm run build --workspace=packages/client
# Build server
RUN npm run build --workspace=packages/server

# Stage 3: Production runtime
FROM node:20-slim AS runtime
WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/cli/package.json packages/cli/
RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist

# SQLite data directory
RUN mkdir -p /data
ENV DATABASE_PATH=/data/rome.db
ENV PORT=3000
EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
