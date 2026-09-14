# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Chromium est installé par Playwright lui-même : la version du navigateur
# suit toujours celle de la bibliothèque, sans image de base à resynchroniser.
RUN npx playwright install --with-deps chromium && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist

CMD ["node", "dist/index.js"]
