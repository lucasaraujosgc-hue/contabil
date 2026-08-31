# ─── Estágio 1: Build ───────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# git é necessário para baixar o whatsapp-web.js (dependência via GitHub).
# (não há mais módulos nativos após a migração better-sqlite3 -> pg)
RUN apk add --no-cache git

COPY package*.json ./

# npm install já compila o better-sqlite3 nativamente aqui
RUN npm install

COPY . .

# Build do frontend (Vite)
RUN npm run build


# ─── Estágio 2: Produção ────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Chromium do sistema (para o Puppeteer/whatsapp-web.js) + dependências gráficas
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Usa o Chromium instalado pelo sistema, sem baixar um separado
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    DATA_PATH=/app/data

COPY package*.json ./

# Copia node_modules já compilados (incluindo o better-sqlite3 nativo)
# Ambos os estágios usam node:22-alpine, então os binários são compatíveis
COPY --from=builder /app/node_modules ./node_modules

COPY server.js ./
COPY server/ ./server/
COPY api/ ./api/
COPY scripts/ ./scripts/
COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data/whatsapp_auth /app/data/uploads && \
    chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "server.js"]
