const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

const badBlockStart = `                        await emailTransporter.sendMail(mailOptions);
                        awa            if (channels.whatsapp && company.whatsapp && clientReady) {`;

const badBlockEnd = `            } else if (channels.whatsapp && !clientReady) {
                 errors.push(\`WhatsApp não conectado. Não foi possível enviar para \${company.name}\`);
            }`;

const startIdx = code.indexOf(badBlockStart);
if (startIdx === -1) {
    console.log('Start index not found!');
    process.exit(1);
}

// Find the last occurrence of badBlockEnd starting from startIdx
let endIdx = code.indexOf(badBlockEnd, startIdx);
let nextEnd = code.indexOf(badBlockEnd, endIdx + 1);
while (nextEnd !== -1) {
    endIdx = nextEnd;
    nextEnd = code.indexOf(badBlockEnd, endIdx + 1);
}

if (endIdx === -1) {
    console.log('End index not found!');
    process.exit(1);
}

const correctBlock = `                        await emailTransporter.sendMail(mailOptions);
                        await saveToImapSentFolder(mailOptions).catch(err => 
                            log('[Email] Falha ao salvar no IMAP', err)
                        );
                        log(\`[Email] Enviado para \${company.name} (\${mainEmail})\`);
                    }
                } catch (e) { 
                    log(\`[Email] Erro envio \${company.name}\`, e);
                    errors.push(\`Erro Email \${company.name}: \${e.message}\`); 
                }
            }

            if (channels.whatsapp && company.whatsapp && clientReady) {
                try {
                    let number = company.whatsapp.replace(/\\D/g, '');
                    if (!number.startsWith('55')) number = '55' + number;
                    const chatId = \`\${number}@c.us\`;

                    const listaArquivos = validAttachments.map(att => 
                        \`• \${att.docData.docName} (\${att.docData.category || 'Anexo'}, Venc: \${att.docData.dueDate || 'N/A'})\`
                    ).join('\\n');
                    
                    const whatsappSignature = isBulk 
                        ? (whatsappFileSignature || whatsappTemplate || "_Esses arquivos também foram enviados por e-mail_\\n\\nAtenciosamente,\\nLucas Araujo")
                        : (whatsappTemplate || "_Esses arquivos também foram enviados por e-mail_\\n\\nAtenciosamente,\\nLucas Araujo");
                        
                    let mensagemCompleta = processedMessageBody;
                    
                    if (listaArquivos) {
                        mensagemCompleta += \`\\n\\n*Arquivos enviados:*\\n\${listaArquivos}\`;
                    }
                    
                    mensagemCompleta += \`\\n\\n\${whatsappSignature}\`;

                    await safeSendMessage(client, chatId, mensagemCompleta);

                    for (const att of validAttachments) {
                        try {
                            const fileData = fs.readFileSync(att.path).toString('base64');
                            const media = new MessageMedia(att.contentType, fileData, att.filename);
                            
                            await safeSendMessage(client, chatId, media);
                            
                            await new Promise(r => setTimeout(r, 3000));
                        } catch (mediaErr) {
                            log(\`[WhatsApp] Erro envio mídia \${att.filename}\`, mediaErr);
                            errors.push(\`Erro mídia WhatsApp (\${att.filename}): \${mediaErr.message}\`);
                        }
                    }
                } catch (e) { 
                    log(\`[WhatsApp] Erro envio \${company.name}\`, e);
                    errors.push(\`Erro Zap \${company.name}: \${e.message}\`); 
                }
            } else if (channels.whatsapp && !clientReady) {
                 errors.push(\`WhatsApp não conectado. Não foi possível enviar para \${company.name}\`);
            }`;

const fixedCode = code.slice(0, startIdx) + correctBlock + code.slice(endIdx + badBlockEnd.length);
fs.writeFileSync('server.js', fixedCode, 'utf8');
console.log('Fixed server.js');
