import React, { useState } from 'react';
import { Lock, User, LogIn, Loader2, AlertCircle, CheckSquare } from 'lucide-react';
import { api } from '../services/api';

interface LoginProps {
  onLoginSuccess: (token?: string, remember?: boolean) => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await api.login(user, password);
      if (result.success) {
        onLoginSuccess(result.token, rememberMe);
      } else {
        setError('Usuário ou senha incorretos.');
      }
    } catch (err) {
      setError('Erro ao conectar com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        <div className="bg-gray-50 p-8 text-center border-b border-gray-100">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Contábil Manager Pro</h1>
          <p className="text-gray-500 mt-2">Acesso Restrito</p>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2 border border-red-100">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-700">Usuário</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input 
                type="text" 
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                placeholder="Digite seu usuário"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-700">Senha</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input 
                type="password" 
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                placeholder="Digite sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="flex items-center">
             <label className="flex items-center gap-2 cursor-pointer group">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 rounded text-blue-600 border-gray-300 focus:ring-blue-500"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <span className="text-sm text-gray-600 group-hover:text-blue-600 transition-colors">Permanecer conectado</span>
             </label>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
            {loading ? 'Validando...' : 'Entrar no Sistema'}
          </button>
        </form>
        
        <div className="bg-gray-50 p-4 text-center text-xs text-gray-400 border-t border-gray-100">
          &copy; {new Date().getFullYear()} Contábil Manager. Todos os direitos reservados.
        </div>
      </div>
    </div>
  );
};

export default Login;