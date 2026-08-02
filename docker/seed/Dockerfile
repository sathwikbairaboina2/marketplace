FROM node:22-alpine
WORKDIR /seed
COPY docker/seed/package.json ./
RUN npm install --omit=dev --no-package-lock
COPY docker/seed/*.ts ./
CMD ["npx", "tsx", "seed.ts"]
