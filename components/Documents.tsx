import React, { useState, useRef, useEffect } from 'react';
import { Upload, CalendarCheck, Search, FileText, Check, X, Play, Settings as SettingsIcon, Filter, FolderArchive, Loader2, FilePlus, AlertTriangle, Trash, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { DOCUMENT_CATEGORIES } from '../constants';
import { UserSettings, Document, Company, UploadedFile } from '../types';
import { identifyCategory, identifyCompany, extractTextFromPDF, removeAccents } from '../utils/documentProcessor';
import { api } from '../services/api';
import { calcularTodosVencimentos } from '../utils/dateHelpers';
import JSZip from 'jszip';

interface DocumentsProps {
  userSettings: UserSettings;
  onNavigateToUpload: (companyId: number, competence: string) => void;
  documents: Document[];
  onToggleStatus: (companyId: number, category: string, competence: string) => void;
  onUploadSuccess: (files: UploadedFile[], companyId: number, competence: string) => void;
}

interface PreviewFile {
  id: string; 
  file: File;
  fileName: string;
  detectedCompanyId: number | null; 
  detectedCategory: string | ''; 
  status: 'ready' | 'error' | 'ignored';
  size: number;
}

const Documents: React.FC<DocumentsProps> = ({ 
  userSettings, 
  onNavigateToUpload, 
  documents: initialDocuments,
  onToggleStatus,
  onUploadSuccess
}) => {
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
  const [activeCompetence, setActiveCompetence] = useState(getInitialCompetence());
  const [companies, setCompanies] = useState<Company[]>([]);
  const [dbStatuses, setDbStatuses] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);

  const [localPath, setLocalPath] = useState('');
  const [processingCompetence, setProcessingCompetence] = useState(getInitialCompetence());
  const [processing, setProcessing] = useState(false);
  const [isUploadingConfirmed, setIsUploadingConfirmed] = useState(false);
  
  // --- NOVOS ESTADOS PARA MULTI-SELECT ---
  const [filterCompanyIds, setFilterCompanyIds] = useState<number[]>([]);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterCompanyCategory, setFilterCompanyCategory] = useState<string>('');
  
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewFiles, setPreviewFiles] = useState<PreviewFile[]>([]);

  const [matrixSearch, setMatrixSearch] = useState('');
  const [matrixStatusFilter, setMatrixStatusFilter] = useState<'all' | 'pending' | 'sent'>('all');
  const [matrixCategoryFilter, setMatrixCategoryFilter] = useState<string>('all');
  const [matrixCompanyCategoryFilter, setMatrixCompanyCategoryFilter] = useState<string>('all');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const allCategories = [...DOCUMENT_CATEGORIES, ...(userSettings?.customCategories || [])];

  const fetchData = async () => {
      setLoading(true);
      try {
          const [comps, statuses] = await Promise.all([
              api.getCompanies(),
              api.getDocumentStatuses(activeCompetence)
          ]);
          setCompanies(comps || []);
          setDbStatuses(statuses || []);
      } catch (error) {
          console.error("Error fetching documents data", error);
      } finally {
          setLoading(false);
      }
  };

  useEffect(() => {
      fetchData();
  }, [activeCompetence]);

  const visibleMatrixCategories = (userSettings?.visibleDocumentCategories && userSettings.visibleDocumentCategories.length > 0)
    ? userSettings.visibleDocumentCategories 
    : allCategories.slice(0, 8);

  const changeCompetence = (current: string, delta: number, setter: (val: string) => void) => {
      if (!current.includes('/')) return;
      const [m, y] = current.split('/').map(Number);
      const date = new Date(y, m - 1 + delta, 1);
      const newM = String(date.getMonth() + 1).padStart(2, '0');
      const newY = date.getFullYear();
      setter(`${newM}/${newY}`);
  };

  const handleProcessClick = () => {
    if (fileInputRef.current) {
        fileInputRef.current.click();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        const files: File[] = Array.from(e.target.files);
        
        if (files.length === 1) {
            setLocalPath(files[0].name);
        } else {
            setLocalPath(`${files.length} arquivos selecionados`);
        }

        const zipFile = files.find(f => f.name.toLowerCase().endsWith('.zip') || f.name.toLowerCase().endsWith('.rar'));
        
        if (zipFile) {
             if (files.length > 1) {
                 alert("Ao selecionar um arquivo ZIP, selecione apenas ele.");
                 return;
             }
             await prepareZipFile(zipFile);
        } else {
             await prepareMultipleFiles(files);
        }
    }
  };

  // --- FUNÇÕES DE FILTRO E ADD/REMOVE ---
  const addCompanyFilter = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = Number(e.target.value);
      if (val && !filterCompanyIds.includes(val)) {
          setFilterCompanyIds([...filterCompanyIds, val]);
      }
      e.target.value = ''; // Reset select
  };

  const removeCompanyFilter = (id: number) => {
      setFilterCompanyIds(filterCompanyIds.filter(fid => fid !== id));
  };

  const addCategoryFilter = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val && !filterCategories.includes(val)) {
          setFilterCategories([...filterCategories, val]);
      }
      e.target.value = ''; // Reset select
  };

  const removeCategoryFilter = (cat: string) => {
      setFilterCategories(filterCategories.filter(c => c !== cat));
  };

  const prepareMultipleFiles = async (fileList: File[]) => {
      setProcessing(true);
      setPreviewFiles([]);
      
      const tempFiles: PreviewFile[] = [];

      for (const file of fileList) {
          let pdfText = "";
          if (file.name.toLowerCase().endsWith('.pdf')) {
              try {
                pdfText = await extractTextFromPDF(file);
              } catch(e) { 
                console.warn("PDF Read error", e); 
              }
          }
          const textForAnalysis = removeAccents((pdfText + " " + file.name).toLowerCase());
          
          let detectedCompanyId: number | null = null;
          // Se houver APENAS UMA empresa no filtro, forçamos ela se não identificar nada?
          // A lógica pedida é: Filtros ativos restringem. 
          // Se 1 empresa selecionada, só processa arquivos dela.
          
          const identifiedCompany = identifyCompany(textForAnalysis, companies);
          if (identifiedCompany) detectedCompanyId = identifiedCompany.id;

          // --- LÓGICA DE FILTRO DE EMPRESA ---
          // Se houver filtros, e o ID detectado NÃO estiver neles, pula este arquivo.
          if (filterCompanyIds.length > 0) {
              if (!detectedCompanyId) {
                  // Se não detectou, mas temos 1 filtro selecionado, podemos assumir que é dessa empresa?
                  // Risco alto. Melhor ignorar. Mas o usuário disse: "caso esteja selecionada só uma empresa... só irá aparecer os que foram selecionados".
                  // Isso implica que o filtro atua como whitelist.
                  // Se não detectou, é seguro ignorar.
                  // Se o usuário QUER que force, ele seleciona 1 e o sistema poderia inferir.
                  // Vamos manter seguro: Se não detectou ou detectou errado, ignora.
                  // EXCEÇÃO: Se só tem 1 filtro, talvez o usuário queira forçar upload para ela.
                  // Mas o prompt diz "só irá aparecer os que foram selecionados no filtros".
                  if (filterCompanyIds.length === 1) {
                      detectedCompanyId = filterCompanyIds[0]; // Força se for único? O usuário pode estar subindo lote específico.
                  } else {
                      continue; // Ignora arquivo
                  }
              } else {
                  if (!filterCompanyIds.includes(detectedCompanyId)) continue;
              }
          }

          let detectedCategory = '';
          const identifiedCat = identifyCategory(
              textForAnalysis, 
              userSettings?.categoryKeywords || {}, 
              userSettings?.priorityCategories || [] 
          );
          detectedCategory = identifiedCat ?? 'Outros';

          // --- LÓGICA DE FILTRO DE CATEGORIA ---
          if (filterCategories.length > 0) {
              if (filterCategories.length === 1 && detectedCategory === 'Outros') {
                   detectedCategory = filterCategories[0]; // Força se só tem 1 e não achou nada
              } else if (!filterCategories.includes(detectedCategory)) {
                   continue; // Ignora se não bate com filtro
              }
          }

          tempFiles.push({
              id: Math.random().toString(36).substr(2, 9),
              file: file,
              fileName: file.name,
              detectedCompanyId: detectedCompanyId,
              detectedCategory: detectedCategory, 
              status: 'ready',
              size: file.size
          });
      }

      setPreviewFiles(tempFiles);
      setProcessing(false);
      setShowPreviewModal(true);
      
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const prepareZipFile = async (zipFile: File) => {
      setProcessing(true);
      setPreviewFiles([]);

      try {
        const zip = await JSZip.loadAsync(zipFile);
        const entries: {name: string, obj: any}[] = [];

        zip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir && !zipEntry.name.startsWith('__MACOSX') && !zipEntry.name.endsWith('.DS_Store')) {
                entries.push({ name: zipEntry.name, obj: zipEntry });
            }
        });

        const tempFiles: PreviewFile[] = [];

        for (const entry of entries) {
            const fileName = entry.name;
            const simpleName = fileName.split('/').pop() || fileName;
            const blob = await entry.obj.async("blob");
            
            const type = simpleName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : blob.type;
            const file = new File([blob], simpleName, { type });

            let pdfText = "";
            if (simpleName.toLowerCase().endsWith('.pdf')) {
                 try {
                     pdfText = await extractTextFromPDF(file);
                 } catch(e) { console.warn("Zip PDF Read error", e); }
            }

            const textForAnalysis = removeAccents((pdfText + " " + simpleName).toLowerCase());

            let detectedCompanyId: number | null = null;
            const identifiedCompany = identifyCompany(textForAnalysis, companies);
            if (identifiedCompany) detectedCompanyId = identifiedCompany.id;

            // Filtro Empresa
            if (filterCompanyIds.length > 0) {
                if (!detectedCompanyId) {
                    if (filterCompanyIds.length === 1) detectedCompanyId = filterCompanyIds[0];
                    else continue;
                } else {
                    if (!filterCompanyIds.includes(detectedCompanyId)) continue;
                }
            }

            let detectedCategory = '';
            const identifiedCat = identifyCategory(
                textForAnalysis, 
                userSettings?.categoryKeywords || {}, 
                userSettings?.priorityCategories || [] 
            );
            detectedCategory = identifiedCat ?? 'Outros';

            // Filtro Categoria
            if (filterCategories.length > 0) {
                if (filterCategories.length === 1 && detectedCategory === 'Outros') detectedCategory = filterCategories[0];
                else if (!filterCategories.includes(detectedCategory)) continue;
            }

            tempFiles.push({
                id: Math.random().toString(36).substr(2, 9),
                file: file,
                fileName: simpleName,
                detectedCompanyId: detectedCompanyId,
                detectedCategory: detectedCategory,
                status: 'ready',
                size: file.size
            });
        }
        
        setPreviewFiles(tempFiles);
        setShowPreviewModal(true);

      } catch (error) {
          console.error("Error reading zip", error);
          alert("Erro ao ler o arquivo ZIP.");
      } finally {
          setProcessing(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
      }
  };

  const updatePreview = (id: string, field: 'detectedCompanyId' | 'detectedCategory', value: any) => {
      setPreviewFiles(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f));
  };

  const removePreview = (id: string) => {
      setPreviewFiles(prev => prev.filter(f => f.id !== id));
  };

  const confirmProcessing = async () => {
      setIsUploadingConfirmed(true);
      const calculatedDates = calcularTodosVencimentos(processingCompetence, userSettings?.categoryRules || {});
      let processedCount = 0;

      for (const item of previewFiles) {
          if (!item.detectedCompanyId) continue;
          const category = item.detectedCategory || 'Outros';
          try {
              const uploadRes = await api.uploadFile(item.file);
              const uploadedFile: UploadedFile = {
                  name: item.fileName,
                  size: item.size,
                  category: category,
                  dueDate: calculatedDates[category] || '',
                  file: item.file,
                  serverFilename: uploadRes.filename
              };
              onUploadSuccess([uploadedFile], item.detectedCompanyId, processingCompetence);
              processedCount++;
          } catch (e) { console.error(`Falha upload ${item.fileName}`, e); }
      }

      setIsUploadingConfirmed(false);
      setShowPreviewModal(false);
      setPreviewFiles([]);
      alert(`${processedCount} arquivos processados e enviados para a aba de Envio.`);
      setLocalPath('');
  };

  const getStatus = (companyId: number, category: string) => {
      const dbStatus = dbStatuses.find(s => s.companyId === companyId && s.category === category && s.competence === activeCompetence);
      if (dbStatus) return dbStatus.status;
      const doc = initialDocuments.find(d => d.companyId === companyId && d.category === category && d.competence === activeCompetence);
      return doc ? doc.status : 'pending';
  };

  const handleToggleStatusLocal = async (companyId: number, category: string) => {
      const currentStatus = getStatus(companyId, category);
      const newStatus = currentStatus === 'sent' ? 'pending' : 'sent';
      const updatedDbStatuses = [...dbStatuses];
      const existingIdx = updatedDbStatuses.findIndex(s => s.companyId === companyId && s.category === category);
      if (existingIdx >= 0) {
          updatedDbStatuses[existingIdx].status = newStatus;
      } else {
          updatedDbStatuses.push({ companyId, category, competence: activeCompetence, status: newStatus });
      }
      setDbStatuses(updatedDbStatuses);
      try {
          await api.updateDocumentStatus(companyId, category, activeCompetence, newStatus);
          onToggleStatus(companyId, category, activeCompetence);
      } catch (e) { console.error("Failed to update status"); }
  };

  const getMatrixCategories = () => {
      if (matrixCategoryFilter !== 'all') {
          return [matrixCategoryFilter];
      }
      return visibleMatrixCategories;
  };

  const getMatrixCompanies = () => {
      return companies.filter(company => {
          const matchesName = (company.name || '').toLowerCase().includes(matrixSearch.toLowerCase());
          if (!matchesName) return false;
          if (matrixCompanyCategoryFilter !== 'all') {
              if (!(company.categories || []).includes(matrixCompanyCategoryFilter)) return false;
          }
          if (matrixStatusFilter !== 'all') {
              const visibleCategories = getMatrixCategories();
              const hasMatchingStatus = visibleCategories.some(cat => {
                  const status = getStatus(company.id, cat);
                  return status === matrixStatusFilter;
              });
              if (!hasMatchingStatus) return false;
          }
          return true;
      });
  };

  const handleSearchCompetence = (e: React.FormEvent) => {
      e.preventDefault();
      setActiveCompetence(competence);
  };

  if (loading && companies.length === 0) {
     return <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border-0 overflow-hidden mb-4">
        <div className="bg-blue-600 text-white py-3 px-6">
            <h5 className="mb-0 flex items-center gap-2 font-bold"><CalendarCheck className="w-5 h-5" /> Verificar Documentos por Competência</h5>
        </div>
        <div className="p-6">
            <form onSubmit={handleSearchCompetence}>
                <div className="flex flex-col md:flex-row gap-4 items-end">
                    <div className="flex-1">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Selecione a competência</label>
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={() => changeCompetence(competence, -1, setCompetence)} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"><ChevronLeft className="w-5 h-5" /></button>
                            <div className="relative flex-1">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><CalendarCheck className="w-5 h-5" /></span>
                                <input type="text" className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-center font-medium text-lg" value={competence} onChange={(e) => { let val = e.target.value.replace(/\D/g, ''); if (val.length > 2) val = val.substring(0, 2) + '/' + val.substring(2, 6); setCompetence(val); }} required />
                            </div>
                            <button type="button" onClick={() => changeCompetence(competence, 1, setCompetence)} className="p-2 border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"><ChevronRight className="w-5 h-5" /></button>
                        </div>
                    </div>
                    <div className="flex-1 md:flex-none md:w-48">
                        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 font-medium"><Search className="w-4 h-4" /> Verificar</button>
                    </div>
                </div>
            </form>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-blue-100 overflow-hidden">
         <div className="bg-blue-50 p-4 border-b border-blue-100 flex items-center gap-2 text-blue-800"><SettingsIcon className="w-5 h-5" /><h3 className="font-bold">Processamento Automático</h3></div>
        <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                
                {/* 1. Arquivos */}
                <div className="lg:col-span-1">
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Arquivos (ZIP ou Múltiplos)</label>
                    <div className="input-group flex items-center border border-gray-300 rounded-lg overflow-hidden bg-white cursor-pointer hover:bg-gray-50" onClick={handleProcessClick}>
                         <span className="px-3 text-gray-400 bg-gray-50 border-r py-2"><FolderArchive className="w-4 h-4" /></span>
                         <input type="text" className="flex-1 px-3 py-2 outline-none text-sm cursor-pointer" placeholder="Selecione arquivos ou ZIP..." value={localPath} readOnly />
                         <input type="file" multiple accept=".zip,.rar,.pdf,.png,.jpg,.jpeg,.doc,.docx" ref={fileInputRef} className="hidden" onChange={handleFileSelect} />
                    </div>
                </div>

                {/* 2. Competência */}
                <div>
                   <label className="block text-sm font-semibold text-gray-700 mb-1">Competência do Processamento</label>
                   <div className="flex gap-1">
                       <button type="button" onClick={() => changeCompetence(processingCompetence, -1, setProcessingCompetence)} className="p-2 border border-gray-300 rounded-l-lg hover:bg-gray-100"><ChevronLeft className="w-4 h-4" /></button>
                       <input type="text" className="w-full border-y border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-center" value={processingCompetence} onChange={(e) => { let val = e.target.value.replace(/\D/g, ''); if (val.length > 2) val = val.substring(0, 2) + '/' + val.substring(2, 6); setProcessingCompetence(val); }} />
                       <button type="button" onClick={() => changeCompetence(processingCompetence, 1, setProcessingCompetence)} className="p-2 border border-gray-300 rounded-r-lg hover:bg-gray-100"><ChevronRight className="w-4 h-4" /></button>
                   </div>
                </div>

                {/* 3. Filtros Multiplos */}
                <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-4 border-t border-gray-100">
                    
                    {/* Filtro Empresas */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Filtrar por Empresa(s)</label>
                        <select className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-sm mb-2" onChange={addCompanyFilter} value="">
                            <option value="">Adicionar filtro de empresa...</option>
                            {companies
                              .filter(c => filterCompanyCategory === '' || (c.categories || []).includes(filterCompanyCategory))
                              .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <div className="flex flex-wrap gap-2 min-h-[32px]">
                            {filterCompanyIds.length === 0 && <span className="text-xs text-gray-400 italic py-1">Automático (Detectar no arquivo)</span>}
                            {filterCompanyIds.map(id => {
                                const comp = companies.find(c => c.id === id);
                                return (
                                    <span key={id} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                                        {comp?.name || id}
                                        <button onClick={() => removeCompanyFilter(id)} className="hover:text-blue-900"><X className="w-3 h-3" /></button>
                                    </span>
                                )
                            })}
                        </div>
                    </div>

                    {/* Filtro Categorias */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Filtrar por Categoria(s)</label>
                        <select className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-sm mb-2" onChange={addCategoryFilter} value="">
                            <option value="">Adicionar filtro de categoria...</option>
                            {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                        <div className="flex flex-wrap gap-2 min-h-[32px]">
                            {filterCategories.length === 0 && <span className="text-xs text-gray-400 italic py-1">Automático (Detectar no arquivo)</span>}
                            {filterCategories.map(cat => (
                                <span key={cat} className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                                    {cat}
                                    <button onClick={() => removeCategoryFilter(cat)} className="hover:text-green-900"><X className="w-3 h-3" /></button>
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Filtro Categoria de Empresas */}
                    {userSettings.companyCategories && userSettings.companyCategories.length > 0 && (
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Filtrar por Categoria de Empresas</label>
                            <select
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                value={filterCompanyCategory}
                                onChange={(e) => setFilterCompanyCategory(e.target.value)}
                            >
                                <option value="">Todas as categorias</option>
                                {userSettings.companyCategories.map(cat => (
                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
                            </select>
                            {filterCompanyCategory && (
                                <p className="text-xs text-gray-400 mt-1 italic">
                                    Empresas filtradas: {companies.filter(c => (c.categories || []).includes(filterCompanyCategory)).length}
                                </p>
                            )}
                        </div>
                    )}
                </div>

            </div>
            <div className="flex flex-col items-center">
                 <button onClick={handleProcessClick} disabled={processing} className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 shadow-lg shadow-blue-500/20 font-bold flex items-center gap-2 disabled:opacity-70 transition-all">
                    {processing ? <><Loader2 className="animate-spin rounded-full h-4 w-4" /> Lendo e Analisando...</> : <><Play className="w-5 h-5" /> Iniciar Processamento Automático</>}
                 </button>
            </div>
        </div>
      </div>

      {showPreviewModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-xl">
                    <h3 className="font-bold text-gray-800 flex items-center gap-2"><FilePlus className="w-5 h-5 text-blue-600" /> Pré-visualização do Processamento</h3>
                    <button onClick={() => { setShowPreviewModal(false); setPreviewFiles([]); }} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-4 bg-yellow-50 border-b border-yellow-100 text-sm text-yellow-800 flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /><div>Verifique se a Empresa e a Categoria foram identificadas corretamente. Arquivos sem Empresa <strong>não serão processados</strong>.</div></div>
                <div className="flex-1 overflow-auto p-0">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10 shadow-sm">
                            <tr><th className="px-4 py-3">Arquivo</th><th className="px-4 py-3 w-1/3">Empresa Vinculada</th><th className="px-4 py-3 w-1/4">Categoria</th><th className="px-4 py-3 w-10 text-center">Ações</th></tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {previewFiles.map((item) => (
                                <tr key={item.id} className="hover:bg-gray-50 group">
                                    <td className="px-4 py-3 font-medium text-gray-700 truncate max-w-[200px]" title={item.fileName}>{item.fileName}</td>
                                    <td className="px-4 py-3">
                                        <select className={`w-full border rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500 ${!item.detectedCompanyId ? 'border-red-300 bg-red-50' : 'border-gray-300'}`} value={item.detectedCompanyId || ''} onChange={(e) => updatePreview(item.id, 'detectedCompanyId', Number(e.target.value) || null)}>
                                            <option value="">-- Selecione a Empresa --</option>
                                            {companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.docNumber})</option>)}
                                        </select>
                                    </td>
                                    <td className="px-4 py-3">
                                        <select className={`w-full border rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500 ${!item.detectedCategory ? 'border-yellow-300 bg-yellow-50' : 'border-gray-300'}`} value={item.detectedCategory} onChange={(e) => updatePreview(item.id, 'detectedCategory', e.target.value)}>
                                            <option value="Outros">Outros</option>
                                            {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                        </select>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button onClick={() => removePreview(item.id)} className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50" title="Remover arquivo"><Trash className="w-4 h-4" /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-xl flex justify-between items-center">
                    <div className="text-sm text-gray-600">Total: <strong>{previewFiles.length}</strong> arquivos.</div>
                    <div className="flex gap-3">
                        <button onClick={() => { setShowPreviewModal(false); setPreviewFiles([]); }} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 font-medium">Cancelar</button>
                        <button onClick={confirmProcessing} disabled={isUploadingConfirmed || previewFiles.length === 0} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold flex items-center gap-2 disabled:opacity-70">{isUploadingConfirmed ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Confirmar e Processar</button>
                    </div>
                </div>
            </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50">
           <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-gray-700">Matriz de Status - <span className="text-blue-600">{activeCompetence}</span></h3>
              <div className="flex gap-3 text-sm"><span className="flex items-center gap-1 text-green-600"><Check className="w-4 h-4" /> Enviado</span><span className="flex items-center gap-1 text-red-500"><X className="w-4 h-4" /> Pendente</span></div>
           </div>
           <div className="flex flex-col md:flex-row gap-4 p-3 bg-white border border-gray-200 rounded-lg">
              <div className="flex-1">
                 <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">Buscar Empresa</label>
                 <div className="relative">
                    <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500" placeholder="Nome da empresa..." value={matrixSearch} onChange={(e) => setMatrixSearch(e.target.value)} />
                 </div>
              </div>
              <div className="flex-1">
                 <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">Filtrar Categoria</label>
                 <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none" value={matrixCategoryFilter} onChange={(e) => setMatrixCategoryFilter(e.target.value)}>
                   <option value="all">Todas as Categorias</option>
                   {visibleMatrixCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                 </select>
              </div>
              <div className="flex-1">
                 <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">Filtrar Status</label>
                 <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none" value={matrixStatusFilter} onChange={(e) => setMatrixStatusFilter(e.target.value as any)}>
                   <option value="all">Todos</option>
                   <option value="pending">Pendente (Exibir se houver)</option>
                   <option value="sent">Enviado (Exibir se houver)</option>
                 </select>
              </div>
              {userSettings.companyCategories && userSettings.companyCategories.length > 0 && (
                <div className="flex-1">
                   <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">Categoria de Empresas</label>
                   <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none" value={matrixCompanyCategoryFilter} onChange={(e) => setMatrixCompanyCategoryFilter(e.target.value)}>
                     <option value="all">Todas</option>
                     {userSettings.companyCategories.map(cat => (
                       <option key={cat.id} value={cat.id}>{cat.name}</option>
                     ))}
                   </select>
                </div>
              )}
           </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-6 py-4 text-left font-semibold text-gray-600 bg-gray-50 min-w-[200px] sticky left-0 shadow-sm z-10">Empresa</th>
                {getMatrixCategories().map(cat => (
                  <th key={cat} className="px-4 py-4 text-center font-semibold text-gray-600 min-w-[100px]">{cat}</th>
                ))}
                <th className="px-4 py-4 text-center font-semibold text-gray-600 bg-gray-50 min-w-[100px] sticky right-0 shadow-sm z-10 border-l">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {getMatrixCompanies().map((company) => (
                <tr key={company.id} className="hover:bg-gray-50 group">
                  <td className="px-6 py-4 font-medium text-gray-900 bg-white group-hover:bg-gray-50 sticky left-0 shadow-sm">{company.name}</td>
                  {getMatrixCategories().map((cat) => {
                     const status = getStatus(company.id, cat);
                     const isSent = status === 'sent';
                     return (
                      <td key={cat} className="px-4 py-4 text-center">
                        <button onClick={() => handleToggleStatusLocal(company.id, cat)} className={`w-8 h-8 rounded-full inline-flex items-center justify-center transition-all duration-200 cursor-pointer ${isSent ? 'bg-green-100 text-green-600 hover:bg-green-200 hover:scale-110' : 'bg-red-50 text-red-500 hover:bg-red-100 hover:scale-110'}`} title={isSent ? 'Clique para marcar como Pendente' : 'Clique para marcar como Enviado'}>
                            {isSent ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                        </button>
                      </td>
                     );
                  })}
                  <td className="px-4 py-4 text-center bg-white group-hover:bg-gray-50 sticky right-0 shadow-sm border-l">
                      <button onClick={() => onNavigateToUpload(company.id, activeCompetence)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Fazer Upload para esta empresa"><Upload className="w-5 h-5" /></button>
                  </td>
                </tr>
              ))}
              {getMatrixCompanies().length === 0 && (
                <tr><td colSpan={getMatrixCategories().length + 2} className="px-6 py-8 text-center text-gray-500">Nenhuma empresa encontrada com os filtros selecionados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Documents;
