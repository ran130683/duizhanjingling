// ========== 数据存储 ==========
const STORE_KEY = 'card-formation-data-v1';
const QUALITY_LEVELS = [
  { key: 'extraordinary', name: '超凡', rank: 4, color: '#d4af37' },
  { key: 'epic', name: '史诗', rank: 3, color: '#8e44ad' },
  { key: 'excellent', name: '优秀', rank: 2, color: '#3498db' },
  { key: 'normal', name: '普通', rank: 1, color: '#27ae60' },
];
const DEFAULT_QUALITY = 'normal';

const defaultData = {
  classes: [
    { id: 'c1', name: '战士', color: '#e74c3c' },
    { id: 'c2', name: '法师', color: '#9b59b6' },
    { id: 'c3', name: '刺客', color: '#34495e' },
    { id: 'c4', name: '射手', color: '#27ae60' },
    { id: 'c5', name: '辅助', color: '#f39c12' },
  ],
  heroes: [],   // {id, name, classId, avatar(base64)}
  pets: [],     // {id, name, avatar}
};
let store = loadStore();

function normalizeStore(data) {
  const normalized = { ...structuredClone(defaultData), ...data };
  normalized.classes = Array.isArray(normalized.classes) ? normalized.classes : [];
  normalized.heroes = Array.isArray(normalized.heroes) ? normalized.heroes : [];
  normalized.pets = Array.isArray(normalized.pets) ? normalized.pets : [];
  normalized.heroes.forEach(h => { if (!getQuality(h.quality)) h.quality = DEFAULT_QUALITY; });
  normalized.pets.forEach(p => { if (!getQuality(p.quality)) p.quality = DEFAULT_QUALITY; });
  return normalized;
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return normalizeStore(defaultData);
    const data = JSON.parse(raw);
    return normalizeStore(data);
  } catch (e) {
    return normalizeStore(defaultData);
  }
}
function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    console.error('localStorage 保存失败：', e);
    const size = (JSON.stringify(store).length / 1024 / 1024).toFixed(2);
    alert(
      `❌ 数据保存失败！可能原因：\n` +
      `1) 浏览器 localStorage 已满（当前数据约 ${size} MB，上限通常 5MB）\n` +
      `2) 你是用 file:// 直接打开网页，部分浏览器禁用了本地存储\n\n` +
      `建议：\n` +
      `• 用 http://localhost 启动（运行 python3 -m http.server）\n` +
      `• 或去「数据导入/导出」先导出 JSON 备份\n` +
      `• 头像图片越小越好，导入时已自动压缩\n\n错误：` + e.message
    );
    return false;
  }
}
function uid() { return 'id_' + Math.random().toString(36).slice(2, 9); }

function getQuality(key) {
  return QUALITY_LEVELS.find(q => q.key === key) || null;
}

function getQualityInfo(key) {
  return getQuality(key) || getQuality(DEFAULT_QUALITY);
}

function renderQualityOptions(selected = DEFAULT_QUALITY) {
  return QUALITY_LEVELS.map(q => `<option value="${q.key}" ${q.key === selected ? 'selected' : ''}>${q.name}</option>`).join('');
}

function sortByQualityThenName(list) {
  return [...list].sort((a, b) => {
    const rankA = getQualityInfo(a.quality).rank;
    const rankB = getQualityInfo(b.quality).rank;
    return rankB - rankA || (a.name || '').localeCompare(b.name || '', 'zh-CN');
  });
}

function inferQualityFromText(text = '') {
  const t = String(text);
  const hit = QUALITY_LEVELS.find(q => t.includes(q.name));
  return hit?.key || '';
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function classifyQualityByColor(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b);
  if (s < 0.18 || l < 0.16) return '';
  if (h >= 32 && h <= 58 && r > 145 && g > 100) return 'extraordinary';
  if (h >= 250 && h <= 315 && (r > 80 || b > 100)) return 'epic';
  if (h >= 185 && h <= 230 && b > 100) return 'excellent';
  if (h >= 75 && h <= 165 && g > 95) return 'normal';
  return '';
}

function sampleQualityFromCanvas(ctx, w, h) {
  const points = [];
  const stepX = Math.max(1, Math.floor(w / 8));
  const stepY = Math.max(1, Math.floor(h / 8));
  for (let x = 0; x < w; x += stepX) {
    points.push([x, 0], [x, h - 1]);
  }
  for (let y = 0; y < h; y += stepY) {
    points.push([0, y], [w - 1, y]);
  }
  const votes = new Map();
  for (const [x, y] of points) {
    const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
    if (a < 180) continue;
    const q = classifyQualityByColor(r, g, b);
    if (q) votes.set(q, (votes.get(q) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [q, count] of votes.entries()) {
    if (count > bestCount) {
      best = q;
      bestCount = count;
    }
  }
  return bestCount >= 2 ? best : '';
}

// 把图片压缩到指定边长 + JPEG 质量，返回 base64
function compressImage(file, { maxSize = 200, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        // 优先 webp（体积更小），不支持则回退 jpeg
        let dataUrl;
        try { dataUrl = canvas.toDataURL('image/webp', quality); } catch (e) {}
        if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`图片读取失败：${file.name}`));
    };
    img.src = url;
  });
}

// 压缩图片，同时基于头像边缘/角落背景色识别品质
function processImage(file, { maxSize = 200, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        const detectedQuality = sampleQualityFromCanvas(ctx, w, h);
        let dataUrl;
        try { dataUrl = canvas.toDataURL('image/webp', quality); } catch (e) {}
        if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        URL.revokeObjectURL(url);
        resolve({ avatar: dataUrl, quality: detectedQuality || inferQualityFromText(file.webkitRelativePath || file.name) || DEFAULT_QUALITY });
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`图片读取失败：${file.name}`));
    };
    img.src = url;
  });
}

// ========== Tab 切换 ==========
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ========== 文件转 base64 ==========
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

// ========== 职业管理 ==========
let editingClassId = null;
const classNameInput = document.getElementById('className');
const classColorInput = document.getElementById('classColor');
const classListEl = document.getElementById('classList');

