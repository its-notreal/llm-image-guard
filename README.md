# Image Guard - Firefox Extension

A Firefox extension that scans images on web pages using LLM vision models via OpenRouter and blocks content based on user-configurable rules.

## Features

- **LLM-powered image analysis** via OpenRouter API
- **User-configurable blocking rules** (one rule per line)
- **Context-aware analysis** - uses page title, image alt text, captions, and surrounding text
- **Model selection** - choose from various vision-capable models
- **Visual feedback** - scanning indicator and blocked image placeholders
- **"Show anyway" option** - reveal blocked images if needed
- **Session statistics** - track scanned and blocked image counts

## Installation

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" in the left sidebar
3. Click "Load Temporary Add-on"
4. Select the `manifest.json` file from this directory

## Configuration

1. Click the Image Guard icon in the toolbar
2. Enter your OpenRouter API key (get one at https://openrouter.ai)
3. Select a vision-capable model (GPT-4o, Claude 3, Gemini, etc.)
4. Add content rules to block (one per line), e.g.:
   - `violent content`
   - `explicit imagery`
   - `disturbing medical content`
5. Optionally enable/disable page context usage
6. Set minimum image size to scan (default: 100px)
7. Click "Save Settings"

## How It Works

1. Content script scans all images on the page
2. Images meeting size requirements are sent to the background script
3. Background script sends image + context to OpenRouter API
4. LLM analyzes if image matches any blocking rules
5. Matching images are hidden with a placeholder
6. User can click "Show anyway" to reveal blocked images

## Privacy

- Images are sent to OpenRouter API for analysis
- No data is stored remotely
- API key is stored locally in browser storage
- Results are cached locally to reduce API calls

## Requirements

- Firefox 57+
- OpenRouter API key
- A vision-capable model (GPT-4o, Claude 3, Gemini Pro Vision, etc.)
