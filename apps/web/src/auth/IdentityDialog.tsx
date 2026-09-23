import { useState, type FormEvent } from "react";
import {
  createLocalAccount,
  signInLocalAccount,
  signOutLocalAccount,
  type IdentityProfile,
} from "./localIdentity";

export function IdentityDialog({ open, profile, onClose }: {
  open: boolean;
  profile: IdentityProfile | null;
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
            <div className="identity-avatar">{profile.displayName.slice(0, 1).toUpperCase()}</div>
            <h2 id="identity-title">{profile.displayName}</h2>
            <p>{profile.email}</p>
            <div className="identity-world-card"><span>OPERATING WORLD</span><strong>{profile.worldName}</strong><em>Private ledger on this device</em></div>
            <button className="identity-primary" onClick={() => { signOutLocalAccount(); window.location.reload(); }}>Sign out</button>
            <p className="identity-boundary">This pilot profile is isolated in this browser. Cross-device sync requires the production identity service.</p>
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
