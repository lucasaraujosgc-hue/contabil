const fs = require('fs');

let content = fs.readFileSync('components/FileGallery.tsx', 'utf8');

// 1. Add Eye to imports
content = content.replace(
  "CheckSquare, Square,  X, ChevronDown, ArrowUp, ArrowDown",
  "CheckSquare, Square,  X, ChevronDown, ArrowUp, ArrowDown, Eye"
);

// 2. Add state
const targetState = `  const [selected, setSelected] = useState<Set<number>>(new Set());`;
const repState = `  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [previewFile, setPreviewFile] = useState<any | null>(null);`;
content = content.replace(targetState, repState);

// 3. Add isPreviewable function
const targetIsPreviewable = `  const getMimeGroup = (mimeType: string) => {`;
const repIsPreviewable = `  const isPreviewable = (mimeType: string) => {
    if (!mimeType) return false;
    const group = getMimeGroup(mimeType);
    return ['image', 'video', 'audio'].includes(group) || mimeType.includes('pdf');
  };

  const getMimeGroup = (mimeType: string) => {`;
content = content.replace(targetIsPreviewable, repIsPreviewable);

// 4. Update the card actions
const targetCardActions = `                {/* Ações */}
                <div className="flex gap-2 px-4 pb-4 mt-auto" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => window.open(\`/api/file-gallery/download/\${file.id}?token=\${localStorage.getItem('cm_auth_token')}\`, '_blank')}
                    className="flex-1 flex justify-center items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" /> Baixar
                  </button>
                  <button
                    onClick={() => handleDelete(file.id)}
                    className="flex justify-center items-center px-3 bg-red-50 text-red-500 hover:bg-red-100 rounded-lg transition-colors"
                    title="Excluir"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>`;

const repCardActions = `                {/* Ações */}
                <div className="flex gap-2 px-4 pb-4 mt-auto" onClick={e => e.stopPropagation()}>
                  {isPreviewable(file.mimeType) && (
                    <button
                      onClick={() => setPreviewFile(file)}
                      className="flex-1 flex justify-center items-center gap-1.5 bg-gray-50 text-gray-700 hover:bg-gray-200 py-2 rounded-lg text-sm font-medium transition-colors border border-gray-200"
                    >
                      <Eye className="w-3.5 h-3.5" /> Ver
                    </button>
                  )}
                  <button
                    onClick={() => window.open(\`/api/file-gallery/download/\${file.id}?token=\${localStorage.getItem('cm_auth_token')}\`, '_blank')}
                    className="flex-1 flex justify-center items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" /> Baixar
                  </button>
                  <button
                    onClick={() => handleDelete(file.id)}
                    className="flex justify-center items-center px-3 bg-red-50 text-red-500 hover:bg-red-100 rounded-lg transition-colors"
                    title="Excluir"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>`;
content = content.replace(targetCardActions, repCardActions);

// 5. Add Modal to the end of the return statement
const targetModal = `      )}
    </div>
  );
};

export default FileGallery;`;

const repModal = `      )}

      {/* Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm" onClick={() => setPreviewFile(null)}>
            <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50 shrink-0">
                    <div className="flex items-center gap-3 truncate pr-4">
                        <div className="p-2 bg-white rounded-lg shadow-sm">
                            {getIcon(previewFile.mimeType)}
                        </div>
                        <div className="truncate">
                            <h3 className="font-bold text-gray-800 truncate" title={previewFile.originalName}>{previewFile.originalName}</h3>
                            <p className="text-xs text-gray-500">{formatSize(previewFile.size)} • {previewFile.contact}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => window.open(\`/api/file-gallery/download/\${previewFile.id}?token=\${localStorage.getItem('cm_auth_token')}\`, '_blank')}
                            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Baixar"
                        >
                            <Download className="w-5 h-5" />
                        </button>
                        <button onClick={() => setPreviewFile(null)} className="p-2 text-gray-400 hover:bg-gray-200 hover:text-gray-700 rounded-lg transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>
                
                <div className="flex-1 overflow-auto p-6 bg-gray-100/50 flex items-center justify-center min-h-[300px]">
                    {getMimeGroup(previewFile.mimeType) === 'image' && (
                        <img src={\`/api/file-gallery/view/\${previewFile.id}?token=\${localStorage.getItem('cm_auth_token')}\`} alt={previewFile.originalName} className="max-w-full max-h-[70vh] rounded-lg shadow-sm object-contain" />
                    )}
                    {getMimeGroup(previewFile.mimeType) === 'video' && (
                        <video src={\`/api/file-gallery/view/\${previewFile.id}?token=\${localStorage.getItem('cm_auth_token')}\`} controls autoPlay className="max-w-full max-h-[70vh] rounded-lg shadow-sm" />
                    )}
                    {getMimeGroup(previewFile.mimeType) === 'audio' && (
                        <audio src={\`/api/file-gallery/view/\${previewFile.id}?token=\${localStorage.getItem('cm_auth_token')}\`} controls autoPlay className="w-full max-w-md" />
                    )}
                    {previewFile.mimeType?.includes('pdf') && (
                        <iframe src={\`/api/file-gallery/view/\${previewFile.id}?token=\${localStorage.getItem('cm_auth_token')}\`} className="w-full h-[70vh] rounded-lg shadow-sm border-0" title={previewFile.originalName} />
                    )}
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default FileGallery;`;

content = content.replace(targetModal, repModal);

fs.writeFileSync('components/FileGallery.tsx', content);
