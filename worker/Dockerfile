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

# Aucun navigateur n'est installé ici : le collecteur pilote le Chrome de la
# machine hôte, dont l'empreinte est celle d'un vrai poste. Un Chromium lancé
# depuis un container se fait reconnaître comme robot dès la première page.

COPY --from=builder /app/dist ./dist

CMD ["node", "dist/index.js"]
