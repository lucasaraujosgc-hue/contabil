import fs from 'fs';
import { LOG_FILE } from './config.js';

// --- SYSTEM: Logger --- (extraído do server.js, comportamento inalterado)
export const log = (message, error = null) => {
    const timestamp = new Date().toISOString();
    let errorDetail = '';

    if (error) {
        errorDetail = `\nERROR: ${error.message}`;
        if (error.stack) errorDetail += `\nSTACK: ${error.stack}`;
    }

    const logMessage = `[${timestamp}] ${message}${errorDetail}\n`;
    console.log(`[APP] ${message}`);
    if (error) console.error(error);

    try {
        fs.appendFileSync(LOG_FILE, logMessage);
    } catch (e) {
        console.error("Falha crítica ao escrever no arquivo de log:", e);
    }
};
