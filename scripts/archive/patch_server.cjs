const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

const target1 = `        const chatId = req.params.chatId;
        const forceRefresh = req.query.force === 'true';

        const syncRow = db.prepare(\`SELECT lastSyncTimestamp FROM whatsapp_sync WHERE chatId = ?\`).get(chatId);`;

const rep1 = `        const chatId = req.params.chatId;
        const forceRefresh = req.query.force === 'true' || req.body?.force === true;

        // days é configurável (padrão 45, mantendo compatibilidade com o botão rápido).
        // Não há mais um teto fixo: o usuário pode pedir 90, 365, etc.
        const requestedDays = Number(req.query.days || req.body?.days) || 45;
        const safeDays = Math.max(1, Math.min(requestedDays, 3650)); // teto de segurança de 10 anos

        const syncRow = db.prepare(\`SELECT lastSyncTimestamp FROM whatsapp_sync WHERE chatId = ?\`).get(chatId);`;

code = code.replace(target1, rep1);


const target2 = `        log(\`[History] Iniciando busca de histórico 45 dias para: \${chatId}\`);

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
            log(\`[History] Batch: \${fetchedBatch.length} msgs | No período: \${inPeriod.length} | Acumulado: \${allMessages.length}\`);

            if (fetchedBatch.some(m => m.timestamp < FORTY_FIVE_DAYS_AGO)) {
                reachedLimit = true;
                break;
            }

            if (fetchedBatch.length < 100) break;
            if (allMessages.length >= 3000) break;`;

const rep2 = `        log(\`[History] Iniciando busca de histórico (\${safeDays} dias) para: \${chatId}\`);

        const CUTOFF_TIMESTAMP = Math.floor(Date.now() / 1000) - (safeDays * 24 * 3600);
        const chat = await wrapper.client.getChatById(chatId);

        let allMessages = [];
        let seenIds = new Set();
        let reachedLimit = false;
        let fetchedBatch = await chat.fetchMessages({ limit: 100 });
        let lastOldestId = null;

        // Teto de segurança proporcional ao período pedido, pra não estourar memória
        // num chat muito ativo, mas sem travar buscas longas de propósito.
        const MAX_MESSAGES = Math.min(Math.max(3000, safeDays * 100), 30000);

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
                return m.timestamp >= CUTOFF_TIMESTAMP;
            });

            allMessages = [...allMessages, ...inPeriod];
            log(\`[History] Batch: \${fetchedBatch.length} msgs | No período: \${inPeriod.length} | Acumulado: \${allMessages.length}\`);

            if (fetchedBatch.some(m => m.timestamp < CUTOFF_TIMESTAMP)) {
                reachedLimit = true;
                break;
            }

            if (fetchedBatch.length < 100) break;
            if (allMessages.length >= MAX_MESSAGES) break;`;

code = code.replace(target2, rep2);


const target3 = `            success: true,
            count: allMessages.length,
            reachedLimit,
            sinceDays: 45
        });

    } catch (e) {
        log(\`[History] ERRO ao carregar para \${req.params.chatId}\`, e);
        res.status(500).json({ error: e.message });
    }
});`;

const rep3 = `            success: true,
            count: allMessages.length,
            reachedLimit,
            sinceDays: safeDays
        });

    } catch (e) {
        log(\`[History] ERRO ao carregar para \${req.params.chatId}\`, e);
        res.status(500).json({ error: e.message });
    }
});

// Busca mensagens mais antigas direto no WhatsApp (via cursor "before"), sem
// nenhum corte por dias. Usado pelo botão "Carregar mais antigas" quando o
// banco local já não tem mais nada: ao invés de pedir "mais N recentes"
// (que não avança no tempo), navega de fato para trás no histórico real do
// WhatsApp a partir da mensagem mais antiga já conhecida, encontrando o
// próximo bloco de conversa existente, não importa o quão distante no tempo.
app.post('/api/whatsapp/fetch-older/:chatId', authenticateToken, async (req, res) => {
    try {
        const wrapper = getWaClientWrapper(req.user);
        if (!wrapper || wrapper.status !== 'connected') {
            return res.status(400).json({ error: 'WhatsApp não conectado' });
        }

        const db = getDb(req.user);
        if (!db) return res.status(500).json({ error: 'DB não encontrado' });

        const chatId = req.params.chatId;
        const beforeId = req.body?.beforeId || null;

        // Quantas mensagens "novas" (ainda não vistas) tentamos juntar antes
        // de devolver pro front — evita trazer 1 mensagem por clique quando
        // há um vão grande de tempo sem conversa.
        const TARGET_NEW_MESSAGES = 50;
        // Teto de segurança pra não rodar pra sempre numa conversa gigante.
        const MAX_BATCHES = 40; // até ~4000 mensagens varridas por clique

        const chat = await wrapper.client.getChatById(chatId);

        let collected = [];
        let seenIds = new Set();
        let cursor = beforeId;
        let batches = 0;
        let exhausted = false;

        while (collected.length < TARGET_NEW_MESSAGES && batches < MAX_BATCHES) {
            let fetchedBatch;
            try {
                fetchedBatch = cursor
                    ? await chat.fetchMessages({ limit: 100, before: cursor })
                    : await chat.fetchMessages({ limit: 100 });
            } catch (cursorErr) {
                log('[fetch-older] Cursor before não suportado, parando paginação.', cursorErr);
                break;
            }
            batches++;

            if (!fetchedBatch || fetchedBatch.length === 0) {
                exhausted = true;
                break;
            }

            const currentOldest = fetchedBatch.reduce((o, m) => m.timestamp < o.timestamp ? m : o, fetchedBatch[0]);
            if (cursor && currentOldest.id._serialized === cursor) {
                log('[fetch-older] Loop detectado (API sem suporte a cursor before). Parando.');
                exhausted = true;
                break;
            }

            const newOnes = fetchedBatch.filter(m => {
                if (seenIds.has(m.id._serialized)) return false;
                seenIds.add(m.id._serialized);
                return true;
            });
            collected = [...collected, ...newOnes];
            cursor = currentOldest.id._serialized;

            if (fetchedBatch.length < 100) {
                // WhatsApp já disse que não há mais nada além deste lote
                exhausted = true;
                break;
            }
        }

        const toSave = collected.map(m => ({
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
                    upsertContactCache(db, m.sender, name, m.sender.includes('@c.us') ? m.sender.replace('@c.us', '') : null);
                    db.prepare("UPDATE whatsapp_messages SET contactName = ? WHERE id = ?").run(name, m.id);
                } catch (e) {}
            }
        }

        log(\`[fetch-older] \${chatId}: \${toSave.length} mensagens mais antigas encontradas (exhausted=\${exhausted})\`);

        res.json({
            success: true,
            count: toSave.length,
            exhausted
        });
    } catch (e) {
        log(\`[fetch-older] ERRO\`, e);
        res.status(500).json({ error: e.message });
    }
});`;

code = code.replace(target3, rep3);

fs.writeFileSync('server.js', code);
console.log('Patched server.js');
