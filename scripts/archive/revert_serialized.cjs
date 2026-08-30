const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

// replace getSerializedId(X) -> X._serialized
code = code.replace(/getSerializedId\(([^)]+)\)/g, '$1._serialized');

// also remove the function definition:
const funcDef = `// Helper for extracting serialized ID safely after WhatsApp Web changes
function getSerializedId(idObj) {
    if (!idObj) return undefined;
    if (idObj._serialized) return idObj._serialized;
    if (idObj.$1) return idObj.$1;
    if (typeof idObj.id === 'string') return idObj.id;
    if (typeof idObj === 'string') return idObj;
    
    console.warn("[WARNING] Could not find serialized ID format in object:", idObj);
    return String(idObj);
}`;
code = code.replace(funcDef, '');

fs.writeFileSync('server.js', code);
console.log('Reverted getSerializedId');
