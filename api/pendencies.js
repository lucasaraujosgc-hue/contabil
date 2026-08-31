import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import zlib from "zlib";
import https from "https";
import { getDb } from "../server/db/index.js";
import { ai } from "../server/services/aiService.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCO 1 — LÓGICA EXISTENTE (upload de PDF + análise por IA)
// ═══════════════════════════════════════════════════════════════════════════════

function fastParsePdfForNegativeCert(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    let pdfData = buffer.toString("binary");
    let text = "";

    let offset = 0;
    while (true) {
      const streamStart = pdfData.indexOf("stream", offset);
      if (streamStart === -1) break;
      const streamEnd = pdfData.indexOf("endstream", streamStart);
      if (streamEnd === -1) break;

      let streamDataStart = streamStart + 6;
      while (
        pdfData.charCodeAt(streamDataStart) === 10 ||
        pdfData.charCodeAt(streamDataStart) === 13
      ) streamDataStart++;

      let streamDataEnd = streamEnd;
      while (
        streamDataEnd > streamDataStart &&
        (pdfData.charCodeAt(streamDataEnd - 1) === 10 ||
          pdfData.charCodeAt(streamDataEnd - 1) === 13)
      ) streamDataEnd--;

      const streamBuffer = buffer.slice(streamDataStart, streamDataEnd);
      try {
        const unzipped = zlib.unzipSync(streamBuffer);
        text += unzipped.toString("utf8") + "\n";
      } catch (e) {
        text += streamBuffer.toString("utf8") + "\n";
      }
      offset = streamEnd + 9;
    }

    let extractedText = "";
    const regex = /\((.*?)\)/g;
    let match;
    while ((match = regex.exec(text)) !== null) extractedText += match[1] + " ";
    if (extractedText.length < 50) extractedText = text;

    const isNegative =
      extractedText.toUpperCase().includes("EFEITOS DE NEGATIVA") ||
      extractedText.toUpperCase().includes("CERTID\\303\\203O POSITIVA COM EFEITOS DE NEGATIVA") ||
      (extractedText.toUpperCase().includes("CERTID") &&
        extractedText.toUpperCase().includes("DA ATIVA") &&
        !extractedText.toUpperCase().includes("DIAGN"));

    const hasVSC = extractedText.toUpperCase().includes("VSC DISTRIB");

    if (isNegative || hasVSC) {
      let cnpjMatch = extractedText.match(/([0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2})/);
      let cnpj = cnpjMatch ? cnpjMatch[1] : "";
      if (!cnpj && hasVSC) cnpj = "48.171.544/0001-42";

      let nameMatch =
        extractedText.match(/Nome:\s*([^C\.]+)/i) ||
        extractedText.match(/Raz\\303\\243o\s*Social:\s*([^C\.]+)/i);
      let name = nameMatch
        ? nameMatch[1].trim()
        : hasVSC ? "VSC DISTRIBUIDORA DE BEBIDAS LTDA" : "Empresa com Certidão Negativa";
      name = name.replace(/\)/g, "").replace(/\(/g, "").replace(/\\/g, "").trim();

      return { cnpj, companyName: name, pendencies: [] };
    }
    return null;
  } catch (e) {
    console.error("Local parse fail", e);
    return null;
  }
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, process.env.DATA_PATH ? path.join(process.env.DATA_PATH, "uploads") : "data/uploads");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + "-" + file.originalname);
  },
});
const upload = multer({ storage });

const analyzePdfWithAI = async (filePath) => {
  if (!ai) throw new Error("AI (Gemini) não iniciada.");
  const fileContentBase64 = fs.readFileSync(filePath, { encoding: "base64" });
  const systemPrompt = `Você é um assistente super especializado em análise tributária brasileira.
Seu trabalho é extrair de um relatório da situação fiscal (Receita Federal, PGFN, SIEF, DCTFWeb, etc.) duas coisas principais:
1) O Nome ou Razão Social e CNPJ da empresa de quem o documento se refere.
2) Uma lista resumida e extremamente clara das pendências/débitos que estão marcados como "Devedor", "A ANALISAR", "Em Cobrança", "Exigibilidade Suspensa" ou "Omissão".
Retorne ESTRITAMENTE em formato JSON. Sem marcação markdown antes ou depois.
Formato JSON esperado:
{
  "cnpj": "XX.XXX.XXX/YYYY-ZZ",
  "companyName": "NOME DA EMPRESA LTDA",
  "pendencies": [
    { "type": "Débito Simples Nacional", "period": "10/2025", "value": "6.190,99" },
    { "type": "Omissão de DCTFWeb", "period": "2025 - JAN SET NOV DEZ", "value": "0,00" }
  ]
}
Se não houver débitos, pendencies deve ser [].`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ text: systemPrompt }, { inlineData: { mimeType: "application/pdf", data: fileContentBase64 } }],
  });

  let output = response.text.trim();
  if (output.startsWith("```json")) output = output.substring(7);
  else if (output.startsWith("```")) output = output.substring(3);
  if (output.endsWith("```")) output = output.substring(0, output.length - 3);
  return JSON.parse(output.trim());
};

// ── Rotas originais ───────────────────────────────────────────────────────────

