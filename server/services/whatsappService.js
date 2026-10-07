import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DATA_DIR, UPLOADS_DIR } from '../config.js';
import { log } from '../logger.js';
import { getDb } from '../db/index.js';
import { waClients, broadcastWaEvent } from '../state/waState.js';
import { touchConversation } from './conversations.js';
import { installWaLogTap, parseWaTapLine } from './waLogTap.js';

export { MessageMedia };

// --- HELPER: Puppeteer Lock Cleaner ---
// As travas do Chromium são SYMLINKS para "<hostname>-<pid>". Depois que o
// container reinicia, o alvo não existe mais e fs.existsSync() devolve false
// para um symlink quebrado — por isso NÃO dá pra checar existência antes: tem
// que tentar remover direto (lstat enxerga o link em si).
const cleanPuppeteerLocks = (dir) => {
    const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    for (const base of [dir, path.join(dir, 'Default')]) {
        for (const lock of locks) {
            const lockPath = path.join(base, lock);
            try {
                fs.lstatSync(lockPath);          // lança se não existe (nem como link)
                fs.unlinkSync(lockPath);
                log(`[Puppeteer Fix] Trava removida: ${lockPath}`);
            } catch (e) { /* não existe — ok */ }
        }
    }
};

// --- Instância única ---
// Só UM processo pode usar a sessão do WhatsApp por vez. Num redeploy o container
// novo sobe com o antigo ainda vivo; se os dois abrirem o mesmo perfil, o WhatsApp
// vê o mesmo aparelho conectado duas vezes e desloga. Cada processo mantém um
// arquivo com batimento em DATA_DIR/instances; quem encontra outro batimento
// recente espera antes de iniciar o cliente.
export const INSTANCE_ID = `${os.hostname()}-${process.pid}`;
const INSTANCES_DIR = path.join(DATA_DIR, 'instances');
const HEARTBEAT_MS = 10000;
const ALIVE_WINDOW_MS = 35000;
const myInstanceFile = () => path.join(INSTANCES_DIR, `${INSTANCE_ID}.json`);

export const startInstanceHeartbeat = () => {
    const beat = () => {
        try {
            fs.mkdirSync(INSTANCES_DIR, { recursive: true });
            fs.writeFileSync(myInstanceFile(), JSON.stringify({ id: INSTANCE_ID, ts: Date.now() }));
        } catch (e) { /* volume indisponível: segue sem a proteção */ }
    };
    beat();
    setInterval(beat, HEARTBEAT_MS).unref();
    log(`[Instância] ${INSTANCE_ID} iniciada.`);
};

export const stopInstanceHeartbeat = () => { try { fs.unlinkSync(myInstanceFile()); } catch (e) {} };

export const otherLiveInstance = () => {
    try {
        for (const f of fs.readdirSync(INSTANCES_DIR)) {
            const full = path.join(INSTANCES_DIR, f);
            try {
                const d = JSON.parse(fs.readFileSync(full, 'utf8'));
                if (d.id === INSTANCE_ID) continue;
                if (Date.now() - d.ts < ALIVE_WINDOW_MS) return d.id;
                fs.unlinkSync(full); // batimento velho: processo morto
            } catch (e) { /* arquivo meio escrito: ignora */ }
        }
    } catch (e) { /* pasta ainda não existe */ }
    return null;
};

// Encerramento limpo: fecha o Chromium direito (grava a sessão) antes de sair.
export const shutdownWaClients = async () => {
    await Promise.all(Object.keys(waClients).map(async (u) => {
        try {
            if (waClients[u]?.client) {
                await Promise.race([waClients[u].client.destroy(), new Promise((r) => setTimeout(r, 8000))]);
            }
        } catch (e) {}
    }));
    stopInstanceHeartbeat();
};

