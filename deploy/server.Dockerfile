# The Glofly server as a Docker image (built on the live machine by deploy/docker-compose.yml).
# Build context is the repo root, because npm workspaces share one package-lock.json.

# ---- 1. Build: install everything, compile TypeScript to dist/ ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
# Every workspace's package.json is needed for `npm ci` to accept the shared lockfile,
# but only the server's packages get installed.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci -w @glofly/server --ignore-scripts --no-audit --no-fund
COPY apps/server/ apps/server/
RUN npm run build -w @glofly/server

# ---- 2. Run: only what the server needs at runtime ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci -w @glofly/server --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

# Amazon's certificate list, so the encrypted connection to RDS is verified (see src/db/index.ts).
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-global-bundle.pem
ENV DATABASE_CA_FILE=/etc/ssl/rds-global-bundle.pem

WORKDIR /app/apps/server
COPY --from=build /app/apps/server/dist ./dist
COPY apps/server/drizzle ./drizzle

# Never run as root inside the container.
USER node
EXPOSE 4000
# Apply any new database migrations, then start. If a migration fails, the server doesn't start.
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/index.js"]
