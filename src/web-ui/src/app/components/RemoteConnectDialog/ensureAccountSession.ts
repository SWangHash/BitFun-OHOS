/** Reuse the shared identity when a Relay session needs to be established. */
export async function ensureAccountSession(
  api: {
    accountStatus(): Promise<{ logged_in: boolean; user_id?: string | null }>;
    accountLogin(): Promise<unknown>;
  },
  isCurrent: () => boolean,
  accountId: string | number,
): Promise<boolean> {
  if (!isCurrent()) return false;
  const status = await api.accountStatus();
  if (!isCurrent()) return false;
  if (!status.logged_in || status.user_id !== String(accountId)) await api.accountLogin();
  return isCurrent();
}
