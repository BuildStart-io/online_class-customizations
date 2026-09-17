import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

/** Normalize a WhatsApp identifier to a stable contact key (digits only). */
function normalizeContactKey(raw: string): string {
  return String(raw || "").split("@")[0].replace(/\D/g, "");
}

/** Start of the current billing cycle for a profile. */
function cycleStart(billingCycleStart: string | null | undefined): string {
  if (!billingCycleStart) {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const now = new Date();
  const current = new Date(billingCycleStart);
  while (true) {
    const next = new Date(current);
    next.setMonth(next.getMonth() + 1);
    if (next > now) break;
    current.setTime(next.getTime());
  }
  return current.toISOString();
}

/**
 * Registers an outbound contact against the current billing cycle.
 * Returns blocked=true only when this is a NEW contact and the plan's
 * contact allowance is exhausted.
 */
async function registerContact(supabase: any, userId: string, phoneNumber: string, corrId: string) {
  try {
    const key = normalizeContactKey(phoneNumber);
    if (!key) return { blocked: false, isNew: false };

    const { data: profile } = await supabase
      .from("profiles")
      .select("billing_cycle_start, addon_contacts, plan_tier")
      .eq("user_id", userId)
      .single();

    const periodStart = cycleStart(profile?.billing_cycle_start);

    const { data: existing } = await supabase
      .from("contact_usage")
      .select("id")
      .eq("user_id", userId)
      .eq("phone_number", key)
      .eq("period_start", periodStart)
      .maybeSingle();

    if (existing) return { blocked: false, isNew: false };

    // New contact — enforce the allowance before counting them in.
    const { data: platformLimits } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "plan_limits")
      .single();

    const tier = profile?.plan_tier || "free";
    const tierLimits = platformLimits?.value?.[tier] || {};
    const limit = (tierLimits.contacts_per_month || 50) + (profile?.addon_contacts || 0);

    const { data: used } = await supabase.rpc("get_contact_usage", {
      _user_id: userId,
      _since: periodStart,
    });

    if ((used || 0) >= limit) {
      console.log(`[${corrId}] Contact limit ${used}/${limit} reached for user ${userId}`);
      return { blocked: true, isNew: true };
    }

    await supabase
      .from("contact_usage")
      .insert({ user_id: userId, phone_number: key, period_start: periodStart });

    console.log(`[${corrId}] New contact registered (${(used || 0) + 1}/${limit})`);
    return { blocked: false, isNew: true };
  } catch (e) {
    console.error(`[${corrId}] registerContact failed:`, e);
    return { blocked: false, isNew: false };
  }
}

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey, { db: { schema: "onlineclass_customization" } });

  console.log(`[process-lms-notifications] Triggered by cron`);

  // 1. Fetch pending messages (limit to 15 to avoid timeouts)
  const { data: pendingMessages, error: fetchError } = await supabase
    .from("lms_notification_queue")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(15);

  if (fetchError) {
    console.error("Queue fetch error:", fetchError);
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500, headers: corsHeaders });
  }

  if (!pendingMessages || pendingMessages.length === 0) {
    console.log("[process-lms-notifications] No pending messages");
    return new Response(JSON.stringify({ processed: 0 }), { headers: corsHeaders });
  }

  // 2. Mark them as processing
  const ids = pendingMessages.map(m => m.id);
  await supabase
    .from("lms_notification_queue")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .in("id", ids);

  let processedCount = 0;

  // 3. Process each message
  for (const msg of pendingMessages) {
    try {
      // Add delay (anti-ban) 5 seconds
      if (processedCount > 0) {
          await new Promise(r => setTimeout(r, 5000));
      }

      let sessionApiKey = Deno.env.get("WAHA_DEFAULT_SESSION") || "default";
      let userId = "";
      const { data: sessionData } = await supabase.from("user_wsender_sessions").select("session_id, user_id").limit(1).maybeSingle();
      if (sessionData && sessionData.session_id) {
          sessionApiKey = sessionData.session_id;
          userId = sessionData.user_id;
      }

      if (userId) {
          const { blocked } = await registerContact(supabase, userId, msg.recipient_number, msg.id);
          if (blocked) {
              throw new Error(`Contact limit reached for user ${userId}`);
          }
      }

      console.log(`Sending to ${msg.recipient_number} with session ${sessionApiKey}`);

      const res = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-onlineclass`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
            to: msg.recipient_number, 
            message: msg.message_text,
            sessionApiKey: sessionApiKey
        }),
      });

      if (!res.ok) {
          throw new Error(`WAHA Failed: ${await res.text()}`);
      }

      await supabase
        .from("lms_notification_queue")
        .update({ status: "sent", updated_at: new Date().toISOString() })
        .eq("id", msg.id);
        
      if (userId) {
          await supabase.from("conversations").insert({
              phone_number: msg.recipient_number,
              message: msg.message_text,
              direction: "outbound",
              message_type: "text",
              user_id: userId,
          });
      }

      processedCount++;

    } catch (error) {
      console.error(`Message ${msg.id} failed:`, error);
      await supabase
        .from("lms_notification_queue")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", msg.id);
    }
  }

  return new Response(JSON.stringify({ processed: processedCount }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
