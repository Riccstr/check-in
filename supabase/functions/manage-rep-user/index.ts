import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    if (action === "create") {
      // Create auth user
      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: `${rep_name} ${surname || ""}`.trim() },
      });

      if (createErr) {
        return new Response(JSON.stringify({ error: createErr.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update rep record with user_id and details
      const { error: updateErr } = await supabaseAdmin
        .from("reps")
        .update({
          user_id: newUser.user.id,
          email,
          rep_name,
          surname: surname || null,
          cell_no: cell_no || null,
        })
        .eq("id", rep_id);

      if (updateErr) {
        return new Response(JSON.stringify({ error: updateErr.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, user_id: newUser.user.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update") {
      // Update rep details
      const updates: Record<string, any> = {};
      if (rep_name !== undefined) updates.rep_name = rep_name;
      if (surname !== undefined) updates.surname = surname || null;
      if (cell_no !== undefined) updates.cell_no = cell_no || null;
      if (email !== undefined) updates.email = email;

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
        // Update auth user if email or password changed
        const authUpdates: Record<string, any> = {};
        if (email) authUpdates.email = email;
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
            return new Response(JSON.stringify({ error: authErr.message }), {
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
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
