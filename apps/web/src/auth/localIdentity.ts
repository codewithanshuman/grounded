export const ACTIVE_PROFILE_KEY = "grounded.active-profile.v1";
export const PENDING_FOUNDING_KEY = "grounded.pending-world-founding.v1";
const ACCOUNTS_KEY = "grounded.local-accounts.v1";
const ITERATIONS = 160_000;

export interface IdentityProfile {
  id: string;
  email: string;
  displayName: string;
  worldName: string;
  createdAt: number;
}

interface StoredAccount extends IdentityProfile {
  salt: string;
  passwordHash: string;
}

function accounts(): StoredAccount[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAccounts(value: StoredAccount[]): void {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(value));
}

function bytesToBase64(bytes: Uint8Array): string {
  let value = "";
  bytes.forEach((byte) => { value += String.fromCharCode(byte); });
  return btoa(value);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function derivePassword(password: string, salt: Uint8Array): Promise<string> {
  const saltBuffer = Uint8Array.from(salt).buffer;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: ITERATIONS },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function publicProfile(account: StoredAccount): IdentityProfile {
  const { id, email, displayName, worldName, createdAt } = account;
  return { id, email, displayName, worldName, createdAt };
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export function getActiveIdentity(): IdentityProfile | null {
  const activeId = localStorage.getItem(ACTIVE_PROFILE_KEY);
  if (!activeId) return null;
  const account = accounts().find((candidate) => candidate.id === activeId);
  return account ? publicProfile(account) : null;
}

export function activeWorldStorageKey(): string {
  const activeId = localStorage.getItem(ACTIVE_PROFILE_KEY);
  return activeId ? `grounded.profile-world.v1.${activeId}` : "grounded.public.world.v1";
}

export async function createLocalAccount(input: {
  email: string;
  password: string;
  displayName: string;
  worldName: string;
}): Promise<IdentityProfile> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const worldName = input.worldName.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
  if (input.password.length < 8) throw new Error("Use at least 8 characters for the password.");
  if (displayName.length < 2) throw new Error("Enter the name shown in your field lab.");
  if (worldName.length < 3) throw new Error("Give your resilience world a name.");

  const stored = accounts();
  if (stored.some((candidate) => candidate.email === email)) {
    throw new Error("An account with this email already exists on this device.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const account: StoredAccount = {
    id: crypto.randomUUID(),
    email,
    displayName,
    worldName,
    createdAt: Date.now(),
    salt: bytesToBase64(salt),
    passwordHash: await derivePassword(input.password, salt),
  };
  saveAccounts([...stored, account]);
  localStorage.setItem(ACTIVE_PROFILE_KEY, account.id);
  localStorage.setItem(PENDING_FOUNDING_KEY, account.id);
  return publicProfile(account);
}

export async function signInLocalAccount(emailInput: string, password: string): Promise<IdentityProfile> {
  const email = emailInput.trim().toLowerCase();
  const account = accounts().find((candidate) => candidate.email === email);
  if (!account) throw new Error("No account with this email exists on this device.");
  const candidate = await derivePassword(password, base64ToBytes(account.salt));
  if (!secureEqual(candidate, account.passwordHash)) throw new Error("The password is incorrect.");
  localStorage.setItem(ACTIVE_PROFILE_KEY, account.id);
  return publicProfile(account);
}

export function signOutLocalAccount(): void {
  localStorage.removeItem(ACTIVE_PROFILE_KEY);
}

export function pendingFoundingFor(profile?: IdentityProfile | null): boolean {
  return Boolean(profile && localStorage.getItem(PENDING_FOUNDING_KEY) === profile.id);
}

export function completePendingFounding(profile?: IdentityProfile | null): void {
  if (profile && localStorage.getItem(PENDING_FOUNDING_KEY) === profile.id) {
    localStorage.removeItem(PENDING_FOUNDING_KEY);
  }
}
