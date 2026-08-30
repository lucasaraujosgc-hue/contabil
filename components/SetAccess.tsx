import React, { useEffect, useState } from 'react';
import { Lock, User, Loader2, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { api } from '../services/api';

function strength(pw: string): { score: number; label: string; color: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const map = [
    { label: 'Muito fraca', color: 'bg-red-500' },
    { label: 'Fraca', color: 'bg-orange-500' },
    { label: 'Razoável', color: 'bg-yellow-500' },
    { label: 'Boa', color: 'bg-lime-500' },
    { label: 'Forte', color: 'bg-green-600' },
  ];
  const idx = Math.min(s, 4);
  return { score: idx, ...map[idx] };
}

const SetAccess: React.FC = () => {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<{ name: string; email: string; reset: boolean } | null>(null);
  const [fatal, setFatal] = useState('');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setFatal('Link inválido — falta o token.'); setLoading(false); return; }
    api.getInvite(token)
      .then((data) => setInvite(data))
      .catch((e) => setFatal(e.message || 'Link inválido ou expirado.'))
      .finally(() => setLoading(false));
  }, [token]);

  const pwStrength = strength(password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
    if (password !== confirm) return setError('As senhas não coincidem.');
    setSubmitting(true);
    try {
      await api.activateInvite(token, username.trim(), password);
      setDone(true);
      setTimeout(() => { window.location.href = '/'; }, 2200);
    } catch (err: any) {
      setError(err.message || 'Não foi possível concluir.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-gray-50 p-8 text-center border-b border-gray-100">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Contábil Manager Pro</h1>
          <p className="text-gray-500 mt-2">{invite?.reset ? 'Redefinir senha' : 'Criar seu acesso'}</p>
        </div>

        <div className="p-8">
          {loading && (
            <div className="flex items-center justify-center gap-2 text-gray-500 py-8">
              <Loader2 className="w-5 h-5 animate-spin" /> Validando convite...
            </div>
          )}

          {!loading && fatal && (
            <div className="text-center py-6">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <p className="text-gray-700 font-medium">{fatal}</p>
              <p className="text-sm text-gray-500 mt-2">Peça um novo convite ao administrador.</p>
              <a href="/" className="inline-block mt-5 text-blue-600 font-semibold text-sm">Ir para o login</a>
            </div>
          )}

          {!loading && done && (
            <div className="text-center py-6">
              <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-3" />
              <p className="text-gray-800 font-semibold">Acesso {invite?.reset ? 'redefinido' : 'criado'} com sucesso!</p>
              <p className="text-sm text-gray-500 mt-2">Redirecionando para o login...</p>
            </div>
          )}

          {!loading && invite && !done && (
            <form onSubmit={submit} className="space-y-5">
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-blue-800">
                Definindo acesso para <strong>{invite.name}</strong>
                {invite.email ? <> ({invite.email})</> : null}
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2 border border-red-100">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-gray-700">Nome de usuário</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="ex: maria.fiscal" value={username}
                    onChange={(e) => setUsername(e.target.value)} required minLength={3}
                  />
                </div>
                <p className="text-xs text-gray-400">3–32 caracteres: letras, números, ponto, hífen, underline.</p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-gray-700">Senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="password"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="mínimo 8 caracteres" value={password}
                    onChange={(e) => setPassword(e.target.value)} required minLength={8}
                  />
                </div>
                {password && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-200 rounded overflow-hidden">
                      <div className={`h-full ${pwStrength.color} transition-all`} style={{ width: `${(pwStrength.score + 1) * 20}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-20 text-right">{pwStrength.label}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-gray-700">Confirmar senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="password"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="repita a senha" value={confirm}
                    onChange={(e) => setConfirm(e.target.value)} required
                  />
                </div>
              </div>

              <button
                type="submit" disabled={submitting}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 disabled:opacity-70"
              >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                {submitting ? 'Salvando...' : (invite.reset ? 'Redefinir senha' : 'Criar acesso')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default SetAccess;
