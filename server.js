import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';

import { ROOT_DIR, DATA_DIR, PORT } from './server/config.js';
import { log } from './server/logger.js';
import { initDb, getDb } from './server/db/index.js';
import { assertAuthConfigured } from './server/middleware/auth.js';
import { seedAdminIfEmpty } from './server/services/agents.js';
import { migrateConversations } from './server/services/conversations.js';
import { setupRoutes } from './server/routes/index.js';
import { startCron } from './server/services/cronService.js';
import { recoverAllWaClients } from './server/services/whatsappService.js';

log("Servidor iniciando...");
log(`Diretório de dados: ${DATA_DIR}`);

assertAuthConfigured();
await initDb();
await seedAdminIfEmpty(getDb());
await migrateConversations(getDb());

const app = express();
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));

// --- CONFIGURAÇÃO DO EXPRESS ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Servir arquivos estáticos do frontend (pasta dist criada pelo Vite)
app.use(express.static(path.join(ROOT_DIR, 'dist')));

// --- ROUTES ---
// setupRoutes registra, na ordem original:
//   /api/ai/chat -> /api/login -> /api/pendencies (auth) -> gate global -> demais rotas
setupRoutes(app);

// --- Rota Catch-All para servir o React corretamente ---
app.get(/.*/, (req, res) => {
    if (!req.path.startsWith('/api')) res.sendFile(path.join(ROOT_DIR, 'dist', 'index.html'));
});

// --- CRON JOB ---
startCron();

// Rejeições não tratadas vindas do whatsapp-web.js / Puppeteer (ex.: timeout ao
// reinjetar depois que a página do WhatsApp recarrega) derrubavam o processo
// inteiro — API, cron e envios em andamento junto. Loga, mantém o servidor de pé
// e manda o cliente de WhatsApp se recuperar sozinho.
process.on('unhandledRejection', (reason) => {
    const text = String(reason?.stack || reason || '');
    log('[FATAL evitado] unhandledRejection', reason);
    if (/whatsapp-web\.js|puppeteer|auth timeout/i.test(text)) {
        recoverAllWaClients(`unhandledRejection: ${text.split('\n')[0].slice(0, 120)}`);
    }
});

app.listen(PORT, () => log(`Server running at http://localhost:${PORT}`));
