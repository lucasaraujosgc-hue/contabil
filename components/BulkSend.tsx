
import React, { useState, useEffect } from 'react';
import { Mail, MessageCircle, Calendar, Send, CheckSquare, Square, ArrowLeft, Loader2, Upload, X, Search, Filter } from 'lucide-react';
import { Company, ScheduledMessage, UserSettings } from '../types';
import { api } from '../services/api';

interface BulkSendProps {
  userSettings?: UserSettings;
}

const BulkSend: React.FC<BulkSendProps> = ({ userSettings }) => {
  const [schedule, setSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedCompanies, setSelectedCompanies] = useState<number[]>([]);

  // Form Data
  const [subject, setSubject] = useState('Comunicado Importante');
  const [message, setMessage] = useState(`Prezados,\n\nGostaríamos de informar que...\n\nAtenciosamente,\nEquipe Contábil`);
  const [channels, setChannels] = useState({ email: true, whatsapp: false });
  const [attachment, setAttachment] = useState<File | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    api.getCompanies()
        .then(data => {
            setCompanies(data);
            const defaultTypeIds = data.map(c => c.id);
            setSelectedCompanies(defaultTypeIds);
        })
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
  }, []);

  const filteredCompanies = companies.filter(company => {
    const searchLower = searchTerm.toLowerCase();
    const nameMatch = (company.name || '').toLowerCase().includes(searchLower);
    const docMatch = (company.docNumber || '').includes(searchLower);
    const emailMatch = (company.email || '').toLowerCase().includes(searchLower);
    const matchesSearch = nameMatch || docMatch || emailMatch;

    const matchesTag = tagFilter ? (company.categories || []).includes(tagFilter) : true;

    return matchesSearch && matchesTag;
  });

  const toggleSelectAll = () => {
      const filteredIds = filteredCompanies.map(c => c.id);
      const allSelected = filteredIds.every(id => selectedCompanies.includes(id));
      
      if (allSelected) {
          setSelectedCompanies(prev => prev.filter(id => !filteredIds.includes(id)));
      } else {
          const newSelection = [...new Set([...selectedCompanies, ...filteredIds])];
          setSelectedCompanies(newSelection);
      }
  };

  const toggleCompany = (id: number) => {
      if (selectedCompanies.includes(id)) {
          setSelectedCompanies(prev => prev.filter(cid => cid !== id));
      } else {
          setSelectedCompanies(prev => [...prev, id]);
      }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          setAttachment(e.target.files[0]);
      }
  };
  
  const handleProcess = async () => {
      if (selectedCompanies.length === 0) {
          alert("Selecione pelo menos uma empresa.");
          return;
      }

      setSending(true);

      try {
          // 1. Upload File first if exists
          let attachmentData = null;
          if (attachment) {
              attachmentData = await api.uploadFile(attachment);
          }

          if (schedule) {
              // --- SCHEDULE LOGIC ---
              if (!scheduleDate) { alert("Informe a data para agendamento."); setSending(false); return; }
              
              const payload: Partial<ScheduledMessage> = {
                  title: subject,
                  message: message,
                  nextRun: scheduleDate,
                  recurrence: 'unico', // Bulk send usually one-off
                  active: true,
                  type: 'message',
                  targetType: 'selected',
                  channels: channels,
                  selectedCompanyIds: selectedCompanies,
                  attachmentFilename: attachmentData?.filename,
                  attachmentOriginalName: attachmentData?.originalName
              };

              await api.saveScheduledMessage(payload);
              alert("Envio agendado com sucesso!");

          } else {
              // --- SEND NOW LOGIC ---
              // Reuse sendDocuments API by constructing a document list where everyone gets the same attachment
              // If no attachment, sendDocuments might complain or we send empty docs array but valid message body
              
              // Se não tiver anexo, criamos um "documento fantasma" só para a API iterar sobre as empresas
              // Ou ajustamos a API. A API sendDocuments espera lista de documentos.
              // Estratégia: Criar um objeto de documento para cada empresa selecionada apontando para o arquivo anexado.
              
              const documentsPayload = selectedCompanies.map(companyId => {
                  const company = companies.find(c => c.id === companyId);
                  return {
                      companyId: companyId,
                      companyName: company?.name || 'Unknown',
                      serverFilename: attachmentData?.filename || '', // Empty implies text-only potentially
                      docName: attachmentData?.originalName || 'Mensagem Geral',
                      category: 'Comunicado',
                      competence: new Date().toLocaleDateString('pt-BR', {month: '2-digit', year:'numeric'}),
                      dueDate: ''
                  };
              });

              // Filtra se não tiver anexo, enviamos lista vazia de docs, mas com messageBody
              // A API sendDocuments foi feita para iterar sobre docs. Se docs vazio, ela não envia nada.
              // Workaround: Mandar um doc fictício se não tiver anexo é arriscado.
              // Ideal: Se tem anexo, manda docs. Se não tem, a API precisa suportar.
              // Minha API server.js: Se validAttachments.length == 0 e companyDocs.length > 0, continua.
              // Então se não tiver arquivo, não vai enviar.
              // FIX: Se não tem arquivo, o front não deve chamar sendDocuments da forma atual se quiser só mandar texto.
              // Mas o usuário pediu "fazer upload de arquivo". Assumindo que o arquivo é opcional,
              // vamos permitir, mas a API server.js precisa ser capaz de enviar só texto.
              // Ajustei server.js para permitir envio sem anexo (código anterior já tinha lógica para anexos, mas o loop depende de companyDocs).
              
              await api.sendDocuments({
                  documents: documentsPayload,
                  subject: subject,
                  messageBody: message,
                  channels: channels,
                  emailSignature: userSettings?.emailSignature,
                  whatsappTemplate: userSettings?.whatsappTemplate,
                  whatsappFileSignature: userSettings?.whatsappFileSignature,
                  isBulk: true,
              });

              alert("Envio em massa processado!");
          }
          
          // Reset
          setAttachment(null);
          setSubject("");
          
      } catch (e: any) {
          console.error(e);
          alert("Erro ao processar envio: " + e.message);
      } finally {
          setSending(false);
      }
  };

  const areAllFilteredSelected = filteredCompanies.length > 0 && filteredCompanies.every(c => selectedCompanies.includes(c.id));

  if (loading) return <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;

  return (
    <div className="space-y-6">
       <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Send className="w-6 h-6 text-blue-600" /> Envio em Massa
        </h1>
        <p className="text-gray-500">Envie comunicados ou documentos para múltiplas empresas.</p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Assunto do E-mail</label>
                  <input 
                    type="text" 
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" 
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
              </div>
              <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Opções de Envio</label>
                  <div className="flex gap-4 pt-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" className="rounded text-blue-600 w-4 h-4" checked={channels.email} onChange={e => setChannels({...channels, email: e.target.checked})} />
                          <span className="flex items-center gap-1 text-sm"><Mail className="w-4 h-4" /> E-mail</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" className="rounded text-green-600 w-4 h-4" checked={channels.whatsapp} onChange={e => setChannels({...channels, whatsapp: e.target.checked})} />
                          <span className="flex items-center gap-1 text-sm"><MessageCircle className="w-4 h-4" /> WhatsApp</span>
                      </label>
                  </div>
              </div>
          </div>

          <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Mensagem</label>
              <textarea 
                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 h-32"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              ></textarea>
          </div>

          <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Anexar Arquivo/Imagem (Opcional)</label>
              <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 bg-white text-sm text-gray-700">
                      <Upload className="w-4 h-4" /> Escolher Arquivo
                      <input type="file" className="hidden" onChange={handleFileChange} />
                  </label>
                  {attachment && (
                      <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-2 rounded-lg text-sm">
                          <span className="truncate max-w-xs">{attachment.name}</span>
                          <button onClick={() => setAttachment(null)} className="text-blue-400 hover:text-blue-600"><X className="w-4 h-4" /></button>
                      </div>
                  )}
              </div>
          </div>

          <div className="mb-6">
              {/* Filters for Companies */}
              <div className="flex gap-4 mb-4">
                  <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input 
                        type="text" 
                        placeholder="Buscar por nome, CNPJ ou email..." 
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                  </div>
                  <select 
                      className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      value={tagFilter}
                      onChange={(e) => setTagFilter(e.target.value)}
                  >
                      <option value="">Todas as Tags</option>
                      {userSettings?.companyCategories?.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                  </select>
              </div>

              <div className="flex justify-between items-center mb-2 bg-gray-100 p-2 rounded-t-lg border-b border-gray-200">
                  <h3 className="font-bold text-gray-700 px-2">Empresas Destinatárias ({selectedCompanies.filter(id => filteredCompanies.some(c => c.id === id)).length})</h3>
                  <button onClick={toggleSelectAll} className="text-sm text-blue-600 hover:underline px-2 font-medium">
                      {areAllFilteredSelected ? 'Desmarcar Todas' : 'Selecionar Todas'}
                  </button>
              </div>
              <div className="border border-gray-200 rounded-b-lg max-h-60 overflow-y-auto">
                  {filteredCompanies.length === 0 ? (
                      <div className="p-4 text-center text-gray-500">Nenhuma empresa encontrada para este tipo.</div>
                  ) : filteredCompanies.map(company => (
                      <div key={company.id} className="flex items-center p-3 border-b last:border-0 hover:bg-gray-50">
                          <input 
                            type="checkbox" 
                            checked={selectedCompanies.includes(company.id)}
                            onChange={() => toggleCompany(company.id)}
                            className="w-4 h-4 rounded text-blue-600 mr-3"
                          />
                          <div className="flex-1">
                              <div className="font-medium text-sm text-gray-900 flex items-center gap-2">
                                  {company.name}
                                  {company.categories && company.categories.length > 0 && (
                                     <div className="flex gap-1">
                                        {company.categories.map(catId => {
                                            const cat = userSettings?.companyCategories?.find(c => c.id === catId);
                                            if (!cat) return null;
                                            return (
                                                <span key={cat.id} className="text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{backgroundColor: cat.color}}>
                                                    {cat.name}
                                                </span>
                                            );
                                        })}
                                     </div>
                                  )}
                              </div>
                              <div className="text-xs text-gray-500">{company.email} • {company.whatsapp}</div>
                          </div>
                          <div className="text-xs text-gray-400 font-mono">{company.docNumber}</div>
                      </div>
                  ))}
              </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-6">
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <input 
                    type="checkbox" 
                    checked={schedule} 
                    onChange={(e) => setSchedule(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600" 
                  />
                  <span className="font-semibold text-gray-700 flex items-center gap-1">
                      <Calendar className="w-4 h-4" /> Agendar Envio
                  </span>
              </label>
              {schedule && (
                  <div className="mt-3 pl-6">
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Data e Hora</label>
                      <input 
                        type="datetime-local" 
                        className="border border-gray-300 rounded-lg px-3 py-2 outline-none text-sm bg-white" 
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                      />
                  </div>
              )}
          </div>

          <div className="flex justify-end gap-3">
              <button 
                onClick={handleProcess}
                disabled={sending}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 shadow-lg shadow-blue-500/20 flex items-center gap-2 disabled:opacity-70"
              >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {schedule ? 'Agendar Envio' : 'Enviar Agora'} 
              </button>
          </div>
      </div>
    </div>
  );
};

export default BulkSend;
