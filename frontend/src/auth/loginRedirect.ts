// Set when someone signs out (or an admin's or the owner's session ends); the root navigator then opens sign-in.
let loginPending = false;

/** The next signed-out render opens this area's sign-in page (see useLoginAfterSignOut). */
export function requestLoginAfterSignOut() {
  loginPending = true;
}

/** Whether sign-in should open now; clears the request. */
export function takeLoginAfterSignOut(): boolean {
  const pending = loginPending;
  loginPending = false;
  return pending;
}