// --- Acomodação pós-pareamento ---
// Logo depois de ler o QR o WhatsApp Web ainda está sincronizando (histórico,
// contatos, estado do app) e faz um recarregamento programado. Trabalho do
// aplicativo sobre o armazenamento da sessão nessa janela derruba a sessão
// recém-pareada (ver docs: "WhatsApp: logout espontâneo"). Enquanto durar, as
// consultas AUTOMÁTICAS ao WhatsApp usam o banco local. Enviar/receber seguem
// normais. Só vale para pareamento novo (QR lido neste processo).
export const SETTLE_MIN = (() => {
    const n = Number(process.env.WA_SETTLE_MINUTES);
    return Number.isFinite(n) && n >= 0 ? n : 10;
})();
export const SETTLE_MS = SETTLE_MIN * 60 * 1000;
export const isSettling = (entry) => !!(entry && entry.pairedAt) && (Date.now() - entry.pairedAt) < SETTLE_MS;
export const settleRemainingMin = (entry) =>
    isSettling(entry) ? Math.max(1, Math.ceil((SETTLE_MS - (Date.now() - entry.pairedAt)) / 60000)) : 0;

// --- Auto-recuperação do cliente ---
// Se o Chromium trava / a página do WhatsApp recarrega e a lib não consegue
// reinjetar, o cliente fica morto. Em vez de exigir restart manual do serviço,
// derruba e sobe de novo (mantendo a sessão salva e os SSE conectados).
const MAX_RESTARTS = 5;
const restartState = {}; // username -> { attempts, pending }

export const restartWaClient = (username, reason = '') => {
    if (!username) return;
    const st = (restartState[username] = restartState[username] || { attempts: 0, pending: false });
    if (st.pending) return;
    if (st.attempts >= MAX_RESTARTS) {
        log(`[WhatsApp Recover] ${username}: ${MAX_RESTARTS} tentativas sem sucesso — parando. Use "Resetar sessão" ou reinicie o serviço.`);
        if (waClients[username]) waClients[username].status = 'error';
        return;
    }
    st.pending = true;
    st.attempts++;
    const delay = 5000 * st.attempts;
    log(`[WhatsApp Recover] ${username}: reiniciando cliente em ${delay / 1000}s (tentativa ${st.attempts}/${MAX_RESTARTS}). Motivo: ${reason}`);
    if (waClients[username]) waClients[username].status = 'disconnected';

    setTimeout(async () => {
        const old = waClients[username];
        const sse = old?.sseClients || [];
        try {
            if (old?.client) {
                await Promise.race([
                    old.client.destroy(),
                    new Promise((r) => setTimeout(r, 15000)),
                ]);
            }
        } catch (e) { log(`[WhatsApp Recover] erro ao destruir cliente antigo (ignorado): ${e.message}`); }
        delete waClients[username];
        st.pending = false;
        try {
            const fresh = getWaClientWrapper(username);
            if (fresh) fresh.sseClients = sse;
        } catch (e) { log(`[WhatsApp Recover] falha ao recriar cliente`, e); }
    }, delay);
};

export const recoverAllWaClients = (reason) => {
    for (const username of Object.keys(waClients)) restartWaClient(username, reason);
};

// --- HELPER: Robust WhatsApp Send ---
export const safeSendMessage = async (client, chatId, content, options = {}) => {
    log(`[WhatsApp] Tentando enviar mensagem para: ${chatId}`);
    try {
        if (!client) throw new Error("Client é null");

        const safeOptions = { 
            ...options, 
            sendSeen: false 
        };

        let finalChatId = chatId;
        
        if (!finalChatId.includes('@')) {
             if (/^\d+$/.test(finalChatId)) {
                 finalChatId = `${finalChatId}@c.us`;
             } else {
                 throw new Error("ChatId mal formatado: " + chatId);
             }
        }

        try {
            if (finalChatId.endsWith('@c.us')) {
                const numberPart = finalChatId.replace('@c.us', '').replace(/\D/g, '');
                const contactId = await client.getNumberId(numberPart);

                if (contactId && contactId._serialized) {
                    finalChatId = contactId._serialized;
                }
            }
        } catch (idErr) {
            log(`[WhatsApp] Erro não bloqueante ao resolver getNumberId: ${idErr.message}`);
        }

        // UM único caminho de envio. NÃO tentar de novo aqui: se o frame do
        // Puppeteer desanexa (ou dá timeout de protocolo) DEPOIS que a mensagem
        // já saiu, um retry cego reenvia — foi o que causou mensagens 2x/3x no
        // envio em massa. Quem chama decide se e como retenta.
        return await client.sendMessage(finalChatId, content, safeOptions);

    } catch (error) {
        log(`[WhatsApp] FALHA CRÍTICA NO ENVIO para ${chatId}`, error);
        throw error;
    }
};

