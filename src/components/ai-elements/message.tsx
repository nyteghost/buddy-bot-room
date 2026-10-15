 with new content.

Let's write.

- Remove all TypeScript‑only syntax (type imports, generics, interfaces) which Babel can’t parse in the preview.
- Replace the Lucide‑React import with the global `LucideReact` icons.
- Convert the component definitions to plain JavaScript while preserving their runtime behavior.

<file path="src/components/ai-elements/message.tsx">
"use client";

import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";

/* Lucide icons are provided via the global `LucideReact` */
const { ChevronLeft, ChevronRight } = LucideReact;

/* -------------------------------------------------------------------------- */
/* Message container                                                          */
/* -------------------------------------------------------------------------- */
export const Message = ({ className, from, ...props }) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className,
    )}
    {...props}
  />
);

/* -------------------------------------------------------------------------- */
/* Message content                                                            */
/* -------------------------------------------------------------------------- */
export const MessageContent = ({ children, className, ...props }) => (
  <div
    className={cn(
      "is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

/* -------------------------------------------------------------------------- */
/* Message actions                                                            */
/* -------------------------------------------------------------------------- */
export const MessageActions = ({ className, children, ...props }) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  return tooltip ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    button
  );
};

/* -------------------------------------------------------------------------- */
/* Branch handling                                                            */
/* -------------------------------------------------------------------------- */
const MessageBranchContext = React.createContext(null);

const useMessageBranch = () => {
  const context = React.useContext(MessageBranchContext);
  if (!context) {
    throw new Error("MessageBranch components must be used within MessageBranch");
  }
  return context;
};

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}) => {
  const [currentBranch, setCurrentBranch] = React.useState(defaultBranch);
  const [branches, setBranches] = React.useState([]);

  const handleBranchChange = React.useCallback(
    (newBranch) => {
      setCurrentBranch(newBranch);
      if (onBranchChange) onBranchChange(newBranch);
    },
    [onBranchChange],
  );

  const goToPrevious = React.useCallback(() => {
    const newBranch = currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const goToNext = React.useCallback(() => {
    const newBranch = currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const contextValue = React.useMemo(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious],
  );

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div className={cn("grid w-full gap-2 [&>div]:pb-0", className)} {...props} />
    </MessageBranchContext.Provider>
  );
};

export const MessageBranchContent = ({ children, ...props }) => {
  const { currentBranch, setBranches, branches } = useMessageBranch();

  const childrenArray = React.useMemo(
    () => (Array.isArray(children) ? children : [children]),
    [children],
  );

  React.useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray);
    }
  }, [childrenArray, branches, setBranches]);

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        "grid gap-2 overflow-hidden [&>div]:pb-0",
        index === currentBranch ? "block" : "hidden",
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ));
};

export const MessageBranchSelector = ({ className, ...props }) => {
  const { totalBranches } = useMessageBranch();

  if (totalBranches <= 1) return null;

  return (
    <ButtonGroup
      className={cn(
        "[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md",
        className,
      )}
      orientation="horizontal"
      {...props}
    />
  );
};

export const MessageBranchPrevious = ({ children, ...props }) => {
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeft size={14} />}
    </Button>
  );
};

export const MessageBranchNext = ({ children, ...props }) => {
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRight size={14} />}
    </Button>
  );
};

export const MessageBranchPage = ({ className, ...props }) => {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <ButtonGroupText
      className={cn("border-none bg-transparent text-muted-foreground shadow-none", className)}
      {...props}
    >
      {currentBranch + 1} of {totalBranches}
    </ButtonGroupText>
  );
};

/* -------------------------------------------------------------------------- */
/* Message response (Streamdown)                                              */
/* -------------------------------------------------------------------------- */
const streamdownPlugins = { cjk, code, math, mermaid };

export const MessageResponse = React.memo(
  ({ className, ...props }) => (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children && nextProps.isAnimating === prevProps.isAnimating,
);

MessageResponse.displayName = "MessageResponse";

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                    */
/* -------------------------------------------------------------------------- */
export const MessageToolbar = ({ className, children, ...props }) => (
  <div className={cn("mt-4 flex w-full items-center justify-between gap-4", className)} {...props}>
    {children}
  </div>
);
