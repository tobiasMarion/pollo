# Build context is the repo root (see infra/compose.prod.yaml).
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci
# The API imports the contracts as a built package, so they compile first.
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.build.json packages/contracts/
COPY packages/contracts/src packages/contracts/src
RUN npm run build --workspace=@pollo/contracts
COPY apps/backend/tsconfig.json apps/backend/tsconfig.build.json apps/backend/prisma.config.ts apps/backend/
COPY apps/backend/prisma apps/backend/prisma
COPY apps/backend/src apps/backend/src
# prisma.config.ts resolves env('DATABASE_URL') at load time even for
# `prisma generate` (run by the prebuild hook), which never connects.
ENV DATABASE_URL="postgresql://build:build@build:5432/build"
RUN npm run build --workspace=@pollo/backend

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
# `dist` alone is not enough: the manifest is what makes npm link
# node_modules/@pollo/contracts, which is how the compiled API resolves it.
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --omit=dev
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
# The generated client is compiled into dist by tsc; prisma/ and the config
# stay only for `migrate deploy` at container startup (prisma is a production
# dependency precisely for that).
COPY apps/backend/prisma.config.ts apps/backend/
COPY apps/backend/prisma apps/backend/prisma
COPY --from=build /app/apps/backend/dist apps/backend/dist
EXPOSE 3333
CMD ["node", "apps/backend/dist/server.js"]
