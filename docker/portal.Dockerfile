# One file for the three portals. They differ by directory and by nothing else: same workspace build,
# same transpiled `@lms/ui` + `@lms/shared`, same `next start`. Which one this is arrives as an ARG, so
# a fourth portal is a line in compose rather than a fourth Dockerfile.

ARG BUN_IMAGE=oven/bun:1.2.15
ARG NODE_IMAGE=node:24-slim

FROM ${BUN_IMAGE} AS workspace
WORKDIR /app
ARG APP

COPY package.json bun.lock tsconfig.base.json eslint.config.mjs ./
COPY apps/teacher/package.json apps/teacher/
COPY apps/student/package.json apps/student/
COPY apps/ops/package.json apps/ops/
COPY apps/site/package.json apps/site/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/${APP} ./apps/${APP}
RUN bun run --filter @lms/shared build

# --- the Next build, on the engine Next supports ---------------------------------------------------

# Bun cannot build a Next 16 app on Linux: it loads the server runtime through its own CommonJS
# require and reports `Expected CommonJS module to have a function wrapper`, or opens a worker pool
# and answers `ERR_NOT_IMPLEMENTED`. On a Windows laptop the `.bin/next` shim hands the script to
# Node, so the very same command builds on the host and fails in the image. Node is what runs the
# server anyway, so the build asks it for the work too.
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ARG APP
ARG NEXT_PUBLIC_API_URL=http://api.localtest.me
# `NEXT_PUBLIC_*` is inlined into the client bundle while `next build` runs, so this value is chosen by
# whoever builds the image and cannot be corrected later with an environment variable. That is why the
# compose file passes it explicitly and `docker-check.mjs` fails when a portal starts reading a key this
# stage never declares.
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY --from=workspace /app /app
RUN cd apps/${APP} && node /app/node_modules/next/dist/bin/next build

# --- runtime --------------------------------------------------------------------------------------

# `output: 'standalone'` makes Next trace exactly the files this app imports into `.next/standalone`,
# which is what keeps this image a few hundred megabytes rather than the whole workspace. The trace
# resolves from the repository root, so the server entrypoint lands under `apps/<name>/` inside it.
FROM ${NODE_IMAGE} AS runner
ARG APP
ENV NODE_ENV=production
ENV PORT=3000
# Two different knobs with the same job: `PORT` is what `server.js` listens on, `HOSTNAME` is the
# interface it binds — a portal that answers nothing to the gateway is the worst kind of silent
# failure, and both defaults have changed across Next versions.
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/apps/${APP}/.next/standalone /app
COPY --from=build /app/apps/${APP}/.next/static /app/apps/${APP}/.next/static
COPY --from=build /app/apps/${APP}/public /app/apps/${APP}/public

# The trace keeps the monorepo's shape, so the entrypoint is not at the root of the copied tree.
WORKDIR /app/apps/${APP}
EXPOSE 3000
CMD ["node", "server.js"]
