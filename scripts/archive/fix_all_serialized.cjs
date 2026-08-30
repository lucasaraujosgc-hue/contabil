const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

// replace msg.id._serialized -> getSerializedId(msg.id)
code = code.replace(/msg\.id\._serialized/g, 'getSerializedId(msg.id)');
// replace m.id._serialized -> getSerializedId(m.id)
code = code.replace(/m\.id\._serialized/g, 'getSerializedId(m.id)');
// replace chat.id._serialized -> getSerializedId(chat.id)
code = code.replace(/chat\.id\._serialized/g, 'getSerializedId(chat.id)');
// replace c.id._serialized -> getSerializedId(c.id)
code = code.replace(/c\.id\._serialized/g, 'getSerializedId(c.id)');
// replace currentOldest.id._serialized -> getSerializedId(currentOldest.id)
code = code.replace(/currentOldest\.id\._serialized/g, 'getSerializedId(currentOldest.id)');

// replace contactId._serialized -> getSerializedId(contactId)
code = code.replace(/contactId\._serialized/g, 'getSerializedId(contactId)');
// replace numberId._serialized -> getSerializedId(numberId)
code = code.replace(/numberId\._serialized/g, 'getSerializedId(numberId)');

fs.writeFileSync('server.js', code);
console.log('Fixed all _serialized references');
