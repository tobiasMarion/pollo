# Build context is the repo root (see infra/compose.prod.yaml).
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/backend/package.json apps/backend/
# The lockfile covers the whole workspace, so the backend manifest has to be
# present for `npm ci` even though nothing here builds it.
RUN npm ci --workspace=@pollo/web --include-workspace-root
COPY apps/web/svelte.config.js apps/web/vite.config.ts apps/web/tsconfig.json apps/web/
COPY apps/web/src apps/web/src
COPY apps/web/static apps/web/static
RUN npm run build --workspace=@pollo/web

FROM base AS runtime
ENV NODE_ENV=production
# adapter-node bundles the server, and the panel declares no runtime
# dependencies, so the image needs no node_modules at all.
COPY --from=build /app/apps/web/build ./build
EXPOSE 3000
CMD ["node", "build/index.js"]
