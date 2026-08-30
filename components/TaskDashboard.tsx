import React, { useState, useEffect } from 'react';
import { 
  Plus, MoreVertical, Trash2, CheckSquare, Clock, AlertTriangle, 
  ChevronDown, ChevronRight, Edit, Loader2, Calendar, Flag, X, RefreshCw
} from 'lucide-react';
import { Task, TaskStatus, TaskPriority, UserSettings } from '../types';
import { api } from '../services/api';
import ReactMarkdown from 'react-markdown';
import { 
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';

interface Props {
  userSettings: UserSettings;
}

const TaskDashboard: React.FC<Props> = ({ userSettings }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  
  // Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.PENDING);
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.MEDIUM);
  const [dueDate, setDueDate] = useState('');
  const [estimatedTime, setEstimatedTime] = useState('');
  const [color, setColor] = useState('#2563eb');
  const [parentId, setParentId] = useState<number | null>(null);
  
  // Subtask Form State (used when creating a new main task)
  const [includeSubtask, setIncludeSubtask] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState('');

  // Tree State
  const [expandedNodes, setExpandedNodes] = useState<number[]>([]);

  // Filter state
  const [filterStatus, setFilterStatus] = useState(() => localStorage.getItem('taskDashboard_filterStatus') || 'ALL'); // ALL, PENDING
  const [filterPriority, setFilterPriority] = useState('ALL'); // ALL, alta, media, baixa
  const [searchTitle, setSearchTitle] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    localStorage.setItem('taskDashboard_filterStatus', filterStatus);
  }, [filterStatus]);

  useEffect(() => {
    loadTasks();
  }, []);

  const handleSyncTasks = async () => {
    setIsSyncing(true);
    try {
      const synced = await api.syncTasks();
      setTasks(synced);
    } catch (e) {
      console.error("Erro ao sincronizar tarefas", e);
      alert("Erro ao sincronizar tarefas com o Google");
    } finally {
      setIsSyncing(false);
    }
  };

  const loadTasks = async () => {
    try {
      const data = await api.getTasks();
      setTasks(data);
    } catch (e) {
      console.error("Erro ao carregar tarefas", e);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (task?: Task, parent?: number) => {
    if (task) {
      setEditingTask(task);
      setTitle(task.title);
      setDescription(task.description || '');
      setStatus(task.status);
      setPriority(task.priority);
      setDueDate(task.dueDate || '');
      setEstimatedTime(task.estimatedTime || '');
      setColor(task.color || '#2563eb');
      setParentId(task.parentId || null);
      setIncludeSubtask(false);
      setSubtaskTitle('');
    } else {
      setEditingTask(null);
      setTitle('');
      setDescription('');
      setStatus(TaskStatus.PENDING);
      setPriority(TaskPriority.MEDIUM);
      setDueDate('');
      setEstimatedTime('');
      setColor('#2563eb');
      setParentId(parent || null);
      setIncludeSubtask(!parent); // suggest subtask only if it's a new main task
      setSubtaskTitle('');
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      const taskData: Partial<Task> = {
        title,
        description,
        status,
        priority,
        dueDate,
        estimatedTime,
        color,
        parentId: parentId || undefined
      };
      
      let savedTaskId: number | undefined;

      if (editingTask) {
        taskData.id = editingTask.id;
        await api.saveTask(taskData);
      } else {
        const saved = await api.saveTask(taskData);
        savedTaskId = saved.id;
      }

      // Create initial subtask if requested
      if (!editingTask && includeSubtask && subtaskTitle.trim() && savedTaskId) {
        await api.saveTask({
          title: subtaskTitle,
          status: TaskStatus.PENDING,
          priority: TaskPriority.MEDIUM,
          color: color,
          parentId: savedTaskId
        });
        // Auto-expand the new task so the subtask is visible
        setExpandedNodes(prev => [...prev, savedTaskId!]);
      }
      
      setIsModalOpen(false);
      loadTasks();
    } catch (e) {
      console.error("Erro ao salvar tarefa", e);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Deseja realmente excluir esta tarefa? Suas subtarefas também poderão ser afetadas.")) return;
    try {
      await api.deleteTask(id);
      loadTasks();
    } catch (e) {
      console.error("Erro ao excluir tarefa", e);
    }
  };

  const toggleNode = (id: number) => {
    setExpandedNodes(prev => 
      prev.includes(id) ? prev.filter(n => n !== id) : [...prev, id]
    );
  };

  const toggleTaskStatus = async (task: Task) => {
    const newStatus = task.status === TaskStatus.DONE ? TaskStatus.PENDING : TaskStatus.DONE;
    try {
      await api.saveTask({ ...task, status: newStatus });
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    } catch(e) {
      console.error(e);
    }
  };

  const isOverdue = (date?: string) => {
    if (!date) return false;
    return new Date(date).getTime() < new Date().getTime() - 86400000;
  };

  const matchesFilter = (t: Task) => {
    if (filterStatus === 'PENDING' && t.status === TaskStatus.DONE) return false;
    if (filterPriority !== 'ALL' && t.priority !== filterPriority) return false;
    if (searchTitle && !t.title.toLowerCase().includes(searchTitle.toLowerCase())) return false;
    return true;
  };

  const getVisibleNodeIds = () => {
    const visibleIds = new Set<number>();
    
    // Function to add a task and all its parents
    const addWithParents = (taskId: number) => {
      let currentId: number | undefined = taskId;
      while (currentId !== undefined && !visibleIds.has(currentId)) {
        visibleIds.add(currentId);
        const t = tasks.find(x => x.id === currentId);
        currentId = t?.parentId;
      }
    };

    tasks.forEach(t => {
      if (matchesFilter(t)) {
        addWithParents(t.id);
      }
    });
    return visibleIds;
  };

  const visibleIds = getVisibleNodeIds();

  const buildTree = (allTasks: Task[], parentId?: number): any[] => {
    return allTasks
      .filter(t => visibleIds.has(t.id))
      .filter(t => (parentId === undefined ? !t.parentId : t.parentId === parentId))
      .map(t => ({
        ...t,
        children: buildTree(allTasks, t.id)
      }));
  };

  const treeTasks = buildTree(tasks);

  const statusCounts = {
    pendente: tasks.filter(t => t.status === TaskStatus.PENDING).length,
    andamento: tasks.filter(t => t.status === TaskStatus.IN_PROGRESS).length,
    concluida: tasks.filter(t => t.status === TaskStatus.DONE).length,
  };

  const priorityCounts = {
    alta: tasks.filter(t => t.priority === TaskPriority.HIGH).length,
    media: tasks.filter(t => t.priority === TaskPriority.MEDIUM).length,
    baixa: tasks.filter(t => t.priority === TaskPriority.LOW).length,
  };

  const pieData = [
    { name: 'Pendente', value: statusCounts.pendente, color: '#f59e0b' },
    { name: 'Em Andamento', value: statusCounts.andamento, color: '#3b82f6' },
    { name: 'Concluída', value: statusCounts.concluida, color: '#10b981' },
  ];

  const barData = [
    { name: 'Alta', count: priorityCounts.alta },
    { name: 'Média', count: priorityCounts.media },
    { name: 'Baixa', count: priorityCounts.baixa },
  ];

  const handleUpdatePriority = async (task: Task, newPriority: TaskPriority) => {
    const updated = { ...task, priority: newPriority };
    try {
      await api.saveTask(updated);
      setTasks(tasks.map(t => t.id === task.id ? updated : t));
    } catch(e) {}
  };

  const handleUpdateTime = async (task: Task, newTime: string) => {
    const updated = { ...task, estimatedTime: newTime };
    try {
      await api.saveTask(updated);
      setTasks(tasks.map(t => t.id === task.id ? updated : t));
    } catch(e) {}
  };

  const renderTaskNode = (node: any) => {
    const subtasks = node.children || [];
    
    // Configurações de cores da prioridade
    const priorityColors = {
      [TaskPriority.HIGH]: 'bg-red-50 text-red-600 border-red-200',
      [TaskPriority.MEDIUM]: 'bg-yellow-50 text-yellow-600 border-yellow-200',
      [TaskPriority.LOW]: 'bg-emerald-50 text-emerald-600 border-emerald-200'
    };

    return (
      <div key={node.id} className="bg-white rounded-xl shadow-sm border border-gray-200 mb-4 p-4 flex flex-col relative" style={{ borderLeftWidth: '4px', borderLeftColor: node.color || '#e5e7eb' }}>
        
        {/* Header da Tarefa: Título e Ações */}
        <div className="flex justify-between items-start mb-2">
          <h3 className={`text-base font-bold flex-1 ${node.status === TaskStatus.DONE ? 'line-through text-gray-400' : 'text-gray-800'}`}>
            {node.title}
          </h3>
          <div className="flex items-center gap-2 ml-4">
             <button onClick={() => toggleTaskStatus(node)} className={`p-1.5 rounded-full ${node.status === TaskStatus.DONE ? 'text-green-500 hover:bg-green-50' : 'text-gray-400 hover:text-green-500 hover:bg-gray-50'}`} title="Concluir/Pendente">
               <CheckSquare className="w-5 h-5" />
             </button>
             <button onClick={() => handleDelete(node.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full" title="Excluir Tarefa">
               <Trash2 className="w-5 h-5" />
             </button>
          </div>
        </div>
        
        {/* Descrição */}
        {node.description && (
          <div className="text-sm text-gray-500 mb-4 prose prose-sm max-w-none line-clamp-2">
            <ReactMarkdown>{node.description}</ReactMarkdown>
          </div>
        )}
        
        {/* Pills de Metadados */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {/* Date Pill */}
          {node.dueDate && (
            <div className="flex items-center gap-1.5 bg-gray-50 text-gray-600 px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200">
                <Calendar className="w-3.5 h-3.5" /> 
                {new Date(node.dueDate).toISOString().split('T')[0]}
            </div>
          )}
          
          {/* Priority Pill */}
          <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border ${priorityColors[node.priority as TaskPriority] || priorityColors[TaskPriority.MEDIUM]}`}>
            <div className={`w-2 h-2 rounded-full ${node.priority === TaskPriority.HIGH ? 'bg-red-500' : node.priority === TaskPriority.MEDIUM ? 'bg-yellow-500' : 'bg-emerald-500'}`}></div>
            <select 
              value={node.priority} 
              onChange={(e) => handleUpdatePriority(node, e.target.value as TaskPriority)}
              className="bg-transparent border-none outline-none cursor-pointer appearance-none font-medium pr-4"
              style={{ background: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e") no-repeat right center / 1.5em 1.5em` }}
            >
              <option value={TaskPriority.LOW}>Baixa</option>
              <option value={TaskPriority.MEDIUM}>Média</option>
              <option value={TaskPriority.HIGH}>Alta</option>
            </select>
          </div>

          {/* Time Tracking Pill */}
          <div className="flex items-center gap-1.5 bg-gray-50 text-gray-500 px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 ml-auto">
              <Clock className="w-3.5 h-3.5" />
              <input 
                type="text" 
                placeholder="Ex: min" 
                value={node.estimatedTime || ''}
                onChange={(e) => handleUpdateTime(node, e.target.value)}
                className="bg-transparent border-none outline-none w-16 text-right placeholder-gray-400"
              />
          </div>
        </div>

        {/* Subtasks List */}
        {subtasks.length > 0 && (
          <div className="flex flex-col gap-2 mt-2 mb-4 border-l-2 border-gray-100 pl-4">
            {subtasks.map((st: any) => (
              <div key={st.id} className="flex justify-between items-center group">
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleTaskStatus(st)} className={`${st.status === TaskStatus.DONE ? 'text-green-500' : 'text-gray-300 hover:text-gray-400'}`}>
                    <CheckSquare className="w-4 h-4" />
                  </button>
                  <span className={`text-sm ${st.status === TaskStatus.DONE ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{st.title}</span>
                </div>
                <button onClick={() => handleDelete(st.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 rounded-full transition-opacity">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        
        {/* Adicionar Subtarefa Button */}
        <button 
          onClick={() => handleOpenModal(undefined, node.id)} 
          className="text-xs font-medium text-gray-400 hover:text-blue-600 flex items-center gap-1.5 mt-2 transition-colors w-fit"
        >
          <Plus className="w-3 h-3" /> Adicionar subtarefa
        </button>
      </div>
    );
  };

  if (loading) {
     return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="h-full flex flex-col p-2 space-y-4">
      {/* Top Bar with Filter */}
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-lg font-bold text-gray-800">Painel de Gestão Completa de Tarefas</h1>
          <p className="text-xs text-gray-500">Visualize seu progresso e gerencie sua árvore de atividades.</p>
        </div>
        <div className="flex flex-col md:flex-row gap-3 items-center">
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button 
              onClick={() => setFilterStatus('ALL')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterStatus === 'ALL' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Todas
            </button>
            <button 
              onClick={() => setFilterStatus('PENDING')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterStatus === 'PENDING' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Pendentes
            </button>
          </div>
          <select 
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="bg-white border border-gray-300 rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="ALL">Todas Prioridades</option>
            <option value="alta">Prioridade Alta</option>
            <option value="media">Prioridade Média</option>
            <option value="baixa">Prioridade Baixa</option>
          </select>
          <input 
            type="text"
            placeholder="Buscar por título..."
            value={searchTitle}
            onChange={(e) => setSearchTitle(e.target.value)}
            className="bg-white border border-gray-300 rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none w-40"
          />
          <button 
            onClick={handleSyncTasks} 
            disabled={isSyncing}
            className="p-1.5 bg-white text-gray-500 hover:text-purple-600 hover:bg-purple-50 border border-gray-200 rounded-lg transition disabled:opacity-50" 
            title="Sincronizar com Google Tasks"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>
          <button 
            onClick={() => handleOpenModal()}
            className="bg-blue-600 text-white px-4 py-1.5 text-sm rounded-xl font-medium shadow-sm shadow-blue-200 flex items-center gap-2 hover:bg-blue-700 hover:shadow-md transition-all whitespace-nowrap ml-1"
          >
            <Plus className="w-4 h-4" /> Nova Tarefa
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6 flex-1 overflow-hidden pb-4">
         
         {/* Left Side: Task Tree */}
         <div className="w-full md:w-2/3 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-800">Árvore de Tarefas Hierárquica</h3>
                <span className="text-sm font-medium text-gray-500 bg-gray-200 px-2.5 py-0.5 rounded-full">{tasks.length} total</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
                {treeTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                     <AlertTriangle className="w-10 h-10 text-gray-300 mb-3" />
                     <p>Nenhuma tarefa cadastrada. Crie sua primeira tarefa principal.</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                     {treeTasks.map(task => renderTaskNode(task))}
                  </div>
                )}
            </div>
         </div>

         {/* Right Side: Charts stacked */}
         <div className="w-full md:w-1/3 flex flex-col gap-6 overflow-y-auto pr-2">
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center">
                <h3 className="text-lg font-semibold text-gray-800 mb-4 self-start">Progresso (Status)</h3>
                <div className="h-64 w-full">
                  {tasks.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400">Sem dados</div>
                  )}
                </div>
             </div>

             <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center">
                <h3 className="text-lg font-semibold text-gray-800 mb-4 self-start">Tarefas por Prioridade</h3>
                <div className="h-64 w-full">
                  {tasks.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip cursor={{ fill: 'transparent' }} />
                        <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={40}>
                           {barData.map((entry, index) => {
                             const colors = { Alta: '#ef4444', Média: '#f59e0b', Baixa: '#10b981' };
                             return <Cell key={`cell-${index}`} fill={colors[entry.name as keyof typeof colors]} />;
                           })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400">Sem dados</div>
                  )}
                </div>
             </div>
         </div>

      </div>

      {/* Modal Nova/Editar Tarefa */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
              <h3 className="text-xl font-bold text-slate-800">
                {editingTask ? 'Editar Tarefa' : parentId ? 'Nova Subtarefa' : 'Nova Tarefa Principal'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:bg-slate-100 hover:text-slate-600 p-2 rounded-full transition-colors">
                <Trash2 className="w-5 h-5 hidden" /> {/* Dummy icon so spacing is right with X */}
                <span className="font-bold">✕</span>
              </button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                 <div className="md:col-span-2">
                   <label className="block text-sm font-medium text-slate-700 mb-1">Título</label>
                   <input 
                     type="text" 
                     value={title}
                     onChange={e => setTitle(e.target.value)}
                     className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
                     required
                   />
                 </div>

                 <div className="md:col-span-2">
                   <label className="block text-sm font-medium text-slate-700 mb-1">Descrição (Suporta Markdown)</label>
                   <textarea 
                     value={description}
                     onChange={e => setDescription(e.target.value)}
                     className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none h-20 resize-none"
                     placeholder="- Item 1\n- Item 2"
                   />
                 </div>

                 <div>
                   <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                   <select 
                     value={status}
                     onChange={e => setStatus(e.target.value as TaskStatus)}
                     className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
                   >
                     <option value={TaskStatus.PENDING}>Pendente</option>
                     <option value={TaskStatus.IN_PROGRESS}>Em Andamento</option>
                     <option value={TaskStatus.DONE}>Concluída</option>
                   </select>
                 </div>

                 <div>
                   <label className="block text-sm font-medium text-slate-700 mb-1">Prioridade</label>
                   <select 
                     value={priority}
                     onChange={e => setPriority(e.target.value as TaskPriority)}
                     className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
                   >
                     <option value={TaskPriority.LOW}>Baixa</option>
                     <option value={TaskPriority.MEDIUM}>Média</option>
                     <option value={TaskPriority.HIGH}>Alta</option>
                   </select>
                 </div>

                 <div>
                   <label className="block text-sm font-medium text-slate-700 mb-1">Data de Vencimento</label>
                   <input 
                     type="date" 
                     value={dueDate}
                     onChange={e => setDueDate(e.target.value)}
                     className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
                   />
                 </div>

                 <div>
                   <label className="block text-sm font-medium text-slate-700 mb-1">Tempo Estimado (ex: 2h 30m)</label>
                   <input 
                     type="text" 
                     value={estimatedTime}
                     onChange={e => setEstimatedTime(e.target.value)}
                     className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
                     placeholder="1h 30m"
                   />
                 </div>

                 <div className="md:col-span-2">
                   <label className="block text-sm font-medium text-slate-700 mb-1">Cor de Etiqueta</label>
                   <div className="flex items-center gap-3">
                     <input 
                       type="color" 
                       value={color}
                       onChange={e => setColor(e.target.value)}
                       className="w-12 h-12 border-0 bg-transparent rounded cursor-pointer"
                     />
                     <span className="text-sm text-gray-500">Selecione uma cor para organizar visualmente</span>
                   </div>
                 </div>
                 
                 {!editingTask && !parentId && (
                   <div className="md:col-span-2 pt-2 border-t border-slate-100">
                     <label className="block text-sm font-medium text-slate-700 mb-1">
                       Já adicionar uma subtarefa inicial (Opcional)
                     </label>
                     <input 
                        type="text" 
                        value={subtaskTitle}
                        onChange={e => {
                          setSubtaskTitle(e.target.value);
                          setIncludeSubtask(!!e.target.value.trim());
                        }}
                        className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="Título da subtarefa..."
                     />
                   </div>
                 )}
                 
              </div>
              
              <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200"
                >
                  Salvar Tarefa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskDashboard;