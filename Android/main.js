'use strict';

var obsidian = require('obsidian');

/* ── Settings ─────────────────────────────────────────────── */

const DEFAULT_QUERY = { tags: [], query: '{{query}}', name: '', encode: true };

const DEFAULT_SETTING = {
  searches: [
    { tags: [], query: 'https://www.google.com/search?&q={{query}}', name: 'Google', encode: true },
    { tags: [], query: 'https://en.wikipedia.org/wiki/Special:Search/{{query}}', name: 'Wikipedia', encode: true },
  ],
  useIframe: true,
};

const parseTags = (inputs) =>
  inputs.split(',').map((s) => s.trim()).filter((s) => /^#([A-Za-z])\w+$/.test(s));

class SOISettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const plugin = this.plugin;

    new obsidian.Setting(containerEl)
      .setName('Open in iframe')
      .setDesc(
        'Open searches in an iframe inside Obsidian (desktop only). ' +
        'On mobile, searches always open in your default browser.'
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useIframe).onChange((v) => {
          this.plugin.settings.useIframe = v;
          this.plugin.saveData(this.plugin.settings);
        })
      );

    plugin.settings.searches.forEach((search) => {
      const div = containerEl.createEl('div');
      div.addClass('soi_div');

      new obsidian.Setting(div)
        .addExtraButton((extra) =>
          extra.setIcon('cross').setTooltip('Delete').onClick(() => {
            const i = plugin.settings.searches.indexOf(search);
            if (i > -1) { plugin.settings.searches.splice(i, 1); this.display(); }
          })
        )
        .addText((text) =>
          text.setPlaceholder('Search name').setValue(search.name).onChange((v) => {
            const i = plugin.settings.searches.indexOf(search);
            if (i > -1) { search.name = v; plugin.saveSettings(); }
          })
        )
        .setName('Name')
        .setDesc('Name of the search. Click the cross to delete.');

      new obsidian.Setting(div)
        .setName('Encode')
        .setDesc('URL-encode the query text.')
        .addToggle((toggle) =>
          toggle.setValue(search.encode).onChange((v) => {
            const i = plugin.settings.searches.indexOf(search);
            if (i > -1) { search.encode = v; plugin.saveSettings(); }
          })
        );

      new obsidian.Setting(div)
        .addTextArea((text) => {
          const t = text.setPlaceholder('Search query').setValue(search.query).onChange((v) => {
            const i = plugin.settings.searches.indexOf(search);
            if (i > -1) { search.query = v; plugin.saveSettings(); }
          });
          t.inputEl.setAttr('rows', 2);
          return t;
        })
        .setName('URL')
        .setDesc('Use {{query}} for the selected text or note title.');

      new obsidian.Setting(div)
        .addText((text) =>
          text.setPlaceholder('').setValue(search.tags.join(', ')).onChange((v) => {
            const i = plugin.settings.searches.indexOf(search);
            if (i > -1) { search.tags = parseTags(v); plugin.saveSettings(); }
          })
        )
        .setName('Tags')
        .setDesc('Comma-separated tags to limit this search. Leave empty for all notes.');
    });

    const setting = new obsidian.Setting(containerEl).addButton((btn) =>
      btn.setButtonText('Add Search').onClick(() => {
        plugin.settings.searches.push({ name: '', query: '', tags: [], encode: true });
        this.display();
      })
    );
    setting.infoEl.remove();
  }
}

/* ── Iframe View (desktop) ────────────────────────────────── */

class SearchView extends obsidian.ItemView {
  constructor(plugin, leaf, query, site, url) {
    super(leaf);
    this.query = query; this.site = site; this.url = url; this.plugin = plugin;
  }
  async onOpen() {
    this.frame = document.createElement('iframe');
    this.frame.addClass('soi-site');
    this.frame.setAttr('style', 'height:100%;width:100%');
    this.frame.setAttr('src', this.url);
    this.frame.setAttr('tabindex', '0');
    this.containerEl.children[1].appendChild(this.frame);
  }
  getDisplayText() { return `${this.site}: ${this.query}`; }
  getViewType() { return 'Search on Internet'; }
}