function renderClasses() {
  classListEl.innerHTML = '';
  store.classes.forEach(c => {
    const el = document.createElement('div');
    el.className = 'item-card';
    el.innerHTML = `
      <div style="font-size:36px;line-height:80px;background:${c.color};border-radius:50%;width:80px;height:80px;margin:0 auto;color:#fff;font-weight:bold">${c.name[0] || '?'}</div>
      <div class="name">${c.name}</div>
      <div class="meta"><span class="color-dot" style="background:${c.color}"></span>${c.color}</div>
      <div class="ops">
        <button data-edit="${c.id}">编辑</button>
        <button data-del="${c.id}" class="danger">删</button>
      </div>
    `;
    classListEl.appendChild(el);
  });
  // 同步英雄表单的职业下拉
  const hcSel = document.getElementById('heroClass');
  hcSel.innerHTML = '<option value="">— 无职业 —</option>' +
    store.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  if (heroQualitySel) heroQualitySel.innerHTML = renderQualityOptions(heroQualitySel.value || DEFAULT_QUALITY);
  const petQualitySel = document.getElementById('petQuality');
  if (petQualitySel) petQualitySel.innerHTML = renderQualityOptions(petQualitySel.value || DEFAULT_QUALITY);
  // 同步批量导入下拉
  const bulkSel = document.getElementById('heroBulkClass');
  if (bulkSel) {
    bulkSel.innerHTML = '<option value="">— 默认无职业 —</option>' +
      store.classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }
}
classListEl.addEventListener('click', e => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.del;
  if (editId) {
    const c = store.classes.find(x => x.id === editId);
    editingClassId = c.id;
    classNameInput.value = c.name;
    classColorInput.value = c.color;
  }
  if (delId) {
    if (!confirm('确认删除该职业？相关英雄会失去职业关联。')) return;
    store.classes = store.classes.filter(x => x.id !== delId);
    store.heroes.forEach(h => { if (h.classId === delId) h.classId = ''; });
    saveStore(); renderClasses(); renderHeroes(); refreshManualIfReady();
  }
});
document.getElementById('saveClassBtn').onclick = () => {
  const name = classNameInput.value.trim();
  if (!name) return alert('请输入职业名');
  const color = classColorInput.value;
  if (editingClassId) {
    const c = store.classes.find(x => x.id === editingClassId);
    c.name = name; c.color = color;
  } else {
    store.classes.push({ id: uid(), name, color });
  }
  editingClassId = null;
  classNameInput.value = ''; classColorInput.value = '#5b8dee';
  saveStore(); renderClasses(); refreshManualIfReady();
};
document.getElementById('resetClassBtn').onclick = () => {
  editingClassId = null;
  classNameInput.value = ''; classColorInput.value = '#5b8dee';
};

// ========== 英雄管理 ==========
let editingHeroId = null;
let pendingHeroAvatar = null;
const heroNameInput = document.getElementById('heroName');
const heroClassSel = document.getElementById('heroClass');
const heroQualitySel = document.getElementById('heroQuality');
const heroAvatarInput = document.getElementById('heroAvatar');
const heroListEl = document.getElementById('heroList');

heroAvatarInput.addEventListener('change', async e => {
  const f = e.target.files[0];
  if (f) {
    const processed = await processImage(f, { maxSize: 200, quality: 0.85 });
    pendingHeroAvatar = processed.avatar;
    heroQualitySel.value = processed.quality;
  }
});

// 当前激活的职业筛选：'all' | classId | 'none'(无职业)
let heroFilter = 'all';
const heroFilterEl = document.getElementById('heroClassFilter');

function renderHeroFilter() {
  if (!heroFilterEl) return;
  // 所有英雄按职业计数
  const classCount = new Map();
  let noneCount = 0;
  store.heroes.forEach(h => {
    if (!h.classId) { noneCount++; return; }
    classCount.set(h.classId, (classCount.get(h.classId) || 0) + 1);
  });
  // 校验当前筛选有效
  const validIds = new Set(store.classes.map(c => c.id));
  if (heroFilter !== 'all' && heroFilter !== 'none' && !validIds.has(heroFilter)) heroFilter = 'all';

  const tabs = [
    { key: 'all', name: '全部', color: '#5b8dee', count: store.heroes.length },
    ...store.classes.map(c => ({ key: c.id, name: c.name, color: c.color, count: classCount.get(c.id) || 0 })),
  ];
  if (noneCount > 0) tabs.push({ key: 'none', name: '无职业', color: '#7f8c8d', count: noneCount });

  heroFilterEl.innerHTML = tabs.map(t => `
    <button data-key="${t.key}" class="${heroFilter === t.key ? 'active' : ''}" style="--c:${t.color}">
      ${t.name}<span class="count">${t.count}</span>
    </button>
  `).join('');
}
heroFilterEl?.addEventListener('click', e => {
  const key = e.target.closest('button')?.dataset.key;
  if (!key) return;
  heroFilter = key;
  renderHeroFilter();
  renderHeroes();
});

function renderHeroes() {
  renderHeroFilter();
  heroListEl.innerHTML = '';
  const filtered = sortByQualityThenName(store.heroes.filter(h => {
    if (heroFilter === 'all') return true;
    if (heroFilter === 'none') return !h.classId;
    return h.classId === heroFilter;
  }));
  if (!filtered.length) {
    heroListEl.innerHTML = `<div class="hint" style="grid-column:1/-1;text-align:center;padding:30px">该分类下没有英雄</div>`;
    return;
  }
  filtered.forEach(h => {
    const cls = store.classes.find(c => c.id === h.classId);
    const quality = getQualityInfo(h.quality);
    const el = document.createElement('div');
    el.className = 'item-card quality-card';
    el.style.setProperty('--quality-color', quality.color);
    const avatar = h.avatar
      ? `<img src="${h.avatar}" alt="${h.name}">`
      : `<div class="avatar-placeholder" style="background:${quality.color}">${h.name[0] || '?'}</div>`;
    el.innerHTML = `
      <div class="quality-badge">${quality.name}</div>
      ${avatar}
      <div class="name">${h.name}</div>
      <div class="meta">${cls ? `<span class="color-dot" style="background:${cls.color}"></span>${cls.name}` : '无职业'}</div>
      <div class="ops">
        <button data-edit="${h.id}">编辑</button>
        <button data-del="${h.id}" class="danger">删</button>
      </div>
    `;
    heroListEl.appendChild(el);
  });
}
heroListEl.addEventListener('click', e => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.del;
  if (editId) {
    const h = store.heroes.find(x => x.id === editId);
    editingHeroId = h.id;
    heroNameInput.value = h.name;
    heroClassSel.value = h.classId || '';
    heroQualitySel.value = getQualityInfo(h.quality).key;
    pendingHeroAvatar = h.avatar || null;
    heroAvatarInput.value = '';
    toast('已载入「' + h.name + '」，修改后再次保存', 'info');
  }
  if (delId) {
    if (!confirm('确认删除该英雄？')) return;
    store.heroes = store.heroes.filter(x => x.id !== delId);
    saveStore(); renderHeroes(); refreshManualIfReady();
  }
});
document.getElementById('saveHeroBtn').onclick = () => {
  const name = heroNameInput.value.trim();
  if (!name) return alert('请输入英雄名');
  const classId = heroClassSel.value;
  const quality = getQualityInfo(heroQualitySel.value).key;
  if (editingHeroId) {
    const h = store.heroes.find(x => x.id === editingHeroId);
    h.name = name; h.classId = classId; h.quality = quality;
    if (pendingHeroAvatar) h.avatar = pendingHeroAvatar;
  } else {
    if (store.heroes.find(h => h.name === name)) {
      if (!confirm('已存在同名英雄，仍要新增？')) return;
    }
    store.heroes.push({ id: uid(), name, classId, quality, avatar: pendingHeroAvatar });
  }
  editingHeroId = null; pendingHeroAvatar = null;
  heroNameInput.value = ''; heroClassSel.value = ''; heroQualitySel.value = DEFAULT_QUALITY; heroAvatarInput.value = '';
  saveStore(); renderHeroes(); refreshManualIfReady();
};
document.getElementById('resetHeroBtn').onclick = () => {
  editingHeroId = null; pendingHeroAvatar = null;
  heroNameInput.value = ''; heroClassSel.value = ''; heroQualitySel.value = DEFAULT_QUALITY; heroAvatarInput.value = '';
};

