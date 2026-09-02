interface IconProps {
  name: string;
  class?: string;
  family?: "solid" | "regular" | "brands";
  fixedWidth?: boolean;
  label?: string;
}

export function Icon(props: IconProps) {
  const hasFullClass = () => /\bfa-(solid|regular|brands)\b/.test(props.name);
  const styleClass = () =>
    hasFullClass()
      ? ""
      : props.family === "regular"
        ? "fa-regular"
        : props.family === "brands"
          ? "fa-brands"
          : "fa-solid";
  const nameClass = () =>
    props.name.startsWith("fa-") ? props.name : `fa-${props.name}`;
  return (
    <i
      class={`${styleClass()} ${nameClass()} ${props.fixedWidth === false ? "" : "fa-fw"} ${props.class || ""}`}
      aria-hidden={props.label ? undefined : "true"}
      aria-label={props.label}
    />
  );
}

export function IconDatabase(props: { class?: string }) {
  return (
    <Icon name="database" class={`text-xs ${props.class || ""}`} />
  );
}

export function IconTable(props: { class?: string }) {
  return <Icon name="table" class={`text-xs ${props.class || ""}`} />;
}

export function IconView(props: { class?: string }) {
  return (
    <Icon name="table-list" class={`text-xs ${props.class || ""}`} />
  );
}

export function IconColumn(props: { class?: string }) {
  return (
    <Icon name="columns" class={`text-2xs ${props.class || ""}`} />
  );
}

export function IconProcedure(props: { class?: string }) {
  return <Icon name="gears" class={`text-xs ${props.class || ""}`} />;
}

export function IconFunction(props: { class?: string }) {
  return (
    <Icon name="square-root-variable" class={`text-xs ${props.class || ""}`} />
  );
}

export function IconTrigger(props: { class?: string }) {
  return <Icon name="bolt" class={`text-xs ${props.class || ""}`} />;
}

export function IconType(props: { class?: string }) {
  return <Icon name="shapes" class={`text-xs ${props.class || ""}`} />;
}

export function IconPlay(props: { class?: string }) {
  return <Icon name="play" class={props.class} />;
}

export function IconStop(props: { class?: string }) {
  return <Icon name="stop" class={props.class} />;
}

export function IconChevronRight(props: { class?: string }) {
  return (
    <Icon name="chevron-right" class={`text-3xs ${props.class || ""}`} />
  );
}

export function IconCopy(props: { class?: string }) {
  return <Icon name="copy" class={props.class} />;
}

export function IconFormat(props: { class?: string }) {
  return <Icon name="align-left" class={props.class} />;
}

export function IconSave(props: { class?: string }) {
  return <Icon name="bookmark" class={props.class} />;
}

export function IconFloppy(props: { class?: string }) {
  return <Icon name="floppy-disk" class={props.class} />;
}

export function IconSearch(props: { class?: string }) {
  return (
    <Icon name="magnifying-glass" class={props.class} />
  );
}

export function IconWrapText(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="2 0 20 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <path d="m16 16-3 3 3 3" />
      <path d="M3 12h14.5a1 1 0 0 1 0 7H13" />
      <path d="M3 19h6" />
      <path d="M3 5h18" />
    </svg>
  );
}

export function IconHistory(props: { class?: string }) {
  return <Icon name="clock-rotate-left" class={props.class} />;
}

export function IconUndo(props: { class?: string }) {
  return <Icon name="rotate-left" class={props.class} />;
}

export function IconRedo(props: { class?: string }) {
  return <Icon name="rotate-right" class={props.class} />;
}

export function IconComment(props: { class?: string }) {
  return <Icon name="comment-dots" class={props.class} />;
}

export function IconCaseUpper(props: { class?: string }) {
  return <Icon name="arrow-up-a-z" class={props.class} />;
}

export function IconCaseLower(props: { class?: string }) {
  return <Icon name="arrow-down-a-z" class={props.class} />;
}

export function Spinner(props: { class?: string; size?: number }) {
  const size = () => props.size ?? 48;
  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={`animate-spin ${props.class || ""}`}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="2.5"
        opacity="0.2"
      />
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-dasharray="18 45"
        stroke-linecap="round"
      />
    </svg>
  );
}

export function IconWinMinimize(props: { class?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" class={props.class}>
      <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="1" />
    </svg>
  );
}

export function IconWinMaximize(props: { class?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" class={props.class}>
      <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1" fill="none" />
    </svg>
  );
}

export function IconWinRestore(props: { class?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" class={props.class}>
      <path d="M2.5 0.5h5a1.5 1.5 0 0 1 1.5 1.5v5" stroke="currentColor" stroke-width="1" fill="none" />
      <rect x="0.5" y="2.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1" fill="none" />
    </svg>
  );
}

export function IconWinClose(props: { class?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" class={props.class}>
      <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" stroke-width="1" />
    </svg>
  );
}

export function IconMacClose(props: { class?: string }) {
  return (
    <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true" class={props.class}>
      <path d="M.5 0L0 .5 2.5 3 0 5.5l.5.5L3 3.5 5.5 6l.5-.5L3.5 3 6 .5 5.5 0 3 2.5.5 0z" fill="currentColor" />
    </svg>
  );
}

export function IconMacMinimize(props: { class?: string }) {
  return (
    <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true" class={props.class}>
      <path d="M0 2.5h6v1H0z" fill="currentColor" />
    </svg>
  );
}

export function IconMacMaximize(props: { class?: string }) {
  return (
    <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true" class={props.class}>
      <path d="M2.5 0h1v6h-1zM0 2.5h6v1H0z" fill="currentColor" />
    </svg>
  );
}
