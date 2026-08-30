import { ImapFlow } from 'imapflow';
import fs from 'fs';
import path from 'path';

// Manual parsing of .env to ensure it works
let user = '';
let pass = '';

try {
  const envFile = fs.readFileSync(path.resolve('.env'), 'utf-8');
  const userMatch = envFile.match(/EMAIL_USER=(.*)/);
  const passMatch = envFile.match(/EMAIL_PASS=(.*)/);
  if (userMatch) user = userMatch[1].trim();
  if (passMatch) pass = passMatch[1].trim();
} catch (e) {
  console.log('No .env file found');
}

console.log('User:', user ? 'OK' : 'Missing', 'Pass:', pass ? 'OK' : 'Missing');

async function listMailboxes() {
    if (!user || !pass) return;
    const imap = new ImapFlow({
        host: 'imap.hostinger.com',
        port: 993,
        secure: true,
        auth: {
            user: user,
            pass: pass,
        },
        logger: false
    });

    try {
        await imap.connect();
        for await (const box of imap.list()) {
            console.log(box.name, '||', box.path, '||', JSON.stringify(box.specialUse));
        }
    } catch(e) {
        console.error("Connect error:", e);
    } finally {
        await imap.logout();
    }
}

listMailboxes();
