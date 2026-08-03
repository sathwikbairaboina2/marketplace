FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @marketplace/contracts build \
 && pnpm --filter @marketplace/auth build \
 && pnpm --filter @marketplace/openapi build \
 && pnpm --filter @marketplace/agents build
WORKDIR /repo/apps/agents
CMD ["node", "dist/main.js"]
