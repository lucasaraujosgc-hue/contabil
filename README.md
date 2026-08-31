# Contábil Manager Pro

Sistema de gestão de um escritório de contabilidade: portal único com **kanban de
atendimento no WhatsApp**, gestão de empresas/tarefas/documentos, envio de guias
por e-mail e WhatsApp, assistente de IA e integração com a Receita (SERPRO).
Multiusuário — um admin + colaboradores com permissões por aba.

## Stack

| Camada   | Escolha                                                                     |
|----------|----------------------------------------------------------------------------|
| Frontend | React 18 SPA (Vite), Tailwind (CDN), Recharts, lucide-react. Sem router — troca de `activePage` por estado + página pública `/definir-acesso` |
| Backend  | Express 5, processo único, `server.js` na raiz → `server/**`               |
| DB       | **Postgres** via `pg`, com um wrapper que imita a API do better-sqlite3    |
| Auth     | JWT assinado (12h) + `token_version` no banco (revogar/resetar derruba a sessão na hora). Convite de colaborador por e-mail. |
| WhatsApp | `whatsapp-web.js` (Puppeteer/Chromium) — **1 sessão por conta**, compartilhada por todos os colaboradores |
| IA       | `@google/genai` (Gemini) — assistente interno + análise de PDF SERPRO      |
| E-mail   | Nodemailer (SMTP) + ImapFlow (cópia na pasta "Enviados")                    |
| Externo  | Google Tasks/Calendar; SERPRO Integra Contador (SITFIS)                     |
| Deploy   | Docker (`Dockerfile`) → EasyPanel / Cloud Run                               |

## Estrutura do backend

```
server.js                    bootstrap: assertAuthConfigured -> initDb -> seedAdminIfEmpty
                             -> express -> setupRoutes -> catch-all SPA -> startCron -> listen
server/
  config.js                  ROOT_DIR, DATA_DIR, PORT, tenant(), appBaseUrl(req), JWT_SECRET
  logger.js                  log()
  db/
    index.js                 pool pg (lazy, setPool p/ testes) + wrapper .prepare().get/all/run()
                             (ASSÍNCRONO — todo call site usa await) + remap camelCase + initDb()
    schema.sql               DDL Postgres, idempotente, roda no boot
  middleware/
    auth.js                  authenticateToken (jwt.verify + token_version), requireAdmin,
                             requirePermission(aba, ação), signToken, assertAuthConfigured
    upload.js                multer
  state/waState.js           waClients{} + broadcastWaEvent()  (estado mutável compartilhado)
  routes/
    index.js                 setupRoutes(app) — ordem: ai/chat, login (público),
                             pendencies (auth), GATE GLOBAL, demais
    auth.js                  /login, /auth/invite, /auth/activate, /auth/me, /auth/agents
    agents.js                /api/agents/* — gestão de colaboradores (admin)
    companies · tasks · documents · settings · scheduledMessages · whatsapp
  services/
    agents.js                bcrypt, convite (token sha256, uso único, 48h), permissões,
                             isEnvAdmin, seedAdminIfEmpty, agent_settings (assinaturas)
    emailService.js          transporter, IMAP sent, buildEmailHtml, sendInviteEmail
    googleService.js         Google Tasks / Calendar
    whatsappService.js       Client/MessageMedia, safeSendMessage, getWaClientWrapper,
                             save*ToDb, upsertContactCache, sendDailySummaryToUser
    aiService.js             ai (Gemini), assistantTools, executeTool, processAI
    cronService.js           startCron() — tick a cada 60s (mensagens agendadas)
    presence.js              "quem está com a conversa aberta" (em memória, TTL 60s)
api/pendencies.js            rotas SERPRO / SITFIS (router separado, montado antes do gate)
```

## Multiusuário e permissões

