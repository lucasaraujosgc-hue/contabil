const fs = require('fs');

let content = fs.readFileSync('components/Dashboard.tsx', 'utf8');

const targetState = `  const [historyLoaded, setHistoryLoaded] = useState<Record<string, boolean>>({});`;
const replacementState = `  const [historyLoaded, setHistoryLoaded] = useState<Record<string, boolean>>({});
  const [isSyncingAll, setIsSyncingAll] = useState(false);`;

content = content.replace(targetState, replacementState);

const targetHandler = `  const handleLoadContact = async () => {`;
const replacementHandler = `  const handleSyncAllKanbanContacts = async () => {
    if (isSyncingAll) return;
    
    const input = window.prompt('Quantos dias de histórico deseja varrer para TODOS os contatos do Kanban? (ex: 90, 180, 365)', '90');
    if (input === null) return;
    const days = parseInt(input.replace(/\\D/g, ''), 10);
    if (!days || days <= 0) {
      alert('Digite um número de dias válido.');
      return;
    }

    if (!confirm(\`Tem certeza que deseja buscar \${days} dias de mensagens para os \${kanbanState.cards.length} contatos do Kanban? Isso pode levar algum tempo.\`)) {
      return;
    }

    setIsSyncingAll(true);
    let successCount = 0;
    
    try {
      const token = localStorage.getItem('cm_auth_token');
      for (let i = 0; i < kanbanState.cards.length; i++) {
        const card = kanbanState.cards[i];
        const chatId = card.id;
        
        try {
          const res = await fetch(\`/api/whatsapp/load-history/\${chatId}?days=\${days}&force=true\`, {
            method: 'POST',
            headers: { 'Authorization': \`Bearer \${token}\` }
          });
          const result = await res.json();
          if (result.success) {
            successCount++;
            setHistoryLoaded(prev => ({ ...prev, [chatId]: true }));
            checkSyncStatus(chatId);
          }
        } catch (e) {
          console.error(\`Erro ao sincronizar \${card.name}:\`, e);
        }
        
        // Small delay to avoid overwhelming the server/whatsapp connection
        await new Promise(r => setTimeout(r, 1000));
      }
      
      alert(\`Sincronização concluída! \${successCount} de \${kanbanState.cards.length} contatos atualizados.\`);
      
      // Reload current chat if it's open
      if (activeChat) {
          const activeId = activeChat.id._serialized || activeChat.id;
          const msgs = await loadMessagesFromDb(activeId);
          setChatMessages(msgs);
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao sincronizar contatos.');
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleLoadContact = async () => {`;

content = content.replace(targetHandler, replacementHandler);

const targetButton = `           <button 
             onClick={() => setIsConfigModalOpen(true)}
             className="p-1.5 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
             title="Configurar Colunas e Tags"
           >
              <Settings className="w-5 h-5" />
           </button>`;
           
const replacementButton = `           <button 
             onClick={() => setIsConfigModalOpen(true)}
             className="p-1.5 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
             title="Configurar Colunas e Tags"
           >
              <Settings className="w-5 h-5" />
           </button>
           <button 
             onClick={handleSyncAllKanbanContacts}
             className="p-1.5 border border-amber-200 text-amber-600 rounded-lg hover:bg-amber-50 transition-colors"
             title="Atualizar histórico de todos os contatos do Kanban"
           >
              {isSyncingAll ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
           </button>`;

content = content.replace(targetButton, replacementButton);

fs.writeFileSync('components/Dashboard.tsx', content);
