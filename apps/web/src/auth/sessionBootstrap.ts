/** One bootstrap per active account; token refresh must not rehydrate its world. */
export class SessionBootstrap<User extends { id: string }, Profile> {
  private generation = 0;
  private requestedId: string | null | undefined;
  private settled = false;
  private active = true;
  private pending: Promise<void> | undefined;

  constructor(
    private bootstrap: (user: User) => Promise<Profile>,
    private publish: (profile: Profile | null, error: string | null) => void,
  ) {}

  apply(user: User | null): Promise<void> {
    if (!this.active) return Promise.resolve();
    const id = user?.id ?? null;
    if (id === this.requestedId && (this.settled || this.pending)) return this.pending ?? Promise.resolve();

    const generation = ++this.generation;
    this.requestedId = id;
    this.settled = false;
    this.pending = undefined;
    if (!user) {
      this.settled = true;
      this.publish(null, null);
      return Promise.resolve();
    }

    const current = () => this.active && this.generation === generation;
    this.pending = Promise.resolve().then(async () => {
      if (!current()) return;
      const profile = await this.bootstrap(user);
      if (!current()) return;
      this.settled = true;
      this.publish(profile, null);
    }).catch((reason: unknown) => {
      if (!current()) return;
      // A later same-account event may retry a failed bootstrap, but a
      // successful one stays hydrated until the account actually changes.
      this.publish(null, reason instanceof Error ? reason.message : "Cloud identity could not be initialized.");
    }).finally(() => {
      if (current()) this.pending = undefined;
    });
    return this.pending;
  }

  dispose(): void {
    this.active = false;
    this.generation++;
    this.pending = undefined;
  }
}
