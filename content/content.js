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

function blockImage(img, result) {
  const isTestMode = result.testMode;
  const width = img.offsetWidth || img.naturalWidth || 200;
  const height = img.offsetHeight || img.naturalHeight || 150;
  
  const placeholder = document.createElement('div');
  placeholder.className = `image-guard-blocked ${isTestMode ? 'test-mode' : ''}`;
  placeholder.style.width = `${width}px`;
  placeholder.style.height = `${height}px`;
  
  // Preserve aspect ratio for responsive images
  if (img.style.width === '100%' || img.style.maxWidth) {
    placeholder.style.width = img.style.width || '100%';
    placeholder.style.aspectRatio = `${width} / ${height}`;
    placeholder.style.height = 'auto';
  }
  
  const showDetails = width > 150 && height > 100;
  
  if (isTestMode) {
    // Test mode - minimal grey box
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
  } else {
    // Block mode - full UI
    placeholder.innerHTML = `
      <div class="image-guard-block-content">
        <div class="image-guard-block-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L22 8.5V15.5L12 22L2 15.5V8.5L12 2Z"/>
            <circle cx="12" cy="12" r="4"/>
          </svg>
        </div>
        ${showDetails ? `
          <div class="image-guard-block-text">
            <div class="image-guard-block-title">Content Blocked</div>
            <div class="image-guard-block-reason">${result.category || result.reason}</div>
          </div>
        ` : ''}
        <button class="image-guard-show-btn" title="Show image">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          ${width > 180 ? 'Show' : ''}
        </button>
      </div>
    `;
  }
  
  // Add show button handler
  const showBtn = placeholder.querySelector('.image-guard-show-btn');
  if (showBtn) {
    showBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showImage(img, placeholder);
    });
  }
  
  // For test mode, clicking anywhere reveals
  if (isTestMode) {
    placeholder.addEventListener('click', (e) => {
      if (e.target === placeholder || e.target.closest('.image-guard-test-content')) {
        showImage(img, placeholder);
      }
    });
  }
  
  // Hide original image and insert placeholder
  img.style.display = 'none';
  img.insertAdjacentElement('afterend', placeholder);
  
  blockedImages.set(img, placeholder);
}

function showImage(img, placeholder) {
  placeholder.remove();
  img.style.display = '';
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
      // Clear processed state and rescan
      document.querySelectorAll('img').forEach(img => {
        processedImages.delete(img);
        const placeholder = blockedImages.get(img);
        if (placeholder) {
          placeholder.remove();
          img.style.display = '';
          blockedImages.delete(img);
        }
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
