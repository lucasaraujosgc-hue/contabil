import React, { useState, useEffect } from 'react';
import { X, Trash, Loader2 } from 'lucide-react';
import { Task, TaskPriority, TaskStatus, Company } from '../types';
import { api } from '../services/api';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  onSave: (task: Task) => void;
  onDelete?: (taskId: number) => void;
}

const COLORS = [
  { value: '#FF6B6B', label: 'Vermelho' },
  { value: '#4ECDC4', label: 'Verde Água' },
  { value: '#45B7D1', label: 'Azul Claro' },
  { value: '#FFA07A', label: 'Salmão' },
  { value: '#98D8C8', label: 'Verde Menta' },
  { value: '#F7DC6F', label: 'Amarelo Claro' },
  { value: '#BB8FCE', label: 'Lavanda' },
  { value: '#85C1E9', label: 'Azul Céu' },
  { value: '#F8C471', label: 'Laranja Claro' },
  { value: '#D7BDE2', label: 'Lilás' }
];

const TaskModal: React.FC<TaskModalProps> = ({ isOpen, onClose, task, onSave, onDelete }) => {
  const [formData, setFormData] = useState<Partial<Task>>({
    title: '',
    description: '',
    priority: TaskPriority.MEDIUM,
    status: TaskStatus.PENDING,
    color: COLORS[0].value,
    dueDate: '',
    recurrence: 'nenhuma',
    dayOfWeek: 'segunda',
    recurrenceDate: '',
    companyId: undefined,
  });

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  useEffect(() => {
    if (isOpen) {
        setLoadingCompanies(true);
        api.getCompanies()
            .then(data => setCompanies(data))
            .catch(err => console.error("Erro ao carregar empresas", err))
            .finally(() => setLoadingCompanies(false));
    }
  }, [isOpen]);

  useEffect(() => {
    if (task) {
      setFormData(task);
    } else {
      setFormData({
        title: '',
        description: '',
        priority: TaskPriority.MEDIUM,
        status: TaskStatus.PENDING,
        color: COLORS[0].value,
        dueDate: '',
        recurrence: 'nenhuma',
        dayOfWeek: 'segunda',
        recurrenceDate: '',
      });
    }
  }, [task, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ ...formData, id: task?.id || Date.now() } as Task);
    onClose();
  };

  const handleDelete = () => {
    if (task && onDelete) {
        if(window.confirm("Tem certeza que deseja excluir esta tarefa?")) {
            onDelete(task.id);
            onClose();
        }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-warning/10">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <div className="w-1 h-6 bg-warning rounded-full"></div>
            {task ? 'Editar Tarefa' : 'Nova Tarefa'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:bg-gray-100 p-2 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Título da Tarefa</label>
            <input 
              type="text" 
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-warning focus:border-warning outline-none"
              value={formData.title}
              onChange={e => setFormData({...formData, title: e.target.value})}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Descrição</label>
            <textarea 
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-warning outline-none"
              rows={3}
              value={formData.description}
              onChange={e => setFormData({...formData, description: e.target.value})}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Prioridade</label>
              <select 
                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none"
                value={formData.priority}
                onChange={e => setFormData({...formData, priority: e.target.value as TaskPriority})}
              >
                <option value={TaskPriority.LOW}>Baixa</option>
                <option value={TaskPriority.MEDIUM}>Média</option>
                <option value={TaskPriority.HIGH}>Alta</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Status</label>
              <select 
                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none"
                value={formData.status}
                onChange={e => setFormData({...formData, status: e.target.value as TaskStatus})}
              >
                <option value={TaskStatus.PENDING}>Pendente</option>
                <option value={TaskStatus.IN_PROGRESS}>Em Andamento</option>
                <option value={TaskStatus.DONE}>Concluída</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Cor</label>
              <select 
                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none"
                value={formData.color}
                style={{ backgroundColor: formData.color, color: 'white' }}
                onChange={e => setFormData({...formData, color: e.target.value})}
              >
                {COLORS.map(c => (
                  <option key={c.value} value={c.value} style={{ backgroundColor: c.value, color: 'white' }}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Prazo</label>
              <input 
                type="date"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none"
                value={formData.dueDate}
                onChange={e => setFormData({...formData, dueDate: e.target.value})}
              />
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h4 className="font-semibold text-gray-600 mb-3">Recorrência</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                <select 
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none"
                  value={formData.recurrence}
                  onChange={e => setFormData({...formData, recurrence: e.target.value as any})}
                >
                  <option value="nenhuma">Nenhuma</option>
                  <option value="diaria">Diária</option>
                  <option value="semanal">Semanal</option>
                  <option value="mensal">Mensal</option>
                  <option value="trimestral">Trimestral</option>
                  <option value="semestral">Semestral</option>
                  <option value="anual">Anual</option>
                </select>
              </div>

              {formData.recurrence === 'semanal' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Dia da Semana</label>
                  <select 
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none"
                    value={formData.dayOfWeek}
                    onChange={e => setFormData({...formData, dayOfWeek: e.target.value as any})}
                  >
                    <option value="segunda">Segunda-feira</option>
                    <option value="terca">Terça-feira</option>
                    <option value="quarta">Quarta-feira</option>
                    <option value="quinta">Quinta-feira</option>
                    <option value="sexta">Sexta-feira</option>
                    <option value="sabado">Sábado</option>
                    <option value="domingo">Domingo</option>
                  </select>
                </div>
              )}

              {['mensal', 'trimestral', 'semestral', 'anual'].includes(formData.recurrence || '') && (
                 <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de Recorrência</label>
                  <input 
                    type="date"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none"
                    value={formData.recurrenceDate}
                    onChange={e => setFormData({...formData, recurrenceDate: e.target.value})}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
             <h4 className="font-semibold text-gray-600 mb-3 flex items-center gap-2">
                Vínculo {loadingCompanies && <Loader2 className="w-3 h-3 animate-spin" />}
             </h4>
             <div className="grid grid-cols-1 gap-4">
               <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Empresa</label>
                  <select 
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none disabled:bg-gray-100"
                    value={formData.companyId}
                    onChange={e => setFormData({...formData, companyId: Number(e.target.value)})}
                    disabled={loadingCompanies}
                  >
                    <option value="">Selecione...</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
               </div>
             </div>
          </div>

          <div className="flex justify-between items-center mt-6">
            {task ? (
                <button type="button" onClick={handleDelete} className="px-4 py-2 text-red-500 hover:bg-red-50 rounded-lg flex items-center gap-2">
                    <Trash className="w-4 h-4" /> Excluir
                </button>
            ) : <div></div>}
            
            <div className="flex gap-3">
                <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancelar
                </button>
                <button type="submit" className="px-6 py-2 bg-warning text-white font-medium rounded-lg hover:bg-yellow-600">
                Salvar Tarefa
                </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TaskModal;