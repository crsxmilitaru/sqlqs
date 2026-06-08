import Tooltip from "./Tooltip";

interface Props {
  onClick: () => void;
  disabled?: boolean;
}

export default function DialogCloseButton(props: Props) {
  return (
    <Tooltip content="Close" placement="bottom">
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled}
        aria-label="Close dialog"
        class="dialog-close-btn"
      >
        &times;
      </button>
    </Tooltip>
  );
}
