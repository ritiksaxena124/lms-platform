# The API is a CommonJS Nest app that cannot be built from its own directory: `@lms/shared` ships
# TypeScript source that every workspace script builds first, the mail renderer compiles `.tsx`, and
# Prisma owns the schema. So the build stage is a whole-workspace Bun install, and the runtime stage
# is a Node one with production dependencies only — `bun run build` is machinery, `node dist/main.js`
# is the product.

ARG BUN_IMAGE=oven/bun:1.2.15
ARG NODE_IMAGE=node:24-slim

# --- dependencies, as the lockfile says them --------------------------------------------------

FROM ${BUN_IMAGE} AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/teacher/package.json apps/teacher/
COPY apps/student/package.json apps/student/
COPY apps/ops/package.json apps/ops/
COPY apps/site/package.json apps/site/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
# --frozen-lockfile is the whole point: an image whose dependency tree drifted from bun.lock is not
# the tree the gate tested, and it would still build happily.
RUN bun install --frozen-lockfile

FROM deps AS deps-prod
RUN bun install --frozen-lockfile --production

# --- build --------------------------------------------------------------------------------------

FROM deps AS build
COPY tsconfig.base.json eslint.config.mjs ./
COPY packages ./packages
COPY apps/api ./apps/api
# The generated client lands in node_modules/.prisma, which is a build artifact rather than a
# dependency: it is produced here and copied into the runtime tree, so `--production` never has to
# keep the Prisma CLI alive.
RUN bun run --filter @lms/shared build \
  && cd apps/api && bunx prisma generate \
  && bun run --filter @lms/api build

# --- migrations -----------------------------------------------------------------------------------

# A separate target because `migrate deploy` needs the Prisma CLI, which is a devDependency, and the
# API's runtime image deliberately does not carry devDependencies. Compose runs this to completion
# before the API starts, so the schema a container serves is the schema the tag was cut with.
FROM deps AS migrator
COPY apps/api/prisma ./apps/api/prisma
WORKDIR /app/apps/api

# --- seed -----------------------------------------------------------------------------------------

# `db:seed` is a TypeScript CLI, and the runner image carries neither Bun nor the source. Reusing the
# build stage is the whole of it: same Bun, same installed workspace, same compiled `@lms/shared`.
# Compose keeps this behind a profile so `up` does not write demo accounts into a database unasked.
FROM build AS seed
WORKDIR /app/apps/api
CMD ["bun", "src/reference/seed-cli.ts"]

# --- runtime --------------------------------------------------------------------------------------

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
# Bind on every interface: the default in `config/env.ts` is 127.0.0.1, which is correct on a laptop
# and unreachable from another container. Set here rather than baked into a code-level default so the
# host run keeps its loopback guarantee.
ENV LISTEN_HOST=0.0.0.0

COPY --from=deps-prod /app/package.json /app/bun.lock ./
COPY --from=deps-prod /app/apps/api/package.json ./apps/api/
COPY --from=deps-prod /app/packages/shared/package.json ./packages/shared/
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
# The Prisma client and its engines are build products of a stage that has the CLI. A production
# install does not run `prisma generate`, so without these two overlays the API would boot and fail
# on its first query with "gen_client index.js not found".
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

# node_modules/@lms/* are workspace links, and `deps-prod` copied them as links pointing at trees the
# runner never received. Real directories, from the stage that built them.
RUN rm -rf ./node_modules/@lms && mkdir -p ./node_modules/@lms \
  && cp -r ./packages/shared ./node_modules/@lms/shared

# Uploaded bytes are runtime state. `STORAGE_LOCAL_DIR` resolves against the workdir below, and the
# compose file mounts a volume here so a rebuilt image does not orphan the videos people attached.
RUN mkdir -p /app/apps/api/storage/uploads

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
