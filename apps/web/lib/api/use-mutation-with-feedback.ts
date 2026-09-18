'use client';

import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { getErrorMessage } from './error-message';

interface FeedbackOptions<TData, TVariables> {
  /**
   * Toast shown on success. Omit for mutations that already show their own
   * dedicated success feedback (a toast at the call site, a redirect, an
   * inline confirmation panel) — do not stack a second toast on top of one
   * of those. A function form can reference the mutation's result/variables.
   */
  successMessage?: string | ((data: TData, variables: TVariables) => string);
}

/**
 * Thin wrapper around TanStack Query's `useMutation` that guarantees error
 * feedback (via the existing `useToast`) on every mutation, and adds success
 * feedback only where a caller opts in via `successMessage`. Reuses the
 * existing toast system and query architecture as-is — this is not a new
 * state-management layer, just a shared place for the success/error toast
 * boilerplate that was previously hand-copied per call site.
 */
export function useMutationWithFeedback<TData, TVariables = void, TContext = unknown>(
  options: UseMutationOptions<TData, unknown, TVariables, TContext> &
    FeedbackOptions<TData, TVariables>,
): UseMutationResult<TData, unknown, TVariables, TContext> {
  const toast = useToast();
  const { successMessage, onSuccess, onError, ...rest } = options;

  return useMutation<TData, unknown, TVariables, TContext>({
    ...rest,
    onSuccess: (data, variables, context) => {
      if (successMessage) {
        toast.success(
          typeof successMessage === 'function' ? successMessage(data, variables) : successMessage,
        );
      }
      return onSuccess?.(data, variables, context);
    },
    onError: (error, variables, context) => {
      toast.error(getErrorMessage(error));
      return onError?.(error, variables, context);
    },
  });
}
