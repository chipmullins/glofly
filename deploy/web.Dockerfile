# Glofly in a browser (chat.glofly.app), built on the live machine by deploy/docker-compose.yml.
# Build context is the repo root (npm workspaces share one package-lock.json).
#
# It builds apps/web (the desktop app's screens + the browser bridge) into plain files, then the
# small run stage copies them into the chat_site volume, which Caddy serves. Hashed file names
# (assets/…) mean a newer build never breaks a tab that's still open on the older one.

# ---- 1. Build ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
# Every workspace's package.json is needed for `npm ci` to accept the shared lockfile.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
COPY apps/control/package.json apps/control/
COPY apps/mobile/package.json apps/mobile/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w @glofly/web -w @glofly/shared --ignore-scripts --no-audit --no-fund
# Only what the web app is made of: the shared code, the desktop app's screens and its
# Twemoji plugin, and the web app itself.
COPY packages/shared/ packages/shared/
COPY apps/desktop/src/renderer/ apps/desktop/src/renderer/
COPY apps/desktop/src/preload/ apps/desktop/src/preload/
COPY apps/desktop/vite-twemoji.ts apps/desktop/
COPY apps/web/ apps/web/
# The Glofly server the page talks to (docker-compose.yml passes https://<API_DOMAIN>).
ARG GLOFLY_API_URL=https://api.glofly.app
ENV GLOFLY_API_URL=${GLOFLY_API_URL}
RUN npm run build -w @glofly/web

# ---- 2. Copy into the site volume ----
FROM alpine:3.22
COPY --from=build /app/apps/web/dist /site
# New assets first, then the pages that point at them, so nobody loads a page whose files
# aren't there yet. Older assets stay (open tabs may still want them).
CMD ["sh", "-c", "mkdir -p /out && cp -R /site/assets /site/twemoji /site/icons /out/ && cp /site/manifest.webmanifest /site/robots.txt /site/sw.js /out/ && cp /site/index.html /out/index.html.new && mv /out/index.html.new /out/index.html && cp /site/version.json /out/ && echo 'Glofly web app copied.'"]
