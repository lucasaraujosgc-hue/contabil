
import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Building2, 
  Users, 
  KanbanSquare, 
  FileText, 
  Upload, 
  Send, 
  CalendarClock, 
  MessageCircle,
  Menu,
  X,
  Mails,
  UserCog,
  LogOut,
  FolderOpen,
  FileSearch
} from 'lucide-react';
import { api } from '../services/api';

interface SidebarProps {
  activePage: string;
  setActivePage: (page: string) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onLogout?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activePage, setActivePage, isOpen, setIsOpen, onLogout }) => {
  const [totalSize, setTotalSize] = useState(0);

  useEffect(() => {
     api.getFileGallery().then(files => {
         const size = files.reduce((acc, f) => acc + (f.size || 0), 0);
         setTotalSize(size);
     }).catch(() => {});
  }, [activePage]); // Refresh size when page changes

  const formatSize = (bytes: number) => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const menuItems = [
    { id: 'kanban', label: 'Kanban (WhatsApp)', icon: MessageCircle },
    { id: 'dashboard', label: 'Painel de Tarefas', icon: LayoutDashboard },
    { id: 'companies', label: 'Empresas', icon: Building2 },
    { id: 'pendencies', label: 'Situação Fiscal', icon: FileSearch },
    { id: 'documents', label: 'Documentos', icon: FileText },
    { id: 'upload', label: 'Upload', icon: Upload },
    { id: 'send', label: 'Envio', icon: Send },
    { id: 'bulksend', label: 'Envio em Massa', icon: Mails },
    { id: 'scheduled', label: 'Agendamentos', icon: CalendarClock },
    { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
    { id: 'gallery', label: 'Galeria de Arquivos', icon: FolderOpen },
    { id: 'settings', label: 'Usuário', icon: UserCog },
  ];

  return (
    <>
      {/* Mobile Toggle */}
      <div className="md:hidden fixed top-0 left-0 w-full bg-white border-b z-50 px-4 py-3 flex justify-between items-center shadow-sm">
        <span className="font-bold text-primary text-lg flex items-center gap-2">
          <FileText className="w-6 h-6" /> Contábil
        </span>
        <button onClick={() => setIsOpen(!isOpen)} className="text-gray-600">
          {isOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Sidebar Container */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-white transform transition-transform duration-300 ease-in-out flex flex-col
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0
      `}>
        <div className="p-4 border-b border-slate-700 hidden md:flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center">
            <FileText className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight">Contábil Pro</span>
        </div>

        <nav className="p-2 space-y-1 mt-14 md:mt-0 flex-1 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActivePage(item.id);
                  if (window.innerWidth < 768) setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors duration-200
                  ${isActive 
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
              >
                <div className="flex-1 flex items-center gap-3">
                  <Icon className="w-4 h-4" />
                  <span className="font-medium text-sm">{item.label}</span>
                </div>
                {item.id === 'gallery' && (
                  <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded-full text-slate-300">
                    {formatSize(totalSize)}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Logout Section */}
        {onLogout && (
            <div className="p-3 border-t border-slate-800">
                <button 
                    onClick={onLogout}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors duration-200"
                >
                    <LogOut className="w-4 h-4" />
                    <span className="font-medium text-sm">Sair</span>
                </button>
            </div>
        )}
      </div>
    </>
  );
};

export default Sidebar;