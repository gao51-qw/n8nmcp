# Main app (TanStack Start) — Node runtime, for VPS deployment.
# Build with:  docker build -t ghcr.io/OWNER/n8nworkflow-app:latest .
FROM node:22-alpine AS build
WORKDIR /app

# Install deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    (npm ci || npm install)

# Copy source and build using the VPS vite config (Node target)
COPY . .
RUN npx vite build --config vite.config.vps.ts

# ---------- runtime ----------
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

COPY --from=build /app/.output ./.output
COPY --from=build /app/package.json ./package.json

EXPOSE 3001
# TanStack Start node-server entry
CMD ["node", ".output/server/index.mjs"]
