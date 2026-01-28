let settings = null;
const processedImages = new WeakSet();
const pendingImages = new WeakMap();
const blockedImages = new WeakMap();

async function init() {
  try {
    settings = await browser.runtime.sendMessage({ type: 'getSettings' });
  } catch (e) {
    console.warn('Image Guard: Could not load settings');
    return;
  }
  
  if (settings?.enabled) {
    scanImages();
    if (settings.scanLazyImages !== false) {
      observeNewImages();
    }
  }
}

function isWhitelisted() {
  if (!settings?.whitelist?.length) return false;
  const hostname = window.location.hostname;
  return settings.whitelist.some(w => hostname.includes(w));
}

function getPageContext(imgElement) {
  const context = {
    title: document.title,
    url: window.location.href,
    surroundingText: ''
  };

  const textParts = [];
  
  if (imgElement.alt) textParts.push(`Alt: ${imgElement.alt}`);
  if (imgElement.title) textParts.push(`Title: ${imgElement.title}`);

  // Caption
  const figure = imgElement.closest('figure');
  if (figure) {
    const caption = figure.querySelector('figcaption');
    if (caption) textParts.push(`Caption: ${caption.textContent.trim()}`);
  }

  // Nearby headings
  const article = imgElement.closest('article, section, .post, .entry, [role="article"]');
  if (article) {
    const heading = article.querySelector('h1, h2, h3');
    if (heading) textParts.push(`Heading: ${heading.textContent.trim()}`);
  }

  // Parent link text
  const link = imgElement.closest('a');
  if (link) {
    const linkText = link.textContent.trim().replace(/\s+/g, ' ').slice(0, 100);
    if (linkText && linkText !== imgElement.alt) {
      textParts.push(`Link: ${linkText}`);
    }
  }

  // Sibling text
  const parent = imgElement.parentElement;
  if (parent) {
    const siblingText = Array.from(parent.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && n !== imgElement))
      .map(n => n.textContent?.trim())
      .filter(t => t && t.length > 2)
      .slice(0, 2)
      .join(' | ');
    if (siblingText) textParts.push(`Context: ${siblingText.slice(0, 150)}`);
  }

  context.surroundingText = textParts.join('\n').slice(0, 500);
  return context;
}

