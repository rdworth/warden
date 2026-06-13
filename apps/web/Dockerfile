# Build context is the REPO ROOT (set Railway's root directory to "/").
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# NEXT_PUBLIC_* vars are inlined into the bundle at BUILD time, so it must be
# present here. Railway passes service variables to the build as args.
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN pnpm --filter web... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
# Next reads PORT from the env (Railway injects it).
CMD ["pnpm", "--filter", "web", "start"]
