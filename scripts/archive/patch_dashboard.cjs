const fs = require('fs');

let content = fs.readFileSync('components/Dashboard.tsx', 'utf8');

const target1 = `      } else {
        // Trigger a background sync without overwriting the UI state if it fails
        const newLimit = msgLimit + 50;
        setMsgLimit(newLimit);
        const token = localStorage.getItem('cm_auth_token');
        fetch(\`/api/whatsapp/messages/\${encodeURIComponent(chatId)}?limit=\${newLimit}\`, {
          headers: { 'Authorization': \`Bearer \${token}\` }
        }).catch(() => {});
      }`;

const replacement1 = `      } else {
        // Banco local esgotado: busca de fato mais para trás direto no WhatsApp
        // (sem corte de dias), a partir da mensagem mais antiga já conhecida.
        // Isso avança pulando períodos sem conversa (ex: se a última mensagem
        // carregada foi de 3 meses atrás, procura o próximo bloco existente,
        // seja de 6 meses, 1 ano, etc.)
        const oldestMsg = chatMessages.reduce(
          (o, m) => (m.timestamp < o.timestamp ? m : o),
          chatMessages[0]
        );
        const beforeId = oldestMsg?.id?._serialized || oldestMsg?.id?.id || null;

        const token = localStorage.getItem('cm_auth_token');
        const res = await fetch(\`/api/whatsapp/fetch-older/\${encodeURIComponent(chatId)}\`, {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${token}\`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ beforeId })
        });
        const result = await res.json().catch(() => null);

        if (result?.count > 0) {
          const container = document.querySelector('[data-chat-container]');
          const scrollHeightBefore = container?.scrollHeight || 0;

          const refreshed = await loadMessagesFromDb(chatId, oldestMsg?.timestamp);
          setChatMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id?._serialized || m.id?.id));
            const newMsgs = refreshed.filter(m => {
              const id = m.id?._serialized || m.id?.id;
              return !existingIds.has(id);
            });
            return [...newMsgs, ...prev];
          });

          setTimeout(() => {
            if (container) {
              container.scrollTop = container.scrollHeight - scrollHeightBefore;
            }
          }, 50);
        } else if (result?.exhausted) {
          alert('Não há mensagens mais antigas nesta conversa.');
        }
      }`;

content = content.replace(target1, replacement1);

const target2 = `  // Carregar histórico de 45 dias`;

const replacement2 = `  // Carregar histórico com quantidade de dias escolhida pelo usuário (sem limite fixo)
  const loadHistoryCustomDays = async () => {
    if (!activeChat || isLoadingHistory) return;

    const input = window.prompt('Quantos dias de histórico deseja varrer? (ex: 90, 180, 365)', '90');
    if (input === null) return; // usuário cancelou

    const days = parseInt(input.replace(/\\D/g, ''), 10);
    if (!days || days <= 0) {
      alert('Digite um número de dias válido.');
      return;
    }

    const chatId = activeChat.id._serialized || activeChat.id;

    setIsLoadingHistory(true);
    try {
      const token = localStorage.getItem('cm_auth_token');
      const res = await fetch(\`/api/whatsapp/load-history/\${chatId}?days=\${days}&force=true\`, {
        method: 'POST',
        headers: { 'Authorization': \`Bearer \${token}\` }
      });

      const result = await res.json();

      if (result.success) {
        alert(\`✅ \${result.count} mensagens encontradas nos últimos \${days} dias!\`);
        const msgs = await loadMessagesFromDb(chatId);
        setChatMessages(msgs);
        setTimeout(scrollToBottom, 100);
        setHistoryLoaded(prev => ({ ...prev, [chatId]: true }));
        checkSyncStatus(chatId);
      } else {
        alert('Erro ao recuperar mensagens: ' + (result.error || 'Tente novamente'));
      }
    } catch (e: any) {
      alert('Erro de conexão: ' + e.message);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Carregar histórico de 45 dias`;

content = content.replace(target2, replacement2);

const target3 = `                                  {/* Badge de última sync */}`;

const replacement3 = `                                  {/* Recuperar mensagens: escolhe a quantidade de dias, sem limite fixo */}
                                  <button
                                      onClick={loadHistoryCustomDays}
                                      disabled={isLoadingHistory}
                                      className="text-sm bg-white/90 border border-gray-200 text-gray-600 px-4 py-1.5 rounded-full shadow-sm hover:bg-white flex items-center gap-2 transition-all disabled:opacity-50"
                                  >
                                      {isLoadingHistory ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                      Recuperar mensagens
                                  </button>

                                  {/* Badge de última sync */}`;

content = content.replace(target3, replacement3);

fs.writeFileSync('components/Dashboard.tsx', content);
