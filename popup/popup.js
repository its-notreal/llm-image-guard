const DEFAULT_CATEGORIES = [
  {
    id: 'violence',
    name: 'Violence & Gore',
    description: 'Images depicting physical violence, fighting, injuries, blood, gore, or graphic harm to people or animals',
    icon: '💀',
    enabled: true
  },
  {
    id: 'nsfw',
    name: 'Adult Content',
    description: 'Sexually explicit or suggestive imagery, nudity, or pornographic content',
    icon: '🔞',
    enabled: true
  },
  {
    id: 'disturbing',
    name: 'Disturbing Content',
    description: 'Graphic, shocking, or disturbing imagery including body horror, extreme medical images, or grotesque content',
    icon: '⚠️',
    enabled: true
  },
  {
    id: 'drugs',
    name: 'Drug Use',
    description: 'Images depicting illegal drug use, drug paraphernalia, or substance abuse',
    icon: '💊',
    enabled: false
  },
  {
    id: 'weapons',
    name: 'Weapons',
    description: 'Images prominently featuring firearms, knives, or other weapons in threatening contexts',
    icon: '🔫',
    enabled: false
  },
  {
    id: 'hate',
    name: 'Hate Symbols',
    description: 'Images containing hate symbols, extremist imagery, or content promoting discrimination',
    icon: '🚫',
    enabled: false
  }
];

let allModels = [];
let settings = {};
let currentTab = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadCurrentTab();
  setupTabs();
  setupEventListeners();
  renderCategories();
  renderWhitelist();
  updateStats();
  updatePageInfo();
  
  if (settings.apiKey) {
    fetchModels();
  }
});

async function loadSettings() {
  const stored = await browser.storage.local.get([
    'apiKey', 'model', 'enabled', 'categories', 'customRules',
    'usePageContext', 'minImageSize', 'sensitivity', 'scanLazyImages',
    'whitelist', 'operatingMode', 'stats', 'pageStats'
  ]);
  
  settings = {
    apiKey: stored.apiKey || '',
    model: stored.model || '',
    enabled: stored.enabled !== false,
    categories: stored.categories || DEFAULT_CATEGORIES,
    customRules: stored.customRules || '',
    usePageContext: stored.usePageContext !== false,
    minImageSize: stored.minImageSize || 100,
    sensitivity: stored.sensitivity || 3,
    scanLazyImages: stored.scanLazyImages !== false,
    whitelist: stored.whitelist || [],
    operatingMode: stored.operatingMode || 'block',
    stats: stored.stats || { scanned: 0, blocked: 0, allowed: 0, cached: 0 },
    pageStats: stored.pageStats || {}
  };
  
  document.getElementById('masterEnabled').checked = settings.enabled;
  document.getElementById('apiKey').value = settings.apiKey;
  document.getElementById('customRules').value = settings.customRules;
  document.getElementById('usePageContext').checked = settings.usePageContext;
  document.getElementById('minImageSize').value = settings.minImageSize;
  document.getElementById('minImageSizeValue').textContent = `${settings.minImageSize}px`;
  document.getElementById('sensitivity').value = settings.sensitivity;
  updateSensitivityLabel(settings.sensitivity);
  document.getElementById('scanLazyImages').checked = settings.scanLazyImages;
  document.querySelector(`input[name="operatingMode"][value="${settings.operatingMode}"]`).checked = true;
  
  if (settings.model) {
    updateSelectedModel(settings.model);
  }
}

async function loadCurrentTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

