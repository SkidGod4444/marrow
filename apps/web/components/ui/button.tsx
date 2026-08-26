import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-[13px] font-medium whitespace-nowrap transition-[transform,box-shadow,background-color,border-color,color] duration-100 outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-[2px] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-[var(--key-primary-border)] bg-[linear-gradient(to_bottom,var(--key-primary-top),var(--key-primary-bottom))] text-[var(--key-primary-text)] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.9),inset_0_-1px_0_0_rgb(0_0_0/0.12),0_2px_0_0_var(--key-primary-edge),0_3px_8px_-2px_rgb(0_0_0/0.6)] hover:brightness-[1.04] active:not-aria-[haspopup]:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.6),inset_0_2px_3px_0_rgb(0_0_0/0.18)]",
        outline:
          "border-[var(--key-border)] bg-[linear-gradient(to_bottom,var(--key-top),var(--key-bottom))] text-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.14),inset_0_-1px_0_0_rgb(0_0_0/0.25),0_2px_0_0_var(--key-edge),0_3px_6px_-2px_rgb(0_0_0/0.5)] hover:brightness-110 hover:text-foreground aria-expanded:brightness-110 active:not-aria-[haspopup]:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06),inset_0_2px_3px_0_rgb(0_0_0/0.35)]",
        secondary:
          "border-[var(--key-border)] bg-[linear-gradient(to_bottom,var(--key-top),var(--key-bottom))] text-secondary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.14),inset_0_-1px_0_0_rgb(0_0_0/0.25),0_2px_0_0_var(--key-edge),0_3px_6px_-2px_rgb(0_0_0/0.5)] hover:brightness-110 aria-expanded:brightness-110 active:not-aria-[haspopup]:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06),inset_0_2px_3px_0_rgb(0_0_0/0.35)]",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-7 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-7",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
