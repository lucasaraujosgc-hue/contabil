import React, { useState, useEffect } from 'react';
import { Send as SendIcon, Mail, MessageCircle, FileText, Trash, Clock, Check, Info, ArrowLeft, X, CheckSquare, Calendar, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Document, Company, UserSettings, ScheduledMessage } from '../types';
import { api } from '../services/api';

interface SendProps {
  documents: Document[];
  onSendDocuments: (ids: number[]) => void;
  onNavigateToDocuments: () => void;
  userSettings: UserSettings;
  onDeleteDocument: (id: number) => void;
  onClearPendingDocuments: (competence: string) => void;
}

const Send: React.FC<SendProps> = ({ documents, onSendDocuments, onNavigateToDocuments, userSettings, onDeleteDocument, onClearPendingDocuments }) => {
  const getInitialCompetence = () => {
    const now = new Date();
    if (now.getDate() <= 15) {
        now.setMonth(now.getMonth() - 1);
    }
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${mm}/${yyyy}`;
  };

  const [competence, setCompetence] = useState(getInitialCompetence());
  const [subject, setSubject] = useState('Folha de Pagamento');
  const [message, setMessage] = useState('Segue em anexo os seguintes documentos:');
  const [sendEmail, setSendEmail] = useState(true);
  const [sendWhatsapp, setSendWhatsapp] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<number[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleChannels, setScheduleChannels] = useState({ email: true, whatsapp: false });
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  useEffect(() => {
    setLoadingCompanies(true);
    api.getCompanies()
        .then(data => setCompanies(data))
        .catch(err => console.error(err))
        .finally(() => setLoadingCompanies(false));
  }, []);

  const changeCompetence = (delta: number) => {
    if (!competence.includes('/')) return;
    const [m, y] = competence.split('/').map(Number);
    const date = new Date(y, m - 1 + delta, 1);
    const newM = String(date.getMonth() + 1).padStart(2, '0');
    const newY = date.getFullYear();
    setCompetence(`${newM}/${newY}`);
  };

  const pendingDocs = documents.filter(doc => doc.status === 'pending' && doc.competence === competence);

  const docsByCompany = pendingDocs.reduce((acc, doc) => {
    if (!acc[doc.companyId]) acc[doc.companyId] = [];
    acc[doc.companyId].push(doc);
    return acc;
  }, {} as Record<number, Document[]>);

  const getCompanyDetails = (id: number) => companies.find(c => c.id === id);

  const toggleDocSelection = (id: number) => {
    setSelectedDocs(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  };

  const toggleCompanySelection = (companyId: number, companyDocs: Document[]) => {
    const allSelected = companyDocs.every(d => selectedDocs.includes(d.id));
    if (allSelected) {
      const idsToRemove = companyDocs.map(d => d.id);
      setSelectedDocs(prev => prev.filter(id => !idsToRemove.includes(id)));
    } else {
      const idsToAdd = companyDocs.map(d => d.id);
      setSelectedDocs(prev => [...new Set([...prev, ...idsToAdd])]);
    }
  };

  const toggleSelectGlobal = () => {
      const allPendingIds = pendingDocs.map(d => d.id);
      const allSelected = allPendingIds.length > 0 && allPendingIds.every(id => selectedDocs.includes(id));
      if (allSelected) setSelectedDocs([]);
      else setSelectedDocs(allPendingIds);
  };

  const handleSend = async () => {
    if (selectedDocs.length === 0) {
      alert('Selecione pelo menos um documento para enviar.');
      return;
    }
    if (!sendEmail && !sendWhatsapp) {
      alert('Selecione pelo menos um método de envio (E-mail ou WhatsApp).');
      return;
    }

    setIsProcessing(true);

    const docsToSend = documents
        .filter(d => selectedDocs.includes(d.id))
        .map(d => ({
            id: d.id, 
            companyId: d.companyId,
            companyName: d.companyName,
            serverFilename: d.serverFilename || d.name, 
            docName: d.name,
            category: d.category,
            competence: d.competence,
            dueDate: d.dueDate
        }));

    try {
        const result = await api.sendDocuments({
            documents: docsToSend,
            subject,
            messageBody: message,
            channels: { email: sendEmail, whatsapp: sendWhatsapp },
            emailSignature: userSettings.emailSignature,
            whatsappTemplate: userSettings.whatsappTemplate,
            isBulk: false
        });

        if (result.success) {
            // Fix: Cast explicitly to number[] for successIds
            const successIds: number[] = (result.sentIds as unknown as number[]) || [];
            
            if (successIds.length > 0) {
                onSendDocuments(successIds);
                setSelectedDocs(prev => prev.filter(id => !successIds.includes(id)));
            }
            
            alert(`Processamento finalizado!\nSucessos: ${result.sent}\nErros: ${result.errors.length}\n${result.errors.length > 0 ? 'Verifique os logs no servidor para detalhes.' : ''}`);
        } else {
            alert("Erro ao processar envio no servidor.");
        }

    } catch (e) {
        console.error(e);
        alert("Erro de comunicação com o servidor.");
    } finally {
        setIsProcessing(false);
    }
  };

  const handleOpenSchedule = () => {
     if (selectedDocs.length === 0) { alert('Selecione pelo menos um documento.'); return; }
     setScheduleChannels({ email: sendEmail, whatsapp: sendWhatsapp });
     setShowScheduleModal(true);
  };

  const confirmSchedule = async () => {
      if (!scheduleDate) { alert("Selecione data e hora."); return; }
      
      try {
          // Extrair empresas únicas dos documentos selecionados
          const docsToSend = documents
            .filter(d => selectedDocs.includes(d.id))
            .map(d => ({
                id: d.id, 
                companyId: d.companyId,
                serverFilename: d.serverFilename || d.name, 
                docName: d.name,
                category: d.category,
                competence: d.competence,
                dueDate: d.dueDate
            }));

          const companyIds = [...new Set(docsToSend.map(d => d.companyId))];

          const payload: Partial<ScheduledMessage> = {
            title: subject,
            message: message, // Removed the extra text
            nextRun: scheduleDate,
            recurrence: 'unico',
            active: true,
            type: 'documents', 
            targetType: 'selected',
            channels: scheduleChannels,
            selectedCompanyIds: companyIds,
            documentsPayload: JSON.stringify(docsToSend) // Send full document list to server
          };

          await api.saveScheduledMessage(payload);
          
          // Visual Feedback: Mark as sent/scheduled in UI so they disappear from "Pending"
          const scheduledIds = docsToSend.map(d => d.id);
          onSendDocuments(scheduledIds);
          setSelectedDocs([]);

          alert(`Agendamento salvo com sucesso!\n${docsToSend.length} documentos serão enviados em ${new Date(scheduleDate).toLocaleString()}.`);
          setShowScheduleModal(false);
      } catch (e: any) {
          console.error(e);
          alert(`Erro ao salvar agendamento: ${e.message}`);
      }
  }

  const allPendingIds = pendingDocs.map(d => d.id);
  const isGlobalSelected = allPendingIds.length > 0 && allPendingIds.every(id => selectedDocs.includes(id));

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <SendIcon className="w-6 h-6 text-blue-600" /> Envio de Documentos
            <span className="text-base font-normal text-gray-500">- Competência: {competence}</span>
        </h2>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
         <div className="bg-gray-50 p-4 border-b border-gray-100">
             <h5 className="font-bold text-gray-700 flex items-center gap-2">
                 <Mail className="w-5 h-5" /> Configuração do Envio
             </h5>
         </div>
         <div className="p-6">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                 <div>
                     <label className="block text-sm font-semibold text-gray-700 mb-1">Assunto do E-mail*</label>
                     <div className="flex">
                         <span className="px-3 bg-gray-100 border border-r-0 border-gray-300 rounded-l-lg flex items-center text-gray-500"><Check className="w-4 h-4" /></span>
                         <input type="text" className="w-full border border-gray-300 rounded-r-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" value={subject} onChange={(e) => setSubject(e.target.value)} />
                     </div>
                 </div>
                 <div>
                     <label className="block text-sm font-semibold text-gray-700 mb-1">Competência</label>
                     <div className="flex gap-1">
                         <button 
                             type="button"
                             onClick={() => changeCompetence(-1)}
                             className="p-2 border border-gray-300 rounded-l-lg hover:bg-gray-100 text-gray-600"
                         >
                             <ChevronLeft className="w-4 h-4" />
                         </button>
                         <input 
                             type="text" 
                             className="w-full border-y border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-center" 
                             value={competence} 
                             onChange={(e) => { 
                                 let val = e.target.value.replace(/\D/g, ''); 
                                 if (val.length > 2) val = val.substring(0, 2) + '/' + val.substring(2, 6); 
                                 setCompetence(val); 
                             }} 
                        />
                         <button 
                             type="button"
                             onClick={() => changeCompetence(1)}
                             className="p-2 border border-gray-300 rounded-r-lg hover:bg-gray-100 text-gray-600"
                         >
                             <ChevronRight className="w-4 h-4" />
                         </button>
                     </div>
                 </div>
             </div>
             <div>
                 <label className="block text-sm font-semibold text-gray-700 mb-1">Mensagem</label>
                 <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 h-24 outline-none focus:ring-2 focus:ring-blue-500" value={message} onChange={(e) => setMessage(e.target.value)} />
                 <p className="text-xs text-gray-400 mt-1">Esta mensagem aparecerá no corpo do e-mail e no início da mensagem do WhatsApp.</p>
             </div>
         </div>
      </div>

      <div className="mb-4">
          <div className="flex justify-between items-center border-b pb-2 mb-4">
              <h4 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <FileText className="w-6 h-6 text-blue-600" /> Documentos Pendentes
                  {loadingCompanies && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
              </h4>
              {pendingDocs.length > 0 && (
                  <div className="flex gap-2">
                    <button 
                        onClick={() => onClearPendingDocuments(competence)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors bg-red-100 text-red-700 hover:bg-red-200"
                    >
                        <Trash className="w-4 h-4" /> Limpar Lista
                    </button>
                    <button onClick={toggleSelectGlobal} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${isGlobalSelected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        <CheckSquare className="w-4 h-4" /> {isGlobalSelected ? 'Desmarcar Todos' : 'Selecionar Todos (Geral)'}
                    </button>
                  </div>
              )}
          </div>

          {Object.keys(docsByCompany).length === 0 ? (
              <div className="bg-blue-50 text-blue-700 p-4 rounded-lg flex items-center gap-2">
                  <Info className="w-5 h-5" /> Não há documentos pendentes para envio nesta competência.
                  <button onClick={onNavigateToDocuments} className="font-bold hover:underline">Voltar</button>
              </div>
          ) : (
              Object.entries(docsByCompany).map(([companyIdStr, companyDocsRaw]) => {
                  const companyId = Number(companyIdStr);
                  const companyDocs = companyDocsRaw as Document[];
                  const company = getCompanyDetails(companyId);
                  const allSelected = companyDocs.every(d => selectedDocs.includes(d.id));

                  return (
                      <div key={companyId} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
                          <div className="bg-blue-600 text-white p-4 flex justify-between items-center">
                              <div>
                                  <h5 className="font-bold text-lg">{company?.name || `Empresa ID: ${companyId}`}</h5>
                                  <div className="text-sm opacity-90 flex gap-3">
                                      <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {company?.email || 'N/A'}</span>
                                      <span className="flex items-center gap-1"><MessageCircle className="w-3 h-3" /> {company?.whatsapp || 'N/A'}</span>
                                  </div>
                              </div>
                              <label className="flex items-center gap-2 cursor-pointer bg-blue-700 px-3 py-1 rounded hover:bg-blue-800 transition-colors">
                                  <input type="checkbox" className="rounded text-blue-600 w-4 h-4" checked={allSelected} onChange={() => toggleCompanySelection(companyId, companyDocs)} />
                                  <span className="text-sm font-medium">Selecionar todos</span>
                              </label>
                          </div>
                          <div className="p-0">
                              <table className="w-full text-sm">
                                  <thead className="bg-gray-50 text-gray-600">
                                      <tr><th className="px-4 py-3 w-10"></th><th className="px-4 py-3 text-left">Documento</th><th className="px-4 py-3 text-left">Categoria</th><th className="px-4 py-3 text-left">Vencimento</th><th className="px-4 py-3 text-center">Status</th><th className="px-4 py-3 text-center">Ações</th></tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                      {companyDocs.map(doc => (
                                          <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                                              <td className="px-4 py-3 text-center"><input type="checkbox" className="rounded text-blue-600 w-4 h-4" checked={selectedDocs.includes(doc.id)} onChange={() => toggleDocSelection(doc.id)} /></td>
                                              <td className="px-4 py-3 font-medium text-gray-800 flex items-center gap-2"><FileText className="w-4 h-4 text-blue-500" /> {doc.name || 'Sem nome'}</td>
                                              <td className="px-4 py-3"><span className="px-2 py-1 bg-gray-100 rounded text-xs text-gray-600 font-medium">{doc.category}</span></td>
                                              <td className="px-4 py-3 text-gray-600">{doc.dueDate || <span className="text-gray-400">Não informado</span>}</td>
                                              <td className="px-4 py-3 text-center"><span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded text-xs font-bold uppercase">Pendente</span></td>
                                              <td className="px-4 py-3 text-center">
                                                <button 
                                                    onClick={() => onDeleteDocument(doc.id)}
                                                    className="text-red-500 hover:bg-red-50 p-1 rounded transition-colors"
                                                    title="Remover este arquivo"
                                                >
                                                    <Trash className="w-4 h-4" />
                                                </button>
                                              </td>
                                          </tr>
                                      ))}
                                  </tbody>
                              </table>
                          </div>
                      </div>
                  );
              })
          )}
      </div>

      {Object.keys(docsByCompany).length > 0 && (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
                <div className="bg-gray-50 p-4 border-b border-gray-100"><h5 className="font-bold text-gray-700 flex items-center gap-2"><SendIcon className="w-5 h-5" /> Opções de Envio Imediato</h5></div>
                <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                            <input type="checkbox" className="w-5 h-5 rounded text-blue-600" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                            <div className="flex flex-col"><span className="font-bold text-gray-800 flex items-center gap-2"><Mail className="w-4 h-4 text-blue-500" /> Enviar por E-mail</span></div>
                        </label>
                        <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                            <input type="checkbox" className="w-5 h-5 rounded text-green-600" checked={sendWhatsapp} onChange={(e) => setSendWhatsapp(e.target.checked)} />
                            <div className="flex flex-col"><span className="font-bold text-gray-800 flex items-center gap-2"><MessageCircle className="w-4 h-4 text-green-500" /> Enviar por WhatsApp</span></div>
                        </label>
                    </div>
                </div>
            </div>

            <div className="flex justify-between items-center pt-4 border-t">
                <button onClick={onNavigateToDocuments} className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-2 font-medium"><ArrowLeft className="w-4 h-4" /> Voltar</button>
                <div className="flex gap-3">
                    <button onClick={handleOpenSchedule} className="px-6 py-2 border-2 border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 flex items-center gap-2 font-bold"><Clock className="w-5 h-5" /> Agendar Envio</button>
                    <button onClick={handleSend} disabled={isProcessing} className="px-8 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-lg shadow-blue-500/20 flex items-center gap-2 font-bold disabled:opacity-70">
                        {isProcessing ? <><div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div> Enviando...</> : <><SendIcon className="w-5 h-5" /> Enviar Agora</>}
                    </button>
                </div>
            </div>
          </>
      )}

      {showScheduleModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                  <div className="bg-blue-600 text-white p-4 flex justify-between items-center"><h5 className="font-bold flex items-center gap-2"><Clock className="w-5 h-5" /> Agendar Envio de Documentos</h5><button onClick={() => setShowScheduleModal(false)} className="hover:bg-blue-700 p-1 rounded"><X className="w-5 h-5" /></button></div>
                  <div className="p-6 space-y-4">
                      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200"><h6 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2"><FileText className="w-4 h-4" /> Resumo da Seleção</h6><div className="text-sm text-gray-600">Você está agendando o envio de <strong>{selectedDocs.length} documentos</strong> para {new Set(documents.filter(d => selectedDocs.includes(d.id)).map(d => d.companyId)).size} empresas.</div></div>
                      <div><label className="block text-sm font-semibold text-gray-700 mb-1">Data e Hora do Envio*</label><div className="relative"><Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" /><input type="datetime-local" className="w-full border border-gray-300 rounded-lg pl-10 pr-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} /></div></div>
                  </div>
                  <div className="p-4 border-t flex justify-end gap-3 bg-gray-50"><button onClick={() => setShowScheduleModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg font-medium">Cancelar</button><button onClick={confirmSchedule} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold">Confirmar Agendamento</button></div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Send;