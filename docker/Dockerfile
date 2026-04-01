# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ─── Stage 2: Build TypeScript ───────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# ─── Stage 3: Production image ──────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Security: run as non-root
RUN addgroup -g 1001 dbot && \
    adduser -u 1001 -G dbot -s /bin/sh -D dbot

# Copy production dependencies from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy compiled JS from stage 2
COPY --from=build /app/dist ./dist

# Copy config files and package.json
COPY package.json ./
COPY config/ ./config/

# Create data directory for WhatsApp auth persistence
RUN mkdir -p data/whatsapp-auth && chown -R dbot:dbot /app

USER dbot

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/main.js"]
