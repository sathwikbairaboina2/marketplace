FROM node:22-alpine
WORKDIR /seed
COPY docker/seed/package.json ./
RUN npm install --omit=dev --no-package-lock
COPY docker/seed/*.ts ./
# The catalogue fixture and its product photographs. Without this the seed
# type-checks, builds, and then fails at runtime looking for fixtures/.
COPY docker/seed/fixtures ./fixtures
CMD ["npx", "tsx", "seed.ts"]
