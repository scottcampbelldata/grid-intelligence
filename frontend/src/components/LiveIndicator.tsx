interface Props {
  live: boolean;
}

export function LiveIndicator({ live }: Props) {
  return (
    <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-muted">
      <span className="relative flex h-1.5 w-1.5">
        {live && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-50" />
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
            live ? "bg-accent" : "bg-muted"
          }`}
        />
      </span>
      {live ? "Live" : "Offline"}
    </span>
  );
}
