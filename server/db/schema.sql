-- Schema Postgres do Contábil Manager Pro.
-- Portado 1:1 do CREATE TABLE que rodava no better-sqlite3 (server/db/index.js antigo).
-- Idempotente: roda a cada boot via initDb(). Conta única (sem split por usuário).
--
-- IMPORTANTE sobre maiúsculas: os identificadores ficam NÃO-aspados de propósito,
-- então o Postgres os rebaixa para minúsculo (docnumber, companyid, chatid...).
-- O wrapper em index.js remapeia as chaves de volta para camelCase na leitura,
-- então o JS e o frontend continuam vendo row.companyHash, row.chatId, etc.

CREATE TABLE IF NOT EXISTS companies (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  docNumber    TEXT,
  type         TEXT,
  email        TEXT,
  whatsapp     TEXT,
  categories   TEXT,
  observation  TEXT,
  companyHash  TEXT,
  nickname     TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id                SERIAL PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT,
  status            TEXT,
  priority          TEXT,
  color             TEXT,
  dueDate           TEXT,
  companyId         INTEGER,
  recurrence        TEXT,
  dayOfWeek         TEXT,
  recurrenceDate    TEXT,
  targetCompanyType TEXT,
  createdAt         TEXT,
  googleTaskId      TEXT,
  estimatedTime     TEXT,
  parentId          INTEGER
);

CREATE TABLE IF NOT EXISTS document_status (
  id          SERIAL PRIMARY KEY,
  companyId   INTEGER,
  category    TEXT,
  competence  TEXT,
  status      TEXT,
  UNIQUE (companyId, category, competence)
);

CREATE TABLE IF NOT EXISTS sent_logs (
  id           SERIAL PRIMARY KEY,
  companyName  TEXT,
  docName      TEXT,
  category     TEXT,
  sentAt       TEXT,
  channels     TEXT,
  status       TEXT
);

CREATE TABLE IF NOT EXISTS user_settings (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  settings  TEXT
);

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id                     SERIAL PRIMARY KEY,
  title                  TEXT,
  message                TEXT,
  nextRun                TEXT,
  recurrence             TEXT,
  active                 INTEGER,
  type                   TEXT,
  channels               TEXT,
  targetType             TEXT,
  selectedCompanyIds     TEXT,
  attachmentFilename     TEXT,
  attachmentOriginalName TEXT,
  documentsPayload       TEXT,
  createdBy              TEXT
);

CREATE TABLE IF NOT EXISTS chat_history (
  id         SERIAL PRIMARY KEY,
  role       TEXT,
  content    TEXT,
  timestamp  TEXT
);

CREATE TABLE IF NOT EXISTS file_gallery (
  id             SERIAL PRIMARY KEY,
  serverFilename TEXT,
  originalName   TEXT,
  mimeType       TEXT,
  size           INTEGER,
  contact        TEXT,
  channel        TEXT,
  direction      TEXT,
  timestamp      TEXT
);

CREATE TABLE IF NOT EXISTS personal_notes (
  id          SERIAL PRIMARY KEY,
  topic       TEXT,
  content     TEXT,
  created_at  TEXT,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id             TEXT PRIMARY KEY,
  chatId         TEXT NOT NULL,
  sender         TEXT,
  timestamp      BIGINT,
  body           TEXT,
  fromMe         INTEGER,
  hasMedia       INTEGER,
  type           TEXT,
  transcription  TEXT,
  contactName    TEXT
);

CREATE TABLE IF NOT EXISTS whatsapp_sync (
  chatId             TEXT PRIMARY KEY,
  lastSyncTimestamp  BIGINT
);

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  contact_id    TEXT PRIMARY KEY,
  name          TEXT,
  phone_number  TEXT,
  last_seen     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS company_pendencies (
  id             SERIAL PRIMARY KEY,
  companyId      INTEGER,
  docNumber      TEXT,
  companyName    TEXT,
  filename       TEXT,
  extractedData  TEXT,
  created_at     TEXT
);

