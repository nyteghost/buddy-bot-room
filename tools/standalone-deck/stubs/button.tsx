// A plain button with the same look as the app's, for the one-file build.
import * as React from "react";
const variants: Record<string, string> = {
  default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
  outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
};
const sizes: Record<string, string> = { default: "h-9 px-4 py-2", sm: "h-8 rounded-md px-3 text-xs", lg: "h-10 rounded-md px-8", icon: "h-9 w-9" };
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string };
export const Button = React.forwardRef<HTMLButtonElement, Props>(({ className = "", variant = "default", size = "default", ...rest }, ref) => (
  <button ref={ref} className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 ${variants[variant] ?? variants.default} ${sizes[size] ?? sizes.default} ${className}`} {...rest} />
));
Button.displayName = "Button";
