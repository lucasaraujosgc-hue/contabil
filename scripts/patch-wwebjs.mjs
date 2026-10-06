// Aplica no whatsapp-web.js instalado correções do upstream que ainda não têm
// release no npm (a última, 1.34.7, é de abril/2026). Roda no postinstall.
// É idempotente e nunca derruba o install: se a lib mudar e um trecho não for
// encontrado, só avisa. Remova cada item quando atualizar a lib para uma versão
// que já traga a correção.
//
//  1. media-x-id  (upstream PR #201923, mergeada 28/09/2026)
//     Desde a atualização do WhatsApp Web de 17/09/2026 o MediaData espalhado no
//     Msg de saída traz um __x_id privado que colide com o id do Msg ->
//     "Data passed to getter must include an id property". Quebrava TODA mídia.
//
//  2. auth-polling (upstream PR #201942, aberta — issue #201940)
//     inject() espera o WhatsApp carregar com waitForFunction no modo padrão
//     (requestAnimationFrame). Em Chromium headless a página para de emitir
//     frames, a espera nunca resolve e estoura "Waiting failed: 30000ms
//     exceeded" quando o WhatsApp Web recarrega sozinho -> derrubava o processo.
//     Com polling por timer (200ms) a checagem roda mesmo sem frames.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = path.join(root, 'node_modules', 'whatsapp-web.js', 'src');

const PATCHES = [
    {
        name: 'media-x-id',
        file: path.join(lib, 'util', 'Injected', 'Utils.js'),
        done: (s) => s.includes('delete message.__x_id'),
        apply: (s) => {
            const anchor = "        // Bot's won't reply if canonicalUrl is set (linking)\n";
            if (!s.includes(anchor)) return null;
            return s.replace(anchor,
                '        // [patch-wwebjs] MediaData traz __x_id privado que colide com o id do Msg\n' +
                '        // (upstream PR #201923). Sem isso, mídia falha com "getter must include an id".\n' +
                '        if (message.__x_id) {\n' +
                '            delete message.__x_id;\n' +
                '        }\n' + anchor);
        },
    },
    {
        name: 'auth-polling',
        file: path.join(lib, 'Client.js'),
        done: (s) => s.includes('polling: 200'),
        apply: (s) => {
            const a = /(\.waitForFunction\('window\.Debug\?\.VERSION != undefined', \{\s*\n\s*timeout: authTimeout,)(\s*\n)/;
            const b = '{ timeout: authTimeout },\n            );\n            const needAuthentication';
            if (!a.test(s) || !s.includes(b)) return null;
            return s
                .replace(a, '$1\n                    polling: 200, // [patch-wwebjs] upstream PR #201942$2')
                .replace(b, '{ timeout: authTimeout, polling: 200 }, // [patch-wwebjs] upstream PR #201942\n            );\n            const needAuthentication');
        },
    },
];

for (const p of PATCHES) {
    try {
        if (!fs.existsSync(p.file)) { console.warn(`[patch-wwebjs] ${p.name}: whatsapp-web.js não encontrado.`); continue; }
        const src = fs.readFileSync(p.file, 'utf8').replace(/\r\n/g, '\n');
        if (p.done(src)) { console.log(`[patch-wwebjs] ${p.name}: já presente.`); continue; }
        const out = p.apply(src);
        if (!out) { console.warn(`[patch-wwebjs] ${p.name}: AVISO — trecho não encontrado; a lib mudou, confira manualmente.`); continue; }
        fs.writeFileSync(p.file, out);
        console.log(`[patch-wwebjs] ${p.name}: aplicado.`);
    } catch (e) {
        console.warn(`[patch-wwebjs] ${p.name}: falhou (${e.message}) — install segue.`);
    }
}