CREATE TABLE IF NOT EXISTS serpro_config (
  id                SERIAL PRIMARY KEY,
  usuario_id        INTEGER NOT NULL,
  consumer_key      TEXT NOT NULL DEFAULT '',
  consumer_secret   TEXT NOT NULL DEFAULT '',
  cert_path         TEXT NOT NULL DEFAULT '',
  cert_senha        TEXT NOT NULL DEFAULT '',
  cnpj_contratante  TEXT NOT NULL DEFAULT '',
  ambiente          TEXT NOT NULL DEFAULT 'trial',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sitfis_consultas (
  id            SERIAL PRIMARY KEY,
  cliente_id    INTEGER NOT NULL,
  usuario_id    INTEGER NOT NULL,
  protocolo     TEXT,
  status        TEXT NOT NULL DEFAULT 'SOLICITADO',
  pdf_path      TEXT,
  erro_msg      TEXT,
  tentativas    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  concluido_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chatId ON whatsapp_messages(chatId);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_timestamp ON whatsapp_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_name ON whatsapp_contacts(name);
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_phone ON whatsapp_contacts(phone_number);

-- ── Colaboradores / autenticação (Tarefa 2) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  username           TEXT UNIQUE,                     -- nulo enquanto o convite não foi ativado
  password_hash      TEXT,                            -- bcrypt; nulo enquanto não ativado
  email              TEXT,
  department         TEXT,
  role               TEXT NOT NULL DEFAULT 'colaborador',   -- 'admin' | 'colaborador'
  permissions        TEXT,                            -- JSON { aba: { view, edit, create } }
  status             TEXT NOT NULL DEFAULT 'invited',  -- 'invited' | 'active' | 'revoked' | 'reset_pending'
  token_version      INTEGER NOT NULL DEFAULT 0,       -- bump invalida todo JWT já emitido p/ esse agente
  invite_token_hash  TEXT,                            -- sha256 do token de convite (uso único)
  invite_expires_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agents_username ON agents(username);

-- Alias de e-mail por colaborador: o SMTP autentica sempre com EMAIL_USER, mas o
-- cabeçalho "From" pode sair como um alias configurado nesse mailbox.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS email_alias     TEXT;   -- endereço do "From" (ex: joao@escritorio.com.br)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS email_from_name TEXT;   -- nome de exibição do "From"

-- Configurações por colaborador (só as assinaturas). O resto de user_settings é global.
CREATE TABLE IF NOT EXISTS agent_settings (
  agent_id  INTEGER PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  settings  TEXT
);

-- ── Conversas do WhatsApp (multi-atendimento) ────────────────────────────────
-- Metadados de atendimento de cada conversa. Antes viviam num JSON blob em
-- user_settings.waKanban.cards — o que perdia alterações com vários atendentes.
CREATE TABLE IF NOT EXISTS wa_conversations (
  chat_id            TEXT PRIMARY KEY,
  name               TEXT,
  col_id             TEXT,
  department         TEXT,
  assigned_agent_id  INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'open',   -- open | pending | resolved
  tag_ids            TEXT NOT NULL DEFAULT '[]',     -- JSON array
  note               TEXT,
  last_inbound_at    BIGINT,                          -- unix ts da última msg do cliente
  last_outbound_at   BIGINT,                          -- unix ts da última msg nossa
  last_activity_at   BIGINT,
  claimed_at         TIMESTAMPTZ,
  resolved_at        TIMESTAMPTZ,
  resolved_by        INTEGER,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_conv_assigned ON wa_conversations(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_wa_conv_status   ON wa_conversations(status);

-- Histórico de atendimento de cada conversa: quem mexeu, no quê e quando.
-- Só eventos de fluxo (setor, responsável, status, transferência, reabertura
-- automática) — não guarda mensagens. Alimenta o modal "Observações + histórico".
CREATE TABLE IF NOT EXISTS wa_conversation_events (
  id          SERIAL PRIMARY KEY,
  chat_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,          -- assigned | unassigned | department | status | transfer | reopen_auto
  detail      TEXT,                   -- rótulo já resolvido (nome do setor, do responsável, status…)
  agent_id    INTEGER,                -- quem fez a ação (null = sistema)
  agent_name  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_conv_events_chat ON wa_conversation_events(chat_id, created_at);