// ========== 英雄批量导入 ==========
function isImageFile(f) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name);
}
function stripExt(filename) {
  return filename.replace(/\.[^.]+$/, '').trim();
}
// 解析「职业_英雄名」格式；分隔符兼容 _ - 空格
function parseHeroFilename(rawName) {
  const base = stripExt(rawName);
  const parts = base.split(/[_\-\s]+/).map(s => s.trim()).filter(Boolean);
  const qualityNames = new Set(QUALITY_LEVELS.map(q => q.name));
  const quality = parts.find(part => qualityNames.has(part)) || '';
  const cleanParts = parts.filter(part => !qualityNames.has(part));
  if (cleanParts.length >= 2) {
    return { className: cleanParts[0], heroName: cleanParts.slice(1).join(''), quality };
  }
  return { className: '', heroName: cleanParts[0] || base, quality };
}

function parsePetFilename(rawName) {
  const base = stripExt(rawName);
  const parts = base.split(/[_\-\s]+/).map(s => s.trim()).filter(Boolean);
  const qualityNames = new Set(QUALITY_LEVELS.map(q => q.name));
  const quality = parts.find(part => qualityNames.has(part)) || '';
  const cleanParts = parts.filter(part => !qualityNames.has(part));
  return { petName: cleanParts.join('') || base, quality };
}
// 根据职业名查找或自动创建职业；返回 classId
function ensureClassByName(className) {
  if (!className) return '';
  let c = store.classes.find(x => x.name === className);
  if (c) return c.id;
  // 自动创建：随机但稳定的颜色（基于名称 hash）
  const palette = ['#e74c3c','#9b59b6','#34495e','#27ae60','#f39c12','#16a085','#2980b9','#d35400','#8e44ad','#c0392b'];
  let hash = 0;
  for (const ch of className) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const color = palette[Math.abs(hash) % palette.length];
  c = { id: uid(), name: className, color };
  store.classes.push(c);
  return c.id;
}
async function bulkImport({ files, classId, overwrite, kind, logEl }) {
  let total = 0;
  for (let i = 0; i < files.length; i++) {
    if (isImageFile(files[i])) total++;
  }
  if (!total) {
    logEl.textContent = '未发现图片文件';
    return;
  }
  let added = 0, updated = 0, skipped = 0, autoClass = 0;
  let processed = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!isImageFile(f)) continue;
    processed++;
    let name, parsedClassId = '', parsedQuality = '';
    if (kind === 'hero') {
      const parsed = parseHeroFilename(f.name);
      name = parsed.heroName;
      parsedQuality = parsed.quality ? inferQualityFromText(parsed.quality) : '';
      if (parsed.className) {
        const before = store.classes.length;
        parsedClassId = ensureClassByName(parsed.className);
        if (store.classes.length > before) autoClass++;
      }
    } else {
      const parsed = parsePetFilename(f.name);
      name = parsed.petName;
      parsedQuality = parsed.quality ? inferQualityFromText(parsed.quality) : '';
    }
    if (!name) { skipped++; continue; }
    logEl.textContent = `导入中 (${processed}/${total}) ：${name}`;
    try {
      const processedImage = await processImage(f, { maxSize: 200, quality: 0.85 });
      const detectedQuality = processedImage.quality || DEFAULT_QUALITY;
      const finalQuality = parsedQuality || detectedQuality || DEFAULT_QUALITY;
      const list = kind === 'hero' ? store.heroes : store.pets;
      const exist = list.find(x => x.name === name);
      // 决定最终职业：文件名解析出的优先，其次是用户在面板选的默认职业
      const finalClassId = parsedClassId || classId || '';
      if (exist) {
        if (overwrite) {
          exist.avatar = processedImage.avatar;
          exist.quality = finalQuality;
          if (kind === 'hero' && finalClassId) exist.classId = finalClassId;
          updated++;
        } else {
          skipped++;
        }
      } else {
        if (kind === 'hero') {
          store.heroes.push({ id: uid(), name, classId: finalClassId, quality: finalQuality, avatar: processedImage.avatar });
        } else {
          store.pets.push({ id: uid(), name, quality: finalQuality, avatar: processedImage.avatar });
        }
        added++;
      }
    } catch (e) {
      console.error('导入失败：', f.name, e);
      skipped++;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (!saveStore()) {
    logEl.textContent = '❌ 导入已处理，但保存失败。请导出备份或减少图片数量后重试。';
    return;
  }
  if (kind === 'hero') { renderClasses(); renderHeroes(); refreshManualIfReady(); } else renderPets();
  const extra = kind === 'hero' && autoClass ? `，自动新建职业 ${autoClass}` : '';
  logEl.textContent = `✅ 完成：新增 ${added}，更新 ${updated}，跳过 ${skipped}${extra}`;
  toast(`✅ 批量导入完成：新增 ${added}，更新 ${updated}`, 'success');
}

document.getElementById('heroBulkBtn').onclick = async () => {
  const input = document.getElementById('heroBulkInput');
  const files = input.files;
  const logEl = document.getElementById('heroBulkLog');
  if (!files || !files.length) {
    logEl.textContent = '请先选择文件夹';
    return;
  }
  const classId = document.getElementById('heroBulkClass').value;
  const overwrite = document.getElementById('heroBulkOverwrite').checked;
  await bulkImport({ files, classId, overwrite, kind: 'hero', logEl });
  input.value = '';
};

// ========== 宠物管理 ==========
let editingPetId = null;
let pendingPetAvatar = null;
const petNameInput = document.getElementById('petName');
const petQualitySel = document.getElementById('petQuality');
const petAvatarInput = document.getElementById('petAvatar');
const petListEl = document.getElementById('petList');

petAvatarInput.addEventListener('change', async e => {
  const f = e.target.files[0];
  if (f) {
    const processed = await processImage(f, { maxSize: 200, quality: 0.85 });
    pendingPetAvatar = processed.avatar;
    petQualitySel.value = processed.quality;
  }
});
function renderPets() {
  petListEl.innerHTML = '';
  sortByQualityThenName(store.pets).forEach(p => {
    const quality = getQualityInfo(p.quality);
    const el = document.createElement('div');
    el.className = 'item-card quality-card';
    el.style.setProperty('--quality-color', quality.color);
    const avatar = p.avatar
      ? `<img src="${p.avatar}" alt="${p.name}">`
      : `<div class="avatar-placeholder" style="background:${quality.color}">${p.name[0] || '?'}</div>`;
    el.innerHTML = `
      <div class="quality-badge">${quality.name}</div>
      ${avatar}
      <div class="name">${p.name}</div>
      <div class="meta">宠物</div>
      <div class="ops">
        <button data-edit="${p.id}">编辑</button>
        <button data-del="${p.id}" class="danger">删</button>
      </div>
    `;
    petListEl.appendChild(el);
  });
}
petListEl.addEventListener('click', e => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.del;
  if (editId) {
    const p = store.pets.find(x => x.id === editId);
    editingPetId = p.id;
    petNameInput.value = p.name;
    petQualitySel.value = getQualityInfo(p.quality).key;
    pendingPetAvatar = p.avatar || null;
    petAvatarInput.value = '';
    toast('已载入「' + p.name + '」，修改后再次保存', 'info');
  }
  if (delId) {
    if (!confirm('确认删除？')) return;
    store.pets = store.pets.filter(x => x.id !== delId);
    saveStore(); renderPets();
  }
});
document.getElementById('savePetBtn').onclick = () => {
  const name = petNameInput.value.trim();
  if (!name) return alert('请输入宠物名');
  const quality = getQualityInfo(petQualitySel.value).key;
  if (editingPetId) {
    const p = store.pets.find(x => x.id === editingPetId);
    p.name = name;
    p.quality = quality;
    if (pendingPetAvatar) p.avatar = pendingPetAvatar;
  } else {
    store.pets.push({ id: uid(), name, quality, avatar: pendingPetAvatar });
  }
  editingPetId = null; pendingPetAvatar = null;
  petNameInput.value = ''; petQualitySel.value = DEFAULT_QUALITY; petAvatarInput.value = '';
  saveStore(); renderPets();
};
document.getElementById('resetPetBtn').onclick = () => {
  editingPetId = null; pendingPetAvatar = null;
  petNameInput.value = ''; petQualitySel.value = DEFAULT_QUALITY; petAvatarInput.value = '';
};

