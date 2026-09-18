import { type VariantProps, cva } from 'class-variance-authority';
import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../cn.js';
import { Spinner } from './spinner.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
    'disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70',
        outline:
          'border border-input bg-transparent hover:bg-accent hover:text-accent-foreground active:bg-accent/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground active:bg-accent/80',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-9 px-4',
        lg: 'h-10 px-6',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a spinner and disables the button. The button's own width won't
   *  jump: pair with a fixed-width label or `loadingText` of similar length. */
  isLoading?: boolean;
  /** Label shown in place of children while `isLoading` — omit to keep the
   *  original label visible next to the spinner. */
  loadingText?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      type = 'button',
      isLoading,
      loadingText,
      disabled,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {isLoading ? <Spinner /> : null}
      {isLoading && loadingText ? loadingText : children}
    </button>
  ),
);
Button.displayName = 'Button';

/** A square icon-only button — same interaction states as `Button`, sized
 *  for a single icon. Always pass an `aria-label` (there's no visible text). */
export interface IconButtonProps extends Omit<ButtonProps, 'size' | 'loadingText'> {
  'aria-label': string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', className, ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size="icon"
      className={cn('shrink-0', className)}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';

export { buttonVariants };
