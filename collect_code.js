const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const IMPORTANT_DIRS = ['src', 'prisma', 'scripts'];
const IMPORTANT_FILES = ['package.json', 'tsconfig.json', '.env', 'nixpacks.toml', 'jest.config.js'];
const EXCLUDE_DIRS = ['node_modules', 'dist', '.git', 'coverage', 'temp', 'docs', 'backups', '.mcp'];

const CODE_OUTPUT_PATH = path.join(ROOT_DIR, 'backend_code.txt');
const TREE_OUTPUT_PATH = path.join(ROOT_DIR, 'backend_tree.txt');

let treeOutput = 'Backend Directory Tree\n=====================\n\n';
let codeOutput = 'Backend Source Code\n=====================\n\n';

function generateTree(dirPath, prefix = '', isImportantPath = false) {
    const items = fs.readdirSync(dirPath);
    const validItems = items.filter(item => !EXCLUDE_DIRS.includes(item) && !item.endsWith('.bak') && !item.endsWith('.tsbuildinfo'));

    validItems.forEach((item, index) => {
        const isLast = index === validItems.length - 1;
        const itemPath = path.join(dirPath, item);
        const stats = fs.statSync(itemPath);
        
        const isOutputDir = dirPath === ROOT_DIR;
        const _isImportantPath = isOutputDir ? (IMPORTANT_DIRS.includes(item) || IMPORTANT_FILES.includes(item)) : isImportantPath;

        if (isOutputDir && !_isImportantPath) return;

        treeOutput += `${prefix}${isLast ? '└── ' : '├── '}${item}\n`;

        if (stats.isDirectory()) {
            generateTree(itemPath, prefix + (isLast ? '    ' : '│   '), _isImportantPath);
        }
    });
}

function collectCode(dirPath, isImportantPath = false) {
    const items = fs.readdirSync(dirPath);
    const validItems = items.filter(item => !EXCLUDE_DIRS.includes(item) && !item.endsWith('.bak') && !item.endsWith('.tsbuildinfo') && item !== 'package-lock.json');

    validItems.forEach(item => {
        const itemPath = path.join(dirPath, item);
        const stats = fs.statSync(itemPath);
        
        const isOutputDir = dirPath === ROOT_DIR;
        const _isImportantPath = isOutputDir ? (IMPORTANT_DIRS.includes(item) || IMPORTANT_FILES.includes(item)) : isImportantPath;

        if (isOutputDir && !_isImportantPath) return;

        if (stats.isDirectory()) {
            collectCode(itemPath, _isImportantPath);
        } else {
            // Read file content
            if (item.endsWith('.png') || item.endsWith('.jpg') || item.endsWith('.jpeg') || item.endsWith('.ico') || item.endsWith('.woff') || item.endsWith('.woff2') || itemPath === CODE_OUTPUT_PATH || itemPath === TREE_OUTPUT_PATH || item === 'SECURITY_FIX_REGISTRATION_ROLE.md') return;

            try {
                const content = fs.readFileSync(itemPath, 'utf8');
                const relativePath = path.relative(ROOT_DIR, itemPath);
                codeOutput += `\n\n--- FILE: ${relativePath} ---\n\n`;
                codeOutput += content;
            } catch (err) {
                console.error(`Error reading ${itemPath}`, err);
            }
        }
    });
}

// Ensure files are empty before writing
if (fs.existsSync(CODE_OUTPUT_PATH)) fs.unlinkSync(CODE_OUTPUT_PATH);
if (fs.existsSync(TREE_OUTPUT_PATH)) fs.unlinkSync(TREE_OUTPUT_PATH);

console.log('Generating tree...');
generateTree(ROOT_DIR);
fs.writeFileSync(TREE_OUTPUT_PATH, treeOutput);

console.log('Collecting code...');
collectCode(ROOT_DIR);
fs.writeFileSync(CODE_OUTPUT_PATH, codeOutput);

console.log('Done! Check backend_code.txt and backend_tree.txt');
