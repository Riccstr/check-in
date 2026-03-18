import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VALID_ROLES = ["admin", "rep"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeError(err: Error): string {
  const msg = err.message || "";
  if (msg.includes("duplicate key") || msg.includes("already exists")) return "A record with this information already exists";
  if (msg.includes("foreign key")) return "Invalid reference provided";
  if (msg.includes("not found")) return "Record not found";
  return "Operation failed. Please try again.";
}

function validateEmail(email: string): string | null {
  if (!email || typeof email !== "string") return "Email is required";
  if (email.length > 255) return "Email is too long";
  if (!EMAIL_REGEX.test(email.trim())) return "Invalid email format";
  return null;
}

function validatePassword(password: string): string | null {
  if (!password || typeof password !== "string") return "Password is required";
  if (password.length < 6) return "Password must be at least 6 characters";
  if (password.length > 72) return "Password is too long";
  return null;
}

function validateString(value: unknown, name: string, maxLen = 255): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return `${name} must be a string`;
  if (value.length > maxLen) return `${name} is too long (max ${maxLen} characters)`;
  return null;
}

function buildFullName(firstName: string | undefined, surname: string | undefined, fallback: string): string {
  return [firstName?.trim(), surname?.trim()].filter(Boolean).join(" ") || fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Verify the caller is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: userError } = await callerClient.auth.getUser();
    if (userError || !caller) {
      console.error("Auth error:", userError?.message || "No user");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = caller.id;

    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = req.method === "GET" ? {} : await req.json();
    const url = new URL(req.url);
    const action = body.action || url.searchParams.get("action") || "list";

    // ─── list ────────────────────────────────────────────────────────────────
    if (action === "list") {
      const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({
        perPage: 1000,
      });

      if (error) {
        console.error("List users error:", error.message);
        return new Response(JSON.stringify({ error: "Failed to list users" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: allRoles } = await supabaseAdmin.from("user_roles").select("*");
      const { data: allReps } = await supabaseAdmin.from("reps").select("id, rep_name, surname, user_id");
      const { data: allProfiles } = await supabaseAdmin.from("profiles").select("id, login_updated_at, login_updated_by");

      const enrichedUsers = users.map((u) => {
        const userRole = allRoles?.find((r) => r.user_id === u.id);
        const linkedRep = allReps?.find((r) => r.user_id === u.id);
        const profile = allProfiles?.find((p) => p.id === u.id);
        const updatedByUser = profile?.login_updated_by ? users.find((x) => x.id === profile.login_updated_by) : null;
        return {
          id: u.id,
          email: u.email,
          full_name: u.user_metadata?.full_name || null,
          role: userRole?.role || null,
          role_id: userRole?.id || null,
          linked_rep_id: linkedRep?.id || null,
          linked_rep_name: linkedRep ? `${linkedRep.rep_name} ${linkedRep.surname || ""}`.trim() : null,
          linked_rep_first_name: linkedRep?.rep_name || null,
          linked_rep_surname: linkedRep?.surname || null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          email_confirmed_at: u.email_confirmed_at,
          login_updated_at: profile?.login_updated_at || null,
          login_updated_by_name: updatedByUser?.user_metadata?.full_name || updatedByUser?.email || null,
        };
      });

      return new Response(JSON.stringify({ users: enrichedUsers }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── create_user ─────────────────────────────────────────────────────────
    if (action === "create_user") {
      const { email, password, role, first_name, surname, full_name } = body;

      // Resolve first/last name — accept separate fields, fall back to splitting full_name
      const resolvedFirst: string = first_name?.trim() || (full_name ? full_name.split(" ")[0] : "") || "";
      const resolvedSurname: string = surname?.trim() || (full_name ? full_name.split(" ").slice(1).join(" ") : "") || "";

      const emailErr = validateEmail(email);
      if (emailErr) {
        return new Response(JSON.stringify({ error: emailErr }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const passErr = validatePassword(password);
      if (passErr) {
        return new Response(JSON.stringify({ error: passErr }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (role && !VALID_ROLES.includes(role)) {
        return new Response(JSON.stringify({ error: "Invalid role. Must be 'admin' or 'rep'" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const firstNameErr = validateString(resolvedFirst, "First name");
      if (firstNameErr) {
        return new Response(JSON.stringify({ error: firstNameErr }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const surnameErr = validateString(resolvedSurname, "Surname");
      if (surnameErr) {
        return new Response(JSON.stringify({ error: surnameErr }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const computedFullName = buildFullName(resolvedFirst, resolvedSurname, email);

      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim(),
        password,
        email_confirm: true,
        user_metadata: { full_name: computedFullName },
      });

      if (createErr) {
        console.error("Create user error:", createErr.message);
        return new Response(JSON.stringify({ error: sanitizeError(createErr) }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (role && newUser.user) {
        await supabaseAdmin.from("user_roles").delete().eq("user_id", newUser.user.id);
        await supabaseAdmin.from("user_roles").insert({ user_id: newUser.user.id, role });

        if (role === "rep") {
          // Auto-create a rep record linked to this new user
          const { error: repErr } = await supabaseAdmin.from("reps").insert({
            rep_name: resolvedFirst || computedFullName,
            surname: resolvedSurname || null,
            email: email.trim(),
            user_id: newUser.user.id,
            is_active: true,
          });
          if (repErr) {
            console.error("Create rep record error:", repErr.message);
            // Non-fatal — user and role were created successfully
          }
        } else if (role === "admin") {
          // Safety: unlink any rep record that somehow has this user_id
          await supabaseAdmin.from("reps").update({ user_id: null, email: null }).eq("user_id", newUser.user.id);
        }
      }

      return new Response(JSON.stringify({ success: true, user_id: newUser.user?.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── update_user ─────────────────────────────────────────────────────────
    if (action === "update_user") {
      const { user_id, first_name, surname, email, password, role } = body;

      if (!user_id || typeof user_id !== "string") {
        return new Response(JSON.stringify({ error: "Valid user_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const emailErr = validateEmail(email);
      if (emailErr) {
        return new Response(JSON.stringify({ error: emailErr }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (password && password !== "") {
        const passErr = validatePassword(password);
        if (passErr) {
          return new Response(JSON.stringify({ error: passErr }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      if (!role || !VALID_ROLES.includes(role)) {
        return new Response(JSON.stringify({ error: "Invalid role. Must be 'admin' or 'rep'" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const firstNameErr = validateString(first_name, "First name");
      if (firstNameErr) {
        return new Response(JSON.stringify({ error: firstNameErr }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const surnameErr = validateString(surname, "Surname");
      if (surnameErr) {
        return new Response(JSON.stringify({ error: surnameErr }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let credentialsChanged = false;

      // 1. Fetch current user to detect email change
      const { data: { user: currentUser } } = await supabaseAdmin.auth.admin.getUserById(user_id);
      const emailChanged = currentUser && currentUser.email !== email.trim();

      // 2. Update email if changed
      if (emailChanged) {
        const { error: emailErr2 } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
          email: email.trim(),
          email_confirm: true,
        });
        if (emailErr2) {
          console.error("Update email error:", emailErr2.message);
          return new Response(JSON.stringify({ error: sanitizeError(emailErr2) }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        credentialsChanged = true;
      }

      // 3. Update password if provided
      if (password && password.trim() !== "") {
        const { error: passErr2 } = await supabaseAdmin.auth.admin.updateUserById(user_id, { password });
        if (passErr2) {
          console.error("Update password error:", passErr2.message);
          return new Response(JSON.stringify({ error: "Failed to update password" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        credentialsChanged = true;
      }

      // 4. Update full_name in user_metadata
      const computedFullName = buildFullName(first_name, surname, email.trim());
      await supabaseAdmin.auth.admin.updateUserById(user_id, {
        user_metadata: { full_name: computedFullName },
      });

      // 5. Update role in user_roles (upsert)
      const { data: existingRole } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", user_id)
        .maybeSingle();

      if (existingRole) {
        await supabaseAdmin.from("user_roles").update({ role }).eq("user_id", user_id);
      } else {
        await supabaseAdmin.from("user_roles").insert({ user_id, role });
      }

      // 6. Sync rep record — must run AFTER role is committed
      const { data: existingRep } = await supabaseAdmin
        .from("reps")
        .select("id")
        .eq("user_id", user_id)
        .maybeSingle();

      if (existingRep) {
        if (role === "admin") {
          // Unlink the rep — admins are not reps
          await supabaseAdmin.from("reps").update({ user_id: null, email: null }).eq("user_id", user_id);
        } else {
          // Keep rep record in sync
          await supabaseAdmin.from("reps").update({
            rep_name: first_name?.trim() || computedFullName,
            surname: surname?.trim() || null,
            email: email.trim(),
          }).eq("user_id", user_id);
        }
      } else if (role === "rep") {
        // No linked rep exists but role is rep — create one
        const { error: repErr } = await supabaseAdmin.from("reps").insert({
          rep_name: first_name?.trim() || computedFullName,
          surname: surname?.trim() || null,
          email: email.trim(),
          user_id,
          is_active: true,
        });
        if (repErr) {
          console.error("Create rep record error:", repErr.message);
          // Non-fatal — the auth/role updates succeeded
        }
      }

      // 7. Record login audit if credentials changed
      if (credentialsChanged) {
        await supabaseAdmin.from("profiles").update({
          login_updated_at: new Date().toISOString(),
          login_updated_by: callerId,
        }).eq("id", user_id);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── update_role (kept for backwards compatibility) ───────────────────────
    if (action === "update_role") {
      const { user_id, role } = body;
      if (!user_id || typeof user_id !== "string") {
        return new Response(JSON.stringify({ error: "Valid user_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!role || !VALID_ROLES.includes(role)) {
        return new Response(JSON.stringify({ error: "Invalid role. Must be 'admin' or 'rep'" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existing } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", user_id)
        .maybeSingle();

      if (existing) {
        await supabaseAdmin.from("user_roles").update({ role }).eq("user_id", user_id);
      } else {
        await supabaseAdmin.from("user_roles").insert({ user_id, role });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── update_email (kept for backwards compatibility) ──────────────────────
    if (action === "update_email") {
      const { user_id, email } = body;
      if (!user_id || typeof user_id !== "string") {
        return new Response(JSON.stringify({ error: "Valid user_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const emailErr = validateEmail(email);
      if (emailErr) {
        return new Response(JSON.stringify({ error: emailErr }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        email: email.trim(),
        email_confirm: true,
      });
      if (error) {
        console.error("Update email error:", error.message);
        return new Response(JSON.stringify({ error: sanitizeError(error) }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin.from("profiles").update({
        login_updated_at: new Date().toISOString(),
        login_updated_by: callerId,
      }).eq("id", user_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── reset_password (kept for backwards compatibility) ────────────────────
    if (action === "reset_password") {
      const { user_id, password } = body;
      if (!user_id || typeof user_id !== "string") {
        return new Response(JSON.stringify({ error: "Valid user_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const passErr = validatePassword(password);
      if (passErr) {
        return new Response(JSON.stringify({ error: passErr }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, { password });
      if (error) {
        console.error("Reset password error:", error.message);
        return new Response(JSON.stringify({ error: "Failed to reset password" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin.from("profiles").update({
        login_updated_at: new Date().toISOString(),
        login_updated_by: callerId,
      }).eq("id", user_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── delete_user ─────────────────────────────────────────────────────────
    if (action === "delete_user") {
      const { user_id } = body;
      if (!user_id || typeof user_id !== "string") {
        return new Response(JSON.stringify({ error: "Valid user_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (user_id === callerId) {
        return new Response(JSON.stringify({ error: "Cannot delete your own account" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin.from("reps").update({ user_id: null, email: null }).eq("user_id", user_id);
      await supabaseAdmin.from("user_roles").delete().eq("user_id", user_id);

      const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id);
      if (error) {
        console.error("Delete user error:", error.message);
        return new Response(JSON.stringify({ error: "Failed to delete user" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unhandled error:", err.message);
    return new Response(JSON.stringify({ error: "An unexpected error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
