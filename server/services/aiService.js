import { GoogleGenAI, Type } from "@google/genai";
import { log } from '../logger.js';
import { getDb } from '../db/index.js';
import { createGoogleTask, createGoogleCalendarEvent } from './googleService.js';
import { emailTransporter, buildEmailHtml, saveToImapSentFolder } from './emailService.js';
import { getWaClientWrapper, safeSendMessage, upsertContactCache } from './whatsappService.js';

// --- AI CONFIGURATION ---
export let ai = null;
if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    log("AI: Google GenAI (v3 Flash Preview) inicializado.");
} else {
    log("AI: GEMINI_API_KEY não encontrada. O assistente inteligente estará desativado.");
}

// --- AI LOGIC: Tools & Handler ---
const assistantTools = [
    {
        name: "consult_tasks",
        description: "Lista as tarefas cadastradas.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                status: { type: Type.STRING, enum: ["pendente", "em_andamento", "concluida", "todas"], description: "Filtro. Use 'todas' se o usuario pedir 'todas'." }
            }
        }
    },
    {
        name: "update_task_status",
        description: "Marca uma tarefa como concluída ou muda status.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                task_id_or_title: { type: Type.STRING, description: "ID numérico ou Título aproximado da tarefa." },
                new_status: { type: Type.STRING, enum: ["pendente", "em_andamento", "concluida"], description: "Novo status." }
            },
            required: ["task_id_or_title", "new_status"]
        }
    },
    {
        name: "add_task",
        description: "Cria uma nova tarefa. O título e a descrição devem ser BEM ESTRUTURADOS e descritivos baseados no pedido do usuário. Elas serão sincronizadas com o Google Tasks do usuário. Use este para pedidos de 'tarefa'.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                title: { type: Type.STRING, description: "Título breve e muito claro da tarefa ou lembrete. Enriquecido pelo contexto." },
                description: { type: Type.STRING, description: "Detalhes ricos e explicações do que deve ser feito. Não deixe vazio se houver contexto útil." },
                dueDates: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Para tarefas repetidas, gere MÚLTIPLAS datas de vencimento YYYY-MM-DD (ex: os próximos 6 a 12 meses das datas correspondentes). Para tarefa única, apenas uma data. IMPORTANTE: Use apenas este campo para data." },
                recurrenceText: { type: Type.STRING, description: "Descrição em texto humano da repetição desejada (Ex: 'Toda segunda', 'Todos os dias'). Deixe vazio se for evento único." },
                subtasks: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Lista de subtarefas em formato de texto para quebrar a tarefa maior em partes." }
            },
            required: ["title", "description", "dueDates"]
        }
    },
    {
        name: "create_calendar_event",
        description: "Cria um lembrete ou evento na agenda. O evento será sincronizado com o Google Calendar do usuário. Use para 'lembretes' e 'eventos na agenda'. Se o usuário informar múltiplos horários distintos (ex: 8-12 e 13-17), você DEVE chamar esta tool múltiplas vezes, uma para cada bloco de horário.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                title: { type: Type.STRING, description: "Título breve e direto do lembrete ou evento." },
                description: { type: Type.STRING, description: "Detalhes sobre o evento ou lembrete." },
                datetime: { type: Type.STRING, description: "Data e hora exata de INÍCIO em formato ISO 8601 (ex: 2026-05-10T14:30:00)." },
                endDatetime: { type: Type.STRING, description: "Data e hora exata de TÉRMINO em formato ISO 8601 (ex: 2026-05-10T17:00:00). Importante informar para definir corretamente a duração na agenda." },
                recurrence: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Regras de repetição no formato RRULE do iCalendar (ex: 'FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=MO,WE,FR'). O prefixo 'RRULE:' será adicionado automaticamente. Se for evento único, deixe vazio." }
            },
            required: ["title", "datetime"]
        }
    },
    {
        name: "send_message_to_company",
        description: "ENVIA uma mensagem REAL (Email e/ou WhatsApp) para uma empresa cadastrada. Use SEMPRE que o usuário pedir para enviar/mandar mensagem para uma empresa.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                company_name_search: { type: Type.STRING, description: "Nome aproximado da empresa para buscar." },
                message_body: { type: Type.STRING, description: "Conteúdo da mensagem a ser enviada." },
                channels: { 
                    type: Type.OBJECT, 
                    properties: {
                        whatsapp: { type: Type.BOOLEAN },
                        email: { type: Type.BOOLEAN }
                    }
                }
            },
            required: ["company_name_search", "message_body"]
        }
    },
    {
        name: "send_message_to_phone",
        description: "Envia mensagem WhatsApp para um número de telefone específico. USE APENAS quando o usuário EXPLICITAMENTE fornecer um número e pedir para ENVIAR ou MANDAR mensagem. NÃO use para consultas, resumos ou qualquer outra finalidade.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                phone: { type: Type.STRING, description: "Número com DDI+DDD, ex: 5575999999999" },
                message: { type: Type.STRING, description: "Texto da mensagem." }
            },
            required: ["phone", "message"]
        }
    },
    {
        name: "search_company",
        description: "Consulta dados de uma empresa (email, whatsapp, tipo, documentos).",
        parameters: {
            type: Type.OBJECT,
            properties: {
                name_or_doc: { type: Type.STRING }
            },
            required: ["name_or_doc"]
        }
    },
    {
        name: "list_companies",
        description: "Lista todas as empresas cadastradas, com opção de filtro por tipo.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                type_filter: { type: Type.STRING, enum: ["MEI", "Simples", "Lucro Presumido", "todas"], description: "Filtro por tipo. Use 'todas' se não especificado." }
            }
        }
    },
    {
        name: "create_kanban_tag",
        description: "Cria uma nova tag no Kanban WhatsApp.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING, description: "Nome da tag." },
                color: { type: Type.STRING, description: "Cor hex opcional, ex: #FF5733. Se não informado, será gerada automaticamente." }
            },
            required: ["name"]
        }
    },
    {
        name: "add_tag_to_contact",
        description: "Adiciona uma tag existente a um contato/chat no Kanban. IMPORTANTE: O contato já deve existir no banco de contatos. Use search_whatsapp_contact primeiro para obter o contact_id correto, se necessário.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                phone: { type: Type.STRING, description: "Número do contato com DDI+DDD, ex: 5575999999999" },
                tag_name: { type: Type.STRING, description: "Nome da tag a adicionar." }
            },
            required: ["phone", "tag_name"]
        }
    },
    {
        name: "consult_sent_history",
        description: "Consulta o histórico de envios de documentos recentes.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                limit: { type: Type.NUMBER, description: "Quantidade de registros. Padrão: 10." }
            }
        }
    },
    {
        name: "manage_memory",
        description: "Salva ou busca informações duradouras na memória do assistente (anotações, preferências, dados importantes).",
        parameters: {
            type: Type.OBJECT,
            properties: {
                action: { type: Type.STRING, enum: ["save", "search"] },
                topic: { type: Type.STRING, description: "Tema ou título da memória." },
                content: { type: Type.STRING, description: "Conteúdo a salvar (obrigatório em 'save')." }
            },
            required: ["action", "topic"]
        }
    },
    {
        name: "search_whatsapp_contact",
        description: "Busca um contato/conversa do WhatsApp por nome ou número. USE APENAS quando o usuário EXPLICITAMENTE pedir para buscar, localizar ou ver contatos do WhatsApp antes de enviar mensagem. NÃO use para consultas gerais, tarefas, empresas ou qualquer outra finalidade.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: { type: Type.STRING, description: "Nome parcial ou número do contato a buscar." }
            },
            required: ["query"]
        }
    },
    {
        name: "send_message_to_contact",
        description: "Envia mensagem WhatsApp para um contato da lista de conversas. USE APENAS quando o usuário EXPLICITAMENTE pedir para ENVIAR ou MANDAR uma mensagem pelo WhatsApp para uma pessoa específica. NÃO use para consultas, resumos, tarefas ou qualquer pergunta que não seja envio de mensagem.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                contact_query: { type: Type.STRING, description: "Nome, número (com ou sem DDI) ou chat_id do contato (ex: 'João', '5575999999999', '5575999999999@c.us'). Preferir nome quando disponível." },
                message: { type: Type.STRING, description: "Texto da mensagem." }
            },
            required: ["contact_query", "message"]
        }
    },
    {
        name: "search_whatsapp_messages",
        description: "Busca e resume mensagens do WhatsApp. USE APENAS quando o usuário EXPLICITAMENTE pedir: 'resuma mensagens', 'quem me mandou mensagem', 'o que fulano me enviou', 'resumo do WhatsApp', ou perguntas diretas sobre mensagens recebidas/enviadas no WhatsApp em um período. NÃO use para perguntas gerais, consultas de empresa, tarefas ou qualquer coisa não relacionada a leitura de mensagens do WhatsApp.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                contact_query: { type: Type.STRING, description: "Nome ou número do contato (opcional, deixe vazio para resumo geral de quem me mandou mensagem)." },
                period: { type: Type.STRING, enum: ["hoje", "ontem", "ultimas24h", "semana", "semana_passada", "dias15"], description: "Período das mensagens. 'semana' = últimos 7 dias. 'semana_passada' = segunda a domingo da semana anterior. 'dias15' = últimos 15 dias." },
                limit: { type: Type.NUMBER, description: "Número máximo de mensagens por contato (quando contact_query fornecido). Padrão: 5, máximo: 10." }
            }
        }
    }
];