async function processImage(img) {
  if (!settings?.enabled || isWhitelisted()) return;
  if (processedImages.has(img) || pendingImages.has(img)) return;
  
  // Wait for image to load
  if (!img.complete) {
    img.addEventListener('load', () => processImage(img), { once: true });
    return;
  }

  // Check minimum size
  const minSize = settings.minImageSize || 100;
  const width = img.naturalWidth || img.offsetWidth;
  const height = img.naturalHeight || img.offsetHeight;
  if (width < minSize || height < minSize) return;

  // Get image source
  const src = img.currentSrc || img.src;
  if (!src) return;
  
  // Skip SVGs and tiny data URIs (likely icons)
  if (src.includes('.svg') || src.startsWith('data:image/svg')) return;
  if (src.startsWith('data:') && src.length < 1000) return;

  pendingImages.set(img, true);
  addScanningIndicator(img);

  try {
    // Convert to base64 if needed
    let imageUrl = src;
    if (!src.startsWith('data:')) {
      try {
        const response = await fetch(src, { mode: 'cors' });
        if (response.ok) {
          const blob = await response.blob();
          if (blob.size > 20 * 1024 * 1024) { // Skip >20MB
            removeScanningIndicator(img);
            pendingImages.delete(img);
            return;
          }
          imageUrl = await blobToBase64(blob);
        }
      } catch (e) {
        // CORS error - try using URL directly (may fail on API side)
        console.debug('Image Guard: CORS restriction, using URL directly');
      }
    }

    const pageContext = getPageContext(img);
    const result = await browser.runtime.sendMessage({
      type: 'analyzeImage',
      imageUrl,
      pageContext
    });

    if (result.shouldBlock) {
      blockImage(img, result);
    }
    
    processedImages.add(img);
  } catch (err) {
    console.error('Image Guard: Processing error', err);
  } finally {
    removeScanningIndicator(img);
    pendingImages.delete(img);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function addScanningIndicator(img) {
  img.dataset.imageGuardScanning = 'true';
  img.style.setProperty('--ig-original-filter', img.style.filter);
  img.style.filter = 'brightness(0.9)';
  
  const rect = img.getBoundingClientRect();
  if (rect.width > 60 && rect.height > 60) {
    const indicator = document.createElement('div');
    indicator.className = 'image-guard-scan-indicator';
    indicator.innerHTML = `<div class="image-guard-scan-spinner"></div>`;
    
    // Position relative to image
    const parent = img.parentElement;
    if (parent && getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    
    img.insertAdjacentElement('afterend', indicator);
  }
}

function removeScanningIndicator(img) {
  delete img.dataset.imageGuardScanning;
  img.style.filter = img.style.getPropertyValue('--ig-original-filter') || '';
  
  const indicator = img.parentElement?.querySelector('.image-guard-scan-indicator');
  if (indicator) indicator.remove();
}

// Selectors for content containers that should be hidden entirely when they contain blocked images
const CONTAINER_SELECTORS = [
  // Twitter/X
  'article[data-testid="tweet"]',
  '[data-testid="cellInnerDiv"]',
  // Facebook
  '[data-pagelet*="FeedUnit"]',
  '[role="article"]',
  // Reddit
  'shreddit-post',
  '.Post',
  '[data-testid="post-container"]',
  // Instagram
  'article[role="presentation"]',
  'article._aatb',
  // LinkedIn
  '.feed-shared-update-v2',
  // Tumblr
  '.post',
  'article.post-wrapper',
  // Generic
  'article',
  '.card',
  '.feed-item',
  '.stream-item',
  '.timeline-item',
  '[class*="post"]',
  '[class*="tweet"]',
  '[class*="status"]'
];

function findContentContainer(img) {
  // Walk up the DOM to find a suitable container to hide
  for (const selector of CONTAINER_SELECTORS) {
    const container = img.closest(selector);
    if (container) {
      // Make sure the container isn't too large (like the whole feed)
      const rect = container.getBoundingClientRect();
      if (rect.height < window.innerHeight * 1.5 && rect.height > 50) {
        return container;
      }
    }
  }
  
  // Fallback: find a reasonable parent (not too big, not too small)
  let parent = img.parentElement;
  let levels = 0;
  while (parent && levels < 8) {
    const rect = parent.getBoundingClientRect();
    // Good container: bigger than the image but not huge
    if (rect.height > 100 && rect.height < window.innerHeight * 0.8) {
      // Check if this looks like a content card/post
      const hasMultipleChildren = parent.children.length > 1;
      const hasSiblings = parent.parentElement?.children.length > 1;
      if (hasMultipleChildren || hasSiblings) {
        return parent;
      }
    }
    parent = parent.parentElement;
    levels++;
  }
  
  return null;
}

function blockImage(img, result) {
  const isTestMode = result.testMode;
  
  if (isTestMode) {
    // Test mode - show grey placeholder box
    showTestPlaceholder(img, result);
  } else {
    // Block mode - completely remove from DOM
    hideContentCompletely(img, result);
  }
}

function showTestPlaceholder(img, result) {
  const width = img.offsetWidth || img.naturalWidth || 200;
  const height = img.offsetHeight || img.naturalHeight || 150;
  
  const placeholder = document.createElement('div');
  placeholder.className = 'image-guard-blocked test-mode';
  placeholder.style.width = `${width}px`;
  placeholder.style.height = `${height}px`;
  
  if (img.style.width === '100%' || img.style.maxWidth) {
    placeholder.style.width = img.style.width || '100%';
    placeholder.style.aspectRatio = `${width} / ${height}`;
    placeholder.style.height = 'auto';
  }
  
  const showDetails = width > 150 && height > 100;
  
  placeholder.innerHTML = `
    <div class="image-guard-test-content">
      <div class="image-guard-test-badge">TEST</div>
      ${showDetails ? `
        <div class="image-guard-test-info">
          <span class="image-guard-test-category">${result.category || 'Blocked'}</span>
        </div>
      ` : ''}
    </div>
  `;
  
  placeholder.addEventListener('click', (e) => {
    if (e.target === placeholder || e.target.closest('.image-guard-test-content')) {
      placeholder.remove();
      img.style.display = '';
      blockedImages.delete(img);
    }
  });
  
  img.style.display = 'none';
  img.insertAdjacentElement('afterend', placeholder);
  blockedImages.set(img, placeholder);
}

function hideContentCompletely(img, result) {
  // Try to find a content container (tweet, post, card, etc.)
  const container = findContentContainer(img);
  
  if (container) {
    // Store original state for potential restoration
    const originalDisplay = container.style.display;
    const originalVisibility = container.style.visibility;
    
    // Completely hide the container
    container.style.display = 'none';
    container.dataset.imageGuardHidden = 'true';
    container.dataset.imageGuardReason = result.category || result.reason || 'Content blocked';
    
    blockedImages.set(img, {
      type: 'container',
      element: container,
      originalDisplay,
      originalVisibility
    });
  } else {
    // No container found - just hide the image itself
    img.style.display = 'none';
    img.dataset.imageGuardHidden = 'true';
    
    blockedImages.set(img, {
      type: 'image',
      element: img,
      originalDisplay: img.style.display
    });
  }
}

function showImage(img, blockedInfo) {
  if (!blockedInfo) {
    blockedInfo = blockedImages.get(img);
  }
  
  if (!blockedInfo) return;
  
  if (blockedInfo.type === 'container') {
    blockedInfo.element.style.display = blockedInfo.originalDisplay || '';
    blockedInfo.element.style.visibility = blockedInfo.originalVisibility || '';
    delete blockedInfo.element.dataset.imageGuardHidden;
    delete blockedInfo.element.dataset.imageGuardReason;
  } else if (blockedInfo.type === 'image') {
    img.style.display = blockedInfo.originalDisplay || '';
    delete img.dataset.imageGuardHidden;
  } else if (blockedInfo instanceof HTMLElement) {
    // Legacy: placeholder element (test mode)
    blockedInfo.remove();
    img.style.display = '';
  }
  
  blockedImages.delete(img);
}

function scanImages() {
  const images = document.querySelectorAll('img');
  
  // Process visible images first
  const visible = [];
  const hidden = [];
  
  images.forEach(img => {
    const rect = img.getBoundingClientRect();
    if (rect.top < window.innerHeight + 500 && rect.bottom > -500) {
      visible.push(img);
    } else {
      hidden.push(img);
    }
  });
  
  // Stagger processing to avoid rate limits
  visible.forEach((img, i) => {
    setTimeout(() => processImage(img), i * 100);
  });
  
  hidden.forEach((img, i) => {
    setTimeout(() => processImage(img), (visible.length + i) * 150);
  });
}

function observeNewImages() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeName === 'IMG') {
          setTimeout(() => processImage(node), 200);
        } else if (node.querySelectorAll) {
          const images = node.querySelectorAll('img');
          images.forEach((img, i) => {
            setTimeout(() => processImage(img), 200 + i * 100);
          });
        }
      }
      
      // Handle src changes
      if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
        const img = mutation.target;
        if (img.nodeName === 'IMG' && !pendingImages.has(img)) {
          processedImages.delete(img);
          setTimeout(() => processImage(img), 200);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset']
  });
  
  // Also scan on scroll (for lazy-loaded images)
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      document.querySelectorAll('img:not([data-image-guard-scanning])').forEach(img => {
        if (!processedImages.has(img) && !pendingImages.has(img)) {
          const rect = img.getBoundingClientRect();
          if (rect.top < window.innerHeight + 200 && rect.bottom > -200) {
            processImage(img);
          }
        }
      });
    }, 150);
  }, { passive: true });
}

// Message handlers
browser.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'pageLoaded':
    case 'settingsUpdated':
      init();
      break;
    case 'rescanPage':
      // Clear processed state and restore hidden content
      document.querySelectorAll('img').forEach(img => {
        processedImages.delete(img);
        const blockedInfo = blockedImages.get(img);
        if (blockedInfo) {
          showImage(img, blockedInfo);
        }
      });
      // Also restore any containers that were hidden
      document.querySelectorAll('[data-image-guard-hidden]').forEach(el => {
        el.style.display = '';
        delete el.dataset.imageGuardHidden;
        delete el.dataset.imageGuardReason;
      });
      init();
      break;
  }
});

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
