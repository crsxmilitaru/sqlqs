import { createMemo } from "solid-js";
import type { GeminiModelOption } from "../../lib/ai";
import ChatOptionPopup from "./ChatOptionPopup";

interface Props {
  anchorRef: HTMLButtonElement | undefined;
  models: GeminiModelOption[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function getModelIcon(modelId: string): string {
  if (/flash-lite/.test(modelId)) return "fa-feather";
  if (/flash/.test(modelId)) return "fa-bolt";
  if (/pro/.test(modelId)) return "fa-brain";
  return "fa-wand-magic-sparkles";
}

export default function ModelPickerPopup(props: Props) {
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
      onClose={props.onClose}
    />
  );
}
