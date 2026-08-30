import React, { useState, useEffect } from 'react';
import { Plus, MoreHorizontal, Calendar, Flag, Trash, CheckSquare, X, Loader2 } from 'lucide-react';
import { Task, TaskStatus } from '../types';
import TaskModal from './TaskModal';
import { api } from '../services/api';

interface KanbanColumnProps { 
  title: string; 
  status: TaskStatus; 
  tasks: Task[];
  color: string;
  onMoveTask: (id: number, status: TaskStatus) => void;
  onEditTask: (task: Task) => void;
  activeMenu: string | null;
  onToggleMenu: (menu: string | null) => void;
  onClearColumn: (status: TaskStatus) => void;
  onEnableSelection: () => void;
  selectionMode: boolean;
  selectedTasks: number[];
  onToggleSelection: (id: number) => void;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({ 
  title, 
  status, 
  tasks, 
  color, 
  onMoveTask, 
  onEditTask,
  activeMenu,
  onToggleMenu,
  onClearColumn,
  onEnableSelection,
  selectionMode,
  selectedTasks,
  onToggleSelection
}) => {

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("taskId");
    if (taskId) {
        onMoveTask(Number(taskId), status);
    }
  };

  const menuId = `menu-${status}`;

  return (
    <div 
        className="flex-1 min-w-[300px] bg-gray-100 rounded-xl p-4 flex flex-col h-full transition-colors"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
    >
      <div className={`flex items-center justify-between mb-4 pb-2 border-b-2 ${color} relative`}>
        <h3 className="font-bold text-gray-700 flex items-center gap-2">
          {title}
          <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full text-xs">{tasks.length}</span>
        </h3>
        
        <div className="relative">
            <button 
                onClick={(e) => { e.stopPropagation(); onToggleMenu(activeMenu === menuId ? null : menuId); }}
                className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-200"
            >
                <MoreHorizontal className="w-5 h-5" />
            </button>
            
            {activeMenu === menuId && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-100 z-20 py-1 overflow-hidden">
                    <button 
                        onClick={() => { onEnableSelection(); onToggleMenu(null); }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                        <CheckSquare className="w-4 h-4" /> Selecionar Tarefas
                    </button>
                    <button 
                        onClick={() => { onClearColumn(status); onToggleMenu(null); }}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                        <Trash className="w-4 h-4" /> Limpar Coluna
                    </button>
                </div>
            )}
        </div>
      </div>

      <div className="space-y-3 overflow-y-auto flex-1 pr-1">
        {tasks.map(task => (
          <div 
            key={task.id} 
            draggable={!selectionMode}
            onDragStart={(e) => {
                e.dataTransfer.setData("taskId", String(task.id));
                e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => selectionMode ? onToggleSelection(task.id) : onEditTask(task)}
            className={`bg-white p-4 rounded-lg shadow-sm border hover:shadow-md transition-all cursor-pointer group relative
                ${selectionMode && selectedTasks.includes(task.id) ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50' : 'border-gray-200'}
                ${!selectionMode ? 'hover:-translate-y-1 active:cursor-grabbing' : ''}
            `}
          >
            {/* Selection Checkbox Overlay */}
            {selectionMode && (
                <div className="absolute top-3 right-3 z-10">
                    <div className={`w-5 h-5 rounded border flex items-center justify-center
                        ${selectedTasks.includes(task.id) ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}
                    `}>
                        {selectedTasks.includes(task.id) && <CheckSquare className="w-3 h-3 text-white" />}
                    </div>
                </div>
            )}

            <div className="flex justify-between items-start mb-2">
              <span className={`w-8 h-1 rounded-full mb-2`} style={{ backgroundColor: task.color }}></span>
              {!selectionMode && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                    {status !== TaskStatus.DONE && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onMoveTask(task.id, TaskStatus.DONE); }}
                            className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200"
                        >Done</button>
                    )}
                  </div>
              )}
            </div>
            
            <h4 className="font-semibold text-gray-800 mb-1">{task.title}</h4>
            <p className="text-sm text-gray-500 mb-3 line-clamp-2">{task.description}</p>
            
            <div className="flex items-center justify-between text-xs text-gray-400 border-t pt-3">
              <div className="flex items-center gap-2">
                {task.dueDate && (
                    <span className="flex items-center gap-1 text-red-400">
                        <Calendar className="w-3 h-3" /> {new Date(task.dueDate).toLocaleDateString('pt-BR')}
                    </span>
                )}
              </div>
              <span className={`flex items-center gap-1 ${task.priority === 'alta' ? 'text-red-500 font-bold' : ''}`}>
                <Flag className="w-3 h-3" /> {task.priority}
              </span>
            </div>
          </div>
        ))}
        
        {tasks.length === 0 && (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-sm">
                Solte tarefas aqui
            </div>
        )}
      </div>
      
      {!selectionMode && (
          <button 
            onClick={() => onEditTask(null as any)}
            className="mt-3 w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> Nova Tarefa
          </button>
      )}
    </div>
  );
};