router.post("/upload", upload.array("files"), async (req, res) => {
  try {
    const db = getDb(req.user);
    const { companyId } = req.body;
    const results = [];

    for (const file of req.files) {
      try {
        let extracted = fastParsePdfForNegativeCert(file.path);
        if (!extracted) extracted = await analyzePdfWithAI(file.path);

        let finalCompanyId = companyId || null;
        let finalCompanyName = extracted.companyName;

        if (!finalCompanyId && extracted.cnpj) {
          const docNumberClean = extracted.cnpj.replace(/\D/g, "");
          let comp = await db
            .prepare("SELECT id, name FROM companies WHERE replace(replace(replace(docNumber, '.', ''), '/', ''), '-', '') = ?")
            .get(docNumberClean);
          if (!comp) {
            const nameT = extracted.companyName.split(" ")[0];
            comp = await db.prepare("SELECT id, name FROM companies WHERE name LIKE ?").get(`%${nameT}%`);
          }
          if (comp) { finalCompanyId = comp.id; finalCompanyName = comp.name; }
        }

        if (finalCompanyId || extracted.pendencies.length > 0) {
          await db.prepare(`INSERT INTO company_pendencies (companyId, docNumber, companyName, filename, extractedData, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(finalCompanyId, extracted.cnpj, finalCompanyName, file.filename, JSON.stringify(extracted.pendencies), new Date().toISOString());
        }

        results.push({ file: file.originalname, status: "success", companyFound: !!finalCompanyId, data: extracted });
      } catch (errFile) {
        results.push({ file: file.originalname, status: "error", message: errFile.message });
      }
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/list", async (req, res) => {
  try {
    const db = getDb(req.user);
    const companies = await db.prepare("SELECT id, name, docNumber FROM companies ORDER BY name ASC").all();
    const pendenciesList = await db.prepare("SELECT * FROM company_pendencies ORDER BY id DESC").all();

    const mapped = companies.map((c) => {
      const lastPend = pendenciesList.find((p) => p.companyId === c.id);
      return {
        id: c.id, name: c.name, docNumber: c.docNumber,
        hasPendencies: !!lastPend,
        pendencies: lastPend ? JSON.parse(lastPend.extractedData) : [],
        lastUpdated: lastPend ? lastPend.created_at : null,
      };
    });

    const unmapped = pendenciesList
      .filter((p) => !p.companyId)
      .map((p) => ({
        id: "unmapped_" + p.id,
        name: p.companyName || "Empresa não identificada (" + p.docNumber + ")",
        hasPendencies: true,
        pendencies: JSON.parse(p.extractedData),
        lastUpdated: p.created_at,
        unmapped: true,
      }));

    res.json({ success: true, list: [...unmapped, ...mapped] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCO 2 — INTEGRA CONTADOR SERPRO (SitFis)
// Rotas em: /api/pendencies/sitfis/*
// ═══════════════════════════════════════════════════════════════════════════════

const SERPRO_AUTH_URL = "https://autenticacao.sapi.serpro.gov.br/authenticate";
const SERPRO_TRIAL_TOKEN = "06aef429-a981-3ec5-a1f8-71d38d86481e";
const SERPRO_URLS = {
  trial: {
    apoiar: "https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1/Apoiar",
    emitir: "https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1/Emitir",
  },
  producao: {
    apoiar: "https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Apoiar",
    emitir: "https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Emitir",
  },
};
const SITFIS_MAX_TENTATIVAS = 10;
const SITFIS_TIMEOUT_MS = 5 * 60 * 1000;

// ── Cache de tokens em memória ────────────────────────────────────────────────
const tokenCache = new Map();
function getCachedToken(usuarioId) {
  const c = tokenCache.get(usuarioId);
  if (!c || Date.now() >= c.expires_at) { tokenCache.delete(usuarioId); return null; }
  return c;
}

// ── Helper para requests HTTPS com mTLS ──────────────────────────────────────────
function httpsRequest(urlString, options, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const headers = options.headers || {};
    if (body) {
      headers["Content-Length"] = Buffer.byteLength(body, "utf8");
    }
    const opts = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: options.method || "GET",
      headers: headers,
      agent: options.agent,
    };

    const req = https.request(opts, (res) => {
      let data = [];
      res.on("data", (chunk) => data.push(chunk));
      res.on("end", () => {
        const bodyBuffer = Buffer.concat(data);
        const text = bodyBuffer.toString("utf8");
        const response = {
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: {
            get: (name) => {
              const val = res.headers[name.toLowerCase()];
              return Array.isArray(val) ? val[0] : val;
            }
          },
          text: async () => text,
          json: async () => text ? JSON.parse(text) : {},
        };
        resolve(response);
      });
    });

    req.on("error", (err) => reject(err));
    if (body) req.write(body);
    req.end();
  });
}

// ── Token de produção via OAuth2 + mTLS ───────────────────────────────────────
async function fetchProductionToken(config) {
  const certBuffer = fs.readFileSync(config.cert_path);
  const credentials = Buffer.from(`${config.consumer_key}:${config.consumer_secret}`).toString("base64");
  const agent = new https.Agent({ pfx: certBuffer, passphrase: config.cert_senha, rejectUnauthorized: true });

  const res = await httpsRequest(SERPRO_AUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "role-type": "TERCEIROS",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    agent,
  }, "grant_type=client_credentials");

  if (!res.ok) throw new Error(`Auth SERPRO falhou (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return {
    access_token: data.access_token,
    jwt_token: data.jwt_token || "",
    expires_at: Date.now() + (data.expires_in - 30) * 1000,
  };
}

async function getSerproToken(config) {
  if (config.ambiente === "trial") {
    return { access_token: SERPRO_TRIAL_TOKEN, jwt_token: "", expires_at: Date.now() + 86400000 };
  }
  const cached = getCachedToken(config.usuario_id);
  if (cached) return cached;
  const token = await fetchProductionToken(config);
  tokenCache.set(config.usuario_id, token);
  return token;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function serproPost(url, token, body, certAgent) {
  const headers = { 
    "Content-Type": "application/json", 
    "Accept": "application/json",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    Authorization: `Bearer ${token.access_token}` 
  };
  if (token.jwt_token) headers["jwt_token"] = token.jwt_token;
  return httpsRequest(url, {
    method: "POST",
    headers,
    agent: certAgent || undefined,
  }, JSON.stringify(body));
}

function buildSitfisPayload(config, cnpjCliente, idServico, dados = "") {
  const contratante = { numero: config.cnpj_contratante, tipo: 2 };
  return {
    contratante,
    autorPedidoDados: contratante,
    contribuinte: { numero: cnpjCliente.replace(/\D/g, ""), tipo: 2 },
    pedidoDados: { idSistema: "SITFIS", idServico, versaoSistema: "2.0", dados },
  };
}

function extractSerproData(text) {
  try {
    const root = JSON.parse(text);
    if (!root) return null;
    let dados = root.dados;
    if (typeof dados === "string") {
      try { dados = JSON.parse(dados); } catch(e) {}
    }
    if (Array.isArray(dados)) {
      if (dados.length > 0) return dados[0];
      return {};
    }
    if (typeof dados === "object" && dados !== null) {
      return dados;
    }
    return root; 
  } catch(e) {
    return null;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Fluxo principal ───────────────────────────────────────────────────────────
async function executarSitfis(db, config, clienteId, usuarioId, cnpjCliente) {
  const ins = await db.prepare(
    `INSERT INTO sitfis_consultas (cliente_id, usuario_id, status, tentativas, created_at) VALUES (?, ?, 'SOLICITADO', 0, datetime('now'))`
  ).run(clienteId, usuarioId);
  const consultaId = ins.lastInsertRowid;
  const log = (msg) => console.log(`[SitFis id=${consultaId}] ${msg}`);

  try {
    log("Obtendo token...");
    const token = await getSerproToken(config);

    let certAgent;
    if (config.ambiente === "producao") {
      const pfx = fs.readFileSync(config.cert_path);
      certAgent = new https.Agent({ pfx, passphrase: config.cert_senha, rejectUnauthorized: true });
    }

    const urls = SERPRO_URLS[config.ambiente];

    // Etapa 2 — protocolo
    log("Solicitando protocolo...");
    const apoiarRes = await serproPost(urls.apoiar, token, buildSitfisPayload(config, cnpjCliente, "SOLICITARPROTOCOLO91"), certAgent);
    let apoiarTexto = await apoiarRes.text();
    
    // Tratamento especial se SERPRO retornar 304
    if (apoiarRes.status === 304) {
      throw new Error(`SERPRO retornou 304 (Not Modified). Isso costuma ocorrer se o relatório exato foi solicitado há pouco tempo. O relatório não é regerado dentro de 24h.`);
    }

    if (!apoiarRes.ok) throw new Error(`SERPRO Apoiar ${apoiarRes.status} (len: ${apoiarTexto.length}): ${apoiarTexto}`);
    
    let protocolo = null;
    let tempoEspera = 5000;
    
    const apoiarData = extractSerproData(apoiarTexto);
    if (apoiarData) {
      if (apoiarData.protocoloRelatorio) protocolo = apoiarData.protocoloRelatorio;
      if (apoiarData.tempoEspera) tempoEspera = apoiarData.tempoEspera;
    }
    
    if (!protocolo) throw new Error(`SERPRO não retornou protocoloRelatorio válido. Resposta: ${apoiarTexto}`);
    await db.prepare(`UPDATE sitfis_consultas SET protocolo = ?, status = 'PROCESSANDO' WHERE id = ?`).run(protocolo, consultaId);

    // Etapa 3 — emitir com polling
    log("Emitindo relatório...");
    const emitirPayload = buildSitfisPayload(config, cnpjCliente, "RELATORIOSITFIS92", JSON.stringify({ protocoloRelatorio: protocolo }));
    const deadline = Date.now() + SITFIS_TIMEOUT_MS;
    let tentativa = 0;
    let pdfBase64 = null;

    while (tentativa < SITFIS_MAX_TENTATIVAS && Date.now() < deadline) {
      tentativa++;
      await db.prepare(`UPDATE sitfis_consultas SET tentativas = ? WHERE id = ?`).run(tentativa, consultaId);
      log(`Tentativa ${tentativa}...`);

      const emitirRes = await serproPost(urls.emitir, token, emitirPayload, certAgent);
      let emitirTexto = await emitirRes.text();

      if (emitirRes.status === 200) {
        const emitirData = extractSerproData(emitirTexto);
        if (emitirData && emitirData.pdf) {
          pdfBase64 = emitirData.pdf;
        } else {
          pdfBase64 = emitirTexto; // Fallback extremo
        }
        
        if (!pdfBase64 || pdfBase64 === emitirTexto) {
          log(`Status 200 recebido, mas PDF não encontrado. Analisando estrutura...`);
        }
        break;
      } else if (emitirRes.status === 202) {
        let waitTime = 5000;
        const emitirData = extractSerproData(emitirTexto);
        if (emitirData && emitirData.tempoEspera) waitTime = emitirData.tempoEspera;
        await sleep(waitTime);
      } else if (emitirRes.status === 204) {
        const retryAfter = emitirRes.headers.get("Retry-After");
        await sleep(retryAfter ? parseInt(retryAfter) * 1000 : 5000);
      } else {
        throw new Error(`SERPRO Emitir ${emitirRes.status}: ${await emitirRes.text()}`);
      }
    }

    if (!pdfBase64) throw new Error("Timeout: consulta excedeu 5 minutos. Tente novamente.");

    // Salva PDF
    const pdfDir = process.env.DATA_PATH ? path.join(process.env.DATA_PATH, "sitfis_pdfs") : "data/sitfis_pdfs";
    fs.mkdirSync(pdfDir, { recursive: true });
    const pdfFilename = `sitfis_${clienteId}_${consultaId}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);
    fs.writeFileSync(pdfPath, Buffer.from(pdfBase64, "base64"));
    await db.prepare(`UPDATE sitfis_consultas SET status = 'CONCLUIDO', pdf_path = ?, concluido_at = datetime('now') WHERE id = ?`).run(pdfPath, consultaId);

    let pendenciesData = null;
    log("Iniciando análise por IA automática do PDF baixado do SERPRO...");
    try {
       let extracted = fastParsePdfForNegativeCert(pdfPath);
       if (!extracted) extracted = await analyzePdfWithAI(pdfPath);
       
       pendenciesData = extracted.pendencies;

       const finalCompanyName = extracted.companyName || config.cnpj_contratante;
       await db.prepare(`INSERT INTO company_pendencies (companyId, docNumber, companyName, filename, extractedData, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
         .run(clienteId, extracted.cnpj || cnpjCliente, finalCompanyName, pdfFilename, JSON.stringify(extracted.pendencies), new Date().toISOString());
       log("Análise do PDF automática concluída com sucesso.");
    } catch(e) {
       log("Erro na análise automática do SitFis: " + e.message);
    }
    
    // Notifica via Webhook do Portal do Cliente
    try {
        const settingsRow = await db.prepare("SELECT settings FROM user_settings WHERE id = 1").get();
        if (settingsRow) {
            const settings = JSON.parse(settingsRow.settings);
            if (settings.clientPortalWebhookUrl) {
                const companyRow = await db.prepare("SELECT companyHash FROM companies WHERE id = ?").get(clienteId);
                if (companyRow && companyRow.companyHash) {
                    const todayDate = new Date().toISOString().split('T')[0]; // Data de hoje como vencimento genérico
                    
                    const now = new Date();
                    const compMonth = String(now.getMonth() + 1).padStart(2, '0');
                    const compYear = now.getFullYear();
                    const competenciaAtual = `${compMonth}/${compYear}`;

                    const payload = {
                        hash_empresa: companyRow.companyHash,
                        vencimento: todayDate,
                        competencia: competenciaAtual,
                        categoria: 'SITFIS_RECEITA',
                        nome_arquivo: pdfFilename,
                        dados_extraidos: pendenciesData
                    };
                    
                    fetch(settings.clientPortalWebhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    }).then(r => {
                        if (!r.ok) log(`Webhook SitFis POST falhou com status ${r.status}`);
                        else log("Webhook SitFis notificado para hash " + companyRow.companyHash);
                    }).catch(e => log("Webhook SitFis falhou: " + e.message));
                }
            }
        }
    } catch(err) {
        log("Erro ao tentar enviar Webhook do SitFis: " + err.message);
    }

    log("Concluído.");

    return { status: "CONCLUIDO", pdfBase64, consultaId };

  } catch (err) {
    const msg = err.message || String(err);
    await db.prepare(`UPDATE sitfis_consultas SET status = 'ERRO', erro_msg = ? WHERE id = ?`).run(msg, consultaId);
    console.error(`[SitFis id=${consultaId}] ERRO: ${msg}`);

    if (msg.includes("401")) return { status: "ERRO", codigo: "AUTH", mensagem: "Erro de autenticação com SERPRO. Verifique as credenciais.", consultaId };
    if (msg.includes("403")) return { status: "ERRO", codigo: "FORBIDDEN", mensagem: "Contribuinte não autorizado ou contrato SERPRO inativo.", consultaId };
    if (msg.includes("Timeout") || msg.includes("excedeu")) return { status: "ERRO", codigo: "TIMEOUT", mensagem: "A consulta excedeu o tempo limite. Tente novamente.", consultaId };
    if (msg.includes("cert") || msg.includes("pfx") || msg.includes("passphrase")) return { status: "ERRO", codigo: "CERT", mensagem: "Certificado digital inválido. Verifique o arquivo e a senha.", consultaId };
    return { status: "ERRO", codigo: "DESCONHECIDO", mensagem: msg, consultaId };
  }
}

// ── Multer para certificado ───────────────────────────────────────────────────
const certStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dest = process.env.DATA_PATH ? path.join(process.env.DATA_PATH, "certs") : "data/certs";
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (_req, file, cb) => cb(null, `cert_${Date.now()}_${file.originalname}`),
});
const uploadCert = multer({
  storage: certStorage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".pfx" || ext === ".p12") cb(null, true);
    else cb(new Error("Apenas arquivos .pfx ou .p12 são aceitos."));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ── Rotas SitFis ──────────────────────────────────────────────────────────────

// GET /api/pendencies/sitfis/config
router.get("/sitfis/config", async (req, res) => {
  try {
    const db = getDb(req.user);
    const cfg = await db.prepare("SELECT * FROM serpro_config WHERE usuario_id = ?").get(1);
    if (!cfg || !cfg.consumer_key) return res.json({ success: true, configured: false });
    res.json({
      success: true,
      configured: true,
      consumer_key: cfg.consumer_key,
      cnpj_contratante: cfg.cnpj_contratante,
      ambiente: cfg.ambiente,
      cert_configurado: !!(cfg.cert_path && fs.existsSync(cfg.cert_path)),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pendencies/sitfis/config
router.post("/sitfis/config", uploadCert.single("certificado"), async (req, res) => {
  try {
    if (!req.agent?.isEnvAdmin) return res.status(403).json({ error: "Somente o administrador pode configurar o Integra Contador." });
    const db = getDb(req.user);
    const usuarioId = 1;
    const { consumer_key, consumer_secret, cert_senha, cnpj_contratante, ambiente } = req.body;

    if (!consumer_key || !consumer_secret || !cnpj_contratante) {
      return res.status(400).json({ error: "consumer_key, consumer_secret e cnpj_contratante são obrigatórios." });
    }

    // Certificado: novo upload ou mantém o existente
    let certPath = "";
    if (req.file) {
      certPath = req.file.path;
    } else {
      const existing = await db.prepare("SELECT cert_path FROM serpro_config WHERE usuario_id = ?").get(usuarioId);
      certPath = existing?.cert_path ?? "";
    }

    if (!certPath && ambiente !== "trial") {
      return res.status(400).json({ error: "Certificado (.pfx/.p12) é obrigatório para ambiente de produção." });
    }

    // Senha: nova ou mantém a existente
    let senhaFinal = cert_senha || "";
    if (!senhaFinal) {
      const existing = await db.prepare("SELECT cert_senha FROM serpro_config WHERE usuario_id = ?").get(usuarioId);
      senhaFinal = existing?.cert_senha ?? "";
    }

    const cnpjLimpo = cnpj_contratante.replace(/\D/g, "");
    const ambienteFinal = ambiente || "trial";

    const existing = await db.prepare("SELECT id FROM serpro_config WHERE usuario_id = ?").get(usuarioId);
    if (existing) {
      await db.prepare(`UPDATE serpro_config SET consumer_key=?, consumer_secret=?, cert_path=?, cert_senha=?, cnpj_contratante=?, ambiente=?, updated_at=datetime('now') WHERE usuario_id=?`)
        .run(consumer_key, consumer_secret, certPath, senhaFinal, cnpjLimpo, ambienteFinal, usuarioId);
    } else {
      await db.prepare(`INSERT INTO serpro_config (usuario_id, consumer_key, consumer_secret, cert_path, cert_senha, cnpj_contratante, ambiente) VALUES (?,?,?,?,?,?,?)`)
        .run(usuarioId, consumer_key, consumer_secret, certPath, senhaFinal, cnpjLimpo, ambienteFinal);
    }

    tokenCache.delete(usuarioId);
    console.log(`[AUDIT] Usuário ${usuarioId} atualizou credenciais SERPRO em ${new Date().toISOString()}`);
    res.json({ success: true, message: "Credenciais SERPRO salvas com sucesso." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/pendencies/sitfis/:clienteId
router.post("/sitfis/:clienteId", async (req, res) => {
  try {
    const db = getDb(req.user);
    const usuarioId = 1;
    const clienteId = parseInt(req.params.clienteId, 10);
    if (isNaN(clienteId)) return res.status(400).json({ error: "clienteId inválido." });

    const config = await db.prepare("SELECT * FROM serpro_config WHERE usuario_id = ?").get(usuarioId);
    if (!config || !config.consumer_key) {
      return res.status(400).json({ error: "Credenciais SERPRO não configuradas. Acesse Configurações → Integra Contador." });
    }

    const cliente = await db.prepare("SELECT id, name, docNumber FROM companies WHERE id = ?").get(clienteId);
    if (!cliente) return res.status(404).json({ error: "Cliente não encontrado." });

    const cnpjCliente = cliente.docNumber?.replace(/\D/g, "");
    if (!cnpjCliente) return res.status(400).json({ error: "Cliente não possui CNPJ cadastrado." });

    console.log(`[AUDIT] Usuário ${usuarioId} consultou SitFis cliente ${clienteId} em ${new Date().toISOString()}`);
    const resultado = await executarSitfis(db, config, clienteId, usuarioId, cnpjCliente);
    res.json(resultado);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/pendencies/sitfis/:clienteId/historico
router.get("/sitfis/:clienteId/historico", async (req, res) => {
  try {
    const db = getDb(req.user);
    const clienteId = parseInt(req.params.clienteId, 10);
    const historico = await db.prepare(
      `SELECT id, status, tentativas, created_at, concluido_at, erro_msg, pdf_path FROM sitfis_consultas WHERE cliente_id = ? ORDER BY id DESC LIMIT 10`
    ).all(clienteId);
    res.json({ success: true, historico });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/pendencies/sitfis/:clienteId/pdf/:consultaId
router.get("/sitfis/:clienteId/pdf/:consultaId", async (req, res) => {
  try {
    const db = getDb(req.user);
    const usuarioId = 1;
    const consultaId = parseInt(req.params.consultaId, 10);

    const consulta = await db.prepare(
      `SELECT pdf_path, usuario_id FROM sitfis_consultas WHERE id = ? AND status = 'CONCLUIDO'`
    ).get(consultaId);

    if (!consulta) return res.status(404).json({ error: "Consulta não encontrada ou ainda em processamento." });
    if (consulta.usuario_id !== usuarioId) return res.status(403).json({ error: "Acesso negado." });
    if (!fs.existsSync(consulta.pdf_path)) return res.status(404).json({ error: "PDF não encontrado no servidor." });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="sitfis_${req.params.clienteId}_${consultaId}.pdf"`);
    fs.createReadStream(consulta.pdf_path).pipe(res);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;