document.getElementById('petBulkBtn').onclick = async () => {
  const input = document.getElementById('petBulkInput');
  const files = input.files;
  const logEl = document.getElementById('petBulkLog');
  if (!files || !files.length) {
    logEl.textContent = '请先选择文件夹';
    return;
  }
  const overwrite = document.getElementById('petBulkOverwrite').checked;
  await bulkImport({ files, overwrite, kind: 'pet', logEl });
  input.value = '';
};

// ========== 阵容代码解析 ==========
/**
 * 新格式示例：
 *   合9法弓套法师牛-8@0@法核|鲛女|先知|双头龙|火灵|雷神|风灵|剑仙|蛮牛|光@1，鲛女511.法核512|47，火灵011.鲛女544@@7
 * 结构：
 *   阵容名 - 前缀@前缀@英雄白名单(用|分隔)@阵型代码(用|分隔关卡)@@尾缀(可选)
 * 阵型代码（同旧版）：
 *   每关：「关数，英雄1.英雄2...」
 *   每个英雄：名称 + 3 位数字（等级/行/列），等级 0 表示下场
 *   关与关之间状态累积。
 * 旧格式（无 - / @）也兼容：直接当成阵型代码使用。
 *
 * 返回：{ formationName, heroList, stages, unknownHeroes }
 */
function parseFormationCode(code) {
  let raw = (code || '').trim();
  let formationName = '';
  let heroList = null;     // 白名单（null = 不校验）
  let formationStr = raw;

  // 1) 提取阵容名（- 之前）
  const dashIdx = raw.indexOf('-');
  if (dashIdx >= 0) {
    formationName = raw.slice(0, dashIdx).trim();
    raw = raw.slice(dashIdx + 1);
  }

  // 2) 砍掉 @@ 之后的尾缀
  const dblAtIdx = raw.indexOf('@@');
  if (dblAtIdx >= 0) raw = raw.slice(0, dblAtIdx);

  // 3) 按单个 @ 切片：从右往左找
  //    - 第一个含「，/,」的非空段 = 阵型代码
  //    - 它前面第一个含「|」且不含「，/,」的段 = 英雄白名单
  if (raw.includes('@')) {
    const parts = raw.split('@').map(s => s.trim());
    let formationIdx = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] && (parts[i].includes('，') || parts[i].includes(','))) {
        formationIdx = i;
        formationStr = parts[i];
        break;
      }
    }
    if (formationIdx < 0) {
      throw new Error('解析失败：未找到阵型代码（应包含「，」或「,」）');
    }
    for (let i = formationIdx - 1; i >= 0; i--) {
      const p = parts[i];
      if (p && p.includes('|') && !p.includes('，') && !p.includes(',')) {
        heroList = p.split('|').map(s => s.trim()).filter(Boolean);
        break;
      }
    }
  }

  // 4) 解析阵型代码
  const whitelist = heroList ? new Set(heroList) : null;
  const unknownHeroes = new Set();
  const segs = formationStr.split('|').map(s => s.trim()).filter(Boolean);
  const stages = [];
  let currentBoard = new Map();
  for (const seg of segs) {
    const commaIdx = Math.max(seg.indexOf('，'), seg.indexOf(','));
    if (commaIdx < 0) continue;
    const stageStr = seg.slice(0, commaIdx).trim();
    const rest = seg.slice(commaIdx + 1).trim();
    const stage = parseInt(stageStr, 10);
    if (isNaN(stage)) continue;
    const tokens = rest.split('.').map(s => s.trim()).filter(Boolean);
    for (const tk of tokens) {
      const m = tk.match(/^(.+?)(\d{3})$/);
      if (!m) continue;
      const name = m[1].trim();
      const digits = m[2];
      const lvl = parseInt(digits[0], 10);
      const row = parseInt(digits[1], 10);
      const col = parseInt(digits[2], 10);
      if (whitelist && !whitelist.has(name)) unknownHeroes.add(name);
      if (lvl === 0) currentBoard.delete(name);
      else currentBoard.set(name, { lvl, row, col });
    }
    stages.push({ stage, board: new Map(currentBoard) });
  }
  return { formationName, heroList, stages, unknownHeroes: [...unknownHeroes] };
}

// ========== 棋盘主题切换 ==========
const THEME_KEY = 'card-formation-theme';
const boardsContainer = document.getElementById('boardsContainer');
const themeBtns = document.querySelectorAll('.theme-btn');

function applyTheme(theme) {
  if (!boardsContainer) return;
  // 清除所有 theme-* 类
  boardsContainer.className = boardsContainer.className
    .split(/\s+/).filter(c => !c.startsWith('theme-')).join(' ');
  boardsContainer.classList.add('theme-' + theme);
  themeBtns.forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
}
themeBtns.forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});
// 启动时恢复
applyTheme(localStorage.getItem(THEME_KEY) || 'chess-classic');

// ========== 棋盘渲染 ==========
function renderBoards(stages, opts = {}) {
  const { formationName = '' } = opts;
  const container = document.getElementById('boardsContainer');
  container.innerHTML = '';
  const stageSelect = document.getElementById('stageSelect');
  stageSelect.innerHTML = '';

  // 顶部阵容总标题（可编辑）
  const headerEl = document.getElementById('formationHeader');
  const titleInput = document.getElementById('formationTitle');
  if (headerEl && titleInput) {
    headerEl.style.display = '';
    titleInput.value = formationName || '我的阵容';
  }

  stages.forEach((s, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `第 ${s.stage} 关`;
    stageSelect.appendChild(opt);

    // 计算与上一关的英雄变化
    const prev = idx > 0 ? stages[idx - 1].board : null;
    const removed = []; // 下场
    const added = [];   // 上场
    if (prev) {
      const prevNames = new Set(prev.keys());
      const currNames = new Set(s.board.keys());
      for (const n of prevNames) if (!currNames.has(n)) removed.push(n);
      for (const n of currNames) if (!prevNames.has(n)) added.push(n);
    }
    const hasChanges = idx > 0 && (removed.length || added.length);

    const wrapper = document.createElement('div');
    wrapper.className = 'board-wrapper';
    wrapper.dataset.stageIdx = idx;
    wrapper.innerHTML = `<div class="board-title">第 ${s.stage} 关</div>`;
    const board = document.createElement('div');
    board.className = 'board';

    // 4 行 5 列 = 20 格
    const grid = Array.from({ length: 4 }, () => Array(5).fill(null));
    for (const [name, info] of s.board.entries()) {
      const r = info.row - 1, c = info.col - 1;
      if (r < 0 || r >= 4 || c < 0 || c >= 5) continue;
      grid[r][c] = { name, ...info };
    }

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 5; c++) {
        const cell = document.createElement('div');
        // 国际象棋深浅交替：(r + c) 偶数为浅色
        cell.className = 'cell ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
        const h = grid[r][c];
        if (h) {
          cell.classList.add('filled');
          const hero = store.heroes.find(x => x.name === h.name);
          const cls = hero ? store.classes.find(c2 => c2.id === hero.classId) : null;
          cell.style.setProperty('--class-color', cls?.color || '#5b8dee');
          cell.appendChild(buildHeroToken(h));
        }
        board.appendChild(cell);
      }
    }
    wrapper.appendChild(board);

    // 变化提示
    if (hasChanges) {
      const changes = document.createElement('div');
      changes.className = 'stage-changes';
      const parts = [];
      if (removed.length) {
        parts.push(`<div class="chg-row chg-out">
          <span class="chg-label">下</span>
          <div class="chg-list">${removed.map(buildChip).join('')}</div>
        </div>`);
      }
      if (added.length) {
        parts.push(`<div class="chg-row chg-in">
          <span class="chg-label">上</span>
          <div class="chg-list">${added.map(buildChip).join('')}</div>
        </div>`);
      }
      changes.innerHTML = parts.join('');
      wrapper.appendChild(changes);
    }

    container.appendChild(wrapper);
  });
}

