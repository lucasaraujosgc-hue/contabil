# CLAUDE.md

Mapa do sistema. Leia isto primeiro; o `README.md` tem a visão de produto.

## O que é

**Contábil Manager Pro** — portal interno de um escritório de contabilidade.
Um público só (a equipe do escritório): um **admin** (definido no `.env`) +
**colaboradores** com permissões por aba. Faz kanban de atendimento no WhatsApp,
gestão de empresas/tarefas/documentos, envio de guias por e-mail/WhatsApp,
assistente de IA (Gemini) e consulta de situação fiscal (SERPRO/SITFIS).

Histórico: era um `server.js` monolítico com SQLite. Foi (1) modularizado,
(2) migrado para Postgres, (3) ganhou auth JWT + colaboradores, (4) ganhou o
kanban multiatendimento. Tudo já está em `main`.

## Stack

| Camada | Escolha |
|--------|---------|
| Frontend | React 18 SPA, Vite. **Sem router** — `App.tsx` troca `activePage` por estado; única exceção é a página pública `/definir-acesso` (checa `window.location.pathname`). Tailwind e React vêm de CDN/importmap no `index.html` (o `vite build` empacota tudo do `node_modules` mesmo assim). |
| Backend | Express 5, processo único, `server.js` na raiz → `server/**`. ESM puro (`"type":"module"`), sem TypeScript no back. |
| DB | **Postgres** via `pg`. `server/db/index.js` expõe um wrapper que imita a API do better-sqlite3 (`db.prepare(sql).get/all/run(...)`) — **mas assíncrono**. |
| Auth | JWT assinado 12h + `token_version` conferido no banco a cada request. Header `Authorization: Bearer`; `?token=` só sobrevive para o SSE de `/api/whatsapp/events`. |
| WhatsApp | `whatsapp-web.js` (Puppeteer). **1 sessão por conta**, keyed por `tenant()` (= `USERS[0]`). |
| Deploy | Docker → EasyPanel. `dist/` servido pelo Express; `DATA_PATH=/app/data` (volume). |

## Fluxo de boot (`server.js`)

```
assertAuthConfigured()   -> exige JWT_SECRET em produção
await initDb()            -> roda server/db/schema.sql (idempotente)
await seedAdminIfEmpty()  -> cria o admin de USERS[0]/PASSWORDS[0] se a tabela agents está vazia
express() + trust proxy
setupRoutes(app)          -> ordem importa (abaixo)
app.get(/.*/, ...)        -> SPA fallback (só p/ paths que não começam com /api)
startCron()               -> setInterval 60s (mensagens agendadas)
app.listen(PORT)
```

**Ordem das rotas** (`server/routes/index.js`), não mude:
`/api/ai/chat` (auth própria) → `/api/login` etc. (público) → `/api/pendencies`
(auth) → **`app.use('/api', authenticateToken)` (gate global)** → agents, documents,
settings, companies, tasks, scheduled, whatsapp.

## O wrapper de banco — LEIA ANTES DE MEXER EM QUALQUER QUERY

`server/db/index.js`:

1. **Tudo é `async`.** `db.prepare(sql).get(x)` retorna Promise. **Todo call site
   usa `await`.** Se você adicionar uma query, lembre do `await` e de a função
   conter estar `async`. `node --check` pega `await` fora de `async`.
2. **Nada de `.map()/.forEach()` com query síncrona dentro** — use `for...of` com
   `await`. (O codemod da migração já converteu ~120 pontos; siga o padrão.)
3. **camelCase**: o Postgres rebaixa identificadores não-aspados para minúsculo.
   O wrapper **remapeia as chaves de volta** na leitura usando a lista `CAMEL` no
   topo do arquivo. **Se você criar uma coluna ou um alias camelCase (`... AS foo`),
   adicione o nome nessa lista** ou `row.foo` virá `undefined`.
4. **Dialeto**: o `adapt()` cuida de `?`→`$n`, `ON CONFLICT(` → `ON CONFLICT (`,
   `datetime('now')` → `now()`. `INSERT OR IGNORE/REPLACE` **não** é tratado —
   escreva `ON CONFLICT ... DO NOTHING/UPDATE` na mão.
5. `.run()` de `INSERT` sem `RETURNING`/`ON CONFLICT` ganha `RETURNING id`
   automático → `result.lastInsertRowid` funciona.
6. `getDb(x)` ignora o argumento (multi-tenancy por arquivo foi removida — conta
   única). Testes injetam um mock com `setPool()`.

