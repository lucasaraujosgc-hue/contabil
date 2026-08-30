import { log } from '../logger.js';

// --- Helpers Google Tasks / Calendar --- (extraído do server.js, sem alterações)
export const getGoogleAccessToken = async () => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
        throw new Error("Credenciais do Google ausentes no .env");
    }
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
            grant_type: 'refresh_token'
        })
    });
    const data = await response.json();
    if (!data.access_token) throw new Error("Falha ao obter access token: " + (data.error_description || data.error || JSON.stringify(data)));
    return data.access_token;
};

export const createGoogleTask = async (title, description, datetimeStr, subtasks = [], recurrenceText = null) => {
    try {
        let dt = datetimeStr;
        const isISO = dt && dt.includes('T');
        if (isISO && !dt.includes('Z') && !dt.includes('-0') && !dt.includes('-1') && !dt.includes('+')) {
            dt = dt + "-03:00"; 
        }

        const start = dt ? new Date(dt) : new Date();
        const finalStart = isNaN(start.getTime()) ? new Date() : start;

        const token = await getGoogleAccessToken();

        let finalNotes = description || '';
        if (recurrenceText && recurrenceText.trim() !== '') {
            finalNotes += finalNotes ? `\n\n🔄 Repetição: ${recurrenceText}` : `🔄 Repetição: ${recurrenceText}`;
        }

        const task = {
            title: title,
            notes: finalNotes,
            due: finalStart.toISOString() // O Google Tasks considera apenas a data (sem hora) mas requer formato RFC 3339
        };

        const response = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(task)
        });

        const data = await response.json();

        if (response.ok) {
            log(`[Tasks] Tarefa principal criada no Google Tasks: ${title}`);
            const parentId = data.id;

            if (subtasks && Array.isArray(subtasks) && subtasks.length > 0) {
                for (const sub of subtasks) {
                    const subTaskPayload = {
                        title: sub
                    };
                    try {
                        const subResponse = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?parent=${parentId}`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(subTaskPayload)
                        });
                        
                        if (subResponse.ok) {
                            log(`[Tasks] Subtarefa criada: ${sub}`);
                        } else {
                            const subData = await subResponse.json();
                            log(`[Tasks] Erro ao criar subtarefa (${sub}): ${JSON.stringify(subData)}`);
                        }
                    } catch(err) {
                        log(`[Tasks] Exceção ao criar subtarefa: ${err.message}`);
                    }
                }
            }
            return true;
        } else {
            log(`[Tasks] Erro retornado pela API do Google: ${JSON.stringify(data)}`);
            return false;
        }
    } catch (e) {
        log(`[Tasks] Erro ao integrar com Google Tasks: ${e.message}`);
        return false;
    }
};

export const createGoogleCalendarEvent = async (title, description, datetimeStr, recurrence = [], endDatetimeStr = null) => {
    try {
        let dt = datetimeStr;
        const isISO = dt && dt.includes('T');
        if (isISO && !dt.includes('Z') && !dt.includes('-0') && !dt.includes('-1') && !dt.includes('+')) {
            dt = dt + "-03:00"; 
        }

        const start = new Date(dt);
        const finalStart = isNaN(start.getTime()) ? new Date() : start;
        
        let end;
        if (endDatetimeStr) {
            let dtEnd = endDatetimeStr;
            if (dtEnd && dtEnd.includes('T') && !dtEnd.includes('Z') && !dtEnd.includes('-0') && !dtEnd.includes('-1') && !dtEnd.includes('+')) {
                dtEnd = dtEnd + "-03:00";
            }
            end = new Date(dtEnd);
            if (isNaN(end.getTime())) end = new Date(finalStart.getTime() + 60 * 60 * 1000);
        } else {
            end = new Date(finalStart.getTime() + 60 * 60 * 1000); // 1 hora de evento padrão
        }

        const token = await getGoogleAccessToken();

        const event = {
            summary: title,
            description: description || '',
            start: { dateTime: finalStart.toISOString(), timeZone: "America/Sao_Paulo" },
            end: { dateTime: end.toISOString(), timeZone: "America/Sao_Paulo" },
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 10 }
                ]
            }
        };

        if (recurrence && Array.isArray(recurrence) && recurrence.length > 0) {
            // Guarantee RRULE format
            event.recurrence = recurrence.map(r => r.startsWith('RRULE:') ? r : `RRULE:${r}`);
        }

        const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(event)
        });

        const data = await response.json();

        if (response.ok) {
            log(`[Calendar] Evento criado no Google Calendar: ${title}`);
            return true;
        } else {
            log(`[Calendar] Erro retornado pela API do Google: ${JSON.stringify(data)}`);
            return false;
        }
    } catch (e) {
        log(`[Calendar] Erro ao integrar com Google Calendar: ${e.message}`);
        return false;
    }
};
