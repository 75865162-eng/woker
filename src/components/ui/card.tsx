import { cn } from "@/lib/utils";

export { Surface as Card, SurfaceHeader as CardHeader, SurfaceBody as CardContent } from "./surface";

export function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("text-sm font-bold text-foreground", className)}>{children}</h2>;
}
