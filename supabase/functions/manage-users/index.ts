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

    if (action === "create_user") {
      const { email, password, role, full_name } = body;
      
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
      const nameErr = validateString(full_name, "Full name");
      if (nameErr) {
        return new Response(JSON.stringify({ error: nameErr }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim(),
        password,
        email_confirm: true,
        user_metadata: { full_name: (full_name || email).trim() },
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
        
        if (role === "admin") {
          await supabaseAdmin.from("reps").update({ user_id: null, email: null }).eq("user_id", newUser.user.id);
        }
      }

      return new Response(JSON.stringify({ success: true, user_id: newUser.user?.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
