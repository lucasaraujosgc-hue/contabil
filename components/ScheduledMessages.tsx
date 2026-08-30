
import React, { useState, useEffect } from 'react';
import { CalendarClock, Edit, Trash, Plus, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { ScheduledMessage, Company } from '../types';
import { api } from '../services/api';

const ScheduledMessages: React.FC = () => {
  const [view, setView] = useState<'list' | 'edit'>('list');
  const [messages, setMessages] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Data State
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  // Mock form state for editing
  const [formData, setFormData] = useState<Partial<ScheduledMessage>>({});

  const fetchMessages = async () => {
      try {
          const data = await api.getScheduledMessages();
          setMessages(data);
      } catch (e) {
          console.error(e);
      } finally {
          setLoading(false);
      }
  };

  useEffect(() => {
    fetchMessages();
  }, []);

  useEffect(() => {
    if (view === 'edit') {
        setLoadingCompanies(true);
        api.getCompanies()
            .then(data => setCompanies(data))
            .catch(e => console.error(e))
            .finally(() => setLoadingCompanies(false));
    }
  }, [view]);

  const handleEdit = (msg: ScheduledMessage) => {
      setFormData(msg);
      setEditingId(msg.id);
      setView('edit');
  };

  const handleDelete = async (id: number) => {
      if(window.confirm("Excluir agendamento?")) {
          await api.deleteScheduledMessage(id);
          fetchMessages();
      }
  };

  const handleNew = () => {
      setFormData({
          title: '',
          message: '',
          nextRun: '',
          recurrence: 'unico',
          active: true,
          type: 'message',
          targetType: 'normal',
          channels: { email: true, whatsapp: false },
          selectedCompanyIds: []
      });
      setEditingId(null);
      setView('edit');
  };

  const handleSave = async () => {
      try {
          await api.saveScheduledMessage(formData);
          setView('list');
          fetchMessages();
      } catch (e) {
          alert("Erro ao salvar");
      }
  };

  const toggleSelectedCompany = (id: number) => {
      const current = formData.selectedCompanyIds || [];
      const newSelection = current.includes(id) 
        ? current.filter(cid => cid !== id)
        : [...current, id];
      setFormData({...formData, selectedCompanyIds: newSelection});
  };

  if (view === 'edit') {
      return (
          <div className="space-y-6">
              <div className="card bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="card-header bg-blue-600 text-white p-4 flex justify-between items-center">
                      <h5 className="font-bold flex items-center gap-2">
                          <Edit className="w-5 h-5" /> {editingId ? 'Editar Agendamento' : 'Novo Agendamento'}
                      </h5>
                  </div>
                  <div className="p-6 space-y-6">
                      <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Título</label>
                          <input 
                            type="text" 
                            className="w-full border border-gray-300 rounded-lg px-3 py-2" 
                            value={formData.title} 
                            onChange={e => setFormData({...formData, title: e.target.value})}
                          />
                      </div>

                      <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">Mensagem</label>
                          <textarea 
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 h-32" 
                            value={formData.message}
                            onChange={e => setFormData({...formData, message: e.target.value})}
                          ></textarea>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-1">Recorrência</label>
                              <select 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2" 
                                value={formData.recurrence}
                                onChange={e => setFormData({...formData, recurrence: e.target.value})}
                              >
                                  <option value="unico">Envio Único</option>
                                  <option value="mensal">Mensal</option>
                                  <option value="trimestral">Trimestral</option>
                                  <option value="anual">Anual</option>
                              </select>
                          </div>
                          <div>
                              <label className="block text-sm font-semibold text-gray-700 mb-1">Próximo Envio</label>
                              <input 
                                type="datetime-local" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2" 
                                value={formData.nextRun?.replace(' ', 'T')} 
                                onChange={e => setFormData({...formData, nextRun: e.target.value})}
                              />
                          </div>
                      </div>

                      <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                            Empresas Alvo
                            {loadingCompanies && <Loader2 className="w-3 h-3 animate-spin" />}
                          </label>
                          <select 
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-3"
                            value={formData.targetType}
                            onChange={e => setFormData({...formData, targetType: e.target.value as any})}
                          >
                              <option value="normal">Todas Empresas Normais</option>
                              <option value="mei">Todas Empresas MEI</option>
                              <option value="selected">Empresas Selecionadas</option>
                          </select>
                          
                          {formData.targetType === 'selected' && (
                            <div className="border border-gray-200 rounded-lg p-3 max-h-40 overflow-y-auto bg-gray-50">
                                    {companies.map(c => (
                                        <label key={c.id} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-100 px-2 rounded">
                                            <input 
                                                type="checkbox" 
                                                className="rounded text-blue-600" 
                                                checked={formData.selectedCompanyIds?.includes(c.id)}
                                                onChange={() => toggleSelectedCompany(c.id)}
                                            />
                                            <span className="text-sm">{c.name}</span>
                                        </label>
                                    ))}
                            </div>
                          )}
                      </div>

                      <div className="flex items-center justify-between border-t pt-4">
                           <div className="flex items-center gap-4">
                               <label className="flex items-center gap-2">
                                   <input 
                                    type="checkbox" 
                                    className="toggle-checkbox" 
                                    checked={formData.active}
                                    onChange={e => setFormData({...formData, active: e.target.checked})}
                                   />
                                   <span className="text-sm font-medium">Ativo</span>
                               </label>
                               <label className="flex items-center gap-2">
                                   <input 
                                    type="checkbox" 
                                    checked={formData.channels?.email}
                                    onChange={e => setFormData({...formData, channels: {...formData.channels!, email: e.target.checked}})}
                                   />
                                   <span className="text-sm">E-mail</span>
                               </label>
                               <label className="flex items-center gap-2">
                                   <input 
                                    type="checkbox" 
                                    checked={formData.channels?.whatsapp}
                                    onChange={e => setFormData({...formData, channels: {...formData.channels!, whatsapp: e.target.checked}})}
                                   />
                                   <span className="text-sm">WhatsApp</span>
                               </label>
                           </div>
                           <div className="flex gap-2">
                               <button onClick={() => setView('list')} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
                               <button onClick={handleSave} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Salvar</button>
                           </div>
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  if (loading) return <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <CalendarClock className="w-6 h-6 text-blue-600" /> Agendamentos
            </h1>
            <p className="text-gray-500">Gerencie envios automáticos e recorrentes.</p>
        </div>
        <button onClick={handleNew} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 shadow-sm">
            <Plus className="w-4 h-4" /> Novo Agendamento
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
          {messages.length === 0 ? (
              <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
                  Nenhum agendamento encontrado.
              </div>
          ) : messages.map(msg => (
              <div key={msg.id} className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-center gap-4 hover:shadow-md transition-shadow">
                  <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                          {msg.active ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-gray-300" />}
                          <h3 className="font-bold text-gray-800">{msg.title}</h3>
                          <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full border border-blue-100 uppercase font-semibold">{msg.recurrence}</span>
                      </div>
                      <p className="text-sm text-gray-500 flex items-center gap-2">
                          <CalendarClock className="w-3 h-3" /> Próximo envio: {new Date(msg.nextRun).toLocaleString('pt-BR')}
                      </p>
                  </div>
                  <div className="flex gap-2">
                      <button onClick={() => handleEdit(msg)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg border border-transparent hover:border-blue-100 transition-colors">
                          <Edit className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(msg.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-100 transition-colors">
                          <Trash className="w-4 h-4" />
                      </button>
                  </div>
              </div>
          ))}
      </div>
    </div>
  );
};

export default ScheduledMessages;
