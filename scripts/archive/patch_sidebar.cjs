const fs = require('fs');

let content = fs.readFileSync('components/Sidebar.tsx', 'utf8');

const target = `  const menuItems = [
    { id: 'dashboard', label: 'Painel de Tarefas', icon: LayoutDashboard },
    { id: 'kanban', label: 'Kanban (WhatsApp)', icon: MessageCircle },`;
    
const rep = `  const menuItems = [
    { id: 'kanban', label: 'Kanban (WhatsApp)', icon: MessageCircle },
    { id: 'dashboard', label: 'Painel de Tarefas', icon: LayoutDashboard },`;

content = content.replace(target, rep);
fs.writeFileSync('components/Sidebar.tsx', content);

let contentDash = fs.readFileSync('components/Dashboard.tsx', 'utf8');

const targetDash = `      {/* Chat UI Modal */}
      {activeChat && (
          <div className="fixed inset-0 z-50 bg-black/50 flex flex-col md:flex-row justify-end">
              <div
                className="bg-white w-full md:w-[600px] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300 relative"
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}`;

const repDash = `      {/* Chat UI Modal */}
      {activeChat && (
          <div className="fixed inset-0 z-50 bg-black/50 flex flex-col md:flex-row justify-end" onClick={() => setActiveChat(null)}>
              <div
                className="bg-white w-full md:w-[600px] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300 relative"
                onClick={e => e.stopPropagation()}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}`;

contentDash = contentDash.replace(targetDash, repDash);
fs.writeFileSync('components/Dashboard.tsx', contentDash);

console.log('Patched');
