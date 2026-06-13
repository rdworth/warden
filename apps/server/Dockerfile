# Build context is the REPO ROOT (set Railway's root directory to "/").
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Builds @warden/contracts and @warden/core first (dependency order), then server.
RUN pnpm --filter server... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 8080
# Run node directly (not via pnpm) so SIGTERM reaches the process cleanly and
# there's no corepack/pnpm resolution at container start.
CMD ["node", "apps/server/dist/index.js"]
