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
  return <Icon name="paragraph" class={props.class} />;
}

export function IconHistory(props: { class?: string }) {
  return <Icon name="clock-rotate-left" class={props.class} />;
}
