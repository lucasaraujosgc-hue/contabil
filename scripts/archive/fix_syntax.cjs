const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

const target = `// Helper for extracting serialized ID safely after WhatsApp Web changes
function idObj._serialized {
    if (!idObj) return undefined;
    if (idObj._serialized) return idObj._serialized;
    if (idObj.$1) return idObj.$1;
    if (typeof idObj.id === 'string') return idObj.id;
    if (typeof idObj === 'string') return idObj;
    
    console.warn("[WARNING] Could not find serialized ID format in object:", idObj);
    return String(idObj);
}`;

code = code.replace(target, '');
fs.writeFileSync('server.js', code);
console.log('Fixed syntax error');
