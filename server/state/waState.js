// --- MULTI-TENANCY: WhatsApp shared state ---
// Estado mutável compartilhado entre whatsappService, rotas /api/whatsapp/* e o cron.
// Precisa viver num módulo único para não haver duplicação de instância.
export const waClients = {};

export const broadcastWaEvent = (username, eventType, data) => {
    if (waClients[username] && waClients[username].sseClients) {
        waClients[username].sseClients.forEach(res => {
            try {
                res.write(`data: ${JSON.stringify({ type: eventType, payload: data })}\n\n`);
            } catch (e) {}
        });
    }
};
