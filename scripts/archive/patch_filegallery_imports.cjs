const fs = require('fs');

let content = fs.readFileSync('components/FileGallery.tsx', 'utf8');

const target = "CheckSquare, Square,  X, ChevronDown, ArrowUp, ArrowDown";
const rep = "CheckSquare, Square,  X, ChevronDown, ArrowUp, ArrowDown, Eye";

if (content.includes("X, ChevronDown, ArrowUp, ArrowDown")) {
    content = content.replace("X, ChevronDown, ArrowUp, ArrowDown", "X, ChevronDown, ArrowUp, ArrowDown, Eye");
}

fs.writeFileSync('components/FileGallery.tsx', content);
