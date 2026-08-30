
import { Company, Task, TaskStatus, TaskPriority, Document, ScheduledMessage, UserSettings } from './types';

export const DOCUMENT_CATEGORIES = [
  'Simples Nacional', 'Honorários', 'Contracheque', 'FGTS', 'INSS', 
  'Folha de Pagamento', 'Rescisão', 'Férias', 'Notas Fiscais', 'Parcelamento', 'Outros'
];

export const MOCK_COMPANIES: Company[] = [];

export const MOCK_TASKS: Task[] = [];

export const MOCK_DOCUMENTS: Document[] = [];

export const MOCK_MESSAGES: ScheduledMessage[] = [];

export const DEFAULT_USER_SETTINGS: UserSettings = {
  emailSignature: `<p>Atenciosamente,</p>
        <div style="margin-top: 20px; padding-top: 10px; border-top: 1px solid #eee;">
            <strong>Lucas Araújo</strong><br>
            <span style="color: #555;">Contador | CRC-BA 046968/O</span><br>
            <strong>(75) 98120-0125</strong><br>
        </div>
    </body>
</html>`,
  whatsappTemplate: `_Esses arquivos também foram enviados por e-mail_

Atenciosamente,
Lucas Araújo`,
  visibleDocumentCategories: [
    'Simples Nacional', 
    'Folha de Pagamento', 
    'FGTS', 
    'INSS', 
    'Honorários',
    'Notas Fiscais'
  ],
  customCategories: [], // Nova lista vazia por padrão
  categoryKeywords: {
    // Atualizado com base nos PDFs reais
    'FGTS': ['fgts', 'gfd', 'fundo de garantia', 'guia do fgts', 'fgts digital'],
    'Folha de Pagamento': ['folha mensal', 'extrato mensal', 'folha de pagamento', 'resumo da folha', 'holerite'],
    'Parcelamento': ['parcelamento', 'parc'],
    'Simples Nacional': ['simples nacional', 'das', 'documento de arrecadacao'],
    'INSS': ['inss', 'cp segurados', 'cp descontada', 'previdencia social', 'gps', 'receita federal'],
    'Notas Fiscais': ['nota fiscal', 'danfe', 'nf-e', 'nfs-e'],
    'Honorários': ['honorarios', 'cora.com.br', 'boleto']
  },
  priorityCategories: [], 
  categoryRules: {
    'Simples Nacional': { day: 20, rule: 'postergado' },
    'FGTS': { day: 7, rule: 'antecipado' },
    'INSS': { day: 20, rule: 'antecipado' },
    'Honorários': { day: 10, rule: 'postergado' },
    'Folha de Pagamento': { day: 5, rule: 'quinto_dia_util' },
    'Contracheque': { day: 5, rule: 'quinto_dia_util' },
    'Parcelamento': { day: 0, rule: 'ultimo_dia_util' },
    'Notas Fiscais': { day: 1, rule: 'fixo' }, 
  },
  dailySummaryNumber: '',
  dailySummaryTime: '08:00',
  aiEnabled: true,
  companyCategories: [],
  waKanban: {
    columns: [
      { id: '1', title: 'Novos', color: '#3b82f6' },
      { id: '2', title: 'Atendimento', color: '#f59e0b' },
      { id: '3', title: 'Aguardando Cliente', color: '#ef4444' },
      { id: '4', title: 'Aguardando Terceiros', color: '#8b5cf6' },
      { id: '5', title: 'Finalizado', color: '#10b981' }
    ],
    tags: [
      { id: 't1', name: 'Suporte', color: '#ec4899' },
      { id: 't2', name: 'Financeiro', color: '#14b8a6' }
    ],
    cards: []
  }
};
