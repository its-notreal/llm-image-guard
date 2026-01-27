let settings = null;
const processedImages = new WeakSet();
const pendingImages = new Map();

async function init() {
  settings = await browser.runtime.sendMessage({ type: 'getSettings' });
  if (settings.enabled) {
    scanImages();
    observeNewImages();
  }
}

function getPageContext(imgElement) {
  const context = {
    title: document.title,
    url: window.location.href,
    surroundingText: ''
  };

  let textParts = [];
  
  if (imgElement.alt) {
    textParts.push(`Alt: ${imgElement.alt}`);
  }
  if (imgElement.title) {
    textParts.push(`Title: ${imgElement.title}`);
  }

  const figure = imgElement.closest('figure');
  if (figure) {
    const caption = figure.querySelector('figcaption');
    if (caption) {
      textParts.push(`Caption: ${caption.textContent.trim()}`);
    }
  }

  const parent = imgElement.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children)
      .filter(el => el !== imgElement && el.textContent.trim())
      .slice(0, 3)
      .map(el => el.textContent.trim().substring(0, 100));
    if (siblings.length) {
      textParts.push(`Nearby: ${siblings.join(' | ')}`);
    }
  }

  const article = imgElement.closest('article');
  if (article) {
    const heading = article.querySelector('h1, h2, h3');
    if (heading) {
      textParts.push(`Article heading: ${heading.textContent.trim()}`);
    }
  }

  context.surroundingText = textParts.join('\n').substring(0, 500);
  return context;
}

async function processImage(img) {
  if (processedImages.has(img) || pendingImages.has(img)) {
    return;
  }

  if (!img.complete) {
    img.addEventListener('load', () => processImage(img), { once: true });
    return;
  }

  const minSize = settings?.minImageSize || 100;
  if (img.naturalWidth < minSize || img.naturalHeight < minSize) {
    return;
  }

  const src = img.src || img.currentSrc;
  if (!src || src.startsWith('data:image/svg') || src.includes('.svg')) {
    return;
  }

  pendingImages.set(img, true);
  img.classList.add('image-guard-scanning');

  try {
    let imageUrl = src;
    
    if (!src.startsWith('data:')) {
      try {
        const response = await fetch(src);
        const blob = await response.blob();
        imageUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn('Image Guard: Could not fetch image, using URL directly');
      }
    }

    const pageContext = getPageContext(img);
    const result = await browser.runtime.sendMessage({
      type: 'analyzeImage',
      imageUrl,
      pageContext
    });

    if (result.shouldBlock) {
      blockImage(img, result.reason, result.matchedRule);
    }
    
    processedImages.add(img);
  } catch (err) {
    console.error('Image Guard processing error:', err);
  } finally {
    pendingImages.delete(img);
    img.classList.remove('image-guard-scanning');
  }
}

function blockImage(img, reason, matchedRule) {
  const wrapper = document.createElement('div');
  wrapper.className = 'image-guard-blocked';
  wrapper.style.width = img.offsetWidth ? `${img.offsetWidth}px` : '200px';
  wrapper.style.height = img.offsetHeight ? `${img.offsetHeight}px` : '200px';
  
  const message = document.createElement('div');
  message.className = 'image-guard-blocked-message';
  message.innerHTML = `
    <span class="image-guard-icon">🛡️</span>
    <span class="image-guard-title">Image Blocked</span>
    <span class="image-guard-reason">${matchedRule || reason}</span>
    <button class="image-guard-show-btn">Show anyway</button>
  `;
  
  wrapper.appendChild(message);
  
  const showBtn = message.querySelector('.image-guard-show-btn');
  showBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrapper.replaceWith(img);
    img.style.display = '';
  });
  
  img.style.display = 'none';
  img.insertAdjacentElement('afterend', wrapper);
  wrapper.dataset.originalSrc = img.src;
}

function scanImages() {
  const images = document.querySelectorAll('img');
  images.forEach(img => processImage(img));
}

function observeNewImages() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeName === 'IMG') {
          processImage(node);
        } else if (node.querySelectorAll) {
          const images = node.querySelectorAll('img');
          images.forEach(img => processImage(img));
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'pageLoaded' || message.type === 'settingsUpdated') {
    init();
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
