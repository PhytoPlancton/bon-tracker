# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# L'application ne tourne pas en root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Outils de mise en service (génération des secrets, hash du mot de passe),
# exécutables sans installer Node sur la machine hôte :
#   docker compose run --rm web node scripts/hash-password.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
# Next inline bcryptjs dans ses bundles : le script de mise en service, lui,
# a besoin du module sur disque.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/bcryptjs ./node_modules/bcryptjs

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