const Kanban: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  
  // Menu & Selection State
  const [activeMenuColumn, setActiveMenuColumn] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<number[]>([]);

  // Load Tasks
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

  useEffect(() => {
    loadTasks();
  }, []);

  const moveTask = async (id: number, newStatus: TaskStatus) => {
    // Optimistic Update
    const originalTasks = [...tasks];
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: newStatus } : t));

    try {
      const task = tasks.find(t => t.id === id);
      if (task) {
         await api.saveTask({ ...task, status: newStatus });
      }
    } catch (e) {
      console.error("Falha ao mover tarefa", e);
      setTasks(originalTasks); // Revert
    }
  };

  const handleEditTask = (task: Task | null) => {
    setEditingTask(task);
    setIsModalOpen(true);
  };

  const handleSaveTask = async (task: Task) => {
    try {
      await api.saveTask(task);
      setIsModalOpen(false);
      loadTasks(); // Reload to get IDs/Updates
    } catch (e) {
      alert("Erro ao salvar tarefa");
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    try {
      await api.deleteTask(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (e) {
      alert("Erro ao excluir tarefa");
    }
  };

  // Bulk Actions
  const handleClearColumn = async (status: TaskStatus) => {
      if(window.confirm(`Tem certeza que deseja excluir TODAS as tarefas da coluna "${status}"?`)) {
          const tasksToDelete = tasks.filter(t => t.status === status);
          for (const t of tasksToDelete) {
             await api.deleteTask(t.id);
          }
          loadTasks();
      }
  };

  const handleToggleSelection = (id: number) => {
      setSelectedTasks(prev => 
        prev.includes(id) ? prev.filter(tid => tid !== id) : [...prev, id]
      );
  };

  const handleBulkDelete = async () => {
      if(selectedTasks.length === 0) return;
      if(window.confirm(`Excluir as ${selectedTasks.length} tarefas selecionadas?`)) {
          for (const id of selectedTasks) {
             await api.deleteTask(id);
          }
          setSelectedTasks([]);
          setSelectionMode(false);
          loadTasks();
      }
  };

  const handleCancelSelection = () => {
      setSelectionMode(false);
      setSelectedTasks([]);
  };

  if (loading) {
     return <div className="h-[800px] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="h-[800px] flex flex-col relative" onClick={() => setActiveMenuColumn(null)}>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Gerenciador de Tarefas</h1>
          <p className="text-gray-500">Acompanhe o progresso das obrigações contábeis.</p>
        </div>
        <div className="flex gap-3">
          <select className="bg-white border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
            <option>Todas as Empresas</option>
            {/* Can populate dynamically if needed */}
          </select>
          <button 
            onClick={() => handleEditTask(null)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> Nova Tarefa
          </button>
        </div>
      </div>

      <div className="flex gap-6 overflow-x-auto pb-4 h-full">
        <KanbanColumn 
          title="Pendente" 
          status={TaskStatus.PENDING} 
          tasks={tasks.filter(t => t.status === TaskStatus.PENDING)}
          color="border-yellow-400"
          onMoveTask={moveTask}
          onEditTask={handleEditTask}
          activeMenu={activeMenuColumn}
          onToggleMenu={setActiveMenuColumn}
          onClearColumn={handleClearColumn}
          onEnableSelection={() => setSelectionMode(true)}
          selectionMode={selectionMode}
          selectedTasks={selectedTasks}
          onToggleSelection={handleToggleSelection}
        />
        <KanbanColumn 
          title="Em Andamento" 
          status={TaskStatus.IN_PROGRESS} 
          tasks={tasks.filter(t => t.status === TaskStatus.IN_PROGRESS)}
          color="border-blue-400"
          onMoveTask={moveTask}
          onEditTask={handleEditTask}
          activeMenu={activeMenuColumn}
          onToggleMenu={setActiveMenuColumn}
          onClearColumn={handleClearColumn}
          onEnableSelection={() => setSelectionMode(true)}
          selectionMode={selectionMode}
          selectedTasks={selectedTasks}
          onToggleSelection={handleToggleSelection}
        />
        <KanbanColumn 
          title="Concluída" 
          status={TaskStatus.DONE} 
          tasks={tasks.filter(t => t.status === TaskStatus.DONE)}
          color="border-green-400"
          onMoveTask={moveTask}
          onEditTask={handleEditTask}
          activeMenu={activeMenuColumn}
          onToggleMenu={setActiveMenuColumn}
          onClearColumn={handleClearColumn}
          onEnableSelection={() => setSelectionMode(true)}
          selectionMode={selectionMode}
          selectedTasks={selectedTasks}
          onToggleSelection={handleToggleSelection}
        />
      </div>

      <TaskModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        task={editingTask} 
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
      />

      {/* Bulk Action Bar */}
      {selectionMode && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-xl shadow-xl flex items-center gap-6 z-30 animate-in slide-in-from-bottom-5">
              <span className="font-semibold">{selectedTasks.length} tarefas selecionadas</span>
              <div className="h-4 w-px bg-gray-600"></div>
              <button 
                onClick={handleBulkDelete}
                disabled={selectedTasks.length === 0}
                className="flex items-center gap-2 text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                  <Trash className="w-4 h-4" /> Excluir Selecionadas
              </button>
              <button 
                onClick={handleCancelSelection}
                className="text-gray-400 hover:text-white"
              >
                  <X className="w-5 h-5" />
              </button>
          </div>
      )}
    </div>
  );
};

export default Kanban;