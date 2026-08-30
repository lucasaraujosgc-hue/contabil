import React, { useState, useRef } from 'react';
import {
  Save, User, Mail, MessageCircle, FileText, Check,
  LayoutTemplate, Link as LinkIcon, Plus, Trash, Clock,
  CalendarDays, Star, Tag, Smartphone, Send, Loader2,
  Building2, ShieldCheck, AlertCircle, Eye, EyeOff, Globe
} from 'lucide-react';
import { UserSettings, CategoryRule } from '../types';
import { DOCUMENT_CATEGORIES } from '../constants';
import { api } from '../services/api';

interface SettingsProps {
  settings: UserSettings;
  onSave: (newSettings: UserSettings) => void;
}

type TabId =
  | 'signatures'
  | 'categories'
  | 'documents'
  | 'bindings'
  | 'due_dates'
  | 'daily'
  | 'company_categories'
  | 'webhook'
  | 'serpro';

// ─── Tipos do formulário SERPRO ───────────────────────────────────────────────
interface SerproFormState {
  consumer_key: string;
  consumer_secret: string;
  cert_senha: string;
  cnpj_contratante: string;
  ambiente: 'trial' | 'producao';
  cert_file: File | null;
}

interface SerproServerStatus {
  configured: boolean;
  consumer_key?: string;
  cnpj_contratante?: string;
  ambiente?: string;
  cert_configurado?: boolean;
}

