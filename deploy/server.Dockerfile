# The Glofly server as a Docker image (built on the live machine by deploy/docker-compose.yml).
# Build context is the repo root, because npm workspaces share one package-lock.json.

# ---- 1. Build: install everything, compile TypeScript to dist/ ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
# Every workspace's package.json is needed for `npm ci` to accept the shared lockfile,
# but only the server's packages get installed. A new app in apps/ (or package in packages/)
# needs a COPY line here and in the run stage.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
COPY apps/control/package.json apps/control/
COPY apps/mobile/package.json apps/mobile/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w @glofly/server -w @glofly/shared --ignore-scripts --no-audit --no-fund
# Types, rules and helpers shared with the apps (built to packages/shared/dist first).
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/
RUN npm run build -w @glofly/shared && npm run build -w @glofly/server

# ---- 2. Run: only what the server needs at runtime ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production
# ffmpeg turns voice messages into AAC for iPhones (src/messages/voiceM4a.ts).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
COPY apps/control/package.json apps/control/
COPY apps/mobile/package.json apps/mobile/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w @glofly/server --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

# Amazon's certificate list, so the encrypted connection to RDS is verified (see src/db/index.ts).
# (Kept in its own folder: ADD --chmod into /etc/ssl locked that folder and broke Node's OpenSSL.)
RUN mkdir -p /opt/certs
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /opt/certs/rds-global-bundle.pem
RUN chmod 755 /opt/certs && chmod 644 /opt/certs/rds-global-bundle.pem
ENV DATABASE_CA_FILE=/opt/certs/rds-global-bundle.pem

COPY --from=build /app/packages/shared/dist /app/packages/shared/dist

WORKDIR /app/apps/server
COPY --from=build /app/apps/server/dist ./dist
COPY apps/server/drizzle ./drizzle

# Never run as root inside the container.
USER node
EXPOSE 4000
# Apply any new database migrations, then start. If a migration fails, the server doesn't start.
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/index.js"]