// --- HELPER: Salvar mensagem(ns) no banco ---
const INSERT_WA_MESSAGE =
    `INSERT INTO whatsapp_messages
       (id, chatId, sender, timestamp, body, fromMe, hasMedia, type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`;

export const saveMessageToDb = async (db, { id, chatId, sender, timestamp, body, fromMe, hasMedia, type }) => {
    if (!db || !id || !chatId) return;
    try {
        await db.prepare(INSERT_WA_MESSAGE).run(
            id, chatId, sender || '', timestamp || 0, body || '',
            fromMe ? 1 : 0, hasMedia ? 1 : 0, type || 'chat'
        );
    } catch (err) {
        log(`[DB] Erro ao salvar mensagem ${id}: ${err.message}`);
    }
};

export const saveMessagesToDb = async (db, messages) => {
    if (!db || !messages?.length) return;
    for (const m of messages) {
        try {
            await db.prepare(INSERT_WA_MESSAGE).run(
                m.id, m.chatId, m.sender || '', m.timestamp || 0,
                m.body || '', m.fromMe ? 1 : 0, m.hasMedia ? 1 : 0, m.type || 'chat'
            );
        } catch (err) {
            log(`[DB] Erro ao salvar mensagem ${m.id}: ${err.message}`);
        }
    }
};

// --- HELPER: upsertContactCache ---
export const upsertContactCache = async (db, contactId, contactName, phoneNumber = null) => {
    if (!db || !contactId || !contactName) return;
    try {
        await db.prepare(
            `INSERT INTO whatsapp_contacts (contact_id, name, phone_number, last_seen)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT (contact_id) DO UPDATE SET
             name = COALESCE(EXCLUDED.name, whatsapp_contacts.name),
             phone_number = COALESCE(EXCLUDED.phone_number, whatsapp_contacts.phone_number),
             last_seen = CURRENT_TIMESTAMP`
        ).run(contactId, contactName, phoneNumber);
    } catch (err) {
        log(`[DB] Erro upsert contato ${contactId}: ${err.message}`);
    }
};

