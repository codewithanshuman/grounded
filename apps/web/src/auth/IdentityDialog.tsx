import { useState, type FormEvent } from "react";
import {
  createLocalAccount,
  signInLocalAccount,
  type IdentityProfile,
} from "./localIdentity";

export function IdentityDialog({ open, profile, cloudConfigured, authReady, authError, onGitHubSignIn, onSignOut, onClose }: {
  open: boolean;
  profile: IdentityProfile | null;
  cloudConfigured: boolean;
  authReady: boolean;
  authError: string | null;
  onGitHubSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      if (mode === "signup") {
        await createLocalAccount({
          email: String(data.get("email") ?? ""),
          password: String(data.get("password") ?? ""),
          displayName: String(data.get("displayName") ?? ""),
          worldName: String(data.get("worldName") ?? ""),
        });
      } else {
        await signInLocalAccount(
          String(data.get("email") ?? ""),
          String(data.get("password") ?? ""),
        );
      }
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Account action failed.");
      setBusy(false);
    }
  };

  const beginGitHubSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await onGitHubSignIn();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "GitHub sign-in could not begin.");
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSignOut();
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-out could not be completed.");
      setBusy(false);
    }
  };

  return (
    <div className="identity-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="identity-dialog" role="dialog" aria-modal="true" aria-labelledby="identity-title">
        <button className="identity-close" onClick={onClose} aria-label="Close account panel">×</button>
        <div className="identity-visual" aria-hidden="true">
          <span>GROUNDED / WORLD ACCESS</span>
          <div className="identity-orbit"><i /><i /><i /></div>
          <strong>{profile ? profile.worldName : "Your resilience world"}</strong>
          <p>One blueprint. One evidence ledger. A city that grows only when its simulations finish.</p>
        </div>

        {profile ? (
          <div className="identity-content identity-account">
            <small>ACTIVE FIELD PROFILE</small>
            <div className="identity-avatar">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" /> : profile.displayName.slice(0, 1).toUpperCase()}</div>
            <h2 id="identity-title">{profile.displayName}</h2>
            <p>{profile.email}</p>
            <div className="identity-world-card"><span>OPERATING WORLD</span><strong>{profile.worldName}</strong><em>{profile.authMode === "github" ? "Encrypted session · cloud-synchronized ledger" : "Private ledger on this device"}</em></div>
            {error && <div className="identity-error" role="alert">{error}</div>}
            <button className="identity-primary" disabled={busy} onClick={signOut}>{busy ? "Closing session…" : "Sign out"}</button>
            <p className="identity-boundary">{profile.authMode === "github" ? "Identity is verified by GitHub. Grounded never receives or stores your GitHub password." : "This pilot profile is isolated in this browser. Configure GitHub cloud access for cross-device sync."}</p>
          </div>
        ) : cloudConfigured ? (
          <div className="identity-content identity-cloud">
            <small>SECURE CLOUD ACCESS</small>
            <h2 id="identity-title">Build a world that follows you.</h2>
            <p>GitHub verifies your identity. Grounded restores your private evidence world and completed simulation history on every device.</p>
            <div className="identity-cloud-proof">
              <i>01</i><span><strong>GitHub identity</strong><small>No new password to manage</small></span>
              <i>02</i><span><strong>Private evidence world</strong><small>Protected by row-level security</small></span>
              <i>03</i><span><strong>Cross-device continuity</strong><small>Resume the same verified ledger</small></span>
            </div>
            {(error || authError) && <div className="identity-error" role="alert">{error || authError}</div>}
            <button className="identity-github" disabled={busy || !authReady} onClick={beginGitHubSignIn}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.41-1.26.74-1.55-2.57-.29-5.27-1.29-5.27-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18A10.98 10.98 0 0 1 12 6.1c.98 0 1.95.13 2.86.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.78 1.06.78 2.14v3.28c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg>
              <span>{busy ? "Opening GitHub…" : authReady ? "Continue with GitHub" : "Checking secure session…"}</span>
              <b>→</b>
            </button>
            <p className="identity-boundary">OAuth is handled by GitHub and Supabase Auth. Grounded requests only the standard identity scope—not repository access.</p>
          </div>
        ) : (
          <div className="identity-content">
            <small>PRIVATE PILOT ACCESS</small>
            <h2 id="identity-title">Enter your field lab.</h2>
            <p>Create a named world or continue the evidence ledger you already started on this device.</p>
            <div className="identity-tabs" role="tablist">
              <button className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setError(null); }}>Sign in</button>
              <button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(null); }}>Create world</button>
            </div>
            <form onSubmit={submit}>
              {mode === "signup" && <div className="identity-pair">
                <label><span>Your name</span><input name="displayName" autoComplete="name" placeholder="Anshuman" required /></label>
                <label><span>World name</span><input name="worldName" placeholder="Jaipur Green Grid" required /></label>
              </div>}
              <label><span>Email</span><input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label>
              <label><span>Password</span><input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} placeholder="At least 8 characters" required /></label>
              {error && <div className="identity-error" role="alert">{error}</div>}
              <button className="identity-primary" disabled={busy}>{busy ? "Securing profile…" : mode === "signup" ? "Create world & begin construction" : "Enter my world"}</button>
            </form>
            <p className="identity-boundary">Passwords are salted and derived with PBKDF2 in this browser. This is functional device-local pilot access—not a claim of cloud authentication.</p>
          </div>
        )}
      </section>
    </div>
  );
}
