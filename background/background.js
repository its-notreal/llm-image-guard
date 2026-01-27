let settings = {
  apiKey: '',
  model: '',
  enabled: true,
  blockRules: '',
  usePageContext: true,
  minImageSize: 100
};

let stats = { scanned: 0, blocked: 0 };
const imageCache = new Map();

async function loadSettings() {
  const stored = await browser.storage.local.get([
    'apiKey', 'model', 'enabled', 'blockRules', 'usePageContext', 'minImageSize', 'stats'
  ]);
  settings = { ...settings, ...stored };
  stats = stored.stats || { scanned: 0, blocked: 0 };
}

loadSettings();

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'settingsUpdated') {
    loadSettings();
    return;
  }

  if (message.type === 'analyzeImage') {
    analyzeImage(message.imageUrl, message.pageContext, sender.tab.id)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'getSettings') {
    sendResponse(settings);
    return;
  }
});

async function analyzeImage(imageUrl, pageContext) {
  if (!settings.enabled || !settings.apiKey || !settings.model) {
    return { shouldBlock: false, reason: 'Extension not configured' };
  }

  const cacheKey = `${imageUrl}|${settings.blockRules}`;
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey);
  }

  const rules = settings.blockRules
    .split('\n')
    .map(r => r.trim())
    .filter(r => r.length > 0);

  if (rules.length === 0) {
    return { shouldBlock: false, reason: 'No rules configured' };
  }

  let contextPrompt = '';
  if (settings.usePageContext && pageContext) {
    contextPrompt = `\n\nPage context for reference:\n- Page title: ${pageContext.title || 'Unknown'}\n- Page URL: ${pageContext.url || 'Unknown'}\n- Surrounding text: ${pageContext.surroundingText || 'None'}`;
  }

  const prompt = `Analyze this image and determine if it contains any of the following content types that should be blocked:

${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}
${contextPrompt}

IMPORTANT: Respond with ONLY a JSON object in this exact format:
{"shouldBlock": true/false, "reason": "brief explanation", "matchedRule": "the rule that matched or null"}

Be conservative - only block if you are confident the image matches a rule.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/image-guard-extension',
        'X-Title': 'Image Guard Extension'
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
        max_tokens: 200,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '';
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid response format');
    }

    const result = JSON.parse(jsonMatch[0]);
    
    stats.scanned++;
    if (result.shouldBlock) {
      stats.blocked++;
    }
    await browser.storage.local.set({ stats });

    imageCache.set(cacheKey, result);
    if (imageCache.size > 500) {
      const firstKey = imageCache.keys().next().value;
      imageCache.delete(firstKey);
    }

    return result;
  } catch (err) {
    console.error('Image Guard analysis error:', err);
    return { shouldBlock: false, reason: err.message, error: true };
  }
}

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    browser.tabs.sendMessage(tabId, { type: 'pageLoaded' }).catch(() => {});
  }
});