function setupEventListeners() {
  // Master toggle
  document.getElementById('masterEnabled').addEventListener('change', async (e) => {
    settings.enabled = e.target.checked;
    await saveSettings();
    notifyContentScript('settingsUpdated');
  });
  
  // Operating mode
  document.querySelectorAll('input[name="operatingMode"]').forEach(input => {
    input.addEventListener('change', (e) => {
      settings.operatingMode = e.target.value;
    });
  });
  
  // API key visibility toggle
  document.getElementById('toggleApiKey').addEventListener('click', () => {
    const input = document.getElementById('apiKey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  
  // Model search
  const modelSearch = document.getElementById('modelSearch');
  const modelDropdown = document.getElementById('modelDropdown');
  
  modelSearch.addEventListener('focus', () => {
    if (allModels.length === 0 && settings.apiKey) {
      fetchModels();
    }
    modelDropdown.classList.add('show');
    filterModels(modelSearch.value);
  });
  
  modelSearch.addEventListener('input', (e) => {
    filterModels(e.target.value);
  });
  
  modelSearch.addEventListener('blur', () => {
    setTimeout(() => modelDropdown.classList.remove('show'), 200);
  });
  
  document.getElementById('clearModel').addEventListener('click', () => {
    settings.model = '';
    updateSelectedModel('');
  });
  
  // Range inputs
  document.getElementById('minImageSize').addEventListener('input', (e) => {
    document.getElementById('minImageSizeValue').textContent = `${e.target.value}px`;
    settings.minImageSize = parseInt(e.target.value);
  });
  
  document.getElementById('sensitivity').addEventListener('input', (e) => {
    settings.sensitivity = parseInt(e.target.value);
    updateSensitivityLabel(settings.sensitivity);
  });
  
  // Checkboxes
  document.getElementById('usePageContext').addEventListener('change', (e) => {
    settings.usePageContext = e.target.checked;
  });
  
  document.getElementById('scanLazyImages').addEventListener('change', (e) => {
    settings.scanLazyImages = e.target.checked;
  });
  
  // Add category
  document.getElementById('addCategory').addEventListener('click', () => {
    document.getElementById('addCategoryModal').classList.add('show');
  });
  
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('addCategoryModal').classList.remove('show');
      clearCategoryForm();
    });
  });
  
  // Icon picker
  document.querySelectorAll('.icon-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.icon-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });
  
  // Save category
  document.getElementById('saveCategoryBtn').addEventListener('click', saveNewCategory);
  
  // Whitelist
  document.getElementById('addWhitelist').addEventListener('click', addWhitelistSite);
  document.getElementById('whitelistInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addWhitelistSite();
  });
  
  document.getElementById('whitelistSite').addEventListener('click', async () => {
    if (currentTab) {
      const url = new URL(currentTab.url);
      if (!settings.whitelist.includes(url.hostname)) {
        settings.whitelist.push(url.hostname);
        renderWhitelist();
        await saveSettings();
        showStatus('Site whitelisted', 'success');
      }
    }
  });
  
  // Quick actions
  document.getElementById('pauseScanning').addEventListener('click', async () => {
    settings.enabled = false;
    document.getElementById('masterEnabled').checked = false;
    await saveSettings();
    showStatus('Scanning paused', 'success');
  });
  
  document.getElementById('rescanPage').addEventListener('click', () => {
    notifyContentScript('rescanPage');
    showStatus('Rescanning page...', 'success');
  });
  
  // Data actions
  document.getElementById('clearCache').addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: 'clearCache' });
    showStatus('Cache cleared', 'success');
  });
  
  document.getElementById('resetStats').addEventListener('click', async () => {
    settings.stats = { scanned: 0, blocked: 0, allowed: 0, cached: 0 };
    settings.pageStats = {};
    await saveSettings();
    updateStats();
    showStatus('Statistics reset', 'success');
  });
  
  document.getElementById('exportSettings').addEventListener('click', exportSettings);
  document.getElementById('importSettings').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importSettings);
  
  // Save button
  document.getElementById('saveSettings').addEventListener('click', async () => {
    settings.apiKey = document.getElementById('apiKey').value.trim();
    settings.customRules = document.getElementById('customRules').value.trim();
    
    if (!settings.apiKey) {
      showStatus('API key required', 'error');
      return;
    }
    
    if (!settings.model) {
      showStatus('Please select a model', 'error');
      return;
    }
    
    await saveSettings();
    notifyContentScript('settingsUpdated');
    showStatus('Settings saved!', 'success');
  });
  
  // Listen for stats updates
  browser.storage.onChanged.addListener((changes) => {
    if (changes.stats) {
      settings.stats = changes.stats.newValue;
      updateStats();
    }
    if (changes.pageStats) {
      settings.pageStats = changes.pageStats.newValue;
      updatePageInfo();
    }
  });
}

