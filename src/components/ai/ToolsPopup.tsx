import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
  AI_TOOLS,
  loadEnabledTools,
  saveEnabledTools,
  WEB_SEARCH_TOOL_ID,
} from "../../lib/ai-tools";
import { BraveSearchService, BRAVE_KEY_CHANGED_EVENT } from "../../lib/ai";
import ChatOptionPopup from "./ChatOptionPopup";

interface Props {
  anchorRef: HTMLButtonElement | undefined;
  onClose: () => void;
}

export default function ToolsPopup(props: Props) {
  const [enabled, setEnabled] = createSignal(loadEnabledTools());
  const [braveKeyConfigured, setBraveKeyConfigured] = createSignal(false);

  const refreshBraveStatus = () => {
    BraveSearchService.hasKey().then(setBraveKeyConfigured);
  };

  onMount(() => {
    refreshBraveStatus();
    window.addEventListener(BRAVE_KEY_CHANGED_EVENT, refreshBraveStatus);
    onCleanup(() =>
      window.removeEventListener(BRAVE_KEY_CHANGED_EVENT, refreshBraveStatus),
    );
  });

  const isDisabled = (id: string) =>
    id === WEB_SEARCH_TOOL_ID && !braveKeyConfigured();

  const toggle = (id: string) => {
    if (isDisabled(id)) return;
    const next = new Set(enabled());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setEnabled(next);
    saveEnabledTools(next);
  };

  const selectableTools = () =>
    AI_TOOLS.filter((t) => !isDisabled(t.id));
  const allOn = () => selectableTools().every((t) => enabled().has(t.id));
  const items = createMemo(() =>
    AI_TOOLS.map((tool) => {
      const disabled = isDisabled(tool.id);
      return {
        id: tool.id,
        title: tool.label,
        subtitle: tool.description,
        icon: tool.icon,
        selected: !disabled && enabled().has(tool.id),
        disabled,
        disabledNote: disabled ? "(API key required)" : undefined,
        disabledTitle: disabled
          ? "Set a Brave Search API key in Settings → AI to enable web search"
          : undefined,
        category: tool.category,
      };
    }),
  );
  const toggleAll = () => {
    const next = new Set<string>();
    if (!allOn()) {
      for (const t of selectableTools()) next.add(t.id);
    }
    setEnabled(next);
    saveEnabledTools(next);
  };

  return (
    <ChatOptionPopup
      anchorRef={props.anchorRef}
      title="AI Tools"
      items={items()}
      headerActionLabel={allOn() ? "Disable all" : "Enable all"}
      onHeaderAction={toggleAll}
      onSelect={toggle}
      onClose={props.onClose}
    />
  );
}