// --- EXECUÇÃO DAS TOOLS ---
export const executeTool = async (name, args, db, username) => {
    log(`[AI Tool] Executando ${name} com args: ${JSON.stringify(args)}`);
    
    // 1. Consultar Tarefas
    if (name === "consult_tasks") {
        let sql = "SELECT id, title, priority, status, dueDate FROM tasks";
        const params = [];
        
        if (args.status && args.status !== 'todas') {
            sql += " WHERE status = ?";
            params.push(args.status);
        } else {
            sql += " ORDER BY CASE WHEN status = 'pendente' THEN 1 WHEN status = 'em_andamento' THEN 2 ELSE 3 END, id DESC";
        }
        
        try {
            const rows = await db.prepare(sql).all(...params);
            if (!rows || rows.length === 0) return "Nenhuma tarefa encontrada.";
            return JSON.stringify(rows);
        } catch (err) {
            return "Erro ao listar: " + err.message;
        }
    }

    // 2. Atualizar Status
    if (name === "update_task_status") {
        try {
            const isId = /^\d+$/.test(args.task_id_or_title);
            const sqlCheck = isId ? "SELECT id FROM tasks WHERE id = ?" : "SELECT id FROM tasks WHERE title LIKE ?";
            const paramCheck = isId ? args.task_id_or_title : `%${args.task_id_or_title}%`;

            const rows = await db.prepare(sqlCheck).all(paramCheck);
            if (!rows || rows.length === 0) return `Tarefa "${args.task_id_or_title}" não encontrada.`;
            
            const ids = rows.map(r => r.id);
            const placeholders = ids.map(() => '?').join(',');
            const result = await db.prepare(`UPDATE tasks SET status = ? WHERE id IN (${placeholders})`).run(args.new_status, ...ids);
            return `Atualizado ${result.changes} tarefa(s) para '${args.new_status}'.`;
        } catch (err) {
            return "Erro ao atualizar: " + err.message;
        }
    }

    // 3. Adicionar Tarefa
    if (name === "add_task") {
        const today = new Date().toISOString().split('T')[0];
        try {
            const datesToCreate = (args.dueDates && args.dueDates.length > 0) ? args.dueDates : [today];
            for (const dt of datesToCreate) {
                await createGoogleTask(args.title, args.description || '', dt, args.subtasks || [], args.recurrenceText || null);
            }
            return `Tarefa(s) criado(s) com sucesso no Google Tasks. (Total: ${datesToCreate.length} tarefas/datas criadas)`;
        } catch (err) {
            return "Erro ao criar tarefa no Google Tasks: " + err.message;
        }
    }

    // 4. Lembrete Pessoal (Google Calendar)
    if (name === "create_calendar_event") {
        try {
            await createGoogleCalendarEvent(args.title, args.description || '', args.datetime, args.recurrence || [], args.endDatetime || null);
            return `Evento/Lembrete '${args.title}' agendado para ${args.datetime} ${args.endDatetime ? 'até ' + args.endDatetime : ''} e integrado ao seu Google Calendar com sucesso.`;
        } catch (err) {
            return "Erro ao criar evento na agenda: " + err.message;
        }
    }

    // 5. Enviar Mensagem para Empresa
    if (name === "send_message_to_company") {
        try {
            const rows = await db.prepare("SELECT * FROM companies WHERE name LIKE ? LIMIT 5").all(`%${args.company_name_search}%`);
            if (!rows || rows.length === 0) return `Empresa com nome similar a "${args.company_name_search}" não encontrada.`;
            if (rows.length > 1) {
                const names = rows.map(r => r.name).join(", ");
                return `Encontrei várias empresas: ${names}. Seja mais específico no nome.`;
            }

            const company = rows[0];
            const channels = args.channels || { whatsapp: true, email: true };
            let logMsg = [];

            if (channels.email && company.email) {
                try {
                    const emailList = company.email.split(',').map(e => e.trim());
                    const mailOptions = {
                        from: process.env.EMAIL_USER,
                        to: emailList[0],
                        cc: emailList.slice(1),
                        subject: "Comunicado Contabilidade",
                        text: args.message_body, 
                        html: buildEmailHtml(args.message_body, [], "Atenciosamente,\nContabilidade")
                    };
                    await emailTransporter.sendMail(mailOptions);
                    await saveToImapSentFolder(mailOptions).catch(err => 
                        log('[send-documents] Falha ao salvar no IMAP', err)
                    );
                    logMsg.push("E-mail enviado");
                } catch (e) { logMsg.push("Falha no E-mail"); }
            }

            if (channels.whatsapp && company.whatsapp) {
                const waWrapper = getWaClientWrapper(username);
                if (waWrapper && waWrapper.status === 'connected') {
                    try {
                        let number = company.whatsapp.replace(/\D/g, '');
                        if (!number.startsWith('55')) number = '55' + number;
                        const chatId = `${number}@c.us`;
                        await safeSendMessage(waWrapper.client, chatId, args.message_body);
                        logMsg.push("WhatsApp enviado");
                    } catch (e) { logMsg.push("Falha no WhatsApp"); }
                } else {
                    logMsg.push("WhatsApp desconectado");
                }
            }

            return `Ação executada para ${company.name}: ${logMsg.join(", ")}.`;
        } catch (err) {
            return "Erro no banco de dados: " + err.message;
        }
    }

    if (name === "search_company") {
        try {
            const rows = await db.prepare(
                "SELECT id, name, docNumber, email, whatsapp, type FROM companies WHERE name LIKE ? OR docNumber LIKE ? LIMIT 5"
            ).all(`%${args.name_or_doc}%`, `%${args.name_or_doc}%`);
            return rows.length ? JSON.stringify(rows) : "Nenhuma empresa encontrada.";
        } catch (err) {
            return "Erro na busca.";
        }
    }

    // Enviar mensagem para número de telefone direto
    if (name === "send_message_to_phone") {
        const waWrapper = getWaClientWrapper(username);
        if (!waWrapper || waWrapper.status !== 'connected') {
            return "WhatsApp não está conectado. Impossível enviar a mensagem.";
        }
        try {
            let phone = (args.phone || '').replace(/\D/g, '');
            if (!phone.startsWith('55')) phone = '55' + phone;
            const chatId = `${phone}@c.us`;
            await safeSendMessage(waWrapper.client, chatId, args.message);
            return `✅ Mensagem enviada para ${args.phone}.`;
        } catch (e) {
            return `❌ Erro ao enviar mensagem: ${e.message}`;
        }
    }

    // Listar empresas
    if (name === "list_companies") {
        try {
            let sql = "SELECT id, name, docNumber, type, email, whatsapp FROM companies";
            const params = [];
            if (args.type_filter && args.type_filter !== 'todas') {
                sql += " WHERE type = ?";
                params.push(args.type_filter);
            }
            sql += " ORDER BY name ASC LIMIT 30";
            const rows = await db.prepare(sql).all(...params);
            if (!rows || rows.length === 0) return "Nenhuma empresa encontrada com esse filtro.";
            return `${rows.length} empresa(s) encontrada(s):\n` + rows.map(r => `• ${r.name} (${r.type || 'N/A'}) | WA: ${r.whatsapp || '-'} | Email: ${r.email || '-'}`).join('\n');
        } catch (err) {
            return "Erro ao listar empresas: " + err.message;
        }
    }

    // Criar tag no Kanban
    if (name === "create_kanban_tag") {
        try {
            const tagId = `tag-${Date.now()}`;
            const color = args.color || ('#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'));
            await db.prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)").run(tagId, args.name, color);
            return `✅ Tag "${args.name}" criada com cor ${color}.`;
        } catch (err) {
            return "Erro ao criar tag: " + err.message;
        }
    }

    // ============================================================
    // CORREÇÃO 6 — add_tag_to_contact usando whatsapp_contacts
    // ============================================================
    if (name === "add_tag_to_contact") {
        try {
            let phone = (args.phone || '').replace(/\D/g, '');
            if (!phone.startsWith('55')) phone = '55' + phone;
            const possibleChatId = `${phone}@c.us`;

            const contactRow = await db.prepare(
                "SELECT contact_id FROM whatsapp_contacts WHERE phone_number = ? OR contact_id IN (?, ?)"
            ).get(phone, possibleChatId, possibleChatId);

            if (!contactRow) {
                return `❌ Contato com número ${args.phone} não encontrado no cache de contatos. Use search_whatsapp_contact primeiro.`;
            }
            const contactId = contactRow.contact_id;
            const tag = await db.prepare("SELECT id FROM tags WHERE name LIKE ?").get(`%${args.tag_name}%`);
            if (!tag) return `❌ Tag "${args.tag_name}" não encontrada. Use 'criar tag' primeiro.`;
            await db.prepare("INSERT INTO chat_tags (chat_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING").run(contactId, tag.id);
            return `✅ Tag "${args.tag_name}" adicionada ao contato ${args.phone}.`;
        } catch (err) {
            return "Erro ao adicionar tag: " + err.message;
        }
    }

    // Consultar histórico de envios
    if (name === "consult_sent_history") {
        try {
            const limit = args.limit || 10;
            const rows = await db.prepare(
                "SELECT companyName, docName, category, sentAt, channels, status FROM sent_logs ORDER BY id DESC LIMIT ?"
            ).all(limit);
            if (!rows || rows.length === 0) return "Nenhum envio registrado ainda.";
            return `Últimos ${rows.length} envio(s):\n` + rows.map(r => `• ${r.sentAt} | ${r.companyName} | ${r.docName} (${r.category}) | ${r.status}`).join('\n');
        } catch (err) {
            return "Erro ao consultar histórico.";
        }
    }

    if (name === "manage_memory") {
        if (args.action === "save") {
            const now = new Date().toISOString();
            try {
                await db.prepare(
                    "INSERT INTO personal_notes (topic, content, created_at, updated_at) VALUES (?, ?, ?, ?)"
                ).run(args.topic, args.content, now, now);
                return "Memória salva.";
            } catch (err) {
                return "Erro.";
            }
        }
        if (args.action === "search") {
            const term = args.content || args.topic || "";
            const rows = await db.prepare(
                "SELECT topic, content FROM personal_notes WHERE topic LIKE ? OR content LIKE ? LIMIT 3"
            ).all(`%${term}%`, `%${term}%`);
            return JSON.stringify(rows);
        }
    }

    // ============================================================
    // CORREÇÃO 4 — search_whatsapp_contact reescrita
    // ============================================================
    if (name === "search_whatsapp_contact") {
        const query = (args.query || "").toLowerCase().trim();
        if (!query) return "Nenhuma consulta fornecida.";

        const waWrapper = getWaClientWrapper(username);
        if (!waWrapper || waWrapper.status !== "connected") {
            return "WhatsApp não conectado. Não é possível buscar contatos.";
        }

        try {
            const results = [];

            // 1) Buscar no cache local primeiro
            const contactsCache = await db.prepare(
                "SELECT contact_id, name, phone_number FROM whatsapp_contacts WHERE name LIKE ? OR phone_number LIKE ?"
            ).all(`%${query}%`, `%${query.replace(/\D/g, '')}%`);

            for (const c of contactsCache) {
                results.push({
                    chat_id: c.contact_id,
                    name: c.name,
                    phone_number: c.phone_number,
                    chat_id_type: c.contact_id.includes('@lid') ? 'lid' : 'c.us',
                    source: 'cache'
                });
            }

            // 2) Buscar em chats ativos se necessário (até completar 5)
            if (results.length < 5) {
                const chats = await waWrapper.client.getChats();
                for (const chat of chats) {
                    if (chat.isGroup) continue;
                    const chatId = chat.id._serialized || "";
                    const chatName = (chat.name || "").toLowerCase();
                    const phone = chatId.replace("@c.us", "").replace("@lid", "");
                    if (!chatName.includes(query) && !phone.includes(query.replace(/\D/g, ""))) continue;
                    if (results.some(r => r.chat_id === chatId)) continue;

                    const isLid = chatId.includes('@lid');
                    if (!isLid) {
                        try {
                            const numberPart = phone;
                            if (numberPart) {
                                const contactId = await waWrapper.client.getNumberId(numberPart);
                                if (contactId && contactId._serialized !== chatId) {
                                    if (!results.some(r => r.chat_id === contactId._serialized)) {
                                        const resolvedEntry = {
                                            chat_id: contactId._serialized,
                                            name: chat.name,
                                            phone_number: numberPart,
                                            chat_id_type: contactId._serialized.includes('@lid') ? 'lid' : 'c.us',
                                            source: 'chat_resolved'
                                        };
                                        results.push(resolvedEntry);
                                        upsertContactCache(db, contactId._serialized, chat.name, numberPart);
                                    }
                                    continue;
                                }
                            }
                        } catch (e) {}
                    }
                    results.push({
                        chat_id: chatId,
                        name: chat.name,
                        phone_number: isLid ? null : phone,
                        chat_id_type: isLid ? 'lid' : 'c.us',
                        source: 'chat'
                    });
                    upsertContactCache(db, chatId, chat.name, isLid ? null : phone);
                    if (results.length >= 5) break;
                }
            }

            if (results.length === 0) return `Nenhum contato encontrado para "${args.query}".`;

            let reply = `🔍 *Contatos encontrados:*\n\n`;
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                reply += `${i+1}. *${r.name}*\n`;
                reply += `   ID: \`${r.chat_id}\`\n`;
                reply += `   Tipo: ${r.chat_id_type === 'lid' ? '🔒 LID (conversa criptografada)' : '📞 Número de telefone'}\n`;
                if (r.phone_number) reply += `   Telefone: +${r.phone_number}\n`;
                reply += `\n`;
            }
            reply += `👉 Use o campo \`chat_id\` exatamente como mostrado para enviar mensagem com \`send_message_to_contact\`.`;
            return reply;

        } catch (e) {
            log("[AI Tool] search_whatsapp_contact error", e);
            return "Erro ao buscar contatos: " + e.message;
        }
    }

    // ============================================================
    // FIX 3 — send_message_to_contact resolve pelo cache internamente
    // ============================================================
    if (name === "send_message_to_contact") {
        const waWrapper = getWaClientWrapper(username);
        if (!waWrapper || waWrapper.status !== "connected") return "WhatsApp não conectado.";

        const query = (args.contact_query || args.chat_id || "").trim();
        if (!query) return "❌ Informe o nome, número ou chat_id do contato.";

        try {
            let resolvedChatId = null;

            const phoneQuery = query.replace(/\D/g, '');
            const hasPhoneDigits = phoneQuery.length >= 6;

            let cacheRow;
            if (hasPhoneDigits) {
                cacheRow = await db.prepare(
                    `SELECT contact_id FROM whatsapp_contacts
                     WHERE contact_id = ? OR phone_number = ?
                     OR name LIKE ? OR phone_number LIKE ?
                     ORDER BY
                       CASE WHEN contact_id LIKE '%@lid' THEN 0 ELSE 1 END,
                       last_seen DESC
                     LIMIT 1`
                ).get(query, phoneQuery, `%${query}%`, `%${phoneQuery}%`);
            } else {
                cacheRow = await db.prepare(
                    `SELECT contact_id FROM whatsapp_contacts
                     WHERE contact_id = ? OR name LIKE ?
                     ORDER BY
                       CASE WHEN contact_id LIKE '%@lid' THEN 0 ELSE 1 END,
                       last_seen DESC
                     LIMIT 1`
                ).get(query, `%${query}%`);
            }

            if (cacheRow) {
                resolvedChatId = cacheRow.contact_id;
                log(`[AI Tool] send_message_to_contact: resolvido via cache → ${resolvedChatId}`);
            }

            // 2) Se não achou no cache, faz varredura nos chats ao vivo
            if (!resolvedChatId) {
                log(`[AI Tool] send_message_to_contact: "${query}" não no cache, buscando em chats ao vivo`);
                const lowerQuery = query.toLowerCase();
                const chats = await waWrapper.client.getChats();
                for (const chat of chats) {
                    if (chat.isGroup) continue;
                    const chatId = chat.id._serialized;
                    const chatPhone = chatId.replace('@c.us', '').replace('@lid', '').replace(/\D/g, '');
                    const nameMatch = (chat.name || '').toLowerCase().includes(lowerQuery);
                    const phoneMatch = phoneQuery.length >= 8 && chatPhone.includes(phoneQuery);
                    const idMatch = chatId === query;
                    if (!nameMatch && !phoneMatch && !idMatch) continue;

                    let finalId = chatId;
                    const isLid = chatId.includes('@lid');
                    if (!isLid && chatPhone) {
                        try {
                            const numberId = await waWrapper.client.getNumberId(chatPhone);
                            if (numberId && numberId._serialized) {
                                finalId = numberId._serialized;
                            }
                        } catch (_) {}
                    }
                    const phoneToStore = chatPhone || null;
                    upsertContactCache(db, finalId, chat.name || chatId, phoneToStore);
                    if (!isLid && finalId.includes('@lid')) {
                        upsertContactCache(db, chatId, chat.name || chatId, phoneToStore);
                    }
                    resolvedChatId = finalId;
                    log(`[AI Tool] send_message_to_contact: resolvido via chat ao vivo → ${resolvedChatId}`);
                    break;
                }
            }

            // 3) Último recurso: tratar query como chat_id direto
            if (!resolvedChatId && query.includes('@')) {
                resolvedChatId = query;
                log(`[AI Tool] send_message_to_contact: usando query como chat_id direto → ${resolvedChatId}`);
            }

            if (!resolvedChatId) {
                return `❌ Contato "${query}" não encontrado no cache nem nos chats. Use search_whatsapp_contact para localizar o contato primeiro.`;
            }

            await safeSendMessage(waWrapper.client, resolvedChatId, args.message);
            return `✅ Mensagem enviada para ${resolvedChatId}.`;
        } catch (e) {
            return `❌ Erro ao enviar: ${e.message}`;
        }
    }

    // ============================================================
    // CORREÇÃO 6 — search_whatsapp_messages reescrita
    // ============================================================
    if (name === "search_whatsapp_messages") {
        const now = new Date();
        const brNow = new Date(now.getTime() - 3 * 3600 * 1000);
        const period = args.period || "hoje";
        const msgPerContact = Math.min(args.limit || 5, 10);
        const contactQ = (args.contact_query || "").trim();

        let fromTs = 0, toTs = Math.floor(brNow.getTime() / 1000);
        if (period === "hoje") {
            const s = new Date(brNow); s.setHours(0,0,0,0); fromTs = Math.floor(s.getTime() / 1000);
        } else if (period === "ontem") {
            const s = new Date(brNow); s.setDate(s.getDate()-1); s.setHours(0,0,0,0); fromTs = Math.floor(s.getTime()/1000);
            const e2 = new Date(s); e2.setHours(23,59,59,999); toTs = Math.floor(e2.getTime()/1000);
        } else if (period === "ultimas24h") {
            fromTs = Math.floor((brNow.getTime() - 86400000) / 1000);
        } else if (period === "semana") {
            fromTs = Math.floor((brNow.getTime() - 7 * 86400000) / 1000);
        } else if (period === "semana_passada") {
            const weekday = brNow.getDay();
            const diffToLastMon = (weekday === 0 ? 6 : weekday - 1) + 7;
            const lastMon = new Date(brNow); lastMon.setDate(brNow.getDate() - diffToLastMon); lastMon.setHours(0,0,0,0);
            const lastSun = new Date(lastMon); lastSun.setDate(lastMon.getDate() + 6); lastSun.setHours(23,59,59,999);
            fromTs = Math.floor(lastMon.getTime() / 1000);
            toTs   = Math.floor(lastSun.getTime() / 1000);
        } else if (period === "dias15") {
            fromTs = Math.floor((brNow.getTime() - 15 * 86400000) / 1000);
        }

        try {
            if (contactQ) {
                const contacts = await db.prepare(
                    "SELECT contact_id, name, phone_number FROM whatsapp_contacts WHERE name LIKE ? OR phone_number LIKE ?"
                ).all(`%${contactQ}%`, `%${contactQ.replace(/\D/g, '')}%`);

                if (!contacts || contacts.length === 0) {
                    return `Nenhum contato encontrado com nome ou número semelhante a "${contactQ}".`;
                }
                const chatIds = contacts.map(c => c.contact_id);
                const placeholders = chatIds.map(() => '?').join(',');
                const sql = `
                    SELECT m.chatId, m.body, m.timestamp, m.fromMe, COALESCE(m.contactName, c.name) as displayName
                    FROM whatsapp_messages m
                    LEFT JOIN whatsapp_contacts c ON m.chatId = c.contact_id
                    WHERE m.timestamp >= ? AND m.timestamp <= ? AND m.body != ''
                      AND m.chatId IN (${placeholders})
                    ORDER BY m.timestamp DESC
                    LIMIT ?
                `;
                const rows = await db.prepare(sql).all(fromTs, toTs, ...chatIds, msgPerContact);
                if (!rows || rows.length === 0) {
                    return `Nenhuma mensagem encontrada para "${contactQ}" no período solicitado.`;
                }
                const summary = rows.reverse().map(r => {
                    const t = new Date(r.timestamp * 1000).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
                    const who = r.fromMe ? "Você" : (r.displayName || r.chatId.replace("@c.us","").replace("@lid",""));
                    return `[${t}] ${who}: ${r.body.slice(0,150)}`;
                }).join("\n");
                return `Últimas ${rows.length} mensagens com "${contactQ}" (${period}):\n\n${summary}`;
            } else {
                const sqlContatos = `
                    SELECT
                        m.chatId,
                        COALESCE(m.contactName, c.name, REPLACE(REPLACE(m.chatId,'@c.us',''),'@lid','')) as displayName,
                        COUNT(*) as total,
                        MAX(m.timestamp) as lastTs
                    FROM whatsapp_messages m
                    LEFT JOIN whatsapp_contacts c ON m.chatId = c.contact_id
                    WHERE m.timestamp >= ? AND m.timestamp <= ?
                      AND m.fromMe = 0 AND m.body != ''
                    GROUP BY m.chatId
                    ORDER BY lastTs DESC
                    LIMIT 50
                `;
                const contatos = await db.prepare(sqlContatos).all(fromTs, toTs);
                if (!contatos || contatos.length === 0) {
                    return "Nenhuma mensagem recebida no período solicitado.";
                }

                const blocos = [];
                for (const ct of contatos) {
                    const msgs = (await db.prepare(
                        `SELECT body, timestamp FROM whatsapp_messages
                         WHERE chatId = ? AND fromMe = 0 AND body != ''
                           AND timestamp >= ? AND timestamp <= ?
                         ORDER BY timestamp DESC LIMIT 5`
                    ).all(ct.chatId, fromTs, toTs)).reverse();

                    const lastTime = new Date(ct.lastTs * 1000).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
                    const header = `📱 ${ct.displayName} — ${ct.total} msg(s) | última: ${lastTime}`;
                    const amostras = msgs.map(m => {
                        const t = new Date(m.timestamp * 1000).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
                        return `   [${t}] ${m.body.slice(0,120)}`;
                    }).join("\n");
                    blocos.push(`${header}\n${amostras}`);
                }
                const lines = blocos.join("\n\n");

                return `${contatos.length} contato(s) enviaram mensagens (${period}):\n\n${lines}`;
            }
        } catch (err) {
            return "Erro ao buscar mensagens: " + err.message;
        }
    }

    return "Ferramenta desconhecida.";
};

