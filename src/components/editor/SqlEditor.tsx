import {
  acceptCompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus,
  startCompletion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyField,
  historyKeymap,
  indentLess,
  indentMore,
  moveLineDown,
  moveLineUp,
} from "@codemirror/commands";
import { MSSQL, sql } from "@codemirror/lang-sql";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { linter } from "@codemirror/lint";
import {
  closeSearchPanel,
  getSearchQuery,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
} from "@codemirror/search";
import { EditorState, Compartment, Transaction, Annotation, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import {
  createEffect,
  createMemo,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";
import { loadEditorPreferences, loadFormatPreferences } from "../../lib/settings";
import type { EditorSuggestionStyle } from "../../lib/settings";
import { preloadSchemaCatalog } from "../../lib/schema-catalog";
import { buildAutocompletionExt, sqlCompletionSource } from "../../lib/sql-completion";
import {
  acceptInlineSuggestion,
  clearInlineSuggestion,
  hasInlineSuggestion,
  sqlInlineCompletion,
} from "../../lib/sql-inline-completion";
import { formatSqlWithPrefs } from "../../lib/sql-format";
import { sqlLinter } from "../../lib/sql-linter";
import type { ThemeSelection } from "../../lib/theme";
import type { QueryTabUpdateOptions } from "../../lib/types";
import {
  consumeNavigationRestore,
  EDITOR_NAVIGATION_CHAR_JUMP,
  EDITOR_NAVIGATION_LINE_JUMP,
  hasNavigationRestore,
  type EditorNavigationPoint,
  type EditorViewLocation,
} from "../../lib/editor-navigation";

const externalSyncAnnotation = Annotation.define<boolean>();
const editorHistoryConfig = { history: historyField };

interface CachedTabEditorState {
  json: unknown;
  scrollTop: number;
  scrollLeft: number;
  anchor: number;
  head: number;
}

const tabEditorStateCache = new Map<string, CachedTabEditorState>();

function sqlTextEquals(a: string, b: string) {
  return a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");
}

function snapshotTabEditorState(tabId: string, view: EditorView) {
  const selection = view.state.selection.main;
  tabEditorStateCache.set(tabId, {
    json: view.state.toJSON(editorHistoryConfig),
    scrollTop: view.scrollDOM.scrollTop,
    scrollLeft: view.scrollDOM.scrollLeft,
    anchor: selection.anchor,
    head: selection.head,
  });
}

let scrollApplyGeneration = 0;

function applyCachedScroll(
  view: EditorView,
  top: number,
  left: number,
  onSettled?: () => void,
) {
  const generation = ++scrollApplyGeneration;
  const apply = () => {
    if (generation !== scrollApplyGeneration) return false;
    view.scrollDOM.scrollTop = top;
    view.scrollDOM.scrollLeft = left;
    return true;
  };
  apply();
  requestAnimationFrame(() => {
    if (!apply()) return;
    requestAnimationFrame(() => {
      if (!apply()) return;
      onSettled?.();
    });
  });
}

function restoreTabEditorState(
  tabId: string,
  value: string,
  view: EditorView,
  extensions: Extension[],
) {
  const cached = tabEditorStateCache.get(tabId);
  if (!cached) return;

  let restored: EditorState | undefined;
  try {
    restored = EditorState.fromJSON(
      cached.json,
      { extensions },
      editorHistoryConfig,
    );
  } catch {
    restored = undefined;
  }

  if (restored && sqlTextEquals(restored.doc.toString(), value)) {
    view.setState(restored);
  } else {
    const max = value.length;
    view.setState(EditorState.create({ doc: value, extensions }));
    view.dispatch({
      selection: {
        anchor: Math.min(Math.max(cached.anchor, 0), max),
        head: Math.min(Math.max(cached.head, 0), max),
      },
      annotations: [
        Transaction.addToHistory.of(false),
        externalSyncAnnotation.of(true),
      ],
    });
  }
}

function insertIndentUnit(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const unit = view.state.facet(indentUnit);
  view.dispatch({
    ...view.state.replaceSelection(unit),
    userEvent: "input",
  });
  return true;
}

function indentSizeUnit(): string {
  const size = loadFormatPreferences().indentSize;
  return " ".repeat(size > 0 ? size : 2);
}

const searchScrollbarPlugin = ViewPlugin.fromClass(
  class {
    dom: HTMLElement;

    constructor(view: EditorView) {
      this.dom = document.createElement("div");
      this.dom.className = "cm-search-scrollbar-marks";
      this.dom.style.cssText =
        "position: absolute; right: 0; top: 0; bottom: 0; width: 6px; pointer-events: none; z-index: 100;";
      view.dom.appendChild(this.dom);
      this.updateMarks(view);
    }

    update(update: ViewUpdate) {
      const oldQuery = getSearchQuery(update.startState);
      const newQuery = getSearchQuery(update.state);

      if (
        update.docChanged ||
        update.viewportChanged ||
        update.geometryChanged ||
        !oldQuery.eq(newQuery)
      ) {
        this.updateMarks(update.view);
      }
    }

    updateMarks(view: EditorView) {
      const query = getSearchQuery(view.state);
      this.dom.innerHTML = "";

      const minimapGutter = view.dom.querySelector(
        ".cm-minimap-gutter",
      ) as HTMLElement | null;
      const scroller = view.scrollDOM;

      const scrollbarWidth = scroller.offsetWidth - scroller.clientWidth;
      const minimapWidth = minimapGutter ? minimapGutter.offsetWidth : 0;
      this.dom.style.right = `${minimapWidth + scrollbarWidth}px`;
      this.dom.style.display = minimapGutter ? "none" : "block";

      if (!query || !query.valid || !query.search) return;

      const cursor = query.getCursor(view.state.doc) as any;
      const scrollHeight = Math.max(view.scrollDOM.scrollHeight, 1);
      let count = 0;

      while (!cursor.next().done) {
        const pos = cursor.value.from;

        const block = view.lineBlockAt(pos);

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
  },
);

interface Props {
  tabId: string;
  value: string;
  onChange: (value: string, options?: QueryTabUpdateOptions) => void;
  onExecute: (selectedSql?: string) => void;
  onFormat?: () => void;
  readOnly?: boolean;
  theme: ThemeSelection;
  currentDatabase?: string;
  databases?: string[];
  onContextMenu?: (e: MouseEvent) => void;
  onRef?: (handle: SqlEditorHandle) => void;
  onSearchPanelChange?: (open: boolean) => void;
  onNavigationPoint?: (point: EditorNavigationPoint) => void;
  wrapLines?: boolean;
}

export interface SqlEditorHandle {
  focus: () => void;
  openCompletion: () => void;
  openSearch: () => void;
  getSelectedText: () => string;
  getLocation: () => EditorViewLocation | null;
  setLocation: (location: EditorViewLocation, onSettled?: () => void) => void;
  replaceSelection: (text: string) => void;
  formatSelection: () => boolean;
  applyFormattedDocument: (formatted: string) => boolean;
  selectAll: () => void;
  scrollToBottom: () => void;
  retainStates: (tabIds: string[]) => void;
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

function historyOptionsForEditorUpdate(
  update: ViewUpdate,
): QueryTabUpdateOptions | undefined {
  const hasUserEvent = (event: string) =>
    update.transactions.some((transaction) => transaction.isUserEvent(event));

  if (hasUserEvent("input.paste")) {
    return {
      historyMode: "capture-current",
      historyType: "action",
      historyLabel: "Paste",
    };
  }

  if (hasUserEvent("delete.cut")) {
    return {
      historyMode: "capture-current",
      historyType: "action",
      historyLabel: "Cut",
    };
  }

  if (hasUserEvent("input.drop") || hasUserEvent("move.drop")) {
    return {
      historyMode: "capture-current",
      historyType: "action",
      historyLabel: "Drop",
    };
  }

  if (hasUserEvent("undo")) {
    return {
      historyMode: "capture-current",
      historyType: "action",
      historyLabel: "Undo",
    };
  }

  if (hasUserEvent("redo")) {
    return {
      historyMode: "capture-current",
      historyType: "action",
      historyLabel: "Redo",
    };
  }

  if (hasUserEvent("input.format")) {
    return {
      historyMode: "preserve-current",
      historyType: "action",
      historyLabel: "Format SQL",
    };
  }

  return undefined;
}

function formatSelectionInEditor(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (selection.from === selection.to) return false;

  const selectedSql = view.state.doc.sliceString(selection.from, selection.to);
  const from = selection.from;
  const to = selection.to;
  const initialState = view.state;
  void formatSqlWithPrefs(selectedSql)
    .then((formatted) => {
      if (view.state !== initialState) return;
      view.dispatch({
        changes: { from, to, insert: formatted },
        selection: {
          anchor: from,
          head: from + formatted.length,
        },
        scrollIntoView: true,
        userEvent: "input.format",
      });
    })
    .catch(() => undefined);
  return true;
}

function applyFormattedDocumentInEditor(
  view: EditorView,
  formatted: string,
): boolean {
  if (view.state.readOnly) return false;
  const current = view.state.doc.toString();
  if (formatted === current) return true;
  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: formatted,
    },
    userEvent: "input.format",
    annotations: [externalSyncAnnotation.of(true)],
  });
  return true;
}

const EDITOR_LINE_GUTTER_CODE_GAP = 11;
const EDITOR_LINE_GUTTER_NUMBER_GAP = 4;
const EDITOR_CONTENT_LEFT_MARGIN = 0;
const EDITOR_LINE_START_PADDING = 0;
const EDITOR_LINE_END_PADDING = 8;
const EDITOR_MINIMAP_WIDTH = 70;
const MINIMAP_CODE_GAP = 10;
const MINIMAP_MIN_OVERLAY_HEIGHT = 14;
const MINIMAP_MAX_PIXEL_RATIO = 2;
const MINIMAP_SQL_KEYWORDS = new Set(
  [
    "ADD",
    "AND",
    "AS",
    "ASC",
    "BETWEEN",
    "BY",
    "CASE",
    "CAST",
    "COALESCE",
    "COUNT",
    "CREATE",
    "CROSS",
    "CURRENT_DATE",
    "DELETE",
    "DESC",
    "DISTINCT",
    "ELSE",
    "END",
    "EXISTS",
    "FROM",
    "FULL",
    "GROUP",
    "HAVING",
    "IN",
    "INNER",
    "INSERT",
    "INTERVAL",
    "INTO",
    "IS",
    "JOIN",
    "LEFT",
    "LIKE",
    "LIMIT",
    "NOT",
    "NULL",
    "ON",
    "OR",
    "ORDER",
    "OUTER",
    "OVER",
    "PARTITION",
    "RIGHT",
    "SELECT",
    "SET",
    "SUM",
    "THEN",
    "TRUE",
    "UNION",
    "UPDATE",
    "UPPER",
    "WHEN",
    "WHERE",
    "WITH",
  ].map((keyword) => keyword.toUpperCase()),
);

type FillMinimapColors = {
  comment: string;
  keyword: string;
  number: string;
  operator: string;
  property: string;
  search: string;
  string: string;
};

type FillMinimapMetrics = {
  clientHeight: number;
  height: number;
  maxScrollTop: number;
  overlayHeight: number;
  overlayTop: number;
  pixelRatio: number;
  scale: number;
  scrollHeight: number;
  width: number;
};


function buildFontTheme(family: string, size: number) {
  const resolvedFamily = family || "var(--font-mono)";
  return EditorView.theme({
    "&": { fontSize: `${size}px` },
    ".cm-scroller": { fontFamily: resolvedFamily },
    ".cm-content": { fontFamily: resolvedFamily },
    ".cm-gutters": { fontFamily: resolvedFamily },
  });
}

const editorGutterTheme = EditorView.theme({
  "&": {
    "--editor-line-gutter-code-gap": `${EDITOR_LINE_GUTTER_CODE_GAP}px`,
    "--editor-line-gutter-number-gap": `${EDITOR_LINE_GUTTER_NUMBER_GAP}px`,
    "--editor-content-left-margin": `${EDITOR_CONTENT_LEFT_MARGIN}px`,
    "--editor-line-start-padding": `${EDITOR_LINE_START_PADDING}px`,
    "--editor-line-end-padding": `${EDITOR_LINE_END_PADDING}px`,
    "--editor-minimap-width": `${EDITOR_MINIMAP_WIDTH}px`,
    "--editor-minimap-code-gap": `${MINIMAP_CODE_GAP}px`,
    "--editor-active-line-bg":
      "color-mix(in srgb, var(--color-surface-panel) 95%, var(--color-text))",
  },
  ".cm-scroller > .cm-gutters-before": {
    backgroundColor: "var(--color-surface-panel)",
    borderRight: "0",
    boxShadow: "none",
    left: "0",
    overflow: "visible",
    paddingRight: `${EDITOR_LINE_GUTTER_CODE_GAP}px`,
    position: "sticky",
    zIndex: "300",
  },
  ".cm-scroller > .cm-gutters-before::after": {
    backgroundColor: "var(--color-surface-panel)",
    bottom: "0",
    content: '""',
    pointerEvents: "none",
    position: "absolute",
    right: "0",
    top: "0",
    width: `${EDITOR_LINE_GUTTER_CODE_GAP}px`,
    zIndex: "1",
  },
  ".cm-scroller > .cm-gutters-before .cm-gutter": {
    backgroundColor: "var(--color-surface-panel)",
    overflow: "visible",
    position: "relative",
    zIndex: "2",
  },
  ".cm-scroller > .cm-gutters-before .cm-gutterElement": {
    backgroundColor: "var(--color-surface-panel)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "3ch",
    padding: `0 ${EDITOR_LINE_GUTTER_NUMBER_GAP}px 0 4px`,
    textAlign: "right",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--editor-active-line-bg)",
  },
  ".cm-scroller > .cm-gutters-before .cm-activeLineGutter": {
    backgroundColor: "var(--editor-active-line-bg)",
    boxShadow: "none",
    position: "relative",
    zIndex: "3",
  },
  ".cm-scroller > .cm-gutters-before .cm-activeLineGutter::after": {
    backgroundColor: "var(--editor-active-line-bg)",
    bottom: "0",
    content: '""',
    left: "100%",
    pointerEvents: "none",
    position: "absolute",
    top: "0",
    width: `${EDITOR_LINE_GUTTER_CODE_GAP}px`,
  },
  ".cm-scroller > .cm-gutters-before + .cm-content": {
    paddingLeft: `${EDITOR_CONTENT_LEFT_MARGIN}px`,
  },
  ".cm-line": {
    padding: `0 ${EDITOR_LINE_END_PADDING}px 0 ${EDITOR_LINE_START_PADDING}px`,
  },
  "&.cm-minimap-enabled .cm-line": {
    paddingRight: `${EDITOR_MINIMAP_WIDTH + MINIMAP_CODE_GAP + EDITOR_LINE_END_PADDING
      }px`,
  },
});

const editorSafeAreaScrollMargins = EditorView.scrollMargins.of((view) => {
  const beforeGutter = view.dom.querySelector(
    ".cm-gutters-before",
  ) as HTMLElement | null;
  const minimapGutter = view.dom.querySelector(
    ".cm-minimap-gutter",
  ) as HTMLElement | null;

  return {
    left:
      (beforeGutter?.offsetWidth ?? 0) +
      EDITOR_LINE_GUTTER_CODE_GAP +
      EDITOR_CONTENT_LEFT_MARGIN +
      EDITOR_LINE_START_PADDING,
    right: minimapGutter
      ? minimapGutter.offsetWidth + MINIMAP_CODE_GAP + EDITOR_LINE_END_PADDING
      : EDITOR_LINE_END_PADDING,
  };
});

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const fillMinimapPlugin = ViewPlugin.fromClass(
  class {
    private canvas: HTMLCanvasElement;
    private dom: HTMLElement;
    private dragOffsetY: number | null = null;
    private frame: number | null = null;
    private inner: HTMLElement;
    private overlay: HTMLElement;
    private overlayContainer: HTMLElement;
    view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.dom = document.createElement("div");
      this.dom.className = "cm-gutters cm-minimap-container cm-minimap-gutter";
      this.dom.style.width = `${EDITOR_MINIMAP_WIDTH}px`;

      this.inner = document.createElement("div");
      this.inner.className = "cm-minimap-inner";

      this.canvas = document.createElement("canvas");

      this.overlayContainer = document.createElement("div");
      this.overlayContainer.className =
        "cm-minimap-overlay-container cm-minimap-overlay-mouse-over";
      this.overlay = document.createElement("div");
      this.overlay.className = "cm-minimap-overlay";

      this.overlayContainer.appendChild(this.overlay);
      this.inner.appendChild(this.canvas);
      this.inner.appendChild(this.overlayContainer);
      this.dom.appendChild(this.inner);
      view.scrollDOM.insertBefore(this.dom, view.contentDOM.nextSibling);

      this.overlayContainer.addEventListener("mousedown", this.onMouseDown);
      window.addEventListener("mousemove", this.onMouseMove);
      window.addEventListener("mouseup", this.onMouseUp);
      this.schedule(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.geometryChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        !getSearchQuery(update.startState).eq(getSearchQuery(update.state)) ||
        searchPanelOpen(update.startState) !== searchPanelOpen(update.state)
      ) {
        this.schedule(update.view);
      }
    }

    destroy() {
      if (this.frame !== null) {
        cancelAnimationFrame(this.frame);
      }
      this.overlayContainer.removeEventListener("mousedown", this.onMouseDown);
      window.removeEventListener("mousemove", this.onMouseMove);
      window.removeEventListener("mouseup", this.onMouseUp);
      this.dom.remove();
    }

    schedule(view: EditorView) {
      if (this.frame !== null) {
        cancelAnimationFrame(this.frame);
      }

      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.apply(view);
      });
    }

    private apply(view: EditorView) {
      this.view = view;
      const metrics = this.measure();
      const context = this.prepareCanvas(metrics);
      if (!context) return;

      this.drawDocument(context, metrics);
      this.drawSearchMatches(context, metrics);
      this.updateOverlay(metrics);
    }

    private measure(): FillMinimapMetrics {
      const width = Math.max(
        1,
        Math.floor(this.dom.getBoundingClientRect().width || EDITOR_MINIMAP_WIDTH),
      );
      const height = Math.max(
        1,
        Math.floor(
          this.view.scrollDOM.clientHeight ||
          this.view.dom.getBoundingClientRect().height,
        ),
      );
      const clientHeight = Math.max(1, this.view.scrollDOM.clientHeight);
      const scrollHeight = Math.max(clientHeight, this.view.scrollDOM.scrollHeight);
      const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        MINIMAP_MAX_PIXEL_RATIO,
      );
      const rawOverlayHeight = (clientHeight / scrollHeight) * height;
      const overlayHeight =
        maxScrollTop > 0
          ? clamp(rawOverlayHeight, MINIMAP_MIN_OVERLAY_HEIGHT, height)
          : height;
      const maxOverlayTop = Math.max(0, height - overlayHeight);
      const overlayTop =
        maxScrollTop > 0
          ? clamp(
            (this.view.scrollDOM.scrollTop / maxScrollTop) * maxOverlayTop,
            0,
            maxOverlayTop,
          )
          : 0;

      return {
        clientHeight,
        height,
        maxScrollTop,
        overlayHeight,
        overlayTop,
        pixelRatio,
        scale: height / scrollHeight,
        scrollHeight,
        width,
      };
    }

    private prepareCanvas(metrics: FillMinimapMetrics) {
      const pixelWidth = Math.ceil(metrics.width * metrics.pixelRatio);
      const pixelHeight = Math.ceil(metrics.height * metrics.pixelRatio);
      if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
      if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
      this.canvas.style.width = `${metrics.width}px`;
      this.canvas.style.height = `${metrics.height}px`;

      const context = this.canvas.getContext("2d");
      if (!context) return null;

      context.setTransform(
        metrics.pixelRatio,
        0,
        0,
        metrics.pixelRatio,
        0,
        0,
      );
      context.clearRect(0, 0, metrics.width, metrics.height);
      return context;
    }

    private drawDocument(
      context: CanvasRenderingContext2D,
      metrics: FillMinimapMetrics,
    ) {
      const colors = this.getColors();
      const doc = this.view.state.doc;
      const charWidth = clamp(metrics.width / 46, 1.15, 1.75);

      for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
        const line = doc.line(lineNumber);
        const lineBlock = this.view.lineBlockAt(line.from);
        const y = lineBlock.top * metrics.scale;
        const lineHeight = Math.max(0.75, lineBlock.height * metrics.scale);
        if (y > metrics.height) break;
        if (y + lineHeight < 0) continue;

        this.drawSqlLine(
          context,
          line.text,
          2,
          y,
          lineHeight,
          charWidth,
          metrics.width - 4,
          colors,
        );
      }
    }

    private drawSearchMatches(
      context: CanvasRenderingContext2D,
      metrics: FillMinimapMetrics,
    ) {
      // The stored query survives closing the search panel (closeSearchPanel
      // only hides the panel, it does not clear the query), so we must also
      // bail out when the panel is closed to avoid drawing stale matches.
      if (!searchPanelOpen(this.view.state)) return;
      const query = getSearchQuery(this.view.state);
      if (!query || !query.valid || !query.search) return;

      const colors = this.getColors();
      const cursor = query.getCursor(this.view.state.doc) as any;
      let count = 0;

      while (!cursor.next().done) {
        const from = cursor.value.from as number;
        const to = cursor.value.to as number;
        const block = this.view.lineBlockAt(from);
        const y = clamp(
          block.top * metrics.scale,
          0,
          Math.max(0, metrics.height - 2),
        );
        const height = clamp(block.height * metrics.scale, 2, 5);
        const isSelected = this.view.state.selection.ranges.some(
          (range) => range.from === from && range.to === to,
        );

        context.globalAlpha = isSelected ? 0.96 : 0.74;
        context.fillStyle = colors.search;
        context.fillRect(0, y, metrics.width, height);
        context.globalAlpha = isSelected ? 1 : 0.9;
        context.fillRect(
          Math.max(0, metrics.width - 4),
          y,
          4,
          Math.max(height, 3),
        );

        count++;
        if (count > 1000) break;
      }

      context.globalAlpha = 1;
    }

    private drawSqlLine(
      context: CanvasRenderingContext2D,
      text: string,
      x: number,
      y: number,
      lineHeight: number,
      charWidth: number,
      maxWidth: number,
      colors: FillMinimapColors,
    ) {
      if (!text) return;

      const tokens =
        text.match(
          /--.*|'(?:''|[^'])*'|\[[^\]]+\]|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w$#]*\b|\s+|./g,
        ) ?? [];
      const blockHeight = clamp(lineHeight * 0.48, 1, 3.2);
      const blockY = y + Math.max(0, (lineHeight - blockHeight) / 2);
      const gap = clamp(charWidth * 0.72, 0.65, 1.35);

      for (const token of tokens) {
        if (x > maxWidth) break;

        if (/^\s+$/.test(token)) {
          x += token.replace(/\t/g, "    ").length * charWidth * 0.82;
          continue;
        }

        const tokenWidth = this.widthForToken(token, charWidth);
        const visibleWidth = Math.min(
          Math.max(1, tokenWidth),
          Math.max(1, maxWidth - x),
        );
        context.fillStyle = this.colorForToken(token, colors);
        context.globalAlpha = this.alphaForToken(token);
        context.fillRect(x, blockY, visibleWidth, blockHeight);

        x += tokenWidth + gap;
      }

      context.globalAlpha = 1;
    }

    private widthForToken(token: string, charWidth: number) {
      const visualColumns =
        token.length > 14 ? 14 + Math.sqrt(token.length - 14) * 2 : token.length;
      const width = visualColumns * charWidth;

      if (/^[()[\],.;:+*/<>=-]+$/.test(token)) {
        return Math.max(1, width * 0.55);
      }

      return Math.max(2.2, width);
    }

    private alphaForToken(token: string) {
      if (/^[()[\],.;:+*/<>=-]+$/.test(token)) return 0.48;
      if (token.startsWith("--")) return 0.46;
      return 0.78;
    }

    private colorForToken(token: string, colors: FillMinimapColors) {
      const upperToken = token.toUpperCase();
      if (token.startsWith("--")) return colors.comment;
      if (token.startsWith("'")) return colors.string;
      if (/^\d/.test(token)) return colors.number;
      if (MINIMAP_SQL_KEYWORDS.has(upperToken)) return colors.keyword;
      if (/^[()[\],.;:+*/<>=-]+$/.test(token)) return colors.operator;
      return colors.property;
    }

    private getColors(): FillMinimapColors {
      const style = window.getComputedStyle(this.view.dom);
      const read = (name: string, fallback: string) =>
        style.getPropertyValue(name).trim() || fallback;

      return {
        comment: read("--color-text-muted", "rgba(160, 160, 170, 0.8)"),
        keyword: read("--color-cm-keyword", "#ff71ce"),
        number: read("--color-warning", "#ffd166"),
        operator: read("--color-text-muted", "rgba(160, 160, 170, 0.8)"),
        property: read("--color-cm-property", "#ff6f91"),
        search: read("--color-warning", "#ffd166"),
        string: read("--color-cm-type", "#9be564"),
      };
    }

    private updateOverlay(metrics: FillMinimapMetrics) {
      this.overlay.style.height = `${metrics.overlayHeight}px`;
      this.overlay.style.top = `${metrics.overlayTop}px`;

      if (metrics.maxScrollTop <= 0) {
        this.overlayContainer.classList.add("cm-minimap-overlay-off");
      } else {
        this.overlayContainer.classList.remove("cm-minimap-overlay-off");
      }
    }

    private scrollFromClientY(clientY: number, dragOffsetY: number) {
      const metrics = this.measure();
      if (metrics.maxScrollTop <= 0) return;

      const rect = this.inner.getBoundingClientRect();
      const maxMapTop = Math.max(1, metrics.height - metrics.overlayHeight);
      const mapTop = clamp(clientY - rect.top - dragOffsetY, 0, maxMapTop);
      this.view.scrollDOM.scrollTop =
        (mapTop / maxMapTop) * metrics.maxScrollTop;
      this.updateOverlay(this.measure());
    }

    private onMouseDown = (event: MouseEvent) => {
      if (event.button === 2) return;
      event.preventDefault();

      const metrics = this.measure();
      if (metrics.maxScrollTop <= 0) return;

      if (event.target === this.overlay) {
        const overlayRect = this.overlay.getBoundingClientRect();
        this.dragOffsetY = event.clientY - overlayRect.top;
      } else {
        this.dragOffsetY = metrics.overlayHeight / 2;
      }

      this.overlayContainer.classList.add("cm-minimap-overlay-active");
      this.scrollFromClientY(event.clientY, this.dragOffsetY);
    };

    private onMouseMove = (event: MouseEvent) => {
      if (this.dragOffsetY === null) return;
      event.preventDefault();
      this.scrollFromClientY(event.clientY, this.dragOffsetY);
    };

    private onMouseUp = () => {
      this.dragOffsetY = null;
      this.overlayContainer.classList.remove("cm-minimap-overlay-active");
    };
  },
  {
    eventHandlers: {
      scroll() {
        this.schedule(this.view);
      },
    },
  },
);

