export function IconDatabase({ className }: { className?: string }) {
  return <i className={`fa-solid fa-database fa-fw text-[12px] ${className || ""}`} />;
}

export function IconTable({ className }: { className?: string }) {
  return <i className={`fa-solid fa-table fa-fw text-[12px] ${className || ""}`} />;
}

export function IconView({ className }: { className?: string }) {
  return <i className={`fa-solid fa-table-list fa-fw text-[12px] ${className || ""}`} />;
}

export function IconColumn({ className }: { className?: string }) {
  return <i className={`fa-solid fa-columns fa-fw text-[11px] ${className || ""}`} />;
}

export function IconPlay({ className }: { className?: string }) {
  return <i className={`fa-solid fa-play fa-fw ${className || ""}`} />;
}

export function IconChevronRight({ className }: { className?: string }) {
  return <i className={`fa-solid fa-chevron-right fa-fw text-[10px] ${className || ""}`} />;
}

export function IconCopy({ className }: { className?: string }) {
  return <i className={`fa-solid fa-copy fa-fw ${className || ""}`} />;
}
