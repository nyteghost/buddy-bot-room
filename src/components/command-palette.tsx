import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";

export type PaletteAction = { id: string; group: string; label: string; hint?: string; keywords?: string; run: () => void };

/** Ctrl+K: type to find any window, theme, mode, command or backup action. */
export function CommandPalette({ open, onOpenChange, actions }: { open: boolean; onOpenChange: (open: boolean) => void; actions: PaletteAction[] }) {
  const groups = [...new Set(actions.map((a) => a.group))];
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command…  (windows, themes, modes, backup)" />
      <CommandList>
        <CommandEmpty>Nothing matches. Try “theme”, “notes” or “backup”.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group} heading={group}>
            {actions.filter((a) => a.group === group).map((a) => (
              <CommandItem key={a.id} value={`${a.group} ${a.label} ${a.keywords ?? ""}`} onSelect={() => { onOpenChange(false); a.run(); }}>
                {a.label}
                {a.hint && <CommandShortcut>{a.hint}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
