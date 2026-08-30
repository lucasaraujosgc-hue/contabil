// --- AUTH MIDDLEWARE ---
// NOTA: idêntico ao server.js original nesta etapa (refactor puro).
// Será reescrito na Tarefa 2 (JWT assinado + colaboradores).
export const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const headerToken = authHeader && authHeader.split(' ')[1]; 
    const token = headerToken || req.query.token;
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    const parts = token.split('-');
    if (parts.length < 3) return res.status(403).json({ error: 'Token inválido' });
    const user = parts.slice(2).join('-'); 
    const envUsers = (process.env.USERS || '').split(',');
    if (!envUsers.includes(user)) return res.status(403).json({ error: 'Usuário não autorizado' });
    req.user = user;
    next();
};
