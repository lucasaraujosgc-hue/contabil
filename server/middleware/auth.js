import jwt from 'jsonwebtoken';
import { JWT_SECRET, tenant, IS_PROD } from '../config.js';
import { getDb } from '../db/index.js';
import { getAgentById, sanitizeAgent, can } from '../services/agents.js';

const TOKEN_TTL = '12h';

export function assertAuthConfigured() {
    if (!JWT_SECRET) {
        throw new Error('JWT_SECRET não definido — obrigatório em produção. Gere um e coloque no .env.');
    }
    if (!IS_PROD && JWT_SECRET.startsWith('dev-only-')) {
        // aviso leve; segue em dev
        console.warn('[AUTH] usando JWT_SECRET de desenvolvimento — defina JWT_SECRET no .env para produção.');
    }
}

export function signToken(agent) {
    return jwt.sign(
        { sub: agent.id, username: agent.username, role: agent.role, tv: agent.token_version },
        JWT_SECRET,
        { expiresIn: TOKEN_TTL },
    );
}

// --- AUTH MIDDLEWARE (JWT assinado + checagem de token_version a cada request) ---
export async function authenticateToken(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        // Header é o padrão; ?token= fica só para o EventSource de /api/whatsapp/events,
        // que não consegue enviar headers. Nos dois casos é um JWT assinado.
        const token = (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null) || req.query.token;
        if (!token) return res.status(401).json({ error: 'Token não fornecido' });

        let payload;
        try {
            payload = jwt.verify(token, JWT_SECRET);
        } catch (e) {
            return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
        }

        const db = getDb();
        const agent = await getAgentById(db, payload.sub);
        if (!agent || agent.status === 'revoked') {
            return res.status(403).json({ error: 'Acesso revogado.' });
        }
        if (agent.status !== 'active') {
            return res.status(403).json({ error: 'Conta não ativada.' });
        }
        if (Number(payload.tv) !== Number(agent.token_version)) {
            return res.status(401).json({ error: 'Sessão encerrada. Faça login novamente.' });
        }

        req.agent = sanitizeAgent(agent);
        req.agentRaw = agent;
        req.user = tenant(); // chave da sessão de WhatsApp + compat com getDb(req.user)/getWaClientWrapper(req.user)
        next();
    } catch (err) {
        return res.status(500).json({ error: 'Erro de autenticação' });
    }
}

export function requireAdmin(req, res, next) {
    if (!req.agent || req.agent.role !== 'admin') {
        return res.status(403).json({ error: 'Somente o administrador pode fazer isso.' });
    }
    next();
}

// requirePermission('companies', 'edit') -> 403 se o agente não puder
export function requirePermission(tab, action = 'view') {
    return (req, res, next) => {
        if (can(req.agent, tab, action)) return next();
        return res.status(403).json({ error: `Sem permissão para ${action} em ${tab}.` });
    };
}
