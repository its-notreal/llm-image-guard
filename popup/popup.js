const VISION_MODELS = [
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku' },
  { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5' },
  { id: 'google/gemini-flash-1.5', name: 'Gemini Flash 1.5' }
];

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const modelSelect = document.getElementById('model');
  const enabledCheckbox = document.getElementById('enabled');
  const blockRulesTextarea = document.getElementById('blockRules');
  const usePageContextCheckbox = document.getElementById('usePageContext');
  const minImageSizeInput = document.getElementById('minImageSize');
  const saveButton = document.getElementById('save');
  const refreshModelsButton = document.getElementById('refreshModels');
  const statusDiv = document.getElementById('status');
  const scannedCountSpan = document.getElementById('scannedCount');
  const blockedCountSpan = document.getElementById('blockedCount');

  populateModels();

  const settings = await browser.storage.local.get([
    'apiKey',
    'model',
    'enabled',
    'blockRules',
    'usePageContext',
    'minImageSize',
    'stats'
  ]);

  if (settings.apiKey) apiKeyInput.value = settings.apiKey;
  if (settings.model) modelSelect.value = settings.model;
  enabledCheckbox.checked = settings.enabled !== false;
  if (settings.blockRules) blockRulesTextarea.value = settings.blockRules;
  usePageContextCheckbox.checked = settings.usePageContext !== false;
  if (settings.minImageSize) minImageSizeInput.value = settings.minImageSize;

  const stats = settings.stats || { scanned: 0, blocked: 0 };
  scannedCountSpan.textContent = stats.scanned;
  blockedCountSpan.textContent = stats.blocked;

  function populateModels(models) {
    const list = models || VISION_MODELS;
    modelSelect.innerHTML = '';
    list.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      modelSelect.appendChild(opt);
    });
    if (settings.model) {
      modelSelect.value = settings.model;
    }
  }

  async function fetchModels() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus('Enter API key first', 'error');
      return;
    }
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      const data = await response.json();
      const visionModels = data.data
        .filter(m => m.architecture?.modality === 'multimodal' || 
                     m.id.includes('vision') || 
                     m.id.includes('gpt-4o') ||
                     m.id.includes('claude-3') ||
                     m.id.includes('gemini'))
        .map(m => ({ id: m.id, name: m.name || m.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
      
      if (visionModels.length > 0) {
        populateModels(visionModels);
        showStatus('Models refreshed', 'success');
      } else {
        showStatus('No vision models found', 'error');
      }
    } catch (err) {
      showStatus('Failed to fetch models', 'error');
    }
  }

  refreshModelsButton.addEventListener('click', fetchModels);

  saveButton.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;
    const enabled = enabledCheckbox.checked;
    const blockRules = blockRulesTextarea.value.trim();
    const usePageContext = usePageContextCheckbox.checked;
    const minImageSize = parseInt(minImageSizeInput.value, 10) || 100;

    if (!apiKey) {
      showStatus('API key is required', 'error');
      return;
    }
    if (!model) {
      showStatus('Please select a model', 'error');
      return;
    }
    if (!blockRules) {
      showStatus('Please add at least one block rule', 'error');
      return;
    }

    await browser.storage.local.set({
      apiKey,
      model,
      enabled,
      blockRules,
      usePageContext,
      minImageSize
    });

    browser.runtime.sendMessage({ type: 'settingsUpdated' });

    showStatus('Settings saved!', 'success');
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
    setTimeout(() => {
      statusDiv.className = 'status';
    }, 3000);
  }

  browser.storage.onChanged.addListener((changes) => {
    if (changes.stats) {
      const stats = changes.stats.newValue || { scanned: 0, blocked: 0 };
      scannedCountSpan.textContent = stats.scanned;
      blockedCountSpan.textContent = stats.blocked;
    }
  });
});
