import type { ReactNode } from "react";

interface Props {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

export default function EmptyState({ icon, title, description, children }: Props) {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full p-8 text-center animate-in fade-in duration-[var(--duration-slow)]">
      <div className="flex flex-col items-center max-w-[280px]">
        {icon === undefined ? (
          <img
            src="/favicon.png"
            alt="App Icon"
            className="w-16 h-16 object-contain mb-5 opacity-30 grayscale-[1] select-none pointer-events-none"
          />
        ) : icon}
        <div className="space-y-2">
          {title && <h3 className="text-l font-semibold text-text/90 tracking-tight">{title}</h3>}
          {description && <div className="text-m text-text-muted font-medium leading-relaxed">{description}</div>}
        </div>
        {children && <div className="mt-6 w-full flex justify-center">{children}</div>}
      </div>
    </div>
  );
}