async function fetchModels() {
  const modelList = document.getElementById('modelList');
  modelList.innerHTML = '<div class="loading">Loading models</div>';
  
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: settings.apiKey ? { 'Authorization': `Bearer ${settings.apiKey}` } : {}
    });
    
    if (!response.ok) throw new Error('Failed to fetch models');
    
    const data = await response.json();
    allModels = data.data
      .filter(m => {
        const isVision = m.architecture?.modality === 'multimodal' ||
          m.id.includes('vision') ||
          m.id.includes('gpt-4o') ||
          m.id.includes('gpt-4-turbo') ||
          m.id.includes('claude-3') ||
          m.id.includes('gemini') ||
          m.description?.toLowerCase().includes('vision') ||
          m.description?.toLowerCase().includes('image');
        return isVision;
      })
      .map(m => ({
        id: m.id,
        name: m.name || m.id.split('/').pop(),
        provider: m.id.split('/')[0],
        contextLength: m.context_length,
        pricing: m.pricing
      }))
      .sort((a, b) => {
        const providerOrder = ['openai', 'anthropic', 'google', 'meta-llama', 'mistralai'];
        const aIdx = providerOrder.indexOf(a.provider);
        const bIdx = providerOrder.indexOf(b.provider);
        if (aIdx !== bIdx) return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
        return a.name.localeCompare(b.name);
      });
    
    filterModels('');
    
    if (settings.model) {
      updateSelectedModel(settings.model);
    }
  } catch (err) {
    modelList.innerHTML = '<div class="model-option"><span class="model-option-name">Failed to load models. Check API key.</span></div>';
  }
}

function filterModels(query) {
  const modelList = document.getElementById('modelList');
  const q = query.toLowerCase();
  
  const filtered = allModels.filter(m => 
    m.name.toLowerCase().includes(q) || 
    m.id.toLowerCase().includes(q) ||
    m.provider.toLowerCase().includes(q)
  );
  
  if (filtered.length === 0) {
    modelList.innerHTML = '<div class="model-option"><span class="model-option-name">No matching models</span></div>';
    return;
  }
  
  modelList.innerHTML = filtered.slice(0, 50).map(m => {
    const price = m.pricing?.prompt ? `$${(parseFloat(m.pricing.prompt) * 1000000).toFixed(2)}/M tokens` : '';
    return `
      <div class="model-option" data-model-id="${m.id}">
        <div class="model-option-name">${m.name}</div>
        <div class="model-option-id">${m.id}</div>
        <div class="model-option-meta">
          <span>${m.provider}</span>
          ${m.contextLength ? `<span>${(m.contextLength / 1000).toFixed(0)}K context</span>` : ''}
          ${price ? `<span>${price}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  modelList.querySelectorAll('.model-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const modelId = opt.dataset.modelId;
      settings.model = modelId;
      updateSelectedModel(modelId);
      document.getElementById('modelDropdown').classList.remove('show');
      document.getElementById('modelSearch').value = '';
    });
  });
}

function updateSelectedModel(modelId) {
  const selectedDiv = document.getElementById('selectedModel');
  const model = allModels.find(m => m.id === modelId);
  
  if (modelId && model) {
    selectedDiv.classList.remove('empty');
    selectedDiv.querySelector('.model-name').textContent = `${model.name} (${model.provider})`;
  } else if (modelId) {
    selectedDiv.classList.remove('empty');
    selectedDiv.querySelector('.model-name').textContent = modelId;
  } else {
    selectedDiv.classList.add('empty');
    selectedDiv.querySelector('.model-name').textContent = 'No model selected';
  }
}

function updateSensitivityLabel(value) {
  const labels = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
  document.getElementById('sensitivityValue').textContent = labels[value - 1];
}

function renderCategories() {
  const container = document.getElementById('categoriesList');
  container.innerHTML = settings.categories.map((cat, index) => `
    <div class="category-item" data-index="${index}">
      <span class="category-icon">${cat.icon}</span>
      <div class="category-info">
        <div class="category-name">${cat.name}</div>
        <div class="category-desc">${cat.description}</div>
      </div>
      <div class="category-actions">
        <button class="btn-icon-small delete-category" data-index="${index}" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3,6 5,6 21,6"/>
            <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/>
          </svg>
        </button>
      </div>
      <label class="category-toggle">
        <input type="checkbox" ${cat.enabled ? 'checked' : ''} data-index="${index}">
        <span class="toggle-slider"></span>
      </label>
    </div>
  `).join('');
  
  container.querySelectorAll('.category-toggle input').forEach(input => {
    input.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      settings.categories[index].enabled = e.target.checked;
    });
  });
  
  container.querySelectorAll('.delete-category').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      settings.categories.splice(index, 1);
      renderCategories();
    });
  });
}

function saveNewCategory() {
  const name = document.getElementById('categoryName').value.trim();
  const description = document.getElementById('categoryDescription').value.trim();
  const icon = document.querySelector('.icon-option.selected')?.textContent || '🛡️';
  
  if (!name || !description) {
    alert('Please fill in all fields');
    return;
  }
  
  settings.categories.push({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    description,
    icon,
    enabled: true
  });
  
  renderCategories();
  document.getElementById('addCategoryModal').classList.remove('show');
  clearCategoryForm();
}

