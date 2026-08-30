
import { CategoryRule } from "../types";

// Fixed holidays list (Day-Month)
// (1, 1) -> "01-01"
const FIXED_HOLIDAYS = [
  '01-01', // Ano Novo
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra
  '12-25'  // Natal
];

// Feriados móveis (Exemplo para 2024 e 2025 - ideal seria calcular via API ou lógica de Páscoa, mas hardcoded é seguro para MVP)
const MOBILE_HOLIDAYS = [
    '2024-02-12', '2024-02-13', // Carnaval 2024
    '2024-03-29', // Paixão de Cristo 2024
    '2024-05-30', // Corpus Christi 2024
    '2025-03-03', '2025-03-04', // Carnaval 2025
    '2025-04-18', // Paixão de Cristo 2025
    '2025-06-19', // Corpus Christi 2025
];

export const formatarData = (date: Date): string => {
  const dia = String(date.getDate()).padStart(2, '0');
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const ano = date.getFullYear();
  return `${dia}/${mes}/${ano}`;
};

export const isDiaUtil = (date: Date): boolean => {
  const diaSemana = date.getDay(); // 0=Sunday, 6=Saturday
  
  if (diaSemana === 0 || diaSemana === 6) {
    return false;
  }
  
  // Verifica feriados fixos
  const diaMes = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (FIXED_HOLIDAYS.includes(diaMes)) {
    return false;
  }

  // Verifica feriados móveis (formato YYYY-MM-DD)
  const yyyyMmDd = date.toISOString().split('T')[0];
  if (MOBILE_HOLIDAYS.includes(yyyyMmDd)) {
      return false;
  }
  
  return true;
};

// Helper to get next month year/month pair
const getNextMonth = (mes: number, ano: number): { mes: number, ano: number } => {
  // mes input is expected to be 1-12
  if (mes === 12) {
    return { mes: 1, ano: ano + 1 };
  }
  return { mes: mes + 1, ano: ano };
};

export const calcularQuintoDiaUtil = (mes: number, ano: number): string => {
  const next = getNextMonth(mes, ano);
  
  let dia = 1;
  let diasUteisEncontrados = 0;
  // new Date(ano, mesIndex, dia) -> mesIndex 0 based
  let finalDate = new Date(next.ano, next.mes - 1, 1);
  
  // Loop until we find the 5th business day
  while (diasUteisEncontrados < 5) {
      const date = new Date(next.ano, next.mes - 1, dia);
      
      // Safety check to prevent infinite loop if month overflows (unlikely)
      if (date.getMonth() !== (next.mes - 1)) break; 

      if (isDiaUtil(date)) {
          diasUteisEncontrados++;
          finalDate = date;
      }
      
      if (diasUteisEncontrados < 5) {
          dia++;
      }
  }
  
  return formatarData(finalDate);
};

export const calcularVencimentoComRegra = (mes: number, ano: number, diaVencimento: number, regra: 'antecipado' | 'postergado' | 'fixo'): string => {
  const next = getNextMonth(mes, ano);
  
  // Create date object for the target due day (mes - 1 because Date uses 0-11)
  let date = new Date(next.ano, next.mes - 1, diaVencimento);
  
  // Validar se a data é válida (ex: 30 de fevereiro não existe, vira março)
  // Caso ocorra overflow, voltamos para o último dia do mês correto
  if (date.getMonth() !== (next.mes - 1)) {
     date = new Date(next.ano, next.mes, 0); // Último dia do mês correto
  }

  if (regra === 'fixo') return formatarData(date);

  if (!isDiaUtil(date)) {
      if (regra === 'antecipado') {
          // Move backward until business day found
          while (!isDiaUtil(date)) {
              date.setDate(date.getDate() - 1);
          }
      } else if (regra === 'postergado') {
          // Move forward until business day found
          while (!isDiaUtil(date)) {
              date.setDate(date.getDate() + 1);
          }
      }
  }
  
  return formatarData(date);
};

export const calcularUltimoDiaUtil = (mes: number, ano: number): string => {
  const next = getNextMonth(mes, ano);
  
  // Get the last day of the *next* month
  const ultimoDiaDoMes = new Date(next.ano, next.mes, 0).getDate();
  
  let date = new Date(next.ano, next.mes - 1, ultimoDiaDoMes);
  
  while (!isDiaUtil(date)) {
      date.setDate(date.getDate() - 1);
  }
  
  return formatarData(date);
};

export const calcularTodosVencimentos = (competencia: string, categoryRules: Record<string, CategoryRule>): Record<string, string> => {
  if (!competencia || !competencia.includes('/')) return {};
  
  const [mesStr, anoStr] = competencia.split('/');
  const mes = parseInt(mesStr);
  const ano = parseInt(anoStr);

  if (isNaN(mes) || isNaN(ano)) return {};

  const vencimentos: Record<string, string> = {};

  // Default hardcoded logic if no rules provided (Fallback)
  if (!categoryRules || Object.keys(categoryRules).length === 0) {
      // Fallback (Legacy)
      return {
          'Contracheque': calcularQuintoDiaUtil(mes, ano),
          'Folha de Pagamento': calcularQuintoDiaUtil(mes, ano), 
          'FGTS': calcularVencimentoComRegra(mes, ano, 7, 'antecipado'),
          'INSS': calcularVencimentoComRegra(mes, ano, 20, 'antecipado'),
          'Simples Nacional': calcularVencimentoComRegra(mes, ano, 20, 'postergado'),
          'Parcelamento': calcularUltimoDiaUtil(mes, ano),
          'Honorários': calcularVencimentoComRegra(mes, ano, 10, 'postergado'), 
      };
  }

  // Dynamic Logic based on User Settings
  for (const [category, config] of Object.entries(categoryRules)) {
      try {
          if (config.rule === 'quinto_dia_util') {
              vencimentos[category] = calcularQuintoDiaUtil(mes, ano);
          } else if (config.rule === 'ultimo_dia_util') {
              vencimentos[category] = calcularUltimoDiaUtil(mes, ano);
          } else {
              // antecipado, postergado, fixo
              vencimentos[category] = calcularVencimentoComRegra(mes, ano, config.day, config.rule);
          }
      } catch (e) {
          console.error(`Erro calculando data para ${category}`, e);
          vencimentos[category] = '';
      }
  }

  return vencimentos;
};
