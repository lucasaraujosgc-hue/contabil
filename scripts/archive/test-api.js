import fetch from 'node-fetch';
const res = await fetch('http://localhost:3000/api/whatsapp/messages-db/false_150354574454950@lid_3A09B08B10F369C07A85?limit=50&before=undefined', {
  headers: { 'Authorization': 'Bearer asdf' }
});
const text = await res.text();
console.log(res.status, text);
