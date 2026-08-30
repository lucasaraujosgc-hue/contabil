import multer from 'multer';
import { UPLOADS_DIR } from '../config.js';

// --- UPLOAD (multer) --- (extraído do server.js, sem alterações)
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, UPLOADS_DIR) },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    cb(null, uniqueSuffix + '-' + cleanName)
  }
})
export const upload = multer({ storage: storage });
