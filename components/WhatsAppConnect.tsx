import React, { useState, useEffect } from 'react';
import { Smartphone, RefreshCw, CheckCircle2, Loader2, Power, QrCode, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';

const WhatsAppConnect: React.FC = () => {
  const [status, setStatus] = useState<'disconnected' | 'generating_qr' | 'ready' | 'connected'>('disconnected');
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchStatus = async () => {
      try {
          const data = await api.getWhatsAppStatus();
          setRunning(!!data.running);
          if (data.qr || data.status === 'connected' || !data.running) setBusy(false);
          if (data.status === 'connected') {
              setStatus('connected');
              setSessionInfo(data.info || { name: 'Sessão Ativa', device: 'WhatsApp Web' });
              setQrCodeBase64(null);
          } else if (data.qr) {
              setStatus('ready');
              setQrCodeBase64(data.qr);
          } else {
              // Disconnected but no QR yet (maybe generating)
              if (status !== 'generating_qr') setStatus('disconnected');
          }
      } catch (e) {
          console.error('Failed to fetch WA status', e);
      }
  };

  useEffect(() => {
      fetchStatus();
      const interval = setInterval(fetchStatus, 3000); // Poll every 3s
      return () => clearInterval(interval);
  }, []);

  // Liga o navegador e começa a gerar o QR.
  const handleConnect = async () => {
      setBusy(true);
      try {
          await api.connectWhatsApp();
      } catch (e: any) {
          setBusy(false);
          alert('Não foi possível iniciar: ' + e.message);
      }
  };

  // Para a geração de QR e desliga o navegador, SEM desvincular o aparelho.
  const handleStop = async () => {
      setBusy(true);
      try {
          await api.stopWhatsApp();
          setStatus('disconnected');
          setQrCodeBase64(null);
          setSessionInfo(null);
      } catch (e: any) {
          alert('Não foi possível parar: ' + e.message);
      } finally {
          setBusy(false);
      }
  };

  const handleDisconnect = async () => {
      if(confirm('Tem certeza que deseja desconectar o WhatsApp?')) {
          await api.disconnectWhatsApp();
          setStatus('disconnected');
          setSessionInfo(null);
      }
  };

  const handleHardReset = async () => {
      if(confirm('ATENÇÃO: Isso irá apagar todos os dados da sessão e forçar um novo QR Code. Use isso se o WhatsApp estiver travado ou com erros de envio. Continuar?')) {
          setIsResetting(true);
          try {
              await api.resetWhatsAppSession();
              alert("Sessão resetada. Aguarde alguns segundos e escaneie o novo QR Code.");
              setStatus('disconnected');
              setQrCodeBase64(null);
          } catch (e: any) {
              alert("Erro ao resetar: " + e.message);
          } finally {
              setIsResetting(false);
          }
      }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8 animate-in fade-in duration-500">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-800 mb-2 flex items-center justify-center gap-2">
            <MessageCircle className="w-8 h-8 text-green-600" /> WhatsApp Web
        </h1>
        <p className="text-gray-500 max-w-md mx-auto">
            A sessão só é iniciada quando você clica em Gerar QR Code.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 w-full max-w-md overflow-hidden p-8 text-center relative">
          
          {status === 'disconnected' && (
              <div className="space-y-6">
                  <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto text-gray-400">
                      <Smartphone className="w-10 h-10" />
                  </div>
                  {busy || running ? (
                      <>
                          <div>
                              <h3 className="text-lg font-bold text-gray-800">Iniciando sessão...</h3>
                              <p className="text-sm text-gray-500 mt-2">
                                  Abrindo o navegador no servidor. O QR Code aparece em alguns segundos.
                              </p>
                          </div>
                          <div className="flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
                          <button
                            onClick={handleStop}
                            className="text-gray-600 hover:text-gray-900 text-sm font-medium flex items-center justify-center gap-2 mx-auto py-2 px-4 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                              <Power className="w-4 h-4" /> Parar
                          </button>
                      </>
                  ) : (
                      <>
                          <div>
                              <h3 className="text-lg font-bold text-gray-800">Desconectado</h3>
                              <p className="text-sm text-gray-500 mt-2">
                                  O navegador está desligado e nenhum QR Code está sendo gerado.
                              </p>
                          </div>
                          <button
                            onClick={handleConnect}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-3 rounded-lg flex items-center justify-center gap-2 mx-auto transition-colors"
                          >
                              <QrCode className="w-5 h-5" /> Gerar QR Code
                          </button>
                      </>
                  )}
              </div>
          )}

          {(status === 'ready' || status === 'generating_qr') && qrCodeBase64 && (
              <div className="space-y-6 animate-in zoom-in-95 duration-300">
                  <div className="border-4 border-gray-800 rounded-xl p-2 inline-block bg-white relative group">
                      <img src={qrCodeBase64} alt="Scan Me" className="w-64 h-64 object-contain" />
                  </div>
                  
                  <div className="text-left space-y-3 text-sm text-gray-600 bg-gray-50 p-4 rounded-lg">
                      <p className="font-bold text-gray-800 mb-2">Instruções:</p>
                      <ol className="list-decimal pl-4 space-y-1">
                          <li>Abra o WhatsApp no seu celular.</li>
                          <li>Toque em <strong>Menu</strong> (Android) ou <strong>Configurações</strong> (iPhone).</li>
                          <li>Selecione <strong>Aparelhos Conectados</strong>.</li>
                          <li>Toque em <strong>Conectar um aparelho</strong>.</li>
                          <li>Aponte a câmera para a tela.</li>
                      </ol>
                  </div>

                  <button
                    onClick={handleStop}
                    disabled={busy}
                    className="text-red-600 hover:text-red-800 text-sm font-medium flex items-center justify-center gap-2 w-full py-2 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                      <Power className="w-4 h-4" /> Parar geração do QR Code
                  </button>
                  <p className="text-xs text-gray-400 -mt-3">
                      Encerra o navegador sem desvincular o aparelho.
                  </p>
              </div>
          )}

          {status === 'connected' && (
              <div className="py-6 space-y-6 animate-in zoom-in-95 duration-300">
                  <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto relative">
                      <CheckCircle2 className="w-12 h-12 text-green-600" />
                      <span className="absolute bottom-0 right-0 w-6 h-6 bg-green-500 border-4 border-white rounded-full"></span>
                  </div>
                  
                  <div>
                      <h3 className="text-2xl font-bold text-gray-800">Conectado!</h3>
                      <p className="text-gray-500 mt-1">Seu WhatsApp está pronto para envio.</p>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 text-left">
                      <div className="flex justify-between items-center border-b border-gray-200 pb-2 mb-2">
                          <span className="text-xs font-semibold text-gray-500 uppercase">Sessão</span>
                          <span className="text-sm font-bold text-green-600 flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-green-600"></span> Online
                          </span>
                      </div>
                      <div className="space-y-1">
                           <p className="text-sm text-gray-700 flex justify-between">
                               <span>Plataforma:</span> <strong>{sessionInfo?.platform || 'Web'}</strong>
                           </p>
                           <p className="text-sm text-gray-700 flex justify-between">
                               <span>Usuário:</span> <strong>{sessionInfo?.pushname || 'Usuário'}</strong>
                           </p>
                      </div>
                  </div>

                  <button
                    onClick={handleStop}
                    disabled={busy}
                    className="text-gray-700 hover:text-gray-900 text-sm font-medium flex items-center justify-center gap-2 w-full py-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                      <Power className="w-4 h-4" /> Desligar (mantém o aparelho vinculado)
                  </button>

                  <button 
                    onClick={handleDisconnect}
                    className="text-red-500 hover:text-red-700 text-sm font-medium flex items-center justify-center gap-2 w-full py-2 hover:bg-red-50 rounded-lg transition-colors"
                  >
                      <Power className="w-4 h-4" /> Desconectar Normal
                  </button>
              </div>
          )}

          {/* Hard Reset Button - Always visible at bottom if needed */}
          <div className="mt-8 pt-4 border-t border-gray-100">
              <button 
                onClick={handleHardReset}
                disabled={isResetting}
                className="text-xs text-orange-500 hover:text-orange-700 flex items-center justify-center gap-2 w-full transition-colors"
                title="Use se o WhatsApp estiver travado ou com erros"
              >
                  {isResetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                  {isResetting ? "Resetando..." : "Problemas? Resetar Conexão (Limpar Sessão)"}
              </button>
          </div>

      </div>
      
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Smartphone className="w-4 h-4" />
        <span>Integração via WhatsApp Web.js</span>
      </div>
    </div>
  );
};

// Helper Icon
function MessageCircle(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  )
}

export default WhatsAppConnect;