# Image Guard

AI-powered image content filter for Firefox. Uses vision-capable LLMs via OpenRouter to scan and block unwanted images based on customizable content categories.

## Features

- **Category-based filtering** - Enable/disable built-in categories (violence, adult content, disturbing imagery, etc.) or create your own
- **Custom rules** - Add specific content descriptions to block
- **Any OpenRouter model** - Choose from 50+ vision-capable models with searchable dropdown
- **Block or Test mode** - Either hide images completely or show grey placeholders (like uBlock Origin)
- **Context-aware** - Uses page title, image captions, and surrounding text for better accuracy
- **Per-site whitelisting** - Disable scanning on trusted sites
- **Statistics dashboard** - Track scanned, blocked, and cached images
- **Import/Export settings** - Back up and share your configuration

## Installation

1. Open Firefox and go to `about:debugging`
2. Click **This Firefox** in the sidebar
3. Click **Load Temporary Add-on**
4. Select `manifest.json` from this directory

For permanent installation, the extension needs to be signed by Mozilla or installed in Developer Edition with `xpinstall.signatures.required` set to `false`.

## Quick Start

1. Click the Image Guard icon in your toolbar
2. Go to **Settings** tab
3. Enter your [OpenRouter API key](https://openrouter.ai/keys)
4. Search and select a vision model (recommended: GPT-4o Mini, Claude 3 Haiku, or Gemini Flash)
5. Click **Save Changes**
6. Go to **Filters** tab to customize which content categories to block

## Operating Modes

### Block Mode (Default)
Images matching your filters are replaced with a dark placeholder showing the blocked category. Click "Show" to reveal the image.

### Test Mode
Images are replaced with a minimal grey box labeled "TEST". Useful for testing your filters without fully blocking content. Click anywhere on the placeholder to reveal.

## Default Categories

- **Violence & Gore** - Physical violence, injuries, blood
- **Adult Content** - Sexually explicit or suggestive imagery
- **Disturbing Content** - Graphic, shocking, or grotesque imagery
- **Drug Use** - Illegal drug use or paraphernalia (disabled by default)
- **Weapons** - Firearms or weapons in threatening contexts (disabled by default)
- **Hate Symbols** - Extremist imagery or hate symbols (disabled by default)

## Adding Custom Categories

1. Go to **Filters** tab
2. Click **Add Category**
3. Enter a name, detailed description (this is what the AI sees), and choose an icon
4. The new category will be enabled by default

## Sensitivity Levels

- **Very Low** - Only blocks extremely obvious content
- **Low** - Blocks content you're highly confident matches
- **Medium** (default) - Balanced judgment
- **High** - Blocks content that could potentially match
- **Very High** - Blocks anything that might possibly match

## Recommended Models

For best balance of speed, accuracy, and cost:

| Model | Speed | Cost | Accuracy |
|-------|-------|------|----------|
| GPT-4o Mini | Fast | Low | Good |
| Claude 3 Haiku | Fast | Low | Good |
| Gemini Flash 1.5 | Very Fast | Very Low | Good |
| GPT-4o | Medium | Medium | Excellent |
| Claude 3.5 Sonnet | Medium | Medium | Excellent |

## Privacy

- Images are sent to OpenRouter for analysis (required for LLM processing)
- Your API key is stored locally in browser storage
- Analysis results are cached locally to reduce API calls
- No data is collected by Image Guard itself

## Troubleshooting

**Images not being scanned:**
- Check that the master toggle is enabled (top right of popup)
- Verify your API key is correct
- Make sure a model is selected
- Check if the site is whitelisted

**Too many false positives:**
- Lower the sensitivity setting
- Make category descriptions more specific
- Use a more capable model (GPT-4o, Claude 3.5 Sonnet)

**CORS errors in console:**
- Some images can't be fetched due to cross-origin restrictions
- The extension will try to use the URL directly, but this may fail

## License

MIT