const Settings: React.FC<SettingsProps> = ({ settings, onSave }) => {
  const [activeTab, setActiveTab] = useState<TabId>('signatures');
  const [formData, setFormData] = useState<UserSettings>(settings);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [newCustomCategory, setNewCustomCategory] = useState('');
  const [newCompanyCategoryName, setNewCompanyCategoryName] = useState('');
  const [newCompanyCategoryColor, setNewCompanyCategoryColor] = useState('#3b82f6');
  const [loadingTest, setLoadingTest] = useState(false);

  // ── Estado da aba SERPRO ────────────────────────────────────────────────────
  const [serproForm, setSerproForm] = useState<SerproFormState>({
    consumer_key: '',
    consumer_secret: '',
    cert_senha: '',
    cnpj_contratante: '',
    ambiente: 'trial',
    cert_file: null,
  });
  const [showSecret, setShowSecret] = useState(false);
  const [showCertSenha, setShowCertSenha] = useState(false);
  const [savingSerp, setSavingSerp] = useState(false);
  const [serproStatus, setSerproStatus] = useState<SerproServerStatus | null>(null);
  const [loadingSerproStatus, setLoadingSerproStatus] = useState(false);
  const certInputRef = useRef<HTMLInputElement>(null);

  const allCategories = [...DOCUMENT_CATEGORIES, ...(formData.customCategories || [])];
  const [selectedCategoryForKeyword, setSelectedCategoryForKeyword] = useState(allCategories[0]);

  // ── Salvar configurações gerais ─────────────────────────────────────────────
  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.saveSettings(formData);
      onSave(formData);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar configurações no servidor.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Carregar status SERPRO ao entrar na aba ─────────────────────────────────
  const loadSerproStatus = async () => {
    setLoadingSerproStatus(true);
    try {
      const token = localStorage.getItem('cm_auth_token') || '';
      const res = await fetch('/api/pendencies/sitfis/config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setSerproStatus(data);
        if (data.configured) {
          setSerproForm((prev) => ({
            ...prev,
            consumer_key: data.consumer_key || '',
            cnpj_contratante: data.cnpj_contratante || '',
            ambiente: (data.ambiente as 'trial' | 'producao') || 'trial',
          }));
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSerproStatus(false);
    }
  };

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    if (tab === 'serpro' && serproStatus === null) {
      loadSerproStatus();
    }
  };

  // ── Salvar credenciais SERPRO ───────────────────────────────────────────────
  const handleSaveSerpro = async () => {
    if (!serproForm.consumer_key.trim()) {
      alert('Consumer Key é obrigatória.');
      return;
    }
    if (!serproForm.consumer_secret.trim()) {
      alert('Consumer Secret é obrigatório.');
      return;
    }
    if (!serproForm.cnpj_contratante.trim()) {
      alert('CNPJ do contratante é obrigatório.');
      return;
    }
    if (!serproStatus?.configured && !serproStatus?.cert_configurado && !serproForm.cert_file) {
      alert('Certificado digital (.pfx/.p12) é obrigatório no primeiro cadastro.');
      return;
    }

    setSavingSerp(true);
    try {
      const token = localStorage.getItem('cm_auth_token') || '';
      const fd = new FormData();
      fd.append('consumer_key', serproForm.consumer_key.trim());
      fd.append('consumer_secret', serproForm.consumer_secret);
      fd.append('cert_senha', serproForm.cert_senha);
      fd.append('cnpj_contratante', serproForm.cnpj_contratante.replace(/\D/g, ''));
      fd.append('ambiente', serproForm.ambiente);
      if (serproForm.cert_file) {
        fd.append('certificado', serproForm.cert_file);
      }

      const res = await fetch('/api/pendencies/sitfis/config', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();

      if (res.ok && data.success) {
        alert('Credenciais SERPRO salvas com sucesso!');
        // Limpa campos sensíveis e recarrega status
        setSerproForm((prev) => ({ ...prev, consumer_secret: '', cert_senha: '', cert_file: null }));
        if (certInputRef.current) certInputRef.current.value = '';
        await loadSerproStatus();
      } else {
        alert('Erro ao salvar: ' + (data.error || 'Desconhecido'));
      }
    } catch (e: any) {
      alert('Erro de conexão: ' + e.message);
    } finally {
      setSavingSerp(false);
    }
  };

  // ── Resto dos handlers existentes ───────────────────────────────────────────
  const toggleCategory = (category: string) => {
    setFormData((prev) => {
      const current = prev.visibleDocumentCategories;
      return {
        ...prev,
        visibleDocumentCategories: current.includes(category)
          ? current.filter((c) => c !== category)
          : [...current, category],
      };
    });
  };

  const togglePriority = (category: string) => {
    setFormData((prev) => {
      const currentPriorities = prev.priorityCategories || [];
      return {
        ...prev,
        priorityCategories: currentPriorities.includes(category)
          ? currentPriorities.filter((c) => c !== category)
          : [...currentPriorities, category],
      };
    });
  };

  const addKeyword = () => {
    if (!newKeyword.trim()) return;
    setFormData((prev) => ({
      ...prev,
      categoryKeywords: {
        ...prev.categoryKeywords,
        [selectedCategoryForKeyword]: [
          ...(prev.categoryKeywords[selectedCategoryForKeyword] || []),
          newKeyword.trim(),
        ],
      },
    }));
    setNewKeyword('');
  };

  const removeKeyword = (category: string, keywordToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      categoryKeywords: {
        ...prev.categoryKeywords,
        [category]: prev.categoryKeywords[category].filter((k) => k !== keywordToRemove),
      },
    }));
  };

  const addCustomCategory = () => {
    if (!newCustomCategory.trim()) return;
    if (allCategories.includes(newCustomCategory.trim())) { alert('Categoria já existe!'); return; }
    setFormData((prev) => ({ ...prev, customCategories: [...(prev.customCategories || []), newCustomCategory.trim()] }));
    setNewCustomCategory('');
  };

  const removeCustomCategory = (cat: string) => {
    if (confirm(`Excluir a categoria "${cat}"?`)) {
      setFormData((prev) => ({ ...prev, customCategories: (prev.customCategories || []).filter((c) => c !== cat) }));
    }
  };

  const addCompanyCategory = () => {
    if (!newCompanyCategoryName.trim()) return;
    setFormData((prev) => ({
      ...prev,
      companyCategories: [...(prev.companyCategories || []), {
        id: Date.now().toString(),
        name: newCompanyCategoryName.trim(),
        color: newCompanyCategoryColor,
      }],
    }));
    setNewCompanyCategoryName('');
  };

  const removeCompanyCategory = (catId: string) => {
    if (confirm(`Excluir esta categoria?`)) {
      setFormData((prev) => ({ ...prev, companyCategories: (prev.companyCategories || []).filter((c) => c.id !== catId) }));
    }
  };

  const updateRule = (category: string, field: keyof CategoryRule, value: any) => {
    setFormData((prev) => ({
      ...prev,
      categoryRules: {
        ...prev.categoryRules,
        [category]: { ...(prev.categoryRules[category] || { day: 1, rule: 'fixo' }), [field]: value },
      },
    }));
  };

  const handleTestDaily = async () => {
    if (!formData.dailySummaryNumber) { alert('Preencha um número de WhatsApp primeiro.'); return; }
    setLoadingTest(true);
    try {
      await api.saveSettings(formData);
      onSave(formData);
      await api.triggerDailySummary();
      alert('Disparo solicitado! Verifique seu WhatsApp.');
    } catch (e: any) {
      alert('Erro ao disparar resumo: ' + e.message);
    } finally {
      setLoadingTest(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  const tabBtn = (id: TabId, label: string, icon: React.ReactNode) => (
    <button
      onClick={() => handleTabChange(id)}
      className={`px-4 py-4 font-medium text-sm flex items-center gap-2 transition-colors border-b-2 whitespace-nowrap
        ${activeTab === id ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="space-y-6">
      {/* ── Topo ───────────────────────────────────────────────────────────── */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <User className="w-6 h-6 text-blue-600" /> Configurações do Usuário
          </h1>
          <p className="text-gray-500">Gerencie assinaturas, categorias e automações.</p>
        </div>
        {activeTab !== 'serpro' && (
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all disabled:opacity-70"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : saveSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {isSaving ? 'Salvando...' : saveSuccess ? 'Salvo!' : 'Salvar Alterações'}
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden min-h-[600px]">
        {/* Tabs */}
        <div className="flex border-b border-gray-200 overflow-x-auto">
          {tabBtn('signatures', 'Assinaturas', <Mail className="w-4 h-4" />)}
          {tabBtn('categories', 'Criar Categorias', <Tag className="w-4 h-4" />)}
          {tabBtn('documents', 'Colunas (Matriz)', <LayoutTemplate className="w-4 h-4" />)}
          {tabBtn('bindings', 'Vinculações', <LinkIcon className="w-4 h-4" />)}
          {tabBtn('due_dates', 'Vencimentos', <CalendarDays className="w-4 h-4" />)}
          {tabBtn('company_categories', 'Tags Empresas', <Building2 className="w-4 h-4" />)}
          {tabBtn('daily', 'Resumo Diário', <Clock className="w-4 h-4" />)}
          {tabBtn('webhook', 'Portal do Cliente', <Globe className="w-4 h-4" />)}
          {tabBtn('serpro', 'Integra Contador', <ShieldCheck className="w-4 h-4" />)}
        </div>

        <div className="p-6">

          {/* ── Assinaturas ──────────────────────────────────────────────────── */}
          {activeTab === 'signatures' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Mail className="w-4 h-4" /> Assinatura de E-mail (HTML)
                  </label>
                  <p className="text-xs text-gray-500">
                    Use <code>{`{mensagem_html}`}</code> onde o corpo do email deve ser inserido.
                  </p>
                  <textarea
                    className="w-full h-80 border border-gray-300 rounded-lg p-3 font-mono text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                    value={formData.emailSignature}
                    onChange={(e) => setFormData({ ...formData, emailSignature: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-700">Pré-visualização</label>
                  <div className="w-full h-80 border border-gray-200 rounded-lg p-4 overflow-y-auto bg-gray-50">
                    <div
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{
                        __html: formData.emailSignature.replace(
                          '{mensagem_html}',
                          '<p><em>[O conteúdo da mensagem será inserido aqui]</em></p>'
                        ),
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2 pt-6 border-t border-gray-100">
                <label className="block text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" /> Assinatura de Envio Normal (WhatsApp)
                </label>
                <p className="text-xs text-gray-500">
                  Este texto será adicionado automaticamente ao final das mensagens da aba Envio (envio normal).
                </p>
                <textarea
                  className="w-full h-32 border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-green-500 outline-none"
                  value={formData.whatsappTemplate}
                  onChange={(e) => setFormData({ ...formData, whatsappTemplate: e.target.value })}
                />
              </div>
              <div className="space-y-2 pt-6 border-t border-gray-100">
                <label className="block text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" /> Assinatura de Envio em Massa (WhatsApp)
                </label>
                <p className="text-xs text-gray-500">
                  Este texto será utilizado para mensagens da aba Envio em Massa e Tarefas Agendadas (Ex: "_Esses arquivos também foram enviados por e-mail_").
                </p>
                <textarea
                  className="w-full h-32 border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-green-500 outline-none"
                  value={formData.whatsappFileSignature || ''}
                  onChange={(e) => setFormData({ ...formData, whatsappFileSignature: e.target.value })}
                  placeholder="_Esses arquivos também foram enviados por e-mail_\n\nAtenciosamente,\nSeu Nome"
                />
              </div>
            </div>
          )}

          {/* ── Criar Categorias ─────────────────────────────────────────────── */}
          {activeTab === 'categories' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 max-w-2xl">
              <div className="mb-6">
                <h3 className="font-semibold text-gray-800">Gerenciar Categorias de Documentos</h3>
                <p className="text-sm text-gray-500">Crie novas categorias para organizar seus documentos.</p>
              </div>
              <div className="flex gap-2 mb-6">
                <input
                  type="text"
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Nome da nova categoria..."
                  value={newCustomCategory}
                  onChange={(e) => setNewCustomCategory(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCustomCategory()}
                />
                <button
                  onClick={addCustomCategory}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Adicionar
                </button>
              </div>
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-gray-700">Categorias Personalizadas</h4>
                {(!formData.customCategories || formData.customCategories.length === 0) && (
                  <p className="text-sm text-gray-400 italic">Nenhuma categoria criada.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {(formData.customCategories || []).map((cat) => (
                    <span key={cat} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm border border-blue-200 flex items-center gap-2">
                      {cat}
                      <button onClick={() => removeCustomCategory(cat)} className="hover:text-red-500">
                        <Trash className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Colunas (Matriz) ─────────────────────────────────────────────── */}
          {activeTab === 'documents' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="mb-6">
                <h3 className="font-semibold text-gray-800">Visualização da Matriz de Documentos</h3>
                <p className="text-sm text-gray-500">Selecione quais categorias devem aparecer como colunas na tabela.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {allCategories.map((category) => {
                  const isSelected = formData.visibleDocumentCategories.includes(category);
                  return (
                    <label
                      key={category}
                      className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                        ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                    >
                      <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors
                        ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-400'}`}>
                        {isSelected && <Check className="w-3 h-3" />}
                      </div>
                      <input type="checkbox" className="hidden" checked={isSelected} onChange={() => toggleCategory(category)} />
                      <span className={`font-medium ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>{category}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Vinculações ───────────────────────────────────────────────────── */}
          {activeTab === 'bindings' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
              <div className="mb-6">
                <h3 className="font-semibold text-gray-800">Palavras-chave e Prioridades</h3>
                <p className="text-sm text-gray-500">Configure as palavras-chave para identificar categorias.</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 flex flex-col md:flex-row gap-4 items-end mb-8">
                <div className="flex-1 w-full">
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Categoria Alvo</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none"
                    value={selectedCategoryForKeyword}
                    onChange={(e) => setSelectedCategoryForKeyword(e.target.value)}
                  >
                    {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex-[2] w-full">
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Adicionar Nova Palavra-chave</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none"
                    placeholder="Ex: extrato mensal, das, nota fiscal..."
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                  />
                </div>
                <button onClick={addKeyword} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Adicionar
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {allCategories.map((category) => {
                  const keywords = formData.categoryKeywords[category] || [];
                  const isPriority = (formData.priorityCategories || []).includes(category);
                  return (
                    <div key={category} className={`border rounded-lg overflow-hidden bg-white shadow-sm transition-all ${isPriority ? 'border-yellow-400 ring-1 ring-yellow-400' : 'border-gray-200'}`}>
                      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 font-bold text-gray-700 flex justify-between items-center">
                        <span>{category}</span>
                        <button onClick={() => togglePriority(category)} className={`p-1 rounded hover:bg-gray-200 transition-colors ${isPriority ? 'text-yellow-500' : 'text-gray-300'}`}>
                          <Star className={`w-5 h-5 ${isPriority ? 'fill-yellow-500' : ''}`} />
                        </button>
                      </div>
                      <div className="p-4">
                        <div className="bg-gray-50 rounded border border-gray-200 p-2 min-h-[80px] space-y-2">
                          {keywords.length === 0 ? (
                            <p className="text-xs text-gray-400 italic p-2">Nenhuma palavra-chave definida.</p>
                          ) : keywords.map((kw, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-white border border-gray-200 rounded px-2 py-1">
                              <span className="text-sm text-gray-700">{kw}</span>
                              <button onClick={() => removeKeyword(category, kw)} className="text-gray-400 hover:text-red-500 p-1">
                                <Trash className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Vencimentos ───────────────────────────────────────────────────── */}
          {activeTab === 'due_dates' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
              <div className="mb-6">
                <h3 className="font-semibold text-gray-800">Regras de Vencimento</h3>
                <p className="text-sm text-gray-500">Configure como o sistema calcula a data de vencimento para cada categoria.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {allCategories.map((category) => {
                  const rule = formData.categoryRules[category] || { day: 10, rule: 'fixo' };
                  return (
                    <div key={category} className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
                      <div className="bg-blue-50 px-4 py-3 border-b border-blue-100 font-bold text-blue-800 flex justify-between items-center">
                        <span>{category}</span>
                        <Clock className="w-4 h-4 text-blue-400" />
                      </div>
                      <div className="p-4 space-y-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Regra</label>
                          <select
                            className="w-full text-sm border border-gray-300 rounded px-2 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                            value={rule.rule}
                            onChange={(e) => updateRule(category, 'rule', e.target.value)}
                          >
                            <option value="fixo">Dia Fixo</option>
                            <option value="antecipado">Antecipar se Feriado/FDS</option>
                            <option value="postergado">Postergar se Feriado/FDS</option>
                            <option value="quinto_dia_util">Quinto Dia Útil</option>
                            <option value="ultimo_dia_util">Último Dia Útil</option>
                          </select>
                        </div>
                        {(rule.rule === 'fixo' || rule.rule === 'antecipado' || rule.rule === 'postergado') && (
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Dia do Vencimento</label>
                            <input
                              type="number" min="1" max="31"
                              className="w-full text-sm border border-gray-300 rounded px-2 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                              value={rule.day}
                              onChange={(e) => updateRule(category, 'day', parseInt(e.target.value))}
                            />
                          </div>
                        )}
                        <div className="bg-gray-50 p-2 rounded text-xs text-gray-500 border border-gray-100 min-h-[40px]">
                          {rule.rule === 'quinto_dia_util' && 'Vence no 5º dia útil do mês seguinte.'}
                          {rule.rule === 'ultimo_dia_util' && 'Vence no último dia útil do mês seguinte.'}
                          {rule.rule === 'antecipado' && `Vence dia ${rule.day}. Se cair em feriado/FDS, antecipa.`}
                          {rule.rule === 'postergado' && `Vence dia ${rule.day}. Se cair em feriado/FDS, posterga.`}
                          {rule.rule === 'fixo' && `Vence dia ${rule.day}, independente de ser útil.`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Tags Empresas ─────────────────────────────────────────────────── */}
          {activeTab === 'company_categories' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 max-w-2xl">
              <div className="mb-6">
                <h3 className="font-semibold text-gray-800">Categorias de Empresas</h3>
                <p className="text-sm text-gray-500">Crie tags para classificar suas empresas.</p>
              </div>
              <div className="flex gap-2 mb-6">
                <input
                  type="text"
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Nome da categoria..."
                  value={newCompanyCategoryName}
                  onChange={(e) => setNewCompanyCategoryName(e.target.value)}
                />
                <input
                  type="color"
                  className="w-12 h-[42px] border border-gray-300 rounded-lg p-1 outline-none bg-white cursor-pointer"
                  value={newCompanyCategoryColor}
                  onChange={(e) => setNewCompanyCategoryColor(e.target.value)}
                />
                <button onClick={addCompanyCategory} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Adicionar
                </button>
              </div>
              <div className="space-y-2 mt-6">
                {(!formData.companyCategories || formData.companyCategories.length === 0) && (
                  <p className="text-sm text-gray-400 italic">Nenhuma categoria de empresa criada.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {(formData.companyCategories || []).map((cat) => (
                    <span key={cat.id} className="px-3 py-1 text-white rounded-full text-sm flex items-center gap-2 shadow-sm" style={{ backgroundColor: cat.color }}>
                      {cat.name}
                      <button onClick={() => removeCompanyCategory(cat.id)} className="hover:opacity-75">
                        <Trash className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Resumo Diário ─────────────────────────────────────────────────── */}
          {activeTab === 'daily' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 max-w-2xl">
              <div className="mb-6">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-green-600" /> Resumo Diário de Tarefas (WhatsApp)
                </h3>
                <p className="text-sm text-gray-500">
                  Configure para receber um resumo automático das suas tarefas pendentes de Segunda a Sexta.
                </p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Número do WhatsApp (com DDD)</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ex: 75999999999"
                    value={formData.dailySummaryNumber || ''}
                    onChange={(e) => setFormData({ ...formData, dailySummaryNumber: e.target.value.replace(/\D/g, '') })}
                  />
                  <p className="text-xs text-gray-500 mt-1">Apenas números.</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Horário de Envio</label>
                  <input
                    type="time"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.dailySummaryTime || '08:00'}
                    onChange={(e) => setFormData({ ...formData, dailySummaryTime: e.target.value })}
                  />
                </div>
                <div className="bg-blue-50 p-4 rounded text-sm text-blue-800 border border-blue-100">
                  <strong>Como funciona:</strong> No horário definido, o sistema listará todas as tarefas <strong>Pendentes</strong> e <strong>Em Andamento</strong>.
                </div>
                <button
                  onClick={handleTestDaily}
                  disabled={loadingTest}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-3 rounded-lg hover:bg-green-700 shadow-lg shadow-green-500/20 font-medium transition-all disabled:opacity-70"
                >
                  {loadingTest ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  Disparar Resumo Agora (Teste)
                </button>
              </div>
            </div>
          )}

          {/* ── Webhook / Portal do Cliente ─────────────────────────────────────── */}
          {activeTab === 'webhook' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 max-w-2xl">
              <div className="mb-6">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                  <Globe className="w-5 h-5 text-purple-600" /> Portal do Cliente (Webhook)
                </h3>
                <p className="text-sm text-gray-500">
                  Integre com o Portal do Cliente de forma unificada. Enviaremos um POST automático toda vez que um documento manual for salvo ou quando um relatório SitFis for gerado pela IA.
                </p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">URL do Webhook (Endpoint)</label>
                  <input
                    type="url"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="https://sua-api.com/webhook/receber-documento"
                    value={formData.clientPortalWebhookUrl || ''}
                    onChange={(e) => setFormData({ ...formData, clientPortalWebhookUrl: e.target.value })}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Ao processar um relatório SitFis gerado via Integra Contador (Serpro), a categoria retornada será <strong>SITFIS_RECEITA</strong> e enviaremos as pendências (dados extraídos pela IA), em vez do PDF em base64.
                  </p>
                </div>
                <div className="bg-purple-50 p-4 rounded text-sm text-purple-800 border border-purple-100 font-mono text-xs overflow-x-auto whitespace-pre">
                    <strong>Payload Enviado:</strong><br/>
                    {`{
  "hash_empresa": "uuid-da-empresa", // Hash de vinculação
  "vencimento": "DD/MM/YYYY", // Vencimento (ou data atual para o SitFis)
  "competencia": "MM/YYYY", // Competência do documento ou SitFis
  "categoria": "SITFIS_RECEITA", // Ou a categoria do documento inserido
  "nome_arquivo": "sitfis_1_1234.pdf",
  // Se for documento comum:
  "arquivo_base64": "JVBERi0xLjQK...", // Base64 do PDF
  // Se for categoria SITFIS_RECEITA, enviamos as análises da IA:
  "dados_extraidos": [
      { "orgao": "RFB", "status": "PENDENTE", "descricao": "Ausência de Declaração..." }
  ]
}`}
                </div>
              </div>
            </div>
          )}

          {/* ── SERPRO / Integra Contador ─────────────────────────────────────── */}
          {activeTab === 'serpro' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 max-w-2xl">
              <div className="mb-6">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-indigo-600" /> Integra Contador SERPRO
                </h3>
                <p className="text-sm text-gray-500">
                  Configure as credenciais para consulta automática do Relatório de Situação Fiscal (SitFis) diretamente na Receita Federal.
                </p>
              </div>

              {/* Status atual */}
              {loadingSerproStatus ? (
                <div className="flex items-center gap-2 text-slate-500 mb-6">
                  <Loader2 className="w-4 h-4 animate-spin" /> Verificando configuração...
                </div>
              ) : serproStatus ? (
                <div className={`flex items-center gap-3 p-4 rounded-xl border mb-6 ${serproStatus.configured ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                  {serproStatus.configured
                    ? <Check className="w-5 h-5 text-emerald-600 shrink-0" />
                    : <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />}
                  <div>
                    <p className={`text-sm font-semibold ${serproStatus.configured ? 'text-emerald-800' : 'text-amber-800'}`}>
                      {serproStatus.configured ? '✓ Credenciais configuradas' : 'Credenciais não configuradas'}
                    </p>
                    {serproStatus.configured && (
                      <p className="text-xs text-emerald-700 mt-0.5">
                        Consumer Key: {serproStatus.consumer_key} · CNPJ: {serproStatus.cnpj_contratante} · Ambiente: {serproStatus.ambiente?.toUpperCase()} · Certificado: {serproStatus.cert_configurado ? '✓ OK' : '⚠ Ausente'}
                      </p>
                    )}
                  </div>
                </div>
              ) : null}

              {/* Formulário */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-5">

                {/* Ambiente */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <Globe className="w-4 h-4" /> Ambiente
                  </label>
                  <div className="flex gap-3">
                    {(['trial', 'producao'] as const).map((amb) => (
                      <label key={amb} className={`flex-1 flex items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-all ${serproForm.ambiente === amb ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                        <input type="radio" name="ambiente" value={amb} checked={serproForm.ambiente === amb} onChange={() => setSerproForm((prev) => ({ ...prev, ambiente: amb }))} className="hidden" />
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${serproForm.ambiente === amb ? 'border-indigo-500' : 'border-gray-300'}`}>
                          {serproForm.ambiente === amb && <div className="w-2 h-2 rounded-full bg-indigo-500" />}
                        </div>
                        <span className={`text-sm font-medium ${serproForm.ambiente === amb ? 'text-indigo-700' : 'text-gray-600'}`}>
                          {amb === 'trial' ? 'Trial (Testes)' : 'Produção'}
                        </span>
                      </label>
                    ))}
                  </div>
                  {serproForm.ambiente === 'trial' && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
                      No ambiente Trial, o token de acesso é fixo e não requer mTLS. Ideal para homologação.
                    </p>
                  )}
                </div>

                {/* Consumer Key */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Consumer Key (SERPRO)</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
                    placeholder="Chave pública do contrato"
                    value={serproForm.consumer_key}
                    onChange={(e) => setSerproForm((prev) => ({ ...prev, consumer_key: e.target.value }))}
                  />
                </div>

                {/* Consumer Secret */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Consumer Secret (SERPRO)</label>
                  <div className="relative">
                    <input
                      type={showSecret ? 'text' : 'password'}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
                      placeholder={serproStatus?.configured ? '••••••••• (deixe em branco para manter)' : 'Chave secreta do contrato'}
                      value={serproForm.consumer_secret}
                      onChange={(e) => setSerproForm((prev) => ({ ...prev, consumer_secret: e.target.value }))}
                    />
                    <button type="button" onClick={() => setShowSecret((s) => !s)} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Armazenado com criptografia AES-256. Nunca será exibido após salvar.</p>
                </div>

                {/* CNPJ Contratante */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">CNPJ do Escritório Contratante</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="00.000.000/0000-00"
                    value={serproForm.cnpj_contratante}
                    onChange={(e) => setSerproForm((prev) => ({ ...prev, cnpj_contratante: e.target.value }))}
                  />
                </div>

                {/* Certificado Digital */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Certificado Digital e-CNPJ (.pfx / .p12)</label>
                  <div className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${serproForm.cert_file ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50'}`}
                    onClick={() => certInputRef.current?.click()}>
                    <input
                      ref={certInputRef}
                      type="file"
                      accept=".pfx,.p12"
                      className="hidden"
                      onChange={(e) => setSerproForm((prev) => ({ ...prev, cert_file: e.target.files?.[0] || null }))}
                    />
                    {serproForm.cert_file ? (
                      <p className="text-sm text-indigo-700 font-medium">📎 {serproForm.cert_file.name}</p>
                    ) : serproStatus?.cert_configurado ? (
                      <p className="text-sm text-emerald-700">✓ Certificado configurado. Clique para substituir.</p>
                    ) : (
                      <p className="text-sm text-gray-500">Clique para selecionar o arquivo .pfx ou .p12</p>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Armazenado com permissões restritas no servidor (chmod 600).</p>
                </div>

                {/* Senha do Certificado */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Senha do Certificado</label>
                  <div className="relative">
                    <input
                      type={showCertSenha ? 'text' : 'password'}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder={serproStatus?.configured ? '••••••• (deixe em branco para manter)' : 'Senha do arquivo .pfx'}
                      value={serproForm.cert_senha}
                      onChange={(e) => setSerproForm((prev) => ({ ...prev, cert_senha: e.target.value }))}
                    />
                    <button type="button" onClick={() => setShowCertSenha((s) => !s)} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
                      {showCertSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Botão salvar */}
                <button
                  onClick={handleSaveSerpro}
                  disabled={savingSerp}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-3 rounded-lg hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 font-medium transition-all disabled:opacity-70"
                >
                  {savingSerp ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                  {savingSerp ? 'Salvando...' : 'Salvar Credenciais SERPRO'}
                </button>

                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800 space-y-1">
                  <p className="font-semibold">Referências SERPRO:</p>
                  <a href="https://cliente.serpro.gov.br" target="_blank" rel="noopener noreferrer" className="block hover:underline">• Área do Cliente SERPRO (obter chaves)</a>
                  <a href="https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/quick_start/" target="_blank" rel="noopener noreferrer" className="block hover:underline">• Documentação de autenticação</a>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default Settings;