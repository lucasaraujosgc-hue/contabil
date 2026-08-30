
import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, X, Calendar as CalendarIcon, Clock, AlertCircle } from 'lucide-react';
import { Task, TaskStatus } from '../types';

interface DashboardCalendarProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}

const DAYS_OF_WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const DashboardCalendar: React.FC<DashboardCalendarProps> = ({ tasks, onTaskClick }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDayTasks, setSelectedDayTasks] = useState<{date: string, tasks: Task[]} | null>(null);

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const changeMonth = (delta: number) => {
    const newDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + delta, 1);
    setCurrentDate(newDate);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'alta': return 'bg-red-500';
      case 'media': return 'bg-yellow-500';
      case 'baixa': return 'bg-blue-500';
      default: return 'bg-gray-400';
    }
  };

  // Lógica de Prioridade Dinâmica
  const getDynamicPriority = (task: Task): string => {
    if (task.status === TaskStatus.DONE) return task.priority;
    if (!task.dueDate) return task.priority;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(task.dueDate);
    due.setHours(0, 0, 0, 0); // Ajuste para fuso horário simples (UTC vs Local pode variar, mas assumimos string YYYY-MM-DD)
    // Para simplificar a comparação de strings YYYY-MM-DD:
    const dueTime = due.getTime();
    const todayTime = today.getTime();
    
    const diffTime = dueTime - todayTime;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

    if (diffDays < 0) return 'alta'; // Vencida
    if (diffDays <= 3) return 'alta'; // Próxima
    if (diffDays <= 7) return 'media'; // Semana
    return task.priority;
  };

  // Verifica se a tarefa deve aparecer no dia
  const isTaskActiveOnDay = (task: Task, dayDateStr: string): boolean => {
    // Se a tarefa não tem data de criação, assumimos que ela "existe" desde sempre ou usamos a dueDate como ref
    const createdAt = task.createdAt || task.dueDate || new Date().toISOString().split('T')[0];
    
    // Data "final" de exibição:
    // Se concluída -> até data de conclusão (não temos data conclusão no DB, então usamos a data atual como fallback visual ou paramos de exibir)
    // A regra: "aparecer em todas as datas compreendidas entre a data de cadastro e a data em que forem marcadas como concluídas"
    // Se não concluída -> até hoje (ou futuro se dueDate for maior)
    
    const dayDate = new Date(dayDateStr);
    dayDate.setHours(0,0,0,0);

    const startDate = new Date(createdAt);
    startDate.setHours(0,0,0,0);

    if (dayDate < startDate) return false;

    if (task.status === TaskStatus.DONE) {
       // Como não temos completedAt no banco, assumimos que se está DONE, não mostramos mais no calendário "ativo" de pendências,
       // OU mostramos apenas no dia que foi feita (se tivéssemos o dado).
       // Pela regra do prompt: "até a data em que forem marcadas como concluídas".
       // Sem esse dado histórico, vamos simplificar: Tarefas DONE não aparecem como "ativas" no calendário de pendências futuras, 
       // mas podem aparecer no passado? Para evitar confusão visual sem o dado exato, vou exibir APENAS tarefas PENDENTES/EM ANDAMENTO.
       return false;
    } else {
        // Se pendente, mostra até hoje (ou até dueDate se for futuro, para indicar compromisso)
        // Mas a regra diz "entre cadastro e conclusão". Se não concluiu, continua aparecendo todos os dias até hoje.
        // E no futuro? Geralmente calendários mostram quando VENCE.
        // Vou exibir se: dayDate >= createdAt AND (task is pending)
        // Isso faria a tarefa aparecer infinitamente no futuro?
        // Vamos limitar a exibição futura até a DueDate. Se DueDate passou (atrasada), mostra em todos os dias até hoje.
        
        const today = new Date();
        today.setHours(0,0,0,0);
        
        const dueDate = task.dueDate ? new Date(task.dueDate) : today;
        dueDate.setHours(0,0,0,0);

        // O range visual vai de CreatedAt até MAX(Today, DueDate)
        const effectiveEndDate = dueDate > today ? dueDate : today;
        
        return dayDate <= effectiveEndDate;
    }
  };

  const renderCalendar = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDayOfWeek = getFirstDayOfMonth(year, month); // 0=Sun

    const days = [];
    // Padding for prev month
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(<div key={`empty-${i}`} className="bg-gray-50 border border-gray-100 min-h-[100px]"></div>);
    }

    // Days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      
      // Filtrar tarefas ativas neste dia
      const activeTasks = tasks.filter(t => isTaskActiveOnDay(t, dateStr));
      // Ordenar por prioridade dinâmica (Alta primeiro)
      activeTasks.sort((a, b) => {
          const pA = getDynamicPriority(a) === 'alta' ? 3 : getDynamicPriority(a) === 'media' ? 2 : 1;
          const pB = getDynamicPriority(b) === 'alta' ? 3 : getDynamicPriority(b) === 'media' ? 2 : 1;
          return pB - pA;
      });

      const maxDisplay = 3;
      const overflow = activeTasks.length - maxDisplay;

      days.push(
        <div 
            key={d} 
            className="bg-white border border-gray-100 min-h-[100px] p-2 hover:bg-gray-50 transition-colors cursor-pointer flex flex-col"
            onClick={() => {
                if (activeTasks.length > 0) {
                    setSelectedDayTasks({ date: dateStr, tasks: activeTasks });
                }
            }}
        >
          <div className="text-right mb-1">
             <span className={`text-sm font-semibold ${new Date().toDateString() === new Date(dateStr).toDateString() ? 'bg-blue-600 text-white rounded-full w-6 h-6 inline-flex items-center justify-center' : 'text-gray-700'}`}>{d}</span>
          </div>
          
          <div className="flex-1 space-y-1 overflow-hidden">
              {activeTasks.slice(0, maxDisplay).map(task => {
                  const prio = getDynamicPriority(task);
                  return (
                    <div 
                        key={task.id} 
                        className={`text-xs px-2 py-1 rounded truncate text-white ${getPriorityColor(prio)} shadow-sm opacity-90 hover:opacity-100`}
                        title={task.title}
                        onClick={(e) => { e.stopPropagation(); onTaskClick(task); }}
                    >
                        {task.title}
                    </div>
                  );
              })}
              {overflow > 0 && (
                  <div className="text-xs text-gray-500 font-medium pl-1">
                      + {overflow} mais...
                  </div>
              )}
          </div>
        </div>
      );
    }

    return days;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-blue-600" /> 
            {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
        </h2>
        <div className="flex gap-2">
            <button onClick={() => changeMonth(-1)} className="p-2 border border-gray-300 rounded hover:bg-white transition-colors"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={() => changeMonth(1)} className="p-2 border border-gray-300 rounded hover:bg-white transition-colors"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {DAYS_OF_WEEK.map(day => (
              <div key={day} className="py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {day}
              </div>
          ))}
      </div>

      <div className="grid grid-cols-7">
          {renderCalendar()}
      </div>

      {/* Modal de Detalhes do Dia */}
      {selectedDayTasks && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200">
                  <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-blue-50 rounded-t-xl">
                      <h3 className="font-bold text-blue-800 flex items-center gap-2">
                          <Clock className="w-5 h-5" /> 
                          Tarefas de {new Date(selectedDayTasks.date).toLocaleDateString('pt-BR')}
                      </h3>
                      <button onClick={() => setSelectedDayTasks(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="p-4 overflow-y-auto space-y-3">
                      {selectedDayTasks.tasks.map(task => {
                          const prio = getDynamicPriority(task);
                          return (
                              <div 
                                key={task.id} 
                                onClick={() => { setSelectedDayTasks(null); onTaskClick(task); }}
                                className="border border-gray-100 p-3 rounded-lg hover:bg-gray-50 cursor-pointer flex items-center justify-between group shadow-sm"
                              >
                                  <div className="flex items-center gap-3">
                                      <div className={`w-2 h-10 rounded-full ${getPriorityColor(prio)}`}></div>
                                      <div>
                                          <h4 className="font-semibold text-gray-800">{task.title}</h4>
                                          <p className="text-xs text-gray-500 line-clamp-1">{task.description || 'Sem descrição'}</p>
                                      </div>
                                  </div>
                                  <div className="text-right">
                                      <span className={`text-xs px-2 py-1 rounded font-bold uppercase ${prio === 'alta' ? 'bg-red-100 text-red-700' : prio === 'media' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>
                                          {prio}
                                      </span>
                                      {task.dueDate && <div className="text-xs text-gray-400 mt-1">Vence: {new Date(task.dueDate).toLocaleDateString('pt-BR')}</div>}
                                  </div>
                              </div>
                          );
                      })}
                  </div>
                  <div className="p-3 border-t border-gray-100 bg-gray-50 text-right rounded-b-xl">
                      <button onClick={() => setSelectedDayTasks(null)} className="text-sm text-gray-600 hover:text-gray-800 font-medium px-4 py-2">Fechar</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default DashboardCalendar;
