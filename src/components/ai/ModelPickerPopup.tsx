import { createMemo, For } from "solid-js";
import type { GeminiModelOption, GeminiThinkingLevel } from "../../lib/ai";
import ChatOptionPopup from "./ChatOptionPopup";

interface Props {
  anchorRef: HTMLButtonElement | undefined;
  models: GeminiModelOption[];
  selected: string;
  thinkingLevel: GeminiThinkingLevel;
  onSelect: (id: string) => void;
  onThinkingLevelChange: (level: GeminiThinkingLevel) => void;
  onClose: () => void;
}

const THINKING_LEVELS: {
  id: GeminiThinkingLevel;
  label: string;
  description: string;
}[] = [
  { id: "minimal", label: "Minimal", description: "Lowest latency" },
  { id: "low", label: "Low", description: "Simple chat" },
  { id: "medium", label: "Medium", description: "Balanced" },
  { id: "high", label: "High", description: "Deepest" },
];

export function getModelIcon(modelId: string): string {
  if (/flash-lite/.test(modelId)) return "fa-feather";
  if (/flash/.test(modelId)) return "fa-bolt";
  if (/pro/.test(modelId)) return "fa-brain";
  return "fa-wand-magic-sparkles";
}

export default function ModelPickerPopup(props: Props) {
  const selectedCanUseMinimalThinking = createMemo(
    () =>
      /^gemini-(?!2\.5-)\d/.test(props.selected) &&
      /(^|-)flash(?:-lite)?($|-)/.test(props.selected),
  );
  const effectiveThinkingLevel = createMemo<GeminiThinkingLevel>(() =>
    props.thinkingLevel === "minimal" && !selectedCanUseMinimalThinking()
      ? "low"
      : props.thinkingLevel,
  );

  const items = createMemo(() =>
    props.models.map((model) => ({
      id: model.id,
      title: model.label,
      subtitle: model.id,
      icon: `fa-solid ${getModelIcon(model.id)}`,
      selected: model.id === props.selected,
    })),
  );

  return (
    <ChatOptionPopup
      anchorRef={props.anchorRef}
      title="AI Model"
      items={items()}
      onSelect={(id) => {
        props.onSelect(id);
        props.onClose();
      }}
      footer={
        <div class="flex flex-col gap-2 px-0.5 py-1">
          <div class="flex items-center gap-2 px-2">
            <i class="fa-solid fa-brain text-s w-4 text-center text-accent flex-shrink-0" />
            <div class="text-s font-medium text-text">Thinking level</div>
          </div>
          <div class="grid grid-cols-4 gap-1">
            <For each={THINKING_LEVELS}>
              {(level) => {
                const disabled = () =>
                  level.id === "minimal" && !selectedCanUseMinimalThinking();
                const selected = () => effectiveThinkingLevel() === level.id;
                return (
                  <button
                    type="button"
                    disabled={disabled()}
                    title={
                      disabled()
                        ? "Minimal thinking is not supported by this model"
                        : level.description
                    }
                    onClick={() => props.onThinkingLevelChange(level.id)}
                    class={`min-w-0 rounded-md border px-1.5 py-1.5 text-center transition-colors ${
                      selected()
                        ? "border-accent bg-accent text-accent-text"
                        : disabled()
                          ? "border-border/50 text-text-muted/50 cursor-default"
                          : "border-border bg-surface text-text-muted hover:bg-surface-hover cursor-pointer"
                    }`}
                  >
                    <div class="truncate text-[11px] font-semibold">
                      {level.label}
                    </div>
                    <div
                      class={`mt-0.5 truncate text-[9px] ${
                        selected()
                          ? "text-accent-text/80"
                          : "text-text-muted/70"
                      }`}
                    >
                      {level.description}
                    </div>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      }
      onClose={props.onClose}
    />
  );
}
