# The public face is not a server. `apps/site` builds with `output: 'export'`, which is the
# machine-checkable form of the roadmap's promise that this workspace is "not a second backend" — so
# the image is a build stage and a static file host, and the only request-time logic anywhere is nginx
# resolving `/docs` to the `/docs.html` the export emitted.

ARG BUN_IMAGE=oven/bun:1.2.15
ARG NODE_IMAGE=node:24-slim

FROM ${BUN_IMAGE} AS workspace
WORKDIR /app

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
COPY apps/site ./apps/site
# The docs' phase table is read out of README.md at build time — the site renders that table instead
# of keeping a copy of it — so the file at the repository root is part of what an image needs.
COPY README.md ./
RUN bun run --filter @lms/shared build

# The export runs under Node for the reason `docker/portal.Dockerfile` documents: Bun cannot build a
# Next 16 app on Linux, and the host only gets away with it because its `.bin` shim hands the script to
# Node. `output: 'export'` still means no server survives this stage — the product is `out/`.
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ARG NEXT_PUBLIC_TEACHER_PORTAL_URL=http://teacher.localtest.me
ARG NEXT_PUBLIC_STUDENT_PORTAL_URL=http://student.localtest.me
# Inlined at build time, like every `NEXT_PUBLIC_*`: a site image built without a portal's URL refuses
# to build (`readPortalUrls()` throws rather than defaulting), which is the behaviour wanted — a public
# page full of dead links is worse than a failed build.
ENV NEXT_PUBLIC_TEACHER_PORTAL_URL=${NEXT_PUBLIC_TEACHER_PORTAL_URL}
ENV NEXT_PUBLIC_STUDENT_PORTAL_URL=${NEXT_PUBLIC_STUDENT_PORTAL_URL}

COPY --from=workspace /app /app
RUN cd apps/site && node /app/node_modules/next/dist/bin/next build

FROM nginx:1.27-alpine AS runner
# `try_files $uri $uri.html $uri/ =404` is what makes the export's clean URLs work; the comment in
# apps/site/next.config.ts names it as the host's half of that deal.
COPY docker/site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/site/out /usr/share/nginx/html
EXPOSE 80
