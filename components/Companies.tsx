import React, { useState, useRef, useEffect } from 'react';
import { Search, Plus, Building2, User, Copy, Check, X, Upload, Pencil, Trash, Loader2 } from 'lucide-react';
import { Company, UserSettings } from '../types';
import { api } from '../services/api';
import * as XLSX from 'xlsx';

interface CompaniesProps {
  userSettings: UserSettings;
}

const Companies: React.FC<CompaniesProps> = ({ userSettings }) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  
  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newCompany, setNewCompany] = useState<Partial<Company>>({
    name: '', nickname: '',
    docNumber: '',
    type: 'CNPJ',
    email: '',
    whatsapp: '',
    categories: [],
    observation: ''
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load Companies from API
  const loadCompanies = async () => {
      setLoading(true);
      try {
          const data = await api.getCompanies();
          setCompanies(data);
      } catch (error) {
          console.error("Erro ao carregar empresas:", error);
      } finally {
          setLoading(false);
      }
  };

  useEffect(() => {
      loadCompanies();
  }, []);

  const handleCopy = (doc: string, id: number) => {
    const cleanDoc = doc.replace(/\D/g, '');
    navigator.clipboard.writeText(cleanDoc);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleEditCompany = (company: Company) => {
    setNewCompany({
        name: company.name,
        nickname: company.nickname || '',
        docNumber: company.docNumber,
        type: company.type,
        email: company.email,
        whatsapp: company.whatsapp,
        categories: company.categories || [],
        observation: company.observation || '',
        companyHash: company.companyHash || ''
    });
    setEditingId(company.id);
    setIsModalOpen(true);
  };

  const handleDeleteCompany = async (id: number) => {
    if (window.confirm('Tem certeza que deseja excluir esta empresa?')) {
        try {
            await api.deleteCompany(id);
            setCompanies(prev => prev.filter(c => c.id !== id));
        } catch (error) {
            alert('Erro ao excluir empresa.');
        }
    }
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompany.name || !newCompany.docNumber) return;

    try {
        const payload = {
            id: editingId || undefined,
            name: newCompany.name,
            nickname: newCompany.nickname,
            docNumber: newCompany.docNumber,
            type: newCompany.type,
            email: newCompany.email,
            whatsapp: newCompany.whatsapp,
            categories: newCompany.categories,
            observation: newCompany.observation
        };

        await api.saveCompany(payload);
        await loadCompanies(); // Reload to get fresh data/IDs
        
        setIsModalOpen(false);
        setEditingId(null);
        setNewCompany({ name: '', nickname: '', docNumber: '', type: 'CNPJ', email: '', whatsapp: '', categories: [], observation: '' });
    } catch (error) {
        alert('Erro ao salvar empresa.');
    }
  };

  const handleOpenNewModal = () => {
      setEditingId(null);
      setNewCompany({ name: '', nickname: '', docNumber: '', type: 'CNPJ', email: '', whatsapp: '', categories: [], observation: '' });
      setIsModalOpen(true);
  };

  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      const rows = data.slice(1);

      let importedCount = 0;
      for (const row of rows) {
        if (row.length < 2) continue;
        const docNumberRaw = String(row[0] || '');
        const name = String(row[1] || '');
        const email = String(row[2] || '');
        const whatsapp = String(row[3] || '');
        let typeRaw = String(row[4] || '').toUpperCase().trim();
        let type: 'CNPJ' | 'CPF' = 'CNPJ';
        if (typeRaw === 'CPF') type = 'CPF';

        if (docNumberRaw && name) {
            try {
                await api.saveCompany({
                    name, docNumber: docNumberRaw, email, whatsapp, type, categories: [], observation: ''
                });
                importedCount++;
            } catch (e) {
                console.error("Falha ao importar linha", row);
            }
        }
      }

      if (importedCount > 0) {
        alert(`${importedCount} empresas importadas com sucesso!`);
        loadCompanies();
      } else {
        alert("Nenhuma empresa válida encontrada no arquivo.");
      }
      
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsBinaryString(file);
  };

  // Filter Logic
  const filteredCompanies = companies.filter(company => {
      const searchLower = searchTerm.toLowerCase();
      // Safety checks for undefined values
      const nameMatch = (company.name || '').toLowerCase().includes(searchLower);
      const docMatch = (company.docNumber || '').includes(searchLower);
      const emailMatch = (company.email || '').toLowerCase().includes(searchLower);
      
      const matchesSearch = nameMatch || docMatch || emailMatch;
      const matchesType = typeFilter ? company.type === typeFilter : true;
      const matchesTag = tagFilter ? (company.categories || []).includes(tagFilter) : true;

      return matchesSearch && matchesType && matchesTag;
  });

  const toggleCategory = (catId: string) => {
      setNewCompany(prev => {
          const cats = prev.categories || [];
          if (cats.includes(catId)) {
              return { ...prev, categories: cats.filter(c => c !== catId) };
          } else {
              return { ...prev, categories: [...cats, catId] };
          }
      });
  };

  if (loading) {
      return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Empresas</h1>
          <p className="text-gray-500">Gerencie o cadastro de empresas e clientes.</p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          {/* Hidden File Input */}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept=".xlsx, .xls, .csv" 
            className="hidden" 
          />
          
          <button 
            onClick={handleImportClick}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <Upload className="w-4 h-4" /> Importar Excel
          </button>
          <button 
            onClick={handleOpenNewModal}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> Nova Empresa
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-gray-100 flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input 
              type="text" 
              placeholder="Buscar por nome, CNPJ ou email..." 
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select 
            className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">Todos os Tipos</option>
            <option value="CNPJ">CNPJ</option>
            <option value="CPF">CPF</option>
          </select>
          <select 
            className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
          >
            <option value="">Todas as Tags</option>
            {userSettings.companyCategories?.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-600 font-medium">
              <tr>
                <th className="px-6 py-4">Tipo (Copiar)</th>
                <th className="px-6 py-4">Documento</th>
                <th className="px-6 py-4">Razão Social / Nome</th>
                <th className="px-6 py-4">Contato</th>
                <th className="px-6 py-4">Categorias</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredCompanies.map((company) => (
                <tr key={company.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                     <button 
                      onClick={() => handleCopy(company.docNumber, company.id)}
                      className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors text-xs font-medium
                        ${copiedId === company.id 
                            ? 'bg-green-100 text-green-700 border-green-200' 
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                     >
                        {copiedId === company.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedId === company.id ? 'Copiado!' : 'Copiar'}
                     </button>
                  </td>
                  <td className="px-6 py-4 font-mono text-gray-600">{company.docNumber}</td>
                   <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-blue-100 text-blue-600 flex items-center justify-center">
                        {company.type === 'CPF' ? <User className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                      </div>
                      <span className="font-semibold text-gray-900">{company.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-gray-900 max-w-[200px] truncate" title={company.email}>{company.email}</span>
                      <span className="text-gray-500 text-xs">{company.whatsapp}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {company.categories?.map(catId => {
                          const cat = userSettings.companyCategories?.find(c => c.id === catId);
                          if (!cat) return null;
                          return (
                              <span key={cat.id} className="text-[10px] px-2 py-0.5 rounded-full text-white" style={{backgroundColor: cat.color}}>
                                  {cat.name}
                              </span>
                          );
                      })}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                        <button 
                            onClick={() => handleEditCompany(company)}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium border border-blue-200 px-2 py-1 rounded hover:bg-blue-50 flex items-center gap-1"
                        >
                            <Pencil className="w-3 h-3" /> Editar
                        </button>
                        <button 
                            onClick={() => handleDeleteCompany(company.id)}
                            className="text-red-500 hover:text-red-700 text-xs font-medium border border-red-200 px-2 py-1 rounded hover:bg-red-50 flex items-center gap-1"
                        >
                            <Trash className="w-3 h-3" /> Excluir
                        </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredCompanies.length === 0 && (
                  <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                          Nenhuma empresa encontrada com os filtros atuais.
                      </td>
                  </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New/Edit Company Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
             <div className="p-4 border-b border-gray-100 flex justify-between items-center shrink-0">
                <h3 className="font-bold text-gray-800">{editingId ? 'Editar Empresa' : 'Nova Empresa'}</h3>
                <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                   <X className="w-5 h-5" />
                </button>
             </div>
             <form onSubmit={handleSaveCompany} className="p-6 space-y-4 overflow-y-auto flex-1">
                <div>
                   <label className="block text-sm font-semibold text-gray-700 mb-1">Razão Social / Nome*</label>
                   <input 
                      type="text" 
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                      value={newCompany.name}
                      onChange={(e) => setNewCompany({...newCompany, name: e.target.value})}
                      required
                   />
                </div>
                
                <div>
                   <label className="block text-sm font-semibold text-gray-700 mb-1">Apelido</label>
                   <input 
                      type="text" 
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                      value={newCompany.nickname || ''}
                      onChange={(e) => setNewCompany({...newCompany, nickname: e.target.value})}
                      placeholder="Ex: Empresa X"
                   />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Tipo*</label>
                    <select 
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none"
                      value={newCompany.type}
                      onChange={(e) => setNewCompany({...newCompany, type: e.target.value as any})}
                    >
                      <option value="CNPJ">CNPJ</option>
                      <option value="CPF">CPF</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Documento*</label>
                    <input 
                        type="text" 
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                        value={newCompany.docNumber}
                        onChange={(e) => setNewCompany({...newCompany, docNumber: e.target.value})}
                        required
                    />
                  </div>
                </div>

                <div>
                   <label className="block text-sm font-semibold text-gray-700 mb-1">E-mail(s)</label>
                   <input 
                      type="text" 
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                      value={newCompany.email}
                      onChange={(e) => setNewCompany({...newCompany, email: e.target.value})}
                      placeholder="email1@exemplo.com, email2@exemplo.com"
                   />
                   <p className="text-xs text-gray-500 mt-1">Para enviar para múltiplos e-mails, separe por vírgula.</p>
                </div>

                <div>
                   <label className="block text-sm font-semibold text-gray-700 mb-1">WhatsApp</label>
                   <input 
                      type="text" 
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                      value={newCompany.whatsapp}
                      onChange={(e) => setNewCompany({...newCompany, whatsapp: e.target.value})}
                   />
                </div>

                {userSettings.companyCategories && userSettings.companyCategories.length > 0 && (
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Categorias</label>
                        <div className="flex flex-wrap gap-2">
                            {userSettings.companyCategories.map(cat => (
                                <button
                                    type="button"
                                    key={cat.id}
                                    onClick={() => toggleCategory(cat.id)}
                                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors
                                        ${newCompany.categories?.includes(cat.id) ? 'text-white border-transparent' : 'bg-transparent text-gray-600 border-gray-300'}
                                    `}
                                    style={{
                                        backgroundColor: newCompany.categories?.includes(cat.id) ? cat.color : 'transparent',
                                        borderColor: newCompany.categories?.includes(cat.id) ? cat.color : undefined
                                    }}
                                >
                                    {cat.name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div>
                   <label className="block text-sm font-semibold text-gray-700 mb-1">Observações</label>
                   <textarea 
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px] resize-y"
                      value={newCompany.observation}
                      onChange={(e) => setNewCompany({...newCompany, observation: e.target.value})}
                      placeholder="Adicione notas sobre esta empresa..."
                   />
                </div>

                {editingId && (
                    <div className="bg-gray-50 border border-gray-200 p-3 rounded-lg flex justify-between items-center">
                        <div>
                            <div className="text-xs font-semibold text-gray-500 uppercase">Hash de Integração (Portal)</div>
                            {newCompany.companyHash ? (
                                <code className="text-xs text-gray-700 select-all">{newCompany.companyHash}</code>
                            ) : (
                                <div className="text-xs text-amber-600 font-medium">Salve a empresa para gerar a hash.</div>
                            )}
                        </div>
                        {newCompany.companyHash && (
                            <button 
                                type="button" 
                                onClick={() => {
                                    navigator.clipboard.writeText(newCompany.companyHash || '');
                                    alert('Hash copiado!');
                                }} 
                                className="bg-white border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-100 flex items-center gap-2 text-xs text-gray-700 transition"
                                title="Copiar Hash"
                            >
                                <Copy className="w-3 h-3" /> Copiar
                            </button>
                        )}
                    </div>
                )}

                <div className="flex justify-end gap-3 pt-2 mt-4 shrink-0">
                    <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
                    <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Salvar</button>
                </div>
             </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Companies;