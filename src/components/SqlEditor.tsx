import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, moveLineDown, moveLineUp } from "@codemirror/commands";
import { MSSQL, sql } from "@codemirror/lang-sql";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
} from "@codemirror/language";
import { linter } from "@codemirror/lint";
import { closeSearchPanel, getSearchQuery, highlightSelectionMatches, openSearchPanel, search, searchKeymap, searchPanelOpen } from "@codemirror/search";
import { EditorState, Compartment } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  ViewPlugin,
  ViewUpdate
} from "@codemirror/view";
import { showMinimap } from "@replit/codemirror-minimap";
import { invoke } from "@tauri-apps/api/core";
import { createEffect, onCleanup, onMount, untrack } from "solid-js";
import { getModifierKeyLabel } from "../lib/platform";
import { sqlLinter } from "../lib/sql-linter";
import type { DatabaseSchemaCatalogEntry } from "../lib/types";

// --- Custom Scrollbar Search Annotations Plugin ---
const searchScrollbarPlugin = ViewPlugin.fromClass(class {
  dom: HTMLElement;

  constructor(view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-search-scrollbar-marks";
    this.dom.style.cssText = "position: absolute; right: 0; top: 0; bottom: 0; width: 6px; pointer-events: none; z-index: 100;";
    view.dom.appendChild(this.dom);
    this.updateMarks(view);
  }

  update(update: ViewUpdate) {
    const oldQuery = getSearchQuery(update.startState);
    const newQuery = getSearchQuery(update.state);

    if (update.docChanged || update.viewportChanged || update.geometryChanged || !oldQuery.eq(newQuery)) {
      this.updateMarks(update.view);
    }
  }

  updateMarks(view: EditorView) {
    const query = getSearchQuery(view.state);
    this.dom.innerHTML = "";

    // Position search marks to the left of the minimap
    const minimapGutter = view.dom.querySelector('.cm-minimap-gutter') as HTMLElement | null;
    const scroller = view.scrollDOM;
    // Calculate native scrollbar width
    const scrollbarWidth = scroller.offsetWidth - scroller.clientWidth;
    const minimapWidth = minimapGutter ? minimapGutter.offsetWidth : 0;
    this.dom.style.right = `${minimapWidth + scrollbarWidth}px`;

    if (!query || !query.valid || !query.search) return;

    const cursor = query.getCursor(view.state.doc) as any;
    const scrollHeight = Math.max(view.scrollDOM.scrollHeight, 1);
    let count = 0;

    while (!cursor.next().done) {
      const pos = cursor.value.from;
      // Get the physical pixel position of the line
      const block = view.lineBlockAt(pos);

      // Map it to the scrollbar track height
      const top = (block.top / scrollHeight) * 100;

      const mark = document.createElement("div");
      mark.style.cssText = `position: absolute; top: ${top}%; height: 2px; width: 100%; background-color: var(--color-warning); opacity: 0.8;`;
      this.dom.appendChild(mark);

      count++;
      if (count > 1000) break;
    }
  }

  destroy() {
    this.dom.remove();
  }
});

interface Props {
  value: string;
  onChange: (value: string) => void;
  onExecute: (selectedSql?: string) => void;
  readOnly?: boolean;
  theme: { id: string };
  currentDatabase?: string;
  onContextMenu?: (e: MouseEvent) => void;
  onRef?: (handle: SqlEditorHandle) => void;
  onSearchPanelChange?: (open: boolean) => void;
  wrapLines?: boolean;
}

export interface SqlEditorHandle {
  focus: () => void;
  openCompletion: () => void;
  openSearch: () => void;
  getSelectedText: () => string;
  scrollToBottom: () => void;
}

function createFoldMarker(open: boolean): HTMLElement {
  const marker = document.createElement("span");
  marker.className = "cm-foldMarker";
  marker.setAttribute("aria-hidden", "true");
  marker.dataset.state = open ? "open" : "closed";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 12 12");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", open ? "M3 4.5 6 7.5 9 4.5" : "M4.5 3 7.5 6 4.5 9");

  svg.appendChild(path);
  marker.appendChild(svg);

  return marker;
}

interface SchemaTableEntry {
  name: string;
  schema: string;
  columns: string[];
}

type SchemaTableMap = Map<string, SchemaTableEntry>;

const schemaCatalogCache = new Map<string, SchemaTableMap>();
const schemaCatalogLoaders = new Map<string, Promise<SchemaTableMap>>();

function buildSchemaTableMap(entries: DatabaseSchemaCatalogEntry[]): SchemaTableMap {
  const map: SchemaTableMap = new Map();

  for (const entry of entries) {
    map.set(entry.table_name.toLowerCase(), {
      name: entry.table_name,
      schema: entry.schema_name,
      columns: entry.columns,
    });
  }

  return map;
}

