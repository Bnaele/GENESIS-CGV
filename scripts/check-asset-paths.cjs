// Submission hygiene: every asset path in code must resolve to a real file
// with EXACT case — the LAMP deliverable runs on case-sensitive Linux, where
// Windows silently tolerates the mismatch.
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || '.';
const PUB = path.join(ROOT, 'public');
const EXTS = ['fbx', 'glb', 'gltf', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'ogg', 'wav'];

const disk = new Set();
const byLower = new Map();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    const rel = path.relative(PUB, f).split(path.sep).join('/');
    if (e.isDirectory()) walk(f);
    else {
      disk.add(rel);
      const k = rel.toLowerCase();
      if (!byLower.has(k)) byLower.set(k, []);
      byLower.get(k).push(rel);
    }
  }
})(PUB);

const srcFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (!f.includes('node_modules')) walk(f); }
    else if (/\.(js|html|css)$/.test(e.name)) srcFiles.push(f);
  }
})(path.join(ROOT, 'src'));
srcFiles.push(path.join(ROOT, 'index.html'));

// 'i' on purpose: the whole point is catching a reference whose case does
// not match the file on disk, which a case-sensitive scan would skip over.
const fullRe = new RegExp('(?:"|\'|`|\\()\\.?\\.?/(assets/[^"\'`)\\s]+\\.(?:' + EXTS.join('|') + '))', 'gi');
const bareRe = new RegExp('(?:"|\')[A-Za-z0-9_.-]+\\.(?:' + EXTS.join('|') + ')(?:"|\')', 'gi');

const basenames = new Map();
for (const rel of disk) {
  const b = rel.split('/').pop();
  if (!basenames.has(b)) basenames.set(b, []);
  basenames.get(b).push(rel);
}

const problems = [];
const checked = new Set();
for (const f of srcFiles) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(fullRe)) {
    const rel = m[1];
    const key = f + '|' + rel;
    if (checked.has(key)) continue; checked.add(key);
    if (!disk.has(rel)) problems.push({ file: f, ref: rel, why: disk.has(rel.toLowerCase()) ? 'CASE MISMATCH -> ' + byLower.get(rel.toLowerCase()) : 'NO SUCH FILE' });
  }
  for (const m of s.matchAll(bareRe)) {
    const lit = m[0].slice(1, -1);
    const base = lit.split('/').pop();
    const key = f + '|' + lit;
    if (checked.has(key)) continue; checked.add(key);
    if (!basenames.has(base)) {
      const lowerHit = [...disk].find((d) => d.toLowerCase() === lit.toLowerCase());
      problems.push({ file: f, ref: lit, why: lowerHit ? 'CASE MISMATCH -> ' + lowerHit : 'NEVER ON DISK' });
    }
  }
}

console.log('files on disk:', disk.size, '| references checked:', checked.size);
for (const p of problems) console.log(p.why.padEnd(28), p.file, '->', p.ref);
console.log('problems:', problems.length);
