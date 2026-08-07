FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY . .
# NEXT_PUBLIC_* are inlined into the client bundle by `next build`. Setting them
# in docker-compose.yml would have no effect on what the browser actually runs,
# so they are baked here instead. They point at host-facing ports because the
# code that reads them executes in the browser, not in this container -- see
# apps/web/lib/env.ts. Anything that varies per run must come from a route
# handler, which reads its environment at request time.
ENV NEXT_PUBLIC_ENGINE_URL=http://localhost:3000/api/v1
ENV NEXT_PUBLIC_AGENTS_URL=http://localhost:3001
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @marketplace/contracts build \
 && pnpm --filter @marketplace/web build
WORKDIR /repo/apps/web
CMD ["pnpm", "start"]
