import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import TaskDashboard from './components/TaskDashboard';
import Kanban from './components/Kanban';
import Companies from './components/Companies';
import WhatsAppConnect from './components/WhatsAppConnect';
import Documents from './components/Documents';
import Upload from './components/Upload';
import BulkSend from './components/BulkSend';
import ScheduledMessages from './components/ScheduledMessages';
import Settings from './components/Settings';
import Send from './components/Send'; 
import Login from './components/Login';
import AiFab from './components/AiFab';
import FileGallery from './components/FileGallery';
import PendenciesTab from './components/PendenciesTab';
import { DEFAULT_USER_SETTINGS, MOCK_DOCUMENTS } from './constants';
import { UserSettings, Document, UploadedFile } from './types';
import { api } from './services/api';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activePage, setActivePage] = useState('kanban');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  // Inicia sempre com os padrões completos
  const [userSettings, setUserSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [documents, setDocuments] = useState<Document[]>(MOCK_DOCUMENTS);
  const [uploadPreFill, setUploadPreFill] = useState<{companyId: number, competence: string} | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('cm_auth_token');
    if (token) {
        setIsAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
        api.getSettings().then(settings => {
            if (settings && typeof settings === 'object') {
                setUserSettings(prev => ({
                    ...prev,
                    ...settings,
                    // Garante que sub-objetos críticos não sumam se o merge for parcial
                    categoryKeywords: { ...prev.categoryKeywords, ...(settings.categoryKeywords || {}) },
                    categoryRules: { ...prev.categoryRules, ...(settings.categoryRules || {}) },
                    priorityCategories: settings.priorityCategories || prev.priorityCategories || [],
                    visibleDocumentCategories: settings.visibleDocumentCategories || prev.visibleDocumentCategories || []
                }));
            }
        }).catch(err => console.error("Failed to load settings", err));
    }
  }, [isAuthenticated]);

  const handleLoginSuccess = (token?: string, remember?: boolean) => {
      if (remember && token) {
          localStorage.setItem('cm_auth_token', token);
      }
      setIsAuthenticated(true);
  };

  const handleLogout = () => {
      localStorage.removeItem('cm_auth_token');
      setIsAuthenticated(false);
      setActivePage('dashboard');
  };

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  const handleNavigateToUpload = (companyId: number, competence: string) => {
    setUploadPreFill({ companyId, competence });
    setActivePage('upload');
  };

  const handleNavigateToDocuments = () => {
    setActivePage('documents');
  }

  const handleUploadSuccess = (files: UploadedFile[], companyId: number, competence: string) => {
      const newDocs: Document[] = files.map(f => ({
          id: Date.now() + Math.random(),
          name: f.name,
          category: f.category,
          competence: competence,
          dueDate: f.dueDate,
          status: 'pending', 
          companyId: companyId,
          companyName: 'Loading...', 
          file: f.file,
          serverFilename: f.serverFilename
      }));
      setDocuments(prev => [...prev, ...newDocs]);
  };

  const handleToggleStatus = (companyId: number, category: string, competence: string) => {
      setDocuments(prev => {
          const existingIndex = prev.findIndex(d => 
              d.companyId === companyId && 
              d.category === category && 
              d.competence === competence
          );

          if (existingIndex >= 0) {
              const newDocs = [...prev];
              newDocs[existingIndex] = {
                  ...newDocs[existingIndex],
                  status: newDocs[existingIndex].status === 'sent' ? 'pending' : 'sent'
              };
              return newDocs;
          } else {
              const newDoc: Document = {
                  id: Date.now(),
                  name: `Manual - ${category}`,
                  category: category,
                  competence: competence,
                  dueDate: '',
                  status: 'sent', 
                  companyId: companyId,
                  companyName: 'Manual Entry',
                  isManual: true
              };
              return [...prev, newDoc];
          }
      });
  };

  const handleSendDocuments = (docIds: number[]) => {
      setDocuments(prev => prev.map(doc => {
          if (docIds.includes(doc.id)) {
              return { ...doc, status: 'sent' };
          }
          return doc;
      }));
  };

  const handleDeleteDocument = (id: number) => {
      if(window.confirm("Tem certeza que deseja remover este arquivo da lista de envio?")) {
          setDocuments(prev => prev.filter(d => d.id !== id));
      }
  };

  const handleClearPendingDocuments = (competenceFilter: string) => {
      if(window.confirm(`Tem certeza que deseja excluir TODOS os arquivos pendentes da competência ${competenceFilter}?`)) {
          setDocuments(prev => prev.filter(d => !(d.status === 'pending' && d.competence === competenceFilter)));
      }
  };

  const renderContent = () => {
    switch (activePage) {
      case 'kanban':
        return <Dashboard 
                 userSettings={userSettings} 
                 onSaveSettings={setUserSettings} 
               />;
      case 'dashboard':
        return <TaskDashboard userSettings={userSettings} />;
      case 'companies':
        return <Companies 
                 userSettings={userSettings} 
               />;
      case 'whatsapp':
        return <WhatsAppConnect />;
      case 'documents':
        return <Documents 
                  userSettings={userSettings} 
                  onNavigateToUpload={handleNavigateToUpload}
                  documents={documents}
                  onToggleStatus={handleToggleStatus}
                  onUploadSuccess={handleUploadSuccess}
               />;
      case 'upload':
        return <Upload 
                  preFillData={uploadPreFill} 
                  onUploadSuccess={handleUploadSuccess}
                  userSettings={userSettings}
               />;
      case 'send':
        return <Send 
                  documents={documents}
                  onSendDocuments={handleSendDocuments}
                  onNavigateToDocuments={handleNavigateToDocuments}
                  userSettings={userSettings}
                  onDeleteDocument={handleDeleteDocument}
                  onClearPendingDocuments={handleClearPendingDocuments}
               />;
      case 'bulksend':
        return <BulkSend userSettings={userSettings} />;
      case 'scheduled':
        return <ScheduledMessages />;
      case 'settings':
        return <Settings settings={userSettings} onSave={setUserSettings} />;
      case 'gallery':
        return <FileGallery />;
      case 'pendencies':
        return <PendenciesTab />;
      default:
        return (
          <div className="flex flex-col items-center justify-center h-[50vh] text-gray-400">
            <h2 className="text-xl font-semibold mb-2">Em Construção</h2>
            <p>A página {activePage} será implementada em breve.</p>
          </div>
        );
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar 
        activePage={activePage} 
        setActivePage={setActivePage} 
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        onLogout={handleLogout}
      />
      
      <main className="flex-1 overflow-hidden w-full relative flex flex-col">
        {activePage !== 'dashboard' && activePage !== 'kanban' && (
          <header className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center sticky top-0 z-30 shrink-0">
            <h2 className="text-lg font-semibold text-gray-700 capitalize">
              {activePage === 'bulksend' ? 'Envio em Massa' : activePage === 'settings' ? 'Usuário' : activePage === 'send' ? 'Envio' : activePage === 'pendencies' ? 'Situação Fiscal' : activePage}
            </h2>
            <div className="flex items-center gap-4">
               <div className="text-sm text-right hidden sm:block">
                  <p className="font-bold text-gray-700">Lucas Araújo</p>
                  <p className="text-gray-500 text-xs">Contador | CRC-BA 046968/O</p>
               </div>
               <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold border-2 border-white shadow-sm">
                  LA
               </div>
            </div>
          </header>
        )}

        {activePage === 'dashboard' ? (
          <div className="flex-1 overflow-hidden">
            {renderContent()}
          </div>
        ) : (
          <div className="p-6 max-w-7xl mx-auto pb-20 flex-1 overflow-auto w-full">
            {renderContent()}
          </div>
        )}
      </main>
      
      <AiFab />
    </div>
  );
};

export default App;