async function loadSchemaTableMap(database: string): Promise<SchemaTableMap> {
  const cached = schemaCatalogCache.get(database);
  if (cached) {
    return cached;
  }

  const existingLoader = schemaCatalogLoaders.get(database);
  if (existingLoader) {
    return existingLoader;
  }

  const loader = invoke<DatabaseSchemaCatalogEntry[]>("get_database_schema_catalog", {
    database,
  })
    .then((entries) => {
      const map = buildSchemaTableMap(entries);
      schemaCatalogCache.set(database, map);
      return map;
    })
    .finally(() => {
      schemaCatalogLoaders.delete(database);
    });

  schemaCatalogLoaders.set(database, loader);
  return loader;
}

export default function SqlEditor(props: Props) {
  let containerRef: HTMLDivElement | undefined;
  let viewRef: EditorView | null = null;
  let schemaRef: { database?: string; tables: SchemaTableMap } = { tables: new Map() };
  const wrapCompartment = new Compartment();
  const executeShortcutLabel = `${getModifierKeyLabel()}+Enter`;

  let lastSearchString = "";
  let lastCount = -1;

  const searchHistory: string[] = [];
  let historyIndex = -1;

  const handle: SqlEditorHandle = {
    focus() {
      viewRef?.focus();
    },
    openCompletion() {
      if (!viewRef) return;
      viewRef.focus();
      startCompletion(viewRef);
    },
    openSearch() {
      if (!viewRef) return;
      const panel = viewRef.dom.querySelector(".cm-panel.cm-search");
      if (panel) {
        closeSearchPanel(viewRef);
      } else {
        viewRef.focus();
        openSearchPanel(viewRef);
      }
    },
    getSelectedText() {
      if (!viewRef) return "";
      const selection = viewRef.state.selection.main;
      if (selection.from === selection.to) return "";
      return viewRef.state.doc.sliceString(selection.from, selection.to);
    },
    scrollToBottom() {
      if (!viewRef) return;
      const end = viewRef.state.doc.length;
      viewRef.dispatch({
        selection: { anchor: end },
        scrollIntoView: true,
      });
    },
  };

  onMount(() => {
    props.onRef?.(handle);
  });

  const schemaCompletionSource = async (context: CompletionContext) => {
    const database = props.currentDatabase;
    if (!database) {
      return null;
    }

    let { tables } = schemaRef;
    if (schemaRef.database !== database) {
      if (!context.explicit) {
        return null;
      }

      try {
        tables = await loadSchemaTableMap(database);
      } catch (err) {
        console.error("Failed to load schema for autocomplete:", err);
        return null;
      }

      if (props.currentDatabase !== database) {
        return null;
      }

      schemaRef = { database, tables };
    }

    if (tables.size === 0) return null;

    const word = context.matchBefore(/[\w.]+/);
    if (!word && !context.explicit) return null;
    const from = word?.from ?? context.pos;
    const text = word?.text ?? "";

    const dotParts = text.split(".");

    if (dotParts.length >= 2) {
      const lastPart = dotParts[dotParts.length - 1];
      const tableName = dotParts.length >= 3 ? dotParts[1] : dotParts[0];
      const entry = tables.get(tableName.toLowerCase());
      if (entry) {
        return {
          from: from + text.length - lastPart.length,
          options: entry.columns.map((col) => ({ label: col, type: "property" })),
        };
      }
    }

    const options: { label: string; type: string; detail?: string }[] = [];
    for (const [, entry] of tables) {
      options.push({ label: entry.name, type: "type", detail: entry.schema });
    }
    return { from, options };
  };

  createEffect(() => {
    const theme = props.theme;
    const currentDatabase = props.currentDatabase;
    const readOnly = props.readOnly;

    if (!containerRef) return;

    const runExecute = (view: EditorView) => {
      const selection = view.state.selection.main;
      const selectedSql =
        selection.from !== selection.to
          ? view.state.doc.sliceString(selection.from, selection.to)
          : undefined;
      props.onExecute(selectedSql);
      return true;
    };

    const executeKeymap = keymap.of([
      { key: "F5", run: runExecute },
      { key: "Mod-Enter", run: runExecute },
    ]);
    const lineMovementKeymap = keymap.of([
      { key: "Alt-ArrowUp", run: moveLineUp },
      { key: "Alt-ArrowDown", run: moveLineDown },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        props.onChange(update.state.doc.toString());
      }

      if (viewRef && searchPanelOpen(update.state) && containerRef) {
        const panel = containerRef.querySelector(".cm-panel.cm-search");
        if (panel) {
          let countSpan = panel.querySelector(".cm-search-match-count") as HTMLSpanElement | null;
          let countSpanCreated = false;
          if (!countSpan) {
            countSpan = document.createElement("span");
            countSpan.className = "cm-search-match-count text-xs opacity-60 pointer-events-none select-none inline-flex items-center whitespace-nowrap justify-center";
            countSpan.style.order = "0";
            countSpan.style.marginLeft = "8px";
            countSpan.style.marginRight = "8px";

            const nextBtn = panel.querySelector("button[name='next']");
            if (nextBtn && nextBtn.parentElement) {
              nextBtn.parentElement.insertBefore(countSpan, nextBtn);
            } else {
              panel.appendChild(countSpan);
            }
            countSpanCreated = true;
          }

          const query = getSearchQuery(update.state);
          const currentSearchString = query?.valid && query?.search ? `${query.search}|${query.caseSensitive}|${query.regexp}|${query.wholeWord}` : "";
          const queryChanged = currentSearchString !== lastSearchString;
          // Walk the document only when the query changed or the document
          // actually changed. Pure cursor moves, viewport changes, and focus
          // updates would otherwise cause an O(N) re-walk every keystroke.
          const needsWalk = queryChanged || update.docChanged || countSpanCreated;

          if (needsWalk) {
            lastSearchString = currentSearchString;

            if (!currentSearchString) {
              lastCount = -1;
            } else {
              let count = 0;
              const cursor = query.getCursor(update.state.doc) as any;
              while (!cursor.next().done) {
                count++;
                if (count >= 1000) break;
              }
              lastCount = count;
            }
          }

          if (lastCount === -1 || lastCount === 0) {
            countSpan.textContent = "No results";
          } else if (lastCount >= 1000) {
            countSpan.textContent = "1000+ results";
          } else {
            countSpan.textContent = `${lastCount} result${lastCount === 1 ? '' : 's'}`;
          }

          const hasResults = lastCount > 0;
          const replaceBtn = panel.querySelector('button[name="replace"]') as HTMLButtonElement | null;
          const replaceAllBtn = panel.querySelector('button[name="replaceAll"]') as HTMLButtonElement | null;
          const nextBtn = panel.querySelector('button[name="next"]') as HTMLButtonElement | null;
          const prevBtn = panel.querySelector('button[name="prev"]') as HTMLButtonElement | null;

          if (replaceBtn) replaceBtn.disabled = !hasResults;
          if (replaceAllBtn) replaceAllBtn.disabled = !hasResults;
          if (nextBtn) nextBtn.disabled = !hasResults;
          if (prevBtn) prevBtn.disabled = !hasResults;
        }
      }
    });
    const placeholderText = readOnly && !currentDatabase
      ? "Select a database to enable the SQL editor."
      : `-- Write your SQL query here... (F5 or ${executeShortcutLabel} to execute)`;

    const state = EditorState.create({
      doc: untrack(() => props.value),
      extensions: [
        searchScrollbarPlugin,
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        foldGutter({
          markerDOM: (open) => createFoldMarker(open),
        }),
        bracketMatching(),
        closeBrackets(),
        autocompletion({
          defaultKeymap: true,
          closeOnBlur: false,
          maxRenderedOptions: 5,
        }),
        sql({ dialect: MSSQL, upperCaseKeywords: true }),
        EditorState.languageData.of(() => [
          { autocomplete: schemaCompletionSource },
        ]),
        search(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ...(theme.id === "light" || theme.id === "soft-light" ? [] : [oneDark]),
        executeKeymap,
        lineMovementKeymap,
        keymap.of([
          { key: "Tab", run: acceptCompletion },
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...closeBracketsKeymap,
          ...foldKeymap,
          ...searchKeymap,
        ]),
        updateListener,
        placeholderExt(placeholderText),
        wrapCompartment.of(props.wrapLines ? EditorView.lineWrapping : []),
        showMinimap.of({
          create: () => {
            const dom = document.createElement("div");
            dom.className = "cm-minimap-container";
            return { dom };
          },
          showOverlay: "mouse-over",
        }),
        ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
        ...(readOnly ? [] : [linter(sqlLinter, { delay: 500 })]),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef,
    });

    viewRef = view;

    const enhanceSearchPanel = (panel: HTMLElement) => {
      if (panel.dataset.enhanced === "true") return;
      panel.dataset.enhanced = "true";
      panel.setAttribute("data-replace-open", "false");

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "cm-search-toggle-replace";
      toggle.setAttribute("aria-label", "Toggle replace");
      toggle.setAttribute("title", "Toggle replace");
      toggle.innerHTML =
        '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        const isOpen = panel.getAttribute("data-replace-open") === "true";
        panel.setAttribute("data-replace-open", isOpen ? "false" : "true");
      });

      panel.insertBefore(toggle, panel.firstChild);

      const allButton = panel.querySelector('button[name="select"]');
      if (allButton) {
        allButton.remove();
      }

      const searchInput = panel.querySelector('input[name="search"]') as HTMLInputElement;
      if (searchInput && searchInput.parentElement) {
        const wasFocused = document.activeElement === searchInput;

        const wrapper = document.createElement("div");
        wrapper.className = "cm-search-input-wrapper";
        searchInput.parentElement.insertBefore(wrapper, searchInput);
        wrapper.appendChild(searchInput);

        // Restore focus if it was lost during the move, or if we're just opening the panel
        if (wasFocused || document.activeElement === document.body) {
          searchInput.focus();
        }

        searchInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            const val = searchInput.value;
            if (val && searchHistory[0] !== val) {
              searchHistory.unshift(val);
              if (searchHistory.length > 50) searchHistory.pop();
            }
            historyIndex = -1;
          } else if (e.key === "ArrowUp") {
            if (searchHistory.length > 0 && historyIndex < searchHistory.length - 1) {
              if (historyIndex === -1 && searchInput.value && searchHistory[0] !== searchInput.value) {
                searchHistory.unshift(searchInput.value);
                historyIndex = 0;
              }
              historyIndex++;
              searchInput.value = searchHistory[historyIndex];
              searchInput.dispatchEvent(new Event("input", { bubbles: true }));
              e.preventDefault();
            }
          } else if (e.key === "ArrowDown") {
            if (historyIndex > 0) {
              historyIndex--;
              searchInput.value = searchHistory[historyIndex];
              searchInput.dispatchEvent(new Event("input", { bubbles: true }));
              e.preventDefault();
            } else if (historyIndex === 0) {
              historyIndex = -1;
              searchInput.value = "";
              searchInput.dispatchEvent(new Event("input", { bubbles: true }));
              e.preventDefault();
            }
          }
        });

        const labels = panel.querySelectorAll("label");
        labels.forEach(label => {
          const input = label.querySelector('input[type="checkbox"]') as HTMLInputElement;
          if (!input) return;

          Array.from(label.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) node.remove();
          });

          label.classList.add("cm-search-option");

          const iconSpan = document.createElement("span");
          if (input.name === "case") {
            label.setAttribute("title", "Match Case");
            iconSpan.textContent = "Aa";
          } else if (input.name === "word") {
            label.setAttribute("title", "Match Whole Word");
            iconSpan.innerHTML = "<span class='underline'>ab</span>";
          } else if (input.name === "re") {
            label.setAttribute("title", "Use Regular Expression");
            iconSpan.textContent = ".*";
          }
          label.appendChild(iconSpan);

          wrapper.appendChild(label);
        });
      }
    };

    const panelObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.classList.contains("cm-panel") && node.classList.contains("cm-search")) {
            enhanceSearchPanel(node);
            props.onSearchPanelChange?.(true);
          } else {
            const nested = node.querySelector?.(".cm-panel.cm-search");
            if (nested instanceof HTMLElement) {
              enhanceSearchPanel(nested);
              props.onSearchPanelChange?.(true);
            }
          }
        });
        mutation.removedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (
            (node.classList.contains("cm-panel") && node.classList.contains("cm-search")) ||
            node.querySelector?.(".cm-panel.cm-search")
          ) {
            props.onSearchPanelChange?.(false);
          }
        });
      }
    });
    panelObserver.observe(containerRef, { childList: true, subtree: true });

    onCleanup(() => {
      panelObserver.disconnect();
      view.destroy();
      viewRef = null;
    });
  });

  createEffect(() => {
    const value = props.value;
    if (viewRef && viewRef.state.doc.toString() !== value) {
      viewRef.dispatch({
        changes: {
          from: 0,
          to: viewRef.state.doc.length,
          insert: value,
        },
      });
    }
  });

  createEffect(() => {
    if (viewRef) {
      viewRef.dispatch({
        effects: wrapCompartment.reconfigure(props.wrapLines ? EditorView.lineWrapping : []),
      });
    }
  });

  createEffect(() => {
    const currentDatabase = props.currentDatabase;
    if (!currentDatabase) return;
    const cached = schemaCatalogCache.get(currentDatabase);
    if (cached) {
      schemaRef = { database: currentDatabase, tables: cached };
      return;
    }

    schemaRef = { database: currentDatabase, tables: new Map() };

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadSchemaTableMap(currentDatabase)
        .then((tables) => {
          if (cancelled || props.currentDatabase !== currentDatabase) {
            return;
          }

          schemaRef = { database: currentDatabase, tables };
        })
        .catch((err) => {
          if (!cancelled) {
            console.error("Failed to preload schema for autocomplete:", err);
          }
        });
    }, 150);

    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timer);
    });
  });

  createEffect(() => {
    const currentDatabase = props.currentDatabase;
    if (!currentDatabase) {
      schemaRef = { database: undefined, tables: new Map() };
    }
  });

  return <div ref={containerRef} onContextMenu={props.onContextMenu} class="h-full min-h-0 w-full relative" />;
}
