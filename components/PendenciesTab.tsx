import React, { useState, useEffect, useMemo } from "react";
import {
  Upload,
  FileText,
  Download,
  Info,
  CheckCircle2,
  AlertTriangle,
  Search,
  ArrowUpDown,
  ClipboardList,
  Loader2,
  History,
  XCircle,
} from "lucide-react";
import { api } from "../services/api";

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface Pendency {
  type: string;
  period: string;
  value: string;
}

interface CompanyPendency {
  id: number | string;
  name: string;
  docNumber: string;
  hasPendencies: boolean;
  pendencies: Pendency[];
  lastUpdated: string;
  unmapped?: boolean;
}

interface SitfisHistorico {
  id: number;
  status: "SOLICITADO" | "PROCESSANDO" | "CONCLUIDO" | "ERRO";
  tentativas: number;
  created_at: string;
  concluido_at: string | null;
  erro_msg: string | null;
  pdf_path: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const parseValue = (val: string) => {
  if (!val) return 0;
  return parseFloat(val.replace(/\./g, "").replace(",", ".")) || 0;
};

const formatValue = (val: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);

const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem("cm_auth_token") || ""}`,
});

// ─── Componente Principal ─────────────────────────────────────────────────────
const PendenciesTab: React.FC = () => {
  const [companies, setCompanies] = useState<CompanyPendency[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<CompanyPendency | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOrder, setSortOrder] = useState<"status_desc" | "status_asc" | "name_asc">("name_asc");

  // SitFis — estado por empresa (id → estado)
  const [sitfisLoading, setSitfisLoading] = useState<Record<string | number, boolean>>({});
  const [sitfisResult, setSitfisResult] = useState<Record<string | number, {
    status: string;
    pdfBase64?: string;
    consultaId?: number;
    mensagem?: string;
    codigo?: string;
  }>>({});

  // Modal de histórico SERPRO
  const [showHistorico, setShowHistorico] = useState(false);
  const [historicoCompany, setHistoricoCompany] = useState<CompanyPendency | null>(null);
  const [historico, setHistorico] = useState<SitfisHistorico[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);

  // ── Fetch lista de empresas ──────────────────────────────────────────────────
  const fetchPendencies = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pendencies/list", { headers: authHeader() });
      const data = await res.json();
      if (data.success) setCompanies(data.list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPendencies(); }, []);

  // ── Upload de PDF (análise por IA) ───────────────────────────────────────────
  const handleUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    companyId?: number | string
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("files", file));
    if (companyId && typeof companyId === "number")
      formData.append("companyId", companyId.toString());
    try {
      const res = await fetch("/api/pendencies/upload", {
        method: "POST",
        headers: authHeader(),
        body: formData,
      });
      const data = await res.json();
      if (data.success) fetchPendencies();
      else alert("Erro ao processar arquivo(s): " + (data.error || "Desconhecido"));
    } catch {
      alert("Erro de conexão ao enviar arquivos.");
    } finally {
      setUploading(false);
    }
  };

  // ── Consulta SERPRO SitFis ────────────────────────────────────────────────────
  const handleConsultarSitfis = async (company: CompanyPendency) => {
    if (typeof company.id === "string") return; // empresa não mapeada, sem id numérico
    const id = company.id as number;
    setSitfisLoading((prev) => ({ ...prev, [id]: true }));
    setSitfisResult((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      const res = await fetch(`/api/pendencies/sitfis/${id}`, {
        method: "POST",
        headers: authHeader(),
      });
      const data = await res.json();

      if (!res.ok) {
        setSitfisResult((prev) => ({
          ...prev,
          [id]: { status: "ERRO", codigo: String(res.status), mensagem: data.error || "Erro desconhecido" },
        }));
        return;
      }

      setSitfisResult((prev) => ({ ...prev, [id]: data }));

      // Recarrega a lista para mostrar os dados extraídos, já que a análise na backend será automática
      if (data.status === "CONCLUIDO") {
        fetchPendencies();
      }
    } catch (e: any) {
      setSitfisResult((prev) => ({
        ...prev,
        [id]: { status: "ERRO", codigo: "CONN", mensagem: "Erro de conexão." },
      }));
    } finally {
      setSitfisLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  // ── Download de PDF do histórico ──────────────────────────────────────────────
  const handleDownloadPdf = async (clienteId: number, consultaId: number, nomeEmpresa: string) => {
    try {
      const res = await fetch(`/api/pendencies/sitfis/${clienteId}/pdf/${consultaId}`, {
        headers: authHeader(),
      });
      if (!res.ok) { alert("PDF não encontrado."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sitfis_${nomeEmpresa}_${consultaId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Erro ao baixar PDF.");
    }
  };

  const downloadPdfFromBase64 = (base64: string, filename: string) => {
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Histórico de consultas ────────────────────────────────────────────────────
  const handleVerHistorico = async (company: CompanyPendency) => {
    if (typeof company.id !== "number") return;
    setHistoricoCompany(company);
    setShowHistorico(true);
    setLoadingHistorico(true);
    try {
      const res = await fetch(`/api/pendencies/sitfis/${company.id}/historico`, { headers: authHeader() });
      const data = await res.json();
      setHistorico(data.historico || []);
    } catch {
      setHistorico([]);
    } finally {
      setLoadingHistorico(false);
    }
  };

  // ── Filtro e ordenação ────────────────────────────────────────────────────────
  const filteredAndSortedCompanies = useMemo(() => {
    let result = companies;
    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(lowerTerm) ||
          (c.docNumber && c.docNumber.includes(lowerTerm))
      );
    }
    result = [...result].sort((a, b) => {
      if (sortOrder === "name_asc") return a.name.localeCompare(b.name);
      const w = (c: CompanyPendency) =>
        c.unmapped ? 3 : c.hasPendencies && c.pendencies.length > 0 ? 2 : c.hasPendencies ? 1 : 0;
      const diff = w(b) - w(a);
      return sortOrder === "status_desc"
        ? diff !== 0 ? diff : a.name.localeCompare(b.name)
        : diff !== 0 ? -diff : a.name.localeCompare(b.name);
    });
    return result;
  }, [companies, searchTerm, sortOrder]);

  const groupedPendencies = useMemo(() => {
    if (!selectedCompany?.pendencies) return {};
    return selectedCompany.pendencies.reduce(
      (acc, curr) => {
        const type = curr.type || "Outros Débitos";
        if (!acc[type]) acc[type] = { items: [], total: 0 };
        acc[type].items.push(curr);
        acc[type].total += parseValue(curr.value);
        return acc;
      },
      {} as Record<string, { items: Pendency[]; total: number }>
    );
  }, [selectedCompany]);

  const toggleStatusSort = () => {
    if (sortOrder === "status_desc") setSortOrder("status_asc");
    else if (sortOrder === "status_asc") setSortOrder("name_asc");
    else setSortOrder("status_desc");
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">
            Situação Fiscal
          </h1>
          <p className="text-sm text-slate-500">
            Mapeie relatórios da Receita Federal via IA ou consulte diretamente pelo SERPRO.
          </p>
        </div>
        <div className="flex items-center space-x-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute text-slate-400 w-4 h-4 left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar empresa..."
              className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm shadow-blue-200 transition-colors whitespace-nowrap">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? "Processando..." : "Upload PDF (IA)"}
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e)}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-3 text-left font-semibold text-slate-600">Empresa</th>
              <th className="px-6 py-3 text-center font-semibold text-slate-600">
                <button
                  onClick={toggleStatusSort}
                  className="flex items-center gap-1 mx-auto hover:text-slate-800 transition-colors"
                >
                  Status <ArrowUpDown className="w-3.5 h-3.5" />
                </button>
              </th>
              <th className="px-6 py-3 text-right font-semibold text-slate-600">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-6 py-12 text-center text-slate-500">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-4 border-blue-100 border-t-blue-500 rounded-full animate-spin" />
                    <p>Carregando lista...</p>
                  </div>
                </td>
              </tr>
            ) : filteredAndSortedCompanies.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-6 py-12 text-center text-slate-500">
                  Nenhuma empresa encontrada com os filtros atuais.
                </td>
              </tr>
            ) : (
              filteredAndSortedCompanies.map((company) => {
                const numericId = typeof company.id === "number" ? company.id : null;
                const isSitfisLoading = numericId ? !!sitfisLoading[numericId] : false;
                const sitfisRes = numericId ? sitfisResult[numericId] : undefined;

                return (
                  <tr key={company.id} className="hover:bg-slate-50 transition-colors">
                    {/* Nome */}
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-800 flex items-center gap-2">
                        {company.unmapped && (
                          <AlertTriangle
                            className="w-4 h-4 text-orange-500 shrink-0"
                            title="Empresa não localizada no banco."
                          />
                        )}
                        {company.name}
                      </div>
                      <div className="text-xs text-slate-500">{company.docNumber || "Sem CNPJ"}</div>
                    </td>

                    {/* Status fiscal */}
                    <td className="px-6 py-4">
                      <div className="flex flex-col items-center gap-1.5">
                        {!company.hasPendencies ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-600">
                            Sem análise
                          </span>
                        ) : company.pendencies.length === 0 ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Regular
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                            <AlertTriangle className="w-3.5 h-3.5" /> Pendente
                          </span>
                        )}
                        {company.hasPendencies && company.lastUpdated && (
                          <span className="text-[10px] text-slate-400">
                            {new Date(company.lastUpdated).toLocaleDateString()}
                          </span>
                        )}

                        {/* Resultado inline do SitFis */}
                        {sitfisRes && (
                          <div className="mt-1 w-full">
                            {sitfisRes.status === "CONCLUIDO" && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                                <CheckCircle2 className="w-3 h-3" /> PDF gerado (SERPRO)
                              </span>
                            )}
                            {sitfisRes.status === "PROCESSANDO" && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                                <Loader2 className="w-3 h-3 animate-spin" /> {sitfisRes.mensagem}
                              </span>
                            )}
                            {sitfisRes.status === "ERRO" && (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-0.5 max-w-[200px] truncate"
                                title={sitfisRes.mensagem}
                              >
                                <XCircle className="w-3 h-3 shrink-0" /> {sitfisRes.mensagem}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Ações */}
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-3 text-sm flex-wrap">
                        <button
                          onClick={() => { setSelectedCompany(company); setShowModal(true); }}
                          disabled={!company.hasPendencies}
                          className="font-medium text-slate-600 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          Ver Detalhes
                        </button>

                        {!company.unmapped && numericId && (
                          <label className="font-medium text-blue-600 hover:text-blue-700 cursor-pointer transition-colors">
                            Upload
                            <input
                              type="file"
                              accept="application/pdf"
                              className="hidden"
                              onChange={(e) => handleUpload(e, company.id)}
                              disabled={uploading}
                            />
                          </label>
                        )}

                        {/* Botão SERPRO */}
                        {!company.unmapped && numericId && (
                          <button
                            onClick={() => handleConsultarSitfis(company)}
                            disabled={isSitfisLoading}
                            title="Consultar Situação Fiscal diretamente no SERPRO"
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm
                              ${isSitfisLoading
                                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200"
                              }`}
                          >
                            {isSitfisLoading ? (
                              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Aguardando SERPRO...</>
                            ) : (
                              <><ClipboardList className="w-3.5 h-3.5" /> Consultar</>
                            )}
                          </button>
                        )}

                        {/* Download de PDF já gerado */}
                        {sitfisRes?.status === "CONCLUIDO" && sitfisRes.pdfBase64 && (
                          <button
                            onClick={() =>
                              downloadPdfFromBase64(
                                sitfisRes.pdfBase64!,
                                `sitfis_${company.name}_${sitfisRes.consultaId}.pdf`
                              )
                            }
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" /> Baixar PDF
                          </button>
                        )}

                        {/* Histórico SERPRO */}
                        {!company.unmapped && numericId && (
                          <button
                            onClick={() => handleVerHistorico(company)}
                            title="Histórico de consultas SERPRO"
                            className="text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            <History className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Modal de Detalhes de Pendências ─────────────────────────────────── */}
      {showModal && selectedCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50/50 shrink-0 rounded-t-2xl">
              <div>
                <h3 className="font-semibold text-lg text-slate-800">Saúde Fiscal Detalhada</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedCompany.name} ({selectedCompany.docNumber})
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full p-1.5 transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {selectedCompany.pendencies.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <h4 className="font-medium text-slate-800 text-lg mb-1">Situação Regular</h4>
                  <p className="text-sm text-slate-500">
                    Nenhuma irregularidade fiscal ou débito foi encontrada no último relatório mapeado pela IA.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {Object.entries(groupedPendencies).map(([type, group], idx) => (
                    <div key={idx} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                      <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-rose-500" />
                          <h4 className="font-semibold text-slate-800 text-sm">{type}</h4>
                          <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full ml-1">
                            {group.items.length} itens
                          </span>
                        </div>
                        <div className="text-sm font-bold text-slate-700">
                          Total:{" "}
                          <span className="text-rose-600 font-mono ml-1">{formatValue(group.total)}</span>
                        </div>
                      </div>
                      <div className="p-4 bg-white flex flex-wrap gap-3">
                        {group.items.map((pend, i) => (
                          <div
                            key={i}
                            className="flex flex-col bg-slate-50 border border-slate-100 rounded-lg p-2.5 min-w-[140px] flex-grow shadow-sm"
                          >
                            <span className="text-xs font-semibold text-slate-600 mb-1">
                              {pend.period || "Sem período"}
                            </span>
                            <span className="text-sm font-mono text-slate-800">
                              {pend.value ? formatValue(parseValue(pend.value)) : "-"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-8 text-xs text-slate-400 flex justify-end items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                Atualizado em:{" "}
                {selectedCompany.lastUpdated
                  ? new Date(selectedCompany.lastUpdated).toLocaleString()
                  : "N/A"}
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t flex justify-end shrink-0 rounded-b-2xl">
              <button
                onClick={() => setShowModal(false)}
                className="px-5 py-2 font-medium bg-white border border-slate-300 shadow-sm rounded-lg hover:bg-slate-100 transition-colors text-slate-700"
              >
                Fechar Detalhes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de Histórico SERPRO ────────────────────────────────────────── */}
      {showHistorico && historicoCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-slate-50/50 shrink-0 rounded-t-2xl">
              <div>
                <h3 className="font-semibold text-lg text-slate-800 flex items-center gap-2">
                  <History className="w-5 h-5 text-indigo-500" />
                  Histórico SERPRO
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">{historicoCompany.name}</p>
              </div>
              <button
                onClick={() => setShowHistorico(false)}
                className="text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-full p-1.5 transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {loadingHistorico ? (
                <div className="flex items-center justify-center py-10 gap-3 text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Carregando histórico...
                </div>
              ) : historico.length === 0 ? (
                <p className="text-center text-slate-500 py-10">
                  Nenhuma consulta SERPRO realizada para esta empresa.
                </p>
              ) : (
                <div className="space-y-3">
                  {historico.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50 gap-4"
                    >
                      <div className="flex items-center gap-3">
                        {item.status === "CONCLUIDO" && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
                        {item.status === "ERRO" && <XCircle className="w-5 h-5 text-rose-500 shrink-0" />}
                        {(item.status === "PROCESSANDO" || item.status === "SOLICITADO") && (
                          <Loader2 className="w-5 h-5 text-blue-500 animate-spin shrink-0" />
                        )}
                        <div>
                          <p className="text-sm font-medium text-slate-800">
                            {new Date(item.created_at).toLocaleString()}
                          </p>
                          <p className="text-xs text-slate-500">
                            Status:{" "}
                            <span
                              className={
                                item.status === "CONCLUIDO"
                                  ? "text-emerald-600"
                                  : item.status === "ERRO"
                                  ? "text-rose-600"
                                  : "text-blue-600"
                              }
                            >
                              {item.status}
                            </span>
                            {item.tentativas > 0 && ` · ${item.tentativas} tentativa(s)`}
                          </p>
                          {item.erro_msg && (
                            <p className="text-xs text-rose-600 mt-0.5 max-w-sm truncate" title={item.erro_msg}>
                              {item.erro_msg}
                            </p>
                          )}
                        </div>
                      </div>
                      {item.status === "CONCLUIDO" && item.pdf_path && (
                        <button
                          onClick={() =>
                            handleDownloadPdf(
                              typeof historicoCompany.id === "number" ? historicoCompany.id : 0,
                              item.id,
                              historicoCompany.name
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 transition-colors shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" /> Baixar PDF
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t flex justify-end shrink-0 rounded-b-2xl">
              <button
                onClick={() => setShowHistorico(false)}
                className="px-5 py-2 font-medium bg-white border border-slate-300 shadow-sm rounded-lg hover:bg-slate-100 transition-colors text-slate-700"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PendenciesTab;