import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { WorldState } from "@verdant/protocol";
import { PENDING_FOUNDING_KEY, worldStorageKey, type IdentityProfile } from "./localIdentity";

declare const __GROUNDED_SUPABASE_URL__: string;
declare const __GROUNDED_SUPABASE_PUBLISHABLE_KEY__: string;

const url = typeof __GROUNDED_SUPABASE_URL__ === "string" ? __GROUNDED_SUPABASE_URL__.trim() : "";
const publishableKey = typeof __GROUNDED_SUPABASE_PUBLISHABLE_KEY__ === "string" ? __GROUNDED_SUPABASE_PUBLISHABLE_KEY__.trim() : "";

export const cloudIdentityConfigured = Boolean(url && publishableKey);
let singleton: SupabaseClient | null = null;

const EMPTY_WORLD: WorldState = {
  trees: [],
  buildings: [],
  totalRuns: 0,
  totalFuturesSimulated: 0,
  bestImprovementPct: 0,
};

export function cloudClient(): SupabaseClient | null {
  if (!cloudIdentityConfigured) return null;
  singleton ??= createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return singleton;
}

function githubName(user: User): string {
  const metadata = user.user_metadata ?? {};
  return String(metadata.full_name || metadata.user_name || metadata.preferred_username || user.email?.split("@")[0] || "Grounded operator");
}

function githubAvatar(user: User): string | undefined {
  const value = user.user_metadata?.avatar_url;
  return typeof value === "string" && value.startsWith("https://") ? value : undefined;
}

function profileFor(user: User, worldName: string): IdentityProfile {
  return {
    id: user.id,
    email: user.email ?? "GitHub account",
    displayName: githubName(user),
    worldName,
    createdAt: new Date(user.created_at).getTime(),
    authMode: "github",
    avatarUrl: githubAvatar(user),
  };
}

export async function bootstrapCloudIdentity(user: User): Promise<IdentityProfile> {
  const client = cloudClient();
  if (!client) throw new Error("Cloud identity is not configured.");
  const existing = await client.from("grounded_worlds").select("world_name,state").eq("user_id", user.id).maybeSingle();
  if (existing.error) throw existing.error;

  let worldName: string;
  let state: WorldState;
  if (existing.data) {
    worldName = String(existing.data.world_name);
    state = existing.data.state as WorldState;
  } else {
    worldName = `${githubName(user)}'s Resilience World`;
    const inserted = await client.from("grounded_worlds").insert({ user_id: user.id, world_name: worldName, state: EMPTY_WORLD }).select("world_name,state").single();
    if (inserted.error?.code === "23505") {
      const raced = await client.from("grounded_worlds").select("world_name,state").eq("user_id", user.id).single();
      if (raced.error) throw raced.error;
      worldName = String(raced.data.world_name);
      state = raced.data.state as WorldState;
    } else {
      if (inserted.error) throw inserted.error;
      state = inserted.data.state as WorldState;
      localStorage.setItem(PENDING_FOUNDING_KEY, user.id);
    }
  }
  localStorage.setItem(worldStorageKey(user.id), JSON.stringify(state));
  return profileFor(user, worldName);
}

export async function signInWithGitHub(): Promise<void> {
  const client = cloudClient();
  if (!client) throw new Error("GitHub sign-in needs the Supabase project variables.");
  const { error } = await client.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOutCloud(): Promise<void> {
  const client = cloudClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function persistCloudWorld(profile: IdentityProfile, state: WorldState): Promise<void> {
  if (profile.authMode !== "github") return;
  const client = cloudClient();
  if (!client) return;
  const { error } = await client.from("grounded_worlds").upsert({
    user_id: profile.id,
    world_name: profile.worldName,
    state,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw error;
}