// 构建一个英雄小芯片（含头像 + 名字）用于变化提示
function buildChip(name) {
  const hero = store.heroes.find(x => x.name === name);
  const cls = hero ? store.classes.find(c => c.id === hero.classId) : null;
  const color = cls?.color || '#5b8dee';
  const quality = getQualityInfo(hero?.quality);
  const avatar = hero?.avatar
    ? `<img src="${hero.avatar}" alt="${name}">`
    : `<span class="chip-placeholder" style="background:${quality.color}">${name[0] || '?'}</span>`;
  return `<span class="hero-chip" style="--c:${color};--quality-color:${quality.color}" title="${quality.name}">${avatar}<span>${name}</span></span>`;
}

function buildHeroToken(h) {
  const hero = store.heroes.find(x => x.name === h.name);
  const cls = hero ? store.classes.find(c => c.id === hero.classId) : null;
  const color = cls?.color || '#5b8dee';
  const quality = getQualityInfo(hero?.quality);
  const div = document.createElement('div');
  div.className = 'hero-token';
  div.style.setProperty('--class-color', color);
  div.style.setProperty('--quality-color', quality.color);
  let avatarHtml;
  if (hero?.avatar) {
    avatarHtml = `<img class="avatar" src="${hero.avatar}" alt="${h.name}">`;
  } else {
    avatarHtml = `<div class="avatar placeholder" style="background:${quality.color}">${h.name[0] || '?'}</div>`;
  }
  div.innerHTML = `
    ${avatarHtml}
    <div class="hname">${h.name}</div>
  `;
  return div;
}

// ========== 解析按钮 ==========
document.getElementById('parseBtn').onclick = () => {
  const code = document.getElementById('codeInput').value.trim();
  if (!code) return alert('请输入阵容代码');
  try {
    const { formationName, heroList, stages, unknownHeroes } = parseFormationCode(code);
    if (!stages.length) return alert('未解析到有效关卡');
    if (unknownHeroes.length) {
      alert(
        `⚠️ 检测到不在英雄列表中的英雄：\n\n` +
        unknownHeroes.join('、') +
        `\n\n本场上场列表：${heroList.join('、')}\n\n` +
        `请检查阵容代码或在「英雄管理」补充对应英雄。`
      );
    }
    renderBoards(stages, { formationName });
  } catch (e) {
    alert('解析失败：' + e.message);
  }
};

