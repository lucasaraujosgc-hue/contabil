import express from 'express';
import path from 'path';
import fs from 'fs';
import { DATA_DIR } from '../config.js';
import { log } from '../logger.js';
import { getDb } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { waClients } from '../state/waState.js';
import { getWaClientWrapper, upsertContactCache, saveMessagesToDb, MessageMedia, safeSendMessage } from '../services/whatsappService.js';
import { ai, processAI } from '../services/aiService.js';
import { markViewing, stopViewing } from '../services/presence.js';
import { waSenderConfig } from '../services/agents.js';
const router = express.Router();

// Presença: heartbeat de "estou com essa conversa aberta". Devolve quem mais está.
router.post('/whatsapp/viewing/:chatId', (req, res) => {
    res.json({ viewers: markViewing(req.params.chatId, req.agent) });
});
router.delete('/whatsapp/viewing/:chatId', (req, res) => {
    if (req.agent) stopViewing(req.params.chatId, req.agent.id);
    res.json({ success: true });
});

router.get('/whatsapp/status', (req, res) => { 
    const wrapper = getWaClientWrapper(req.user);
    res.json({ 
        status: wrapper.status, 
        qr: wrapper.qr, 
        info: wrapper.info 
    }); 
});

router.post('/whatsapp/disconnect', async (req, res) => { 
    try { 
        const wrapper = getWaClientWrapper(req.user);
        if (wrapper.client) {
            await wrapper.client.logout(); 
            wrapper.status = 'disconnected';
            wrapper.qr = null;
        }
        res.json({ success: true }); 
    } catch (e) { res.status(500).json({ error: e.message }); } 
});

router.get('/whatsapp/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const username = req.user;
    const wrapper = getWaClientWrapper(username);
    if (!wrapper) return res.end();
    wrapper.sseClients.push(res);
    req.on('close', () => {
        wrapper.sseClients = wrapper.sseClients.filter(c => c !== res);
    });
});

router.get('/whatsapp/messages/:chatId', authenticateToken, async (req, res) => {
    try {
        const wrapper = getWaClientWrapper(req.user);
        if (!wrapper || wrapper.status !== 'connected') return res.status(400).json({error: 'Not connected'});
        
        let chat;
        try {
            chat = await wrapper.client.getChatById(req.params.chatId);
        } catch (err) {
            return res.json([]);
        }

        const limitParam = parseInt(req.query.limit) || 50;
        const messages = await chat.fetchMessages({limit: Math.min(limitParam, 300)});

        const mapped = messages.map(m => ({
            id: m.id._serialized,
            from: m.from,
            to: m.to,
            body: m.body,
            timestamp: m.timestamp,
            hasMedia: m.hasMedia,
            type: m.type,
            fromMe: m.fromMe
        }));

        const db = getDb(req.user);
        if (db) {
            const chatId = req.params.chatId;
            const FORTY_FIVE_DAYS_AGO = Math.floor(Date.now() / 1000) - (45 * 24 * 3600);
            const toSave = messages
                .filter(m => m.timestamp >= FORTY_FIVE_DAYS_AGO)
                .map(m => ({
                    id: m.id._serialized,
                    chatId,
                    sender: m.from,
                    timestamp: m.timestamp,
                    body: m.body || '',
                    fromMe: m.fromMe,
                    hasMedia: m.hasMedia,
                    type: m.type
                }));
            saveMessagesToDb(db, toSave);
            for (const m of toSave) {
                if (m.sender && !m.sender.includes('@g.us')) {
                    try {
                        const contact = await wrapper.client.getContactById(m.sender);
                        const name = contact.name || contact.pushname || contact.number || m.sender;
                        upsertContactCache(db, m.sender, name, m.sender.includes('@c.us') ? m.sender.replace('@c.us','') : null);
                        await db.prepare("UPDATE whatsapp_messages SET contactName = ? WHERE chatId = ? AND sender = ?").run(name, chatId, m.sender);
                    } catch (e) {}
                }
            }
        }

        res.json(mapped.map(m => ({
            id: { _serialized: m.id, id: m.id },
            from: m.from,
            to: m.to,
            body: m.body,
            timestamp: m.timestamp,
            hasMedia: m.hasMedia,
            type: m.type,
            fromMe: m.fromMe
        })));
    } catch(e) { res.status(500).json({error: e.message}); }
});

