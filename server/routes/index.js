import { authenticateToken } from '../middleware/auth.js';
import pendenciesRouter from '../../api/pendencies.js';
import aiRouter from './ai.js';
import authRouter from './auth.js';
import settingsRouter from './settings.js';
import companiesRouter from './companies.js';
import tasksRouter from './tasks.js';
import scheduledRouter from './scheduledMessages.js';
import documentsRouter from './documents.js';
import whatsappRouter from './whatsapp.js';

// Registra as rotas na MESMA ordem do server.js original:
//   /api/ai/chat  ->  /api/login  ->  /api/pendencies (auth)  ->  gate global  ->  demais
export function setupRoutes(app) {
    app.use('/api', aiRouter);            // /api/ai/chat (authenticateToken próprio)
    app.use('/api', authRouter);          // /api/login (público)
    app.use('/api/pendencies', authenticateToken, pendenciesRouter);
    app.use('/api', authenticateToken);   // gate global — tudo abaixo exige token

    app.use('/api', documentsRouter);     // /upload, /notify-webhook, /documents/status, /send-documents, /recent-sends, /file-gallery/*
    app.use('/api', settingsRouter);      // /settings, /trigger-daily-summary
    app.use('/api', companiesRouter);
    app.use('/api', tasksRouter);
    app.use('/api', scheduledRouter);
    app.use('/api', whatsappRouter);
}