// ========== 导出当前关图片 ==========
// 把克隆树里 html2canvas 渲染失真的 inset box-shadow 移除，避免颜色偏暗发紫
function flattenForExport(root) {
  // 只保留职业色边框，去掉内阴影压暗
  root.querySelectorAll('.cell.filled').forEach(c => {
    const cls = c.style.getPropertyValue('--class-color') || '#5b8dee';
    c.style.boxShadow = `inset 0 0 0 2px ${cls}`;
  });
  // hero-token::before 是伪元素，无法直接改；用真实元素覆盖：在 hero-token 上加一层 outline 样的 box-shadow
  root.querySelectorAll('.hero-token').forEach(t => {
    // 通过内联样式覆盖伪元素的暗角：给 .hero-token 自己加一个空 box-shadow 不影响伪元素
    // 真正生效的方式：把伪元素的暗角通过 CSS 变量控制 → 增加一段内联样式
  });
  // 注入一段 style，强制覆盖伪元素的暗角阴影
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .hero-token::before { box-shadow: inset 0 0 0 1px rgba(255,255,255,.2) !important; }
    .cell.filled { box-shadow: inset 0 0 0 2px var(--class-color, #5b8dee) !important; }
  `;
  root.appendChild(styleEl);
}

// 渲染策略：优先用 foreignObject（色彩保真），失败时回退到普通光栅模式
async function renderToCanvas(node, bgColor) {
  // 第一次尝试：foreignObjectRendering，色彩与浏览器一致
  try {
    return await html2canvas(node, {
      backgroundColor: bgColor,
      scale: 2,
      useCORS: true,
      logging: false,
      foreignObjectRendering: true,
    });
  } catch (e) {
    // 回退普通渲染
    return await html2canvas(node, {
      backgroundColor: bgColor,
      scale: 2,
      useCORS: true,
      logging: false,
    });
  }
}

// 复制 canvas 到剪贴板（PNG）
async function copyCanvasToClipboard(canvas) {
  if (!navigator.clipboard || !window.ClipboardItem) {
    throw new Error('当前浏览器不支持剪贴板图片复制');
  }

  // Some browsers produce a visually correct downloaded dataURL but a blank
  // clipboard image when writing the direct canvas.toBlob() result. Normalize
  // through an opaque canvas and the same dataURL path used by downloads.
  const normalized = document.createElement('canvas');
  normalized.width = canvas.width;
  normalized.height = canvas.height;
  const ctx = normalized.getContext('2d');
  ctx.fillStyle = '#232744';
  ctx.fillRect(0, 0, normalized.width, normalized.height);
  ctx.drawImage(canvas, 0, 0);

  const dataUrl = normalized.toDataURL('image/png');
  const blob = await fetch(dataUrl).then(res => res.blob());
  if (!blob) throw new Error('生成图片失败');
  if (blob.size < 1024) throw new Error('生成图片异常，请改用下载全部阵容');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

// 临时小提示（右下角）
function toast(msg, type = 'info') {
  let box = document.getElementById('__toast');
  if (!box) {
    box = document.createElement('div');
    box.id = '__toast';
    box.style.cssText = `
      position: fixed; right: 20px; bottom: 20px; z-index: 9999;
      display: flex; flex-direction: column; gap: 8px;
      pointer-events: none;
    `;
    document.body.appendChild(box);
  }
  const item = document.createElement('div');
  const bg = type === 'error' ? '#e74c3c' : (type === 'success' ? '#27ae60' : '#5b8dee');
  item.style.cssText = `
    background: ${bg}; color: #fff;
    padding: 10px 16px; border-radius: 6px;
    font-size: 14px; box-shadow: 0 4px 16px rgba(0,0,0,.4);
    opacity: 0; transform: translateY(8px);
    transition: all .25s;
  `;
  item.textContent = msg;
  box.appendChild(item);
  requestAnimationFrame(() => { item.style.opacity = '1'; item.style.transform = 'translateY(0)'; });
  setTimeout(() => {
    item.style.opacity = '0'; item.style.transform = 'translateY(8px)';
    setTimeout(() => item.remove(), 250);
  }, 2000);
}

// 构建「单关」导出用的克隆容器（已附加到 body）
function buildSingleStageNode(idx) {
  const wrapper = document.querySelector(`.board-wrapper[data-stage-idx="${idx}"]`);
  if (!wrapper) return null;
  const cloned = wrapper.cloneNode(true);
  cloned.style.background = '#2c3055';
  cloned.style.border = '1px solid #3a3f6b';
  cloned.style.position = 'absolute';
  cloned.style.left = '0';
  cloned.style.top = '0';
  cloned.style.zIndex = '-1';
  cloned.style.pointerEvents = 'none';
  cloned.style.width = '480px';
  const t = cloned.querySelector('.board-title');
  if (t) {
    t.style.background = 'none';
    t.style.webkitBackgroundClip = 'initial';
    t.style.backgroundClip = 'initial';
    t.style.webkitTextFillColor = 'initial';
    t.style.color = '#ffd166';
    t.style.textShadow = '0 1px 3px rgba(0,0,0,.5)';
  }
  flattenForExport(cloned);
  document.body.appendChild(cloned);
  return cloned;
}

// 构建「全部阵容」导出用的克隆容器（已附加到 body）
function buildAllStagesNode() {
  const container = document.getElementById('boardsContainer');
  if (!container || !container.children.length) return null;
  const titleInput = document.getElementById('formationTitle');
  const titleText = (titleInput?.value || '我的阵容').trim();
  const wrap = document.createElement('div');
  wrap.style.cssText = `
    position: absolute; left: 0; top: 0; z-index: -1; pointer-events: none;
    background: #232744;
    padding: 28px;
    width: 1000px;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #e8eaf0;
  `;
  const titleEl = document.createElement('div');
  titleEl.style.cssText = `
    text-align: center;
    font-size: 32px; font-weight: 700;
    letter-spacing: 2px;
    margin-bottom: 22px;
    color: #ffd166;
    text-shadow: 0 2px 8px rgba(243,156,18,.35);
  `;
  titleEl.textContent = titleText;
  wrap.appendChild(titleEl);
  const cloned = container.cloneNode(true);
  cloned.style.gridTemplateColumns = 'repeat(2, 1fr)';
  cloned.style.gap = '14px';
  cloned.querySelectorAll('.board-wrapper').forEach(w => {
    w.style.background = '#2c3055';
    w.style.border = '1px solid #3a3f6b';
  });
  cloned.querySelectorAll('.board-title').forEach(t => {
    t.style.background = 'none';
    t.style.webkitBackgroundClip = 'initial';
    t.style.backgroundClip = 'initial';
    t.style.webkitTextFillColor = 'initial';
    t.style.color = '#ffd166';
    t.style.textShadow = '0 1px 3px rgba(0,0,0,.5)';
  });
  flattenForExport(cloned);
  wrap.appendChild(cloned);
  document.body.appendChild(wrap);
  wrap.dataset.title = titleText;
  return wrap;
}

// ====== 三个按钮 ======
document.getElementById('exportBtn').onclick = async () => {
  const idx = document.getElementById('stageSelect').value;
  if (idx === '') return toast('请先解析阵容', 'error');
  const node = buildSingleStageNode(idx);
  if (!node) return;
  try {
    const canvas = await renderToCanvas(node, '#232744');
    await copyCanvasToClipboard(canvas);
    toast('✅ 已复制到剪贴板', 'success');
  } catch (e) {
    toast('复制失败：' + e.message, 'error');
  } finally {
    node.remove();
  }
};

document.getElementById('exportAllBtn').onclick = async () => {
  const node = buildAllStagesNode();
  if (!node) return toast('请先解析阵容', 'error');
  try {
    const canvas = await renderToCanvas(node, '#232744');
    await copyCanvasToClipboard(canvas);
    toast('✅ 已复制到剪贴板', 'success');
  } catch (e) {
    toast('复制失败：' + e.message, 'error');
  } finally {
    node.remove();
  }
};

document.getElementById('downloadAllBtn').onclick = async () => {
  const node = buildAllStagesNode();
  if (!node) return toast('请先解析阵容', 'error');
  try {
    const canvas = await renderToCanvas(node, '#232744');
    const safeName = (node.dataset.title || '我的阵容').replace(/[\\/:*?"<>|]/g, '_');
    const link = document.createElement('a');
    link.download = `${safeName}-全部阵容.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('✅ 已下载', 'success');
  } catch (e) {
    toast('下载失败：' + e.message, 'error');
  } finally {
    node.remove();
  }
};

// ========== 手动布阵 ==========
let manualFilter = 'all';
let manualStages = [
  { id: uid(), stage: 1, board: {} },
];

function manualCellKey(row, col) {
  return `${row}-${col}`;
}

function manualGetHero(id) {
  return store.heroes.find(h => h.id === id);
}

function manualGetHeroClass(hero) {
  return hero ? store.classes.find(c => c.id === hero.classId) : null;
}

function renderManualClassFilter() {
  const el = document.getElementById('manualClassFilter');
  if (!el) return;
  const classCount = new Map();
  let noneCount = 0;
  store.heroes.forEach(h => {
    if (!h.classId) noneCount++;
    else classCount.set(h.classId, (classCount.get(h.classId) || 0) + 1);
  });
  const valid = new Set(store.classes.map(c => c.id));
  if (manualFilter !== 'all' && manualFilter !== 'none' && !valid.has(manualFilter)) manualFilter = 'all';
  const tabs = [
    { key: 'all', name: '全部', color: '#5b8dee', count: store.heroes.length },
    ...store.classes.map(c => ({ key: c.id, name: c.name, color: c.color, count: classCount.get(c.id) || 0 })),
  ];
  if (noneCount) tabs.push({ key: 'none', name: '无职业', color: '#7f8c8d', count: noneCount });
  el.innerHTML = tabs.map(t => `
    <button data-key="${t.key}" class="${manualFilter === t.key ? 'active' : ''}" style="--c:${t.color}">
      ${t.name}<span class="count">${t.count}</span>
    </button>
  `).join('');
}

function renderManualHeroPool() {
  renderManualClassFilter();
  const el = document.getElementById('manualHeroPool');
  if (!el) return;
  const heroes = sortByQualityThenName(store.heroes.filter(h => {
    if (manualFilter === 'all') return true;
    if (manualFilter === 'none') return !h.classId;
    return h.classId === manualFilter;
  }));
  if (!heroes.length) {
    el.innerHTML = '<div class="hint" style="grid-column:1/-1;text-align:center;padding:20px">没有可用英雄</div>';
    return;
  }
  el.innerHTML = heroes.map(h => {
    const cls = manualGetHeroClass(h);
    const color = cls?.color || '#5b8dee';
    const quality = getQualityInfo(h.quality);
    const avatar = h.avatar
      ? `<img src="${h.avatar}" alt="${h.name}">`
      : `<div class="pool-placeholder" style="background:${quality.color}">${h.name[0] || '?'}</div>`;
    return `
      <div class="pool-hero" draggable="true" data-hero-id="${h.id}" style="--class-color:${color};--quality-color:${quality.color}" title="${quality.name} ${h.name}">
        <div class="pool-quality">${quality.name}</div>
        ${avatar}
        <div class="pool-hero-name">${h.name}</div>
      </div>
    `;
  }).join('');
}

function buildManualToken(hero) {
  const cls = manualGetHeroClass(hero);
  const color = cls?.color || '#5b8dee';
  const quality = getQualityInfo(hero.quality);
  const avatar = hero.avatar
    ? `<img src="${hero.avatar}" alt="${hero.name}">`
    : `<div class="manual-placeholder" style="background:${quality.color}">${hero.name[0] || '?'}</div>`;
  return `
    <div class="manual-token" draggable="true" data-hero-id="${hero.id}" style="--class-color:${color};--quality-color:${quality.color}" title="拖动调整位置，点击移除 ${quality.name} ${hero.name}">
      ${avatar}
      <div class="manual-token-name">${hero.name}</div>
    </div>
  `;
}

function renderManualBoards() {
  const el = document.getElementById('manualBoards');
  if (!el) return;
  el.innerHTML = manualStages.map((stage, stageIndex) => {
    const cells = [];
    for (let row = 1; row <= 4; row++) {
      for (let col = 1; col <= 5; col++) {
        const key = manualCellKey(row, col);
        const hero = manualGetHero(stage.board[key]);
        cells.push(`
          <div class="manual-cell ${((row + col) % 2 === 0) ? 'light' : 'dark'} ${hero ? 'filled' : 'empty'}"
            data-stage-index="${stageIndex}" data-row="${row}" data-col="${col}" data-pos="${row}-${col}">
            ${hero ? buildManualToken(hero) : ''}
          </div>
        `);
      }
    }
    return `
      <div class="manual-stage-card" data-stage-index="${stageIndex}">
        <div class="manual-stage-head">
          <label>第 <input class="manual-stage-input" type="number" min="1" value="${stage.stage}" data-stage-index="${stageIndex}"> 关</label>
          <div class="manual-stage-actions">
            <button data-manual-duplicate="${stageIndex}">复制</button>
            <button data-manual-clear-stage="${stageIndex}">清空</button>
            <button data-manual-remove-stage="${stageIndex}" class="danger">删除</button>
          </div>
        </div>
        <div class="manual-board">${cells.join('')}</div>
      </div>
    `;
  }).join('');
}

function renderManualAll() {
  renderManualHeroPool();
  renderManualBoards();
}

function refreshManualIfReady() {
  if (document.getElementById('manualHeroPool')) renderManualAll();
}

function manualGenerateCode() {
  const title = (document.getElementById('manualTitle')?.value || '我的手动阵容').trim() || '我的手动阵容';
  const sorted = manualStages
    .map(stage => ({ ...stage, stage: Math.max(1, parseInt(stage.stage, 10) || 1) }))
    .sort((a, b) => a.stage - b.stage);
  const heroNames = Array.from(new Set(sorted.flatMap(stage => Object.values(stage.board).map(id => manualGetHero(id)?.name).filter(Boolean))));
  let prevByName = new Map();
  const segments = sorted.map((stage, index) => {
    const currentByName = new Map();
    const units = [];
    for (const [key, heroId] of Object.entries(stage.board)) {
      const hero = manualGetHero(heroId);
      if (!hero) continue;
      const [row, col] = key.split('-').map(Number);
      currentByName.set(hero.name, { row, col });
    }
    for (const [name, pos] of currentByName.entries()) {
      const prev = prevByName.get(name);
      if (index === 0 || !prev || prev.row !== pos.row || prev.col !== pos.col) {
        units.push({ name, row: pos.row, col: pos.col, remove: false });
      }
    }
    for (const [name, prev] of prevByName.entries()) {
      if (!currentByName.has(name)) {
        units.push({ name, row: prev.row, col: prev.col, remove: true });
      }
    }
    prevByName = currentByName;
    units.sort((a, b) => a.row - b.row || a.col - b.col || a.name.localeCompare(b.name, 'zh-CN'));
    return `${stage.stage}，${units.map(u => `${u.name}${u.remove ? 0 : 5}${u.row}${u.col}`).join('.')}`;
  });
  return `${title}-0@0@${heroNames.join('|')}@${segments.join('|')}@@0`;
}

function manualSyncCode() {
  const code = manualGenerateCode();
  const out = document.getElementById('manualCodeOutput');
  if (out) out.value = code;
  return code;
}

function buildManualExportNode() {
  const boards = document.getElementById('manualBoards');
  if (!boards || !boards.children.length) return null;
  const title = (document.getElementById('manualTitle')?.value || '我的手动阵容').trim() || '我的手动阵容';
  const wrap = document.createElement('div');
  wrap.style.cssText = `
    position: absolute; left: 0; top: 0; z-index: -1; pointer-events: none;
    background: #232744; padding: 28px; width: 1000px;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #e8eaf0;
  `;
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'text-align:center;font-size:32px;font-weight:700;letter-spacing:2px;margin-bottom:22px;color:#ffd166;text-shadow:0 2px 8px rgba(243,156,18,.35);';
  titleEl.textContent = title;
  wrap.appendChild(titleEl);
  const cloned = boards.cloneNode(true);
  cloned.style.gridTemplateColumns = 'repeat(2, 1fr)';
  wrap.appendChild(cloned);
  document.body.appendChild(wrap);
  return wrap;
}

document.getElementById('manualClassFilter')?.addEventListener('click', e => {
  const key = e.target.closest('button')?.dataset.key;
  if (!key) return;
  manualFilter = key;
  renderManualHeroPool();
});

document.getElementById('manualHeroPool')?.addEventListener('dragstart', e => {
  const card = e.target.closest('.pool-hero');
  if (!card) return;
  e.dataTransfer.setData('application/json', JSON.stringify({
    type: 'pool',
    heroId: card.dataset.heroId,
  }));
  e.dataTransfer.setData('text/plain', card.dataset.heroId);
  e.dataTransfer.effectAllowed = 'copyMove';
});

document.getElementById('manualBoards')?.addEventListener('dragstart', e => {
  const token = e.target.closest('.manual-token');
  if (!token) return;
  const cell = token.closest('.manual-cell');
  if (!cell) return;
  const payload = {
    type: 'board',
    heroId: token.dataset.heroId,
    stageIndex: Number(cell.dataset.stageIndex),
    key: manualCellKey(cell.dataset.row, cell.dataset.col),
  };
  e.dataTransfer.setData('application/json', JSON.stringify(payload));
  e.dataTransfer.setData('text/plain', token.dataset.heroId);
  e.dataTransfer.effectAllowed = 'move';
  cell.classList.add('drag-source');
});

document.getElementById('manualBoards')?.addEventListener('dragover', e => {
  const cell = e.target.closest('.manual-cell');
  if (!cell) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'copy' ? 'copy' : 'move';
  cell.classList.add('drag-over');
});
document.getElementById('manualBoards')?.addEventListener('dragleave', e => {
  e.target.closest('.manual-cell')?.classList.remove('drag-over');
});
document.getElementById('manualBoards')?.addEventListener('dragend', e => {
  e.currentTarget.querySelectorAll('.drag-over, .drag-source').forEach(el => {
    el.classList.remove('drag-over', 'drag-source');
  });
});
document.getElementById('manualBoards')?.addEventListener('drop', e => {
  const cell = e.target.closest('.manual-cell');
  if (!cell) return;
  e.preventDefault();
  e.currentTarget.querySelectorAll('.drag-over, .drag-source').forEach(el => {
    el.classList.remove('drag-over', 'drag-source');
  });
  let payload = null;
  try {
    payload = JSON.parse(e.dataTransfer.getData('application/json') || 'null');
  } catch (err) {}
  const heroId = payload?.heroId || e.dataTransfer.getData('text/plain');
  if (!manualGetHero(heroId)) return;
  const targetStageIndex = Number(cell.dataset.stageIndex);
  const targetKey = manualCellKey(cell.dataset.row, cell.dataset.col);
  const targetStage = manualStages[targetStageIndex];
  if (!targetStage) return;

  if (payload?.type === 'board') {
    const sourceStage = manualStages[payload.stageIndex];
    if (!sourceStage || !sourceStage.board[payload.key]) return;
    if (payload.stageIndex === targetStageIndex && payload.key === targetKey) return;

    const targetHeroId = targetStage.board[targetKey];
    delete sourceStage.board[payload.key];
    for (const [key, existingHeroId] of Object.entries(targetStage.board)) {
      if (key !== targetKey && existingHeroId === payload.heroId) delete targetStage.board[key];
    }
    targetStage.board[targetKey] = payload.heroId;
    if (targetHeroId) {
      for (const [key, existingHeroId] of Object.entries(sourceStage.board)) {
        if (key !== payload.key && existingHeroId === targetHeroId) delete sourceStage.board[key];
      }
      sourceStage.board[payload.key] = targetHeroId;
    }
  } else {
    for (const [key, existingHeroId] of Object.entries(targetStage.board)) {
      if (existingHeroId === heroId) delete targetStage.board[key];
    }
    targetStage.board[targetKey] = heroId;
  }
  renderManualBoards();
});
document.getElementById('manualBoards')?.addEventListener('click', e => {
  const removeStage = e.target.closest('[data-manual-remove-stage]')?.dataset.manualRemoveStage;
  const clearStage = e.target.closest('[data-manual-clear-stage]')?.dataset.manualClearStage;
  const duplicateStage = e.target.closest('[data-manual-duplicate]')?.dataset.manualDuplicate;
  if (removeStage !== undefined) {
    if (manualStages.length <= 1) return toast('至少保留一个关卡', 'error');
    manualStages.splice(Number(removeStage), 1);
    renderManualBoards();
    return;
  }
  if (clearStage !== undefined) {
    manualStages[Number(clearStage)].board = {};
    renderManualBoards();
    return;
  }
  if (duplicateStage !== undefined) {
    const source = manualStages[Number(duplicateStage)];
    manualStages.splice(Number(duplicateStage) + 1, 0, {
      id: uid(),
      stage: source.stage + 1,
      board: { ...source.board },
    });
    renderManualBoards();
    return;
  }
  const cell = e.target.closest('.manual-cell.filled');
  if (!cell) return;
  delete manualStages[Number(cell.dataset.stageIndex)].board[manualCellKey(cell.dataset.row, cell.dataset.col)];
  renderManualBoards();
});
document.getElementById('manualBoards')?.addEventListener('input', e => {
  const input = e.target.closest('.manual-stage-input');
  if (!input) return;
  manualStages[Number(input.dataset.stageIndex)].stage = Math.max(1, parseInt(input.value, 10) || 1);
});

document.getElementById('manualAddStageBtn')?.addEventListener('click', () => {
  const nextStage = Math.max(...manualStages.map(s => parseInt(s.stage, 10) || 1)) + 1;
  manualStages.push({ id: uid(), stage: nextStage, board: {} });
  renderManualBoards();
});
document.getElementById('manualClearBtn')?.addEventListener('click', () => {
  if (!confirm('确认清空所有手动布阵？')) return;
  manualStages = [{ id: uid(), stage: 1, board: {} }];
  document.getElementById('manualCodeOutput').value = '';
  renderManualBoards();
});
document.getElementById('manualGenerateCodeBtn')?.addEventListener('click', () => {
  manualSyncCode();
  toast('✅ 阵容脚本已生成', 'success');
});
document.getElementById('manualCopyCodeBtn')?.addEventListener('click', async () => {
  const code = manualSyncCode();
  try {
    await navigator.clipboard.writeText(code);
    toast('✅ 脚本已复制', 'success');
  } catch (e) {
    toast('复制失败：' + e.message, 'error');
  }
});
document.getElementById('manualSendToParserBtn')?.addEventListener('click', () => {
  const code = manualSyncCode();
  document.getElementById('codeInput').value = code;
  document.querySelector('nav button[data-tab="formation"]').click();
  document.getElementById('parseBtn').click();
});
document.getElementById('manualCopyImageBtn')?.addEventListener('click', async () => {
  const node = buildManualExportNode();
  if (!node) return;
  try {
    const canvas = await renderToCanvas(node, '#232744');
    await copyCanvasToClipboard(canvas);
    toast('✅ 手动阵容图已复制', 'success');
  } catch (e) {
    toast('复制失败：' + e.message, 'error');
  } finally {
    node.remove();
  }
});

// ========== 数据导入导出 ==========
document.getElementById('exportDataBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `card-formation-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};
document.getElementById('importDataFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  if (!confirm('导入会覆盖当前所有数据，确定继续？')) {
    e.target.value = ''; return;
  }
  try {
    const txt = await f.text();
    const data = JSON.parse(txt);
    store = normalizeStore(data);
    saveStore();
    renderClasses(); renderHeroes(); renderPets(); refreshManualIfReady();
    toast('✅ 导入完成', 'success');
  } catch (err) {
    toast('导入失败：' + err.message, 'error');
  } finally {
    e.target.value = '';
  }
});
document.getElementById('clearDataBtn').onclick = () => {
  if (!confirm('确认清空所有数据？此操作不可恢复！建议先导出备份。')) return;
  if (!confirm('再次确认：所有英雄、宠物、职业都会被清空！')) return;
  localStorage.removeItem(STORE_KEY);
  store = structuredClone(defaultData);
  renderClasses(); renderHeroes(); renderPets(); refreshManualIfReady();
};

// ========== 初始化 ==========
renderClasses();
renderHeroes();
renderPets();
renderManualAll();

// 默认填充示例代码
document.getElementById('codeInput').value =
  '合9法弓套法师牛-8@0@法核|鲛女|先知|双头龙|火灵|雷神|风灵|剑仙|蛮牛|光@1，鲛女511.法核512.蛮牛513.火灵514.先知515.风灵541|47，火灵011.风灵015.鲛女544.先知512.剑仙542.法核514.双头龙535.蛮牛545|54，鲛女545.先知543.剑仙535.法核534.双头龙525.蛮牛544|55，剑仙034.双头龙013.蛮牛042.鲛女511.法核522.先知524.雷神515.火灵535.风灵513|63，雷神015.火灵013.双头龙524.鲛女522.法核523.先知512.蛮牛513.风灵514|67，蛮牛013.先知511.法核513.火灵522.鲛女531.双头龙535.风灵514@@7';
