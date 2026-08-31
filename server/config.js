import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Este arquivo vive em <root>/server/ — ROOT_DIR é a raiz do projeto (onde estão
// server.js, dist/, index.html). Mantido igual ao antigo `__dirname` do server.js.
const __filename = fileURLToPath(import.meta.url);
export const ROOT_DIR = path.join(path.dirname(__filename), '..');

export const PORT = process.env.PORT || 3000;

// Conta única: o "tenant" (chave da sessão de WhatsApp) é o primeiro nome de USERS.
// Função (não const) para não depender da ordem de import vs. dotenv.
export const tenant = () => (process.env.USERS || 'admin').split(',')[0].trim();

// URL base pública, usada nos links de convite de colaborador (/definir-acesso).
// Prioridade: APP_BASE_URL do .env  >  cabeçalhos do request (atrás do proxy)  >  localhost.
export const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

export function appBaseUrl(req) {
    if (APP_BASE_URL) return APP_BASE_URL;
    if (req) {
        const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
        const host = (req.headers['x-forwarded-host'] || req.headers.host || (req.get && req.get('host')) || '').split(',')[0].trim();
        if (host) return `${proto}://${host}`;
    }
    return `http://localhost:${PORT}`;
}

// Segredo do JWT. Em produção é obrigatório; em dev cai num valor fixo (com aviso).
export const IS_PROD = process.env.NODE_ENV === 'production';
export const JWT_SECRET = process.env.JWT_SECRET
    || (IS_PROD ? '' : 'dev-only-insecure-secret-troque-em-producao');

// Configuração de diretórios (idêntica ao server.js original)
export const DATA_DIR = process.env.DATA_PATH || path.join(ROOT_DIR, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const LOG_FILE = path.join(DATA_DIR, 'debug_whatsapp.log');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