router.get('/whatsapp/messages-db/:chatId', authenticateToken, async (req, res) => {
    try {
        const db = getDb(req.user);
        if (!db) return res.status(500).json({ error: 'DB não encontrado' });

        const chatId = req.params.chatId;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const before = req.query.before ? parseInt(req.query.before) : null;

        let sql = `SELECT * FROM whatsapp_messages WHERE chatId = ?`;
        const params = [chatId];

        if (before) {
            sql += ` AND timestamp < ?`;
            params.push(before);
        }

        sql += ` ORDER BY timestamp DESC LIMIT ?`;
        params.push(limit);

        const rows = (await db.prepare(sql).all(...params)).reverse();

        const messages = rows.map(row => ({
            id: { _serialized: row.id, id: row.id },
            from: row.fromMe ? undefined : row.sender,
            to: row.fromMe ? row.chatId : undefined,
            body: row.body,
            timestamp: row.timestamp,
            hasMedia: !!row.hasMedia,
            type: row.type || 'chat',
            fromMe: !!row.fromMe,
            chatId: row.chatId,
            _fromDb: true
        }));

        res.json(messages);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/whatsapp/sync-status/:chatId', authenticateToken, async (req, res) => {
    try {
        const db = getDb(req.user);
        if (!db) return res.status(500).json({ error: 'DB não encontrado' });

        const chatId = req.params.chatId;
        const syncRow = await db.prepare(`SELECT lastSyncTimestamp FROM whatsapp_sync WHERE chatId = ?`).get(chatId);
        const countRow = await db.prepare(`SELECT COUNT(*) as count FROM whatsapp_messages WHERE chatId = ?`).get(chatId);

        res.json({
            synced: !!syncRow,
            lastSync: syncRow ? syncRow.lastSyncTimestamp : null,
            messageCount: countRow ? countRow.count : 0
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/whatsapp/load-history/:chatId', authenticateToken, async (req, res) => {
    try {
        const wrapper = getWaClientWrapper(req.user);
        if (!wrapper || wrapper.status !== 'connected') {
            return res.status(400).json({ error: 'WhatsApp não conectado' });
        }

        const db = getDb(req.user);
        if (!db) return res.status(500).json({ error: 'DB não encontrado' });

        const chatId = req.params.chatId;
        const forceRefresh = req.query.force === 'true' || req.body?.force === true;

        // days é configurável (padrão 45, mantendo compatibilidade com o botão rápido).
        // Não há mais um teto fixo: o usuário pode pedir 90, 365, etc.
        const requestedDays = Number(req.query.days || req.body?.days) || 45;
        const safeDays = Math.max(1, Math.min(requestedDays, 3650)); // teto de segurança de 10 anos

        const syncRow = await db.prepare(`SELECT lastSyncTimestamp FROM whatsapp_sync WHERE chatId = ?`).get(chatId);

        if (syncRow && !forceRefresh) {
            const sinceHours = (Date.now() / 1000 - syncRow.lastSyncTimestamp) / 3600;
            if (sinceHours < 1) {
                return res.json({
                    already_synced: true,
                    lastSync: syncRow.lastSyncTimestamp,
                    message: 'Histórico já carregado recentemente. Use ?force=true para forçar.'
                });
            }
        }

        log(`[History] Iniciando busca de histórico 45 dias para: ${chatId}`);

        const FORTY_FIVE_DAYS_AGO = Math.floor(Date.now() / 1000) - (45 * 24 * 3600);
        const chat = await wrapper.client.getChatById(chatId);

        let allMessages = [];
        let seenIds = new Set();
        let reachedLimit = false;

        let fetchedBatch = await chat.fetchMessages({ limit: 100 });
        let lastOldestId = null;

        while (fetchedBatch && fetchedBatch.length > 0 && !reachedLimit) {
            const currentOldest = fetchedBatch.reduce((o, m) => m.timestamp < o.timestamp ? m : o, fetchedBatch[0]);
            if (lastOldestId && currentOldest.id._serialized === lastOldestId) {
                log('[History] Loop detectado (API sem suporte a cursor before). Parando.');
                break;
            }
            lastOldestId = currentOldest.id._serialized;

            const inPeriod = fetchedBatch.filter(m => {
                if (seenIds.has(m.id._serialized)) return false;
                seenIds.add(m.id._serialized);
                return m.timestamp >= FORTY_FIVE_DAYS_AGO;
            });

            allMessages = [...allMessages, ...inPeriod];
            log(`[History] Batch: ${fetchedBatch.length} msgs | No período: ${inPeriod.length} | Acumulado: ${allMessages.length}`);

            if (fetchedBatch.some(m => m.timestamp < FORTY_FIVE_DAYS_AGO)) {
                reachedLimit = true;
                break;
            }

            if (fetchedBatch.length < 100) break;
            if (allMessages.length >= 3000) break;

            try {
                fetchedBatch = await chat.fetchMessages({
                    limit: 100,
                    before: currentOldest.id._serialized
                });
            } catch (cursorErr) {
                log('[History] Cursor before não suportado, parando paginação.', cursorErr);
                break;
            }
        }

        const toSave = allMessages.map(m => ({
            id: m.id._serialized,
            chatId,
            sender: m.from,
            timestamp: m.timestamp,
            body: m.body || '',
            fromMe: m.fromMe,
            hasMedia: m.hasMedia,
            type: m.type
        }));

        saveMessagesToDb(db, toSave);

        for (const m of toSave) {
            if (m.sender && !m.sender.includes('@g.us')) {
                try {
                    const contact = await wrapper.client.getContactById(m.sender);
                    const name = contact.name || contact.pushname || contact.number || m.sender;
                    upsertContactCache(db, m.sender, name, m.sender.includes('@c.us') ? m.sender.replace('@c.us','') : null);
                    await db.prepare("UPDATE whatsapp_messages SET contactName = ? WHERE id = ?").run(name, m.id);
                } catch (e) {}
            }
        }

        const now = Math.floor(Date.now() / 1000);
        await db.prepare(`INSERT INTO whatsapp_sync (chatId, lastSyncTimestamp) VALUES (?, ?)
                    ON CONFLICT (chatId) DO UPDATE SET lastSyncTimestamp = EXCLUDED.lastSyncTimestamp`).run(chatId, now);

        log(`[History] Concluído: ${allMessages.length} mensagens salvas para ${chatId}`);

        res.json({
            success: true,
            count: allMessages.length,
            reachedLimit,
            sinceDays: 45
        });

    } catch (e) {
        log(`[History] ERRO ao carregar histórico`, e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/whatsapp/send-chat', upload.single('media'), async (req, res) => {
    try {
        const { chatId, message } = req.body || {};
        if (!chatId) return res.status(400).json({ error: 'chatId ausente na requisição.' });
        const wrapper = getWaClientWrapper(req.user);
        if (!wrapper || !wrapper.client || wrapper.status !== 'connected') {
            return res.status(400).json({ error: 'WhatsApp não conectado.' });
        }

        // Envio manual por um colaborador logado -> prefixa com "*Nome:*" (negrito nativo do WhatsApp).
        // Só no corpo de texto/legenda; não afeta o arquivo. Não vale p/ cron nem tools de IA.
        // O nome e o liga/desliga são por colaborador (aba Usuário).
        const sender = await waSenderConfig(getDb(), req.agent);
        const original = message || '';
        const content = (sender.enabled && original.trim())
            ? `*${sender.name}:* ${original}`
            : original;
        if (req.file) {
            const fileData = fs.readFileSync(req.file.path).toString('base64');
            const media = new MessageMedia(req.file.mimetype, fileData, req.file.originalname);
            await safeSendMessage(wrapper.client, chatId, content ? media : media, content ? {caption: content} : {});
            const db = getDb(req.user);
            if(db) {
                await db.prepare('INSERT INTO file_gallery (serverFilename, originalName, mimeType, size, contact, channel, direction, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                    .run(req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, chatId, 'whatsapp', 'sent', new Date().toISOString());
            }
        } else {
            if(content) await safeSendMessage(wrapper.client, chatId, content);
        }
        res.json({success: true});
    } catch(e) {
        log(`[send-chat] falha ao enviar para ${req.body?.chatId}`, e);
        res.status(500).json({ error: e.message || 'Erro ao enviar mensagem' });
    }
});

router.get('/whatsapp/media/:msgId', authenticateToken, async (req, res) => {
    try {
        const wrapper = getWaClientWrapper(req.user);
        if (!wrapper || wrapper.status !== 'connected') return res.status(400).json({error: 'Not connected'});
        const msg = await wrapper.client.getMessageById(req.params.msgId);
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            if(media) {
                const buffer = Buffer.from(media.data, 'base64');
                res.setHeader('Content-Type', media.mimetype);
                res.send(buffer);
                return;
            }
        }
        res.status(404).json({error: 'No media'});
    } catch(e) { res.status(500).json({error: e.message}); }
});

router.post('/whatsapp/transcribe/:msgId', authenticateToken, async (req, res) => {
    try {
        if (!ai) return res.status(400).json({error: 'AI is not enabled'});
        const wrapper = getWaClientWrapper(req.user);
        if (!wrapper || wrapper.status !== 'connected') return res.status(400).json({error: 'Not connected'});
        const msg = await wrapper.client.getMessageById(req.params.msgId);
        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            if(media && media.mimetype.startsWith('audio/')) {
                 const result = await processAI(req.user, 'Por favor, transcreva este áudio ignorando ruídos e focando apenas na voz da maneira mais clara possível, com pontuação correta.', {
                    inlineData: {
                        mimeType: media.mimetype,
                        data: media.data
                    }
                 });
                 return res.json({transcription: result});
            }
        }
        res.status(404).json({error: 'No audio media found'});
    } catch(e) { res.status(500).json({error: e.message}); }
});

router.post('/whatsapp/contact', async (req, res) => {
    try {
        const { number } = req.body;
        const wrapper = getWaClientWrapper(req.user);
        if (!wrapper || wrapper.status !== 'connected') return res.status(400).json({error: 'Not connected'});
        let cleanNumber = number.replace(/\D/g, '');
        if(!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;
        const contactId = await wrapper.client.getNumberId(cleanNumber);
        if(contactId) {
            const chat = await wrapper.client.getChatById(contactId._serialized);
            return res.json({ id: chat.id._serialized, name: chat.name, isGroup: chat.isGroup });
        }
        res.status(404).json({error: 'Contact not found on WhatsApp'});
    } catch(e) { res.status(500).json({error: e.message}); }
});

router.get('/whatsapp/chat-info/:chatId', authenticateToken, async (req, res) => {
    try {
        const wrapper = getWaClientWrapper(req.user);
        if (!wrapper || wrapper.status !== 'connected') return res.status(400).json({error: 'Not connected'});
        
        const chatId = req.params.chatId;
        const profilePicUrl = await wrapper.client.getProfilePicUrl(chatId).catch(() => null);
        const contact = await wrapper.client.getContactById(chatId).catch(() => null);
        
        let lastMessage = '';
        let lastMessageFromMe = false;
        let lastMessageTimestamp = null;
        try {
            const chat = await wrapper.client.getChatById(chatId);
            const msgs = await chat.fetchMessages({limit: 1});
            if (msgs && msgs.length > 0) {
                lastMessage = msgs[0].body || (msgs[0].hasMedia ? '[Mídia]' : '');
                lastMessageFromMe = msgs[0].fromMe;
                lastMessageTimestamp = msgs[0].timestamp;
            }
        } catch(e) {
            try {
                const db = getDb(req.user);
                const lastMsg = await db.prepare("SELECT body, fromMe, hasMedia, timestamp FROM whatsapp_messages WHERE chatId = ? ORDER BY timestamp DESC LIMIT 1").get(chatId);
                if (lastMsg) {
                    lastMessage = lastMsg.body || (lastMsg.hasMedia ? '[Mídia]' : '');
                    lastMessageFromMe = !!lastMsg.fromMe;
                    lastMessageTimestamp = lastMsg.timestamp;
                }
            } catch(dbErr) {}
        }
        
        res.json({
            profilePicUrl,
            pushname: contact ? (contact.pushname || contact.name) : null,
            number: contact ? contact.number : null,
            lastMessage,
            lastMessageFromMe,
            lastMessageTimestamp
        });
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

router.get('/whatsapp/chats', authenticateToken, async (req, res) => {
    try {
        const wrapper = getWaClientWrapper(req.user);
        if (!wrapper || wrapper.status !== 'connected') return res.status(400).json({error: 'Not connected'});
        
        const db = getDb(req.user);
        let kanbanCards = [];
        try {
            const row = await db.prepare("SELECT settings FROM user_settings WHERE id = 1").get();
            if (row && row.settings) {
                const settings = JSON.parse(row.settings);
                kanbanCards = (settings.waKanban?.cards || []).map(c => c.id);
            }
        } catch(e) {}
        
        try {
            const chats = await wrapper.client.getChats();
            const now = Date.now() / 1000;
            const filteredChats = chats.filter(c => !c.isGroup).filter(c => {
                if (kanbanCards.includes(c.id._serialized)) return true;
                if (c.unreadCount > 0) return true;
                if (c.timestamp && (now - c.timestamp) < 86400 * 7) return true;
                return false;
            });

            const simplifiedChats = [];
            for (const c of filteredChats) {
                const chatId = c.id._serialized;
                let msgBody = '';
                let msgFromMe = false;
                try {
                    const lastMsg = await db.prepare("SELECT body, fromMe, hasMedia FROM whatsapp_messages WHERE chatId = ? ORDER BY timestamp DESC LIMIT 1").get(chatId);
                    if (lastMsg) {
                        msgBody = lastMsg.body || (lastMsg.hasMedia ? '[Mídia]' : '');
                        msgFromMe = !!lastMsg.fromMe;
                    }
                } catch (e) {}

                simplifiedChats.push({
                    id: chatId,
                    name: c.name || c.id.user,
                    unreadCount: c.unreadCount,
                    timestamp: c.timestamp,
                    isGroup: c.isGroup,
                    profilePicUrl: null,
                    lastMessage: msgBody,
                    lastMessageFromMe: msgFromMe
                });
            }
            
            simplifiedChats.sort((a, b) => b.timestamp - a.timestamp);

            res.json(simplifiedChats);
        } catch(e) {
            // "Evaluation failed: ..." é a assinatura clássica de o WhatsApp Web ter
            // atualizado seu front-end e o whatsapp-web.js não conseguir mais localizar
            // as funções internas do Store (getChatModel/getChats). Logamos a stack
            // completa aqui porque o front só recebe uma mensagem minificada e curta.
            log(`[WhatsApp Chats] Falha ao buscar chats via client.getChats() para ${req.user}`, e);

            // FALLBACK: monta a lista de conversas a partir do banco local, que é
            // alimentado pelos eventos 'message'/'message_create' (mecanismo diferente
            // do getChats(), não depende do Store injetado via evaluate e por isso
            // continua funcionando mesmo quando getChats() quebra).
            try {
                const now = Date.now() / 1000;
                const rows = await db.prepare(`
                    SELECT chatId,
                           MAX(timestamp) as timestamp,
                           COUNT(*) as totalMsgs
                    FROM whatsapp_messages
                    WHERE chatId NOT LIKE '%@g.us'
                    GROUP BY chatId
                `).all();

                const fallbackChats = [];
                for (const r of rows.filter(r => kanbanCards.includes(r.chatId) || (r.timestamp && (now - r.timestamp) < 86400 * 7))) {
                    const contact = await db.prepare("SELECT name FROM whatsapp_contacts WHERE contact_id = ?").get(r.chatId);
                    const lastMsg = await db.prepare("SELECT body, fromMe, hasMedia FROM whatsapp_messages WHERE chatId = ? ORDER BY timestamp DESC LIMIT 1").get(r.chatId);
                    fallbackChats.push({
                        id: r.chatId,
                        name: (contact && contact.name) || r.chatId,
                        unreadCount: 0, // não é possível saber com precisão sem o Store ao vivo
                        timestamp: r.timestamp,
                        isGroup: false,
                        profilePicUrl: null,
                        lastMessage: lastMsg ? (lastMsg.body || (lastMsg.hasMedia ? '[Mídia]' : '')) : '',
                        lastMessageFromMe: !!(lastMsg && lastMsg.fromMe)
                    });
                }
                fallbackChats.sort((a, b) => b.timestamp - a.timestamp);

                log(`[WhatsApp Chats] Fallback via banco local usado: ${fallbackChats.length} chats (client.getChats() indisponível: ${e.message}).`);
                return res.json(fallbackChats);
            } catch (dbErr) {
                log(`[WhatsApp Chats] Fallback via banco local também falhou`, dbErr);
                const isStoreMismatch = /Evaluation failed/i.test(e.message || '') || /getChatModel|WWebJS/i.test(e.stack || '');
                return res.status(500).json({
                    error: e.message,
                    hint: isStoreMismatch
                        ? 'Provável incompatibilidade entre a versão do WhatsApp Web e a lib whatsapp-web.js.'
                        : undefined
                });
            }
        }
    } catch(e) { res.status(500).json({error: e.message}); }
});

router.post('/whatsapp/reset', async (req, res) => {
    try {
        const username = req.user;
        log(`[WhatsApp Reset] Solicitado reset forçado para: ${username}`);
        
        if (waClients[username] && waClients[username].client) {
            try {
                await waClients[username].client.destroy();
                log(`[WhatsApp Reset] Cliente destruído.`);
            } catch (e) {
                log(`[WhatsApp Reset] Erro ao destruir cliente (ignorado): ${e.message}`);
            }
            delete waClients[username];
        }

        const authPath = path.join(DATA_DIR, `whatsapp_auth_${username}`);
        if (fs.existsSync(authPath)) {
            try {
                fs.rmSync(authPath, { recursive: true, force: true });
                log(`[WhatsApp Reset] Pasta de autenticação removida: ${authPath}`);
            } catch (e) {
                log(`[WhatsApp Reset] Erro ao remover pasta: ${e.message}`);
                return res.status(500).json({ error: "Falha ao limpar arquivos de sessão. Tente reiniciar o servidor." });
            }
        }

        getWaClientWrapper(username);

        res.json({ success: true, message: "Sessão resetada. Aguarde o novo QR Code." });

    } catch (e) {
        log(`[WhatsApp Reset] Erro fatal: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

export default router;
