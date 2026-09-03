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
#
# `127.0.0.1`, not `localhost`. `localhost` resolves to ::1 before 127.0.0.1 on
# a default Windows and macOS host, and Docker Desktop's IPv6 loopback proxy
# stops answering for minutes at a time -- typically just after a container is
# recreated. curl survives that by falling back to IPv4; Chromium does not, and
# pins to the dead address. With `localhost` baked in, every call the console
# made from the browser hung while the same request from a terminal succeeded,
# which reads as an application fault and is not one. The IPv4 literal has no
# second address to get stuck on.
#
# The engine allows both loopback spellings as origins (see CORS_ORIGINS in
# docker/docker-compose.yml), so the console still works whichever one the
# reader types into the address bar.
ENV NEXT_PUBLIC_ENGINE_URL=http://127.0.0.1:33000/api/v1
ENV NEXT_PUBLIC_AGENTS_URL=http://127.0.0.1:33001
# The host shops hang off. `acme.localhost:33002` is the acme shop; Chromium
# resolves any *.localhost name to loopback, so no DNS work is needed locally.
ENV NEXT_PUBLIC_PLATFORM_HOST=localhost:33002
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @marketplace/contracts build \
 && pnpm --filter @marketplace/web build
WORKDIR /repo/apps/web
CMD ["pnpm", "start"]
