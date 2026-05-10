# syntax=docker/dockerfile:1.7
# Multi-stage: build the SQLite knowledge base, then ship a slim runtime image.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      git python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN corepack enable && npm install --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY tsconfig.json packages.json ./
COPY scripts ./scripts
COPY src ./src
# Build the SQLite knowledge base. ~5-10 min on first run.
RUN npm run build:db
# Compile TS → dist/
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -r -u 1001 -g nogroup app
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/data ./data
USER app
ENV PORT=3000 DB_PATH=/app/data/nodes.db
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
