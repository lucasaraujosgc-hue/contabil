import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';

import { ROOT_DIR, DATA_DIR, PORT } from './server/config.js';
import { log } from './server/logger.js';
import { initDb, getDb } from './server/db/index.js';
import { assertAuthConfigured } from './server/middleware/auth.js';
import { seedAdminIfEmpty } from './server/services/agents.js';
import { setupRoutes } from './server/routes/index.js';
import { startCron } from './server/services/cronService.js';

log("Servidor iniciando...");
log(`Diretório de dados: ${DATA_DIR}`);

assertAuthConfigured();
await initDb();
await seedAdminIfEmpty(getDb());

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

app.listen(PORT, () => log(`Server running at http://localhost:${PORT}`));
