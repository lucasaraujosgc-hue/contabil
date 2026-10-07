// Captura o log INTERNO do WhatsApp Web e traz para o log do servidor.
//
// Por quê: quando o WhatsApp Web decide deslogar a sessão (ex.: falha de
// sincronização -> ?post_logout=1&logout_reason=1), ele registra o motivo exato
// no logger interno (WALogger) e NÃO no console. Sem isso um LOGOUT chega sem
// explicação. O gancho só observa: toda chamada segue para a função original.
//
// Como: todo log da página passa por WAWebLoggerImpl.Logger.logImpl(nível, msg,
// erro, ...). Embrulhamos esse método e espelhamos as linhas relevantes em
// console.debug com um marcador; o Puppeteer entrega o console ao Node.
//
// Privacidade: o nível 1 (DEV / DEV_XMPP) carrega o tráfego bruto, inclusive
// corpo de mensagens — NUNCA é encaminhado. Só nível 2 (LOG) filtrado por
// assunto, 3 (WARN) e 4 (ERROR).

export const WA_TAP_MARKER = '\u0001VCWA';

// Roda DENTRO da página (ou de um worker). Não pode referenciar nada de fora.
export function waLogTapInPage(marker) {
    try {
        const g = typeof globalThis !== 'undefined' ? globalThis : self;
        if (typeof g.require !== 'function') return 'sem-require';
        let L;
        try { L = g.require('WAWebLoggerImpl').Logger; } catch (e) { return 'sem-modulo'; }
        if (!L || typeof L.logImpl !== 'function') return 'sem-logger';
        if (L.__vcTap) return 'ja-instalado';

        const orig = L.logImpl;
        // Assuntos de nível LOG que valem o espaço do rastro: ciclo de vida da sessão
        // e sincronização. Termos amplos ("stream", "pair", "storage"...) ficam de
        // fora de propósito — numa sessão real gastariam o rastro em segundos. Avisos
        // e erros entram sempre, independentemente do assunto.
        const RE = /syncd|bootstrap|logout|logged out|logging out|fatal|critical|history.?sync|ws2|key.?share|missing key|takeover|conflict|unlink|revoke|\[lid\]|clearState|post_logout/i;
        // avisos de inicialização que se repetem às dezenas e não dizem nada
        const NOISE = /^\[abprops\] config accessed before init|^userPrefs: Me has not loaded yet/;
        const URLS = /https:\/\/static\.whatsapp\.net\/\S+/g;
        let winStart = Date.now();
        let used = 0;
        L.logImpl = function (level, msg, err) {
            try {
                if (level >= 3 || (level === 2 && RE.test(msg))) {
                    const text = String(msg);
                    if (!NOISE.test(text)) {
                        const now = Date.now();
                        if (now - winStart > 60000) { winStart = now; used = 0; }
                        // WARN/ERROR sempre; LOG com teto por minuto para não inundar
                        if (level >= 3 || used++ < 300) {
                            // só a mensagem: a stack (URLs gigantes dos bundles) não ajuda.
                            // Em ERRO mantém as 3 primeiras linhas, com as URLs encurtadas.
                            let line = text.split('\n').slice(0, level >= 4 ? 3 : 1).join(' | ').replace(URLS, '<wa.js>').slice(0, 700);
                            if (err && err.message && !line.includes(err.message)) line += ' | err=' + String(err.message).slice(0, 240);
                            console.debug(marker + level + '|' + line);
                        }
                    }
                }
            } catch (e) { /* o gancho nunca pode atrapalhar o WhatsApp */ }
            return orig.apply(this, arguments);
        };
        L.__vcTap = true;
        return 'instalado';
    } catch (e) {
        return 'erro:' + (e && e.message);
    }
}

const LEVEL = { 2: 'log', 3: 'warn', 4: 'ERRO' };

// Interpreta uma mensagem de console; devolve { level, text } se for do gancho.
export function parseWaTapLine(text) {
    if (typeof text !== 'string' || !text.startsWith(WA_TAP_MARKER)) return null;
    const level = Number(text.charAt(WA_TAP_MARKER.length));
    const body = text.slice(WA_TAP_MARKER.length + 2);
    return { level, label: LEVEL[level] || String(level), text: body };
}

// Espera o WhatsApp Web expor os módulos e instala o gancho na página.
export async function installWaLogTap(page, { timeoutMs = 90000 } = {}) {
    await page.waitForFunction(
        'typeof window.require === "function" && window.Debug && window.Debug.VERSION != undefined',
        { timeout: timeoutMs, polling: 500 },
    );
    return page.evaluate(waLogTapInPage, WA_TAP_MARKER);
}