// --- HELPER: Retry Logic for 429 / 503 Errors ---
const runWithRetry = async (fn, retries = 5, delay = 2000) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            const msg = error.message || '';
            const status = error.status || 0;
            const isRetryable =
                status === 429 || msg.includes('429') ||
                status === 503 || msg.includes('503') ||
                msg.toLowerCase().includes('high demand') ||
                msg.toLowerCase().includes('overloaded') ||
                msg.toLowerCase().includes('overload');
            if (!isRetryable || i === retries - 1) throw error;
            const waitTime = delay * Math.pow(2, i);
            log(`[AI Retry] Tentativa ${i + 1}/${retries} — erro ${status || msg.slice(0,40)} — aguardando ${waitTime/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
};


// --- AI PROCESSOR ---
export const processAI = async (username, userMessage, mediaPart = null) => {
    const db = getDb(username);
    if (!db || !ai) return "Sistema de IA indisponível.";

    const greetingRegex = /^(oi|ola|olá|bom dia|boa tarde|boa noite|opa|eai|tudo bem|ajuda)\??$/i;
    if (!mediaPart && greetingRegex.test(userMessage.trim())) {
        return "Olá! Sou seu assistente. Posso consultar empresas, anotar tarefas, enviar mensagens e lembrar você de coisas. Como ajudo?";
    }

    const historyRows = await db.prepare("SELECT role, content FROM chat_history ORDER BY id DESC LIMIT 6").all();
    const history = historyRows.reverse().map(r => ({ role: r.role === 'user' ? 'user' : 'model', parts: [{ text: r.content }] }));

    const now = new Date();
    const currentTimeStr = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const currentISO = now.toISOString();

    const systemInstruction = `Você é o **Contábil Bot**, copiloto interno do escritório contábil de Lucas Araújo (CRC-BA 046968/O). Você NÃO é um atendente do cliente final — você é um assistente operacional interno.

DATA/HORA ATUAL: ${currentTimeStr} (ISO: ${currentISO}).
Use essa data para calcular vencimentos ou agendamentos relativos (ex: "daqui a 20 min" = somar 20 min ao ISO atual).

COMPORTAMENTO GERAL:
- Identifique o tipo de pedido: CONSULTA, RESUMO, AÇÃO, SUGESTÃO DE RESPOSTA, CLASSIFICAÇÃO, FOLLOW-UP, TRIAGEM ou COMANDO OPERACIONAL.
- Responda de forma objetiva, clara, profissional e operacional.
- Priorize: clareza, precisão, segurança, utilidade prática no contexto de escritório contábil.
- Para destacar, use **negrito** (dois asteriscos). NÃO use um único asterisco.

REGRA MAIS IMPORTANTE — NUNCA ADIVINHE:
- Se o pedido depende de dados do sistema que você ainda não tem, USE A TOOL CORRESPONDENTE para buscar. Não invente resultados.
- Se os dados já foram retornados pela tool, responda em linguagem natural útil.

REGRAS DE OURO:
1. **Tarefas:** Se pedir "todas" as tarefas, use 'consult_tasks' com status='todas'. Para concluir/mudar status, use 'update_task_status'.
2. **Envio para Empresa Cadastrada:** Se o usuário pedir para enviar mensagem para uma empresa cadastrada no sistema, use SEMPRE 'send_message_to_company'. NUNCA apenas sugira o texto.
3. **Envio para Contato da Conversa (pessoa/número não empresa):** Se o usuário citar um nome de pessoa ou número que pode ser da lista de conversas do WhatsApp, use 'send_message_to_contact' passando o nome ou número em 'contact_query'. A ferramenta resolve o contato internamente — NÃO é necessário chamar 'search_whatsapp_contact' antes. Use 'search_whatsapp_contact' apenas se quiser ver quais contatos existem antes de decidir para quem enviar.
4. **Envio por Número Direto:** Se o usuário fornecer um número explícito, use 'send_message_to_phone' diretamente.
5. **Lembretes Pessoais:** "me lembre de X", "lembrete em Y horas" → use 'set_personal_reminder'. Calcule o datetime ISO correto com base na hora atual do system prompt. O sistema envia automaticamente para o número configurado.
6. **Resumo de Mensagens WhatsApp:** "resuma mensagens de ontem", "o que fulano me enviou hoje?" → use 'search_whatsapp_messages' com o period e contact_query corretos.
7. **Memória:** Use 'manage_memory' para guardar informações duradouras ou buscar informações passadas.
8. **Tags Kanban:** Para criar tag use 'create_kanban_tag'. Para adicionar tag a contato use 'add_tag_to_contact'.
9. **Histórico de Envios:** "quantos documentos enviei", "últimos envios" → use 'consult_sent_history'.
10. **Saída:** Após usar tool de envio, confirme apenas o envio sem repetir o texto. Após lembretes, confirme data/hora calculada.

REGRA ABSOLUTA — WHATSAPP:
- NUNCA use tools de WhatsApp (search_whatsapp_messages, search_whatsapp_contact, send_message_to_contact, send_message_to_phone) a menos que o usuário EXPLICITAMENTE peça algo relacionado a mensagens ou envio pelo WhatsApp.
- Perguntas sobre empresas, tarefas, documentos, histórico de envios, cálculos ou qualquer outro assunto NÃO devem acionar nenhuma tool de WhatsApp.
- Exemplos que DEVEM acionar WhatsApp: "quem me mandou mensagem hoje?", "resuma o que João me enviou", "manda mensagem para o número X", "o que recebi ontem no WhatsApp".
- Exemplos que NÃO devem acionar WhatsApp: "quantas empresas tenho?", "crie uma tarefa", "qual o email da empresa X", "me ajude a redigir um texto".

SEGURANÇA:
- NUNCA execute automaticamente ações críticas sem confirmação explícita do usuário.
- NÃO recomende respostas automáticas livres para: cálculo de imposto, interpretação tributária, demissão, rescisão, admissão, multa, enquadramento fiscal, obrigações legais específicas.
- Você é um copiloto interno, não um chatbot de atendimento ao cliente.`;

    const currentParts = [];
    if (mediaPart) currentParts.push(mediaPart);
    if (userMessage) currentParts.push({ text: userMessage });

    try {
        const chat = ai.chats.create({ 
            model: "gemini-3-flash-preview", 
            config: {
                systemInstruction: systemInstruction,
                tools: [{ functionDeclarations: assistantTools }]
            },
            history: history
        });

        let response = await runWithRetry(() => chat.sendMessage({ message: currentParts }));
        let functionCalls = response.functionCalls;
        let loopCount = 0;

        while (functionCalls && functionCalls.length > 0 && loopCount < 5) {
            loopCount++;
            const call = functionCalls[0];
            const result = await executeTool(call.name, call.args, db, username);
            response = await runWithRetry(() => chat.sendMessage({
                message: [{ functionResponse: { name: call.name, response: { result: result } } }]
            }));
            functionCalls = response.functionCalls;
        }

        const finalText = response.text || "Comando processado.";
        await db.prepare("INSERT INTO chat_history (role, content, timestamp) VALUES (?, ?, ?)").run('user', userMessage, new Date().toISOString());
        await db.prepare("INSERT INTO chat_history (role, content, timestamp) VALUES (?, ?, ?)").run('model', finalText, new Date().toISOString());

        return finalText;

    } catch (e) {
        log("[AI Error]", e);
        if (e.message?.includes('404')) return "Erro: Modelo de IA não encontrado. Verifique as configurações do servidor.";
        if (e.message?.includes('429')) return "Muitas requisições à IA no momento. Aguarde alguns segundos e tente novamente.";
        if (e.status === 503 || e.message?.includes('503') || e.message?.toLowerCase().includes('high demand') || e.message?.toLowerCase().includes('overload'))
            return "O modelo de IA está sobrecarregado no momento. Aguarde alguns instantes e tente novamente.";
        return `Desculpe, ocorreu um erro interno. Tente novamente em instantes.`;
    }
};
