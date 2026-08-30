import fs from 'fs';
import zlib from 'zlib';

export function extractTextFromPDF(buffer) {
    let text = '';
    const pdfData = buffer.toString('binary');
    let offset = 0;

    while (true) {
        const streamStart = pdfData.indexOf('stream', offset);
        if (streamStart === -1) break;
        
        const streamEnd = pdfData.indexOf('endstream', streamStart);
        if (streamEnd === -1) break;
        
        let streamDataStart = streamStart + 6;
        while (pdfData.charCodeAt(streamDataStart) === 10 || pdfData.charCodeAt(streamDataStart) === 13) {
            streamDataStart++;
        }
        
        let streamDataEnd = streamEnd;
        while (streamDataEnd > streamDataStart && (pdfData.charCodeAt(streamDataEnd - 1) === 10 || pdfData.charCodeAt(streamDataEnd - 1) === 13)) {
            streamDataEnd--;
        }

        const streamBuffer = buffer.slice(streamDataStart, streamDataEnd);
        
        try {
            const unzipped = zlib.unzipSync(streamBuffer);
            text += unzipped.toString('utf8') + '\n';
        } catch (e) {
            // Not a valid zip or not zlib compressed
            text += streamBuffer.toString('utf8') + '\n';
        }
        
        offset = streamEnd + 9;
    }
    return text;
}