// --- MULTI-TENANCY: WhatsApp client wrapper ---
export const getWaClientWrapper = (username) => {
    if (!username) return null;
    
    if (!waClients[username]) {
        waClients[username] = { client: null, qr: null, status: 'disconnected', info: null, sseClients: [] };
    }
    const entry = waClients[username];

    if (!entry.client) {
        const other = otherLiveInstance();
        if (other) {
            if (!entry.waitTimer) {
                log(`[WhatsApp Init] OUTRA INSTÂNCIA ATIVA (${other}) usando a sessão — esta (${INSTANCE_ID}) aguarda ela encerrar antes de conectar.`);
                entry.waitTimer = setTimeout(() => { entry.waitTimer = null; getWaClientWrapper(username); }, 15000);
            }
            return entry;
        }
        log(`[WhatsApp Init] Inicializando cliente para usuário: ${username} (instância ${INSTANCE_ID})`);

        const authPath = path.join(DATA_DIR, `whatsapp_auth_${username}`);
        if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });

        const sessionPath = path.join(authPath, `session-${username}`);
        cleanPuppeteerLocks(sessionPath);

        const puppeteerExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
        
        // WA_WEB_VERSION permite travar a versão do WhatsApp Web usada pelo Puppeteer.
        // Isso evita que uma atualização recente do WhatsApp Web quebre o whatsapp-web.js
        // (ex.: erros "Evaluation failed" no getChats/getChatModel).
        // Defina no .env, ex: WA_WEB_VERSION=2.2412.54
        // Lista de versões disponíveis: https://github.com/wppconnect-team/wa-version/tree/main/html
        const webVersionCache = process.env.WA_WEB_VERSION
            ? {
                type: 'remote',
                remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${process.env.WA_WEB_VERSION}.html`,
              }
            : { type: 'none' }; // 'none' = usa a versão embutida na própria WhatsApp Web ao carregar, sem cache

        const client = new Client({
            authStrategy: new LocalAuth({ clientId: username, dataPath: authPath }),
            webVersionCache,
            // Em Chromium automatizado navigator.storage.persist() devolve false.
            // O WhatsApp Web trata isso como armazenamento não confiável e, num
            // reload interno, apaga o IndexedDB e redireciona para post_logout=1 —
            // um LOGOUT espontâneo que exige QR novo (upstream PR #201937, aberta).
            // Roda dentro da página, antes dos scripts do WhatsApp.
            evalOnNewDoc: () => {
                try {
                    if (typeof navigator !== 'undefined' && navigator.storage) {
                        const orig = navigator.storage.persist ? navigator.storage.persist.bind(navigator.storage) : null;
                        navigator.storage.persist = async () => {
                            if (orig) { try { await orig(); } catch (e) { /* ignora, força concedido */ } }
                            return true;
                        };
                        navigator.storage.persisted = async () => true;
                    }
                } catch (e) { /* não crítico */ }
            },
            puppeteer: {
                headless: true,
                executablePath: puppeteerExecutablePath,
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage', 
                    '--disable-accelerated-2d-canvas', 
                    '--no-first-run', 
                    '--no-zygote', 
                    '--disable-gpu', 
                    '--disable-software-rasterizer',
                    '--single-process'
                ],
            }
        });

        // ============================================================
        // SEÇÃO 2 — handler 'message' (mensagens RECEBIDAS)
        // ============================================================
        client.on('message', async (msg) => {
            if (msg.from.includes('@g.us') || msg.to.includes('@g.us') || msg.isStatus || (msg.id && msg.id.remote && msg.id.remote.includes('@g.us'))) {
                return;
            }

            const sender = msg.from;
            const chatId = msg.from;
            log(`[WhatsApp Inbound] Mensagem recebida de: ${sender} | Body: ${msg.body?.substring(0, 30)}...`);

            let contactName = null;
            try {
                const contact = await msg.getContact();
                contactName = contact.name || contact.pushname || contact.number || sender;
            } catch (e) { contactName = sender; }

            const db = getDb(username);
            if (db) {
                const phoneNumber = sender.includes('@c.us') ? sender.replace('@c.us', '') : null;
                upsertContactCache(db, sender, contactName, phoneNumber);
            }

            const msgPayload = {
                id: msg.id._serialized,
                from: msg.from,
                to: msg.to,
                body: msg.body,
                timestamp: msg.timestamp,
                hasMedia: msg.hasMedia,
                type: msg.type,
                fromMe: false,
                chatId: chatId,
                contactName: contactName
            };
            broadcastWaEvent(username, 'whatsapp_message', msgPayload);

            if (db) {
                saveMessageToDb(db, {
                    id: msg.id._serialized,
                    chatId,
                    sender: msg.from,
                    timestamp: msg.timestamp,
                    body: msg.body || '',
                    fromMe: false,
                    hasMedia: msg.hasMedia,
                    type: msg.type
                });
                try {
                    await db.prepare("UPDATE whatsapp_messages SET contactName = ? WHERE id = ?").run(contactName, msg.id._serialized);
                } catch (e) {}
                try {
                    const conv = await touchConversation(db, chatId, { fromMe: false, ts: msg.timestamp, name: contactName });
                    if (conv) broadcastWaEvent(username, 'conversation_update', conv);
                } catch (e) { log(`[conv] touch inbound ${chatId}: ${e.message}`); }
            }

            if (msg.hasMedia) {
                try {
                    const media = await msg.downloadMedia();
                    if (media) {
                        const originalName = media.filename || ('whatsapp_media_' + msg.timestamp + '.' + (media.mimetype.split('/')[1] || '').split(';')[0] || 'bin');
                        const serverFilename = Date.now() + '-' + originalName.replace(/[^a-zA-Z0-9.]/g, '_');
                        const buffer = Buffer.from(media.data, 'base64');
                        fs.writeFileSync(path.join(UPLOADS_DIR, serverFilename), buffer);
                        
                        if(db) {
                            await db.prepare(
                                'INSERT INTO file_gallery (serverFilename, originalName, mimeType, size, contact, channel, direction, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                            ).run(serverFilename, originalName, media.mimetype, buffer.length, msg.from, 'whatsapp', 'received', new Date().toISOString());
                        }
                    }
                } catch(e) {
                    log(`[WhatsApp Inbound] Erro ao baixar media auto: ${e.message}`);
                }
            }

            try {
                const settingsRow = db ? await db.prepare("SELECT settings FROM user_settings WHERE id = 1").get() : null;
                const settings = settingsRow ? JSON.parse(settingsRow.settings) : null;

                const FALLBACK_AUTHORIZED_NUMBER = '557591167094';
                const FALLBACK_AUTHORIZED_LID = '105403295727623@lid';
                const LEGACY_LID = '140368205074641@lid';

                const isLid = msg.from.endsWith('@lid');
                let isAuthorized = false;

                if (isLid) {
                    isAuthorized = (msg.from === FALLBACK_AUTHORIZED_LID || msg.from === LEGACY_LID);
                    if (!isAuthorized && settings?.authorizedLid) {
                        isAuthorized = (msg.from === settings.authorizedLid);
                    }
                } else {
                    const senderNumber = msg.from.replace('@c.us', '').replace(/\D/g, '');
                    if (senderNumber === FALLBACK_AUTHORIZED_NUMBER.replace(/\D/g, '')) {
                        isAuthorized = true;
                    }
                    if (!isAuthorized && settings?.dailySummaryNumber) {
                        const authorizedNumber = settings.dailySummaryNumber.replace(/\D/g, '');
                        isAuthorized = senderNumber.endsWith(authorizedNumber);
                    }
                }

                if (!isAuthorized) {
                    log(`[AI Trigger] Acesso negado para: ${msg.from}`);
                    return;
                }

                if (settings.aiEnabled === false) {
                    log(`[AI Trigger] IA está desativada nas configurações.`);
                    return;
                }

                log(`[AI Trigger] ACESSO PERMITIDO! Iniciando processamento IA...`);

                let mediaPart = null;
                let textContent = msg.body;

                if (msg.hasMedia) {
                    try {
                        const media = await msg.downloadMedia();
                        if (media) {
                            mediaPart = {
                                inlineData: {
                                    mimeType: media.mimetype,
                                    data: media.data
                                }
                            };
                            if (media.mimetype.startsWith('audio/')) {
                                textContent = "Por favor, analise este áudio. " + (msg.body || "");
                            } else {
                                textContent += " [Mídia anexa]";
                            }
                        }
                    } catch (mediaErr) {
                        log("Erro download media", mediaErr);
                    }
                }

                const { processAI } = await import('./aiService.js');
                const response = await processAI(username, textContent, mediaPart);
                await safeSendMessage(client, msg.from, response);

            } catch (e) {
                log("Erro no handler de mensagem IA", e);
            }
        });

        // ============================================================
        // SEÇÃO 3 — handler 'message_create' (mensagens ENVIADAS)
        // ============================================================
        client.on('message_create', async (msg) => {
            if (msg.fromMe) {
                const chatId = msg.to;
                let contactName = null;
                try {
                    const contact = await msg.getContact();
                    contactName = contact.name || contact.pushname || contact.number || chatId;
                } catch (e) { contactName = chatId; }

                const db = getDb(username);
                if (db) {
                    const phoneNumber = chatId.includes('@c.us') ? chatId.replace('@c.us', '') : null;
                    upsertContactCache(db, chatId, contactName, phoneNumber);
                }

                broadcastWaEvent(username, 'whatsapp_message', {
                    id: msg.id._serialized,
                    from: msg.from,
                    to: msg.to,
                    body: msg.body,
                    timestamp: msg.timestamp,
                    hasMedia: msg.hasMedia,
                    type: msg.type,
                    fromMe: true,
                    chatId: chatId,
                    contactName: contactName
                });

                if (db) {
                    saveMessageToDb(db, {
                        id: msg.id._serialized,
                        chatId,
                        sender: msg.from,
                        timestamp: msg.timestamp,
                        body: msg.body || '',
                        fromMe: true,
                        hasMedia: msg.hasMedia,
                        type: msg.type
                    });
                    try {
                        await db.prepare("UPDATE whatsapp_messages SET contactName = ? WHERE id = ?").run(contactName, msg.id._serialized);
                    } catch (e) {}
                    try {
                        const conv = await touchConversation(db, chatId, { fromMe: true, ts: msg.timestamp, name: contactName });
                        if (conv) broadcastWaEvent(username, 'conversation_update', conv);
                    } catch (e) { log(`[conv] touch outbound ${chatId}: ${e.message}`); }
                }
            }
        });

        // ── Diagnóstico ─────────────────────────────────────────────────────────
        // Mantém um rastro em memória do que a página do WhatsApp Web disse:
        //  - o log INTERNO do WhatsApp Web (waLogTap.js): é lá — e não no console —
        //    que ele escreve o motivo exato antes de deslogar a sessão;
        //  - erros/avisos de console e exceções da página.
        // O rastro é despejado no log quando a sessão cai. Linhas de ERRO do
        // WhatsApp Web saem na hora (são raras numa sessão saudável).
        const TRAIL_MAX = 800;
        const pageTrail = [];
        const trail = (line) => {
            pageTrail.push(`${new Date().toISOString().slice(11, 19)} ${line}`.slice(0, 1000));
            if (pageTrail.length > TRAIL_MAX) pageTrail.shift();
        };
        const dumpTrail = (why) => {
            log(`[WhatsApp Diag] ${why} — últimas ${pageTrail.length} linhas da página (log interno do WhatsApp Web + console):`);
            for (const l of pageTrail) log(`[WhatsApp Diag]   ${l}`);
            pageTrail.length = 0;
        };
        const SUBJECT = /syncd|bootstrap|logout|logged out|logging out|fatal|critical|history.?sync|key.?share|missing key|takeover|conflict|unlink|revoke/i;
        let errBudget = { start: Date.now(), n: 0 };
        const onConsole = (msg) => {
            let text = '';
            try { text = msg.text(); } catch (e) { return; }
            const tap = parseWaTapLine(text);
            if (tap) {
                trail(`[wa:${tap.label}] ${tap.text}`);
                if (tap.level >= 4) {
                    const now = Date.now();
                    if (now - errBudget.start > 60000) errBudget = { start: now, n: 0 };
                    if (errBudget.n++ < 20) log(`[WhatsApp Web ERRO] ${tap.text.slice(0, 600)}`);
                }
                return;
            }
            let type = '';
            try { type = msg.type(); } catch (e) {}
            // erros/avisos de console + linhas dos workers (que logam via console.log)
            if (/Permissions-Policy header/.test(text)) return; // ruído do Chromium
            if (type === 'error' || type === 'warn' || type === 'warning' || SUBJECT.test(text)) {
                trail(`[console:${type}] ${text}`);
            }
        };

        let diagPage = null;
        const armLogTap = (page) => {
            installWaLogTap(page).then((r) => {
                if (r === 'instalado') log('[WhatsApp Diag] captura do log interno do WhatsApp Web ativa.');
                else if (r !== 'ja-instalado') log(`[WhatsApp Diag] captura do log interno indisponível (${r}).`);
            }).catch(() => { /* página fechou/navegou: o próximo framenavigated tenta de novo */ });
        };
        const attachPageDiagnostics = () => {
            const page = client.pupPage;
            if (!page || diagPage === page) return;
            diagPage = page;
            page.on('framenavigated', (frame) => {
                try {
                    if (frame.parentFrame() !== null) return;
                    const url = frame.url();
                    const q = url.includes('?') ? url.slice(url.indexOf('?')) : '';
                    log(`[WhatsApp Diag] página navegou/recarregou${q ? ` (${q})` : ''}`);
                    trail(`[nav] ${q || '/'}`);
                    armLogTap(page); // contexto novo: o gancho precisa ser reinstalado
                } catch (e) {}
            });
            page.on('console', onConsole);
            page.on('pageerror', (err) => { try { trail(`[pageerror] ${err?.message || err}`); } catch (e) {} });
            armLogTap(page);
        };
        client.on('loading_screen', attachPageDiagnostics);
        client.on('authenticated', attachPageDiagnostics);
        // a página existe bem antes do primeiro evento da lib — pega o mais cedo possível
        const earlyAttach = setInterval(() => {
            if (client.pupPage) { clearInterval(earlyAttach); attachPageDiagnostics(); }
        }, 300);
        setTimeout(() => clearInterval(earlyAttach), 120000);

        client.on('qr', (qr) => {
            attachPageDiagnostics();
            // QR na tela = não há pareamento ativo; o próximo 'ready' será um pareamento NOVO
            waClients[username].sawQr = true;
            waClients[username].pairedAt = null;
            log(`[WhatsApp Event] QR Code gerado para ${username}`);
            QRCode.toDataURL(qr, (err, url) => {
                if (err) log(`[WhatsApp Event] Erro QR`, err);
                waClients[username].qr = url;
                waClients[username].status = 'generating_qr';
            });
        });

        let seededOnce = false;
        let readyCount = 0;
        client.on('ready', async () => {
            // A lib emite 'authenticated' + 'ready' a CADA mudança de Socket.hasSynced,
            // sem olhar o valor. No logout o WhatsApp Web zera hasSynced (clearState),
            // então chega um 'ready' espúrio que na verdade é o INÍCIO do logout.
            readyCount++;
            if (readyCount > 1) {
                let synced = null;
                try {
                    synced = await client.pupPage.evaluate(() => window.require('WAWebSocketModel').Socket.hasSynced === true);
                } catch (e) { /* página já em desmontagem */ }
                if (synced !== true) {
                    log(`[WhatsApp Diag] 'ready' espúrio (hasSynced=${synced}): o WhatsApp Web está ENCERRANDO a sessão. Aguardando o motivo...`);
                    trail('[diag] hasSynced caiu — início do logout');
                    return;
                }
            }

            const entry = waClients[username];
            entry.readyAt = Date.now();
            if (entry.sawQr && !entry.pairedAt) {
                entry.pairedAt = Date.now();
                entry.sawQr = false;
                if (SETTLE_MS > 0) {
                    log(`[WhatsApp] Pareamento NOVO. Acomodação de ${SETTLE_MIN} min: consultas automáticas ao WhatsApp (lista de chats, fotos, nomes, histórico) ficam suspensas e usam o banco local. Enviar e receber mensagens funciona normalmente.`);
                }
            }

            log(`[WhatsApp Event] CLIENTE PRONTO (${username})`);
            entry.status = 'connected';
            entry.qr = null;
            entry.info = client.info;
            if (restartState[username]) restartState[username].attempts = 0; // conectou: zera o contador

            // Versão do WhatsApp Web em uso — copie este número pro WA_WEB_VERSION do
            // .env se um dia precisar travar a versão (erros "Evaluation failed").
            try {
                const wwv = await client.getWWebVersion();
                log(`[WhatsApp] WhatsApp Web versão em uso: ${wwv}`);
            } catch (e) { /* não crítico */ }

            // Popular o cache de contatos — UMA vez por cliente e SEM consultar o
            // servidor (antes: um getNumberId por contato, em rajada). Em pareamento
            // novo, só depois da acomodação: getChats() serializa todos os chats e
            // dispara consulta de metadados de cada grupo.
            if (seededOnce) return;
            seededOnce = true;
            const seed = async () => {
                if (waClients[username]?.client !== client || waClients[username].status !== 'connected') return;
                try {
                    const db = getDb(username);
                    if (!db) return;
                    const chats = await client.getChats();
                    let seeded = 0;
                    for (const chat of chats) {
                        if (chat.isGroup) continue;
                        const chatId = chat.id?._serialized;
                        if (!chatId) continue;
                        const phone = chatId.endsWith('@c.us') ? chatId.replace('@c.us', '').replace(/\D/g, '') : null;
                        upsertContactCache(db, chatId, chat.name || chat.id.user || chatId, phone);
                        seeded++;
                    }
                    log(`[WhatsApp Cache] ${seeded} contatos populados no cache.`);
                } catch (e) {
                    seededOnce = false;
                    log(`[WhatsApp Cache] Erro ao popular cache: ${e.message}`);
                }
            };
            if (isSettling(entry)) {
                const t = setTimeout(seed, SETTLE_MS + 30000);
                if (t.unref) t.unref();
            } else {
                seed();
            }
        });

        client.on('authenticated', () => {
            log(`[WhatsApp Event] Autenticado (${username})`);
        });

        client.on('auth_failure', (msg) => {
            log(`[WhatsApp Event] FALHA DE AUTENTICAÇÃO (${username}): ${msg}`);
            waClients[username].status = 'error';
        });

        client.on('disconnected', (reason) => {
            if (waClients[username]?.client !== client) return; // cliente antigo, já substituído
            const e = waClients[username];
            const since = (t) => (t ? `${Math.round((Date.now() - t) / 1000)}s` : 'n/d');
            log(`[WhatsApp Event] Desconectado (${username}). Razão: ${reason} | desde o ready: ${since(e.readyAt)} | desde o pareamento: ${since(e.pairedAt)}`);
            dumpTrail(`desconectado: ${reason}`);
            e.status = 'disconnected';
            e.info = null;
            e.pairedAt = null;
            readyCount = 0;
            // LOGOUT = sessão encerrada pelo WhatsApp/celular: precisa de QR novo, não adianta religar.
            if (reason !== 'LOGOUT') restartWaClient(username, `disconnected: ${reason}`);
        });

        client.initialize().catch((err) => {
            if (waClients[username]?.client !== client) return;
            log(`[WhatsApp Init] ERRO FATAL (${username})`, err);
            waClients[username].status = 'error';
            cleanPuppeteerLocks(sessionPath);
            restartWaClient(username, `falha no initialize: ${String(err?.message || err).split('\n')[0]}`);
        });

        waClients[username].client = client;
    }

    return waClients[username];
};

// --- LOGIC: Send Daily Summary Helper ---
export const sendDailySummaryToUser = async (user) => {
    const db = getDb(user);
    if (!db) return;

    const waWrapper = getWaClientWrapper(user);
    if (waWrapper.status !== 'connected') {
        return { success: false, message: 'WhatsApp desconectado' };
    }

    try {
        const settingsRow = await db.prepare("SELECT settings FROM user_settings WHERE id = 1").get();
        if (!settingsRow) return { success: false, message: 'Configurações não encontradas' };
        
        const settings = JSON.parse(settingsRow.settings);
        if (!settings.dailySummaryNumber) return { success: false, message: 'Número para resumo não configurado' };

        const tasks = await db.prepare(
            `SELECT t.*, c.name as companyName FROM tasks t LEFT JOIN companies c ON t.companyId = c.id WHERE t.status != 'concluida'`
        ).all();

        if (!tasks || tasks.length === 0) return { success: true, message: 'Nenhuma tarefa pendente' };

        const priorityMap = { 'alta': 1, 'media': 2, 'baixa': 3 };
        const sortedTasks = tasks.sort((a, b) => (priorityMap[a.priority] || 99) - (priorityMap[b.priority] || 99));

        let message = `*📅 Resumo Diário de Tarefas*\n\nVocê tem *${sortedTasks.length}* tarefas pendentes.\n\n`;
        sortedTasks.forEach(task => {
            let icon = task.priority === 'alta' ? '🔴' : task.priority === 'media' ? '🟡' : '🔵';
            message += `${icon} *${task.title}*\n`;
            if (task.companyName) message += `   🏢 ${task.companyName}\n`;
            if (task.dueDate) message += `   📅 Vence: ${task.dueDate}\n`;
            message += `\n`;
        });
        message += `_Gerado automaticamente pelo Contábil Manager Pro_`;

        let number = settings.dailySummaryNumber.replace(/\D/g, '');
        if (!number.startsWith('55')) number = '55' + number;
        const chatId = `${number}@c.us`;
        
        await safeSendMessage(waWrapper.client, chatId, message);
        return { success: true, message: 'Enviado com sucesso' };
    } catch (sendErr) {
        log(`[Summary] Erro envio`, sendErr);
        return { success: false, message: 'Erro no envio do WhatsApp' };
    }
};