- **1º boot**: cria o agente `admin` a partir de `USERS[0]` / `PASSWORDS[0]` do `.env`.
- Admin cadastra colaboradores em **Configurações → Usuários** (nome, e-mail, setor,
  permissões). O colaborador recebe e-mail → `/definir-acesso?token=` → escolhe o
  próprio usuário e senha. O admin **nunca** vê/digita a senha de ninguém.
- **Permissões por aba** (`companies`, `documents`, `tasks`, `kanban`, `financeiro`,
  `settings`) com granularidade `view / edit / create`, guardadas em JSON no agente.
  Aplicadas **no backend** por rota (`requirePermission`) — não só escondendo botão.
- **Revogar / Resetar senha** incrementa `token_version` → todo JWT já emitido para
  aquele colaborador para de valer no próximo request.
- **"Admin do `.env`"** (`username === USERS[0]`, flag `isEnvAdmin`) é o único que
  edita as configs **globais**: Criar Categorias, Colunas da Matriz, Vinculações,
  Vencimentos, Tags de Empresas, Resumo Diário, Portal do Cliente, Integra Contador,
  e o layout do Kanban. Cada colaborador só edita as **próprias assinaturas**
  (e-mail + WhatsApp), guardadas em `agent_settings`.

## Kanban de atendimento (WhatsApp)

- Board compartilhado (colunas / tags / setores em `user_settings.waKanban`, editável
  pelo admin no botão de engrenagem do Dashboard).
- Cada conversa (card) pode ter **setor** e **colaborador responsável**; badges no card
  e no topo da conversa; filtro "Ver: Todos / Meu setor / Atribuídos a mim".
- **Presença**: enquanto a conversa está aberta, o front bate heartbeat
  (`POST /api/whatsapp/viewing/:chatId`, TTL 60s) e mostra "Fulano está vendo esta
  conversa agora" quando há outro colaborador olhando.
- **Envio manual** de mensagem por um colaborador logado é prefixado com
  `*Nome do Colaborador:*` (negrito nativo). Não vale para cron nem tools de IA.

## Rodando localmente

1. `npm install`
2. Suba um Postgres (local, Docker, Neon, Supabase…) e crie o `.env` a partir do
   `.env.example`. Mínimo:
   ```
   DATABASE_URL=postgres://user:pass@host:5432/dbname
   PGSSL=require                 # Neon / Supabase / Render exigem SSL
   USERS=lucas
   PASSWORDS=suasenha            # só usado no 1º boot p/ criar o admin
   JWT_SECRET=<aleatório>        # node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   APP_BASE_URL=https://seu-dominio   # opcional (derivado do proxy se vazio) — link dos convites
   ```
   (e-mail SMTP/IMAP, `GEMINI_API_KEY`, `GOOGLE_*` — ver `.env.example`)
3. `npm start` — `initDb()` cria/atualiza o schema; o admin é criado no 1º boot.
4. Dev do frontend: `npm run dev` (Vite :5173, com proxy `/api` → :3000). Em
   produção o Express serve o `dist/` + faz o SPA fallback.

## Testes

Não há suíte automatizada. As verificações durante o desenvolvimento usaram
[`pg-mem`](https://github.com/oguimbal/pg-mem) (Postgres em memória) injetado via
`setPool()` + o preview do navegador. Um Postgres real + WhatsApp real ainda
precisam de teste manual de ponta a ponta.

## Deploy (Docker / EasyPanel)

```
docker build -t contabil-manager .
docker run -p 3000:3000 --env-file .env -v cm_data:/app/data contabil-manager
```

- O container traz o Chromium do sistema (`PUPPETEER_EXECUTABLE_PATH`).
- `DATA_PATH=/app/data` guarda uploads e a sessão do WhatsApp — **monte um volume**.
- Não há mais módulo nativo (o `pg` é JS puro) — o build não precisa de `python3/make/g++`.
- Atrás de proxy: `TRUST_PROXY=1` (padrão). O link do convite usa
  `X-Forwarded-Proto/Host` quando `APP_BASE_URL` está vazio.
