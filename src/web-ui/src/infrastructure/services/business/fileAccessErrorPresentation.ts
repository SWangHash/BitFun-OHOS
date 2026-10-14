/** Preserve the host file-operation error for the driving surface. */
export function describeFileAccessError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