Schema: só via `server/db/schema.sql` (idempotente, roda no boot). Sem ferramenta
de migration — `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

## Auth e permissões

- `req.agent` (DTO, vem de `sanitizeAgent`) + `req.user` (= `tenant()`, p/ a sessão
  de WhatsApp e compat com `getDb(req.user)`). `req.agentRaw` = row cru.
- `requirePermission(aba, ação)` por rota. `requireAdmin` = `role === 'admin'`.
  **`isEnvAdmin`** (`username === USERS[0]`) é mais restrito que `role: admin` e
  é o que libera as configs globais e o Integra Contador.
- Revogar / resetar senha bumpa `token_version` → JWT antigos morrem no próximo
  request. `authenticateToken` compara `payload.tv` com o banco toda vez.
- Segredos (`password_hash`, `invite_token_hash`, `cert_senha` do SERPRO,
  `consumer_secret`) **nunca** saem do servidor — use os DTOs.

## Settings: global vs. por-colaborador

- `user_settings` (id=1) = configs **globais**, só o `isEnvAdmin` grava.
- `agent_settings` (por `agent_id`) = **só as 3 assinaturas** (`emailSignature`,
  `whatsappTemplate`, `whatsappFileSignature`).
- `GET /api/settings` devolve o global **mergeado** com a assinatura do agente
  (admin vê a global até personalizar; colaborador começa em branco).
- `POST /api/settings` **separa** o payload: assinatura → `agent_settings` do
  agente; resto → `user_settings` só se `isEnvAdmin`. **Não** grave o body inteiro
  em `user_settings` sem esse filtro (colaborador sobrescreveria o global).
- Frontend: `Settings.tsx` esconde as abas não-assinatura quando `!isEnvAdmin`.
- O **cron** lê `user_settings.emailSignature` como assinatura padrão dos envios
  agendados.

## Kanban / atendimento (WhatsApp) — `components/Dashboard.tsx` (arquivo grande, ~2000 linhas)

- **Layout do board** (`userSettings.waKanban` = colunas, tags, setores,
  `urgencyYellowMin`/`urgencyRedMin`): só o **admin do .env** edita, via
  `PUT /api/kanban` (modal "Configurar Kanban", engrenagem só p/ ele).
  `waKanban.cards` é **legado** — não é mais lido.
- **Conversas** vivem na tabela **`wa_conversations`** (`server/services/conversations.js`).
  DTO camelCase; tabela snake. Uma coluna fixa **"Não atribuídas"** no board.
- Rotas `server/routes/inbox.js`: `GET /api/inbox?filter=mine|unassigned|waiting|open|resolved`,
  `PATCH /api/inbox/:chatId` (campos individuais, **não** clobber),
  `POST .../claim` (409 `{conflict,current}` se tomada; `{force}`),
  `.../resolve` · `.../reopen` · `.../transfer`. Toda mutação broadcasta SSE
  **`conversation_update`** → o board de todos os atendentes atualiza ao vivo.
- **"Aguardando resposta"** = `last_inbound_at > last_outbound_at`; cor pelos
  limiares. `touchConversation` (nos handlers `message`/`message_create` de
  `whatsappService`) atualiza os timestamps e **reabre** conversa `resolved` se o
  cliente escreve.
- Migração `migrateConversations(db)` no boot: backfill do `waKanban.cards` antigo.
- Frontend: fonte da verdade = `GET /api/inbox` mesclado com `waChats` (unread)
  + SSE. Helpers puros em `components/dashboard/conversations.ts`.
- Presença: `POST/DELETE /api/whatsapp/viewing/:chatId` (memória, `presence.js`,
  TTL 60s). Heartbeat 25s com a conversa aberta; avatares no card vêm do
  `viewers` da resposta do `/api/inbox`.
- **Prefixo `*Nome:*`**: `POST /api/whatsapp/send-chat` prefixa texto/legenda com
  `*${req.agent.name}:* `. **Só ali** — cron e tools de IA mandam via
  `safeSendMessage` direto e não levam prefixo.

## Não quebrar

- **Ordem das rotas** e o gate global (acima).
- `api/pendencies.js` (SERPRO/SITFIS): não reescrever a lógica; só ajustes de
  import e o gate `isEnvAdmin` no `POST /sitfis/config`. É montado **antes** do
  gate global, com `authenticateToken` próprio.
- `whatsapp-web.js`: os handlers tratam `id._serialized` (chat/msg) — não simplifique.
  `getChats()` tem fallback via banco quando o Store injetado quebra.
- Login do WhatsApp / QR / sessão em `DATA_DIR/whatsapp_auth_<tenant>` — persistir volume.
- O SSE `/api/whatsapp/events` depende do `?token=` (EventSource não manda header).
- Mover card / atribuir setor-responsável / resolver → `PATCH /api/inbox/:chatId`
  (tabela `wa_conversations`, atômico, exige `kanban.edit`). **Nunca** grave isso
  no `waKanban` (blob) — perde alteração entre atendentes.
- `PUT /api/kanban` só configura o layout (colunas/tags/setores/limiares) e é do
  **admin do .env**.

## Comandos

```bash
npm install            # sem build nativo (pg é JS puro)
npm start              # prod: initDb + serve dist/ + API
npm run dev            # Vite :5173, proxy /api -> :3000  (rode `npm start` junto p/ ter API)
npm run build          # vite build -> dist/
npx tsc --noEmit       # checagem de tipos do front (3 erros PRÉ-EXISTENTES em Dashboard.tsx)
```

Sem suíte de testes. Verificação durante o desenvolvimento: `pg-mem` (Postgres em
memória) via `setPool()` + preview do navegador. **Nunca foi testado contra um
Postgres real + WhatsApp real de ponta a ponta** — isso é teste manual do usuário.

## Env (ver `.env.example`)

`DATABASE_URL` (+ `PGSSL=require` p/ Neon/Supabase), `USERS`/`PASSWORDS` (só 1º boot),
`JWT_SECRET` (obrigatório em prod), `APP_BASE_URL` (opcional — derivado do proxy),
`EMAIL_*`/`IMAP_*`, `GEMINI_API_KEY`, `GOOGLE_*`, `PUPPETEER_EXECUTABLE_PATH`,
`TRUST_PROXY` (default 1).

## Git

`main` no GitHub via **SSH** (`git@github.com:lucasaraujosgc-hue/contabil.git`) —
o credential manager por HTTPS desta máquina é de outra conta. `git push origin main`.
