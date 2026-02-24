/**
 * Navigation Generator Script
 * ============================
 * Scans src/assets/docs/ folder and auto-generates docs-navigation.json
 *
 * Run: node scripts/generate-docs-nav.js
 */

const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, '..', 'src', 'assets', 'docs');
const OUTPUT_FILE = path.join(__dirname, '..', 'src', 'assets', 'docs-navigation.json');

function getTitle(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/^#\s+(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    // ignore
  }
  // Fallback: convert filename to Title Case
  const name = path.basename(filePath, '.md');
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildNavTree(dirPath, basePath = '') {
  const items = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  const folders = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));

  for (const folder of folders) {
    const folderPath = path.join(dirPath, folder.name);
    const routeBase = basePath ? `${basePath}/${folder.name}` : folder.name;
    const children = buildNavTree(folderPath, routeBase);

    if (children.length > 0) {
      items.push({
        label: folder.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        children,
        expanded: false,
      });
    }
  }

  for (const file of files) {
    const filePath = path.join(dirPath, file.name);
    const name = file.name.replace('.md', '');
    const route = basePath ? `${basePath}/${name}` : name;

    items.push({
      label: getTitle(filePath),
      route,
    });
  }

  return items;
}

// Ensure docs directory exists
if (!fs.existsSync(DOCS_DIR)) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
}

const navigation = buildNavTree(DOCS_DIR);
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(navigation, null, 2));
console.log(`✅ Navigation generated: ${navigation.length} top-level items`);
console.log(`   Output: ${OUTPUT_FILE}`);