const editorA11yAttrs = EditorView.contentAttributes.of({
  "aria-label": "SQL editor",
});

function buildMinimapExt() {
  return [
    EditorView.editorAttributes.of({ class: "cm-minimap-enabled" }),
    fillMinimapPlugin,
  ];
}


function buildThemeExtension(theme: ThemeSelection): Extension {
  return theme.mode === "light" ? [] : oneDark;
}

function buildReadOnlyExtension(readOnly: boolean): Extension {
  return readOnly
    ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
    : [linter(sqlLinter, { delay: 500 })];
}

function buildPlaceholderText(
  readOnly: boolean,
  currentDatabase: string | undefined,
): string {
  return readOnly && !currentDatabase
    ? "Select a database to enable the SQL editor."
    : `-- Write your SQL query here…`;
}

export default function SqlEditor(props: Props) {
  let containerRef: HTMLDivElement | undefined;
  let viewRef: EditorView | null = null;
  const wrapCompartment = new Compartment();
  const lineNumbersCompartment = new Compartment();
  const minimapCompartment = new Compartment();
  const autocompleteCompartment = new Compartment();
  const fontThemeCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();
  const placeholderCompartment = new Compartment();
  const indentUnitCompartment = new Compartment();
  let lastSearchString = "";
  let lastCount = -1;
  let lastMatchIndex = 0;
  let lastTabId = "";
  let applyingTabState = false;
  let applyingLocation = false;
  let locationApplyGeneration = 0;
  let tabStateApplyGeneration = 0;
  let lastScrollTop = 0;
  let lastScrollLeft = 0;
  let editorExtensions: Extension[] | undefined;

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
    getLocation() {
      if (!viewRef) return null;
      const selection = viewRef.state.selection.main;
      return {
        anchor: selection.anchor,
        head: selection.head,
        scrollTop: viewRef.scrollDOM.scrollTop,
        scrollLeft: viewRef.scrollDOM.scrollLeft,
      };
    },
    setLocation(location: EditorViewLocation, onSettled?: () => void) {
      applyViewLocation(location, onSettled);
    },
    replaceSelection(text: string) {
      if (!viewRef) return;
      viewRef.focus();
      viewRef.dispatch(viewRef.state.replaceSelection(text));
    },
    formatSelection() {
      if (!viewRef) return false;
      viewRef.focus();
      return formatSelectionInEditor(viewRef);
    },
    applyFormattedDocument(formatted: string) {
      if (!viewRef) return false;
      viewRef.focus();
      return applyFormattedDocumentInEditor(viewRef, formatted);
    },
    selectAll() {
      if (!viewRef) return;
      viewRef.focus();
      viewRef.dispatch({
        selection: { anchor: 0, head: viewRef.state.doc.length },
        scrollIntoView: true,
      });
    },
    scrollToBottom() {
      if (!viewRef) return;
      const end = viewRef.state.doc.length;
      viewRef.dispatch({
        selection: { anchor: end },
        scrollIntoView: true,
      });
    },
    retainStates(tabIds: string[]) {
      const keep = new Set(tabIds);
      for (const id of tabEditorStateCache.keys()) {
        if (!keep.has(id)) tabEditorStateCache.delete(id);
      }
    },
  };

  const combinedCompletionSource = (context: CompletionContext) =>
    sqlCompletionSource(context, {
      currentDatabase: props.currentDatabase,
      databases: props.databases ?? [],
    });

  function buildAutocompleteExtensions(
    style: EditorSuggestionStyle,
  ): Extension[] {
    if (style === "popup") {
      return [buildAutocompletionExt(combinedCompletionSource, "popup")];
    }
    return [
      buildAutocompletionExt(combinedCompletionSource, "ghost"),
      sqlInlineCompletion({ source: combinedCompletionSource }),
    ];
  }

  function applyLiveCompartments(view: EditorView) {
    untrack(() => {
      const prefs = loadEditorPreferences();
      view.dispatch({
        effects: [
          indentUnitCompartment.reconfigure(indentUnit.of(indentSizeUnit())),
          wrapCompartment.reconfigure(
            props.wrapLines ? EditorView.lineWrapping : [],
          ),
          lineNumbersCompartment.reconfigure(
            prefs.lineNumbers ? lineNumbers() : [],
          ),
          minimapCompartment.reconfigure(
            prefs.minimap ? buildMinimapExt() : [],
          ),
          autocompleteCompartment.reconfigure(
            prefs.autocomplete
              ? buildAutocompleteExtensions(prefs.suggestionStyle)
              : [],
          ),
          fontThemeCompartment.reconfigure(
            buildFontTheme(prefs.fontFamily, prefs.fontSize),
          ),
          themeCompartment.reconfigure(buildThemeExtension(props.theme)),
          readOnlyCompartment.reconfigure(
            buildReadOnlyExtension(Boolean(props.readOnly)),
          ),
          placeholderCompartment.reconfigure(
            placeholderExt(
              buildPlaceholderText(
                Boolean(props.readOnly),
                props.currentDatabase,
              ),
            ),
          ),
        ],
      });
    });
  }

  function snapshotTabState(tabId: string) {
    if (!viewRef || !tabId) return;
    snapshotTabEditorState(tabId, viewRef);
  }

  function applyViewLocation(
    location: EditorViewLocation,
    onSettled?: () => void,
  ) {
    if (!viewRef) {
      onSettled?.();
      return;
    }
    const generation = ++locationApplyGeneration;
    tabStateApplyGeneration += 1;
    applyingLocation = true;
    const max = viewRef.state.doc.length;
    viewRef.dispatch({
      selection: {
        anchor: Math.min(Math.max(location.anchor, 0), max),
        head: Math.min(Math.max(location.head, 0), max),
      },
      annotations: [
        Transaction.addToHistory.of(false),
        externalSyncAnnotation.of(true),
      ],
    });
    const tabIdToSnapshot = lastTabId;
    applyCachedScroll(
      viewRef,
      location.scrollTop,
      location.scrollLeft,
      () => {
        if (generation !== locationApplyGeneration) return;
        lastScrollTop = location.scrollTop;
        lastScrollLeft = location.scrollLeft;
        applyingLocation = false;
        applyingTabState = false;
        if (tabIdToSnapshot && tabIdToSnapshot === lastTabId) {
          snapshotTabState(tabIdToSnapshot);
        }
        onSettled?.();
      },
    );
  }

  function applyQueuedRestore(tabId: string) {
    const queued = consumeNavigationRestore(tabId);
    if (!queued) return;
    applyViewLocation(queued.point, queued.onSettled);
  }

  function restoreTabState(
    tabId: string,
    value: string,
    onSettled?: () => void,
  ) {
    if (!viewRef || !editorExtensions) {
      onSettled?.();
      return;
    }
    const skipScroll = hasNavigationRestore(tabId);
    restoreTabEditorState(
      tabId,
      value,
      viewRef,
      editorExtensions,
    );
    applyLiveCompartments(viewRef);
    if (!skipScroll) {
      const cached = tabEditorStateCache.get(tabId);
      if (cached) {
        applyCachedScroll(
          viewRef,
          cached.scrollTop,
          cached.scrollLeft,
          onSettled,
        );
        return;
      }
    }
    onSettled?.();
  }

  onMount(() => {
    if (!containerRef) return;

    const initialTheme = untrack(() => props.theme);
    const initialCurrentDatabase = untrack(() => props.currentDatabase);
    const initialReadOnly = untrack(() => Boolean(props.readOnly));
    const initialWrapLines = untrack(() => Boolean(props.wrapLines));

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
    const formatKeymap = keymap.of([
      {
        key: "Alt-Shift-f",
        run: (view) => {
          if (formatSelectionInEditor(view)) return true;
          if (props.onFormat) {
            props.onFormat();
            return true;
          }
          return false;
        },
      },
    ]);
    const lineMovementKeymap = keymap.of([
      { key: "Alt-ArrowUp", run: moveLineUp },
      { key: "Alt-ArrowDown", run: moveLineDown },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const isExternalSync = update.transactions.some((transaction) =>
          transaction.annotation(externalSyncAnnotation) === true,
        );
        if (!isExternalSync) {
          const next = update.state.doc.toString();
          if (next !== props.value) {
            props.onChange(next, historyOptionsForEditorUpdate(update));
          }
        }
      }

      if (
        update.selectionSet &&
        !applyingTabState &&
        !applyingLocation &&
        lastTabId &&
        !update.transactions.some(
          (transaction) =>
            transaction.annotation(externalSyncAnnotation) === true,
        )
      ) {
        const oldSelection = update.startState.selection.main;
        const newSelection = update.state.selection.main;
        if (
          oldSelection.anchor !== newSelection.anchor ||
          oldSelection.head !== newSelection.head
        ) {
          const oldLine = update.startState.doc.lineAt(
            oldSelection.head,
          ).number;
          const newLine = update.state.doc.lineAt(newSelection.head).number;
          const lineJump = Math.abs(newLine - oldLine);
          const charJump = Math.abs(newSelection.head - oldSelection.head);
          const pointerSelect = update.transactions.some((transaction) =>
            transaction.isUserEvent("select.pointer"),
          );
          const userSelect = update.transactions.some((transaction) =>
            transaction.isUserEvent("select"),
          );
          const shouldRecord =
            !update.docChanged &&
            userSelect &&
            (pointerSelect ||
              lineJump >= EDITOR_NAVIGATION_LINE_JUMP ||
              charJump >= EDITOR_NAVIGATION_CHAR_JUMP);
          if (shouldRecord) {
            props.onNavigationPoint?.({
              tabId: lastTabId,
              anchor: oldSelection.anchor,
              head: oldSelection.head,
              scrollTop: lastScrollTop,
              scrollLeft: lastScrollLeft,
            });
          }
        }
      }

      if (viewRef && searchPanelOpen(update.state) && containerRef) {
        const panel = containerRef.querySelector(".cm-panel.cm-search");
        if (panel) {
          let countSpan = panel.querySelector(
            ".cm-search-match-count",
          ) as HTMLSpanElement | null;
          let countSpanCreated = false;
          if (!countSpan) {
            countSpan = document.createElement("span");
            countSpan.className =
              "cm-search-match-count text-xs opacity-60 pointer-events-none select-none inline-flex items-center whitespace-nowrap justify-center";
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
          const currentSearchString =
            query?.valid && query?.search
              ? `${query.search}|${query.caseSensitive}|${query.regexp}|${query.wholeWord}`
              : "";
          const queryChanged = currentSearchString !== lastSearchString;
          const needsCount =
            queryChanged || update.docChanged || countSpanCreated;
          const needsIndex = needsCount || update.selectionSet;

          if (!currentSearchString) {
            if (needsCount) {
              lastSearchString = currentSearchString;
              lastCount = -1;
              lastMatchIndex = 0;
            }
          } else if (needsCount || needsIndex) {
            if (needsCount) lastSearchString = currentSearchString;
            const sel = update.state.selection.main;
            let walked = 0;
            let index = 0;
            const cursor = query.getCursor(update.state.doc) as {
              next: () => {
                done: boolean;
                value?: { from: number; to: number };
              };
            };
            let item = cursor.next();
            while (!item.done) {
              walked += 1;
              const range = item.value;
              if (
                range &&
                range.from === sel.from &&
                range.to === sel.to
              ) {
                index = walked;
                if (!needsCount) break;
              }
              if (walked >= 1000) break;
              item = cursor.next();
            }
            if (needsCount) lastCount = walked;
            lastMatchIndex = index;
          }

          if (lastCount === -1 || lastCount === 0) {
            countSpan.textContent = "No results";
          } else if (lastMatchIndex > 0) {
            countSpan.textContent =
              lastCount >= 1000
                ? `${lastMatchIndex} of 1000+`
                : `${lastMatchIndex} of ${lastCount}`;
          } else {
            countSpan.textContent =
              lastCount >= 1000 ? "– of 1000+" : `– of ${lastCount}`;
          }

          const hasResults = lastCount > 0;
          const replaceBtn = panel.querySelector(
            'button[name="replace"]',
          ) as HTMLButtonElement | null;
          const replaceAllBtn = panel.querySelector(
            'button[name="replaceAll"]',
          ) as HTMLButtonElement | null;
          const nextBtn = panel.querySelector(
            'button[name="next"]',
          ) as HTMLButtonElement | null;
          const prevBtn = panel.querySelector(
            'button[name="prev"]',
          ) as HTMLButtonElement | null;

          if (replaceBtn) replaceBtn.disabled = !hasResults;
          if (replaceAllBtn) replaceAllBtn.disabled = !hasResults;
          if (nextBtn) nextBtn.disabled = !hasResults;
          if (prevBtn) prevBtn.disabled = !hasResults;
        }
      }
    });

    const initialPrefs = loadEditorPreferences();

    const pasteHandler = EditorView.domEventHandlers({
      paste(event, view) {
        if (!loadEditorPreferences().formatOnPaste) return false;
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;
        const initialState = view.state;
        event.preventDefault();
        void formatSqlWithPrefs(text)
          .then((formatted) => {
            if (view.state !== initialState) return;
            view.dispatch({
              ...view.state.replaceSelection(formatted),
              annotations: Transaction.userEvent.of("input.paste"),
            });
          })
          .catch(() => undefined);
        return true;
      },
    });

    editorExtensions = [
        searchScrollbarPlugin,
        lineNumbersCompartment.of(initialPrefs.lineNumbers ? lineNumbers() : []),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        foldGutter({
          markerDOM: (open) => createFoldMarker(open),
        }),
        bracketMatching(),
        closeBrackets(),
        autocompleteCompartment.of(
          initialPrefs.autocomplete
            ? buildAutocompleteExtensions(initialPrefs.suggestionStyle)
            : [],
        ),
        sql({ dialect: MSSQL, upperCaseKeywords: true }),
        search(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        themeCompartment.of(buildThemeExtension(initialTheme)),
        editorGutterTheme,
        editorA11yAttrs,
        editorSafeAreaScrollMargins,
        fontThemeCompartment.of(
          buildFontTheme(initialPrefs.fontFamily, initialPrefs.fontSize),
        ),
        executeKeymap,
        formatKeymap,
        lineMovementKeymap,
        keymap.of([
          {
            key: "Tab",
            run: (view) => {
              if (acceptCompletion(view)) return true;
              if (acceptInlineSuggestion(view)) return true;
              const hasSelection = view.state.selection.ranges.some(
                (range) => !range.empty,
              );
              return hasSelection
                ? indentMore(view)
                : insertIndentUnit(view);
            },
            shift: indentLess,
          },
          {
            key: "ArrowDown",
            run: (view) => {
              if (completionStatus(view.state) === "active") return false;
              const pos = view.state.selection.main.head;
              const before =
                pos > 0 ? view.state.doc.sliceString(pos - 1, pos) : "";
              if (
                !hasInlineSuggestion(view) &&
                !/[\w@$#[\]".]/.test(before)
              ) {
                return false;
              }
              clearInlineSuggestion(view);
              startCompletion(view);
              return true;
            },
          },
          {
            key: "Escape",
            run: (view) => {
              clearInlineSuggestion(view);
              return false;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...closeBracketsKeymap,
          ...foldKeymap,
          ...searchKeymap,
        ]),
        updateListener,
        pasteHandler,
        placeholderCompartment.of(
          placeholderExt(
            buildPlaceholderText(
              initialReadOnly,
              initialCurrentDatabase,
            ),
          ),
        ),
        wrapCompartment.of(initialWrapLines ? EditorView.lineWrapping : []),
        minimapCompartment.of(
          initialPrefs.minimap ? buildMinimapExt() : [],
        ),
        readOnlyCompartment.of(buildReadOnlyExtension(initialReadOnly)),
        indentUnitCompartment.of(indentUnit.of(indentSizeUnit())),
    ];

    const state = EditorState.create({
      doc: untrack(() => props.value),
      extensions: editorExtensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef,
    });

    viewRef = view;
    lastTabId = untrack(() => props.tabId);
    lastScrollTop = view.scrollDOM.scrollTop;
    lastScrollLeft = view.scrollDOM.scrollLeft;
    const onEditorScroll = () => {
      lastScrollTop = view.scrollDOM.scrollTop;
      lastScrollLeft = view.scrollDOM.scrollLeft;
    };
    view.scrollDOM.addEventListener("scroll", onEditorScroll, { passive: true });
    const mountGeneration = ++tabStateApplyGeneration;
    applyingTabState = true;
    restoreTabState(lastTabId, untrack(() => props.value), () => {
      if (mountGeneration !== tabStateApplyGeneration) return;
      applyingTabState = false;
    });
    applyQueuedRestore(lastTabId);
    props.onRef?.(handle);

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

      const searchInput = panel.querySelector(
        'input[name="search"]',
      ) as HTMLInputElement;
      if (searchInput && searchInput.parentElement) {
        const wasFocused = document.activeElement === searchInput;

        const wrapper = document.createElement("div");
        wrapper.className = "cm-search-input-wrapper";
        searchInput.parentElement.insertBefore(wrapper, searchInput);
        wrapper.appendChild(searchInput);

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
            if (
              searchHistory.length > 0 &&
              historyIndex < searchHistory.length - 1
            ) {
              if (
                historyIndex === -1 &&
                searchInput.value &&
                searchHistory[0] !== searchInput.value
              ) {
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
        labels.forEach((label) => {
          const input = label.querySelector(
            'input[type="checkbox"]',
          ) as HTMLInputElement;
          if (!input) return;

          Array.from(label.childNodes).forEach((node) => {
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
          if (
            node.classList.contains("cm-panel") &&
            node.classList.contains("cm-search")
          ) {
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
            (node.classList.contains("cm-panel") &&
              node.classList.contains("cm-search")) ||
            node.querySelector?.(".cm-panel.cm-search")
          ) {
            props.onSearchPanelChange?.(false);
          }
        });
      }
    });
    panelObserver.observe(containerRef, { childList: true, subtree: true });

    onCleanup(() => {
      if (lastTabId && viewRef) snapshotTabState(lastTabId);
      view.scrollDOM.removeEventListener("scroll", onEditorScroll);
      panelObserver.disconnect();
      view.destroy();
      viewRef = null;
      lastTabId = "";
      editorExtensions = undefined;
    });
  });

  createEffect(() => {
    const tabId = props.tabId;
    const value = props.value;
    if (!viewRef) return;

    if (tabId !== lastTabId) {
      if (lastTabId) snapshotTabState(lastTabId);
      const generation = ++tabStateApplyGeneration;
      applyingTabState = true;
      restoreTabState(tabId, value, () => {
        if (generation !== tabStateApplyGeneration) return;
        applyingTabState = false;
      });
      lastTabId = tabId;
      applyQueuedRestore(tabId);
      return;
    }

    if (!sqlTextEquals(viewRef.state.doc.toString(), value)) {
      viewRef.dispatch({
        changes: {
          from: 0,
          to: viewRef.state.doc.length,
          insert: value,
        },
        annotations: [
          Transaction.addToHistory.of(false),
          externalSyncAnnotation.of(true),
        ],
      });
    }
  });

  createEffect(() => {
    if (viewRef) {
      viewRef.dispatch({
        effects: wrapCompartment.reconfigure(
          props.wrapLines ? EditorView.lineWrapping : [],
        ),
      });
    }
  });

  createEffect(() => {
    const theme = props.theme;
    if (!viewRef) return;
    viewRef.dispatch({
      effects: themeCompartment.reconfigure(buildThemeExtension(theme)),
    });
  });

  createEffect(() => {
    const readOnly = Boolean(props.readOnly);
    const currentDatabase = props.currentDatabase;
    if (!viewRef) return;
    viewRef.dispatch({
      effects: [
        readOnlyCompartment.reconfigure(buildReadOnlyExtension(readOnly)),
        placeholderCompartment.reconfigure(
          placeholderExt(
            buildPlaceholderText(
              readOnly,
              currentDatabase,
            ),
          ),
        ),
      ],
    });
  });

  const editorPrefs = createMemo(() => loadEditorPreferences());
  const prefLineNumbers = createMemo(() => editorPrefs().lineNumbers);
  const prefMinimap = createMemo(() => editorPrefs().minimap);
  const prefAutocomplete = createMemo(() => editorPrefs().autocomplete);
  const prefSuggestionStyle = createMemo(
    () => editorPrefs().suggestionStyle,
  );
  const prefFontFamily = createMemo(() => editorPrefs().fontFamily);
  const prefFontSize = createMemo(() => editorPrefs().fontSize);

  createEffect(() => {
    const enabled = prefLineNumbers();
    if (!viewRef) return;
    viewRef.dispatch({
      effects: lineNumbersCompartment.reconfigure(enabled ? lineNumbers() : []),
    });
  });

  createEffect(() => {
    const enabled = prefMinimap();
    if (!viewRef) return;
    viewRef.dispatch({
      effects: minimapCompartment.reconfigure(
        enabled ? buildMinimapExt() : [],
      ),
    });
  });

  createEffect(() => {
    const enabled = prefAutocomplete();
    const style = prefSuggestionStyle();
    if (!viewRef) return;
    viewRef.dispatch({
      effects: autocompleteCompartment.reconfigure(
        enabled ? buildAutocompleteExtensions(style) : [],
      ),
    });
  });

  createEffect(() => {
    const family = prefFontFamily();
    const size = prefFontSize();
    if (!viewRef) return;
    viewRef.dispatch({
      effects: fontThemeCompartment.reconfigure(buildFontTheme(family, size)),
    });
  });

  createEffect(() => {
    const currentDatabase = props.currentDatabase;
    if (!viewRef) return;
    // The installed ghost came from the previous database's catalog and may
    // not exist under the new one.
    clearInlineSuggestion(viewRef);
    if (currentDatabase) {
      preloadSchemaCatalog(currentDatabase);
    }
  });

  return (
    <div
      ref={containerRef}
      onContextMenu={props.onContextMenu}
      class="h-full min-h-0 w-full relative"
    />
  );
}
