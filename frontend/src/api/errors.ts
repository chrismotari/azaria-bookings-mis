import { isAxiosError } from 'axios';
import { FieldValues, Path, UseFormSetError } from 'react-hook-form';

type ErrorBody = Record<string, unknown>;

function firstMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return firstMessage(value[0]);
  }
  return null;
}

function errorBody(error: unknown): ErrorBody | null {
  if (isAxiosError(error) && error.response?.data && typeof error.response.data === 'object') {
    return error.response.data as ErrorBody;
  }
  return null;
}

/** A single readable message for any API or network error. */
export function errorMessage(error: unknown): string {
  if (isAxiosError(error) && !error.response) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  const body = errorBody(error);
  if (body) {
    const message = firstMessage(body.detail) ?? firstMessage(body.non_field_errors);
    if (message) {
      return message;
    }
    for (const value of Object.values(body)) {
      const fieldMessage = firstMessage(value);
      if (fieldMessage) {
        return fieldMessage;
      }
    }
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Puts DRF field errors on the matching form fields. Returns a message for
 * anything that does not belong to a field, or null when everything was placed.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  const body = errorBody(error);
  if (!body) {
    return errorMessage(error);
  }
  let unplaced: string | null = null;
  for (const [key, value] of Object.entries(body)) {
    const message = firstMessage(value);
    if (!message) {
      continue;
    }
    if ((fields as readonly string[]).includes(key)) {
      setError(key as Path<T>, { type: 'server', message });
    } else {
      unplaced ??= message;
    }
  }
  return unplaced;
}
