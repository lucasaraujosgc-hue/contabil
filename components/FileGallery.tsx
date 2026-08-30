import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';
import {
  FolderOpen, Download, Trash2, FileText, Image as ImageIcon,
  Music, Video, File, RefreshCw, MessageCircle, Mail,
  Search, SlidersHorizontal, ArrowUpDown, CheckSquare, Square,
  X, ChevronDown, ArrowUp, ArrowDown, Eye
} from 'lucide-react';

type SortField = 'timestamp' | 'originalName' | 'size';
type SortDir = 'asc' | 'desc';

const FileGallery: React.FC = () => {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [previewFile, setPreviewFile] = useState<any | null>(null);

  // Filtros
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterChannel, setFilterChannel] = useState('all');
  const [filterDirection, setFilterDirection] = useState('all');

  // Ordenação
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const loadFiles = async () => {
    try {
      setLoading(true);
      const data = await api.getFileGallery();
      setFiles(data);
      setSelected(new Set());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadFiles(); }, []);

  const formatSize = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isPreviewable = (mimeType: string) => {
    if (!mimeType) return false;
    const group = getMimeGroup(mimeType);
    return ['image', 'video', 'audio'].includes(group) || mimeType.includes('pdf');
  };

  const getMimeGroup = (mimeType: string) => {
    if (!mimeType) return 'other';
    if (mimeType.includes('image')) return 'image';
    if (mimeType.includes('audio')) return 'audio';
    if (mimeType.includes('video')) return 'video';
    if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text')) return 'document';
    return 'other';
  };

  const getIcon = (mimeType: string, size = 'md') => {
    const cls = size === 'lg' ? 'w-10 h-10' : 'w-7 h-7';
    const group = getMimeGroup(mimeType);
    if (group === 'image') return <ImageIcon className={`${cls} text-blue-500`} />;
    if (group === 'audio') return <Music className={`${cls} text-amber-500`} />;
    if (group === 'video') return <Video className={`${cls} text-rose-500`} />;
    if (group === 'document') return <FileText className={`${cls} text-red-400`} />;
    return <File className={`${cls} text-gray-400`} />;
  };

  const typeLabel: Record<string, string> = {
    all: 'Todos os tipos', image: 'Imagens', audio: 'Áudios',
    video: 'Vídeos', document: 'Documentos', other: 'Outros'
  };

  // Filtro + ordenação
  const filtered = useMemo(() => {
    let result = [...files];

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(f =>
        (f.originalName || '').toLowerCase().includes(q) ||
        (f.contact || '').toLowerCase().includes(q)
      );
    }
    if (filterType !== 'all') result = result.filter(f => getMimeGroup(f.mimeType) === filterType);
    if (filterChannel !== 'all') result = result.filter(f => (f.channel || '').toLowerCase().includes(filterChannel));
    if (filterDirection !== 'all') result = result.filter(f => f.direction === filterDirection);

    result.sort((a, b) => {
      let va: any, vb: any;
      if (sortField === 'timestamp') { va = new Date(a.timestamp).getTime(); vb = new Date(b.timestamp).getTime(); }
      else if (sortField === 'size') { va = a.size || 0; vb = b.size || 0; }
      else { va = (a.originalName || '').toLowerCase(); vb = (b.originalName || '').toLowerCase(); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [files, search, filterType, filterChannel, filterDirection, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3.5 h-3.5 text-gray-300" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5 text-blue-500" />
      : <ArrowDown className="w-3.5 h-3.5 text-blue-500" />;
  };

  // Seleção
  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(f => f.id)));
  };

  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  const someSelected = selected.size > 0;

  const handleDelete = async (id: number) => {
    if (!confirm('Deseja deletar este arquivo?')) return;
    try {
      await api.deleteFileGallery(id);
      setFiles(prev => prev.filter(f => f.id !== id));
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    } catch { alert('Erro ao excluir'); }
  };

  const handleDeleteSelected = async () => {
    if (!confirm(`Deseja deletar ${selected.size} arquivo(s) selecionado(s)?`)) return;
    try {
      for (const id of selected) await api.deleteFileGallery(id);
      setFiles(prev => prev.filter(f => !selected.has(f.id)));
      setSelected(new Set());
    } catch { alert('Erro ao excluir selecionados'); }
  };

  const handleDownloadSelected = () => {
    const token = localStorage.getItem('cm_auth_token');
    for (const id of selected) {
      window.open(`/api/file-gallery/download/${id}?token=${token}`, '_blank');
    }
  };

  const hasActiveFilters = search || filterType !== 'all' || filterChannel !== 'all' || filterDirection !== 'all';

  const clearFilters = () => {
    setSearch('');
    setFilterType('all');
    setFilterChannel('all');
    setFilterDirection('all');
  };

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-blue-500" />
            Galeria de Arquivos
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {filtered.length} de {files.length} arquivo(s)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadFiles} className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Barra de filtros */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
        {/* Linha 1: busca + limpar */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por nome ou contato..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-gray-50"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors whitespace-nowrap">
              <X className="w-3.5 h-3.5" /> Limpar filtros
            </button>
          )}
        </div>

        {/* Linha 2: dropdowns de filtro + ordenação */}
        <div className="flex flex-wrap gap-2">
          {/* Tipo */}
          <div className="relative">
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className={`pl-3 pr-8 py-2 text-sm border rounded-lg outline-none appearance-none cursor-pointer transition-colors ${filterType !== 'all' ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 bg-gray-50 text-gray-600'}`}
            >
              <option value="all">Todos os tipos</option>
              <option value="image">Imagens</option>
              <option value="audio">Áudios</option>
              <option value="video">Vídeos</option>
              <option value="document">Documentos</option>
              <option value="other">Outros</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>

          {/* Canal */}
          <div className="relative">
            <select
              value={filterChannel}
              onChange={e => setFilterChannel(e.target.value)}
              className={`pl-3 pr-8 py-2 text-sm border rounded-lg outline-none appearance-none cursor-pointer transition-colors ${filterChannel !== 'all' ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 bg-gray-50 text-gray-600'}`}
            >
              <option value="all">Todos os canais</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>

          {/* Direção */}
          <div className="relative">
            <select
              value={filterDirection}
              onChange={e => setFilterDirection(e.target.value)}
              className={`pl-3 pr-8 py-2 text-sm border rounded-lg outline-none appearance-none cursor-pointer transition-colors ${filterDirection !== 'all' ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 bg-gray-50 text-gray-600'}`}
            >
              <option value="all">Enviados e recebidos</option>
              <option value="sent">Enviados</option>
              <option value="received">Recebidos</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>

          {/* Separador visual */}
          <div className="w-px bg-gray-200 mx-1 self-stretch" />

          {/* Ordenação */}
          <span className="flex items-center gap-1 text-xs text-gray-400 self-center">
            <ArrowUpDown className="w-3.5 h-3.5" /> Ordenar:
          </span>
          {(['timestamp', 'originalName', 'size'] as SortField[]).map(f => (
            <button
              key={f}
              onClick={() => toggleSort(f)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors ${sortField === f ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
            >
              {f === 'timestamp' ? 'Data' : f === 'originalName' ? 'Nome' : 'Tamanho'}
              <SortIcon field={f} />
            </button>
          ))}
        </div>
      </div>

      {/* Barra de seleção */}
      {filtered.length > 0 && (
        <div className={`rounded-xl border px-4 py-3 flex flex-wrap gap-3 items-center transition-colors ${someSelected ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-100 shadow-sm'}`}>
          <button onClick={toggleSelectAll} className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors">
            {allSelected
              ? <CheckSquare className="w-4.5 h-4.5 text-blue-600" />
              : <Square className="w-4.5 h-4.5 text-gray-400" />
            }
            {allSelected ? 'Desmarcar todos' : `Selecionar todos (${filtered.length})`}
          </button>

          {someSelected && (
            <>
              <span className="text-sm text-blue-600 font-semibold">{selected.size} selecionado(s)</span>
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={handleDownloadSelected}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Baixar selecionados
                </button>
                <button
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Excluir selecionados
                </button>
                <button onClick={() => setSelected(new Set())} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Grid de arquivos */}
      {loading ? (
        <div className="flex justify-center items-center py-20">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-16 text-center text-gray-400">
          <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">{hasActiveFilters ? 'Nenhum arquivo encontrado com esses filtros.' : 'Nenhum arquivo na galeria.'}</p>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="mt-3 text-sm text-blue-500 hover:underline">
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(file => {
            const isSelected = selected.has(file.id);
            return (
              <div
                key={file.id}
                onClick={() => toggleSelect(file.id)}
                className={`bg-white rounded-xl border shadow-sm flex flex-col gap-3 hover:shadow-md transition-all cursor-pointer select-none ${isSelected ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-100'}`}
              >
                {/* Topo do card com checkbox */}
                <div className="flex items-start gap-3 p-4 pb-0">
                  <div className="mt-0.5 shrink-0">
                    {isSelected
                      ? <CheckSquare className="w-5 h-5 text-blue-600" />
                      : <Square className="w-5 h-5 text-gray-300" />
                    }
                  </div>
                  <div className={`p-2.5 rounded-lg shrink-0 ${isSelected ? 'bg-blue-50' : 'bg-slate-50'}`}>
                    {getIcon(file.mimeType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-800 text-sm truncate" title={file.originalName}>{file.originalName}</h3>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-1 flex-wrap">
                      <span className="bg-gray-100 px-1.5 py-0.5 rounded font-medium">{formatSize(file.size)}</span>
                      <span>{new Date(file.timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                  </div>
                </div>

                {/* Metadados */}
                <div className="mx-4 bg-gray-50 rounded-lg px-3 py-2 text-xs flex flex-col gap-1.5">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Contato</span>
                    <span className="font-medium text-gray-600 truncate max-w-[140px]" title={file.contact}>{file.contact || 'Desconhecido'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Canal</span>
                    <span className="font-medium text-gray-600 flex items-center gap-1">
                      {file.channel?.toLowerCase().includes('whatsapp') && <MessageCircle className="w-3 h-3 text-green-500" />}
                      {file.channel?.toLowerCase().includes('email') && <Mail className="w-3 h-3 text-blue-500" />}
                      {file.channel}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Direção</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${file.direction === 'sent' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                      {file.direction === 'sent' ? 'Enviado' : 'Recebido'}
                    </span>
                  </div>
                </div>

                {/* Ações */}
                <div className="flex gap-2 px-4 pb-4 mt-auto" onClick={e => e.stopPropagation()}>
                  {isPreviewable(file.mimeType) && (
                    <button
                      onClick={() => setPreviewFile(file)}
                      className="flex-1 flex justify-center items-center gap-1.5 bg-gray-50 text-gray-700 hover:bg-gray-200 py-2 rounded-lg text-sm font-medium transition-colors border border-gray-200"
                    >
                      <Eye className="w-3.5 h-3.5" /> Ver
                    </button>
                  )}
                  <button
                    onClick={() => window.open(`/api/file-gallery/download/${file.id}?token=${localStorage.getItem('cm_auth_token')}`, '_blank')}
                    className="flex-1 flex justify-center items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" /> Baixar
                  </button>
                  <button
                    onClick={() => handleDelete(file.id)}
                    className="flex justify-center items-center px-3 bg-red-50 text-red-500 hover:bg-red-100 rounded-lg transition-colors"
                    title="Excluir"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm" onClick={() => setPreviewFile(null)}>
            <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50 shrink-0">
                    <div className="flex items-center gap-3 truncate pr-4">
                        <div className="p-2 bg-white rounded-lg shadow-sm">
                            {getIcon(previewFile.mimeType)}
                        </div>
                        <div className="truncate">
                            <h3 className="font-bold text-gray-800 truncate" title={previewFile.originalName}>{previewFile.originalName}</h3>
                            <p className="text-xs text-gray-500">{formatSize(previewFile.size)} • {previewFile.contact}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => window.open(`/api/file-gallery/download/${previewFile.id}?token=${localStorage.getItem('cm_auth_token')}`, '_blank')}
                            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Baixar"
                        >
                            <Download className="w-5 h-5" />
                        </button>
                        <button onClick={() => setPreviewFile(null)} className="p-2 text-gray-400 hover:bg-gray-200 hover:text-gray-700 rounded-lg transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>
                
                <div className="flex-1 overflow-auto p-6 bg-gray-100/50 flex items-center justify-center min-h-[300px]">
                    {getMimeGroup(previewFile.mimeType) === 'image' && (
                        <img src={`/api/file-gallery/view/${previewFile.id}?token=${localStorage.getItem('cm_auth_token')}`} alt={previewFile.originalName} className="max-w-full max-h-[70vh] rounded-lg shadow-sm object-contain" />
                    )}
                    {getMimeGroup(previewFile.mimeType) === 'video' && (
                        <video src={`/api/file-gallery/view/${previewFile.id}?token=${localStorage.getItem('cm_auth_token')}`} controls autoPlay className="max-w-full max-h-[70vh] rounded-lg shadow-sm" />
                    )}
                    {getMimeGroup(previewFile.mimeType) === 'audio' && (
                        <audio src={`/api/file-gallery/view/${previewFile.id}?token=${localStorage.getItem('cm_auth_token')}`} controls autoPlay className="w-full max-w-md" />
                    )}
                    {previewFile.mimeType?.includes('pdf') && (
                        <iframe src={`/api/file-gallery/view/${previewFile.id}?token=${localStorage.getItem('cm_auth_token')}`} className="w-full h-[70vh] rounded-lg shadow-sm border-0" title={previewFile.originalName} />
                    )}
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default FileGallery;
