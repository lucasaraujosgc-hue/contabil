import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Este arquivo vive em <root>/server/ — ROOT_DIR é a raiz do projeto (onde estão
// server.js, dist/, index.html). Mantido igual ao antigo `__dirname` do server.js.
const __filename = fileURLToPath(import.meta.url);
export const ROOT_DIR = path.join(path.dirname(__filename), '..');

export const PORT = process.env.PORT || 3000;

// Configuração de diretórios (idêntica ao server.js original)
export const DATA_DIR = process.env.DATA_PATH || path.join(ROOT_DIR, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const LOG_FILE = path.join(DATA_DIR, 'debug_whatsapp.log');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
