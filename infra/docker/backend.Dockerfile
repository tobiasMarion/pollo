# Build context is the repo root (see infra/compose.prod.yaml).
FROM node:22-alpine AS base
# Prisma engines on alpine (musl) need openssl at runtime and generate time.
RUN apk add --no-cache openssl
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
RUN npm ci
COPY apps/backend/tsconfig.json apps/backend/tsconfig.build.json apps/backend/
COPY apps/backend/prisma apps/backend/prisma
COPY apps/backend/src apps/backend/src
# Client types must exist before tsc sees src/.
RUN npx prisma generate --schema apps/backend/prisma/schema.prisma
RUN npm run build --workspace=@pollo/backend

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
RUN npm ci --omit=dev
COPY apps/backend/prisma apps/backend/prisma
# prisma is a production dependency precisely so this stage can generate the
# client and the container can run `migrate deploy` at startup.
RUN npx prisma generate --schema apps/backend/prisma/schema.prisma
COPY --from=build /app/apps/backend/dist apps/backend/dist
EXPOSE 3333
CMD ["node", "apps/backend/dist/server.js"]
