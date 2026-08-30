import express from 'express';
import { getWaClientWrapper } from '../services/whatsappService.js';
const router = express.Router();

router.post('/login', (req, res) => {
    const { user, password } = req.body;
    const envUsers = (process.env.USERS || 'admin').split(',');
    const envPasss = (process.env.PASSWORDS || 'admin').split(',');
    const userIndex = envUsers.indexOf(user);

    if (userIndex !== -1 && envPasss[userIndex] === password) {
        getWaClientWrapper(user);
        res.json({ success: true, token: `session-${Date.now()}-${user}` });
    } else {
        res.status(401).json({ error: 'Credenciais inválidas' });
    }
});

export default router;
