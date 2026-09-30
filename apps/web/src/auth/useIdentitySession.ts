import { useEffect, useState } from "react";
import { bootstrapCloudIdentity, cloudClient, cloudIdentityConfigured, signInWithGitHub, signOutCloud } from "./cloudIdentity";
import { getActiveIdentity, signOutLocalAccount, type IdentityProfile } from "./localIdentity";
import { SessionBootstrap } from "./sessionBootstrap";

export function useIdentitySession() {
  const [identity, setIdentity] = useState<IdentityProfile | null>(() => cloudIdentityConfigured ? null : getActiveIdentity());
  const [ready, setReady] = useState(!cloudIdentityConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudIdentityConfigured) return;
    const client = cloudClient();
    if (!client) return;
    let active = true;
    let authEventSeen = false;
    const session = new SessionBootstrap(bootstrapCloudIdentity, (next, nextError) => {
      setIdentity(next);
      setError(nextError);
      setReady(true);
    });

    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) throw sessionError;
      // An auth event is newer than the initial session lookup. A delayed
      // lookup must not restore the previous account after sign-out/switch.
      if (!authEventSeen) return session.apply(data.session?.user ?? null);
    }).catch((reason) => {
      if (active && !authEventSeen) {
        setError(reason instanceof Error ? reason.message : "Cloud session could not be read.");
        setReady(true);
      }
    });

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      authEventSeen = true;
      // Defer Supabase I/O outside its auth callback. Same-account refreshes
      // are deduplicated, preserving newer local/in-memory world progress.
      window.setTimeout(() => { if (active) void session.apply(nextSession?.user ?? null); }, 0);
    });
    return () => {
      active = false;
      session.dispose();
      data.subscription.unsubscribe();
    };
  }, []);

  return {
    identity,
    ready,
    error,
    cloudConfigured: cloudIdentityConfigured,
    signIn: signInWithGitHub,
    signOut: async () => {
      if (cloudIdentityConfigured) await signOutCloud();
      else signOutLocalAccount();
    },
  };
}