/* ── Command modal ────────────────────────────────────────── */

class SearchModal extends obsidian.FuzzySuggestModal {
  constructor(app, plugin, query) {
    super(app);
    this.plugin = plugin;
    this.query = query;
    this.setPlaceholder('');
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: `to search ${this.query}` },
      { command: 'esc', purpose: 'to dismiss' },
    ]);
  }
  onOpen() { super.onOpen(); this.inputEl.focus(); }
  onClose() { super.onClose(); this.contentEl.empty(); }
  getItemText(item) { return item.name; }
  renderSuggestion(item, el) { super.renderSuggestion(item, el); el.innerHTML = 'Search on: ' + el.innerHTML; }
  getItems() { return this.plugin.settings.searches; }
  onChooseItem(item) { this.plugin.openSearch(item, this.query); }
}

/* ── Main Plugin ──────────────────────────────────────────── */

class SearchOnInternetPlugin extends obsidian.Plugin {
  async onload() {
    console.log('loading search-on-internet');
    await this.loadSettings();
    this.addSettingTab(new SOISettingTab(this.app, this));

    const plugin = this;

    // File menu (note title search)
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!file) return;
        const fileTags = this.app.metadataCache.getFileCache(file)?.tags?.map((t) => t.tag);
        this.settings.searches.forEach((search) => {
          if (search.tags.length === 0 || fileTags?.some((t) => search.tags.contains(t))) {
            menu.addItem((item) =>
              item.setTitle(`Search ${search.name}`).setIcon('search')
                .onClick(() => plugin.openSearch(search, file.basename))
            );
          }
        });
      })
    );

    // Command palette
    this.addCommand({
      id: 'search-on-internet',
      name: 'Perform search',
      callback: () => {
        let query = this.getSelectedText();
        if (!query) {
          const activeView = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
          if (!activeView) return;
          query = activeView.getDisplayText();
        }
        new SearchModal(plugin.app, plugin, query).open();
      },
    });

    // Desktop: context menu in preview mode
    this.onDom = function (event) {
      const fileMenu = new obsidian.Menu(plugin.app);
      fileMenu.dom.classList.add('soi-file-menu');
      let emptyMenu = true;
      if (event.target) {
        const classes = event.target.classList;
        if (classes.contains('cm-url') || classes.contains('external-link')) {
          const url = classes.contains('cm-url') ? event.target.textContent : event.target.href;
          fileMenu.addItem((item) =>
            item.setIcon('search').setTitle('Open in IFrame').onClick(() =>
              plugin.openSearch({ tags: [], query: '{{query}}', name: '', encode: false }, url, null)
            )
          );
          emptyMenu = false;
        }
      }
      emptyMenu = emptyMenu && !plugin.handleContext(fileMenu);
      if (!emptyMenu) { fileMenu.showAtPosition({ x: event.x, y: event.y }); event.preventDefault(); }
    };
    this.onDomSettings = {};
    document.on('contextmenu', '.markdown-preview-view', this.onDom, this.onDomSettings);

    // Desktop: editor context menu
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu) => this.handleContext(menu))
    );

    // ── Floating selection popup (works on both mobile & desktop) ──
    this.popup = document.createElement('div');
    this.popup.className = 'soi-selection-popup';
    this.popup.style.cssText =
      'display:none;position:fixed;z-index:9999;' +
      'background:var(--background-primary);' +
      'border:1px solid var(--background-modifier-border);' +
      'border-radius:10px;' +
      'box-shadow:0 4px 24px rgba(0,0,0,0.35);' +
      'padding:8px;display:none;flex-wrap:wrap;gap:6px;' +
      'max-width:92vw;align-items:center;';
    document.body.appendChild(this.popup);

    this._selectionDebounce = null;

    this._onSelectionChange = () => {
      clearTimeout(this._selectionDebounce);
      this._selectionDebounce = setTimeout(() => {
        const query = this.getSelectedText();
        if (!query || !query.trim()) { this._hidePopup(); return; }
        this._showPopup(query);
      }, 250);
    };

    this._onPointerDown = (e) => {
      if (!this.popup.contains(e.target)) this._hidePopup();
    };

    document.addEventListener('selectionchange', this._onSelectionChange);
    document.addEventListener('pointerdown', this._onPointerDown);
  }

  _buildPopupButtons(query) {
    this.popup.innerHTML = '';

    const label = document.createElement('span');
    label.textContent = '🔍';
    label.style.cssText = 'font-size:1em;padding:0 2px 0 4px;opacity:0.7;';
    this.popup.appendChild(label);

    this.settings.searches.forEach((search) => {
      const btn = document.createElement('button');
      btn.textContent = search.name;
      btn.style.cssText =
        'padding:8px 14px;border-radius:8px;border:none;' +
        'background:var(--interactive-accent);color:var(--text-on-accent);' +
        'font-size:0.95em;font-weight:500;cursor:pointer;white-space:nowrap;' +
        'min-height:36px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;';
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openSearch(search, query, null);
        this._hidePopup();
        window.getSelection()?.removeAllRanges();
      });
      this.popup.appendChild(btn);
    });
  }

  _showPopup(query) {
    this._buildPopupButtons(query);
    const popup = this.popup;
    popup.style.display = 'flex';

    // Position near selection or fall back to top-center
    let x = window.innerWidth / 2 - 120;
    let y = 70;
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        x = Math.max(8, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 16));
        y = rect.bottom + 10;
        if (y + popup.offsetHeight > window.innerHeight - 8) y = rect.top - popup.offsetHeight - 10; // flip above if too close to bottom
      }
    } catch (e) { /* keep defaults */ }

    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;
  }

  _hidePopup() {
    this.popup.style.display = 'none';
  }

  getSelectedText() {
    const w = window.getSelection();
    if (w && w.toString()) return w.toString();
    const d = document?.getSelection();
    if (d && d.type !== 'Control') return d.toString();
    return null;
  }

  handleContext(menu) {
    const query = this.getSelectedText();
    if (!query || !query.trim()) return false;
    for (const s of this.settings.searches) {
      menu.addItem((item) =>
        item.setTitle('Search on ' + s.name).setIcon('search')
          .onClick(() => this.openSearch(s, query, null))
      );
    }
    return true;
  }

  async openSearch(search, query, activeView = null) {
    const q = search.encode ? encodeURIComponent(query) : query;
    const url = search.query.replace('{{title}}', q).replace('{{query}}', q);
    console.log(`SOI: Opening URL ${url}`);

    if (this.settings.useIframe && !obsidian.Platform.isMobile) {
      if (activeView) {
        activeView.frame.setAttr('src', url);
        activeView.url = url;
      } else {
        const leaf = this.app.workspace.getLeaf(
          !(this.app.workspace.activeLeaf.view.getViewType() === 'empty')
        );
        await leaf.open(new SearchView(this, leaf, query, search.name, url));
      }
    } else {
      window.open(url, '_blank');
    }
  }

  onunload() {
    console.log('unloading search-on-internet');
    document.off('contextmenu', '.markdown-preview-view', this.onDom, this.onDomSettings);
    document.removeEventListener('selectionchange', this._onSelectionChange);
    document.removeEventListener('pointerdown', this._onPointerDown);
    this.popup?.remove();
  }

  async loadSettings() {
    const loaded = await this.loadData();
    if (loaded?.hasOwnProperty('searches')) {
      loaded.searches = loaded.searches.map((s) => Object.assign({}, DEFAULT_QUERY, s));
      this.settings = loaded;
    } else {
      this.settings = DEFAULT_SETTING;
    }
  }

  async saveSettings() { await this.saveData(this.settings); }
}

module.exports = SearchOnInternetPlugin;
