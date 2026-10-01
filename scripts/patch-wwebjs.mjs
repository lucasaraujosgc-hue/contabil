// Aplica no whatsapp-web.js instalado a correção do upstream para o envio de
// mídia (wwebjs/whatsapp-web.js PR #201923, mergeada em 28/09/2026, ainda sem
// release no npm). Desde a atualização do WhatsApp Web de 17/09/2026, o
// MediaData espalhado no Msg de saída traz um campo privado __x_id que colide
// com o id do Msg -> "Data passed to getter must include an id property".
//
// Roda no postinstall. É idempotente e nunca derruba o install: se a lib mudar
// e o trecho não for encontrado, só avisa. Remova quando atualizar o
// whatsapp-web.js para uma versão que já traga a correção.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');

const ANCHOR = "        // Bot's won't reply if canonicalUrl is set (linking)\n";
const FIX =
    '        // [patch-wwebjs] MediaData traz __x_id privado que colide com o id do Msg\n' +
    '        // (upstream PR #201923). Sem isso, mídia falha com "getter must include an id".\n' +
    '        if (message.__x_id) {\n' +
    '            delete message.__x_id;\n' +
    '        }\n';

try {
    if (!fs.existsSync(file)) {
        console.warn('[patch-wwebjs] whatsapp-web.js não encontrado — nada a fazer.');
        process.exit(0);
    }
    const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (src.includes('delete message.__x_id')) {
        console.log('[patch-wwebjs] correção de mídia já presente.');
        process.exit(0);
    }
    const idx = src.indexOf(ANCHOR);
    if (idx === -1) {
        console.warn('[patch-wwebjs] AVISO: trecho não encontrado — a lib mudou; confira se o envio de mídia funciona.');
        process.exit(0);
    }
    fs.writeFileSync(file, src.slice(0, idx) + FIX + src.slice(idx));
    console.log('[patch-wwebjs] correção de envio de mídia aplicada.');
} catch (e) {
    console.warn(`[patch-wwebjs] falhou (${e.message}) — install segue.`);
}
