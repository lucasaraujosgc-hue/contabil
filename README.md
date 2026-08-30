# Contábil Manager Pro

Sistema de gestão contábil: React/TS no frontend, Express + Postgres no backend,
integração com WhatsApp (`whatsapp-web.js`), IA (Google Gemini), Google
Agenda/Tasks e SERPRO Integra Contador.

## Stack

| Camada   | Escolha                                                             |
|----------|--------------------------------------------------------------------|
| Frontend | React 18 SPA (Vite), Tailwind, Recharts, lucide-react             |
| Backend  | Express 5, processo único, `server.js` na raiz → `server/**`      |
| DB       | **Postgres** via `pg` (wrapper compatível com a API antiga do SQLite) |
| WhatsApp | `whatsapp-web.js` (Puppeteer/Chromium) — 1 sessão por conta       |
| IA       | `@google/genai` (Gemini) — assistente + análise de PDF SERPRO     |
| Deploy   | Docker (`Dockerfile`) → Cloud Run / EasyPanel                     |

## Estrutura do backend

```
server.js                  bootstrap: initDb() -> express -> setupRoutes -> cron -> listen
server/
  config.js                DATA_DIR, UPLOADS_DIR, PORT, ROOT_DIR
  logger.js                log()
  db/
    index.js               pool pg + wrapper .prepare().get/all/run() (async) + initDb()
    schema.sql             DDL Postgres (idempotente, roda no boot)
  middleware/              auth.js, upload.js
  routes/                  index.js (setupRoutes) + auth, ai, companies, tasks,
                           documents, settings, scheduledMessages, whatsapp
  services/               emailService, googleService, whatsappService, aiService, cronService
api/pendencies.js          rotas SERPRO / SITFIS (router separado)
```

## Rodando localmente

1. `npm install`
2. Suba um Postgres (local, Docker, Neon, Supabase...) e configure o `.env`:
   ```
   DATABASE_URL=postgres://user:pass@host:5432/dbname
   PGSSL=require          # se o provedor exigir SSL (Neon/Supabase)
   USERS=lucas
   PASSWORDS=suasenha
   ```
   (demais variáveis: e-mail SMTP/IMAP, GEMINI_API_KEY, GOOGLE_* — ver `.env.example`)
3. `npm start` — `initDb()` cria o schema no primeiro boot.
4. Frontend em dev: `npm run dev` (Vite). Em produção o Express serve `dist/`.

## Deploy (Docker)

```
docker build -t contabil-manager .
docker run -p 3000:3000 --env-file .env contabil-manager
```

O container traz o Chromium do sistema para o `whatsapp-web.js`. `DATA_PATH=/app/data`
guarda uploads e a sessão do WhatsApp (monte um volume para persistir).
