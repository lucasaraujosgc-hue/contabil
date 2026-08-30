
import { Company } from '../types';
import * as pdfjsLib from 'pdfjs-dist';

// Configuração segura e isolada do Worker
const setupPdfWorker = () => {
    try {
        if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
            // Usamos a versão que já está no import map ou uma CDN segura
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
    } catch (e) {
        console.error("Erro ao configurar Worker do PDF.js:", e);
    }
};

/**
 * Normaliza o texto: remove acentos, converte para minúsculo e limpa espaços extras.
 */
export const removeAccents = (text: string): string => {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
};

/**
 * Verifica se uma palavra-chave existe no texto.
 * Para palavras curtas (<= 3 chars), exige que seja uma "palavra inteira" (bordas).
 * Ex: "das" não dá match em "vendas".
 */
const containsKeyword = (text: string, keyword: string): boolean => {
  if (!keyword || keyword.length < 2) return false;
  
  // Para palavras curtas, usa Regex para garantir limites de palavra
  if (keyword.length <= 3) {
    // Escapa caracteres especiais se houver (embora keywords costumem ser simples)
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // (^|[^a-z0-9]) garante que antes da palavra ou é o inicio da string ou um char não-alfanumérico
    // ([^a-z0-9]|$) garante que depois da palavra ou é fim da string ou um char não-alfanumérico
    const regex = new RegExp(`(^|[^a-z0-9])${escapedKeyword}([^a-z0-9]|$)`, 'i');
    return regex.test(text);
  }
  
  // Para palavras longas, o includes é mais performático e seguro o suficiente
  return text.includes(keyword);
};

/**
 * Extrai texto de um PDF de forma robusta.
 */
export const extractTextFromPDF = async (file: File): Promise<string> => {
  setupPdfWorker(); // Garante que o worker está pronto apenas na hora do uso
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
      cMapPacked: true,
      verbosity: 0
    });

    const pdf = await loadingTask.promise;
    let fullText = '';
    const maxPages = Math.min(pdf.numPages, 5); // Lê no máximo 5 páginas para performance

    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ')
        .trim();
      fullText += pageText + ' ';
    }

    return fullText.trim(); 
  } catch (error) {
    console.error(`❌ Erro ao extrair texto do PDF: ${file.name}`, error);
    return '';
  }
};

/**
 * Identifica a categoria baseada em um sistema de pontuação e pesos.
 * Obedece estritamente as configurações de prioridade do usuário.
 */
export const identifyCategory = (
    textNormalized: string, 
    keywordMap: Record<string, string[]> = {}, 
    priorityCategories: string[] = []
): string | null => {
  
  if (!textNormalized || !keywordMap) return null;
  const scores: Record<string, number> = {};

  // Itera sobre todas as categorias configuradas
  for (const [category, keywords] of Object.entries(keywordMap)) {
    if (!keywords || !Array.isArray(keywords)) continue;
    
    let categoryScore = 0;
    let matchCount = 0;
    
    for (const keyword of keywords) {
      if (!keyword) continue;
      const kwNormalized = removeAccents(keyword);
      
      if (containsKeyword(textNormalized, kwNormalized)) {
        // Pontuação baseada no tamanho da palavra-chave (keywords maiores são mais específicas)
        // Ex: "simples nacional" (16 chars * 2 = 32pts) vale mais que "das" (3 chars * 2 = 6pts)
        categoryScore += (kwNormalized.length * 2);
        matchCount++;
      }
    }

    if (categoryScore > 0) {
      // BÔNUS DE PRIORIDADE: Se a categoria é prioritária e teve match, ganha bônus massivo
      if (priorityCategories && priorityCategories.includes(category)) {
        categoryScore += 1000;
      }
      scores[category] = categoryScore;
    }
  }

  // Ordena as categorias por pontuação (maior para menor)
  const sortedCategories = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  // Retorna a categoria vencedora ou null
  if (sortedCategories.length > 0) {
    return sortedCategories[0][0];
  }

  return null;
};

/**
 * Identifica a empresa usando match numérico (CNPJ/CPF) ou nome inteligente.
 */
export const identifyCompany = (textNormalized: string, companies: Company[] = []): Company | null => {
  if (!textNormalized || !companies) return null;

  // Estratégia 1: Busca por Documento (CNPJ/CPF) - Alta precisão
  const textOnlyNumbers = textNormalized.replace(/\D/g, '');

  for (const company of companies) {
    const companyDocClean = (company.docNumber || '').replace(/\D/g, '');
    if (companyDocClean.length < 5) continue;

    // Verifica se o CNPJ/CPF da empresa existe no texto (ou pelo menos os 8 primeiros dígitos do CNPJ base)
    if (textOnlyNumbers.includes(companyDocClean) || 
       (companyDocClean.length >= 8 && textOnlyNumbers.includes(companyDocClean.substring(0, 8)))) {
        return company;
    }
  }

  // Estratégia 2: Busca por Nome - Menor precisão, baseada em pontuação
  const commonTerms = ['ltda', 's.a', 'me', 'epp', 'eireli', 'limitada', 'sa', 'cnpj', 'cpf'];
  let bestMatch: Company | null = null;
  let maxNameScore = 0;

  for (const company of companies) {
    // Limpa o nome da empresa removendo termos comuns para evitar falso positivo em "LTDA"
    let nameClean = removeAccents(company.name || '');
    commonTerms.forEach(term => {
        nameClean = nameClean.replace(new RegExp(`\\b${term}\\b`, 'g'), '').trim();
    });

    if (nameClean.length < 3) continue;

    if (textNormalized.includes(nameClean)) {
      const score = nameClean.length;
      if (score > maxNameScore) {
        maxNameScore = score;
        bestMatch = company;
      }
    }
  }

  return bestMatch;
};