function clearCategoryForm() {
  document.getElementById('categoryName').value = '';
  document.getElementById('categoryDescription').value = '';
  document.querySelectorAll('.icon-option').forEach(o => o.classList.remove('selected'));
  document.querySelector('.icon-option').classList.add('selected');
}

function renderWhitelist() {
  const container = document.getElementById('whitelistContainer');
  
  if (settings.whitelist.length === 0) {
    container.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">No sites whitelisted</span>';
    return;
  }
  
  container.innerHTML = settings.whitelist.map(site => `
    <span class="whitelist-tag">
      ${site}
      <button data-site="${site}">&times;</button>
    </span>
  `).join('');
  
  container.querySelectorAll('.whitelist-tag button').forEach(btn => {
    btn.addEventListener('click', () => {
      const site = btn.dataset.site;
      settings.whitelist = settings.whitelist.filter(s => s !== site);
      renderWhitelist();
    });
  });
}

function addWhitelistSite() {
  const input = document.getElementById('whitelistInput');
  const site = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  
  if (site && !settings.whitelist.includes(site)) {
    settings.whitelist.push(site);
    renderWhitelist();
    input.value = '';
  }
}

function updateStats() {
  document.getElementById('statScanned').textContent = settings.stats.scanned.toLocaleString();
  document.getElementById('statBlocked').textContent = settings.stats.blocked.toLocaleString();
  document.getElementById('statAllowed').textContent = settings.stats.allowed.toLocaleString();
  document.getElementById('statCached').textContent = settings.stats.cached.toLocaleString();
}

function updatePageInfo() {
  if (currentTab) {
    const url = new URL(currentTab.url);
    document.getElementById('currentPageUrl').textContent = url.hostname + url.pathname.slice(0, 30);
    
    const pageStats = settings.pageStats[currentTab.id] || { scanned: 0, blocked: 0 };
    document.getElementById('pageScanned').textContent = pageStats.scanned;
    document.getElementById('pageBlocked').textContent = pageStats.blocked;
  }
}

async function saveSettings() {
  await browser.storage.local.set({
    apiKey: settings.apiKey,
    model: settings.model,
    enabled: settings.enabled,
    categories: settings.categories,
    customRules: settings.customRules,
    usePageContext: settings.usePageContext,
    minImageSize: settings.minImageSize,
    sensitivity: settings.sensitivity,
    scanLazyImages: settings.scanLazyImages,
    whitelist: settings.whitelist,
    operatingMode: settings.operatingMode,
    stats: settings.stats,
    pageStats: settings.pageStats
  });
}

function notifyContentScript(type) {
  browser.runtime.sendMessage({ type });
  if (currentTab) {
    browser.tabs.sendMessage(currentTab.id, { type }).catch(() => {});
  }
}

function showStatus(message, type) {
  const status = document.getElementById('saveStatus');
  status.textContent = message;
  status.className = `save-status ${type}`;
  setTimeout(() => {
    status.textContent = '';
    status.className = 'save-status';
  }, 3000);
}

function exportSettings() {
  const exportData = {
    categories: settings.categories,
    customRules: settings.customRules,
    whitelist: settings.whitelist,
    minImageSize: settings.minImageSize,
    sensitivity: settings.sensitivity,
    usePageContext: settings.usePageContext,
    operatingMode: settings.operatingMode
  };
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'image-guard-settings.json';
  a.click();
  URL.revokeObjectURL(url);
  showStatus('Settings exported', 'success');
}

async function importSettings(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    if (data.categories) settings.categories = data.categories;
    if (data.customRules) settings.customRules = data.customRules;
    if (data.whitelist) settings.whitelist = data.whitelist;
    if (data.minImageSize) settings.minImageSize = data.minImageSize;
    if (data.sensitivity) settings.sensitivity = data.sensitivity;
    if (data.usePageContext !== undefined) settings.usePageContext = data.usePageContext;
    if (data.operatingMode) settings.operatingMode = data.operatingMode;
    
    await saveSettings();
    await loadSettings();
    renderCategories();
    renderWhitelist();
    showStatus('Settings imported', 'success');
  } catch (err) {
    showStatus('Invalid settings file', 'error');
  }
  
  e.target.value = '';
}
