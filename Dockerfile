# Main app (Next.js) - Node runtime, for VPS deployment.
# Build with:  docker build -t ghcr.io/OWNER/n8nworkflow-app:latest .
FROM node:22-alpine AS build
WORKDIR /app

ARG NEXT_PUBLIC_MCP_SITE_URL
ARG NEXT_PUBLIC_MCP_ENDPOINT_URL
ARG NEXT_PUBLIC_DOCS_URL
ARG NEXT_PUBLIC_BLOG_URL
ARG NEXT_PUBLIC_DASHBOARD_URL
ARG NEXT_PUBLIC_SECURITY_EMAIL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_MCP_SITE_URL=${NEXT_PUBLIC_MCP_SITE_URL} \
    NEXT_PUBLIC_MCP_ENDPOINT_URL=${NEXT_PUBLIC_MCP_ENDPOINT_URL} \
    NEXT_PUBLIC_DOCS_URL=${NEXT_PUBLIC_DOCS_URL} \
    NEXT_PUBLIC_BLOG_URL=${NEXT_PUBLIC_BLOG_URL} \
    NEXT_PUBLIC_DASHBOARD_URL=${NEXT_PUBLIC_DASHBOARD_URL} \
    NEXT_PUBLIC_SECURITY_EMAIL=${NEXT_PUBLIC_SECURITY_EMAIL} \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}

# Install deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    (npm ci || npm install)

# Copy source and build the Next.js standalone server.
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:22-alpine AS run
WORKDIR /app

# Build provenance — surfaced on /admin/deployment.
ARG APP_GIT_SHA=""
ARG APP_GIT_BRANCH=""
ARG APP_BUILT_AT=""
ARG APP_GITHUB_REPO=""
ARG APP_IMAGE_TAG=""
ENV APP_GIT_SHA=${APP_GIT_SHA} \
    APP_GIT_BRANCH=${APP_GIT_BRANCH} \
    APP_BUILT_AT=${APP_BUILT_AT} \
    APP_GITHUB_REPO=${APP_GITHUB_REPO} \
    APP_IMAGE_TAG=${APP_IMAGE_TAG}

ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/package.json ./package.json

# Drop root: the node:22-alpine image ships a non-root `node` user (uid 1000).
# Any RCE in the app then lands as an unprivileged user, not root.
USER node

EXPOSE 3001
CMD ["node", "server.js"]
