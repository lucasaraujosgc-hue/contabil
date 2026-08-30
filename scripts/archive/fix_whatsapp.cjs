const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(
    /const whatsappSignature = isBulk\s*\n\s*\? \(whatsappFileSignature \|\| whatsappTemplate \|\| ".*"\)\s*\n\s*: \(whatsappTemplate \|\| ".*"\);/g,
    `const whatsappSignature = isBulk ? (whatsappFileSignature || "") : (whatsappTemplate || "");`
);

code = code.replace(
    /const whatsappSignature = settings\?\.whatsappFileSignature \|\| settings\?\.whatsappTemplate \|\| '';/g,
    `const whatsappSignature = settings?.whatsappFileSignature || '';`
);

fs.writeFileSync('server.js', code, 'utf8');
console.log('Fixed');
