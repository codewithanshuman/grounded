import { useEffect, useState } from "react";
import { bootstrapCloudIdentity, cloudClient, cloudIdentityConfigured, signInWithGitHub, signOutCloud } from "./cloudIdentity";
import { getActiveIdentity, signOutLocalAccount, type IdentityProfile } from "./localIdentity";

export function useIdentitySession() {
  const [identity, setIdentity] = useState<IdentityProfile | null>(() => cloudIdentityConfigured ? null : getActiveIdentity());
  const [ready, setReady] = useState(!cloudIdentityConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudIdentityConfigured) return;
    const client = cloudClient();
    if (!client) return;
    let active = true;

    const applyUser = async (user: Parameters<typeof bootstrapCloudIdentity>[0] | null) => {
      try {
        const next = user ? await bootstrapCloudIdentity(user) : null;
        if (active) {
          setIdentity(next);
          setError(null);
          setReady(true);
        }
      } catch (reason) {
        if (active) {
          setIdentity(null);
          setError(reason instanceof Error ? reason.message : "Cloud identity could not be initialized.");
          setReady(true);
        }
      }
    };

    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) throw sessionError;
      return applyUser(data.session?.user ?? null);
    }).catch((reason) => {
      if (active) {
        setError(reason instanceof Error ? reason.message : "Cloud session could not be read.");
        setReady(true);
      }
    });

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => { void applyUser(session?.user ?? null); }, 0);
    });
    return () => {
      active = false;
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
