let settings = {
  apiKey: '',
  model: '',
  enabled: true,
  categories: [],
  customRules: '',
  usePageContext: true,
  minImageSize: 100,
  sensitivity: 3,
  whitelist: [],
  operatingMode: 'block'
};

let stats = { scanned: 0, blocked: 0, allowed: 0, cached: 0 };
let pageStats = {};
const imageCache = new Map();
const MAX_CACHE_SIZE = 1000;

async function loadSettings() {
  const previousMode = settings.operatingMode;
  
  const stored = await browser.storage.local.get([
    'apiKey', 'model', 'enabled', 'categories', 'customRules',
    'usePageContext', 'minImageSize', 'sensitivity', 'whitelist',
    'operatingMode', 'stats', 'pageStats'
  ]);
  
  settings = { ...settings, ...stored };
  stats = stored.stats || stats;
  pageStats = stored.pageStats || {};
  
  // Clear cache when switching between block and test modes
  if (previousMode && previousMode !== settings.operatingMode) {
    imageCache.clear();
    console.log('Image Guard: Cache cleared due to mode change');
  }
}

loadSettings();

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'settingsUpdated':
      loadSettings();
      broadcastToTabs({ type: 'settingsUpdated' });
      break;
      
    case 'analyzeImage':
      const tabId = sender.tab?.id;
      analyzeImage(message.imageUrl, message.pageContext, tabId)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
      return true;
      
    case 'getSettings':
      sendResponse(settings);
      return;
      
    case 'clearCache':
      imageCache.clear();
      sendResponse({ success: true });
      return;
      
    case 'rescanPage':
      if (sender.tab?.id) {
        browser.tabs.sendMessage(sender.tab.id, { type: 'rescanPage' }).catch(() => {});
      }
      break;
  }
});

function broadcastToTabs(message) {
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, message).catch(() => {});
    });
  });
}

function buildPrompt(pageContext) {
  const enabledCategories = settings.categories.filter(c => c.enabled);
  const customRules = settings.customRules
    .split('\n')
    .map(r => r.trim())
    .filter(r => r.length > 0);
  
  if (enabledCategories.length === 0 && customRules.length === 0) {
    return null;
  }
  
  const sensitivityMap = {
    1: 'Be very conservative. Only block if the content is extremely obvious and egregious.',
    2: 'Be conservative. Only block if you are highly confident the image matches.',
    3: 'Use balanced judgment. Block if the content reasonably matches the criteria.',
    4: 'Be thorough. Block content that could potentially match the criteria.',
    5: 'Be aggressive. Block anything that might possibly match the criteria, even if uncertain.'
  };
  
  let prompt = `You are an image content analyzer. Analyze this image and determine if it should be blocked based on the following criteria.\n\n`;
  
  if (enabledCategories.length > 0) {
    prompt += `BLOCKED CONTENT CATEGORIES:\n`;
    enabledCategories.forEach((cat, i) => {
      prompt += `${i + 1}. ${cat.name}: ${cat.description}\n`;
    });
    prompt += '\n';
  }
  
  if (customRules.length > 0) {
    prompt += `ADDITIONAL RULES - Block images containing:\n`;
    customRules.forEach((rule, i) => {
      prompt += `- ${rule}\n`;
    });
    prompt += '\n';
  }
  
  prompt += `SENSITIVITY: ${sensitivityMap[settings.sensitivity]}\n\n`;
  
  if (settings.usePageContext && pageContext) {
    prompt += `PAGE CONTEXT (use for better understanding):\n`;
    prompt += `- Page: ${pageContext.title || 'Unknown'}\n`;
    if (pageContext.surroundingText) {
      prompt += `- Context: ${pageContext.surroundingText.slice(0, 300)}\n`;
    }
    prompt += '\n';
  }
  
  prompt += `RESPOND WITH ONLY A JSON OBJECT:\n`;
  prompt += `{"block": true/false, "category": "matched category name or null", "reason": "brief 1-sentence explanation", "confidence": 0.0-1.0}\n\n`;
  prompt += `Be accurate. False positives frustrate users, but missed content is harmful.`;
  
  return prompt;
}

async function analyzeImage(imageUrl, pageContext, tabId) {
  if (!settings.enabled) {
    return { shouldBlock: false, reason: 'Scanning disabled' };
  }
  
  if (!settings.apiKey || !settings.model) {
    return { shouldBlock: false, reason: 'Not configured' };
  }
  
  // Check whitelist
  if (pageContext?.url) {
    try {
      const hostname = new URL(pageContext.url).hostname;
      if (settings.whitelist.some(w => hostname.includes(w))) {
        return { shouldBlock: false, reason: 'Site whitelisted' };
      }
    } catch (e) {}
  }
  
  // Check cache
  const cacheKey = createCacheKey(imageUrl);
  if (imageCache.has(cacheKey)) {
    const cached = imageCache.get(cacheKey);
    stats.cached++;
    await updateStats();
    return { ...cached, fromCache: true };
  }
  
  const prompt = buildPrompt(pageContext);
  if (!prompt) {
    return { shouldBlock: false, reason: 'No rules configured' };
  }
  
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/image-guard-extension',
        'X-Title': 'Image Guard'
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 150,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '';
    
    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Image Guard: Invalid response format', content);
      return { shouldBlock: false, reason: 'Analysis failed', error: true };
    }

    const result = JSON.parse(jsonMatch[0]);
    
    const processedResult = {
      shouldBlock: result.block === true,
      category: result.category || null,
      reason: result.reason || 'No reason provided',
      confidence: result.confidence || 0,
      testMode: settings.operatingMode === 'test'
    };
    
    // Update stats
    stats.scanned++;
    if (processedResult.shouldBlock) {
      stats.blocked++;
    } else {
      stats.allowed++;
    }
    await updateStats();
    
    // Update page stats
    if (tabId) {
      if (!pageStats[tabId]) {
        pageStats[tabId] = { scanned: 0, blocked: 0 };
      }
      pageStats[tabId].scanned++;
      if (processedResult.shouldBlock) {
        pageStats[tabId].blocked++;
      }
      await browser.storage.local.set({ pageStats });
    }
    
    // Cache result
    imageCache.set(cacheKey, processedResult);
    if (imageCache.size > MAX_CACHE_SIZE) {
      const firstKey = imageCache.keys().next().value;
      imageCache.delete(firstKey);
    }

    return processedResult;
  } catch (err) {
    console.error('Image Guard analysis error:', err);
    return { shouldBlock: false, reason: err.message, error: true };
  }
}

function createCacheKey(imageUrl) {
  // Use first 200 chars of URL + hash of full URL for cache key
  const shortUrl = imageUrl.slice(0, 200);
  let hash = 0;
  for (let i = 0; i < imageUrl.length; i++) {
    const char = imageUrl.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `${shortUrl}|${hash}`;
}

async function updateStats() {
  await browser.storage.local.set({ stats });
}

// Clean up page stats when tabs close
browser.tabs.onRemoved.addListener((tabId) => {
  if (pageStats[tabId]) {
    delete pageStats[tabId];
    browser.storage.local.set({ pageStats });
  }
});

// Notify content scripts when tab loads
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    // Reset page stats for this tab
    pageStats[tabId] = { scanned: 0, blocked: 0 };
    browser.storage.local.set({ pageStats });
    browser.tabs.sendMessage(tabId, { type: 'pageLoaded' }).catch(() => {});
  }
});

// Set up badge
browser.browserAction.setBadgeBackgroundColor({ color: '#6366f1' });
