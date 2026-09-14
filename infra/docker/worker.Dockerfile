# Build context is the repo root (see infra/compose.prod.yaml).
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/geometry/package.json packages/geometry/
RUN npm ci
COPY packages/geometry/tsconfig.json packages/geometry/tsconfig.build.json packages/geometry/
COPY packages/geometry/src packages/geometry/src
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.build.json packages/contracts/
COPY packages/contracts/src packages/contracts/src
RUN npm run packages
COPY apps/worker/tsconfig.json apps/worker/tsconfig.build.json apps/worker/
COPY apps/worker/src apps/worker/src
RUN npm run build --workspace=@pollo/worker

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/geometry/package.json packages/geometry/
RUN npm ci --omit=dev
COPY --from=build /app/packages/geometry/dist packages/geometry/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
CMD ["node", "apps/worker/dist/main.js"]
