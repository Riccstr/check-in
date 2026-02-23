import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ACTIONS = ["create", "update"];

function sanitizeError(err: Error): string {
  const msg = err.message || "";
  if (msg.includes("duplicate key") || msg.includes("already exists")) return "A record with this information already exists";
  if (msg.includes("foreign key")) return "Invalid reference provided";
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
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, rep_id, email, password, rep_name, surname, cell_no } = body;

    if (!action || !VALID_ACTIONS.includes(action)) {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!rep_id || typeof rep_id !== "string") {
      return new Response(JSON.stringify({ error: "Valid rep_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate common string fields
    for (const [val, name] of [[rep_name, "Name"], [surname, "Surname"], [cell_no, "Cell number"]] as [unknown, string][]) {
      const err = validateString(val, name);
      if (err) {
        return new Response(JSON.stringify({ error: err }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (action === "create") {
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

      // Create auth user
      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim(),
        password,
        email_confirm: true,
        user_metadata: { full_name: `${rep_name || ""} ${surname || ""}`.trim() },
      });

      if (createErr) {
        console.error("Create rep user error:", createErr.message);
        return new Response(JSON.stringify({ error: sanitizeError(createErr) }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update rep record with user_id and details
      const { error: updateErr } = await supabaseAdmin
        .from("reps")
        .update({
          user_id: newUser.user.id,
          email: email.trim(),
          rep_name: rep_name || undefined,
          surname: surname || null,
          cell_no: cell_no || null,
        })
        .eq("id", rep_id);

      if (updateErr) {
        console.error("Update rep error:", updateErr.message);
        return new Response(JSON.stringify({ error: sanitizeError(updateErr) }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, user_id: newUser.user.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update") {
      // Validate optional email/password if provided
      if (email) {
        const emailErr = validateEmail(email);
        if (emailErr) {
          return new Response(JSON.stringify({ error: emailErr }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      if (password) {
        const passErr = validatePassword(password);
        if (passErr) {
          return new Response(JSON.stringify({ error: passErr }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Update rep details
      const updates: Record<string, any> = {};
      if (rep_name !== undefined) updates.rep_name = rep_name;
      if (surname !== undefined) updates.surname = surname || null;
      if (cell_no !== undefined) updates.cell_no = cell_no || null;
      if (email !== undefined) updates.email = email ? email.trim() : null;

      if (Object.keys(updates).length > 0) {
        await supabaseAdmin.from("reps").update(updates).eq("id", rep_id);
      }

      // Get the rep's user_id
      const { data: rep } = await supabaseAdmin
        .from("reps")
        .select("user_id")
        .eq("id", rep_id)
        .single();

      if (rep?.user_id) {
        const authUpdates: Record<string, any> = {};
        if (email) authUpdates.email = email.trim();
        if (password) authUpdates.password = password;
        if (rep_name || surname) {
          authUpdates.user_metadata = { full_name: `${rep_name || ""} ${surname || ""}`.trim() };
        }

        if (Object.keys(authUpdates).length > 0) {
          const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(
            rep.user_id,
            authUpdates
          );
          if (authErr) {
            console.error("Update auth user error:", authErr.message);
            return new Response(JSON.stringify({ error: sanitizeError(authErr) }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
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
