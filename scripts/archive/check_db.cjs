const Database = require('better-sqlite3');
const fs = require('fs');
const files = fs.readdirSync('./data').filter(f => f.endsWith('.db'));
for (const file of files) {
    const db = new Database('./data/' + file);
    const info = db.pragma('table_info(companies)');
    console.log(file);
    console.log(info.map(c => c.name));
}
